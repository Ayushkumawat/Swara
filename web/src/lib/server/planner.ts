import "server-only";
import { GoogleGenAI, Type } from "@google/genai";
import type { AgentPlan, FlowEdge, FlowNode, Intent, PlannedAgent } from "@/lib/api/schemas";
import { IntentSchema } from "@/lib/api/schemas";
import { getDb } from "./db";
import { createAgent, updateAgent } from "./repo";
import { appointmentTypes, playbook, setupStatus, transferTargets } from "./workspace";

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
 * the tools can actually run. When there is no API key (or the model is down)
 * a rules-based planner produces a sensible plan from the playbook alone, so
 * the wizard never dead-ends.
 */

const TEXT_MODELS = [process.env.GEMINI_TEXT_MODEL ?? "gemini-flash-latest", "gemini-3.6-flash"];

type Shape = {
  summary: string;
  questions: string[];
  agents: {
    key: string;
    name: string;
    job: string;
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
  const brief = [input.brief, ...Object.entries(input.answers ?? {}).map(([q, a]) => `Q: ${q}\nA: ${a}`)]
    .filter(Boolean)
    .join("\n\n");

  const shape = (await geminiShape(brief, ctx)) ?? heuristicShape(brief, ctx);
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
          "- Write job in 2-3 plain sentences: what the agent does on the call and what it must never do.",
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
                    intent: { type: Type.STRING, enum: [...IntentSchema.options] },
                    direction: { type: Type.STRING, enum: ["inbound", "outbound", "both"] },
                    handsOffTo: { type: Type.ARRAY, items: { type: Type.STRING } },
                    isFrontDoor: { type: Type.BOOLEAN },
                  },
                  required: ["key", "name", "job", "intent", "direction", "handsOffTo", "isFrontDoor"],
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

/* ── Rules fallback ───────────────────────────────────────────────────────── */

function heuristicShape(brief: string, ctx: PlanContext): Shape & { source: "heuristic" } {
  const text = `${brief} ${ctx.playbook.businessType}`.toLowerCase();
  const useCase = String(ctx.playbook.extra.useCase ?? "other");
  const has = (...words: string[]) => words.some((w) => text.includes(w));

  const agents: Shape["agents"] = [];
  const add = (a: Shape["agents"][number]) => {
    if (!agents.some((x) => x.key === a.key)) agents.push(a);
  };

  const clinic = useCase === "clinic" || has("clinic", "doctor", "hospital", "patient", "dentist", "appointment");
  const ecommerce = useCase === "ecommerce" || has("order", "delivery", "shipment", "cod", "d2c", "ecommerce", "e-commerce", "store");
  const care = useCase === "customer_care" || has("customer care", "support", "complaint", "refund", "grievance", "helpline");
  const sales = ctx.playbook.extra.hasSales === true || useCase === "sales" || has("sales", "lead", "enquiry", "demo", "quote");
  const civic = useCase === "civic" || has("metro", "municipal", "citizen", "civic", "transport");

  if (clinic || ctx.appointmentTypes.length > 0) {
    add({ key: "booking", name: "Appointment booking", job: "Books, reschedules and cancels appointments. Offers two concrete slots from the configured types, confirms date, time and location, then books. Never promises a slot it has not confirmed.", intent: "booking", direction: "inbound", handsOffTo: [], isFrontDoor: false });
    add({ key: "reminder", name: "Appointment reminder", job: "Calls the day before to confirm the appointment, offers to reschedule if needed, and notes cancellations. Brief and polite; respects quiet hours.", intent: "booking", direction: "outbound", handsOffTo: [], isFrontDoor: false });
  }
  if (ecommerce) {
    add({ key: "order", name: "Order status", job: "Looks up an order by ID or phone and says where it is, leading with the status and then the date. Says so plainly if it is late. Never invents a status.", intent: "order_status", direction: "inbound", handsOffTo: ["complaints"], isFrontDoor: false });
    add({ key: "delivery", name: "Delivery reschedule", job: "Calls when a delivery failed and finds a slot that works. Offers two windows, confirms the address, reads the slot back.", intent: "delivery_reschedule", direction: "outbound", handsOffTo: [], isFrontDoor: false });
    if (has("cod", "cash on delivery", "payment")) {
      add({ key: "cod", name: "COD payment reminder", job: "Reminds the customer of the amount due on delivery and when it arrives. Matter-of-fact, never pressuring. Takes cancellations without argument.", intent: "payment_reminder", direction: "outbound", handsOffTo: [], isFrontDoor: false });
    }
  }
  if (care || ecommerce || civic || ctx.departments.length > 2) {
    add({ key: "complaints", name: "Complaints & refunds", job: "Takes complaints and refund requests. Collects name, phone and what happened one at a time, registers the complaint, reads the reference number back, and says which team owns it. Acknowledges the feeling before acting.", intent: "complaint", direction: "inbound", handsOffTo: [], isFrontDoor: false });
  }
  if (sales) {
    add({ key: "sales_in", name: "Sales enquiry", job: "Answers product and pricing questions from the knowledge base, qualifies the need, and books a demo or callback. Never invents a price or a discount.", intent: "sales_enquiry", direction: "inbound", handsOffTo: [], isFrontDoor: false });
    add({ key: "lead", name: "Lead follow-up", job: "Follows up on enquiries the person submitted. Asks for two minutes, qualifies conversationally, books a specific next step. Ends warmly if not interested.", intent: "sales_enquiry", direction: "outbound", handsOffTo: [], isFrontDoor: false });
  }
  if (agents.length === 0) {
    add({ key: "reception", name: "Reception", job: "Answers the main line, understands what the caller needs, answers from the knowledge base where it can, and takes a callback for anything else.", intent: "other", direction: "inbound", handsOffTo: [], isFrontDoor: false });
  }

  const inbound = agents.filter((a) => a.direction !== "outbound");
  if (inbound.length >= 2) {
    agents.unshift({
      key: "front_door",
      name: "Front door",
      job: "Answers the main number, greets, works out in one or two turns what the caller needs and hands them to the right agent with a summary. Does not try to solve anything itself.",
      intent: "other",
      direction: "inbound",
      handsOffTo: inbound.map((a) => a.key),
      isFrontDoor: true,
    });
  }

  const questions: string[] = [];
  if (ctx.transfers.length === 0 && ctx.playbook.extra.humanEscalation !== false) questions.push("Is there a person a call can be transferred to when the agent is stuck? Name and number.");
  if ((clinic || ctx.appointmentTypes.length === 0) && agents.some((a) => a.intent === "booking") && ctx.appointmentTypes.length === 0) questions.push("What can be booked — type, duration and hours?");
  if (ctx.knowledgeDocs === 0) questions.push("What policies must the agent quote exactly — returns, refunds, fees, timings?");

  return {
    source: "heuristic",
    summary: `${agents.length} agent${agents.length === 1 ? "" : "s"} covering ${Array.from(new Set(agents.map((a) => a.intent))).join(", ")}${inbound.length >= 2 ? ", with a front door that routes callers" : ""}.`,
    questions,
    agents,
  };
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
 * a Transfer or a Handoff; escalation is present only when a desk exists (or
 * the owner has not ruled humans out), and bookings only when there is a type.
 */
function buildFlow(
  spec: Shape["agents"][number],
  ctx: PlanContext,
  handoffKeysToNames: Map<string, string>,
): { nodes: FlowNode[]; edges: FlowEdge[]; needs: string[] } {
  const nodes: FlowNode[] = [];
  const edges: FlowEdge[] = [];
  const needs = new Set<string>();
  const canTransfer = ctx.playbook.extra.humanEscalation !== false;
  const desk = ctx.transfers[0]?.name;
  const handoffs = spec.handsOffTo.map((k) => ({ key: k, name: handoffKeysToNames.get(k) ?? k }));

  const start = node("start", spec.direction === "outbound" ? "Introduce + ask for two minutes" : "Greet", 40, 40, {
    script: "",
  }, "Follows the caller's language");
  nodes.push(start);

  const end = node("end", "Close and hang up", 820, 260, { hangUp: true, script: "" });
  const escalate = canTransfer
    ? node("escalate", desk ? `Transfer to ${desk}` : "Transfer to human", 820, 60, desk ? { transferTarget: desk } : {})
    : null;
  if (escalate) needs.add("transfers");

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
    const fallback = node("collect", "Take a callback", 560, 40 + handoffs.length * 110, { fields: ["name", "phone", "what it is about"] });
    nodes.push(fallback, end);
    edges.push(edge(intent, fallback, "anything else"), edge(fallback, end));
    if (escalate) {
      nodes.push(escalate);
      edges.push(edge(intent, escalate, "asks for a person", "danger"));
    }
    return { nodes, edges, needs: [...needs] };
  }

  switch (spec.intent) {
    case "order_status": {
      needs.add("orders");
      const collect = node("collect", "Order ID or phone", 300, 40, { fields: ["order ID or registered phone"] });
      const pull = node("data_pull", "Look up the order", 300, 200, { tool: "lookup_order" });
      const branch = node("branch", "Found / late / dispute", 560, 200);
      const say = node("say", "Status, then the date", 820, 160, { script: "" });
      nodes.push(collect, pull, branch, say, end);
      edges.push(edge(start, collect), edge(collect, pull), edge(pull, branch), edge(branch, say, "found", "success"), edge(say, end));
      const notFound = node("collect", "Take callback for missing order", 560, 340, { fields: ["name", "phone"] });
      nodes.push(notFound);
      edges.push(edge(branch, notFound, "not found"), edge(notFound, end));
      if (escalate) { nodes.push(escalate); edges.push(edge(branch, escalate, "payment dispute", "danger")); }
      break;
    }
    case "complaint": {
      needs.add("departments");
      const intent = node("intent", "Complaint, refund, or enquiry", 300, 40);
      const collect = node("collect", "Name, phone, what happened", 300, 200, { fields: ["name", "phone", "what happened", "when"] });
      const reg = node("data_pull", "Register the complaint", 560, 200, { tool: "register_complaint" });
      const say = node("say", "Read reference number back", 820, 200, { script: "" });
      const kb = node("data_pull", "Check the policy", 560, 40, { tool: "search_knowledge" });
      nodes.push(intent, collect, reg, say, kb, end);
      edges.push(edge(start, intent), edge(intent, collect, "complaint / refund"), edge(collect, reg), edge(reg, say, undefined, "success"), edge(say, end), edge(intent, kb, "policy question"), edge(kb, end));
      if (escalate) { nodes.push(escalate); edges.push(edge(intent, escalate, "emergency / very angry", "danger")); }
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
        const collect = node("collect", "Name, phone, preferred day", 300, 200, { fields: ["name", "phone", "preferred day"] });
        const book = node("book", "Offer two slots, confirm", 560, 200, { appointmentType: ctx.appointmentTypes[0]?.name });
        const kb = node("data_pull", "Fees, timings, directions", 560, 40, { tool: "search_knowledge" });
        nodes.push(intent, collect, book, kb, end);
        edges.push(edge(start, intent), edge(intent, collect, "book / reschedule"), edge(collect, book), edge(book, end, undefined, "success"), edge(intent, kb, "question"), edge(kb, end));
        if (escalate) { nodes.push(escalate); edges.push(edge(intent, escalate, "medical urgency", "danger")); }
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
      const qualify = node("collect", "What they need, scale, timeline", 300, 40, { fields: ["what they are trying to solve", "scale", "timeline", "who decides"] });
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
      const cb = node("collect", "Take a callback", 560, 200, { fields: ["name", "phone", "what it is about"] });
      nodes.push(intent, kb, cb, end);
      edges.push(edge(start, intent), edge(intent, kb, "question"), edge(kb, end), edge(intent, cb, "needs a person"), edge(cb, end));
      needs.add("knowledge");
      if (escalate) { nodes.push(escalate); edges.push(edge(intent, escalate, "asks for a person", "danger")); }
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

function materialise(shape: Shape, ctx: PlanContext): PlannedAgent[] {
  const names = new Map(shape.agents.map((a) => [a.key, a.name]));
  return shape.agents.map((a) => {
    const flow = buildFlow(a, ctx, names);
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
      prompt: a.job,
    };
  });
}

/* ── Apply ────────────────────────────────────────────────────────────────── */

/**
 * Creates the agents. Two passes: handoff nodes reference sibling agents by
 * plan key, and the sibling's id does not exist until it is inserted.
 */
export function applyPlan(orgId: string, plan: Pick<AgentPlan, "agents">) {
  const ids = new Map<string, string>();
  for (const a of plan.agents) {
    const id = createAgent(orgId, {
      name: a.name,
      intent: a.intent,
      direction: a.direction,
      prompt: a.prompt,
      nodes: [],
      edges: [],
    });
    ids.set(a.key, id);
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
