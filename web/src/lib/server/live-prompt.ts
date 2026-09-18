import "server-only";
import { getDb } from "./db";
import { agentPrompt } from "@/lib/live/prompts";
import { languageDirective } from "@/lib/live/config";
import { recordingDirective } from "@/lib/live/recording";
import { staffCallbackBlock } from "@/lib/server/tickets";
import { voiceByName, voiceCraft } from "@/lib/live/voices";
import { compileFlow } from "@/lib/agents/flow";
import { SWARA_AGENT_ID, SWARA_GREETING, SWARA_PERSONA_NAME, SWARA_SYSTEM_PROMPT, SWARA_TOOL_RULES, SWARA_VOICE } from "@/lib/agents/swara";
import { appointmentTypes, playbook, transferTargets, voices as orgVoices } from "./workspace";
import type { FlowEdge, FlowNode } from "@/lib/api/schemas";

/**
 * Builds the system instruction for a live session from the tenant's own
 * rows — voice craft, transfer desks, appointment types, departments, the
 * compiled flow graph, and the directory of sibling agents it may hand off
 * to — plus the agent persona. An empty transfer list becomes an instruction
 * not to offer a transfer, which is how we stop the model inventing a
 * person we cannot reach.
 */
export type ComposedPrompt = {
  name: string;
  greeting: string;
  intent: string;
  voice: string;
  systemInstruction: string;
  /** True for the setup assistant: it carries the workspace-writing tools. */
  setupTools: boolean;
};

export function composeLivePrompt(
  orgId: string,
  agentId: string,
  voiceName?: string,
  extras?: { fromNumber?: string; briefing?: string },
): ComposedPrompt {
  if (agentId === SWARA_AGENT_ID) return composeSwara(orgId);

  const stored = getDb()
    .prepare("SELECT * FROM agents WHERE id=? AND org_id=?")
    .get(agentId, orgId) as
    | { name: string; prompt: string | null; intent: string; nodes: string; edges: string; voice_id: string | null }
    | undefined;

  const builtin = agentPrompt(agentId);
  const role = stored?.prompt || builtin?.systemInstruction || defaultRole(stored?.name ?? "this line");

  const catalog = voiceByName(voiceName);
  const saved = orgVoices(orgId).find((v) => v.liveName === catalog.name);
  const voiceBlock = saved?.promptTemplate || voiceCraft(voiceName);
  const persona = saved?.personaName || catalog.personaName;

  const book = playbook(orgId);
  const transfers = book.extra.humanEscalation === false ? [] : transferTargets(orgId);
  const slots = appointmentTypes(orgId);
  const departments = getDb()
    .prepare("SELECT name, keywords, email, phone, whatsapp FROM departments WHERE org_id=?")
    .all(orgId) as { name: string; keywords: string; email: string | null; phone: string | null; whatsapp: string | null }[];
  const siblings = (getDb()
    .prepare("SELECT id, name, intent, prompt FROM agents WHERE org_id=? AND id!=?")
    .all(orgId, agentId) as { id: string; name: string; intent: string; prompt: string | null }[]);

  const nodes = safeJson<FlowNode[]>(stored?.nodes, []);
  const edges = safeJson<FlowEdge[]>(stored?.edges, []);
  const flow = compileFlow(nodes, edges, { agents: siblings });

  // Only agents reachable from this flow's handoff nodes, or — for a
  // prompt-only agent — every sibling, so the model never names an agent that
  // cannot take the call.
  const handoffIds = new Set(nodes.filter((n) => n.kind === "handoff").map((n) => String((n.config as { agentId?: string })?.agentId ?? "")));
  const directory = (nodes.length ? siblings.filter((s) => handoffIds.has(s.id)) : siblings).slice(0, 8);

  const workspace = [
    book.businessType ? `BUSINESS: ${book.businessType}` : "",
    book.hours ? `HOURS: ${book.hours}` : "",
    book.transferPolicy ? `TRANSFER POLICY: ${book.transferPolicy}` : "",
    book.bookingPolicy ? `BOOKING POLICY: ${book.bookingPolicy}` : "",
    departments.length
      ? `DEPARTMENTS that own follow-up: ${departments
          .map((d) => {
            const bits = [d.name];
            if (d.email) bits.push(`email ${d.email}`);
            if (d.phone) bits.push(`phone ${d.phone}`);
            if (d.whatsapp) bits.push(`whatsapp ${d.whatsapp}`);
            return bits.join(", ");
          })
          .join("; ")}.`
      : "",
    transfers.length
      ? [
          "TRANSFER TARGETS — these are the only humans you may offer. When transferring, call transfer_to_human with their name.",
          ...transfers.map(
            (t) =>
              `- ${t.name} (${t.role}, ${t.phone}${t.email ? `, email ${t.email}` : ""}${t.whatsapp ? `, whatsapp ${t.whatsapp}` : ""}${t.hours ? `, ${t.hours}` : ""}): ${t.whenToUse}`,
          ),
        ].join("\n")
      : "TRANSFER: no human desk is configured. Do not offer a transfer. Take a callback number and say someone will call back.",
    slots.length
      ? [
          "APPOINTMENT TYPES you may book — never invent a type or a time outside these hours:",
          ...slots.map(
            (s) =>
              `- ${s.name}: ${s.durationMin} min${s.hours ? `, ${s.hours}` : ""}${s.location ? `, ${s.location}` : ""}${s.notes ? `. ${s.notes}` : ""}`,
          ),
        ].join("\n")
      : "",
    directory.length
      ? [
          "AGENT DIRECTORY — other agents of this business you may hand a caller to with handoff_to_agent. Use the exact name.",
          ...directory.map((s) => `- ${s.name}: ${(s.prompt ?? s.intent).split(/\.\s/)[0].slice(0, 140)}`),
        ].join("\n")
      : "HANDOFF: you are the only agent. Do not call handoff_to_agent.",
  ]
    .filter(Boolean)
    .join("\n\n");

  return {
    name: stored?.name ?? builtin?.name ?? "Agent",
    greeting: builtin?.greeting ?? `${persona} speaking. How can I help?`,
    intent: stored?.intent ?? builtinIntent(agentId),
    voice: catalog.name,
    setupTools: false,
    systemInstruction: [
      extras?.briefing ? `OUTBOUND BRIEFING (do this job, then offer to take questions):\n${extras.briefing}` : "",
      extras?.fromNumber ? staffCallbackBlock(orgId, extras.fromNumber) : "",
      `Your name on this call is ${persona}. Introduce yourself as ${persona}.`,
      voiceBlock,
      role,
      flow,
      workspace,
      recordingDirective(),
      languageDirective(),
    ]
      .filter(Boolean)
      .join("\n\n"),
  };
}

/**
 * The setup assistant. Fixed female voice and persona regardless of what the
 * caller picked — Swara is a character, not a slot — and a snapshot of what
 * the workspace already contains so she does not ask for it twice.
 */
function composeSwara(orgId: string): ComposedPrompt {
  const book = playbook(orgId);
  const departments = (getDb().prepare("SELECT name FROM departments WHERE org_id=?").all(orgId) as { name: string }[]).map((r) => r.name);
  const transfers = transferTargets(orgId);
  const slots = appointmentTypes(orgId);
  const agents = (getDb().prepare("SELECT name FROM agents WHERE org_id=?").all(orgId) as { name: string }[]).map((r) => r.name);
  const knowledge = (getDb().prepare("SELECT COUNT(*) n FROM knowledge_docs WHERE org_id=?").get(orgId) as { n: number }).n;

  const snapshot = [
    "WHAT THE WORKSPACE ALREADY HAS (do not ask for these again; build on them):",
    `- Business: ${book.businessType || "not described yet"}${book.extra.useCase ? ` (${String(book.extra.useCase)})` : ""}`,
    `- Hours: ${book.hours || "not set"}`,
    `- Departments: ${departments.join(", ") || "none"}`,
    `- Transfer desks: ${transfers.map((t) => `${t.name} (${t.role})`).join(", ") || "none"}`,
    `- Bookable: ${slots.map((s) => s.name).join(", ") || "none"}`,
    `- Knowledge documents: ${knowledge}`,
    `- Agents: ${agents.join(", ") || "none yet"}`,
  ].join("\n");

  return {
    name: "Swara — setup assistant",
    greeting: SWARA_GREETING,
    intent: "other",
    voice: SWARA_VOICE,
    setupTools: true,
    systemInstruction: [
      `Your name is ${SWARA_PERSONA_NAME}.`,
      SWARA_SYSTEM_PROMPT,
      SWARA_TOOL_RULES,
      snapshot,
      languageDirective(),
    ].join("\n\n"),
  };
}

function safeJson<T>(raw: string | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function defaultRole(name: string) {
  return `You are the voice of ${name}. Keep turns short. Use the tools you have been given. Never invent facts.`;
}

function builtinIntent(agentId: string) {
  const map: Record<string, string> = {
    ag_grievance: "complaint",
    ag_delivery: "delivery_reschedule",
    ag_order: "order_status",
    ag_lead: "sales_enquiry",
    ag_booking: "booking",
    ag_cod: "payment_reminder",
  };
  return map[agentId] ?? "other";
}
