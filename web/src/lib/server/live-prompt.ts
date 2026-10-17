import "server-only";
import { getDb } from "./db";
import { agentPrompt } from "@/lib/live/prompts";
import { languageDirective } from "@/lib/live/config";
import { recordingDirective } from "@/lib/live/recording";
import { lookupTickets, staffCallbackBlock } from "@/lib/server/tickets";
import { VOICE_PREVIEW_AGENT_ID, voiceByName, voiceCraft } from "@/lib/live/voices";
import { compileFlow } from "@/lib/agents/flow";
import { NAME_PLACEHOLDER, defaultVoiceFor, guessGender, toolsForRole } from "@/lib/agents/role";
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
  /** True for a Voice Studio sample: one spoken line, no call row, no consent. */
  preview?: boolean;
};

export function composeLivePrompt(
  orgId: string,
  agentId: string,
  voiceName?: string,
  extras?: { fromNumber?: string; briefing?: string },
): ComposedPrompt {
  if (agentId === SWARA_AGENT_ID) return composeSwara(orgId);
  if (agentId === VOICE_PREVIEW_AGENT_ID) return composeVoicePreview(orgId, voiceName);

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
  const rawRole = stripToolDump(stored?.prompt) || builtin?.role || defaultRole(stored?.name ?? "this line");

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
  // Roles are written with "{name}" where the agent says its own name, so a
  // rename or a voice change never means rewriting the role.
  const role = rawRole.split(NAME_PLACEHOLDER).join(persona);

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
  const hasCustomRole = Boolean(stored?.prompt?.trim() || builtin?.role);
  const flow = compileFlow(nodes, edges, {
    agents: siblings,
    allowTransfer: transfers.length > 0,
    concise: hasCustomRole,
  });

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
      ? `DEPARTMENTS that own follow-up: ${departments.map((d) => d.name).join(", ")}.`
      : "",
    transfers.length
      ? [
          "TRANSFER TARGETS — the only human colleagues/desks you may transfer a call to:",
          ...transfers.map(
            (t) =>
              `- ${t.name} (${t.role}${t.department ? `, ${t.department}` : ""}${t.hours ? `, ${t.hours}` : ""}): ${t.whenToUse}`,
          ),
        ].join("\n")
      : "TRANSFER: no human desk is configured. Do not offer a live transfer; take a callback instead.",
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
          "AGENT DIRECTORY — other specialist agents of this business you may hand a caller to (use the exact name):",
          ...directory.map((s) => `- ${s.name}: ${agentSummary(s.prompt, s.intent)}`),
        ].join("\n")
      : "HANDOFF: you are the only agent. Handle the call here without handing off.",
  ]
    .filter(Boolean)
    .join("\n\n");

  const staffBlock = extras?.fromNumber ? staffCallbackBlock(orgId, extras.fromNumber) : "";
  const isStaffCaller = Boolean(staffBlock);

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
  // When a designated person or department desk calls in (or is called),
  // ensure ticket inspection, update, and resolution tools are always active.
  const staffTools = isStaffCaller ? ["lookup_ticket", "update_ticket", "resolve_ticket"] : [];
  const tools = [...new Set([...baseTools, ...flowTools, ...staffTools, "end_call"])].filter((t) =>
    t === "transfer_to_human" ? transfers.length > 0 : t === "handoff_to_agent" ? directory.length > 0 : true,
  );

  const greetingText = (builtin?.greeting ?? `${persona} speaking. How can I help?`)
    .split(NAME_PLACEHOLDER)
    .join(persona);

  return {
    name: stored?.name ?? builtin?.name ?? "Agent",
    greeting: greetingText,
    intent: stored?.intent ?? builtinIntent(agentId),
    voice: catalog.name,
    setupTools: false,
    tools,
    systemInstruction: [
      extras?.briefing ? `OUTBOUND BRIEFING (do this job, then offer to take questions):\n${extras.briefing}` : "",
      staffBlock,
      !isStaffCaller && extras?.fromNumber ? callerBlock(orgId, extras.fromNumber) : "",
      `Your name on this call is ${persona}${book.businessType ? `, from ${book.businessType}` : ""}.`,
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
 * Everything that is true of every call, said once, here — not in each
 * agent's role. Short on purpose: the model knows how to hold a
 * conversation, and the things worth spelling out are the ones a phone
 * agent gets wrong in ways that cost a customer.
 */
const CONVERSATION_RULES = [
  "VOICE CONVERSATION",
  "You are speaking live on a phone call, not writing text or chat. Keep your turns conversational and concise (one or two sentences), listen before collecting details, and never ask for something the caller already told you.",
  "Sound genuinely human: use natural brief pauses and soft vocal expressions like \"ummm...\", \"ohh...\", \"hmm...\", or \"accha...\" to show empathy, thought, or understanding. Keep your Hindi/Hinglish verb endings strictly matched to your voice's gender.",
  "Never speak internal markers ([CALL_CONNECTED], [CALL_RECONNECTED], [HANDOFF: ...]), JSON keys, tool names, parameter names, or step numbers out loud.",
  "When you receive [HANDOFF: ...], a colleague has just passed this caller to you mid-call: do not repeat the recording disclosure or re-introduce the company from scratch, and never read the summary word-for-word — greet warmly in one short phrase and continue right from where they left off.",
  "Nothing about orders, tickets, slots or reference numbers is true until your tool returns it on this call — never invent or guess one. Read back reference numbers, phone numbers, and booked slots once to confirm.",
  "When the caller's need is handled, check if they need anything else and wait for their answer; once they say no or say goodbye, close warmly in one sentence and end the call.",
].join("\n");

/** Strip any legacy "TOOLS — the only actions you have" block from saved roles. */
function stripToolDump(prompt: string | null | undefined) {
  if (!prompt) return "";
  return prompt.replace(/\n*TOOLS — the only actions you have[\s\S]*$/i, "").trim();
}

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
    `CALLER: they are calling from ${fromNumber}. You already have their number — do not ask for it. If you need a callback number, just confirm whether this number is fine to call back on.`,
    name ? `Your records show this number belongs to ${name}. Use the name naturally; confirm it only if the voice or context suggests someone else.` : "You do not know their name yet. Ask for it only when you need it to file or book something, not as an opener.",
  ];
  if (open.length) {
    lines.push(
      `THEY HAVE CALLED BEFORE. Open tickets from this number:`,
      ...open.map((t) => `  - ${t.ref} · ${t.kind} · "${t.title}" · ${stageWord(t.stage)} · opened ${when(t.openedAt)}${t.department ? ` · with ${t.department}` : ""}`),
      `If they start describing something that sounds like one of these, mention it naturally in their language — tell them ${open[0].ref} is already open from ${when(open[0].openedAt)}, share its status, and ask if this is the same issue or something new. Do not file a duplicate ticket for the same problem; if they want the team nudged, notify the desk on the existing reference.`,
      `Only if they confirm it is a different problem should you file a separate ticket.`,
      `If they ask what happened to their complaint, answer directly from this list without asking them for a reference number.`,
    );
  } else if (closed.length) {
    lines.push(
      `They have called before. Their last ticket ${closed[0].ref} ("${closed[0].title}") is closed, ${when(closed[0].openedAt)}. If they say the same thing happened again, mention the old one briefly and file a fresh ticket.`,
    );
  }
  return lines.join("\n");
}

/**
 * One line on what a sibling agent does, for the handoff directory. Role
 * prompts built by Swara start with a "ROLE —" header followed by the job
 * line; older ones had a "You handle … calls." line first. Hand-written
 * prompts use their first sentence.
 */
export function agentSummary(prompt: string | null, intent: string) {
  const lines = (prompt ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
  const body = lines.find(
    (l) => !/^(ROLE|TONE|HOW|ACTIONS|TOOLS|NEVER)\b/.test(l) && !/^You handle .* calls\./.test(l) && !l.startsWith("-"),
  );
  const sentence = (body ?? "").replace(/\s+You (answer|make|take)[^.]*calls\.$/, "").split(/(?<=\.)\s/)[0].slice(0, 160);
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

/**
 * Voice Studio's "play" button. The voice introduces itself in one breath
 * using the org's persona name and craft for it, says what it is good for,
 * and stops. No tools, no recording line, no call row.
 */
function composeVoicePreview(orgId: string, voiceName: string | undefined): ComposedPrompt {
  const catalog = voiceByName(voiceName);
  const saved = orgVoices(orgId).find((v) => v.liveName === catalog.name);
  const persona = saved?.personaName || catalog.personaName;
  const voiceBlock = (saved?.promptTemplate || voiceCraft(catalog.name)).split(catalog.personaName).join(persona);
  const line = `Hi, this is ${persona}. This will be my voice, and I'll be good for ${catalog.bestFor}.`;

  return {
    name: `${catalog.name} preview`,
    greeting: line,
    intent: "other",
    voice: catalog.name,
    setupTools: false,
    preview: true,
    tools: [],
    systemInstruction: [
      `You are ${persona}, giving a ten-second voice sample to the business owner who is choosing a voice for their phone agent. This is not a call; nobody will answer you.`,
      voiceBlock,
      `When you receive [CALL_CONNECTED], say this, naturally, as one short turn: "${line}" Then add one short, warm Hindi sentence (under eight words) in the same breath so they hear your Hindi — for example "Aap bataiye, main yahin hoon."`,
      "Then stop. Do not ask a question, do not wait for a reply, do not introduce yourself twice, do not mention recording. If you hear anything after that, stay silent.",
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
