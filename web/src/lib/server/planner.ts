import "server-only";
import { GoogleGenAI, Type } from "@google/genai";
import type { AgentPlan, FlowEdge, FlowNode, Intent, PlannedAgent } from "@/lib/api/schemas";
import { IntentSchema } from "@/lib/api/schemas";
import { getDb } from "./db";
import { createAgent, updateAgent } from "./repo";
import { ingestKnowledgeDoc } from "./ai";
import { AGENT_LANGUAGES, FIRST_NAMES, buildRolePrompt, defaultVoiceFor, guessGender, toolsForRole } from "@/lib/agents/role";
import { VOICE_CATALOG } from "@/lib/live/voices";
import { appointmentTypes, playbook, setupStatus, transferTargets } from "./workspace";
import { TEXT_MODELS } from "./models";

/**
 * Swara's planning brain.
 *
 * Input: what the business told us (the playbook, departments, desks,
 * bookable things, knowledge) plus a free-text brief. Output: the set of
 * agents that covers the use case end to end, each with a real flow graph the
 * runtime executes (see lib/agents/flow.ts), and the handoffs between them.
 *
 * Gemini proposes the *shape* — which agents, what each owns, who hands off to
 * whom, what is still unknown. The flows themselves are built here from that
 * shape, deterministically, so every generated graph is one the compiler and
 * the tools can actually run. If the model is down, this throws and leaves
 * whatever plan the owner already has — it does not substitute a template.
 */


type Shape = {
  summary: string;
  questions: string[];
  agents: {
    key: string;
    name: string;
    job: string;
    /** Long role, written by the model. The stored prompt wraps this. */
    role?: string;
    /** Facts only this agent may quote. Empty if the owner gave none. */
    knowledge?: string;
    /** First name the agent introduces itself with. */
    personaName?: string;
    /** Catalog voice name, chosen for the job and the persona's gender. */
    voice?: string;
    intent: Intent;
    direction: "inbound" | "outbound" | "both";
    handsOffTo: string[];
    isFrontDoor: boolean;
  }[];
};

export type PlanContext = {
  orgId: string;
  playbook: ReturnType<typeof playbook>;
  departments: { name: string; keywords: string[] }[];
  transfers: { name: string; role: string }[];
  appointmentTypes: { name: string }[];
  knowledgeDocs: number;
  existingAgents: { id: string; name: string; intent: string }[];
};

export function planContext(orgId: string): PlanContext {
  const d = getDb();
  return {
    orgId,
    playbook: playbook(orgId),
    departments: (d.prepare("SELECT name, keywords FROM departments WHERE org_id=?").all(orgId) as {
      name: string;
      keywords: string;
    }[]).map((r) => ({ name: r.name, keywords: JSON.parse(r.keywords || "[]") as string[] })),
    transfers: transferTargets(orgId).map((t) => ({ name: t.name, role: t.role })),
    appointmentTypes: appointmentTypes(orgId).map((a) => ({ name: a.name })),
    knowledgeDocs: setupStatus(orgId).knowledge,
    existingAgents: (d.prepare("SELECT id, name, intent FROM agents WHERE org_id=?").all(orgId) as {
      id: string;
      name: string;
      intent: string;
    }[]),
  };
}

export async function planAgents(
  orgId: string,
  input: { brief: string; answers?: Record<string, string> },
): Promise<AgentPlan> {
  const ctx = planContext(orgId);
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("Swara needs a Gemini API key. Nothing was changed.");
  }
  const brief = [input.brief, ...Object.entries(input.answers ?? {}).map(([q, a]) => `Q: ${q}\nA: ${a}`)]
    .filter(Boolean)
    .join("\n\n");

  // A sentence in the brief beats a leftover desk. "We have no human agents"
  // must not produce a transfer step, even if an old desk row is still stored.
  if (ctx.playbook.extra.humanEscalation === false || ownerSaidNoHumans(`${brief}\n${ctx.playbook.transferPolicy}`)) {
    ctx.playbook.extra.humanEscalation = false;
    ctx.transfers = [];
  }

  const shape = await geminiShape(brief, ctx);
  if (!shape) {
    throw new Error(
      "Swara's model is unavailable right now. Your current plan was not replaced — retry.",
    );
  }
  const source = shape.source;
  const agents = materialise(shape, ctx);

  const gaps: string[] = [];
  if (agents.some((a) => a.needs.includes("transfers")) && ctx.transfers.length === 0 && ctx.playbook.extra.humanEscalation !== false) {
    gaps.push("No human transfer desk yet — transfer steps will take callbacks until one is added.");
  }
  if (agents.some((a) => a.needs.includes("appointments")) && ctx.appointmentTypes.length === 0) {
    gaps.push("No appointment types yet — the booking agent cannot offer slots.");
  }
  if (ctx.knowledgeDocs === 0) gaps.push("No knowledge documents — agents will say they don't know policies rather than guess.");
  if (agents.some((a) => a.intent === "order_status")) {
    const hasConnector = (getDb()
      .prepare("SELECT COUNT(*) n FROM connectors WHERE org_id=? AND tool='lookup_order'")
      .get(orgId) as { n: number }).n;
    if (!hasConnector) gaps.push("No order system connected — order lookups will use the demo connector.");
  }

  return {
    brief,
    summary: shape.summary,
    questions: shape.questions.slice(0, 3),
    gaps,
    agents,
    source,
  };
}

/* ── Gemini ───────────────────────────────────────────────────────────────── */

async function geminiShape(brief: string, ctx: PlanContext): Promise<(Shape & { source: "gemini" }) | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  const ai = new GoogleGenAI({ apiKey });

  const context = [
    `BUSINESS: ${ctx.playbook.businessType || "(not described yet)"}`,
    `USE CASE: ${String(ctx.playbook.extra.useCase ?? "other")}`,
    `HOURS: ${ctx.playbook.hours || "(unknown)"}`,
    `OUTBOUND SALES WANTED: ${ctx.playbook.extra.hasSales ? "yes" : "no/unknown"}`,
    `HUMAN ESCALATION AVAILABLE: ${ctx.playbook.extra.humanEscalation === false ? "no" : ctx.transfers.length ? "yes" : "unknown"}`,
    `DEPARTMENTS: ${ctx.departments.map((d) => d.name).join(", ") || "none"}`,
    `TRANSFER DESKS: ${ctx.transfers.map((t) => `${t.name} (${t.role})`).join(", ") || "none"}`,
    `BOOKABLE: ${ctx.appointmentTypes.map((a) => a.name).join(", ") || "none"}`,
    `KNOWLEDGE DOCS: ${ctx.knowledgeDocs}`,
    `EXISTING AGENTS: ${ctx.existingAgents.map((a) => a.name).join(", ") || "none"}`,
    `VOICES AVAILABLE: ${VOICE_CATALOG.map((v) => `${v.name} (${v.gender}, ${v.descriptor})`).join("; ")}`,
  ].join("\n");

  for (const model of TEXT_MODELS) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents: [
          "You are Swara, an implementation engineer designing AI voice agents for an Indian business.",
          "Design the smallest set of agents that handles this business's calls end to end.",
          "Rules:",
          "- One agent per distinct job (order status, complaints/refunds, bookings, sales follow-up, reminders). Do not merge angry-caller work with sales.",
          "- If there are 3+ inbound agents, add one 'front door' agent (intent other, inbound, isFrontDoor true) whose only job is to greet and hand off.",
          "- handsOffTo lists the keys of other agents in THIS plan the agent may pass a caller to.",
          "- Outbound agents (reminders, lead follow-up, collections) are direction outbound and are never front door.",
          "- questions: at most 3 things you would still ask the owner before going live. Empty if the brief is clear.",
          "- job: one sentence, the job title in prose.",
          "- personaName: the first name this agent uses on the call. If the brief says 'introduces itself as X' or names the agent after a person (e.g. 'Aarav'), use exactly that. Otherwise pick a common Indian first name that fits the voice's gender. Two agents in one plan must not share a name.",
          "- voice: one of VOICES AVAILABLE, by name. If the brief names a voice for the agent, use it. Otherwise: complaints and grievances get a calm or soft voice; sales and reminders get a brighter one; a front door gets a crisp one. The gender must match personaName.",
          "- role: 10-16 sentences written as a senior trainer briefing a new hire for THIS job at THIS business. Cover, in order: (1) the one-sentence opening line — name, business, then an open question or the reason for calling; (2) how to find out what the caller wants: listen, let them finish, one open question if unclear; (3) the details this job actually needs, and the moment each is asked for — never name and phone as an opener, and never a phone number on an inbound call since you already have it; (4) the three most common situations for this job at this business and what to do in each; (5) what to say when you do not have the answer; (6) how to close. Write it as instructions to the agent, in plain speech. No headings, no bullet points.",
          "- A realistic agent listens more than it asks, never asks for what it was already told, and never asks two things in one turn. Say this in the role in the agent's own terms.",
          "- knowledge: only facts the owner actually gave that THIS agent must quote (policy, fees, hours, what to say). Empty string if none. Do not invent prices or policies. Do not copy another agent's facts into this one.",
          "- If HUMAN ESCALATION is no, or there is no transfer desk, no agent may transfer to a person. They take a callback instead.",
          "- Every agent follows the caller's language automatically. Do not assign a single language.",
          "- Prefer Indian context: Hinglish callers, COD, DND rules for outbound.",
          "",
          "WORKSPACE:",
          context,
          "",
          "OWNER'S BRIEF:",
          brief || "(none — infer from the workspace)",
        ].join("\n"),
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              summary: { type: Type.STRING },
              questions: { type: Type.ARRAY, items: { type: Type.STRING } },
              agents: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    key: { type: Type.STRING },
                    name: { type: Type.STRING },
                    job: { type: Type.STRING },
                    role: { type: Type.STRING },
                    knowledge: { type: Type.STRING },
                    personaName: { type: Type.STRING },
                    voice: { type: Type.STRING, enum: VOICE_CATALOG.map((v) => v.name) },
                    intent: { type: Type.STRING, enum: [...IntentSchema.options] },
                    direction: { type: Type.STRING, enum: ["inbound", "outbound", "both"] },
                    handsOffTo: { type: Type.ARRAY, items: { type: Type.STRING } },
                    isFrontDoor: { type: Type.BOOLEAN },
                  },
                  required: ["key", "name", "job", "role", "knowledge", "personaName", "voice", "intent", "direction", "handsOffTo", "isFrontDoor"],
                },
              },
            },
            required: ["summary", "questions", "agents"],
          },
        },
      });
      const parsed = JSON.parse(response.text ?? "{}") as Shape;
      if (!Array.isArray(parsed.agents) || parsed.agents.length === 0) continue;
      const keys = new Set(parsed.agents.map((a) => a.key));
      return {
        source: "gemini",
        summary: parsed.summary ?? "",
        questions: parsed.questions ?? [],
        agents: parsed.agents.slice(0, 8).map((a) => ({
          ...a,
          intent: IntentSchema.options.includes(a.intent) ? a.intent : "other",
          handsOffTo: (a.handsOffTo ?? []).filter((k) => keys.has(k) && k !== a.key),
        })),
      };
    } catch (error) {
      console.error(`[planner] ${model} failed:`, String(error).slice(0, 200));
    }
  }
  return null;
}

/* ── Flow construction ────────────────────────────────────────────────────── */

let seq = 0;
const nid = (p: string) => `${p}_${(++seq).toString(36)}`;

function node(kind: FlowNode["kind"], title: string, x: number, y: number, config: Record<string, unknown> = {}, detail?: string): FlowNode {
  return { id: nid(kind.slice(0, 2)), kind, title, detail, x, y, config };
}
function edge(from: FlowNode, to: FlowNode, label?: string, tone: FlowEdge["tone"] = "default"): FlowEdge {
  return { id: nid("e"), from: from.id, to: to.id, label, tone };
}

/**
 * Builds a runnable graph for one planned agent. Every graph ends in an End,
 * a callback. A transfer node is added only when a desk exists and the owner
 * has not ruled humans out. Bookings only when there is a type.
 */
function buildFlow(
  spec: Shape["agents"][number],
  ctx: PlanContext,
  handoffKeysToNames: Map<string, string>,
): { nodes: FlowNode[]; edges: FlowEdge[]; needs: string[] } {
  const nodes: FlowNode[] = [];
  const edges: FlowEdge[] = [];
  const needs = new Set<string>();
  const canTransfer = ctx.playbook.extra.humanEscalation !== false && ctx.transfers.length > 0;
  const desk = canTransfer ? ctx.transfers[0]?.name : undefined;
  const handoffs = spec.handsOffTo.map((k) => ({ key: k, name: handoffKeysToNames.get(k) ?? k }));

  const start = node("start", spec.direction === "outbound" ? "Introduce + ask for two minutes" : "Greet", 40, 40, {
    script: "",
  }, "Follows the caller's language");
  nodes.push(start);

  const end = node("end", "Close and hang up", 820, 260, { hangUp: true, script: "" });
  const human = canTransfer
    ? node("escalate", desk ? `Transfer to ${desk}` : "Transfer to human", 820, 60, desk ? { transferTarget: desk } : {})
    : node("collect", "No human available — take a callback", 820, 60, {
        fields: ["name, if you do not have it", "confirm the number they are calling from is fine for a callback"],
        note: "Say plainly that nobody is free to take the call. Do not offer a transfer or name a person.",
      });
  let humanAdded = false;
  const attachHuman = (from: FlowNode, label: string) => {
    if (!humanAdded) {
      nodes.push(human);
      if (!canTransfer) edges.push(edge(human, end));
      if (canTransfer) needs.add("transfers");
      humanAdded = true;
    }
    edges.push(edge(from, human, label, canTransfer ? "danger" : "default"));
  };

  if (spec.isFrontDoor) {
    const intent = node("intent", "What does the caller need?", 300, 40, {
      options: handoffs.map((h) => h.name),
    });
    nodes.push(intent);
    edges.push(edge(start, intent));
    handoffs.forEach((h, i) => {
      const ho = node("handoff", `Hand off → ${h.name}`, 560, 40 + i * 110, { agentKey: h.key });
      nodes.push(ho);
      edges.push(edge(intent, ho, h.name.toLowerCase()));
    });
    const fallback = node("collect", "Take a callback", 560, 40 + handoffs.length * 110, { fields: ["what it is about", "name", "confirm the number they are calling from"] });
    nodes.push(fallback, end);
    edges.push(edge(intent, fallback, "anything else"), edge(fallback, end));
    attachHuman(intent, "asks for a person");
    return { nodes, edges, needs: [...needs] };
  }

  switch (spec.intent) {
    case "order_status": {
      needs.add("orders");
      const collect = node("collect", "Order ID, or use their number", 300, 40, {
        fields: ["order ID — or the phone number they are calling from, without asking for it"],
      });
      const pull = node("data_pull", "Look up the order", 300, 200, { tool: "lookup_order" });
      const branch = node("branch", "Found / late / dispute", 560, 200);
      const say = node("say", "Status, then the date", 820, 160, { script: "" });
      nodes.push(collect, pull, branch, say, end);
      edges.push(edge(start, collect), edge(collect, pull), edge(pull, branch), edge(branch, say, "found", "success"), edge(say, end));
      const notFound = node("collect", "Take callback for missing order", 560, 340, { fields: ["name", "confirm the number to call back on"] });
      nodes.push(notFound);
      edges.push(edge(branch, notFound, "not found"), edge(notFound, end));
      attachHuman(branch, "payment dispute");
      break;
    }
    case "complaint": {
      needs.add("departments");
      const intent = node("intent", "Complaint, refund, or enquiry", 300, 40);
      const collect = node("collect", "Hear what happened, then name", 300, 200, {
        fields: ["what happened and when — let them tell it fully", "name, only once you are ready to file", "confirm the number they are calling from"],
      });
      const reg = node("data_pull", "Register the complaint", 560, 200, { tool: "register_complaint" });
      const say = node("say", "Read reference number back", 820, 200, { script: "" });
      const kb = node("data_pull", "Check the policy", 560, 40, { tool: "search_knowledge" });
      nodes.push(intent, collect, reg, say, kb, end);
      edges.push(edge(start, intent), edge(intent, collect, "complaint / refund"), edge(collect, reg), edge(reg, say, undefined, "success"), edge(say, end), edge(intent, kb, "policy question"), edge(kb, end));
      attachHuman(intent, "emergency / very angry");
      needs.add("knowledge");
      break;
    }
    case "booking": {
      needs.add("appointments");
      if (spec.direction === "outbound") {
        const confirm = node("branch", "Confirm / reschedule / cancel", 300, 40);
        const book = node("book", "Offer two new slots", 560, 40, { appointmentType: ctx.appointmentTypes[0]?.name });
        const note = node("say", "Confirm and mention SMS", 560, 200, { script: "" });
        nodes.push(confirm, book, note, end);
        edges.push(edge(start, confirm), edge(confirm, book, "reschedule"), edge(confirm, note, "confirmed", "success"), edge(book, end), edge(note, end), edge(confirm, end, "cancel"));
      } else {
        const intent = node("intent", "New / reschedule / cancel", 300, 40);
        const collect = node("collect", "What for, when, then name", 300, 200, { fields: ["what they want booked", "roughly when suits them", "name, just before booking"] });
        const book = node("book", "Offer two slots, confirm", 560, 200, { appointmentType: ctx.appointmentTypes[0]?.name });
        const kb = node("data_pull", "Fees, timings, directions", 560, 40, { tool: "search_knowledge" });
        nodes.push(intent, collect, book, kb, end);
        edges.push(edge(start, intent), edge(intent, collect, "book / reschedule"), edge(collect, book), edge(book, end, undefined, "success"), edge(intent, kb, "question"), edge(kb, end));
        attachHuman(intent, "medical urgency");
      }
      break;
    }
    case "delivery_reschedule": {
      const confirm = node("collect", "Confirm right person", 300, 40, { fields: ["confirm name without reading details aloud"] });
      const say = node("say", "What happened with the delivery", 560, 40, { script: "" });
      const slots = node("book", "Offer two windows", 560, 200, { appointmentType: ctx.appointmentTypes.find((a) => /deliver/i.test(a.name))?.name });
      const addr = node("collect", "Confirm address", 820, 200, { fields: ["address", "landmark"] });
      nodes.push(confirm, say, slots, addr, end);
      edges.push(edge(start, confirm), edge(confirm, say), edge(say, slots), edge(slots, addr), edge(addr, end, "read slot back", "success"), edge(confirm, end, "bad time → callback"));
      needs.add("appointments");
      break;
    }
    case "sales_enquiry": {
      needs.add("knowledge");
      const qualify = node("collect", "Listen: what they need, scale, timeline", 300, 40, {
        fields: ["what they are trying to get done", "what they use today", "scale", "timeline", "who decides"],
        note: "This is a conversation, not a questionnaire — one question, listen, respond to what they said, then the next only if it matters.",
      });
      const kb = node("data_pull", "Answer from knowledge", 300, 200, { tool: "search_knowledge" });
      const next = ctx.appointmentTypes.length
        ? node("book", "Book a demo / callback", 560, 120, { appointmentType: ctx.appointmentTypes.find((a) => /demo|call/i.test(a.name))?.name })
        : node("collect", "Book a specific next step", 560, 120, { fields: ["day and time window for a callback"] });
      nodes.push(qualify, kb, next, end);
      edges.push(edge(start, qualify), edge(qualify, kb, "has questions"), edge(kb, next), edge(qualify, next, "ready"), edge(next, end, undefined, "success"), edge(start, end, "not interested"));
      if (ctx.appointmentTypes.length) needs.add("appointments");
      break;
    }
    case "payment_reminder": {
      const say = node("say", "Order, amount, arrival", 300, 40, { script: "" });
      const branch = node("branch", "Ready / cancel / dispute", 560, 40);
      const note = node("collect", "Note the change", 820, 40, { fields: ["what to change: cancel, prepaid, or dispute"] });
      nodes.push(say, branch, note, end);
      edges.push(edge(start, say), edge(say, branch), edge(branch, end, "will pay", "success"), edge(branch, note, "cancel / prepaid / dispute"), edge(note, end));
      break;
    }
    default: {
      const intent = node("intent", "What does the caller need?", 300, 40);
      const kb = node("data_pull", "Search knowledge", 560, 40, { tool: "search_knowledge" });
      const cb = node("collect", "Take a callback", 560, 200, { fields: ["what it is about", "name", "confirm the number they are calling from"] });
      nodes.push(intent, kb, cb, end);
      edges.push(edge(start, intent), edge(intent, kb, "question"), edge(kb, end), edge(intent, cb, "needs a person"), edge(cb, end));
      needs.add("knowledge");
      attachHuman(intent, "asks for a person");
    }
  }

  // Handoffs to sibling agents hang off the first decision node, so a caller
  // who asked the wrong agent still lands in the right place.
  const decision = nodes.find((n) => n.kind === "intent" || n.kind === "branch") ?? start;
  handoffs.forEach((h, i) => {
    const ho = node("handoff", `Hand off → ${h.name}`, 820, 380 + i * 90, { agentKey: h.key });
    nodes.push(ho);
    edges.push(edge(decision, ho, `about ${h.name.toLowerCase()}`));
  });

  return { nodes, edges, needs: [...needs] };
}

function ownerSaidNoHumans(text: string) {
  return /\b(no human agents?|no humans?|no staff|nobody(?: is| to)?(?: available| there)?|no one(?: is)? available|without (?:a )?human|don'?t have (?:any )?(?:human|staff|agents?)|do not have (?:any )?(?:human|staff)|currently no (?:human|staff|agents?)|there are (?:currently )?no (?:human|staff|agents?))\b/i.test(text);
}

function materialise(shape: Shape, ctx: PlanContext): PlannedAgent[] {
  const names = new Map(shape.agents.map((a) => [a.key, a.name]));
  const canTransfer = ctx.playbook.extra.humanEscalation !== false && ctx.transfers.length > 0;
  const canBook = ctx.appointmentTypes.length > 0;
  const usedNames = new Set<string>();
  return shape.agents.map((a) => {
    const flow = buildFlow(a, ctx, names);
    const tools = toolsForRole({
      intent: a.intent,
      isFrontDoor: a.isFrontDoor,
      canTransfer,
      canHandoff: a.handsOffTo.length > 0,
      canBook,
    });
    const knowledge = (a.knowledge ?? "").trim();
    // An owner-given name ("Aarav") decides the voice's gender when the model
    // did not pick a voice; otherwise the voice decides the name's gender.
    const givenName = (a.personaName ?? "").trim() || (/^[A-Z][a-z]{2,}$/.test(a.name.trim()) ? a.name.trim() : "");
    const chosenVoice = VOICE_CATALOG.find((v) => v.name === a.voice);
    const voice =
      chosenVoice && (!guessGender(givenName) || chosenVoice.gender === guessGender(givenName))
        ? chosenVoice.name
        : defaultVoiceFor(a.intent, a.isFrontDoor, guessGender(givenName));
    const personaName = pickPersonaName(a.personaName, a.name, voice, usedNames);
    return {
      key: a.key,
      name: a.name,
      job: a.job,
      intent: a.intent,
      direction: a.direction,
      handsOffTo: a.handsOffTo,
      isFrontDoor: a.isFrontDoor,
      needs: flow.needs,
      nodes: flow.nodes,
      edges: flow.edges,
      tools,
      knowledge,
      personaName,
      voice,
      prompt: buildRolePrompt({
        name: a.name,
        job: a.job,
        role: a.role,
        intent: a.intent,
        isFrontDoor: a.isFrontDoor,
        direction: a.direction,
        canTransfer,
        tools,
      }),
    };
  });
}

/**
 * The model's pick, unless it is empty or a repeat; an agent named after a
 * person keeps that name; otherwise the next unused first name for the
 * voice's gender.
 */
function pickPersonaName(proposed: string | undefined, agentName: string, voice: string, used: Set<string>) {
  const gender = VOICE_CATALOG.find((v) => v.name === voice)?.gender ?? "neutral";
  const clean = (proposed ?? "").trim().split(/\s+/)[0]?.replace(/[^A-Za-z]/g, "") ?? "";
  const fromAgent = /^[A-Z][a-z]{2,}$/.test(agentName.trim()) ? agentName.trim() : "";
  const candidates = [clean, fromAgent, ...FIRST_NAMES[gender], ...FIRST_NAMES.neutral].filter(Boolean);
  const pick = candidates.find((n) => !used.has(n.toLowerCase())) ?? clean ?? "Riya";
  used.add(pick.toLowerCase());
  return pick;
}

/* ── Apply ────────────────────────────────────────────────────────────────── */

/**
 * Creates the agents. Two passes: handoff nodes reference sibling agents by
 * plan key, and the sibling's id does not exist until it is inserted.
 */
export async function applyPlan(orgId: string, plan: Pick<AgentPlan, "agents">) {
  const ids = new Map<string, string>();
  for (const a of plan.agents) {
    const id = createAgent(orgId, {
      name: a.name,
      intent: a.intent,
      direction: a.direction,
      prompt: a.prompt,
      tools: a.tools,
      voice: a.voice || undefined,
      personaName: a.personaName || undefined,
      languages: [...AGENT_LANGUAGES],
      nodes: [],
      edges: [],
    });
    ids.set(a.key, id);
    // Only real facts the owner gave. A filler "this agent does X" note is
    // worse than nothing: search_knowledge returns it for every query and
    // the agent reads it out instead of saying it does not know.
    const knowledge = (a.knowledge ?? "").trim();
    if (knowledge.length >= 20) {
      try {
        await ingestKnowledgeDoc(orgId, `${a.name} — what this agent may say`, "text", knowledge, id);
      } catch (error) {
        console.error(`[planner] knowledge for ${a.name} failed:`, String(error).slice(0, 200));
      }
    }
  }
  for (const a of plan.agents) {
    const nodes = a.nodes.map((n) => {
      if (n.kind !== "handoff") return n;
      const key = String((n.config as { agentKey?: string }).agentKey ?? "");
      const { agentKey: _drop, ...rest } = n.config as Record<string, unknown>;
      void _drop;
      return { ...n, config: { ...rest, agentId: ids.get(key) ?? (rest.agentId as string | undefined) } };
    });
    updateAgent(orgId, ids.get(a.key)!, { nodes, edges: a.edges });
  }
  return plan.agents.map((a) => ({ key: a.key, id: ids.get(a.key)!, name: a.name }));
}
