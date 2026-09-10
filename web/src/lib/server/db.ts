import "server-only";
import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";
// Import cycle with seed.ts, on purpose and safe: seed only *calls* nowIso/uid
// at seed time, long after both modules have finished loading.
import { seed } from "./seed";

/**
 * SQLite, on purpose.
 *
 * At this stage the whole backend fits in one process, and a file database
 * means `npm run dev` is the entire infrastructure — no container, no
 * connection string, nothing to provision before the first test call. The
 * schema is plain SQL and every query lives in repo.ts, so the move to
 * Postgres when concurrency demands it is a driver swap plus a handful of
 * dialect edits, not a rewrite. What would actually hurt later is an ORM's
 * dialect lock-in or, worse, staying on mock data while "the real backend"
 * waits for infrastructure decisions.
 *
 * WAL mode because the post-call pipeline writes (actions, usage events,
 * notifications) while dashboards read.
 */

const DB_DIR = process.env.SWARA_DB_DIR ?? path.join(process.cwd(), "data");
const DB_PATH = path.join(DB_DIR, "swara.db");

/** Bump when SCHEMA changes. Existing files migrate via V2_TABLES, they are not wiped. */
const SCHEMA_VERSION = 2;

const SCHEMA = /* sql */ `
  -- Tenancy ---------------------------------------------------------------
  CREATE TABLE orgs (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    plan          TEXT NOT NULL DEFAULT 'growth',   -- starter | growth | scale
    created_at    TEXT NOT NULL
  );

  -- Routing targets for post-call actions: "cleaning goes here, technical
  -- faults go there". Keywords are the no-AI fallback classifier.
  CREATE TABLE departments (
    id            TEXT PRIMARY KEY,
    org_id        TEXT NOT NULL REFERENCES orgs(id),
    slug          TEXT NOT NULL,
    name          TEXT NOT NULL,
    keywords      TEXT NOT NULL DEFAULT '[]',       -- json string[]
    UNIQUE (org_id, slug)
  );

  CREATE TABLE users (
    id            TEXT PRIMARY KEY,
    org_id        TEXT NOT NULL REFERENCES orgs(id),
    department_id TEXT REFERENCES departments(id),  -- null = org-wide view
    name          TEXT NOT NULL,
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT,                             -- null until invite accepted
    role          TEXT NOT NULL,                    -- owner|admin|supervisor|agent|analyst|billing
    status        TEXT NOT NULL DEFAULT 'active',   -- active|invited|suspended
    last_active_at TEXT,
    created_at    TEXT NOT NULL
  );

  -- One row per login. The cookie carries the raw token; only its hash is
  -- stored, so a leaked database does not mint sessions.
  CREATE TABLE sessions (
    token_hash    TEXT PRIMARY KEY,
    user_id       TEXT NOT NULL REFERENCES users(id),
    created_at    TEXT NOT NULL,
    expires_at    TEXT NOT NULL,
    user_agent    TEXT
  );

  -- Who did what: logins, payments, key creation. Complaint-handling products
  -- get asked for this in every serious procurement conversation.
  CREATE TABLE audit_log (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    org_id        TEXT NOT NULL,
    user_id       TEXT,
    event         TEXT NOT NULL,
    detail        TEXT,
    at            TEXT NOT NULL
  );

  -- Agents ------------------------------------------------------------------
  CREATE TABLE agents (
    id            TEXT PRIMARY KEY,
    org_id        TEXT NOT NULL REFERENCES orgs(id),
    name          TEXT NOT NULL,
    status        TEXT NOT NULL,
    languages     TEXT NOT NULL,                    -- json string[]
    intent        TEXT NOT NULL,
    direction     TEXT NOT NULL,
    voice_id      TEXT,
    mode          TEXT NOT NULL,
    prompt        TEXT,
    nodes         TEXT NOT NULL DEFAULT '[]',
    edges         TEXT NOT NULL DEFAULT '[]',
    version       INTEGER NOT NULL DEFAULT 1,
    updated_at    TEXT NOT NULL
  );

  CREATE TABLE agent_versions (
    id            TEXT PRIMARY KEY,
    org_id        TEXT NOT NULL,
    version       INTEGER NOT NULL,
    label         TEXT NOT NULL,
    author        TEXT NOT NULL,
    created_at    TEXT NOT NULL,
    is_live       INTEGER NOT NULL DEFAULT 0
  );

  -- Knowledge base ----------------------------------------------------------
  CREATE TABLE knowledge_docs (
    id            TEXT PRIMARY KEY,
    org_id        TEXT NOT NULL,
    agent_id      TEXT,                             -- null = org-wide fallback
    name          TEXT NOT NULL,
    kind          TEXT NOT NULL,                    -- pdf|url|csv|text
    size_label    TEXT NOT NULL,
    status        TEXT NOT NULL,                    -- indexed|indexing|failed
    updated_at    TEXT NOT NULL
  );

  CREATE TABLE knowledge_chunks (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    doc_id        TEXT NOT NULL REFERENCES knowledge_docs(id),
    seq           INTEGER NOT NULL,
    content       TEXT NOT NULL,
    embedding     BLOB                              -- float32[], null = keyword-only
  );

  -- Customers ---------------------------------------------------------------
  CREATE TABLE customers (
    id            TEXT PRIMARY KEY,
    org_id        TEXT NOT NULL,
    phone         TEXT NOT NULL,
    name          TEXT NOT NULL,
    city          TEXT NOT NULL DEFAULT '',
    preferred_language TEXT NOT NULL DEFAULT 'hi',
    orders        INTEGER NOT NULL DEFAULT 0,
    ltv_inr       INTEGER NOT NULL DEFAULT 0,
    sentiment     TEXT NOT NULL DEFAULT 'neutral',
    since         TEXT NOT NULL,
    last_contact_at TEXT NOT NULL,
    last_channel  TEXT NOT NULL DEFAULT 'call',
    tags          TEXT NOT NULL DEFAULT '[]',
    UNIQUE (org_id, phone)
  );

  CREATE TABLE timeline_events (
    id            TEXT PRIMARY KEY,
    customer_id   TEXT NOT NULL REFERENCES customers(id),
    kind          TEXT NOT NULL,
    title         TEXT NOT NULL,
    detail        TEXT,
    at            TEXT NOT NULL,
    amount_inr    INTEGER,
    sentiment     TEXT
  );

  -- Calls ---------------------------------------------------------------
  -- One row per conversation, browser test calls included. Every dashboard
  -- number is an aggregate over this table, which is what "live data" means.
  CREATE TABLE calls (
    id            TEXT PRIMARY KEY,
    org_id        TEXT NOT NULL,
    agent_id      TEXT,
    agent_name    TEXT NOT NULL,
    phone         TEXT NOT NULL,
    customer_name TEXT,
    direction     TEXT NOT NULL,
    intent        TEXT NOT NULL DEFAULT 'other',
    language      TEXT NOT NULL DEFAULT 'hi',
    source        TEXT NOT NULL DEFAULT 'phone',    -- phone|browser
    status        TEXT NOT NULL DEFAULT 'live',     -- live|completed
    started_at    TEXT NOT NULL,
    ended_at      TEXT,
    duration_sec  INTEGER NOT NULL DEFAULT 0,
    outcome       TEXT,                             -- resolved|escalated|no_answer|dropped|voicemail
    sentiment     TEXT NOT NULL DEFAULT 'neutral',
    sentiment_score REAL NOT NULL DEFAULT 0.5,
    qa_score      REAL,
    qa_flag       TEXT,
    tokens        INTEGER NOT NULL DEFAULT 0,
    ai_cost_inr   REAL NOT NULL DEFAULT 0,
    telephony_cost_inr REAL NOT NULL DEFAULT 0,
    transcript    TEXT,                             -- json Turn[]
    summary       TEXT
  );
  CREATE INDEX idx_calls_org_started ON calls(org_id, started_at);
  CREATE INDEX idx_calls_org_status ON calls(org_id, status);

  -- Complaints ---------------------------------------------------------------
  CREATE TABLE complaints (
    id            TEXT PRIMARY KEY,
    org_id        TEXT NOT NULL,
    ref           TEXT NOT NULL,                    -- what the caller is told
    title         TEXT NOT NULL,
    category      TEXT NOT NULL,
    severity      TEXT NOT NULL,
    stage         TEXT NOT NULL DEFAULT 'new',
    customer_name TEXT NOT NULL,
    phone         TEXT NOT NULL,
    opened_at     TEXT NOT NULL,
    sla_due_at    TEXT NOT NULL,
    assignee      TEXT,
    call_id       TEXT,
    department_id TEXT REFERENCES departments(id),
    has_recording INTEGER NOT NULL DEFAULT 0,
    has_consent   INTEGER NOT NULL DEFAULT 1
  );

  -- The department work queue. A complaint says "a caller is unhappy"; an
  -- action says "cleaning crew, platform 2, before 6pm". Departments log in
  -- and work this table, not the raw call log.
  CREATE TABLE actions (
    id            TEXT PRIMARY KEY,
    org_id        TEXT NOT NULL,
    department_id TEXT NOT NULL REFERENCES departments(id),
    call_id       TEXT,
    complaint_id  TEXT,
    title         TEXT NOT NULL,
    detail        TEXT NOT NULL DEFAULT '',
    severity      TEXT NOT NULL DEFAULT 'medium',
    status        TEXT NOT NULL DEFAULT 'open',     -- open|in_progress|done
    created_at    TEXT NOT NULL,
    due_at        TEXT,
    completed_at  TEXT,
    completed_by  TEXT
  );
  CREATE INDEX idx_actions_dept_status ON actions(department_id, status);

  -- Operations ----------------------------------------------------------
  CREATE TABLE bookings (
    id            TEXT PRIMARY KEY,
    org_id        TEXT NOT NULL,
    customer_name TEXT NOT NULL,
    phone         TEXT NOT NULL,
    type          TEXT NOT NULL,
    starts_at     TEXT NOT NULL,
    duration_min  INTEGER NOT NULL,
    status        TEXT NOT NULL,
    no_show_risk  REAL NOT NULL DEFAULT 0,
    source        TEXT NOT NULL DEFAULT 'call',
    reminder_sent INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE campaigns (
    id            TEXT PRIMARY KEY,
    org_id        TEXT NOT NULL,
    name          TEXT NOT NULL,
    agent_id      TEXT,
    agent_name    TEXT NOT NULL,
    series        TEXT NOT NULL,
    contacts      INTEGER NOT NULL,
    dialed        INTEGER NOT NULL DEFAULT 0,
    connected     INTEGER NOT NULL DEFAULT 0,
    status        TEXT NOT NULL,
    scrubbed_count INTEGER NOT NULL DEFAULT 0,
    starts_at     TEXT
  );

  CREATE TABLE numbers (
    id            TEXT PRIMARY KEY,
    org_id        TEXT NOT NULL,
    e164          TEXT NOT NULL,
    series        TEXT NOT NULL,
    provider      TEXT NOT NULL,
    region        TEXT NOT NULL,
    assigned_agent_id TEXT,
    assigned_agent_name TEXT,
    pickup_rate   REAL NOT NULL DEFAULT 0,
    monthly_rent_inr INTEGER NOT NULL DEFAULT 0,
    status        TEXT NOT NULL DEFAULT 'active'
  );

  -- Customer-data connectors -------------------------------------------------
  -- How the agent reaches the tenant's own systems (order status, account
  -- lookups). One row per configured source; kind decides the executor.
  CREATE TABLE connectors (
    id            TEXT PRIMARY KEY,
    org_id        TEXT NOT NULL,
    name          TEXT NOT NULL,
    kind          TEXT NOT NULL,                    -- rest | demo
    tool          TEXT NOT NULL,                    -- which function call it serves, e.g. lookup_order
    base_url      TEXT,
    auth_header   TEXT,                             -- header name
    auth_secret   TEXT,                             -- header value; encrypt-at-rest before real tenants
    status        TEXT NOT NULL DEFAULT 'connected',
    created_at    TEXT NOT NULL
  );

  -- Metering & money ----------------------------------------------------
  -- Append-only. Invoices, the usage screen and cost dashboards are all views
  -- over this table; nothing writes a "total" anywhere.
  CREATE TABLE usage_events (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    org_id        TEXT NOT NULL,
    call_id       TEXT,
    kind          TEXT NOT NULL,                    -- ai_tokens | telephony_minutes
    quantity      REAL NOT NULL,
    cost_inr      REAL NOT NULL,
    at            TEXT NOT NULL
  );
  CREATE INDEX idx_usage_org_at ON usage_events(org_id, at);

  CREATE TABLE invoices (
    id            TEXT PRIMARY KEY,
    org_id        TEXT NOT NULL,
    cycle_start   TEXT NOT NULL,
    cycle_end     TEXT NOT NULL,
    plan          TEXT NOT NULL,
    plan_fee_inr  INTEGER NOT NULL,
    overage_minutes INTEGER NOT NULL DEFAULT 0,
    overage_inr   REAL NOT NULL DEFAULT 0,
    total_inr     REAL NOT NULL,
    status        TEXT NOT NULL DEFAULT 'due',      -- due|paid|void
    created_at    TEXT NOT NULL,
    paid_at       TEXT,
    UNIQUE (org_id, cycle_start)
  );

  CREATE TABLE payments (
    id            TEXT PRIMARY KEY,
    org_id        TEXT NOT NULL,
    invoice_id    TEXT NOT NULL REFERENCES invoices(id),
    amount_inr    REAL NOT NULL,
    method        TEXT NOT NULL,                    -- upi|card|netbanking|simulated
    provider      TEXT NOT NULL DEFAULT 'razorpay',
    provider_ref  TEXT,
    status        TEXT NOT NULL,                    -- created|captured|failed
    at            TEXT NOT NULL
  );

  CREATE TABLE api_keys (
    id            TEXT PRIMARY KEY,
    org_id        TEXT NOT NULL,
    label         TEXT NOT NULL,
    prefix        TEXT NOT NULL,
    key_hash      TEXT NOT NULL,
    scopes        TEXT NOT NULL DEFAULT '[]',
    created_at    TEXT NOT NULL,
    last_used_at  TEXT
  );

  CREATE TABLE notifications (
    id            TEXT PRIMARY KEY,
    org_id        TEXT NOT NULL,
    kind          TEXT NOT NULL,
    title         TEXT NOT NULL,
    body          TEXT NOT NULL,
    at            TEXT NOT NULL,
    severity      TEXT NOT NULL DEFAULT 'low',
    read          INTEGER NOT NULL DEFAULT 0,
    href          TEXT
  );

  -- Reference config -----------------------------------------------------
  -- Voice catalogue, security capability matrix, trunk stats, compliance
  -- checklist, integration directory, script tests, scrub status. These are
  -- config-shaped, read whole and written rarely, so they live as JSON
  -- documents instead of eight more tables that would buy no query we run.
  -- Anything that grows a real write path graduates to its own table, the way
  -- complaints and calls already have.
  CREATE TABLE config_blobs (
    org_id        TEXT NOT NULL,
    key           TEXT NOT NULL,
    json          TEXT NOT NULL,
    PRIMARY KEY (org_id, key)
  );

  CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`;

/**
 * Tables that graduated from "we'll add these later". Applied on a fresh
 * install (after SCHEMA) and on a v1 file in place, so a demo workspace
 * survives the upgrade.
 */
const V2_TABLES = /* sql */ `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    version     INTEGER PRIMARY KEY,
    applied_at  TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS workspace_playbook (
    org_id              TEXT PRIMARY KEY REFERENCES orgs(id),
    business_type       TEXT,
    hours               TEXT,
    transfer_policy     TEXT,
    booking_policy      TEXT,
    complaint_sla_hours INTEGER NOT NULL DEFAULT 24,
    extra_json          TEXT NOT NULL DEFAULT '{}'
  );

  CREATE TABLE IF NOT EXISTS voices (
    id                TEXT PRIMARY KEY,
    org_id            TEXT NOT NULL REFERENCES orgs(id),
    live_name         TEXT NOT NULL,
    name              TEXT NOT NULL,
    gender            TEXT NOT NULL,
    style             TEXT NOT NULL,
    descriptor        TEXT NOT NULL,
    persona_name      TEXT NOT NULL,
    prompt_template   TEXT NOT NULL,
    language          TEXT NOT NULL DEFAULT 'hi',
    pace              REAL NOT NULL DEFAULT 0.5,
    formality         REAL NOT NULL DEFAULT 0.5,
    warmth            REAL NOT NULL DEFAULT 0.6,
    assigned_agent_id TEXT,
    cloned            INTEGER NOT NULL DEFAULT 0,
    latency_ms        INTEGER NOT NULL DEFAULT 300,
    updated_at        TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS transfer_targets (
    id              TEXT PRIMARY KEY,
    org_id          TEXT NOT NULL REFERENCES orgs(id),
    name            TEXT NOT NULL,
    role            TEXT NOT NULL,
    phone           TEXT NOT NULL,
    hours           TEXT,
    when_to_use     TEXT NOT NULL,
    department_id   TEXT REFERENCES departments(id),
    priority        INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS appointment_types (
    id            TEXT PRIMARY KEY,
    org_id        TEXT NOT NULL REFERENCES orgs(id),
    name          TEXT NOT NULL,
    duration_min  INTEGER NOT NULL,
    hours         TEXT,
    days          TEXT NOT NULL DEFAULT '[]',
    location      TEXT,
    buffer_min    INTEGER NOT NULL DEFAULT 0,
    notes         TEXT
  );

  CREATE TABLE IF NOT EXISTS campaign_contacts (
    id              TEXT PRIMARY KEY,
    org_id          TEXT NOT NULL,
    campaign_id     TEXT NOT NULL REFERENCES campaigns(id),
    phone           TEXT NOT NULL,
    name            TEXT,
    language        TEXT,
    dnd             INTEGER NOT NULL DEFAULT 0,
    status          TEXT NOT NULL DEFAULT 'queued',
    last_attempt_at TEXT,
    notes           TEXT
  );

  CREATE TABLE IF NOT EXISTS recordings (
    id            TEXT PRIMARY KEY,
    org_id        TEXT NOT NULL,
    call_id       TEXT NOT NULL,
    object_key    TEXT NOT NULL,
    duration_sec  INTEGER,
    retain_until  TEXT,
    created_at    TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS consent_artefacts (
    id            TEXT PRIMARY KEY,
    org_id        TEXT NOT NULL,
    call_id       TEXT,
    customer_id   TEXT,
    kind          TEXT NOT NULL,
    captured_at   TEXT NOT NULL,
    method        TEXT NOT NULL,
    text          TEXT
  );

  CREATE TABLE IF NOT EXISTS tool_invocations (
    id            TEXT PRIMARY KEY,
    org_id        TEXT NOT NULL,
    call_id       TEXT,
    name          TEXT NOT NULL,
    args          TEXT NOT NULL,
    result        TEXT NOT NULL,
    at            TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS webhook_events (
    id            TEXT PRIMARY KEY,
    org_id        TEXT NOT NULL,
    connector_id  TEXT,
    kind          TEXT NOT NULL,
    payload       TEXT NOT NULL,
    received_at   TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS invites (
    id            TEXT PRIMARY KEY,
    org_id        TEXT NOT NULL,
    email         TEXT NOT NULL,
    role          TEXT NOT NULL,
    department_id TEXT,
    token_hash    TEXT NOT NULL,
    expires_at    TEXT NOT NULL,
    accepted_at   TEXT,
    created_at    TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS dlt_templates (
    id            TEXT PRIMARY KEY,
    org_id        TEXT NOT NULL,
    name          TEXT NOT NULL,
    series        TEXT NOT NULL,
    body          TEXT NOT NULL,
    status        TEXT NOT NULL,
    authority_id  TEXT,
    updated_at    TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sip_trunks (
    id              TEXT PRIMARY KEY,
    org_id          TEXT NOT NULL,
    name            TEXT NOT NULL,
    host            TEXT NOT NULL,
    channels        INTEGER NOT NULL,
    channels_in_use INTEGER NOT NULL DEFAULT 0,
    status          TEXT NOT NULL,
    latency_ms      INTEGER NOT NULL DEFAULT 0,
    asr             REAL NOT NULL DEFAULT 0
  );
`;

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;

  mkdirSync(DB_DIR, { recursive: true });
  db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  const hasMeta = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='meta'")
    .get();

  if (!hasMeta) {
    db.exec(SCHEMA);
    db.exec(V2_TABLES);
    db.prepare("INSERT INTO meta (key, value) VALUES ('schema_version', ?)").run(
      String(SCHEMA_VERSION),
    );
    db.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)").run(
      SCHEMA_VERSION,
      new Date().toISOString(),
    );
  } else {
    const row = db.prepare("SELECT value FROM meta WHERE key='schema_version'").get() as
      | { value: string }
      | undefined;
    const current = Number(row?.value ?? 0);
    if (current < SCHEMA_VERSION) {
      db.exec(V2_TABLES);
      db.prepare("UPDATE meta SET value=? WHERE key='schema_version'").run(String(SCHEMA_VERSION));
      db.prepare(
        "INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (?, ?)",
      ).run(SCHEMA_VERSION, new Date().toISOString());
    } else if (current > SCHEMA_VERSION) {
      throw new Error(
        `Database schema is v${current}, code expects v${SCHEMA_VERSION}.`,
      );
    }
  }

  // First run: an empty database seeds itself so the console never renders
  // blank while someone hunts for a seed command.
  const orgCount = (db.prepare("SELECT COUNT(*) n FROM orgs").get() as { n: number }).n;
  if (orgCount === 0) {
    try {
      // One transaction for the whole seed: either the demo workspace exists
      // completely or not at all. A partial seed is the worst outcome — orgs
      // present, users missing, and every login failing mysteriously.
      db.transaction(() => seed(db!))();
    } catch (error) {
      // Route chunks each get their own instance of this module, so two
      // concurrent first requests can both see an empty database. The loser
      // of that race hits a UNIQUE/PK violation on a row the winner already
      // wrote — which means the data is there and this connection can just
      // use it. But the same exception also fires for a genuine seed bug, and
      // the difference is observable: the race-winner leaves a populated orgs
      // table, a bug leaves nothing. Only the first case is survivable.
      const orgsNow = (db.prepare("SELECT COUNT(*) n FROM orgs").get() as { n: number }).n;
      if (orgsNow === 0) throw error;
      console.warn("[db] concurrent seed detected, using existing data:", String(error));
    }
  }

  // v1 workspaces that just migrated still need voices / playbook rows.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const extra = require("./seed") as typeof import("./seed");
  const orgIds = db.prepare("SELECT id FROM orgs").all() as { id: string }[];
  for (const org of orgIds) extra.seedWorkspaceV2(db, org.id);

  const versionCols = db.prepare("PRAGMA table_info(agent_versions)").all() as { name: string }[];
  if (!versionCols.some((c) => c.name === "agent_id")) {
    db.exec("ALTER TABLE agent_versions ADD COLUMN agent_id TEXT");
  }
  if (!versionCols.some((c) => c.name === "snapshot")) {
    db.exec("ALTER TABLE agent_versions ADD COLUMN snapshot TEXT");
  }

  const knowledgeCols = db.prepare("PRAGMA table_info(knowledge_docs)").all() as { name: string }[];
  if (!knowledgeCols.some((c) => c.name === "agent_id")) {
    db.exec("ALTER TABLE knowledge_docs ADD COLUMN agent_id TEXT");
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS setup_chats (
      org_id      TEXT PRIMARY KEY REFERENCES orgs(id),
      messages    TEXT NOT NULL DEFAULT '[]',
      facts       TEXT NOT NULL DEFAULT '[]',
      plan        TEXT,
      applied_at  TEXT,
      updated_at  TEXT NOT NULL
    );
  `);

  return db;
}

export function nowIso() {
  return new Date().toISOString();
}

export function uid(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
}
