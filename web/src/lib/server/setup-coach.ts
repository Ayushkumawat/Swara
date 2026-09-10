import "server-only";
import { GoogleGenAI, Type } from "@google/genai";
import { getDb, nowIso } from "./db";
import { ingestKnowledgeDoc } from "./ai";
import { createAgent, updateAgent } from "./repo";
import { upsertAppointmentType, upsertDepartment, upsertPlaybook, upsertTransfer } from "./workspace";
import { AGENT_TEMPLATES, templateById } from "@/lib/agents/templates";
import type { FlowEdge, FlowNode, Intent } from "@/lib/api/schemas";

/**
 * Swara as a setup coach, not a customer-facing agent.
 *
 * The interview is the product: one sharp question at a time, domain-aware
 * edge cases, a split into specialised agents instead of one mega-bot, then
 * a plan the owner can apply. History lives in `setup_chats` so they can
 * hang up, come back tomorrow, or add a new department without starting over.
 */

const TEXT_MODELS = [
  process.env.GEMINI_TEXT_MODEL ?? "gemini-flash-latest",
  "gemini-3.6-flash",
];

const INTENTS: Intent[] = [
  "order_status",
  "delivery_reschedule",
  "complaint",
  "sales_enquiry",
  "booking",
  "payment_reminder",
  "feedback",
  "other",
];

export type SetupFact = { topic: string; answer: string };
export type SetupMessage = { role: "user" | "assistant"; text: string; at: string };

export type SetupPlanAgent = {
  name: string;
  intent: Intent;
  role: string;
  why: string;
  knowledge: string;
  transfersTo: string[];
};

export type SetupPlan = {
  summary: string;
  businessType: string;
  hours: string;
  transferPolicy: string;
  bookingPolicy: string;
  departments: { name: string; keywords: string[] }[];
  transfers: { name: string; role: string; phone: string; whenToUse: string }[];
  appointments: { name: string; durationMin: number; hours?: string; notes?: string }[];
  agents: SetupPlanAgent[];
  receptionist: boolean;
};

export type SetupChat = {
  messages: SetupMessage[];
  facts: SetupFact[];
  plan: SetupPlan | null;
  appliedAt: string | null;
};

const INTERVIEW = `
You are Swara, the setup coach for an Indian SMB voice-calling product.
You are interviewing the business owner to design their voice agents. You are
not a customer-facing agent on this call.

HOW YOU THINK
- Understand the use case before proposing anything. What do callers actually
  ask? Which departments own the follow-up? What should the line never discuss?
- Always prefer several specialised agents over one mega-bot. Orders are not
  complaints. Bookings are not sales. A front desk that transfers is better
  than one agent that pretends to know everything — each specialist keeps its
  own knowledge base.
- Probe edge cases. Do not accept a happy-path answer.
- Suggest human escalation where a person is safer: furious callers, medical
  advice, payment disputes, anything the AI must not invent.
- Never ask which language they want. The live agent follows the caller.

DOMAIN PROBES (pick the ones that match what they just said)
- Clinic / doctor / dentist / hospital: Can one caller book multiple
  appointments? For whom (self, family)? What treatments are offered, duration,
  who can book vs who needs a doctor to approve? What must the agent ignore
  (diagnosis, prescriptions, test results)? Waitlist? Cancellations inside
  24h? What if the preferred doctor is full?
- Ecommerce / D2C / delivery: Order status vs reschedule vs return vs COD vs
  "where is my refund" are different jobs. Who owns damaged-in-transit? What
  if they have no order ID? What if two numbers are on the account?
- Salon / spa: Services, duration, deposits, late arrivals, which staff.
- Restaurant: Reservation vs takeaway vs complaint. Party size, waitlist.
- Always: working hours, what happens after hours, who takes an emergency,
  typical questions, what to never discuss, whether a human is on the roster.

STYLE
Ask ONE sharp question per turn. Do not dump a questionnaire. Reflect back
what you understood in a short clause, then ask the next gap.
When you have enough to split the line, propose the agents, who transfers to
whom, which knowledge each one needs, and whether a human desk is required.
Do not claim you have created anything until apply is confirmed.

Return JSON only:
{
  "reply": "spoken/typed next turn, short",
  "facts": [{ "topic": "snake_case", "answer": "..." }],
  "plan": null or a full plan object,
  "ready_to_apply": false
}

Plan object when you have one:
{
  "summary": "one paragraph the owner can agree to",
  "businessType": "",
  "hours": "",
  "transferPolicy": "when to hand to a human vs another agent",
  "bookingPolicy": "",
  "departments": [{ "name": "", "keywords": [] }],
  "transfers": [{ "name": "", "role": "", "phone": "", "whenToUse": "" }],
  "appointments": [{ "name": "", "durationMin": 30, "hours": "", "notes": "" }],
  "agents": [{
    "name": "short line name",
    "intent": "order_status|delivery_reschedule|complaint|sales_enquiry|booking|payment_reminder|feedback|other",
    "role": "system prompt for that agent, concrete, no language picker",
    "why": "why this is its own agent",
    "knowledge": "FAQ / policy text this agent should search, several paragraphs if possible",
    "transfersTo": ["other agent names they should hand off to"]
  }],
  "receptionist": true
}
Set receptionist true whenever there are two or more specialists — a front
desk greets and transfers, it does not answer specialist questions.
Only include a transfer phone if they actually gave one. Empty phone is fine.
`.trim();

function db() {
  return getDb();
}

export function loadChat(orgId: string): SetupChat {
  const row = db().prepare("SELECT * FROM setup_chats WHERE org_id=?").get(orgId) as
    | { messages: string; facts: string; plan: string | null; applied_at: string | null }
    | undefined;
  if (!row) {
    return { messages: [], facts: [], plan: null, appliedAt: null };
  }
  return {
    messages: safeParse<SetupMessage[]>(row.messages, []),
    facts: safeParse<SetupFact[]>(row.facts, []),
    plan: row.plan ? safeParse<SetupPlan | null>(row.plan, null) : null,
    appliedAt: row.applied_at,
  };
}

function saveChat(orgId: string, chat: SetupChat) {
  db().prepare(
    `INSERT INTO setup_chats (org_id, messages, facts, plan, applied_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(org_id) DO UPDATE SET
       messages=excluded.messages, facts=excluded.facts, plan=excluded.plan,
       applied_at=excluded.applied_at, updated_at=excluded.updated_at`,
  ).run(
    orgId,
    JSON.stringify(chat.messages.slice(-80)),
    JSON.stringify(chat.facts),
    chat.plan ? JSON.stringify(chat.plan) : null,
    chat.appliedAt,
    nowIso(),
  );
}

export function recordFact(orgId: string, topic: string, answer: string) {
  const chat = loadChat(orgId);
  const t = topic.trim() || "note";
  const a = answer.trim();
  if (!a) return chat;
  const rest = chat.facts.filter((f) => f.topic !== t);
  chat.facts = [...rest, { topic: t, answer: a }];
  if (!chat.plan) chat.plan = heuristicPlan(chat.facts);
  saveChat(orgId, chat);
  return chat;
}

export async function coachReply(orgId: string, userText: string): Promise<SetupChat & { reply: string }> {
  const chat = loadChat(orgId);
  const text = userText.trim();
  if (text) {
    chat.messages.push({ role: "user", text, at: nowIso() });
  }

  const generated = (await askModel(chat, text)) ?? fallbackReply(chat);
  for (const fact of generated.facts ?? []) {
    if (!fact.topic || !fact.answer) continue;
    const rest = chat.facts.filter((f) => f.topic !== fact.topic);
    chat.facts = [...rest, { topic: fact.topic, answer: fact.answer }];
  }
  const incoming = generated.plan?.agents.length ? generated.plan : null;
  if (incoming) chat.plan = incoming;
  else if (!chat.plan?.agents.length) chat.plan = heuristicPlan(chat.facts);

  const reply = generated.reply.trim() || "Tell me what callers usually ask when they ring this number.";
  chat.messages.push({ role: "assistant", text: reply, at: nowIso() });
  saveChat(orgId, chat);
  return { ...chat, reply };
}

export async function applyStoredPlan(orgId: string): Promise<Record<string, unknown>> {
  const chat = loadChat(orgId);
  let plan = chat.plan;
  if (!plan || plan.agents.length === 0) {
    plan = (await draftPlanFromFacts(chat.facts)) ?? heuristicPlan(chat.facts);
    chat.plan = plan;
  }
  if (!plan.agents.length) {
    return {
      applied: false,
      error: "Not enough to build yet. Need the business type and what callers ask for.",
    };
  }

  const created = await materialisePlan(orgId, plan);
  chat.appliedAt = nowIso();
  chat.plan = plan;
  chat.messages.push({
    role: "assistant",
    text: `Applied: ${created.agents.join(", ") || "no new agents"}. You can keep talking — new facts update the next apply.`,
    at: nowIso(),
  });
  saveChat(orgId, chat);
  return {
    applied: true,
    agents: created.agents,
    departments: created.departments,
    appointments: created.appointments,
    transfers: created.transfers,
    knowledge: created.knowledge,
    note: "Tell them what you created, suggest they open Agents and test each line. Keep taking new facts if they add more.",
  };
}

async function materialisePlan(orgId: string, plan: SetupPlan) {
  upsertPlaybook(orgId, {
    businessType: plan.businessType || undefined,
    hours: plan.hours || undefined,
    transferPolicy: plan.transferPolicy || undefined,
    bookingPolicy: plan.bookingPolicy || undefined,
  });

  const departments: string[] = [];
  for (const d of plan.departments) {
    if (!d.name.trim()) continue;
    upsertDepartment(orgId, { name: d.name.trim(), keywords: d.keywords ?? [] });
    departments.push(d.name.trim());
  }

  const transfers: string[] = [];
  for (const t of plan.transfers) {
    if (!t.name.trim() || !t.phone.trim()) continue;
    upsertTransfer(orgId, {
      name: t.name.trim(),
      role: t.role.trim() || "Desk",
      phone: t.phone.trim(),
      whenToUse: t.whenToUse.trim() || "When the caller asks for a person",
    });
    transfers.push(t.name.trim());
  }

  const appointments: string[] = [];
  for (const a of plan.appointments) {
    if (!a.name.trim()) continue;
    upsertAppointmentType(orgId, {
      name: a.name.trim(),
      durationMin: a.durationMin || 30,
      hours: a.hours,
      notes: a.notes,
    });
    appointments.push(a.name.trim());
  }

  const existing = db()
    .prepare("SELECT id, name FROM agents WHERE org_id=?")
    .all(orgId) as { id: string; name: string }[];
  const byName = new Map(existing.map((a) => [a.name.toLowerCase(), a.id]));

  const agents: string[] = [];
  const created: { id: string; name: string; intent: Intent }[] = [];

  for (const spec of plan.agents) {
    const tpl =
      spec.intent === "other"
        ? undefined
        : (templateById(intentTemplate(spec.intent)) ?? AGENT_TEMPLATES.find((t) => t.intent === spec.intent));
    const nodes = stampTransfers(structuredClone(tpl?.nodes ?? fallbackNodes(spec)), spec.transfersTo);
    const edges = structuredClone(tpl?.edges ?? fallbackEdges());
    const prompt = spec.role.trim() || tpl?.prompt || `You handle ${spec.name}.`;
    const key = spec.name.toLowerCase();
    let id = byName.get(key);
    if (id) {
      updateAgent(orgId, id, { prompt, nodes, edges });
    } else {
      id = createAgent(orgId, {
        name: spec.name,
        intent: spec.intent,
        prompt,
        nodes,
        edges,
      });
      byName.set(key, id);
    }
    agents.push(spec.name);
    created.push({ id, name: spec.name, intent: spec.intent });

    if (spec.knowledge.trim().length >= 20) {
      await replaceAgentKnowledge(orgId, id, `${spec.name} knowledge`, spec.knowledge);
    }
  }

  if (plan.receptionist && created.length > 1) {
    const desk = frontDeskGraph(created);
    const existingDesk = byName.get("front desk");
    if (existingDesk) {
      updateAgent(orgId, existingDesk, { prompt: desk.prompt, nodes: desk.nodes, edges: desk.edges });
    } else {
      createAgent(orgId, {
        name: "Front desk",
        intent: "other",
        prompt: desk.prompt,
        nodes: desk.nodes,
        edges: desk.edges,
      });
    }
    agents.unshift("Front desk");
  }

  return { agents, departments, appointments, transfers, knowledge: created.map((a) => a.name) };
}

function stampTransfers(nodes: FlowNode[], transfersTo: string[]): FlowNode[] {
  if (!transfersTo.length) return nodes;
  const target = transfersTo[0];
  return nodes.map((n) =>
    n.kind === "escalate"
      ? {
          ...n,
          title: `Transfer to ${target}`,
          config: { ...n.config, targetAgentName: target, transferKind: "agent" },
        }
      : n,
  );
}

function frontDeskGraph(specialists: { id: string; name: string; intent: Intent }[]) {
  const nodes: FlowNode[] = [
    {
      id: "s",
      kind: "start",
      title: "Greet + listen",
      detail: "Never ask which language. Ask what they need in one line.",
      x: 40,
      y: 40,
      config: {},
    },
    {
      id: "i",
      kind: "intent",
      title: "What do they need?",
      detail: specialists.map((s) => `${s.name} (${s.intent})`).join("; "),
      x: 320,
      y: 40,
      config: {},
    },
  ];
  const edges: FlowEdge[] = [{ id: "e0", from: "s", to: "i", tone: "default" }];
  specialists.forEach((s, idx) => {
    const id = `t${idx}`;
    nodes.push({
      id,
      kind: "escalate",
      title: `To ${s.name}`,
      detail: `Hand off when the need matches ${s.intent}.`,
      x: 120 + idx * 240,
      y: 220,
      config: { transferKind: "agent", targetAgentId: s.id, targetAgentName: s.name },
    });
    edges.push({ id: `e${idx + 1}`, from: "i", to: id, label: s.intent, tone: "default" });
  });
  nodes.push({
    id: "end",
    kind: "end",
    title: "Hang up",
    detail: "If they only needed a transfer, the specialist ends the call.",
    x: 320,
    y: 400,
    config: {},
  });
  const prompt = [
    "You are the front desk. You greet, learn what they need in one turn, and transfer_to_agent to the matching specialist.",
    "You do not look up orders, book slots, or file complaints yourself — those agents own their knowledge bases.",
    `Specialists: ${specialists.map((s) => `${s.name} (${s.intent})`).join("; ")}.`,
    "If nothing matches, take a callback. If they want a human and a desk exists, transfer_to_human.",
    "When they are done, end_call.",
  ].join(" ");
  return { nodes, edges, prompt };
}

async function replaceAgentKnowledge(orgId: string, agentId: string, name: string, text: string) {
  const old = db()
    .prepare("SELECT id FROM knowledge_docs WHERE org_id=? AND agent_id=? AND name=?")
    .all(orgId, agentId, name) as { id: string }[];
  for (const doc of old) {
    db().prepare("DELETE FROM knowledge_chunks WHERE doc_id=?").run(doc.id);
    db().prepare("DELETE FROM knowledge_docs WHERE id=?").run(doc.id);
  }
  await ingestKnowledgeDoc(orgId, name, "text", text, agentId);
}

function fallbackNodes(spec: SetupPlanAgent): FlowNode[] {
  return [
    { id: "s", kind: "start", title: "Greet", x: 40, y: 40, config: {} },
    { id: "c", kind: "collect", title: "What they need", x: 300, y: 40, config: {} },
    {
      id: "k",
      kind: "data_pull",
      title: spec.intent === "order_status" ? "lookup_order" : "search_knowledge",
      x: 300,
      y: 200,
      config: { tool: spec.intent === "order_status" ? "lookup_order" : "search_knowledge" },
    },
    { id: "end", kind: "end", title: "Hang up", x: 560, y: 200, config: {} },
  ];
}

function fallbackEdges(): FlowEdge[] {
  return [
    { id: "e1", from: "s", to: "c", tone: "default" },
    { id: "e2", from: "c", to: "k", tone: "default" },
    { id: "e3", from: "k", to: "end", tone: "default" },
  ];
}

function intentTemplate(intent: Intent): string {
  const map: Record<Intent, string> = {
    order_status: "tpl_order",
    delivery_reschedule: "tpl_delivery",
    complaint: "tpl_grievance",
    sales_enquiry: "tpl_lead",
    booking: "tpl_booking",
    payment_reminder: "tpl_cod",
    feedback: "tpl_grievance",
    other: "tpl_booking",
  };
  return map[intent];
}

type ModelOut = {
  reply: string;
  facts?: SetupFact[];
  plan?: SetupPlan | null;
};

async function askModel(chat: SetupChat, latest: string): Promise<ModelOut | null> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  const ai = new GoogleGenAI({ apiKey: key });
  const history = chat.messages
    .slice(-24)
    .map((m) => `${m.role === "user" ? "OWNER" : "SWARA"}: ${m.text}`)
    .join("\n");
  const facts = chat.facts.map((f) => `- ${f.topic}: ${f.answer}`).join("\n") || "(none yet)";
  const contents = [
    INTERVIEW,
    "",
    "FACTS ALREADY SAVED:",
    facts,
    chat.plan ? `\nCURRENT DRAFT PLAN:\n${JSON.stringify(chat.plan)}` : "",
    "",
    "CONVERSATION:",
    history || "(new conversation)",
    latest ? `\nOWNER just said: ${latest}` : "\nOWNER just opened the coach. Greet briefly and ask what this number is for.",
  ].join("\n");

  for (const model of TEXT_MODELS) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              reply: { type: Type.STRING },
              facts: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    topic: { type: Type.STRING },
                    answer: { type: Type.STRING },
                  },
                  required: ["topic", "answer"],
                },
              },
              ready_to_apply: { type: Type.BOOLEAN },
              plan: { type: Type.OBJECT },
            },
            required: ["reply"],
          },
        },
      });
      const parsed = JSON.parse(response.text ?? "{}") as {
        reply?: string;
        facts?: SetupFact[];
        plan?: unknown;
      };
      return {
        reply: parsed.reply ?? "",
        facts: parsed.facts,
        plan: parsed.plan ? emptyToNull(normalisePlan(parsed.plan)) : null,
      };
    } catch (error) {
      console.error(`[setup-coach] ${model} failed:`, String(error).slice(0, 300));
    }
  }
  return null;
}

async function draftPlanFromFacts(facts: SetupFact[]): Promise<SetupPlan | null> {
  const fake: SetupChat = { messages: [], facts, plan: null, appliedAt: null };
  const out = await askModel(fake, "Draft the plan from the facts you have. Do not ask another question — fill the plan object.");
  return out?.plan ?? null;
}

function fallbackReply(chat: SetupChat): ModelOut {
  const have = new Set(chat.facts.map((f) => f.topic));
  const blob = chat.facts.map((f) => `${f.topic} ${f.answer}`).join(" ").toLowerCase();
  const clinic = /doctor|clinic|dent|hospital|appoint|treatment/.test(blob);
  const shop = /order|shop|d2c|delivery|parcel|cod/.test(blob);

  const questions: [string, string][] = [
    ["business_type", "What kind of business is this number for — clinic, shop, salon, restaurant, something else?"],
    ["typical_calls", "When someone rings, what do they usually want? List the two or three most common asks."],
    ["hours", "What hours should the line pick up, and what should it say after hours?"],
    ["human_escalation", "Should a furious caller, a payment dispute, or a medical question go to a named person? If yes, who, and do you have a number?"],
  ];
  if (clinic) {
    questions.push(
      ["multiple_bookings", "Can one caller book more than one slot — for family members, or follow-ups?"],
      ["treatments", "Which treatments or visit types can the agent actually book, and which must a doctor approve?"],
      ["ignore", "What must the agent never discuss — diagnosis, prescriptions, reports?"],
    );
  }
  if (shop) {
    questions.push(
      ["no_order_id", "What if they have no order ID — registered phone, email, something else?"],
      ["split_lines", "Should order tracking, complaints and delivery reschedule be separate agents? I would split them."],
    );
  }
  questions.push(["departments", "Which teams own follow-up work after the call — support, billing, the clinic desk?"]);

  const next = questions.find(([topic]) => !have.has(topic));
  if (!next) {
    return {
      reply: chat.plan
        ? `I would set this up as: ${chat.plan.agents.map((a) => a.name).join(", ")}. Say yes and I will create them.`
        : "I have enough to draft specialised agents. Say yes and I will create them, or tell me what to change.",
      plan: chat.plan ?? heuristicPlan(chat.facts),
    };
  }
  return { reply: next[1] };
}

function phoneFromFacts(facts: SetupFact[], topic: string): SetupPlan["transfers"] {
  const esc = facts.find((f) => f.topic === topic)?.answer ?? "";
  const phone = esc.match(/\+?\d[\d\s-]{9,}/)?.[0]?.replace(/[\s-]/g, "") ?? "";
  if (!phone) return [];
  const name = /\b([A-Z][a-z]{2,})\b/.exec(esc)?.[1] ?? "Desk";
  return [{ name, role: "Reception", phone, whenToUse: esc || "When the caller asks for a person" }];
}

export function heuristicPlan(facts: SetupFact[]): SetupPlan {
  const blob = facts.map((f) => `${f.topic}: ${f.answer}`).join("\n");
  const lower = blob.toLowerCase();
  const get = (topic: string) => facts.find((f) => f.topic === topic)?.answer ?? "";
  const clinic = /doctor|clinic|dent|hospital|appoint|treatment|patient/.test(lower);
  const shop = /order|shop|d2c|delivery|parcel|cod|ecommerce/.test(lower);
  const salon = /salon|spa|beauty|hair/.test(lower);

  const hours = get("hours") || "10:00-19:00 IST";
  const businessType =
    get("business_type") ||
    (clinic ? "Clinic" : shop ? "D2C / retail" : salon ? "Salon" : "SMB helpline");

  if (clinic) {
    return {
      summary:
        "A front desk that transfers, a booking agent that only offers real treatments, and a complaints line for billing or wait-time issues. The booking agent never diagnoses.",
      businessType,
      hours,
      transferPolicy:
        get("human_escalation") ||
        "Medical questions, prescriptions and test results go to the clinic desk. Furious callers go to a human if one is configured.",
      bookingPolicy:
        get("multiple_bookings") ||
        "Confirm who the appointment is for. Multiple bookings only if the owner allowed them. Never invent a treatment.",
      departments: [
        { name: "Front desk", keywords: ["appointment", "timing", "doctor"] },
        { name: "Billing", keywords: ["bill", "payment", "receipt"] },
      ],
      transfers: phoneFromFacts(facts, "human_escalation"),
      appointments: [
        {
          name: get("treatments")?.split(/,|;/)[0]?.trim() || "Consultation",
          durationMin: 20,
          hours,
          notes: "Do not offer types that were not listed.",
        },
      ],
      receptionist: true,
      agents: [
        {
          name: "Bookings",
          intent: "booking",
          why: "Appointments need their own knowledge (treatments, durations, who can book).",
          role: `You book clinic appointments. Offer only the treatments you have been given. Confirm the patient name, date and time. ${get("multiple_bookings") ? "Multiple bookings are allowed — confirm each one." : "One booking per call unless they clearly ask for another."} Never diagnose, prescribe, or discuss reports. If they ask for medical advice, transfer or take a callback.`,
          knowledge: [
            `Hours: ${hours}.`,
            get("treatments") ? `Treatments: ${get("treatments")}` : "Treatments must be confirmed with the clinic.",
            get("ignore") ? `Never discuss: ${get("ignore")}` : "Never discuss diagnosis, prescriptions or lab results.",
            get("typical_calls") ? `Typical asks: ${get("typical_calls")}` : "",
          ]
            .filter(Boolean)
            .join("\n"),
          transfersTo: [],
        },
        {
          name: "Patient help",
          intent: "complaint",
          why: "Billing, wait times and complaints should not sit on the booking line.",
          role: "You take clinic complaints and billing questions. File them, read a reference number, never invent a medical answer.",
          knowledge: get("typical_calls") || "Wait times, billing, missed appointments.",
          transfersTo: ["Bookings"],
        },
      ],
    };
  }

  if (shop) {
    return {
      summary:
        "Split order tracking from complaints and from delivery reschedule. A front desk greets and hands off. Each line keeps its own knowledge.",
      businessType,
      hours,
      transferPolicy:
        get("human_escalation") ||
        "Payment disputes and angry callers go to a human. Damaged-in-transit stays on complaints.",
      bookingPolicy: "Reschedule only into configured windows.",
      departments: [
        { name: "Support", keywords: ["refund", "return", "wrong"] },
        { name: "Logistics", keywords: ["delivery", "delay", "reschedule"] },
      ],
      transfers: [],
      appointments: [{ name: "Delivery slot", durationMin: 60, hours, notes: "Offer two windows" }],
      receptionist: true,
      agents: [
        {
          name: "Order status",
          intent: "order_status",
          why: "Tracking is a lookup job; mixing it with complaints produces invented ETAs.",
          role: "You look up orders. Get the order ID or registered phone, call lookup_order, lead with status then date. Never invent a status.",
          knowledge: get("no_order_id")
            ? `If they have no order ID: ${get("no_order_id")}`
            : "Identify by order ID or registered phone.",
          transfersTo: ["Complaints"],
        },
        {
          name: "Complaints",
          intent: "complaint",
          why: "Returns, refunds and damaged items need a reference number and a department.",
          role: "You take complaints. Collect name, phone and what happened one at a time. Register, read the reference back.",
          knowledge: get("typical_calls") || "Returns, refunds, damaged in transit.",
          transfersTo: [],
        },
        {
          name: "Delivery",
          intent: "delivery_reschedule",
          why: "A new slot is a booking, not an order lookup.",
          role: "You reschedule deliveries. Confirm the person, offer two slots, cancel without arguing.",
          knowledge: `Hours: ${hours}.`,
          transfersTo: ["Complaints"],
        },
      ],
    };
  }

  return {
    summary: "Start with a specialist for the main ask and a complaints line. Add more agents as new topics appear.",
    businessType,
    hours,
    transferPolicy: get("human_escalation") || "Offer a human on the second stuck turn if a desk exists.",
    bookingPolicy: "",
    departments: [{ name: "Support", keywords: ["help", "issue", "complaint"] }],
    transfers: [],
    appointments: [],
    receptionist: true,
    agents: [
      {
        name: "Front line",
        intent: "other",
        why: "Primary ask from the interview.",
        role: `You handle ${businessType} calls. Typical asks: ${get("typical_calls") || "whatever they open with"}. Search knowledge before stating policy. Transfer when it is someone else's job. End the call when they are done.`,
        knowledge: blob || "Fill this with hours, offers and what to ignore.",
        transfersTo: [],
      },
    ],
  };
}

function emptyToNull(plan: SetupPlan): SetupPlan | null {
  return plan.agents.length ? plan : null;
}

function normalisePlan(raw: unknown): SetupPlan {
  const p = (raw ?? {}) as Record<string, unknown>;
  const agentsIn = Array.isArray(p.agents) ? p.agents : [];
  const agents: SetupPlanAgent[] = agentsIn.map((row) => {
    const a = (row ?? {}) as Record<string, unknown>;
    const intent = INTENTS.includes(a.intent as Intent) ? (a.intent as Intent) : "other";
    return {
      name: String(a.name ?? "Specialist").slice(0, 48),
      intent,
      role: String(a.role ?? ""),
      why: String(a.why ?? ""),
      knowledge: String(a.knowledge ?? ""),
      transfersTo: Array.isArray(a.transfersTo)
        ? a.transfersTo.map((x) => String(x))
        : [],
    };
  });
  return {
    summary: String(p.summary ?? ""),
    businessType: String(p.businessType ?? ""),
    hours: String(p.hours ?? ""),
    transferPolicy: String(p.transferPolicy ?? ""),
    bookingPolicy: String(p.bookingPolicy ?? ""),
    departments: Array.isArray(p.departments)
      ? (p.departments as { name?: string; keywords?: string[] }[]).map((d) => ({
          name: String(d.name ?? ""),
          keywords: Array.isArray(d.keywords) ? d.keywords.map(String) : [],
        }))
      : [],
    transfers: Array.isArray(p.transfers)
      ? (p.transfers as { name?: string; role?: string; phone?: string; whenToUse?: string }[]).map((t) => ({
          name: String(t.name ?? ""),
          role: String(t.role ?? ""),
          phone: String(t.phone ?? ""),
          whenToUse: String(t.whenToUse ?? ""),
        }))
      : [],
    appointments: Array.isArray(p.appointments)
      ? (p.appointments as { name?: string; durationMin?: number; hours?: string; notes?: string }[]).map((a) => ({
          name: String(a.name ?? ""),
          durationMin: Number(a.durationMin) || 30,
          hours: a.hours ? String(a.hours) : undefined,
          notes: a.notes ? String(a.notes) : undefined,
        }))
      : [],
    agents,
    receptionist: p.receptionist !== false && agents.length > 1,
  };
}

function safeParse<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
