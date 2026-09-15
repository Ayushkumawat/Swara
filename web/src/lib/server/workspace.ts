import "server-only";
import { getDb, nowIso, uid } from "./db";
import { VOICE_CATALOG } from "@/lib/live/voices";

const DEFAULT_DEPARTMENTS = [
  { slug: "support", name: "Customer Support", keywords: ["refund", "return", "wrong item", "experience"] },
  { slug: "logistics", name: "Logistics & Delivery", keywords: ["delivery", "parcel", "delay", "reschedule"] },
  { slug: "technical", name: "Technical / Maintenance", keywords: ["fault", "broken", "not working", "escalator"] },
  { slug: "cleaning", name: "Cleaning & Housekeeping", keywords: ["clean", "dirty", "garbage", "toilet"] },
  { slug: "payments", name: "Payments & Billing", keywords: ["payment", "charged", "refund", "upi"] },
  { slug: "security", name: "Security & Safety", keywords: ["theft", "unsafe", "emergency", "harassment"] },
];

/**
 * Workspace setup: the details a feature cannot invent.
 *
 * Transfer needs a person and a number. Booking needs slot types and hours.
 * Complaints need departments. The agent prompt is assembled from these rows
 * at token-mint time, so an empty transfer list is how we stop the model
 * offering a human we cannot actually reach.
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
  },
) {
  const current = playbook(orgId);
  const extra = { ...current.extra };
  if (fields.useCase !== undefined) extra.useCase = fields.useCase;
  if (fields.hasSales !== undefined) extra.hasSales = fields.hasSales;
  if (fields.humanEscalation !== undefined) extra.humanEscalation = fields.humanEscalation;
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
  };
}

export function voices(orgId: string) {
  return (db().prepare("SELECT * FROM voices WHERE org_id=? ORDER BY name").all(orgId) as Row[]).map(
    (r) => ({
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
      personaName: r.persona_name as string,
      promptTemplate: r.prompt_template as string,
      assignedTo: assignedName(orgId, r.assigned_agent_id as string | null),
      assignedAgentId: (r.assigned_agent_id as string) ?? null,
      pace: r.pace as number,
      formality: r.formality as number,
      warmth: r.warmth as number,
      latencyMs: r.latency_ms as number,
      cloned: Boolean(r.cloned),
    }),
  );
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
    pace?: number;
    formality?: number;
    warmth?: number;
    assignedAgentId?: string | null;
  },
) {
  const current = db().prepare("SELECT * FROM voices WHERE id=? AND org_id=?").get(id, orgId) as
    | Row
    | undefined;
  if (!current) return { error: "No such voice" } as const;
  db().prepare(
    `UPDATE voices SET prompt_template=?, persona_name=?, pace=?, formality=?, warmth=?,
       assigned_agent_id=?, updated_at=? WHERE id=? AND org_id=?`,
  ).run(
    fields.promptTemplate ?? current.prompt_template,
    fields.personaName ?? current.persona_name,
    fields.pace ?? current.pace,
    fields.formality ?? current.formality,
    fields.warmth ?? current.warmth,
    fields.assignedAgentId === undefined ? current.assigned_agent_id : fields.assignedAgentId,
    nowIso(),
    id,
    orgId,
  );
  return { error: null } as const;
}

export function transferTargets(orgId: string) {
  return (db()
    .prepare(
      `SELECT t.*, d.name dept_name FROM transfer_targets t
       LEFT JOIN departments d ON d.id=t.department_id
       WHERE t.org_id=? ORDER BY t.priority, t.name`,
    )
    .all(orgId) as Row[]).map((r) => ({
    id: r.id as string,
    name: r.name as string,
    role: r.role as string,
    phone: r.phone as string,
    hours: (r.hours as string) ?? "",
    whenToUse: r.when_to_use as string,
    departmentId: (r.department_id as string) ?? null,
    department: (r.dept_name as string) ?? null,
    priority: r.priority as number,
  }));
}

export function upsertTransfer(
  orgId: string,
  data: {
    id?: string;
    name: string;
    role: string;
    phone: string;
    hours?: string;
    whenToUse: string;
    departmentId?: string | null;
    priority?: number;
  },
) {
  const id = data.id ?? uid("xfer");
  db().prepare(
    `INSERT INTO transfer_targets (id, org_id, name, role, phone, hours, when_to_use, department_id, priority)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name=excluded.name, role=excluded.role, phone=excluded.phone,
       hours=excluded.hours, when_to_use=excluded.when_to_use, department_id=excluded.department_id,
       priority=excluded.priority`,
  ).run(
    id, orgId, data.name, data.role, data.phone, data.hours ?? null, data.whenToUse,
    data.departmentId ?? null, data.priority ?? 0,
  );
  return { id };
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

export function upsertDepartment(
  orgId: string,
  data: { id?: string; name: string; slug?: string; keywords?: string[] },
) {
  const slug = (data.slug ?? data.name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const id = data.id ?? `dept_${slug}`;
  db().prepare(
    `INSERT INTO departments (id, org_id, slug, name, keywords) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(org_id, slug) DO UPDATE SET name=excluded.name, keywords=excluded.keywords`,
  ).run(id, orgId, slug, data.name, JSON.stringify(data.keywords ?? []));
  return { id, slug };
}

export function deleteDepartment(orgId: string, id: string) {
  const open = (db()
    .prepare("SELECT COUNT(*) n FROM actions WHERE department_id=? AND status!='done'")
    .get(id) as { n: number }).n;
  if (open > 0) return { error: `${open} open actions still sit on this department` } as const;
  db().prepare("UPDATE users SET department_id=NULL WHERE department_id=?").run(id);
  db().prepare("DELETE FROM departments WHERE id=? AND org_id=?").run(id, orgId);
  return { error: null } as const;
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

  if (!(d.prepare("SELECT COUNT(*) n FROM departments WHERE org_id=?").get(orgId) as { n: number }).n) {
    const insert = d.prepare(
      "INSERT INTO departments (id, org_id, slug, name, keywords) VALUES (?, ?, ?, ?, ?)",
    );
    for (const dept of DEFAULT_DEPARTMENTS) {
      insert.run(`dept_${orgId.slice(-6)}_${dept.slug}`, orgId, dept.slug, dept.name, JSON.stringify(dept.keywords));
    }
  }

  if (!(d.prepare("SELECT COUNT(*) n FROM voices WHERE org_id=?").get(orgId) as { n: number }).n) {
    const insert = d.prepare(
      `INSERT INTO voices (id, org_id, live_name, name, gender, style, descriptor, persona_name, prompt_template, language, pace, formality, warmth, cloned, latency_ms, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 300, ?)`,
    );
    for (const v of VOICE_CATALOG) {
      insert.run(
        `${v.id}_${orgId.slice(-8)}`, orgId, v.name, v.personaName, v.gender, v.style,
        v.descriptor, v.personaName, v.promptTemplate, v.language, v.pace, v.formality, v.warmth, now,
      );
    }
  }

  d.prepare(
    `INSERT OR IGNORE INTO workspace_playbook (org_id, business_type, hours, transfer_policy, booking_policy, complaint_sla_hours, extra_json)
     VALUES (?, '', '10:00-19:00 IST', '', '', 24, '{}')`,
  ).run(orgId);
}

export function setupStatus(orgId: string) {
  const count = (sql: string) => (db().prepare(sql).get(orgId) as { n: number }).n;
  return {
    departments: count("SELECT COUNT(*) n FROM departments WHERE org_id=?"),
    transfers: count("SELECT COUNT(*) n FROM transfer_targets WHERE org_id=?"),
    appointmentTypes: count("SELECT COUNT(*) n FROM appointment_types WHERE org_id=?"),
    knowledge: count("SELECT COUNT(*) n FROM knowledge_docs WHERE org_id=?"),
    connectors: count("SELECT COUNT(*) n FROM connectors WHERE org_id=?"),
    voices: count("SELECT COUNT(*) n FROM voices WHERE org_id=?"),
    agents: count("SELECT COUNT(*) n FROM agents WHERE org_id=?"),
    playbook: playbook(orgId),
  };
}
