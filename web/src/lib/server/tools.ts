import "server-only";
import { getDb } from "./db";
import { ingestKnowledgeDoc, searchKnowledge } from "./ai";
import { createBooking } from "./repo";
import { notifyTicket, lookupTickets, registerTicket, resolveTicket } from "./tickets";
import {
  appointmentTypes,
  logToolInvocation,
  setupStatus,
  transferTargets,
  upsertAppointmentType,
  upsertDepartment,
  upsertPlaybook,
  upsertTransfer,
} from "./workspace";
import { planAgents } from "./planner";

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
    case "lookup_ticket":
      return lookupTicketTool(orgId, args);
    case "notify_stakeholder":
      return notifyTicketTool(orgId, callId, args);
    case "resolve_ticket":
      return resolveTicketTool(orgId, args);
    case "book_slot":
      return bookSlot(orgId, args);
    case "search_knowledge": {
      const results = await searchKnowledge(orgId, String(args.query ?? ""));
      return results.length
        ? { found: true, results: results.map((r) => ({ source: r.doc, text: r.content.slice(0, 500) })) }
        : { found: false, note: "Nothing relevant in the knowledge base. Say you don't have this detail and offer a follow-up. Do not guess." };
    }
    case "transfer_to_human":
      return transferHuman(orgId, args);
    case "handoff_to_agent":
      return handoffToAgent(orgId, callId, args);
    case "end_call":
      return endCall(orgId, callId, args);

    // Swara's setup tools. Each writes a workspace row and returns what was
    // saved, so she can confirm it in half a sentence.
    case "get_setup_status": {
      const s = setupStatus(orgId);
      const d = getDb();
      return {
        business: s.playbook.businessType || "not described yet",
        use_case: String(s.playbook.extra.useCase ?? "not set"),
        hours: s.playbook.hours,
        departments: (d.prepare("SELECT name FROM departments WHERE org_id=?").all(orgId) as { name: string }[]).map((r) => r.name),
        transfer_desks: transferTargets(orgId).map((t) => `${t.name} (${t.role})`),
        appointment_types: appointmentTypes(orgId).map((a) => a.name),
        knowledge_docs: s.knowledge,
        agents: (d.prepare("SELECT name FROM agents WHERE org_id=?").all(orgId) as { name: string }[]).map((r) => r.name),
      };
    }
    case "save_playbook": {
      const p = upsertPlaybook(orgId, {
        businessType: str(args.business_type),
        hours: str(args.hours),
        transferPolicy: str(args.transfer_policy),
        bookingPolicy: str(args.booking_policy),
        complaintSlaHours: typeof args.complaint_sla_hours === "number" ? Math.round(args.complaint_sla_hours) : undefined,
        useCase: str(args.use_case),
        hasSales: typeof args.has_sales === "boolean" ? args.has_sales : undefined,
        humanEscalation: typeof args.human_escalation === "boolean" ? args.human_escalation : undefined,
      });
      return { saved: true, business: p.businessType, use_case: p.extra.useCase ?? "other", hours: p.hours };
    }
    case "add_department": {
      const name = str(args.name);
      if (!name) return { error: "Department needs a name." };
      const r = upsertDepartment(orgId, { name, keywords: strList(args.keywords) });
      return { saved: true, department: name, id: r.id };
    }
    case "add_transfer_target": {
      const phone = str(args.phone)?.replace(/[^\d+]/g, "") ?? "";
      if (phone.replace(/\D/g, "").length < 10) return { error: "That number is too short. Ask for the full 10-digit mobile and read it back." };
      const deptName = str(args.department)?.toLowerCase();
      const dept = deptName
        ? (getDb().prepare("SELECT id FROM departments WHERE org_id=? AND lower(name)=?").get(orgId, deptName) as { id: string } | undefined)
        : undefined;
      const r = upsertTransfer(orgId, {
        name: str(args.name) ?? "On-call",
        role: str(args.role) ?? "Escalation",
        phone: phone.startsWith("+") ? phone : phone.length === 10 ? `+91${phone}` : `+${phone}`,
        hours: str(args.hours),
        whenToUse: str(args.when_to_use) ?? "Caller asked for a person, or the agent is stuck",
        departmentId: dept?.id ?? null,
      });
      return { saved: true, desk: args.name, id: r.id, note: "Agents may now transfer to this person." };
    }
    case "add_appointment_type": {
      const name = str(args.name);
      if (!name) return { error: "Appointment type needs a name." };
      const r = upsertAppointmentType(orgId, {
        name,
        durationMin: typeof args.duration_min === "number" ? Math.round(args.duration_min) : 30,
        hours: str(args.hours),
        location: str(args.location),
        notes: str(args.notes),
      });
      return { saved: true, appointment_type: name, id: r.id };
    }
    case "add_knowledge": {
      const name = str(args.name);
      const text = str(args.text);
      if (!name || !text || text.length < 20) return { error: "Need a name and at least a full sentence of text." };
      const doc = await ingestKnowledgeDoc(orgId, name, "text", text);
      return { saved: true, document: name, chunks: doc.chunks, note: "Agents will search this before answering policy questions." };
    }
    case "propose_agents": {
      const brief = str(args.brief) ?? "";
      const proposed = Array.isArray(args.agents) ? (args.agents as Record<string, unknown>[]) : [];
      const plan = await planAgents(orgId, {
        brief: [
          brief,
          proposed.length
            ? `Swara proposes: ${proposed.map((a) => `${a.name} (${a.direction}, ${a.intent}): ${a.job}`).join(" | ")}`
            : "",
        ].filter(Boolean).join("\n"),
      });
      // The plan is handed to the console through the tool result. The
      // browser session surfaces it in the Build-with-Swara panel for
      // approval; nothing is created until the owner says so.
      return {
        proposed: true,
        agents: plan.agents.map((a) => `${a.name} — ${a.direction}`),
        gaps: plan.gaps,
        note: "The console is showing this plan for approval. Describe it in three sentences and ask if anything should change.",
        __plan: plan,
      };
    }
    default:
      return { error: `Unknown tool ${name}` };
  }
}

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const strList = (v: unknown) => (Array.isArray(v) ? v.map(String).map((s) => s.trim()).filter(Boolean) : undefined);

/**
 * Handoff to a sibling agent. The tool result carries a control record the
 * session runtime acts on: it swaps the persona underneath the same call and
 * feeds the summary in as a [HANDOFF: ...] marker. The model only sees a
 * confirmation, so it says its one-line bridge and stops talking.
 */
function handoffToAgent(orgId: string, callId: string | null, args: Record<string, unknown>) {
  const asked = String(args.agent_name ?? "").toLowerCase().trim();
  const rows = getDb()
    .prepare("SELECT id, name, intent FROM agents WHERE org_id=?")
    .all(orgId) as { id: string; name: string; intent: string }[];
  const target =
    rows.find((r) => r.name.toLowerCase() === asked) ??
    rows.find((r) => asked && (r.name.toLowerCase().includes(asked) || asked.includes(r.name.toLowerCase())));
  if (!target) {
    return {
      error: `No agent called "${args.agent_name}". Only hand off to a name in your AGENT DIRECTORY. Otherwise handle it yourself or take a callback.`,
    };
  }
  if (callId) {
    getDb().prepare("UPDATE calls SET agent_id=?, agent_name=?, intent=? WHERE id=? AND org_id=?")
      .run(target.id, target.name, target.intent, callId, orgId);
  }
  return {
    handed_off: true,
    to: target.name,
    note: "Stop speaking now. The other agent continues the call.",
    __control: { kind: "handoff", agentId: target.id, agentName: target.name, summary: String(args.summary ?? "") },
  };
}

/** Mark the call outcome; the runtime hangs up once the closing audio drains. */
function endCall(orgId: string, callId: string | null, args: Record<string, unknown>) {
  const outcome = String(args.outcome ?? "resolved");
  if (callId) {
    getDb().prepare("UPDATE calls SET outcome=? WHERE id=? AND org_id=? AND outcome IS NULL")
      .run(outcome === "escalated" ? "escalated" : outcome === "no_answer" ? "no_answer" : "resolved", callId, orgId);
  }
  return { ending: true, note: "Say nothing further.", __control: { kind: "end", outcome } };
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
  const filed = await registerTicket(orgId, callId, args);
  return {
    registered: true,
    reference_number: filed.ref,
    kind: filed.kind,
    routed_to: filed.routed_to,
    sla: "48 business hours",
    note: "Read the reference number back digit by digit. The caller can quote this number or their name to check status later.",
  };
}

function lookupTicketTool(orgId: string, args: Record<string, unknown>) {
  const hits = lookupTickets(orgId, {
    reference: str(args.reference_number) ?? str(args.reference),
    customerName: str(args.customer_name),
    phone: str(args.phone),
  });
  if (!hits.length) {
    return {
      found: false,
      note: "No ticket matches that reference and name. Confirm the number digit by digit, or file a new one.",
    };
  }
  const t = hits[0];
  return {
    found: true,
    reference_number: t.ref,
    kind: t.kind,
    title: t.title,
    stage: t.stage,
    customer_name: t.customerName,
    department: t.department,
    opened_at: t.openedAt,
    matches: hits.length,
    note:
      t.stage === "resolved"
        ? "This ticket is already marked done. Tell the caller that and ask if a new issue came up."
        : `Routed to ${t.department ?? "the team"}. Status is ${t.stage.replace("_", " ")}.`,
  };
}

async function notifyTicketTool(orgId: string, callId: string | null, args: Record<string, unknown>) {
  const channelRaw = String(args.channel ?? "call").toLowerCase();
  const channel =
    channelRaw === "email" || channelRaw === "whatsapp" || channelRaw === "sms" || channelRaw === "call"
      ? channelRaw
      : "call";
  return notifyTicket(orgId, {
    reference: str(args.reference_number) ?? str(args.reference),
    channel,
    targetName: str(args.target_name) ?? str(args.department),
    message: str(args.message),
    callId,
  });
}

function resolveTicketTool(orgId: string, args: Record<string, unknown>) {
  return resolveTicket(orgId, {
    reference: str(args.reference_number) ?? str(args.reference),
    note: str(args.note),
    closedBy: str(args.closed_by) ?? "agent",
  });
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
    // On a phone leg the bridge dials this number and drops out; in the
    // browser test bench it is shown as a caption.
    __control: { kind: "transfer", phone: target.phone, name: target.name },
  };
}
