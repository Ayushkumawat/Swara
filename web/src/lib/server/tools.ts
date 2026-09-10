import "server-only";
import { getDb } from "./db";
import { classifyDepartment, searchKnowledge } from "./ai";
import { createBooking, createComplaint } from "./repo";
import { compileFlow } from "@/lib/agents/compile-flow";
import { appointmentTypes, logToolInvocation, transferTargets } from "./workspace";
import type { FlowEdge, FlowNode } from "@/lib/api/schemas";

/**
 * The agent's hands.
 *
 * The function *declarations* live in `lib/live/config.ts` (shared config,
 * baked into the ephemeral token's constraints so the model knows the tools
 * exist). Execution always happens here, on the server, against our database
 * or the tenant's connector. The browser only ferries the call — a tool that
 * executed client-side would let anyone with devtools register complaints as
 * arbitrary customers.
 *
 * These four cover the demo narratives end to end: an order enquiry pulls real
 * data, a grievance produces a reference number and lands in the right
 * department's queue while the caller is still on the line, a booking lands on
 * the calendar, and policy questions search the knowledge base.
 */

/** Everything a tool returns is spoken aloud by the model, so results are
 *  small, flat objects with plain-language values — not API payloads. */
export async function executeTool(
  orgId: string,
  callId: string | null,
  name: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const result = await runTool(orgId, callId, name, args);
  try {
    logToolInvocation(orgId, callId, name, args, result);
  } catch (error) {
    console.error("[tools] invocation log failed:", error);
  }
  return result;
}

async function runTool(
  orgId: string,
  callId: string | null,
  name: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  switch (name) {
    case "lookup_order":
      return lookupOrder(orgId, args);
    case "register_complaint":
      return registerComplaint(orgId, callId, args);
    case "book_slot":
      return bookSlot(orgId, args);
    case "search_knowledge": {
      const agentId = agentIdForCall(orgId, callId);
      const results = await searchKnowledge(orgId, String(args.query ?? ""), 4, agentId);
      return results.length
        ? { found: true, results: results.map((r) => ({ source: r.doc, text: r.content.slice(0, 500) })) }
        : { found: false, note: "Nothing relevant in this agent's knowledge base. Say you don't have this detail and offer a follow-up. Do not guess." };
    }
    case "transfer_to_human":
      return transferHuman(orgId, args);
    case "transfer_to_agent":
      return transferAgent(orgId, callId, args);
    case "end_call":
      return { ended: true, hangup: true, reason: String(args.reason ?? "done"), note: "Stop speaking. The line will close." };
    case "note_setup_answer":
      return noteSetup(orgId, args);
    case "apply_setup_plan":
      return await applySetupFromCall(orgId);
    default:
      return { error: `Unknown tool ${name}` };
  }
}

/**
 * Order lookup, via whichever connector the tenant configured.
 *
 * `rest`: we call their endpoint with their credential. This is the honest
 * answer to "how do we connect to their database": we don't — they expose a
 * read endpoint and we call it per enquiry. See docs/backend.md for why direct
 * DB credentials were rejected.
 *
 * `demo`: deterministic synthetic orders so the demo org works with no setup.
 */
async function lookupOrder(orgId: string, args: Record<string, unknown>) {
  const connector = getDb()
    .prepare("SELECT * FROM connectors WHERE org_id=? AND tool='lookup_order' AND status='connected'")
    .get(orgId) as
    | { kind: string; base_url: string | null; auth_header: string | null; auth_secret: string | null }
    | undefined;

  if (!connector) {
    return { error: "No order system connected. Apologise and offer a callback after checking manually." };
  }

  const orderId = String(args.order_id ?? "").trim();
  const phone = String(args.phone ?? "").trim();

  if (connector.kind === "rest" && connector.base_url) {
    try {
      const url = new URL(connector.base_url);
      if (orderId) url.searchParams.set("order_id", orderId);
      if (phone) url.searchParams.set("phone", phone);
      const response = await fetch(url, {
        headers: connector.auth_header && connector.auth_secret
          ? { [connector.auth_header]: connector.auth_secret }
          : undefined,
        // A slow tenant API is dead air on a live call. Better to time out and
        // have the agent offer an SMS follow-up than to hold silence.
        signal: AbortSignal.timeout(4000),
      });
      if (!response.ok) return { error: `Order system returned ${response.status}. Offer a callback.` };
      return (await response.json()) as Record<string, unknown>;
    } catch {
      return { error: "Order system is not responding. Offer to confirm by SMS after checking." };
    }
  }

  // Demo connector: stable fake orders keyed by the digits given, so repeating
  // the same ID mid-call returns the same answer.
  const key = orderId || phone;
  if (!key) return { error: "Need an order ID or registered phone number." };
  const digits = key.replace(/\D/g, "") || "0";
  const h = [...digits].reduce((a, c) => (a * 31 + Number(c)) % 997, 7);
  const statuses = [
    { status: "out for delivery", eta: "today between 4pm and 7pm" },
    { status: "shipped", eta: "tomorrow by 8pm" },
    { status: "packed at warehouse", eta: "in 2-3 days" },
    { status: "delivered", eta: "already delivered yesterday at 2:41pm" },
    { status: "delayed at hub", eta: "revised to day after tomorrow; delay SMS already sent" },
  ];
  const s = statuses[h % statuses.length];
  return {
    order_id: orderId || `ORD-${digits.slice(-5).padStart(5, "0")}`,
    status: s.status,
    expected: s.eta,
    amount_inr: 499 + (h % 35) * 100,
    payment: h % 3 === 0 ? "cash on delivery" : "prepaid",
    items: 1 + (h % 3),
  };
}

async function registerComplaint(orgId: string, callId: string | null, args: Record<string, unknown>) {
  const title = String(args.title ?? "Complaint");
  const description = String(args.description ?? "");
  const category = String(args.category ?? "other");
  const dept = classifyDepartment(orgId, `${category} ${title} ${description}`);

  const { ref } = createComplaint({
    orgId,
    title,
    category,
    severity: String(args.severity ?? "medium"),
    customerName: String(args.customer_name ?? "Unknown caller"),
    phone: String(args.phone ?? ""),
    callId,
    departmentId: dept.id,
    detail: description,
  });

  return {
    registered: true,
    reference_number: ref,
    routed_to: dept.name,
    sla: "48 business hours",
    note: "Read the reference number back digit by digit and mention SMS + email confirmation.",
  };
}

async function bookSlot(orgId: string, args: Record<string, unknown>) {
  const date = String(args.date ?? "");
  const window = String(args.time_window ?? "");
  const typeName = String(args.type ?? "Appointment");
  const types = appointmentTypes(orgId);
  const match = types.find((t) => t.name.toLowerCase() === typeName.toLowerCase()) ?? types[0];
  if (types.length && !types.some((t) => t.name.toLowerCase() === typeName.toLowerCase())) {
    return {
      error: `That type is not offered. Available: ${types.map((t) => t.name).join(", ")}. Offer one of those.`,
    };
  }

  const startHour = window.match(/^(\d{1,2})/)?.[1] ?? "10";
  const startsAt = new Date(`${date}T${startHour.padStart(2, "0")}:00:00+05:30`);
  if (Number.isNaN(startsAt.getTime())) {
    return { error: "Could not parse the date. Confirm the exact date with the caller." };
  }

  createBooking({
    orgId,
    customerName: String(args.customer_name ?? "Unknown"),
    phone: String(args.phone ?? ""),
    type: match?.name ?? typeName,
    startsAt: startsAt.toISOString(),
    durationMin: match?.durationMin ?? 60,
    source: "call",
  });

  return {
    booked: true,
    date,
    time_window: window,
    note: "Read the slot back and mention the SMS confirmation.",
  };
}

function transferHuman(orgId: string, args: Record<string, unknown>) {
  const targets = transferTargets(orgId);
  if (targets.length === 0) {
    return {
      error: "No transfer desk is configured. Take a callback number and say someone will call them back. Do not invent a person.",
    };
  }
  const asked = String(args.target_name ?? "").toLowerCase();
  const target =
    (asked && targets.find((t) => t.name.toLowerCase().includes(asked) || t.role.toLowerCase().includes(asked))) ||
    targets[0];
  return {
    transferred: true,
    to: target.name,
    role: target.role,
    phone: target.phone,
    hours: target.hours,
    reason: String(args.reason ?? ""),
    note: `Tell the caller you are connecting them to ${target.name}, ${target.role}. Do not read the full number unless they ask.`,
  };
}

function agentIdForCall(orgId: string, callId: string | null) {
  if (!callId) return null;
  const row = getDb()
    .prepare("SELECT agent_id FROM calls WHERE id=? AND org_id=?")
    .get(callId, orgId) as { agent_id: string | null } | undefined;
  return row?.agent_id ?? null;
}

function transferAgent(orgId: string, callId: string | null, args: Record<string, unknown>) {
  const asked = String(args.agent_name ?? "").trim().toLowerCase();
  const rows = getDb()
    .prepare("SELECT id, name, intent, prompt, nodes, edges FROM agents WHERE org_id=? AND status!='paused'")
    .all(orgId) as { id: string; name: string; intent: string; prompt: string | null; nodes: string; edges: string }[];
  const match =
    rows.find((a) => a.name.toLowerCase() === asked || a.id.toLowerCase() === asked) ||
    rows.find((a) => a.name.toLowerCase().includes(asked) || a.intent.toLowerCase().includes(asked));
  if (!match) {
    return {
      error: "No matching agent. Stay on this line or take a callback. Do not invent a specialist.",
    };
  }

  if (callId) {
    getDb().prepare("UPDATE calls SET agent_id=?, agent_name=? WHERE id=? AND org_id=?").run(match.id, match.name, callId, orgId);
  }

  const docs = getDb()
    .prepare(
      "SELECT name FROM knowledge_docs WHERE org_id=? AND (agent_id=? OR agent_id IS NULL) LIMIT 8",
    )
    .all(orgId, match.id) as { name: string }[];

  let nodes: FlowNode[] = [];
  let edges: FlowEdge[] = [];
  try {
    nodes = JSON.parse(match.nodes || "[]") as FlowNode[];
    edges = JSON.parse(match.edges || "[]") as FlowEdge[];
  } catch {
    /* keep empty */
  }

  return {
    transferred: true,
    become: match.name,
    intent: match.intent,
    role: match.prompt ?? `You now handle ${match.name}.`,
    procedure: compileFlow(nodes, edges),
    knowledge_docs: docs.map((d) => d.name),
    reason: String(args.reason ?? ""),
    note: `You ARE now ${match.name}. Do not mention the handoff again. Follow the procedure above. Search knowledge for this agent's topics. If they need something else, transfer again. When finished, say goodbye and call end_call.`,
  };
}

function noteSetup(orgId: string, args: Record<string, unknown>) {
  // Lazy import: setup-coach imports getDb too.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { recordFact } = require("./setup-coach") as typeof import("./setup-coach");
  recordFact(orgId, String(args.topic ?? "note"), String(args.answer ?? ""));
  return { saved: true, note: "Ask the next edge-case question. Do not dump a questionnaire." };
}

async function applySetupFromCall(orgId: string) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { applyStoredPlan } = require("./setup-coach") as typeof import("./setup-coach");
  return applyStoredPlan(orgId);
}
