import "server-only";
import type { Database } from "better-sqlite3";
import { randomBytes, scryptSync } from "node:crypto";
import * as fx from "@/lib/api/fixtures";
import { nowIso, uid } from "./db";

/**
 * First-run seed for the demo workspace.
 *
 * Two kinds of data go in:
 *
 * 1. The curated fixture set the console has always shown — agents, customers,
 *    complaints, bookings. Reusing `lib/api/fixtures.ts` verbatim means demo
 *    mode and database mode look identical, so nothing about the UI changes
 *    when the backend switches on.
 *
 * 2. Fourteen days of generated call history. The fixtures carried
 *    pre-computed dashboard numbers; the backend refuses to store any number
 *    it can derive, so the dashboards need actual rows to aggregate. Seeded
 *    with a fixed RNG so every rebuild produces the same charts.
 *
 * Login after seeding: demo@swara.in / swara-demo (owner),
 * plus one user per department, e.g. cleaning@swara.in / swara-demo.
 */

const ORG_ID = "org_demo";
const DEMO_PASSWORD = "swara-demo";

/** Deterministic RNG (mulberry32) so seeded history is stable across rebuilds. */
function rng(seedValue: number) {
  let a = seedValue;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

/**
 * The department list covers both live sales narratives: the metro/civic story
 * (cleaning vs technical fault vs security — the user's own example) and the
 * D2C story (logistics vs payments). Tenants define their own; these are the
 * demo org's. Keywords are the fallback classifier when no Gemini key is set.
 */
const DEPARTMENTS = [
  { slug: "support", name: "Customer Support", keywords: ["refund", "return", "wrong item", "behaviour", "rude", "experience", "app", "login"] },
  { slug: "logistics", name: "Logistics & Delivery", keywords: ["delivery", "parcel", "courier", "late", "delay", "reschedule", "address", "pickup"] },
  { slug: "technical", name: "Technical / Maintenance", keywords: ["ac", "escalator", "lift", "machine", "fault", "broken", "not working", "malfunction", "website", "qr"] },
  { slug: "cleaning", name: "Cleaning & Housekeeping", keywords: ["clean", "dirty", "garbage", "toilet", "smell", "hygiene", "washroom"] },
  { slug: "payments", name: "Payments & Billing", keywords: ["payment", "refund not received", "charged", "recharge", "balance", "card", "upi", "cod"] },
  { slug: "security", name: "Security & Safety", keywords: ["harassment", "theft", "suspicious", "unsafe", "cctv", "fight", "emergency", "lost"] },
];

/** Complaint category → department slug, for seeding and as the final
 *  classifier fallback. */
export const CATEGORY_DEPARTMENT: Record<string, string> = {
  "Wrong item": "support",
  Delay: "logistics",
  Experience: "support",
  "Repeat contact": "support",
  Serviceability: "logistics",
  Damage: "support",
  Billing: "payments",
  Refund: "payments",
  Cleanliness: "cleaning",
  "Technical fault": "technical",
  Safety: "security",
};

export function seed(db: Database) {
  const now = nowIso();
  const random = rng(42);

  const insertOrg = db.prepare(
    "INSERT INTO orgs (id, name, plan, created_at) VALUES (?, ?, ?, ?)",
  );
  insertOrg.run(ORG_ID, "Swara Demo Co", "growth", now);

  // Departments ------------------------------------------------------------
  const insertDept = db.prepare(
    "INSERT INTO departments (id, org_id, slug, name, keywords) VALUES (?, ?, ?, ?, ?)",
  );
  const deptIds = new Map<string, string>();
  for (const d of DEPARTMENTS) {
    const id = `dept_${d.slug}`;
    insertDept.run(id, ORG_ID, d.slug, d.name, JSON.stringify(d.keywords));
    deptIds.set(d.slug, id);
  }

  // Users -------------------------------------------------------------------
  const insertUser = db.prepare(
    `INSERT INTO users (id, org_id, department_id, name, email, password_hash, role, status, last_active_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const passwordHash = hashPassword(DEMO_PASSWORD);
  insertUser.run(uid("usr"), ORG_ID, null, "Demo Owner", "demo@swara.in", passwordHash, "owner", "active", now, now);
  for (const d of DEPARTMENTS) {
    insertUser.run(
      uid("usr"), ORG_ID, deptIds.get(d.slug), `${d.name} Desk`,
      `${d.slug}@swara.in`, passwordHash, "agent", "active", null, now,
    );
  }
  // The fixture team, as invited members (no password until they accept).
  for (const m of fx.teamMembers) {
    if (m.email === "demo@swara.in") continue;
    insertUser.run(uid("usr"), ORG_ID, null, m.name, m.email, null, m.role, m.status, m.lastActiveAt, now);
  }

  // Agents -----------------------------------------------------------------
  const insertAgent = db.prepare(
    `INSERT INTO agents (id, org_id, name, status, languages, intent, direction, voice_id, mode, prompt, nodes, edges, version, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const a of fx.agents) {
    insertAgent.run(
      a.id, ORG_ID, a.name, a.status, JSON.stringify(a.languages), a.intent, a.direction,
      a.voiceId ?? null, a.mode, a.prompt ?? null, JSON.stringify(a.nodes), JSON.stringify(a.edges),
      a.version, a.updatedAt,
    );
  }
  const insertVersion = db.prepare(
    "INSERT INTO agent_versions (id, org_id, version, label, author, created_at, is_live) VALUES (?, ?, ?, ?, ?, ?, ?)",
  );
  for (const v of fx.agentVersions) {
    insertVersion.run(v.id, ORG_ID, v.version, v.label, v.author, v.createdAt, v.isLive ? 1 : 0);
  }

  const insertDoc = db.prepare(
    "INSERT INTO knowledge_docs (id, org_id, name, kind, size_label, status, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  );
  for (const d of fx.knowledgeDocs) {
    insertDoc.run(d.id, ORG_ID, d.name, d.kind, d.sizeLabel, d.status, d.updatedAt);
  }

  // Customers + timelines ----------------------------------------------------
  const insertCustomer = db.prepare(
    `INSERT INTO customers (id, org_id, phone, name, city, preferred_language, orders, ltv_inr, sentiment, since, last_contact_at, last_channel, tags)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertEvent = db.prepare(
    "INSERT INTO timeline_events (id, customer_id, kind, title, detail, at, amount_inr, sentiment) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  );
  for (const c of fx.customers) {
    insertCustomer.run(
      c.id, ORG_ID, c.phone, c.name, c.city, c.preferredLanguage, c.orders, c.lifetimeValueInr,
      c.sentiment, c.since, c.lastContactAt, c.lastChannel, JSON.stringify(c.tags),
    );
    for (const e of c.timeline) {
      // Fixture event ids restart at t1 per customer; namespace them or the
      // second customer's timeline collides with the first's primary keys.
      insertEvent.run(`${c.id}_${e.id}`, c.id, e.kind, e.title, e.detail ?? null, e.at, e.amountInr ?? null, e.sentiment ?? null);
    }
  }

  // Complaints, routed to departments by category --------------------------
  const insertComplaint = db.prepare(
    `INSERT INTO complaints (id, org_id, ref, title, category, severity, stage, customer_name, phone, opened_at, sla_due_at, assignee, call_id, department_id, has_recording, has_consent)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertAction = db.prepare(
    `INSERT INTO actions (id, org_id, department_id, call_id, complaint_id, title, detail, severity, status, created_at, due_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const c of fx.complaints) {
    const deptId = deptIds.get(CATEGORY_DEPARTMENT[c.category] ?? "support")!;
    insertComplaint.run(
      c.id, ORG_ID, c.ref, c.title, c.category, c.severity, c.stage, c.customerName, c.phone,
      c.openedAt, c.slaDueAt, c.assignee, c.callId, deptId, c.hasRecording ? 1 : 0, c.hasConsent ? 1 : 0,
    );
    // Every open complaint is somebody's job: mirror it into that
    // department's queue so nothing waits in a list nobody owns.
    if (c.stage !== "resolved") {
      insertAction.run(
        uid("act"), ORG_ID, deptId, c.callId, c.id,
        c.title, `Complaint ${c.ref} · ${c.customerName} · ${c.phone}`,
        c.severity, c.stage === "in_progress" ? "in_progress" : "open", c.openedAt, c.slaDueAt,
      );
    }
  }

  // Bookings, campaigns, numbers -------------------------------------------
  const insertBooking = db.prepare(
    `INSERT INTO bookings (id, org_id, customer_name, phone, type, starts_at, duration_min, status, no_show_risk, source, reminder_sent)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const b of fx.bookings) {
    insertBooking.run(b.id, ORG_ID, b.customerName, b.phone, b.type, b.startsAt, b.durationMin, b.status, b.noShowRisk, b.source, b.reminderSent ? 1 : 0);
  }

  const insertCampaign = db.prepare(
    `INSERT INTO campaigns (id, org_id, name, agent_id, agent_name, series, contacts, dialed, connected, status, scrubbed_count, starts_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const c of fx.campaigns) {
    insertCampaign.run(c.id, ORG_ID, c.name, c.agentId, c.agentName, c.series, c.contacts, c.dialed, c.connected, c.status, c.scrubbedCount, c.startsAt);
  }

  const insertNumber = db.prepare(
    `INSERT INTO numbers (id, org_id, e164, series, provider, region, assigned_agent_id, assigned_agent_name, pickup_rate, monthly_rent_inr, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const n of fx.phoneNumbers) {
    insertNumber.run(n.id, ORG_ID, n.e164, n.series, n.provider, n.region, n.assignedAgentId, n.assignedAgentName, n.pickupRate, n.monthlyRentInr, n.status);
  }

  // A demo connector so lookup_order works out of the box. `demo` answers
  // from seeded data; a real tenant replaces it with a `rest` row pointing at
  // their own order API.
  db.prepare(
    `INSERT INTO connectors (id, org_id, name, kind, tool, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(uid("conn"), ORG_ID, "Demo order store", "demo", "lookup_order", "connected", now);

  // API keys + notifications -------------------------------------------------
  const insertKey = db.prepare(
    "INSERT INTO api_keys (id, org_id, label, prefix, key_hash, scopes, created_at, last_used_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  );
  for (const k of fx.apiKeys) {
    insertKey.run(k.id, ORG_ID, k.label, k.prefix, "seeded-placeholder", JSON.stringify(k.scopes), k.createdAt, k.lastUsedAt);
  }

  const insertNotification = db.prepare(
    "INSERT INTO notifications (id, org_id, kind, title, body, at, severity, read, href) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  for (const n of fx.notifications) {
    insertNotification.run(n.id, ORG_ID, n.kind, n.title, n.body, n.at, n.severity, n.read ? 1 : 0, n.href);
  }

  // Reference config ---------------------------------------------------------
  const insertBlob = db.prepare(
    "INSERT INTO config_blobs (org_id, key, json) VALUES (?, ?, ?)",
  );
  insertBlob.run(ORG_ID, "voices", JSON.stringify(fx.voices));
  insertBlob.run(ORG_ID, "script_tests", JSON.stringify(fx.scriptTests));
  insertBlob.run(ORG_ID, "security_settings", JSON.stringify(fx.securitySettings));
  insertBlob.run(ORG_ID, "sip_trunks", JSON.stringify(fx.sipTrunks));
  insertBlob.run(ORG_ID, "compliance", JSON.stringify(fx.complianceItems));
  insertBlob.run(ORG_ID, "integrations", JSON.stringify(fx.integrations));
  insertBlob.run(ORG_ID, "scrub_status", JSON.stringify(fx.scrubStatus));

  // Call history --------------------------------------------------------
  // ~40–70 calls a day for 14 days. Every dashboard aggregate — volume chart,
  // language mix, resolution rate, cost trend, usage meter — is computed from
  // these rows, so a live test call moves the same numbers the seed does.
  const insertCall = db.prepare(
    `INSERT INTO calls (id, org_id, agent_id, agent_name, phone, customer_name, direction, intent, language, source, status, started_at, ended_at, duration_sec, outcome, sentiment, sentiment_score, qa_score, qa_flag, tokens, ai_cost_inr, telephony_cost_inr, transcript, summary)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)`,
  );
  const insertUsage = db.prepare(
    "INSERT INTO usage_events (org_id, call_id, kind, quantity, cost_inr, at) VALUES (?, ?, ?, ?, ?, ?)",
  );

  const agentsList = fx.agents;
  const languages = ["hi", "en", "hinglish", "ta", "te", "mr", "bn"] as const;
  const langWeights = [0.34, 0.14, 0.22, 0.12, 0.08, 0.06, 0.04];
  const outcomes = ["resolved", "resolved", "resolved", "resolved", "escalated", "no_answer", "dropped"] as const;
  const sentiments = ["positive", "neutral", "neutral", "declining", "frustrated"] as const;

  const pickWeighted = <T,>(items: readonly T[], weights: number[]) => {
    let r = random();
    for (let i = 0; i < items.length; i += 1) {
      r -= weights[i];
      if (r <= 0) return items[i];
    }
    return items[items.length - 1];
  };

  const seedAll = db.transaction(() => {
    for (let day = 13; day >= 0; day -= 1) {
      const dayStart = new Date();
      dayStart.setHours(0, 0, 0, 0);
      dayStart.setDate(dayStart.getDate() - day);
      // Weekday shape with a mild upward trend toward today.
      const weekday = dayStart.getDay();
      const base = weekday === 0 ? 28 : weekday === 6 ? 38 : 52;
      const count = Math.round(base * (1 + (13 - day) * 0.015) + random() * 12);

      for (let i = 0; i < count; i += 1) {
        const agent = agentsList[Math.floor(random() * agentsList.length)];
        // Business-hours bell: most calls 10:00–19:00.
        const hour = Math.min(21, Math.max(8, Math.round(13.5 + (random() + random() - 1) * 5)));
        const startedAt = new Date(dayStart);
        startedAt.setHours(hour, Math.floor(random() * 60), Math.floor(random() * 60));
        if (startedAt.getTime() > Date.now()) continue;

        const durationSec = Math.round(45 + random() * 300);
        const endedAt = new Date(startedAt.getTime() + durationSec * 1000);
        const outcome = outcomes[Math.floor(random() * outcomes.length)];
        const answered = outcome !== "no_answer";
        const effectiveDuration = answered ? durationSec : 0;
        const sentiment = sentiments[Math.floor(random() * sentiments.length)];
        const language = pickWeighted(languages, langWeights);
        // ~25 tokens/sec of audio each way, per the Live API's own accounting.
        const tokens = answered ? Math.round(effectiveDuration * 25 * (1.6 + random() * 0.5)) : 0;
        const aiCost = +(tokens * 0.00028).toFixed(2);
        const telephonyCost = +((effectiveDuration / 60) * 0.45).toFixed(2);
        const qa = answered && random() > 0.25 ? Math.round(62 + random() * 36) : null;

        const callId = uid("call");
        const phone = `+91${String(7000000000 + Math.floor(random() * 2999999999))}`;
        insertCall.run(
          callId, ORG_ID, agent.id, agent.name, phone, null, random() > 0.35 ? "inbound" : "outbound",
          agent.intent, language, "phone", startedAt.toISOString(), endedAt.toISOString(),
          effectiveDuration, outcome, sentiment, 0.25 + random() * 0.6, qa,
          qa !== null && qa < 70 ? "Repeated caller input twice" : null,
          tokens, aiCost, telephonyCost,
        );
        if (answered) {
          insertUsage.run(ORG_ID, callId, "ai_tokens", tokens, aiCost, endedAt.toISOString());
          insertUsage.run(ORG_ID, callId, "telephony_minutes", +(effectiveDuration / 60).toFixed(2), telephonyCost, endedAt.toISOString());
        }
      }
    }
  });
  seedAll();

  db.prepare("INSERT INTO audit_log (org_id, user_id, event, detail, at) VALUES (?, NULL, 'seed', 'demo workspace created', ?)").run(ORG_ID, now);
  seedWorkspaceV2(db, ORG_ID);
}

/** v2 extras for the demo org — transfers, slots, contacts, trunks, DLT. */
export function seedWorkspaceV2(db: Database, orgId = ORG_ID) {
  // Lazy: workspace imports getDb, and this file is imported by db.ts.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { provisionWorkspace } = require("./workspace") as typeof import("./workspace");
  provisionWorkspace(orgId);

  const hasTransfers = (db.prepare("SELECT COUNT(*) n FROM transfer_targets WHERE org_id=?").get(orgId) as { n: number }).n;
  if (hasTransfers === 0) {
    const insert = db.prepare(
      `INSERT INTO transfer_targets (id, org_id, name, role, phone, hours, when_to_use, department_id, priority)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    insert.run(uid("xfer"), orgId, "Priya Desai", "Support lead", "+919820011122", "10:00-19:00 IST", "Angry caller, payment dispute, or they asked for a supervisor", "dept_support", 0);
    insert.run(uid("xfer"), orgId, "Maintenance control", "Technical desk", "+919820033344", "06:00-22:00 IST", "Escalator, lift, AC, or any on-ground fault that needs a crew now", "dept_technical", 1);
    insert.run(uid("xfer"), orgId, "Station manager", "Operations", "+919820055566", "Always on", "Safety, security, medical — transfer immediately", "dept_security", 0);
  }

  const hasSlots = (db.prepare("SELECT COUNT(*) n FROM appointment_types WHERE org_id=?").get(orgId) as { n: number }).n;
  if (hasSlots === 0) {
    const insert = db.prepare(
      `INSERT INTO appointment_types (id, org_id, name, duration_min, hours, days, location, buffer_min, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    insert.run(uid("apt"), orgId, "Home delivery slot", 60, "10:00-21:00", JSON.stringify(["mon", "tue", "wed", "thu", "fri", "sat"]), "Caller address", 15, "Offer two windows, never an open 'when?'");
    insert.run(uid("apt"), orgId, "Service visit", 45, "11:00-18:00", JSON.stringify(["mon", "tue", "wed", "thu", "fri"]), "On site", 30, "Need a working phone number");
    insert.run(uid("apt"), orgId, "Specialist callback", 30, "11:00-17:00", JSON.stringify(["mon", "tue", "wed", "thu", "fri"]), "Phone", 0, "Sales closer only");
  }

  db.prepare(
    `INSERT INTO workspace_playbook (org_id, business_type, hours, transfer_policy, booking_policy, complaint_sla_hours, extra_json)
     VALUES (?, ?, ?, ?, ?, 24, '{}')
     ON CONFLICT(org_id) DO UPDATE SET
       business_type=CASE WHEN workspace_playbook.business_type='' THEN excluded.business_type ELSE workspace_playbook.business_type END,
       hours=CASE WHEN workspace_playbook.hours='' THEN excluded.hours ELSE workspace_playbook.hours END,
       transfer_policy=CASE WHEN workspace_playbook.transfer_policy='' THEN excluded.transfer_policy ELSE workspace_playbook.transfer_policy END,
       booking_policy=CASE WHEN workspace_playbook.booking_policy='' THEN excluded.booking_policy ELSE workspace_playbook.booking_policy END`,
  ).run(
    orgId,
    "D2C + civic helpline (demo)",
    "10:00-19:00 IST, quiet hours 21:00-09:00",
    "Transfer on the second stuck turn, or immediately for safety. Read the desk name. Never invent a number.",
    "Only offer slots from the appointment types list. Confirm by SMS.",
  );

  const campaign = db.prepare("SELECT id FROM campaigns WHERE org_id=? LIMIT 1").get(orgId) as { id: string } | undefined;
  if (campaign) {
    const existing = (db.prepare("SELECT COUNT(*) n FROM campaign_contacts WHERE campaign_id=?").get(campaign.id) as { n: number }).n;
    if (existing === 0) {
      const insert = db.prepare(
        `INSERT INTO campaign_contacts (id, org_id, campaign_id, phone, name, language, dnd, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'queued')`,
      );
      for (const c of [
        { phone: "+919876542214", name: "Priya Menon", language: "hi", dnd: 0 },
        { phone: "+918765430091", name: "Arjun Patel", language: "gu", dnd: 0 },
        { phone: "+919445566778", name: "Sana Qureshi", language: "mr", dnd: 1 },
      ]) {
        insert.run(uid("cc"), orgId, campaign.id, c.phone, c.name, c.language, c.dnd);
      }
    }
  }

  if (!(db.prepare("SELECT COUNT(*) n FROM sip_trunks WHERE org_id=?").get(orgId) as { n: number }).n) {
    db.prepare(
      `INSERT INTO sip_trunks (id, org_id, name, host, channels, channels_in_use, status, latency_ms, asr)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(uid("sip"), orgId, "Plivo Mumbai", "sip.plivo.in", 120, 18, "healthy", 42, 0.91);
  }

  if (!(db.prepare("SELECT COUNT(*) n FROM dlt_templates WHERE org_id=?").get(orgId) as { n: number }).n) {
    db.prepare(
      `INSERT INTO dlt_templates (id, org_id, name, series, body, status, authority_id, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(uid("dlt"), orgId, "Delivery reminder", "160", "Your delivery is scheduled for {#var#}. Reply 1 to confirm.", "approved", "11010xxx", nowIso());
  }
}

export { ORG_ID, DEPARTMENTS };
