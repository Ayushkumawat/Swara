import "server-only";
import { getDb, nowIso, uid } from "./db";
import { VOICE_CATALOG, voiceByName } from "@/lib/live/voices";
import { GENERAL_DEPARTMENT, suggestedDepartmentsFor } from "@/lib/agents/departments";

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
  if (fields.useCase !== undefined && fields.useCase !== extra.useCase) {
    extra.useCase = fields.useCase;
    // First time an owner names their business type, offer it the desks
    // that kind of business usually has. Only while they have added none of
    // their own — after that the list is theirs and we stop touching it.
    if (!hasCustomDepartments(orgId)) {
      for (const dept of suggestedDepartmentsFor(fields.useCase)) upsertDepartment(orgId, dept);
    }
  }
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
    email: (r.email as string) ?? "",
    whatsapp: (r.whatsapp as string) ?? "",
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
    email?: string;
    whatsapp?: string;
  },
) {
  const id = data.id ?? uid("xfer");
  db().prepare(
    `INSERT INTO transfer_targets (id, org_id, name, role, phone, hours, when_to_use, department_id, priority, email, whatsapp)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name=excluded.name, role=excluded.role, phone=excluded.phone,
       hours=excluded.hours, when_to_use=excluded.when_to_use, department_id=excluded.department_id,
       priority=excluded.priority, email=excluded.email, whatsapp=excluded.whatsapp`,
  ).run(
    id, orgId, data.name, data.role, data.phone, data.hours ?? null, data.whenToUse,
    data.departmentId ?? null, data.priority ?? 0, data.email ?? null, data.whatsapp ?? null,
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
  const slug = (data.slug ?? data.name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  // Ids are per-row, never derived from the slug: two tenants both adding
  // "Billing" must not fight over one primary key. The (org_id, slug) unique
  // constraint is what makes this an upsert.
  // Match an existing row by id, slug, or (case-insensitive) name — a desk
  // suggested as `billing` and one typed in as "Billing & insurance" are the
  // same desk to the owner, and must not become two queues.
  const existing = (data.id
    ? db().prepare("SELECT id, slug FROM departments WHERE org_id=? AND id=?").get(orgId, data.id)
    : db()
        .prepare("SELECT id, slug FROM departments WHERE org_id=? AND (slug=? OR lower(name)=lower(?)) ORDER BY (slug=?) DESC LIMIT 1")
        .get(orgId, slug, data.name.trim(), slug)) as { id: string; slug: string } | undefined;

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

/** True once the org has any department beyond the auto-created General. */
export function hasCustomDepartments(orgId: string) {
  return (db()
    .prepare("SELECT COUNT(*) n FROM departments WHERE org_id=? AND slug!=?")
    .get(orgId, GENERAL_DEPARTMENT.slug) as { n: number }).n > 0;
}

/** Suggested desks for the org's use case that it has not added yet. */
export function departmentSuggestions(orgId: string) {
  const useCase = playbook(orgId).extra.useCase;
  const have = new Set(
    (db().prepare("SELECT slug FROM departments WHERE org_id=?").all(orgId) as { slug: string }[]).map((r) => r.slug),
  );
  return suggestedDepartmentsFor(typeof useCase === "string" ? useCase : undefined).filter((s) => !have.has(s.slug));
}

export function deleteDepartment(orgId: string, id: string) {
  const open = (db()
    .prepare("SELECT COUNT(*) n FROM actions WHERE department_id=? AND status!='done'")
    .get(id) as { n: number }).n;
  if (open > 0) return { error: `${open} open actions still sit on this department` } as const;
  const total = (db().prepare("SELECT COUNT(*) n FROM departments WHERE org_id=?").get(orgId) as { n: number }).n;
  if (total <= 1) return { error: "Keep at least one department — unrouted complaints need somewhere to land" } as const;
  // Complaints and tickets that pointed here fall back to whichever desk is
  // left, rather than dangling at a department that no longer exists.
  const fallback = db()
    .prepare("SELECT id FROM departments WHERE org_id=? AND id!=? ORDER BY (slug=?) DESC, name LIMIT 1")
    .get(orgId, id, GENERAL_DEPARTMENT.slug) as { id: string } | undefined;
  if (fallback) {
    db().prepare("UPDATE complaints SET department_id=? WHERE org_id=? AND department_id=?").run(fallback.id, orgId, id);
    db().prepare("UPDATE actions SET department_id=? WHERE org_id=? AND department_id=?").run(fallback.id, orgId, id);
    db().prepare("UPDATE transfer_targets SET department_id=NULL WHERE org_id=? AND department_id=?").run(orgId, id);
  }
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

  // One desk, "General", so a complaint always has somewhere to land. The
  // rest come from the owner (Setup → Departments) or from the use-case
  // suggestions applied when they pick a business type — never from here.
  if (!(d.prepare("SELECT COUNT(*) n FROM departments WHERE org_id=?").get(orgId) as { n: number }).n) {
    d.prepare("INSERT INTO departments (id, org_id, slug, name, keywords) VALUES (?, ?, ?, ?, ?)").run(
      uid("dept"), orgId, GENERAL_DEPARTMENT.slug, GENERAL_DEPARTMENT.name, JSON.stringify(GENERAL_DEPARTMENT.keywords),
    );
  }

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
