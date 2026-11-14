import "server-only";
import { getDb, nowIso, uid } from "./db";
import { createComplaint, updateAction } from "./repo";
import { addTimelineEvent, touchCustomer } from "./customers";
import { classifyDepartment } from "./ai";
import { defaultPerson, playbook, transferTargets, type Person } from "./workspace";
import { notifyStakeholder } from "./notify";
import { RECORDING_DISCLOSURE } from "@/lib/live/recording";
import { UNASSIGNED_DEPARTMENT } from "@/lib/agents/departments";
import { informsAfterCall, normaliseHumanMode } from "@/lib/agents/human-mode";

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
    .prepare("SELECT id, name, slug, keywords, email, phone, whatsapp FROM departments WHERE org_id=? AND slug!=?")
    .all(orgId, UNASSIGNED_DEPARTMENT.slug) as {
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
    // An email-only person has no phone on file; an empty number must never
    // match a caller whose number we could not read.
    if (d.length === 10 && digits(t.phone) === d) return true;
    if (em && (t.email ?? "").toLowerCase() === em) return true;
    if (d.length === 10 && digits(t.whatsapp ?? "") === d) return true;
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
  /** Set by the server, never by the model: the person this is already known to be for. */
  opts: { owner?: Person | null } = {},
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
  // No team owns it: it sits in the Unassigned queue and goes to the default
  // person, if the business named one.
  const owner = opts.owner ?? (dept.unassigned ? defaultPerson(orgId) : null);
  // A ticket for a named person sits with their team when they have one.
  const departmentId = opts.owner?.departmentId && dept.unassigned ? opts.owner.departmentId : dept.id;
  const { id, ref } = createComplaint({
    orgId,
    title,
    category,
    severity: String(args.severity ?? (kind === "enquiry" ? "low" : "medium")),
    customerName: String(args.customer_name ?? "Unknown caller"),
    phone: String(args.phone ?? ""),
    callId,
    departmentId,
    detail: description,
    kind,
    assignee: owner?.name ?? null,
  });
  addTicketMessage({
    orgId,
    complaintId: id,
    direction: "in",
    channel: "call",
    fromAddress: String(args.phone ?? ""),
    body: description || title,
  });
  // What the agent may say aloud. "Unassigned" is our word for a queue, not
  // something a caller should hear.
  return { id, ref, kind, routed_to: dept.unassigned ? owner?.name ?? "the team" : dept.name };
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

/* ── who a piece of work belongs to, and how to reach them ───────────────── */

type TeamContact = { id: string; name: string; email: string; phone: string; whatsapp: string };

/** A team's shared inbox, if it has one. The Unassigned queue never does. */
function teamContact(orgId: string, departmentId: string | null | undefined): TeamContact | null {
  if (!departmentId) return null;
  const r = getDb()
    .prepare("SELECT id, slug, name, email, phone, whatsapp FROM departments WHERE id=? AND org_id=?")
    .get(departmentId, orgId) as
    | { id: string; slug: string; name: string; email: string | null; phone: string | null; whatsapp: string | null }
    | undefined;
  if (!r || r.slug === UNASSIGNED_DEPARTMENT.slug) return null;
  const team = { id: r.id, name: r.name, email: (r.email ?? "").trim(), phone: (r.phone ?? "").trim(), whatsapp: (r.whatsapp ?? "").trim() };
  return team.email || team.phone || team.whatsapp ? team : null;
}

/**
 * Who should hear about a ticket or a follow-up: the person it is assigned
 * to, else someone on the team that owns it, else that team's shared inbox,
 * else the business's default person. Either side can be null — a business
 * that listed nobody has nobody to tell, and we say so rather than pretend.
 */
export function ownerOf(orgId: string, work: { assignee?: string | null; departmentId?: string | null }) {
  const people = transferTargets(orgId);
  const assignee = (work.assignee ?? "").trim().toLowerCase();
  const team = teamContact(orgId, work.departmentId);
  const person =
    (assignee ? people.find((p) => p.name.toLowerCase() === assignee) : undefined) ??
    (work.departmentId ? people.find((p) => p.departmentId === work.departmentId) : undefined) ??
    (team ? undefined : defaultPerson(orgId) ?? undefined) ??
    null;
  return { person, team: person ? null : team };
}

type Owner = ReturnType<typeof ownerOf>;
type Route = { channel: "email" | "call"; to: string };

/** The channels a recipient asked for: their ticks, or the team's inbox. */
function routesFor(owner: Owner): { who: string; routes: Route[] } | null {
  const { person, team } = owner;
  if (person) {
    const routes: Route[] = [];
    if (person.contactEmail) routes.push({ channel: "email", to: person.email });
    if (person.contactCalls) routes.push({ channel: "call", to: person.phone });
    return routes.length ? { who: person.name, routes } : null;
  }
  if (team) {
    // A shared inbox is an email address first; the desk line is the fallback.
    if (team.email) return { who: `${team.name} team`, routes: [{ channel: "email", to: team.email }] };
    if (team.phone) return { who: `${team.name} team`, routes: [{ channel: "call", to: team.phone }] };
  }
  return null;
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

  const people = transferTargets(orgId);
  const asked = (args.targetName ?? "").trim().toLowerCase();
  const named = asked
    ? people.find(
        (t) =>
          t.name.toLowerCase().includes(asked) ||
          t.role.toLowerCase().includes(asked) ||
          (t.department ?? "").toLowerCase().includes(asked),
      )
    : undefined;
  const { person, team } = named ? { person: named, team: null } : ownerOf(orgId, ticket);
  const who = person?.name ?? (team ? `${team.name} team` : "");
  if (!who) {
    return {
      error:
        "Nobody is set up to be informed about this. Tell the caller it is logged and the team will get back to them; do not say a named person has been told.",
    };
  }

  // A person is reached the way they ticked, never the way the agent guessed.
  const reach: Record<"email" | "whatsapp" | "sms" | "call", string> = person
    ? {
        call: person.contactCalls ? person.phone : "",
        email: person.contactEmail ? person.email : "",
        whatsapp: person.whatsapp || (person.contactCalls ? person.phone : ""),
        sms: person.contactCalls ? person.phone : "",
      }
    : {
        call: team?.phone ?? "",
        email: team?.email ?? "",
        whatsapp: team?.whatsapp || team?.phone || "",
        sms: team?.phone ?? "",
      };
  let channel = args.channel;
  let dest = reach[channel];
  let switched = false;
  if (!dest) {
    const alt = (["email", "call"] as const).find((c) => c !== channel && reach[c]);
    if (alt) {
      channel = alt;
      dest = reach[alt];
      switched = true;
    }
  }
  if (!dest) {
    return { error: `There is no way to reach ${who} by ${args.channel}. Tell the caller it is logged and the team will get back to them.` };
  }

  const body =
    args.message?.trim() ||
    `Ticket ${ticket.ref} (${ticket.kind}): ${ticket.title}. Customer ${ticket.customerName} (${ticket.phone}). Please handle and reply with this reference.`;

  const sent = await notifyStakeholder({
    orgId,
    channel,
    to: dest,
    subject: `${ticket.ref} — ${ticket.title}`,
    body,
    ticketRef: ticket.ref,
    callId: args.callId,
    agentHint: `You are calling ${who} about ticket ${ticket.ref} (${ticket.kind}): ${ticket.title}. Customer ${ticket.customerName}, ${ticket.phone}. Brief them in two sentences and ask them to call or email back with this reference when done.`,
  });

  recordContact(orgId, ticket.id, { who, channel, to: dest, body, delivered: sent.delivered, reason: sent.error });
  if (sent.delivered) {
    getDb()
      .prepare("UPDATE complaints SET stage=CASE WHEN stage='new' THEN 'in_progress' ELSE stage END WHERE id=? AND org_id=?")
      .run(ticket.id, orgId);
  }

  return {
    notified: sent.delivered,
    channel,
    to: who,
    address: dest,
    reference_number: ticket.ref,
    note: sent.delivered
      ? `Tell the caller you have informed ${who}${switched ? ` (by ${channel} — that is how ${who} takes messages)` : ` by ${channel}`}.`
      : `This is saved on the ticket for ${who} but could not be sent right now. Tell the caller it is logged and the team will get back to them; do not say ${who} has been informed.`,
  };
}

/**
 * Write down an attempt to reach someone about a ticket. A message that was
 * delivered is an outbound message on that channel; one that was not is a
 * note saying so — so the ticket never claims someone was told when they
 * were not, and the after-call step knows it still has to try.
 */
function recordContact(
  orgId: string,
  complaintId: string,
  c: { who: string; channel: "email" | "whatsapp" | "sms" | "call"; to: string; body: string; delivered: boolean; reason?: string },
) {
  if (c.delivered) {
    addTicketMessage({ orgId, complaintId, direction: "out", channel: c.channel, toAddress: c.to, body: c.body });
    return;
  }
  addTicketMessage({
    orgId,
    complaintId,
    direction: "out",
    channel: "note",
    toAddress: c.to,
    body: `Not sent — ${c.who} was to be reached by ${c.channel} at ${c.to}. ${c.reason ?? "Delivery failed."}\n\n${c.body}`,
  });
}

const REACHED_SQL = "direction='out' AND channel IN ('call','email','whatsapp','sms')";

function notifyConsole(orgId: string, n: { title: string; body: string; severity: "low" | "medium" | "high"; href: string }) {
  getDb()
    .prepare(
      `INSERT INTO notifications (id, org_id, kind, title, body, at, severity, read, href)
       VALUES (?, ?, 'complaint', ?, ?, ?, ?, 0, ?)`,
    )
    .run(uid("ntf"), orgId, n.title, n.body.slice(0, 240), nowIso(), n.severity, n.href);
}

type Item = {
  /** Set when the item is a ticket; a bare follow-up has no ticket thread. */
  complaintId: string | null;
  ref: string | null;
  kind: string;
  title: string;
  detail: string;
  severity: string;
};

function describe(items: Item[], customer: string, phone: string, summary: string) {
  const lines = items.map((i) => {
    const label = i.ref ? `${i.ref} (${i.kind})` : "Follow-up";
    return `- ${label}: ${i.title}${i.detail && i.detail !== i.title ? `\n  ${i.detail}` : ""}`;
  });
  return [
    `A call with ${customer}${phone ? ` (${phone})` : ""} just ended and left ${items.length === 1 ? "something" : `${items.length} things`} for you.`,
    "",
    ...lines,
    ...(summary ? ["", `What happened on the call: ${summary}`] : []),
    "",
    items.some((i) => i.ref)
      ? "When it is done, reply to this message or call our number and quote the reference — the ticket closes itself."
      : "Open the queue in Swara to mark it done.",
  ].join("\n");
}

/**
 * Tell one recipient about a set of items on every channel they asked for.
 * `dryRun` is a browser test call: nothing is sent, and the ticket says what
 * would have been.
 */
async function inform(
  orgId: string,
  callId: string | null,
  to: { who: string; routes: Route[] },
  items: Item[],
  ctx: { customer: string; phone: string; summary: string; lead?: string; dryRun?: boolean },
) {
  const first = items[0];
  const subject = first.ref ? `${first.ref} — ${first.title}` : `Follow-up needed — ${first.title}`;
  const body = `${ctx.lead ? `${ctx.lead}\n\n` : ""}${describe(items, ctx.customer, ctx.phone, ctx.summary)}`;
  const spoken = items
    .map((i) => `${i.ref ? `ticket ${i.ref}, ` : ""}${i.title}`)
    .join("; ");
  const done: string[] = [];
  const failed: string[] = [];

  for (const route of to.routes) {
    if (ctx.dryRun) {
      for (const i of items) {
        if (!i.complaintId) continue;
        addTicketMessage({
          orgId, complaintId: i.complaintId, direction: "out", channel: "note", toAddress: route.to,
          body: `Test call — on a real call ${to.who} would now get ${route.channel === "call" ? "a call" : "an email"} at ${route.to} about this. Nothing was sent.`,
        });
      }
      continue;
    }
    const sent = await notifyStakeholder({
      orgId,
      channel: route.channel,
      to: route.to,
      subject,
      body,
      ticketRef: first.ref ?? "",
      callId,
      agentHint: `You are calling ${to.who}, a colleague, right after a customer call. ${ctx.lead ?? ""} Customer: ${ctx.customer}${ctx.phone ? `, ${ctx.phone}` : ""}. What needs their attention: ${spoken}. Brief them in two or three sentences, give the reference number if there is one, and ask them to call or email back with it once it is handled.`,
    });
    for (const i of items) {
      if (i.complaintId) {
        recordContact(orgId, i.complaintId, { who: to.who, channel: route.channel, to: route.to, body, delivered: sent.delivered, reason: sent.error });
      }
    }
    (sent.delivered ? done : failed).push(route.channel === "call" ? "a call" : "email");
  }
  return { done, failed };
}

/**
 * How a missed live transfer is marked on its ticket. That ticket's person
 * was told (or the attempt failed and the owner was alerted) the moment the
 * transfer rang out, so the after-call step leaves it alone.
 */
const MISSED_TRANSFER_MARK = "Live transfer was not answered";

/** The name the caller gave the agent, when the call row itself has none. */
function callerNameFromTickets(orgId: string, callId: string) {
  const row = getDb()
    .prepare(
      "SELECT customer_name FROM complaints WHERE org_id=? AND call_id=? AND customer_name IS NOT NULL AND trim(customer_name)!='' AND customer_name!='Unknown caller' ORDER BY opened_at LIMIT 1",
    )
    .get(orgId, callId) as { customer_name: string } | undefined;
  return row?.customer_name.trim() || "";
}

/**
 * The automatic step when a call ends: whoever owns what the call left
 * behind is told, the way they asked to be (their Calls / Email ticks).
 *
 * Runs only for agents set to inform after the call. A ticket somebody was
 * already reached about during the call — a live transfer, or the agent
 * notifying them — is left alone; nobody is told twice.
 */
export async function informAfterCall(orgId: string, callId: string) {
  const db = getDb();
  const call = db
    .prepare(
      `SELECT c.source, c.phone, c.customer_name, c.summary, a.id agent_row, a.human_mode
       FROM calls c LEFT JOIN agents a ON a.id=c.agent_id AND a.org_id=c.org_id
       WHERE c.id=? AND c.org_id=?`,
    )
    .get(callId, orgId) as
    | {
        source: string; phone: string | null; customer_name: string | null; summary: string | null;
        agent_row: string | null; human_mode: string | null;
      }
    | undefined;
  // A built-in demo agent has no row and no setting: it informs nobody, as before.
  if (!call || !call.agent_row) return { informed: 0 };
  if (!informsAfterCall(normaliseHumanMode(call.human_mode))) return { informed: 0 };
  if (playbook(orgId).extra.humanEscalation === false) return { informed: 0 };
  // The other party on this call was one of the business's own people — a
  // briefing call we placed, or a colleague phoning in about their tickets.
  // Informing them about their own call would ring them again, and that
  // call would ring them again after it.
  if (call.phone && matchStaffContact(orgId, call.phone)) return { informed: 0 };

  const tickets = db
    .prepare(
      `SELECT c.id, c.ref, c.kind, c.title, c.severity, c.assignee, c.department_id,
         (SELECT a.detail FROM actions a WHERE a.complaint_id=c.id AND a.org_id=c.org_id LIMIT 1) detail
       FROM complaints c
       WHERE c.org_id=? AND c.call_id=? AND c.stage!='resolved'
         AND NOT EXISTS (SELECT 1 FROM ticket_messages m WHERE m.complaint_id=c.id AND m.org_id=c.org_id AND ${REACHED_SQL})
         AND NOT EXISTS (SELECT 1 FROM ticket_messages m WHERE m.complaint_id=c.id AND m.org_id=c.org_id AND m.channel='note' AND m.body LIKE ?)`,
    )
    .all(orgId, callId, `${MISSED_TRANSFER_MARK}%`) as {
    id: string; ref: string; kind: string | null; title: string; severity: string; assignee: string | null;
    department_id: string | null; detail: string | null;
  }[];
  // Follow-ups the analysis found on a call where no ticket was filed.
  const followUps = db
    .prepare(
      "SELECT id, title, detail, severity, department_id FROM actions WHERE org_id=? AND call_id=? AND complaint_id IS NULL AND status!='done'",
    )
    .all(orgId, callId) as { id: string; title: string; detail: string; severity: string; department_id: string }[];
  if (!tickets.length && !followUps.length) return { informed: 0 };

  // One message per person, however many things the call left for them.
  const groups = new Map<string, { to: { who: string; routes: Route[] }; items: Item[] }>();
  const orphans: Item[] = [];
  const place = (item: Item, work: { assignee?: string | null; departmentId?: string | null }) => {
    const to = routesFor(ownerOf(orgId, work));
    if (!to) return void orphans.push(item);
    const group = groups.get(to.who) ?? { to, items: [] };
    group.items.push(item);
    groups.set(to.who, group);
  };
  for (const t of tickets) {
    place(
      { complaintId: t.id, ref: t.ref, kind: t.kind || "complaint", title: t.title, detail: (t.detail ?? "").trim(), severity: t.severity },
      { assignee: t.assignee, departmentId: t.department_id },
    );
  }
  for (const f of followUps) {
    place(
      { complaintId: null, ref: null, kind: "follow-up", title: f.title, detail: (f.detail ?? "").trim(), severity: f.severity },
      { departmentId: f.department_id },
    );
  }

  const customer = call.customer_name?.trim() || callerNameFromTickets(orgId, callId) || "a caller";
  const ctx = { customer, phone: call.phone ?? "", summary: (call.summary ?? "").trim(), dryRun: call.source !== "phone" };
  let informed = 0;
  for (const { to, items } of groups.values()) {
    const { done, failed } = await inform(orgId, callId, to, items, ctx);
    if (ctx.dryRun) continue;
    const what = items.length === 1 ? items[0].ref ?? items[0].title : `${items.length} items`;
    const href = items.some((i) => i.ref) ? "/complaints" : "/queue";
    if (done.length) {
      informed += 1;
      notifyConsole(orgId, {
        title: `${to.who} informed by ${done.join(" and ")} — ${what}`,
        body: `After the call with ${customer}: ${items.map((i) => i.title).join("; ")}`,
        severity: "low",
        href,
      });
    }
    if (failed.length) {
      notifyConsole(orgId, {
        title: `Could not reach ${to.who} by ${failed.join(" or ")} — ${what}`,
        body: `After the call with ${customer}. It is saved on the ticket; please pass it on yourself. ${items.map((i) => i.title).join("; ")}`,
        severity: "high",
        href,
      });
    }
  }
  if (orphans.length && !ctx.dryRun) {
    for (const i of orphans) {
      if (!i.complaintId) continue;
      addTicketMessage({
        orgId, complaintId: i.complaintId, direction: "out", channel: "note",
        body: "Nobody was informed: no person or team inbox is set up for this. Add a person in Workspace setup and mark them as the default contact.",
      });
    }
    notifyConsole(orgId, {
      title: `Nobody to inform about ${orphans.length === 1 ? orphans[0].ref ?? orphans[0].title : `${orphans.length} items`}`,
      body: `The call with ${customer} left work that no person or team inbox covers. Add a person in Workspace setup and mark them as the default contact.`,
      severity: "medium",
      href: "/setup",
    });
  }
  return { informed };
}

/**
 * A live transfer rang out: the person did not pick up, was busy, or the
 * call failed. The caller has been told to expect a callback, so make that
 * true — there is a ticket with the person's name on it and they are told
 * about it the way they ticked, whatever the agent's own setting is.
 *
 * Safe to call twice for the same call.
 */
export async function transferMissed(orgId: string, callId: string, targetName?: string, dialStatus?: string) {
  const db = getDb();
  const call = db
    .prepare("SELECT source, phone, customer_name, summary FROM calls WHERE id=? AND org_id=?")
    .get(callId, orgId) as
    | { source: string; phone: string | null; customer_name: string | null; summary: string | null }
    | undefined;
  if (!call) return { error: "No such call" as const };

  const MARK = MISSED_TRANSFER_MARK;
  const already = db
    .prepare(
      `SELECT 1 FROM ticket_messages m JOIN complaints c ON c.id=m.complaint_id
       WHERE c.org_id=? AND c.call_id=? AND m.channel='note' AND m.body LIKE ? LIMIT 1`,
    )
    .get(orgId, callId, `${MARK}%`);
  if (already) return { handled: true, duplicate: true };

  const people = transferTargets(orgId);
  const asked = (targetName ?? "").trim().toLowerCase();
  const person: Person | null =
    (asked ? people.find((p) => p.name.toLowerCase() === asked) ?? people.find((p) => p.name.toLowerCase().includes(asked)) : undefined) ??
    null;
  const whoName = person?.name ?? (targetName?.trim() || "the person");
  const customer = call.customer_name?.trim() || callerNameFromTickets(orgId, callId) || "Unknown caller";
  // "cancel" is the carrier's word for the caller hanging up while it rang:
  // they never heard the callback line, but they still wanted this person.
  const callerLeft = dialStatus === "cancel";
  const told = callerLeft ? "The caller hung up while it was ringing." : "The caller was told to expect a callback.";

  // The ticket the caller was being transferred about, or a new one if the
  // agent transferred without filing anything.
  let ticket = db
    .prepare("SELECT id, ref, kind, title, severity FROM complaints WHERE org_id=? AND call_id=? AND stage!='resolved' ORDER BY opened_at DESC LIMIT 1")
    .get(orgId, callId) as { id: string; ref: string; kind: string | null; title: string; severity: string } | undefined;
  if (!ticket) {
    const filed = await registerTicket(orgId, callId, {
      customer_name: customer,
      phone: call.phone ?? "",
      title: `Callback needed — ${customer} asked for ${whoName}`,
      description: `${customer} was being connected to ${whoName} but the call was not answered. ${told}${call.summary ? `\n\nSo far on the call: ${call.summary}` : ""}`,
      category: "other",
      kind: "enquiry",
      severity: "high",
    }, { owner: person });
    ticket = { id: filed.id, ref: filed.ref, kind: "enquiry", title: `Callback needed — ${customer} asked for ${whoName}`, severity: "high" };
  }
  if (person) {
    db.prepare("UPDATE complaints SET assignee=? WHERE id=? AND org_id=?").run(person.name, ticket.id, orgId);
  }
  addTicketMessage({
    orgId,
    complaintId: ticket.id,
    direction: "out",
    channel: "note",
    toAddress: person?.phone,
    body: `${MARK} by ${whoName}${dialStatus ? ` (${dialStatus})` : ""}. ${told}`,
  });

  const to = person ? routesFor({ person, team: null }) : routesFor(ownerOf(orgId, { departmentId: null }));
  const lead = `You missed a call we tried to connect to you. ${customer}${call.phone ? ` (${call.phone})` : ""} ${callerLeft ? "hung up while it was ringing — please call them back." : "was told to expect a call back."}`;
  const result = to
    ? await inform(
        orgId, callId, to,
        [{ complaintId: ticket.id, ref: ticket.ref, kind: ticket.kind || "enquiry", title: ticket.title, detail: "", severity: ticket.severity }],
        { customer, phone: call.phone ?? "", summary: (call.summary ?? "").trim(), lead, dryRun: call.source !== "phone" },
      )
    : { done: [] as string[], failed: [] as string[] };

  notifyConsole(orgId, {
    title: `${whoName} missed a live transfer — ${ticket.ref}`,
    body: result.done.length
      ? `${told} ${to?.who ?? whoName} has been informed by ${result.done.join(" and ")}.`
      : `${told} Nobody could be informed automatically — please call ${customer} back.`,
    severity: "high",
    href: "/complaints",
  });
  return { handled: true, reference_number: ticket.ref, informed: result.done };
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
