import "server-only";
import { getDb, nowIso, uid } from "./db";
import { createComplaint, updateAction } from "./repo";
import { addTimelineEvent, touchCustomer } from "./customers";
import { classifyDepartment } from "./ai";
import { transferTargets } from "./workspace";
import { notifyStakeholder } from "./notify";
import { RECORDING_DISCLOSURE } from "@/lib/live/recording";

type Row = Record<string, unknown>;

export type TicketKind = "enquiry" | "complaint" | "grievance";

function digits(phone: string) {
  return phone.replace(/\D/g, "").slice(-10);
}

function nameMatch(stored: string, asked: string) {
  const a = stored.toLowerCase().trim();
  const b = asked.toLowerCase().trim();
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
}

export function lookupTickets(
  orgId: string,
  args: { reference?: string; customerName?: string; phone?: string },
) {
  const ref = (args.reference ?? "").replace(/^#/, "").trim();
  const name = (args.customerName ?? "").trim();
  const phone = digits(args.phone ?? "");
  if (!ref && !name && !phone) return [];

  const rows = getDb()
    .prepare(
      `SELECT c.*, d.name dept_name,
         (SELECT a.detail FROM actions a WHERE a.complaint_id=c.id AND a.org_id=c.org_id LIMIT 1) action_detail
       FROM complaints c
       LEFT JOIN departments d ON d.id=c.department_id
       WHERE c.org_id=?
       ORDER BY c.opened_at DESC LIMIT 50`,
    )
    .all(orgId) as Row[];

  return rows
    .filter((r) => {
      const rref = String(r.ref).replace(/^#/, "");
      const okRef = ref ? rref === ref || String(r.ref) === `#${ref}` || String(r.ref) === ref : true;
      const okName = name ? nameMatch(String(r.customer_name), name) : true;
      const okPhone = phone ? digits(String(r.phone)) === phone : true;
      if (ref && name) return okRef && okName;
      if (ref) return okRef;
      return okName && okPhone;
    })
    .slice(0, 8)
    .map(toTicket);
}

function toTicket(r: Row) {
  return {
    id: r.id as string,
    ref: r.ref as string,
    kind: ((r.kind as string) || "complaint") as TicketKind,
    title: r.title as string,
    detail: ((r.action_detail as string) || "").trim(),
    category: r.category as string,
    severity: r.severity as string,
    stage: r.stage as string,
    customerName: r.customer_name as string,
    phone: r.phone as string,
    assignee: (r.assignee as string) ?? null,
    department: (r.dept_name as string) ?? null,
    departmentId: (r.department_id as string) ?? null,
    openedAt: r.opened_at as string,
    slaDueAt: r.sla_due_at as string,
    callId: (r.call_id as string) ?? null,
  };
}

export function ticketMessages(orgId: string, complaintId: string) {
  return (
    getDb()
      .prepare(
        `SELECT * FROM ticket_messages WHERE org_id=? AND complaint_id=? ORDER BY at ASC LIMIT 200`,
      )
      .all(orgId, complaintId) as Row[]
  ).map((r) => ({
    id: r.id as string,
    direction: r.direction as string,
    channel: r.channel as string,
    toAddress: (r.to_address as string) ?? "",
    fromAddress: (r.from_address as string) ?? "",
    body: r.body as string,
    at: r.at as string,
    closedTicket: Boolean(r.closed_ticket),
  }));
}

export function addTicketMessage(params: {
  orgId: string;
  complaintId: string;
  direction: "out" | "in";
  channel: "email" | "whatsapp" | "sms" | "call" | "note";
  toAddress?: string;
  fromAddress?: string;
  body: string;
  closedTicket?: boolean;
}) {
  const id = uid("tmsg");
  getDb()
    .prepare(
      `INSERT INTO ticket_messages (id, org_id, complaint_id, direction, channel, to_address, from_address, body, at, closed_ticket)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      params.orgId,
      params.complaintId,
      params.direction,
      params.channel,
      params.toAddress ?? null,
      params.fromAddress ?? null,
      params.body,
      nowIso(),
      params.closedTicket ? 1 : 0,
    );
  return id;
}

export function captureRecordingConsent(orgId: string, callId: string, customerId?: string | null) {
  getDb()
    .prepare(
      `INSERT INTO consent_artefacts (id, org_id, call_id, customer_id, kind, captured_at, method, text)
       VALUES (?, ?, ?, ?, 'recording_disclosure', ?, 'spoken_greeting', ?)`,
    )
    .run(uid("cns"), orgId, callId, customerId ?? null, nowIso(), RECORDING_DISCLOSURE);
  getDb()
    .prepare("UPDATE complaints SET has_consent=1 WHERE org_id=? AND call_id=?")
    .run(orgId, callId);
}

export function saveRecording(params: {
  orgId: string;
  callId: string;
  objectKey: string;
  durationSec?: number;
}) {
  const retain = new Date(Date.now() + 365 * 24 * 3600_000).toISOString();
  getDb()
    .prepare(
      `INSERT INTO recordings (id, org_id, call_id, object_key, duration_sec, retain_until, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      uid("rec"),
      params.orgId,
      params.callId,
      params.objectKey,
      params.durationSec ?? null,
      retain,
      nowIso(),
    );
  getDb()
    .prepare("UPDATE complaints SET has_recording=1 WHERE org_id=? AND call_id=?")
    .run(params.orgId, params.callId);
}

export function attachPlivoUuid(orgId: string, callId: string, uuid: string) {
  getDb().prepare("UPDATE calls SET plivo_uuid=? WHERE id=? AND org_id=?").run(uuid, callId, orgId);
}

export function tagCampaignContact(orgId: string, callId: string, campaignId: string, contactId: string) {
  getDb()
    .prepare("UPDATE calls SET campaign_id=?, campaign_contact_id=? WHERE id=? AND org_id=?")
    .run(campaignId, contactId, callId, orgId);
}

/** A desk or department whose phone/email/whatsapp matches this caller. */
export function matchStaffContact(orgId: string, phone?: string, email?: string) {
  const d = digits(phone ?? "");
  const em = (email ?? "").trim().toLowerCase();
  const depts = getDb()
    .prepare("SELECT id, name, slug, keywords, email, phone, whatsapp FROM departments WHERE org_id=?")
    .all(orgId) as {
    id: string;
    name: string;
    slug: string;
    keywords: string;
    email: string | null;
    phone: string | null;
    whatsapp: string | null;
  }[];

  const targets = transferTargets(orgId);
  const hit = targets.find((t) => {
    if (d && digits(t.phone) === d) return true;
    if (em && (t.email ?? "").toLowerCase() === em) return true;
    if (d && digits(t.whatsapp ?? "") === d) return true;
    return false;
  });
  if (hit) {
    let departmentId = hit.departmentId;
    let department = hit.department;
    if (!departmentId) {
      const hay = `${hit.name} ${hit.role} ${hit.whenToUse}`.toLowerCase();
      const inferred = depts.find((dept) => {
        if (hay.includes(dept.name.toLowerCase()) || hay.includes(dept.slug.toLowerCase())) return true;
        try {
          const kw = JSON.parse(dept.keywords || "[]") as string[];
          return kw.some((k) => k.length > 2 && hay.includes(k.toLowerCase()));
        } catch {
          return false;
        }
      });
      if (inferred) {
        departmentId = inferred.id;
        department = inferred.name;
      }
    }
    return { kind: "desk" as const, ...hit, departmentId, department };
  }

  const dept = depts.find((x) => {
    if (d && x.phone && digits(x.phone) === d) return true;
    if (em && (x.email ?? "").toLowerCase() === em) return true;
    if (d && x.whatsapp && digits(x.whatsapp) === d) return true;
    return false;
  });
  if (dept) {
    return {
      kind: "department" as const,
      id: dept.id,
      name: dept.name,
      role: dept.name,
      phone: dept.phone ?? "",
      email: dept.email ?? "",
      whatsapp: dept.whatsapp ?? "",
      departmentId: dept.id,
      department: dept.name,
    };
  }
  return null;
}

export function openTicketsForDepartment(orgId: string, departmentId: string) {
  return (
    getDb()
      .prepare(
        `SELECT c.*, d.name dept_name,
           (SELECT a.detail FROM actions a WHERE a.complaint_id=c.id AND a.org_id=c.org_id LIMIT 1) action_detail
         FROM complaints c
         LEFT JOIN departments d ON d.id=c.department_id
         WHERE c.org_id=? AND c.department_id=? AND c.stage!='resolved'
         ORDER BY c.opened_at DESC LIMIT 12`,
      )
      .all(orgId, departmentId) as Row[]
  ).map(toTicket);
}

/**
 * All tickets relevant to a designated person or department desk:
 *  - tickets in their department,
 *  - tickets explicitly assigned to them or notified to their phone/email/whatsapp,
 *  - or (for a general escalation desk with no single department) all open tickets in the workspace.
 */
export function ticketsForStaff(
  orgId: string,
  staff: NonNullable<ReturnType<typeof matchStaffContact>>,
  includeResolved = false,
) {
  const rows = getDb()
    .prepare(
      `SELECT c.*, d.name dept_name,
         (SELECT a.detail FROM actions a WHERE a.complaint_id=c.id AND a.org_id=c.org_id LIMIT 1) action_detail
       FROM complaints c
       LEFT JOIN departments d ON d.id=c.department_id
       WHERE c.org_id=? ${includeResolved ? "" : "AND c.stage!='resolved'"}
       ORDER BY c.opened_at DESC LIMIT 40`,
    )
    .all(orgId) as Row[];

  const staffPhone = digits(staff.phone);
  const staffWa = digits(staff.whatsapp ?? "");
  const staffEmail = (staff.email ?? "").trim().toLowerCase();
  const notifiedIds = new Set(
    (
      getDb()
        .prepare("SELECT complaint_id, to_address FROM ticket_messages WHERE org_id=? AND direction='out'")
        .all(orgId) as { complaint_id: string; to_address: string | null }[]
    )
      .filter((m) => {
        const addr = (m.to_address ?? "").trim();
        if (!addr) return false;
        if (staffPhone && digits(addr) === staffPhone) return true;
        if (staffWa && digits(addr) === staffWa) return true;
        if (staffEmail && addr.toLowerCase() === staffEmail) return true;
        return false;
      })
      .map((m) => m.complaint_id),
  );

  const staffName = staff.name.toLowerCase();
  const staffRole = staff.role.toLowerCase();
  const scoped = rows.filter((r) => {
    if (staff.departmentId && r.department_id === staff.departmentId) return true;
    if (notifiedIds.has(String(r.id))) return true;
    const assignee = String(r.assignee ?? "").toLowerCase();
    if (assignee && (assignee.includes(staffName) || staffName.includes(assignee) || assignee.includes(staffRole))) {
      return true;
    }
    return false;
  });

  // If this designated person is a general escalation desk (not tied to a
  // single department) or has no scoped tickets yet, show the workspace's open
  // tickets so they can inspect, update, or close any complaint they call about.
  const picked = scoped.length > 0 || staff.departmentId ? scoped : rows;
  return picked.slice(0, 12).map(toTicket);
}

export function staffCallbackBlock(orgId: string, fromPhone: string) {
  const staff = matchStaffContact(orgId, fromPhone);
  if (!staff) return "";
  const open = ticketsForStaff(orgId, staff, false);
  const lines = open.length
    ? open
        .map(
          (t) =>
            `- ${t.ref} (${t.kind}, stage: ${t.stage.replace("_", " ")}, severity: ${t.severity}${t.department ? `, dept: ${t.department}` : ""}): "${t.title}"${t.detail ? ` — ${t.detail}` : ""} — customer ${t.customerName} (${t.phone})`,
        )
        .join("\n")
    : "- no open tickets right now";
  return [
    `DESIGNATED STAFF CALLER: this caller is ${staff.name} (${staff.role}${staff.department ? `, ${staff.department} department` : ""}), calling from a registered staff/desk number.`,
    `Treat ${staff.name} as a colleague, not a customer. Greet them by name and do not ask for their name or phone number.`,
    `Tickets currently in their field of view:`,
    lines,
    `How to handle their call:`,
    `- If they ask about complaints in their queue or ask for details on a specific reference, read the details clearly (or call lookup_ticket if they mention another reference).`,
    `- If they share a progress update, inspection note, ETA, or ask to mark a ticket in progress or escalated without closing it yet, call update_ticket with the reference number, stage, and their note.`,
    `- When they confirm a ticket is resolved/completed, call resolve_ticket with that reference number and a brief note of what was done.`,
    `- Do not file a new customer complaint unless they explicitly ask to log a fresh incident.`,
  ].join("\n");
}

export async function registerTicket(
  orgId: string,
  callId: string | null,
  args: Record<string, unknown>,
) {
  const title = String(args.title ?? "Ticket");
  const description = String(args.description ?? "");
  const category = String(args.category ?? "other");
  const kindRaw = String(args.kind ?? "complaint").toLowerCase();
  const kind: TicketKind =
    kindRaw === "enquiry" || kindRaw === "inquiry"
      ? "enquiry"
      : kindRaw === "grievance"
        ? "grievance"
        : "complaint";
  const dept = classifyDepartment(orgId, `${kind} ${category} ${title} ${description}`);
  const { id, ref } = createComplaint({
    orgId,
    title,
    category,
    severity: String(args.severity ?? (kind === "enquiry" ? "low" : "medium")),
    customerName: String(args.customer_name ?? "Unknown caller"),
    phone: String(args.phone ?? ""),
    callId,
    departmentId: dept.id,
    detail: description,
    kind,
  });
  addTicketMessage({
    orgId,
    complaintId: id,
    direction: "in",
    channel: "call",
    fromAddress: String(args.phone ?? ""),
    body: description || title,
  });
  return { id, ref, kind, routed_to: dept.name };
}

export function resolveTicket(
  orgId: string,
  args: { reference?: string; note?: string; closedBy?: string },
) {
  const hits = lookupTickets(orgId, { reference: args.reference });
  const ticket = hits[0];
  if (!ticket) return { error: "No ticket with that reference." as const };
  const actions = getDb()
    .prepare("SELECT id FROM actions WHERE complaint_id=? AND org_id=?")
    .all(ticket.id, orgId) as { id: string }[];
  for (const a of actions) updateAction(orgId, a.id, "done", args.closedBy ?? "agent");
  updateComplaintStage(orgId, ticket.id, "resolved");
  addTicketMessage({
    orgId,
    complaintId: ticket.id,
    direction: "in",
    channel: "note",
    body: args.note || "Marked done from a department reply.",
    closedTicket: true,
  });
  return { resolved: true, reference_number: ticket.ref, title: ticket.title };
}

export function updateTicket(
  orgId: string,
  args: { reference?: string; stage?: string; note?: string; updatedBy?: string },
) {
  if (args.stage === "resolved") {
    return resolveTicket(orgId, {
      reference: args.reference,
      note: args.note,
      closedBy: args.updatedBy,
    });
  }
  const hits = lookupTickets(orgId, { reference: args.reference });
  const ticket = hits[0];
  if (!ticket) return { error: "No ticket with that reference." as const };

  const nextStage =
    args.stage === "escalated"
      ? "escalated"
      : args.stage === "in_progress"
        ? "in_progress"
        : ticket.stage === "new"
          ? "in_progress"
          : ticket.stage;

  if (nextStage !== ticket.stage) {
    updateComplaintStage(orgId, ticket.id, nextStage);
  }
  const actions = getDb()
    .prepare("SELECT id FROM actions WHERE complaint_id=? AND org_id=? AND status='open'")
    .all(ticket.id, orgId) as { id: string }[];
  for (const a of actions) updateAction(orgId, a.id, "in_progress", args.updatedBy ?? "agent");

  const body = (args.note ?? "").trim() || `Stage updated to ${nextStage.replace("_", " ")}.`;
  addTicketMessage({
    orgId,
    complaintId: ticket.id,
    direction: "in",
    channel: "note",
    fromAddress: args.updatedBy,
    body,
    closedTicket: false,
  });
  return {
    updated: true,
    reference_number: ticket.ref,
    title: ticket.title,
    stage: nextStage,
    note_saved: body,
  };
}

export async function notifyTicket(
  orgId: string,
  args: {
    reference?: string;
    channel: "email" | "whatsapp" | "sms" | "call";
    targetName?: string;
    message?: string;
    callId?: string | null;
  },
) {
  const hits = lookupTickets(orgId, { reference: args.reference });
  const ticket = hits[0];
  if (!ticket) return { error: "No ticket with that reference. File it first." };

  const targets = transferTargets(orgId);
  const asked = (args.targetName ?? "").toLowerCase();
  const desk =
    (asked &&
      targets.find(
        (t) =>
          t.name.toLowerCase().includes(asked) ||
          t.role.toLowerCase().includes(asked) ||
          (t.department ?? "").toLowerCase().includes(asked),
      )) ||
    targets.find((t) => t.departmentId && t.departmentId === ticket.departmentId) ||
    targets[0];

  const dept = ticket.departmentId
    ? (getDb()
        .prepare("SELECT name, email, phone, whatsapp FROM departments WHERE id=?")
        .get(ticket.departmentId) as
        | { name: string; email: string | null; phone: string | null; whatsapp: string | null }
        | undefined)
    : undefined;

  const toPhone = desk?.phone || dept?.phone || "";
  const toEmail = desk?.email || dept?.email || "";
  const toWhatsapp = desk?.whatsapp || dept?.whatsapp || toPhone;
  const who = desk?.name || dept?.name || "the assigned desk";
  const body =
    args.message?.trim() ||
    `Ticket ${ticket.ref} (${ticket.kind}): ${ticket.title}. Customer ${ticket.customerName} (${ticket.phone}). Please handle and reply with this reference.`;

  const dest =
    args.channel === "email"
      ? toEmail
      : args.channel === "whatsapp"
        ? toWhatsapp
        : toPhone;
  if (!dest) {
    return {
      error: `No ${args.channel} contact for ${who}. Add an email/phone on the department or transfer desk.`,
    };
  }

  const sent = await notifyStakeholder({
    orgId,
    channel: args.channel,
    to: dest,
    subject: `${ticket.ref} — ${ticket.title}`,
    body,
    ticketRef: ticket.ref,
    callId: args.callId,
    agentHint: `You are calling ${who} about ticket ${ticket.ref} (${ticket.kind}): ${ticket.title}. Customer ${ticket.customerName}, ${ticket.phone}. Brief them in two sentences and ask them to call or email back with this reference when done.`,
  });

  addTicketMessage({
    orgId,
    complaintId: ticket.id,
    direction: "out",
    channel: args.channel,
    toAddress: dest,
    body,
  });
  getDb()
    .prepare("UPDATE complaints SET stage=CASE WHEN stage='new' THEN 'in_progress' ELSE stage END WHERE id=?")
    .run(ticket.id);

  return {
    notified: sent.ok,
    channel: args.channel,
    to: who,
    address: dest,
    reference_number: ticket.ref,
    note: sent.ok
      ? `Tell the caller you have informed ${who} on ${args.channel}.`
      : sent.error,
  };
}

/** Inbound email/WhatsApp/SMS from a desk. Closes the ticket when the sender matches a registered contact and a ref is present. */
export function ingestInboundReply(params: {
  orgId?: string;
  from: string;
  body: string;
  channel: "email" | "whatsapp" | "sms";
  subject?: string;
}) {
  const text = `${params.subject ?? ""} ${params.body}`;
  const refHit = text.match(/#?\b(\d{5,6})\b/);
  const orgs = params.orgId
    ? [{ id: params.orgId }]
    : (getDb().prepare("SELECT id FROM orgs").all() as { id: string }[]);

  for (const org of orgs) {
    const staff = matchStaffContact(org.id, params.from, params.from);
    const tickets = refHit?.[1]
      ? lookupTickets(org.id, { reference: refHit[1], phone: params.from })
      : staff
        ? ticketsForStaff(org.id, staff, false)
        : lookupTickets(org.id, { phone: params.from });
    const ticket = tickets[0];
    if (!ticket) continue;
    addTicketMessage({
      orgId: org.id,
      complaintId: ticket.id,
      direction: "in",
      channel: params.channel,
      fromAddress: params.from,
      body: params.body.slice(0, 4000),
      closedTicket: Boolean(staff),
    });
    if (staff) {
      resolveTicket(org.id, {
        reference: ticket.ref,
        note: `Closed from ${params.channel} reply by ${staff.name}: ${params.body.slice(0, 240)}`,
        closedBy: staff.name,
      });
      return { ok: true, closed: true, ref: ticket.ref, orgId: org.id };
    }
    // Not a desk — the customer wrote back. That is a real contact on a
    // real channel, so it belongs on their 360 timeline.
    const customerId = touchCustomer({
      orgId: org.id, phone: ticket.phone, name: ticket.customerName, channel: params.channel,
    });
    if (customerId) {
      addTimelineEvent({
        customerId, kind: params.channel,
        title: `Replied about ${ticket.ref} on ${params.channel}`,
        detail: params.body.slice(0, 240),
      });
    }
    return { ok: true, closed: false, ref: ticket.ref, orgId: org.id };
  }
  return { ok: false, error: "No matching ticket" };
}

export function updateComplaintStage(orgId: string, id: string, stage: string) {
  const row = getDb()
    .prepare("SELECT id, ref, phone, customer_name, title, stage FROM complaints WHERE id=? AND org_id=?")
    .get(id, orgId) as { id: string; ref: string; phone: string; customer_name: string; title: string; stage: string } | undefined;
  if (!row) return { error: "Not found" as const };
  if (row.stage === stage) return { error: null } as const;
  getDb().prepare("UPDATE complaints SET stage=? WHERE id=? AND org_id=?").run(stage, id, orgId);
  if (stage === "resolved") {
    const actions = getDb()
      .prepare("SELECT id FROM actions WHERE complaint_id=? AND org_id=? AND status!='done'")
      .all(id, orgId) as { id: string }[];
    for (const a of actions) updateAction(orgId, a.id, "done", "console");
  }
  // Customer 360 sees the stage change too, so "what happened to my
  // complaint" is answerable from the timeline alone.
  // A stage change is our action, not a customer contact — do not move last_channel.
  const customerId = touchCustomer({ orgId, phone: row.phone, name: row.customer_name });
  if (customerId) {
    addTimelineEvent({
      customerId, kind: "complaint",
      title: `Ticket ${row.ref} ${stage === "resolved" ? "resolved" : stage === "escalated" ? "escalated" : `moved to ${stage.replace("_", " ")}`}`,
      detail: row.title,
      sentiment: stage === "resolved" ? "positive" : undefined,
    });
  }
  return { error: null } as const;
}
