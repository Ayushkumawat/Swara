import type { FlowEdge, FlowNode, Intent } from "@/lib/api/schemas";

export type AgentTemplate = {
  id: string;
  name: string;
  blurb: string;
  intent: Intent;
  direction: "inbound" | "outbound" | "both";
  prompt: string;
  nodes: FlowNode[];
  edges: FlowEdge[];
  /** Which setup cards this template cannot run without. */
  needs: Array<"departments" | "transfers" | "appointments" | "orders" | "knowledge">;
};

function n(
  id: string,
  kind: FlowNode["kind"],
  title: string,
  x: number,
  y: number,
  detail?: string,
): FlowNode {
  return { id, kind, title, detail, x, y, config: {} };
}

function e(id: string, from: string, to: string, label?: string, tone: FlowEdge["tone"] = "default"): FlowEdge {
  return { id, from, to, label, tone };
}

export const AGENT_TEMPLATES: AgentTemplate[] = [
  {
    id: "tpl_order",
    name: "Order status",
    blurb: "Look up a live order and say where it is. Needs an order connector.",
    intent: "order_status",
    direction: "inbound",
    needs: ["orders"],
    prompt:
      "You handle order status. Get the order ID or registered phone, look it up, lead with the status then the date. Never invent a status.",
    nodes: [
      n("s", "start", "Greet + detect language", 40, 40, "Never ask which language"),
      n("c", "collect", "Order ID or phone", 300, 40),
      n("d", "data_pull", "lookup_order", 40, 200),
      n("b", "branch", "On time / late / missing", 300, 200),
      n("say", "say", "Read status + ETA", 560, 140),
      n("esc", "escalate", "Transfer if disputed", 560, 300),
      n("end", "end", "Close", 820, 200),
    ],
    edges: [
      e("e1", "s", "c"),
      e("e2", "c", "d"),
      e("e3", "d", "b"),
      e("e4", "b", "say", "found", "success"),
      e("e5", "b", "esc", "dispute", "danger"),
      e("e6", "say", "end"),
    ],
  },
  {
    id: "tpl_grievance",
    name: "Complaint intake",
    blurb: "File a complaint, read a reference number, route it to a department.",
    intent: "complaint",
    direction: "inbound",
    needs: ["departments"],
    prompt:
      "You take complaints. Collect name, phone and what happened one at a time. Register the complaint, read the reference number back, say which team will handle it.",
    nodes: [
      n("s", "start", "Greet", 40, 40),
      n("i", "intent", "Complaint vs enquiry", 300, 40),
      n("c", "collect", "Name, phone, issue", 40, 200),
      n("r", "data_pull", "register_complaint", 300, 200),
      n("esc", "escalate", "Safety / angry caller", 560, 80),
      n("end", "end", "Read ref + close", 560, 240),
    ],
    edges: [
      e("e1", "s", "i"),
      e("e2", "i", "c", "complaint"),
      e("e3", "c", "r"),
      e("e4", "i", "esc", "emergency", "danger"),
      e("e5", "r", "end", undefined, "success"),
    ],
  },
  {
    id: "tpl_booking",
    name: "Appointment booking",
    blurb: "Offer two slots from the types you configured, confirm, SMS.",
    intent: "booking",
    direction: "inbound",
    needs: ["appointments"],
    prompt:
      "You book appointments. Offer two concrete slots from the types you have been given. Confirm date, time and location. Never invent availability.",
    nodes: [
      n("s", "start", "Greet", 40, 40),
      n("c", "collect", "What they need", 300, 40),
      n("b", "book", "book_slot", 300, 200),
      n("end", "end", "Read slot back", 560, 200),
    ],
    edges: [e("e1", "s", "c"), e("e2", "c", "b"), e("e3", "b", "end", undefined, "success")],
  },
  {
    id: "tpl_delivery",
    name: "Delivery reschedule",
    blurb: "Outbound or inbound: pick a new slot or cancel.",
    intent: "delivery_reschedule",
    direction: "both",
    needs: ["appointments", "orders"],
    prompt:
      "You reschedule deliveries. Confirm the person, state what happened, offer two slots. Cancel without arguing if they ask.",
    nodes: [
      n("s", "start", "Identify + permission", 40, 40),
      n("d", "data_pull", "Fetch order", 300, 40),
      n("br", "branch", "Reschedule / cancel", 300, 200),
      n("bk", "book", "New slot", 560, 140),
      n("esc", "escalate", "Human if stuck", 560, 300),
      n("end", "end", "Confirm SMS", 820, 200),
    ],
    edges: [
      e("e1", "s", "d"),
      e("e2", "d", "br"),
      e("e3", "br", "bk", "reschedule", "success"),
      e("e4", "br", "esc", "stuck", "danger"),
      e("e5", "bk", "end"),
    ],
  },
  {
    id: "tpl_lead",
    name: "Lead qualification",
    blurb: "Outbound follow-up on an enquiry. Qualify, book the next step.",
    intent: "sales_enquiry",
    direction: "outbound",
    needs: ["transfers", "appointments"],
    prompt:
      "You follow up on an enquiry they submitted. Qualify conversationally. Never invent pricing. Book a specific next step or transfer to a closer.",
    nodes: [
      n("s", "start", "Name the enquiry + ask 2 min", 40, 40),
      n("i", "intent", "Interested / not now / no", 300, 40),
      n("c", "collect", "Need, scale, decider, timeline", 300, 200),
      n("b", "book", "Book specialist slot", 560, 140),
      n("end", "end", "Thank and hang up", 560, 300),
    ],
    edges: [
      e("e1", "s", "i"),
      e("e2", "i", "c", "yes"),
      e("e3", "i", "end", "no"),
      e("e4", "c", "b"),
      e("e5", "b", "end", undefined, "success"),
    ],
  },
  {
    id: "tpl_cod",
    name: "Payment reminder",
    blurb: "Remind, never collect. No threats.",
    intent: "payment_reminder",
    direction: "outbound",
    needs: ["orders"],
    prompt:
      "You are a COD / payment reminder. State the order, the amount, the date. Ask if they will have it ready. Never threaten. Take a cancel or dispute without argument.",
    nodes: [
      n("s", "start", "Identify + amount", 40, 40),
      n("br", "branch", "Will pay / cancel / dispute", 300, 40),
      n("end", "end", "Close", 560, 40),
      n("esc", "escalate", "Dispute → human", 560, 200),
    ],
    edges: [
      e("e1", "s", "br"),
      e("e2", "br", "end", "ok", "success"),
      e("e3", "br", "esc", "dispute", "danger"),
    ],
  },
];

export function templateById(id: string) {
  return AGENT_TEMPLATES.find((t) => t.id === id);
}
