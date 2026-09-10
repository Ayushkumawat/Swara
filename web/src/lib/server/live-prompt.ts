import "server-only";
import { getDb } from "./db";
import { agentPrompt, callFoundation } from "@/lib/live/prompts";
import { languageDirective } from "@/lib/live/config";
import { voiceByName, voiceCraft } from "@/lib/live/voices";
import { appointmentTypes, playbook, transferTargets, voices as orgVoices } from "./workspace";
import { compileFlow } from "@/lib/agents/compile-flow";
import type { FlowEdge, FlowNode } from "@/lib/api/schemas";

/**
 * Builds the system instruction for a live session from the tenant's own
 * rows — voice craft, the compiled flow (this is what makes the canvas real),
 * sibling agents for handoff, transfer desks, appointment types —
 * plus the agent persona.
 */
export function composeLivePrompt(orgId: string, agentId: string, voiceName?: string) {
  if (agentId === "ag_swara") {
    return swaraSetupPrompt(orgId, voiceName);
  }

  const stored = getDb()
    .prepare("SELECT * FROM agents WHERE id=? AND org_id=?")
    .get(agentId, orgId) as
    | {
        name: string;
        prompt: string | null;
        intent: string;
        nodes: string;
        edges: string;
      }
    | undefined;

  const builtin = agentPrompt(agentId);
  const role = stored?.prompt || builtin?.systemInstruction || defaultRole(stored?.name ?? "this line");

  const catalog = voiceByName(voiceName);
  const saved = orgVoices(orgId).find((v) => v.liveName === catalog.name);
  const voiceBlock = saved?.promptTemplate || voiceCraft(voiceName);
  const persona = saved?.personaName || catalog.personaName;

  const nodes = safeParse<FlowNode[]>(stored?.nodes, []);
  const edges = safeParse<FlowEdge[]>(stored?.edges, []);
  const flow = compileFlow(nodes, edges);

  const book = playbook(orgId);
  const transfers = transferTargets(orgId);
  const slots = appointmentTypes(orgId);
  const departments = getDb()
    .prepare("SELECT name, keywords FROM departments WHERE org_id=?")
    .all(orgId) as { name: string; keywords: string }[];

  const siblings = (getDb()
    .prepare(
      "SELECT id, name, intent, prompt FROM agents WHERE org_id=? AND id!=? AND status!='paused' ORDER BY name",
    )
    .all(orgId, agentId) as { id: string; name: string; intent: string; prompt: string | null }[]);

  const workspace = [
    book.businessType ? `BUSINESS: ${book.businessType}` : "",
    book.hours ? `HOURS: ${book.hours}` : "",
    book.transferPolicy ? `TRANSFER POLICY: ${book.transferPolicy}` : "",
    book.bookingPolicy ? `BOOKING POLICY: ${book.bookingPolicy}` : "",
    departments.length
      ? `DEPARTMENTS that own follow-up: ${departments.map((d) => d.name).join(", ")}.`
      : "",
    transfers.length
      ? [
          "HUMAN TRANSFER TARGETS — the only humans you may offer. Call transfer_to_human with their name.",
          ...transfers.map(
            (t) =>
              `- ${t.name} (${t.role}, ${t.phone}${t.hours ? `, ${t.hours}` : ""}): ${t.whenToUse}`,
          ),
        ].join("\n")
      : "HUMAN TRANSFER: no desk is configured. Do not offer a person. Take a callback number.",
    slots.length
      ? [
          "APPOINTMENT TYPES you may book — never invent a type or a time outside these hours:",
          ...slots.map(
            (s) =>
              `- ${s.name}: ${s.durationMin} min${s.hours ? `, ${s.hours}` : ""}${s.location ? `, ${s.location}` : ""}${s.notes ? `. ${s.notes}` : ""}`,
          ),
        ].join("\n")
      : "",
    siblings.length
      ? [
          "OTHER AGENTS — specialist lines on this workspace. If the caller's need matches one, call transfer_to_agent. They keep their own knowledge base. You do not answer for them.",
          ...siblings.map(
            (a) =>
              `- ${a.name} (id ${a.id}, ${a.intent}): ${(a.prompt ?? "").slice(0, 180) || a.intent}`,
          ),
        ].join("\n")
      : "OTHER AGENTS: none. Handle what you can; take a callback for the rest.",
  ]
    .filter(Boolean)
    .join("\n\n");

  return {
    name: stored?.name ?? builtin?.name ?? "Agent",
    greeting: builtin?.greeting ?? `${persona} speaking. How can I help?`,
    intent: stored?.intent ?? builtinIntent(agentId),
    systemInstruction: [
      `Your name on this call is ${persona}. Introduce yourself as ${persona}.`,
      voiceBlock,
      builtin ? "" : callFoundation(),
      flow,
      role,
      workspace,
      languageDirective(),
    ]
      .filter(Boolean)
      .join("\n\n"),
  };
}

function swaraSetupPrompt(orgId: string, voiceName?: string) {
  const catalog = voiceByName(voiceName);
  const saved = orgVoices(orgId).find((v) => v.liveName === catalog.name);
  const persona = saved?.personaName || catalog.personaName;
  const book = playbook(orgId);
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const coach = require("./setup-coach") as typeof import("./setup-coach");
  const chat = coach.loadChat(orgId);
  const factBlock = chat.facts.length
    ? ["FACTS ALREADY SAVED — do not re-ask these unless they contradict:", ...chat.facts.map((f) => `- ${f.topic}: ${f.answer}`)].join("\n")
    : "No facts saved yet.";
  const planBlock = chat.plan
    ? `DRAFT PLAN (not created until they say yes and you call apply_setup_plan):\n${chat.plan.summary}\nAgents: ${chat.plan.agents.map((a) => a.name).join(", ")}`
    : "";
  return {
    name: "Swara",
    greeting: `Namaste, main ${persona} hoon. Tell me what this line should do for your callers — I'll set the agents up.`,
    intent: "other",
    systemInstruction: [
      `Your name is ${persona}. You are Swara, the setup coach for this workspace, not a customer-facing agent.`,
      saved?.promptTemplate || voiceCraft(voiceName),
      callFoundation(),
      `SETUP MODE. Interview the business owner to design their voice agents.`,
      `Ask one sharp question at a time. Probe edge cases. Clinic: multiple bookings, treatments offered, what to ignore (diagnosis, prescriptions). Shop: no order ID, split orders vs complaints vs delivery. Always ask who takes a furious caller, which departments own follow-up, what is usually asked.`,
      `Push for specialised agents instead of one mega-bot. A front desk that transfers is better than one agent that pretends to know everything — each specialist keeps its own knowledge base.`,
      `When you learn a fact, call note_setup_answer. When they agree a plan, call apply_setup_plan. Never claim you created agents until that tool returns applied: true.`,
      `If they come back later, use the saved facts. If they add a new department or treatment, save it and offer to apply again.`,
      book.businessType ? `Playbook so far: ${book.businessType}. ${book.hours}` : "Business type not set yet.",
      factBlock,
      planBlock,
      languageDirective(),
    ]
      .filter(Boolean)
      .join("\n\n"),
  };
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

function safeParse<T>(raw: string | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
