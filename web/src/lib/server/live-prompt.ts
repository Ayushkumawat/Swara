import "server-only";
import { getDb } from "./db";
import { agentPrompt } from "@/lib/live/prompts";
import { languageDirective } from "@/lib/live/config";
import { recordingDirective } from "@/lib/live/recording";
import { lookupTickets, staffCallbackBlock } from "@/lib/server/tickets";
import { voiceByName, voiceCraft } from "@/lib/live/voices";
import { compileFlow } from "@/lib/agents/flow";
import { defaultVoiceFor, guessGender, toolsForRole } from "@/lib/agents/role";
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
  /** Call tools this agent may use. Setup sessions ignore this. */
  tools: string[];
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
    .prepare(
      `SELECT a.*, v.live_name voice_live_name FROM agents a
       LEFT JOIN voices v ON v.id=a.voice_id AND v.org_id=a.org_id
       WHERE a.id=? AND a.org_id=?`,
    )
    .get(agentId, orgId) as
    | {
        name: string;
        prompt: string | null;
        intent: string;
        nodes: string;
        edges: string;
        voice_id: string | null;
        voice_live_name: string | null;
        persona_name: string | null;
        tools: string | null;
      }
    | undefined;

  const builtin = agentPrompt(agentId);
  const role = stored?.prompt || builtin?.systemInstruction || defaultRole(stored?.name ?? "this line");

  // Who the agent says it is. The owner's choice first; an agent that was
  // simply named after a person ("Aarav") uses that; only then the voice's
  // stock persona (below).
  const givenPersona =
    stored?.persona_name?.trim() ||
    (stored?.name && looksLikePersonName(stored.name) ? stored.name.trim() : "");

  // Voice: what the caller picked in the test panel wins; otherwise the voice
  // saved on the agent; otherwise a default for the job — matched to the
  // persona's gender so "Priya" is not read in a man's template. Phone calls
  // never pass one, so the saved voice is what a real caller hears.
  const catalog = voiceByName(
    voiceName ||
      stored?.voice_live_name ||
      defaultVoiceFor(stored?.intent ?? "other", false, guessGender(givenPersona)),
  );
  const saved = orgVoices(orgId).find((v) => v.liveName === catalog.name);
  const voiceDefaultName = saved?.personaName || catalog.personaName;
  const persona = givenPersona || voiceDefaultName;
  // The voice template is written around its stock name; swap it out —
  // otherwise "Aarav" introduces itself as Arjun.
  const voiceBlock = (saved?.promptTemplate || voiceCraft(catalog.name))
    .split(voiceDefaultName)
    .join(persona);

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
  const flow = compileFlow(nodes, edges, { agents: siblings, allowTransfer: transfers.length > 0 });

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
          ...directory.map((s) => `- ${s.name}: ${agentSummary(s.prompt, s.intent)}`),
        ].join("\n")
      : "HANDOFF: you are the only agent. Do not call handoff_to_agent.",
  ]
    .filter(Boolean)
    .join("\n\n");

  const storedTools = safeJson<string[]>(stored?.tools ?? undefined, []);
  const baseTools = storedTools.length
    ? storedTools
    : toolsForRole({
        intent: stored?.intent ?? "other",
        isFrontDoor: nodes.some((n) => n.kind === "handoff") && stored?.intent === "other",
        canTransfer: transfers.length > 0,
        canHandoff: directory.length > 0,
        canBook: slots.length > 0,
      });
  // Whatever the flow graph names must be callable, or a step the owner drew
  // ("Look it up" → search_knowledge) silently does nothing on the call.
  const flowTools = nodes.flatMap((n) => {
    const cfg = n.config as { tool?: string } | undefined;
    if (n.kind === "data_pull") return cfg?.tool ? [cfg.tool] : [];
    if (n.kind === "book") return ["book_slot"];
    if (n.kind === "handoff") return ["handoff_to_agent"];
    if (n.kind === "escalate") return ["transfer_to_human"];
    if (n.kind === "end") return ["end_call"];
    return [];
  });
  const tools = [...new Set([...baseTools, ...flowTools, "end_call"])].filter((t) =>
    t === "transfer_to_human" ? transfers.length > 0 : t === "handoff_to_agent" ? directory.length > 0 : true,
  );

  return {
    name: stored?.name ?? builtin?.name ?? "Agent",
    greeting: builtin?.greeting ?? `${persona} speaking. How can I help?`,
    intent: stored?.intent ?? builtinIntent(agentId),
    voice: catalog.name,
    setupTools: false,
    tools,
    systemInstruction: [
      extras?.briefing ? `OUTBOUND BRIEFING (do this job, then offer to take questions):\n${extras.briefing}` : "",
      extras?.fromNumber ? staffCallbackBlock(orgId, extras.fromNumber) : "",
      extras?.fromNumber ? callerBlock(orgId, extras.fromNumber) : "",
      `Your name on this call is ${persona}${book.businessType ? `, from ${book.businessType}` : ""}. Introduce yourself as ${persona}, once. If any instruction below uses a different first name, it means you.`,
      voiceBlock,
      role,
      CONVERSATION_RULES,
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
 * The difference between an agent and a form. Every stored agent gets this
 * after its role, because the failure the owner hears first is "it kept
 * asking for my name and number and never understood what I wanted".
 */
const CONVERSATION_RULES = [
  "HOW A REAL CALL GOES",
  "Listen first. Let the caller finish. Your first job is to understand what they want, in their words — not to collect details.",
  "Answer the thing they actually asked before you ask anything back. If you can act with what you already have, act.",
  "One question per turn. Never two.",
  "Never ask for something the caller already told you. If they gave a name, use it. If they gave an order number, use it. Asking again tells them you were not listening.",
  "Ask for a detail only at the moment you need it, and say why in a few words: \"complaint file karne ke liye aapka naam?\"",
  "If you did not catch something, say so and ask them to repeat that one thing. Do not repeat your previous sentence word for word, and do not guess.",
  "Do not re-introduce yourself, do not repeat the recording line, do not restart the greeting mid-call.",
  "If the caller goes quiet, wait a moment, then ask one short check-in. If they repeat themselves, they think you did not get it — confirm what you understood in one line, then move.",
  "Reflect back only numbers, spellings and slots — once. Everything else, just carry on.",
  "",
  "ENDING THE CALL — two separate turns, always",
  "When the matter is handled, ask ONE short question: \"aur kuch help chahiye?\" / \"anything else I can do?\" — then STOP TALKING and wait for the answer.",
  "Only after they say no, or say bye, do you speak the closing line — one warm sentence, then call end_call.",
  "Never put the question and the goodbye in the same breath. \"Anything else? Thank you for calling\" is the single worst thing you can say: it asks and hangs up on them at once.",
  "If they say yes or start a new topic, there is no goodbye — you carry on.",
  "",
  "TOOLS ARE THE ONLY TRUTH",
  "You know nothing about tickets, orders, slots or reference numbers except what a tool returned on this call.",
  "Saying 'I have registered your complaint' or reading out a reference number before register_complaint returned registered:true is lying to the caller. Call the tool first, in silence if you like (\"ek second…\"), then tell them.",
  "Never invent, round, or 'example' a number. If a tool did not give it, you do not have it.",
  "If a tool fails or says not found, tell the caller plainly and offer the next honest step — file it now, or have the team call back.",
].join("\n");

/** What we already know about the person on the line, so the agent does not ask for it — including the tickets they already have open. */
function callerBlock(orgId: string, fromNumber: string) {
  const digits = fromNumber.replace(/\D/g, "");
  if (digits.length < 10) return "";
  const known = getDb()
    .prepare("SELECT name FROM customers WHERE org_id=? AND replace(replace(phone,'+',''),' ','') LIKE ?")
    .get(orgId, `%${digits.slice(-10)}`) as { name: string } | undefined;
  const name = known?.name && !/^(unknown|caller|customer)/i.test(known.name) ? known.name : null;

  const since = new Date(Date.now() - 90 * 24 * 3600_000).toISOString();
  const tickets = lookupTickets(orgId, { phone: fromNumber }).filter((t) => t.openedAt >= since).slice(0, 5);
  const open = tickets.filter((t) => t.stage !== "resolved");
  const closed = tickets.filter((t) => t.stage === "resolved");
  const stageWord = (s: string) =>
    s === "in_progress" ? "in progress, the desk is working on it" : s === "escalated" ? "escalated" : s === "resolved" ? "closed" : "open, waiting to be picked up";
  const when = (iso: string) => {
    const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
    return days <= 0 ? "today" : days === 1 ? "yesterday" : `${days} days ago`;
  };

  const lines = [
    `CALLER: they are calling from ${fromNumber}. You already have their number — do not ask for it. If you need a callback number, ask only "is this number fine to call back on?"`,
    name ? `Your records show this number belongs to ${name}. Use the name naturally; confirm it only if the voice or context suggests someone else.` : "You do not know their name yet. Ask for it only when you need it to file or book something, not as an opener.",
  ];
  if (open.length) {
    lines.push(
      `THEY HAVE CALLED BEFORE. Open tickets from this number:`,
      ...open.map((t) => `  - ${t.ref} · ${t.kind} · "${t.title}" · ${stageWord(t.stage)} · opened ${when(t.openedAt)}${t.department ? ` · with ${t.department}` : ""}`),
      `If they start describing something that sounds like one of these, say so before anything else — in their language, something like: "you already filed ${open[0].ref} about this ${when(open[0].openedAt)} — is this the same thing, or something new?" Give them the status. Do not file a second ticket for the same problem — if they want it pushed, use notify_stakeholder on the existing reference.`,
      `If it is genuinely a different problem, file it normally (register_complaint with confirm_new true). One person can have several tickets for different things; the same problem gets one.`,
      `If they ask "what happened to my complaint" you already know — answer from this list, do not ask them for a reference number.`,
    );
  } else if (closed.length) {
    lines.push(
      `They have called before. Their last ticket ${closed[0].ref} ("${closed[0].title}") is closed, ${when(closed[0].openedAt)}. If they say the same thing happened again, that is a new ticket — mention the old one in one line and file fresh.`,
    );
  }
  return lines.join("\n");
}

/**
 * One line on what a sibling agent does, for the handoff directory. Role
 * prompts built by Swara start with a "ROLE —" header and a "You handle …"
 * line; the first sentence after those is the job. Hand-written prompts use
 * their first sentence.
 */
function agentSummary(prompt: string | null, intent: string) {
  const lines = (prompt ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
  const start = lines.findIndex((l) => /^You handle .* calls\./.test(l));
  const body = lines.slice(start >= 0 ? start + 1 : 0).find((l) => !/^(ROLE|TONE|HOW|ACTIONS|NEVER)\b/.test(l) && !l.startsWith("-"));
  const sentence = (body ?? "").split(/(?<=\.)\s/)[0].slice(0, 160);
  return sentence || intent.replace(/_/g, " ");
}

/** "Aarav", "Riya Sharma" — yes. "Order status", "Complaints & refunds" — no. */
function looksLikePersonName(name: string) {
  const words = name.trim().split(/\s+/);
  if (words.length === 0 || words.length > 2) return false;
  if (!words.every((w) => /^[A-Z][a-z]+$/.test(w))) return false;
  const jobWords = /^(order|orders|status|complaint|complaints|refund|refunds|booking|bookings|sales|support|delivery|reminder|reminders|payment|payments|front|door|desk|agent|intake|enquiry|enquiries|feedback|survey|lead|leads|collections|helpline|care|service|team|line|reception)$/i;
  return !words.some((w) => jobWords.test(w));
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
    tools: [],
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
