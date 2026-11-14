import "server-only";
import { getDb, nowIso, uid } from "./db";
import { VOICE_CATALOG, voiceByName } from "@/lib/live/voices";
import { GENERAL_DEPARTMENT, UNASSIGNED_DEPARTMENT, suggestedDepartmentsFor } from "@/lib/agents/departments";
import { USE_CASES } from "@/lib/agents/use-cases";

/**
 * Workspace setup: the details a feature cannot invent.
 *
 * Reaching a person needs a name and a phone or an email. Booking needs slot
 * types and hours. Teams (departments) are optional — work nobody owns goes
 * to an Unassigned queue. The agent prompt is assembled from these rows at
 * token-mint time, so an empty people list is how we stop the model offering
 * a human we cannot actually reach.
 */

type Row = Record<string, unknown>;
const db = () => getDb();

export function playbook(orgId: string) {
  const row = db().prepare("SELECT * FROM workspace_playbook WHERE org_id=?").get(orgId) as
    | Row
    | undefined;
  return {
    orgId,
    businessType: (row?.business_type as string) ?? "",
    hours: (row?.hours as string) ?? "",
    transferPolicy: (row?.transfer_policy as string) ?? "",
    bookingPolicy: (row?.booking_policy as string) ?? "",
    complaintSlaHours: (row?.complaint_sla_hours as number) ?? 24,
    extra: JSON.parse((row?.extra_json as string) ?? "{}") as Record<string, unknown>,
  };
}

export function upsertPlaybook(
  orgId: string,
  fields: {
    businessType?: string;
    hours?: string;
    transferPolicy?: string;
    bookingPolicy?: string;
    complaintSlaHours?: number;
    /** Use-case profile and switches live in extra_json — they shape which
     *  setup cards matter and what the planner builds, not the prompt. */
    useCase?: string;
    hasSales?: boolean;
    humanEscalation?: boolean;
    /** Which optional parts of the product this business uses. */
    features?: Partial<Record<WorkspaceFeature, boolean>>;
  },
) {
  const current = playbook(orgId);
  const extra = { ...current.extra };
  // Naming the business type changes what Setup suggests. It never creates
  // teams on its own — the suggestions stay one-click chips.
  if (fields.useCase !== undefined) extra.useCase = fields.useCase;
  if (fields.hasSales !== undefined) extra.hasSales = fields.hasSales;
  if (fields.humanEscalation !== undefined) extra.humanEscalation = fields.humanEscalation;
  if (fields.features) {
    const saved = (extra.features ?? {}) as Record<string, unknown>;
    extra.features = { ...saved, ...fields.features };
  }
  db().prepare(
    `INSERT INTO workspace_playbook (org_id, business_type, hours, transfer_policy, booking_policy, complaint_sla_hours, extra_json)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(org_id) DO UPDATE SET
       business_type=excluded.business_type,
       hours=excluded.hours,
       transfer_policy=excluded.transfer_policy,
       booking_policy=excluded.booking_policy,
       complaint_sla_hours=excluded.complaint_sla_hours,
       extra_json=excluded.extra_json`,
  ).run(
    orgId,
    fields.businessType ?? current.businessType,
    fields.hours ?? current.hours,
    fields.transferPolicy ?? current.transferPolicy,
    fields.bookingPolicy ?? current.bookingPolicy,
    fields.complaintSlaHours ?? current.complaintSlaHours,
    JSON.stringify(extra),
  );
  return playbook(orgId);
}

/** The playbook as the client sees it — extra_json flattened. */
export function publicPlaybook(orgId: string) {
  const p = playbook(orgId);
  return {
    orgId: p.orgId,
    businessType: p.businessType,
    hours: p.hours,
    transferPolicy: p.transferPolicy,
    bookingPolicy: p.bookingPolicy,
    complaintSlaHours: p.complaintSlaHours,
    useCase: typeof p.extra.useCase === "string" ? p.extra.useCase : "other",
    hasSales: p.extra.hasSales === true,
    humanEscalation: p.extra.humanEscalation !== false,
    features: workspaceFeatures(orgId, p.extra),
  };
}

export type WorkspaceFeature = "complaints" | "appointments" | "orders";

/**
 * The optional parts of the product this business has switched on. Setup
 * shows only these. A switch the owner never touched follows what is already
 * there: anything with data is on, and a named business type turns on what
 * that kind of business usually needs.
 */
export function workspaceFeatures(orgId: string, extra: Record<string, unknown>): Record<WorkspaceFeature, boolean> {
  const saved = (extra.features ?? {}) as Partial<Record<WorkspaceFeature, unknown>>;
  const useCase = typeof extra.useCase === "string" && extra.useCase in USE_CASES ? (extra.useCase as keyof typeof USE_CASES) : "other";
  const focus: readonly string[] = useCase === "other" ? [] : USE_CASES[useCase].focus;
  const has = (sql: string, ...params: unknown[]) => (db().prepare(sql).get(orgId, ...params) as { n: number }).n > 0;
  const pick = (key: WorkspaceFeature, fallback: () => boolean) =>
    typeof saved[key] === "boolean" ? (saved[key] as boolean) : fallback();
  return {
    complaints: pick(
      "complaints",
      () =>
        focus.includes("departments") ||
        has("SELECT COUNT(*) n FROM departments WHERE org_id=? AND slug!=?", UNASSIGNED_DEPARTMENT.slug) ||
        has("SELECT COUNT(*) n FROM complaints WHERE org_id=?"),
    ),
    appointments: pick(
      "appointments",
      () => focus.includes("appointments") || has("SELECT COUNT(*) n FROM appointment_types WHERE org_id=?"),
    ),
    orders: pick(
      "orders",
      () => focus.includes("orders") || has("SELECT COUNT(*) n FROM connectors WHERE org_id=? AND tool='lookup_order'"),
    ),
  };
}

export function voices(orgId: string) {
  // Catalog order (hand-tuned first), not alphabetical, and nothing the API
  // cannot hear: no pace/warmth numbers, no latency, no "cloned".
  const order = new Map(VOICE_CATALOG.map((v, i) => [v.name, i]));
  const rows = db().prepare("SELECT * FROM voices WHERE org_id=?").all(orgId) as Row[];
  rows.sort((a, b) => (order.get(a.live_name as string) ?? 99) - (order.get(b.live_name as string) ?? 99));
  return rows.map((r) => {
    const catalog = voiceByName(r.live_name as string);
    return {
      id: r.id as string,
      name: r.name as string,
      liveName: r.live_name as string,
      language: ["hi", "en", "hinglish", "ta", "te", "kn", "ml", "mr", "bn", "gu", "pa", "or"].includes(
        r.language as string,
      )
        ? (r.language as string)
        : "hinglish",
      descriptor: r.descriptor as string,
      gender: r.gender as string,
      style: r.style as string,
      character: catalog.character,
      bestFor: catalog.bestFor,
      personaName: r.persona_name as string,
      promptTemplate: r.prompt_template as string,
      assignedTo: assignedName(orgId, r.assigned_agent_id as string | null),
      assignedAgentId: (r.assigned_agent_id as string) ?? null,
    };
  });
}

function assignedName(orgId: string, agentId: string | null) {
  if (!agentId) return null;
  const row = db().prepare("SELECT name FROM agents WHERE id=? AND org_id=?").get(agentId, orgId) as
    | { name: string }
    | undefined;
  return row?.name ?? null;
}

export function updateVoice(
  orgId: string,
  id: string,
  fields: {
    promptTemplate?: string;
    personaName?: string;
    assignedAgentId?: string | null;
  },
) {
  const current = db().prepare("SELECT * FROM voices WHERE id=? AND org_id=?").get(id, orgId) as
    | Row
    | undefined;
  if (!current) return { error: "No such voice" } as const;
  const personaName = (fields.personaName ?? (current.persona_name as string)).trim() || (current.persona_name as string);
  db().prepare(
    `UPDATE voices SET prompt_template=?, persona_name=?, name=?,
       assigned_agent_id=?, updated_at=? WHERE id=? AND org_id=?`,
  ).run(
    fields.promptTemplate ?? current.prompt_template,
    personaName,
    personaName,
    fields.assignedAgentId === undefined ? current.assigned_agent_id : fields.assignedAgentId,
    nowIso(),
    id,
    orgId,
  );
  return { error: null } as const;
}

/** Put every org voice back to its catalog craft and stock name. */
export function resetVoices(orgId: string) {
  const d = db();
  d.prepare("DELETE FROM voices WHERE org_id=?").run(orgId);
  provisionWorkspace(orgId);
}

/**
 * The people of the business: anyone an agent may put a caller through to,
 * or who should be told about something after a call. One row per person,
 * entered once. (The table keeps its old name; "transfer target" was the
 * only thing a person could be when it was created.)
 */
export function transferTargets(orgId: string) {
  const rows = (db()
    .prepare(
      `SELECT t.*, d.name dept_name FROM transfer_targets t
       LEFT JOIN departments d ON d.id=t.department_id
       WHERE t.org_id=? ORDER BY t.priority, t.name`,
    )
    .all(orgId) as Row[]).map((r) => ({
    id: r.id as string,
    name: r.name as string,
    role: r.role as string,
    phone: (r.phone as string) ?? "",
    hours: (r.hours as string) ?? "",
    whenToUse: r.when_to_use as string,
    departmentId: (r.department_id as string) ?? null,
    department: (r.dept_name as string) ?? null,
    email: (r.email as string) ?? "",
    whatsapp: (r.whatsapp as string) ?? "",
    priority: r.priority as number,
    /** Ticked "Calls": may be connected live, and may be called after a call. */
    contactCalls: Boolean(r.contact_calls) && phoneDigits((r.phone as string) ?? "").length >= 10,
    /** Ticked "Email": gets the details by email. */
    contactEmail: Boolean(r.contact_email) && Boolean(((r.email as string) ?? "").trim()),
    /** Gets whatever no team owns. */
    isDefault: Boolean(r.is_default),
  }));
  // A business with exactly one person has a default whether or not they
  // ticked it: there is nobody else it could be.
  if (rows.length === 1) rows[0].isDefault = true;
  return rows;
}

export type Person = ReturnType<typeof transferTargets>[number];

const phoneDigits = (raw: string) => raw.replace(/\D/g, "");

/** People an agent may connect a caller to during a call. */
export function liveTransferPeople(orgId: string) {
  return transferTargets(orgId).filter((p) => p.contactCalls);
}

/** Who hears about work no team owns: the flagged person, or the only one. */
export function defaultPerson(orgId: string) {
  return transferTargets(orgId).find((p) => p.isDefault && (p.contactCalls || p.contactEmail)) ?? null;
}

const DEFAULT_WHEN_TO_USE = "The caller asked for a person, or the agent cannot resolve it";

export function upsertTransfer(
  orgId: string,
  data: {
    id?: string;
    name: string;
    role?: string;
    phone?: string;
    hours?: string;
    whenToUse?: string;
    departmentId?: string | null;
    priority?: number;
    email?: string;
    whatsapp?: string;
    /** Omitted = follows what was given: a phone means calls, an email means email. */
    contactCalls?: boolean;
    contactEmail?: boolean;
    isDefault?: boolean;
  },
): { id: string; error?: undefined } | { error: string; id?: undefined } {
  const name = data.name.trim();
  if (!name) return { error: "A person needs a name." };
  const phone = normalisePhone(data.phone ?? "");
  const email = (data.email ?? "").trim();
  const contactCalls = data.contactCalls ?? Boolean(phone);
  const contactEmail = data.contactEmail ?? Boolean(email);
  if (!contactCalls && !contactEmail) {
    return { error: `Tick Calls, Email, or both for ${name} — otherwise there is no way to reach them.` };
  }
  if (contactCalls && phoneDigits(phone).length < 10) {
    return { error: `${name} is ticked for calls, so a full phone number is needed.` };
  }
  if (contactEmail && !/^\S+@\S+\.\S+$/.test(email)) {
    return { error: `${name} is ticked for email, so a valid email address is needed.` };
  }
  if (data.departmentId) {
    const dept = db().prepare("SELECT id FROM departments WHERE id=? AND org_id=?").get(data.departmentId, orgId);
    if (!dept) return { error: "That team no longer exists." };
  }

  // An id only ever updates a row of this org — never another tenant's.
  const existing = data.id
    ? (db().prepare("SELECT id, priority FROM transfer_targets WHERE id=? AND org_id=?").get(data.id, orgId) as
        | { id: string; priority: number }
        | undefined)
    : undefined;
  if (data.id && !existing) return { error: "That person no longer exists." };

  const id = existing?.id ?? uid("xfer");
  const values = [
    name,
    (data.role ?? "").trim() || "Team member",
    phone,
    (data.hours ?? "").trim() || null,
    (data.whenToUse ?? "").trim() || DEFAULT_WHEN_TO_USE,
    data.departmentId ?? null,
    data.priority ?? existing?.priority ?? 0,
    email || null,
    normalisePhone(data.whatsapp ?? "") || null,
    contactCalls ? 1 : 0,
    contactEmail ? 1 : 0,
  ];
  const run = db().transaction(() => {
    if (existing) {
      db().prepare(
        `UPDATE transfer_targets SET name=?, role=?, phone=?, hours=?, when_to_use=?, department_id=?, priority=?,
           email=?, whatsapp=?, contact_calls=?, contact_email=? WHERE id=? AND org_id=?`,
      ).run(...values, id, orgId);
    } else {
      db().prepare(
        `INSERT INTO transfer_targets (name, role, phone, hours, when_to_use, department_id, priority, email, whatsapp, contact_calls, contact_email, id, org_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(...values, id, orgId);
    }
    // One default at a time.
    if (data.isDefault === true) {
      db().prepare("UPDATE transfer_targets SET is_default=CASE WHEN id=? THEN 1 ELSE 0 END WHERE org_id=?").run(id, orgId);
    } else if (data.isDefault === false) {
      db().prepare("UPDATE transfer_targets SET is_default=0 WHERE id=? AND org_id=?").run(id, orgId);
    }
  });
  run();
  return { id };
}

/** "98200 11122" → "+919820011122"; anything already international is kept. */
function normalisePhone(raw: string) {
  const cleaned = raw.replace(/[^\d+]/g, "");
  const digits = phoneDigits(cleaned);
  if (!digits) return "";
  if (cleaned.startsWith("+")) return `+${digits}`;
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 11 && digits.startsWith("0")) return `+91${digits.slice(1)}`;
  return `+${digits}`;
}

/** Find a person the way an owner refers to one: by id, name, or role. */
export function findPerson(orgId: string, ref: string | undefined) {
  const q = (ref ?? "").trim().toLowerCase();
  if (!q) return undefined;
  const people = transferTargets(orgId);
  return (
    people.find((p) => p.id === ref?.trim()) ??
    people.find((p) => p.name.toLowerCase() === q) ??
    people.find((p) => p.name.toLowerCase().includes(q) || q.includes(p.name.toLowerCase())) ??
    people.find((p) => p.role.toLowerCase() === q)
  );
}

export function deleteTransfer(orgId: string, id: string) {
  db().prepare("DELETE FROM transfer_targets WHERE id=? AND org_id=?").run(id, orgId);
}

export function appointmentTypes(orgId: string) {
  return (db().prepare("SELECT * FROM appointment_types WHERE org_id=? ORDER BY name").all(orgId) as Row[]).map(
    (r) => ({
      id: r.id as string,
      name: r.name as string,
      durationMin: r.duration_min as number,
      hours: (r.hours as string) ?? "",
      days: JSON.parse((r.days as string) ?? "[]") as string[],
      location: (r.location as string) ?? "",
      bufferMin: r.buffer_min as number,
      notes: (r.notes as string) ?? "",
    }),
  );
}

export function upsertAppointmentType(
  orgId: string,
  data: {
    id?: string;
    name: string;
    durationMin: number;
    hours?: string;
    days?: string[];
    location?: string;
    bufferMin?: number;
    notes?: string;
  },
) {
  const id = data.id ?? uid("apt");
  db().prepare(
    `INSERT INTO appointment_types (id, org_id, name, duration_min, hours, days, location, buffer_min, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name=excluded.name, duration_min=excluded.duration_min,
       hours=excluded.hours, days=excluded.days, location=excluded.location,
       buffer_min=excluded.buffer_min, notes=excluded.notes`,
  ).run(
    id, orgId, data.name, data.durationMin, data.hours ?? null,
    JSON.stringify(data.days ?? []), data.location ?? null, data.bufferMin ?? 0, data.notes ?? null,
  );
  return { id };
}

export function deleteAppointmentType(orgId: string, id: string) {
  db().prepare("DELETE FROM appointment_types WHERE id=? AND org_id=?").run(id, orgId);
}

/** Find a bookable type the way an owner refers to one: by id or name. */
export function findAppointmentType(orgId: string, ref: string | undefined) {
  const q = (ref ?? "").trim().toLowerCase();
  if (!q) return undefined;
  const types = appointmentTypes(orgId);
  return (
    types.find((t) => t.id === ref?.trim()) ??
    types.find((t) => t.name.toLowerCase() === q) ??
    types.find((t) => t.name.toLowerCase().includes(q) || q.includes(t.name.toLowerCase()))
  );
}

export function upsertDepartment(
  orgId: string,
  data: {
    id?: string;
    name: string;
    slug?: string;
    keywords?: string[];
    email?: string;
    phone?: string;
    whatsapp?: string;
  },
) {
  let slug = (data.slug ?? data.name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  // "Unassigned" is the queue for work no team owns; a team an owner happens
  // to call that gets its own row rather than taking the queue over.
  if (!data.id && slug === UNASSIGNED_DEPARTMENT.slug) slug = `${slug}-team`;
  // Ids are per-row, never derived from the slug: two tenants both adding
  // "Billing" must not fight over one primary key. The (org_id, slug) unique
  // constraint is what makes this an upsert.
  // Match an existing row by id, slug, or (case-insensitive) name — a desk
  // suggested as `billing` and one typed in as "Billing & insurance" are the
  // same desk to the owner, and must not become two queues.
  const existing = (data.id
    ? db().prepare("SELECT id, slug FROM departments WHERE org_id=? AND id=?").get(orgId, data.id)
    : db()
        .prepare("SELECT id, slug FROM departments WHERE org_id=? AND slug!=? AND (slug=? OR lower(name)=lower(?)) ORDER BY (slug=?) DESC LIMIT 1")
        .get(orgId, UNASSIGNED_DEPARTMENT.slug, slug, data.name.trim(), slug)) as { id: string; slug: string } | undefined;

  // The Unassigned queue is ours, not a team an owner edits.
  if (existing?.slug === UNASSIGNED_DEPARTMENT.slug) return { id: existing.id, slug: existing.slug };

  if (existing) {
    // Fields not sent are left alone; an empty string clears one on purpose.
    db().prepare(
      `UPDATE departments SET name=?, keywords=COALESCE(?, keywords),
         email=COALESCE(?, email), phone=COALESCE(?, phone), whatsapp=COALESCE(?, whatsapp)
       WHERE id=? AND org_id=?`,
    ).run(
      data.name.trim(), data.keywords ? JSON.stringify(data.keywords) : null,
      data.email ?? null, data.phone ?? null, data.whatsapp ?? null, existing.id, orgId,
    );
    return { id: existing.id, slug: existing.slug };
  }

  const id = uid("dept");
  db().prepare(
    "INSERT INTO departments (id, org_id, slug, name, keywords, email, phone, whatsapp) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(
    id, orgId, slug, data.name.trim(), JSON.stringify(data.keywords ?? []),
    data.email ?? null, data.phone ?? null, data.whatsapp ?? null,
  );
  return { id, slug };
}

/** The teams an owner set up — everything except the Unassigned queue. */
export function teams(orgId: string) {
  return (db()
    .prepare("SELECT id, slug, name, keywords, email, phone, whatsapp FROM departments WHERE org_id=? AND slug!=? ORDER BY name")
    .all(orgId, UNASSIGNED_DEPARTMENT.slug) as Row[]).map((r) => ({
    id: r.id as string,
    slug: r.slug as string,
    name: r.name as string,
    keywords: JSON.parse((r.keywords as string) || "[]") as string[],
    email: (r.email as string) ?? "",
    phone: (r.phone as string) ?? "",
    whatsapp: (r.whatsapp as string) ?? "",
  }));
}

/** Find a team the way an owner refers to one: by id, name, or slug. */
export function findTeam(orgId: string, ref: string | undefined) {
  const q = (ref ?? "").trim().toLowerCase();
  if (!q) return undefined;
  const all = teams(orgId);
  return (
    all.find((t) => t.id === ref?.trim()) ??
    all.find((t) => t.name.toLowerCase() === q || t.slug === q) ??
    all.find((t) => t.name.toLowerCase().includes(q) || q.includes(t.name.toLowerCase()))
  );
}

/**
 * The queue for work no team owns. Made the first time it is needed, so a
 * business with no teams still never loses a complaint. Not a team: Setup,
 * the agents and Swara do not see it.
 */
export function unassignedDepartment(orgId: string) {
  const existing = db()
    .prepare("SELECT id, slug, name FROM departments WHERE org_id=? AND slug=?")
    .get(orgId, UNASSIGNED_DEPARTMENT.slug) as { id: string; slug: string; name: string } | undefined;
  if (existing) return existing;
  const id = uid("dept");
  db()
    .prepare("INSERT INTO departments (id, org_id, slug, name, keywords) VALUES (?, ?, ?, ?, '[]')")
    .run(id, orgId, UNASSIGNED_DEPARTMENT.slug, UNASSIGNED_DEPARTMENT.name);
  return { id, slug: UNASSIGNED_DEPARTMENT.slug as string, name: UNASSIGNED_DEPARTMENT.name as string };
}

/** Suggested teams for the org's use case that it has not added yet. */
export function departmentSuggestions(orgId: string) {
  const useCase = playbook(orgId).extra.useCase;
  const have = new Set(
    (db().prepare("SELECT slug FROM departments WHERE org_id=?").all(orgId) as { slug: string }[]).map((r) => r.slug),
  );
  return suggestedDepartmentsFor(typeof useCase === "string" ? useCase : undefined).filter((s) => !have.has(s.slug));
}

/**
 * Remove a team. Any team can go, including the last one: whatever it still
 * owned — open or done — moves to the older General desk if the workspace
 * kept one, otherwise to the Unassigned queue, and its people simply stop
 * belonging to a team.
 */
export function deleteDepartment(orgId: string, id: string) {
  const dept = db().prepare("SELECT id, slug FROM departments WHERE id=? AND org_id=?").get(id, orgId) as
    | { id: string; slug: string }
    | undefined;
  if (!dept) return { error: "That team no longer exists." } as const;
  if (dept.slug === UNASSIGNED_DEPARTMENT.slug) {
    return { error: "Unassigned is the queue for work no team owns, not a team — it cannot be removed." } as const;
  }
  const count = (table: "actions" | "complaints", extra = "") =>
    (db().prepare(`SELECT COUNT(*) n FROM ${table} WHERE org_id=? AND department_id=? ${extra}`).get(orgId, id) as { n: number }).n;
  const openActions = count("actions", "AND status!='done'");
  const owned = count("actions") + count("complaints");

  let movedTo: string | null = null;
  const run = db().transaction(() => {
    if (owned > 0) {
      const general = db()
        .prepare("SELECT id, name FROM departments WHERE org_id=? AND id!=? AND slug=?")
        .get(orgId, id, GENERAL_DEPARTMENT.slug) as { id: string; name: string } | undefined;
      const target = general ?? unassignedDepartment(orgId);
      movedTo = target.name;
      db().prepare("UPDATE complaints SET department_id=? WHERE org_id=? AND department_id=?").run(target.id, orgId, id);
      db().prepare("UPDATE actions SET department_id=? WHERE org_id=? AND department_id=?").run(target.id, orgId, id);
    }
    db().prepare("UPDATE transfer_targets SET department_id=NULL WHERE org_id=? AND department_id=?").run(orgId, id);
    db().prepare("UPDATE users SET department_id=NULL WHERE org_id=? AND department_id=?").run(orgId, id);
    db().prepare("UPDATE invites SET department_id=NULL WHERE org_id=? AND department_id=?").run(orgId, id);
    db().prepare("DELETE FROM departments WHERE id=? AND org_id=?").run(id, orgId);
  });
  run();
  return { error: null, openMoved: openActions, movedTo: movedTo as string | null } as const;
}

export function upsertConnector(
  orgId: string,
  data: { name: string; kind: "rest" | "demo"; tool: string; baseUrl?: string; authHeader?: string; authSecret?: string },
) {
  const existing = db()
    .prepare("SELECT id FROM connectors WHERE org_id=? AND tool=?")
    .get(orgId, data.tool) as { id: string } | undefined;
  const id = existing?.id ?? uid("conn");
  if (existing) {
    db().prepare(
      `UPDATE connectors SET name=?, kind=?, base_url=?, auth_header=?, auth_secret=?, status='connected'
       WHERE id=?`,
    ).run(data.name, data.kind, data.baseUrl ?? null, data.authHeader ?? null, data.authSecret ?? null, id);
  } else {
    db().prepare(
      `INSERT INTO connectors (id, org_id, name, kind, tool, base_url, auth_header, auth_secret, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'connected', ?)`,
    ).run(id, orgId, data.name, data.kind, data.tool, data.baseUrl ?? null, data.authHeader ?? null, data.authSecret ?? null, nowIso());
  }
  return { id };
}

export function connectors(orgId: string) {
  return (db().prepare("SELECT * FROM connectors WHERE org_id=?").all(orgId) as Row[]).map((r) => ({
    id: r.id as string,
    name: r.name as string,
    kind: r.kind as string,
    tool: r.tool as string,
    baseUrl: (r.base_url as string) ?? "",
    authHeader: (r.auth_header as string) ?? "",
    status: r.status as string,
    hasSecret: Boolean(r.auth_secret),
  }));
}

export function sipTrunks(orgId: string) {
  return (db().prepare("SELECT * FROM sip_trunks WHERE org_id=?").all(orgId) as Row[]).map((r) => ({
    id: r.id as string,
    name: r.name as string,
    host: r.host as string,
    channels: r.channels as number,
    channelsInUse: r.channels_in_use as number,
    status: r.status as string,
    latencyMs: r.latency_ms as number,
    asr: r.asr as number,
  }));
}

export function dltTemplates(orgId: string) {
  return (db().prepare("SELECT * FROM dlt_templates WHERE org_id=? ORDER BY name").all(orgId) as Row[]).map(
    (r) => ({
      id: r.id as string,
      name: r.name as string,
      series: r.series as string,
      body: r.body as string,
      status: r.status as string,
      authorityId: (r.authority_id as string) ?? null,
      updatedAt: r.updated_at as string,
    }),
  );
}

export function campaignContacts(orgId: string, campaignId: string) {
  return (db()
    .prepare("SELECT * FROM campaign_contacts WHERE org_id=? AND campaign_id=? ORDER BY status, name")
    .all(orgId, campaignId) as Row[]).map((r) => ({
    id: r.id as string,
    campaignId: r.campaign_id as string,
    phone: r.phone as string,
    name: (r.name as string) ?? "",
    language: (r.language as string) ?? "",
    dnd: Boolean(r.dnd),
    status: r.status as string,
    lastAttemptAt: (r.last_attempt_at as string) ?? null,
  }));
}

export function addCampaignContacts(
  orgId: string,
  campaignId: string,
  contacts: { phone: string; name?: string; language?: string }[],
) {
  const insert = db().prepare(
    `INSERT INTO campaign_contacts (id, org_id, campaign_id, phone, name, language, dnd, status)
     VALUES (?, ?, ?, ?, ?, ?, 0, 'queued')`,
  );
  const run = db().transaction(() => {
    for (const c of contacts) {
      insert.run(uid("cc"), orgId, campaignId, c.phone, c.name ?? null, c.language ?? null);
    }
    db().prepare(
      "UPDATE campaigns SET contacts = (SELECT COUNT(*) FROM campaign_contacts WHERE campaign_id=?) WHERE id=? AND org_id=?",
    ).run(campaignId, campaignId, orgId);
  });
  run();
  return { added: contacts.length };
}

export function logToolInvocation(
  orgId: string,
  callId: string | null,
  name: string,
  args: unknown,
  result: unknown,
) {
  db().prepare(
    `INSERT INTO tool_invocations (id, org_id, call_id, name, args, result, at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(uid("tool"), orgId, callId, name, JSON.stringify(args ?? {}), JSON.stringify(result ?? {}), nowIso());
}

/**
 * Defaults every new org (and a migrated v1 org) needs so Voice Studio, the
 * transfer tool and the booking tool have something to read.
 */
export function provisionWorkspace(orgId: string) {
  const now = nowIso();
  const d = db();

  // No teams are created here. A business without departments is a normal
  // workspace; anything nobody owns goes to the Unassigned queue, which is
  // made the first time it is needed (unassignedDepartment).

  // Every catalog voice gets a row; voices added to the catalog later are
  // filled in for existing orgs without touching the ones they have edited.
  const have = new Set(
    (d.prepare("SELECT live_name FROM voices WHERE org_id=?").all(orgId) as { live_name: string }[]).map((r) => r.live_name),
  );
  const insert = d.prepare(
    `INSERT INTO voices (id, org_id, live_name, name, gender, style, descriptor, persona_name, prompt_template, language, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'hinglish', ?)`,
  );
  for (const v of VOICE_CATALOG) {
    if (have.has(v.name)) continue;
    insert.run(
      `${v.id}_${orgId.slice(-8)}`, orgId, v.name, v.personaName, v.gender, v.style,
      v.descriptor, v.personaName, v.promptTemplate, now,
    );
  }

  d.prepare(
    `INSERT OR IGNORE INTO workspace_playbook (org_id, business_type, hours, transfer_policy, booking_policy, complaint_sla_hours, extra_json)
     VALUES (?, '', '10:00-19:00 IST', '', '', 24, '{}')`,
  ).run(orgId);
}

export function setupStatus(orgId: string) {
  const count = (sql: string) => (db().prepare(sql).get(orgId) as { n: number }).n;
  return {
    departments: count(`SELECT COUNT(*) n FROM departments WHERE org_id=? AND slug!='${UNASSIGNED_DEPARTMENT.slug}'`),
    transfers: count("SELECT COUNT(*) n FROM transfer_targets WHERE org_id=?"),
    appointmentTypes: count("SELECT COUNT(*) n FROM appointment_types WHERE org_id=?"),
    knowledge: count("SELECT COUNT(*) n FROM knowledge_docs WHERE org_id=?"),
    connectors: count("SELECT COUNT(*) n FROM connectors WHERE org_id=?"),
    voices: count("SELECT COUNT(*) n FROM voices WHERE org_id=?"),
    agents: count("SELECT COUNT(*) n FROM agents WHERE org_id=?"),
    playbook: playbook(orgId),
  };
}
