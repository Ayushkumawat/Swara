import "server-only";
import { getDb, nowIso, uid } from "./db";
import { addTimelineEvent, tagCustomer, touchCustomer } from "./customers";
import { PLANS } from "@/lib/pricing";

/**
 * Every read the console performs, computed from rows.
 *
 * The rule this file enforces: no stored aggregates. `callsToday`,
 * `resolutionRate`, the volume chart, the usage meter — all of them are
 * SQL over the `calls` and `usage_events` tables at read time. The fixtures
 * shipped pre-computed numbers, which is exactly the habit that ends with a
 * dashboard that disagrees with its own invoice. Here a finished test call
 * moves every number it should move, because there is only one source.
 *
 * Shapes returned here match `lib/api/schemas.ts` field-for-field; the client
 * re-parses them with Zod, so drift fails loudly in dev instead of rendering
 * as undefined.
 */

type Row = Record<string, unknown>;
const db = () => getDb();

/* ── time helpers ─────────────────────────────────────────────────────────── */

function daysAgoIso(days: number): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

function cycleBounds(): { start: string; end: string } {
  // Billing cycles are calendar months. An anchor date per org can come later;
  // month boundaries make the invoice explainable over the phone, which for an
  // Indian SMB product is worth more than anniversary billing.
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return { start: start.toISOString(), end: end.toISOString() };
}

const pct = (current: number, previous: number) =>
  previous === 0 ? 0 : +((current - previous) / previous).toFixed(3);

/* ── overview ─────────────────────────────────────────────────────────────── */

export function overview(orgId: string) {
  const d = db();
  const today = daysAgoIso(0);
  const yesterday = daysAgoIso(1);
  const week = daysAgoIso(7);
  const twoWeeks = daysAgoIso(14);

  const count = (sql: string, ...args: unknown[]) =>
    (d.prepare(sql).get(...args) as { n: number }).n;

  const callsToday = count(
    "SELECT COUNT(*) n FROM calls WHERE org_id=? AND started_at>=?",
    orgId, today,
  );
  const callsYesterday = count(
    "SELECT COUNT(*) n FROM calls WHERE org_id=? AND started_at>=? AND started_at<?",
    orgId, yesterday, today,
  );

  const { start: cycleStart } = cycleBounds();
  const minutesUsed = Math.round(
    ((d.prepare(
      "SELECT COALESCE(SUM(duration_sec),0) s FROM calls WHERE org_id=? AND started_at>=?",
    ).get(orgId, cycleStart) as { s: number }).s) / 60,
  );
  const minutesThisWeek = (d.prepare(
    "SELECT COALESCE(SUM(duration_sec),0) s FROM calls WHERE org_id=? AND started_at>=?",
  ).get(orgId, week) as { s: number }).s;
  const minutesLastWeek = (d.prepare(
    "SELECT COALESCE(SUM(duration_sec),0) s FROM calls WHERE org_id=? AND started_at>=? AND started_at<?",
  ).get(orgId, twoWeeks, week) as { s: number }).s;

  const resolution = (from: string, to?: string) => {
    const row = d.prepare(
      `SELECT SUM(CASE WHEN outcome='resolved' THEN 1 ELSE 0 END) r,
              SUM(CASE WHEN outcome IS NOT NULL AND outcome!='no_answer' THEN 1 ELSE 0 END) t
       FROM calls WHERE org_id=? AND started_at>=? ${to ? "AND started_at<?" : ""}`,
    ).get(...(to ? [orgId, from, to] : [orgId, from])) as { r: number | null; t: number | null };
    return row.t ? (row.r ?? 0) / row.t : 0;
  };
  const resolutionRate = resolution(week);
  const resolutionPrev = resolution(twoWeeks, week);

  const openComplaints = count(
    "SELECT COUNT(*) n FROM complaints WHERE org_id=? AND stage!='resolved'",
    orgId,
  );
  const openedThisWeek = count(
    "SELECT COUNT(*) n FROM complaints WHERE org_id=? AND opened_at>=?",
    orgId, week,
  );
  const openedPrevWeek = count(
    "SELECT COUNT(*) n FROM complaints WHERE org_id=? AND opened_at>=? AND opened_at<?",
    orgId, twoWeeks, week,
  );

  // "Live" needs a heartbeat guard: a browser tab killed mid-call never sends
  // its completion, and a phantom active call on the wall board destroys trust
  // in every other number.
  const activeCalls = count(
    "SELECT COUNT(*) n FROM calls WHERE org_id=? AND status='live' AND started_at>=?",
    orgId, new Date(Date.now() - 30 * 60_000).toISOString(),
  );

  const volume = (d.prepare(
    `SELECT substr(started_at,1,10) day,
            SUM(CASE WHEN direction='inbound' THEN 1 ELSE 0 END) inbound,
            SUM(CASE WHEN direction='outbound' THEN 1 ELSE 0 END) outbound
     FROM calls WHERE org_id=? AND started_at>=?
     GROUP BY day ORDER BY day`,
  ).all(orgId, twoWeeks) as { day: string; inbound: number; outbound: number }[]).map((r) => ({
    date: r.day,
    inbound: r.inbound,
    outbound: r.outbound,
  }));

  const langRows = d.prepare(
    `SELECT language, COUNT(*) n FROM calls WHERE org_id=? AND started_at>=?
     GROUP BY language ORDER BY n DESC`,
  ).all(orgId, week) as { language: string; n: number }[];
  const langTotal = langRows.reduce((s, r) => s + r.n, 0) || 1;
  const languageMix = langRows.slice(0, 6).map((r) => ({
    language: r.language,
    share: +(r.n / langTotal).toFixed(3),
  }));

  return {
    callsToday,
    callsTodayDelta: pct(callsToday, callsYesterday),
    minutesUsed,
    minutesDelta: pct(minutesThisWeek, minutesLastWeek),
    resolutionRate: +resolutionRate.toFixed(3),
    resolutionDelta: +(resolutionRate - resolutionPrev).toFixed(3),
    openComplaints,
    complaintsDelta: openedThisWeek - openedPrevWeek,
    activeCalls,
    volume,
    languageMix,
  };
}

/* ── analytics ────────────────────────────────────────────────────────────── */

export function analytics(orgId: string) {
  const d = db();
  const week = daysAgoIso(7);
  const twoWeeks = daysAgoIso(14);
  const month = daysAgoIso(30);

  const window = (from: string, to?: string) =>
    d.prepare(
      `SELECT AVG(CASE WHEN duration_sec>0 THEN duration_sec END) handle,
              SUM(CASE WHEN outcome='escalated' THEN 1.0 ELSE 0 END) esc,
              SUM(CASE WHEN outcome IS NOT NULL AND outcome!='no_answer' THEN 1 ELSE 0 END) answered,
              AVG(qa_score) qa,
              SUM(ai_cost_inr + telephony_cost_inr) cost
       FROM calls WHERE org_id=? AND status='completed' AND started_at>=? ${to ? "AND started_at<?" : ""}`,
    ).get(...(to ? [orgId, from, to] : [orgId, from])) as {
      handle: number | null; esc: number | null; answered: number | null; qa: number | null; cost: number | null;
    };

  const cur = window(week);
  const prev = window(twoWeeks, week);

  const escalationRate = cur.answered ? (cur.esc ?? 0) / cur.answered : 0;
  const escalationPrev = prev.answered ? (prev.esc ?? 0) / prev.answered : 0;
  // QA is scored 0–100; CSAT renders on a 5-point scale. One mapping, used
  // everywhere, until real post-call survey data replaces it.
  const csatOf = (qa: number | null) => (qa ? +(qa / 20).toFixed(2) : 0);
  const costPerCall = (w: typeof cur) => (w.answered ? +((w.cost ?? 0) / w.answered).toFixed(2) : 0);

  const csatTrend = (d.prepare(
    `SELECT substr(started_at,1,10) day, AVG(qa_score) qa
     FROM calls WHERE org_id=? AND started_at>=? AND qa_score IS NOT NULL
     GROUP BY day ORDER BY day`,
  ).all(orgId, month) as { day: string; qa: number }[]).map((r) => ({
    date: r.day,
    value: csatOf(r.qa),
  }));

  const costTrend = (d.prepare(
    `SELECT substr(at,1,10) day,
            SUM(CASE WHEN kind='ai_tokens' THEN cost_inr ELSE 0 END) ai,
            SUM(CASE WHEN kind='telephony_minutes' THEN cost_inr ELSE 0 END) telephony
     FROM usage_events WHERE org_id=? AND at>=? GROUP BY day ORDER BY day`,
  ).all(orgId, month) as { day: string; ai: number; telephony: number }[]).map((r) => ({
    date: r.day,
    ai: +r.ai.toFixed(2),
    telephony: +r.telephony.toFixed(2),
  }));

  const OUTCOME_LABEL: Record<string, string> = {
    resolved: "Resolved by agent",
    escalated: "Escalated to human",
    no_answer: "No answer",
    dropped: "Dropped",
    voicemail: "Voicemail",
  };
  const outcomeMix = (d.prepare(
    `SELECT outcome, COUNT(*) n FROM calls
     WHERE org_id=? AND started_at>=? AND outcome IS NOT NULL
     GROUP BY outcome ORDER BY n DESC`,
  ).all(orgId, week) as { outcome: string; n: number }[]).map((r) => ({
    outcome: OUTCOME_LABEL[r.outcome] ?? r.outcome,
    count: r.n,
  }));

  const scoredCalls = (d.prepare(
    `SELECT * FROM calls WHERE org_id=? AND status='completed' AND qa_score IS NOT NULL
     ORDER BY started_at DESC LIMIT 24`,
  ).all(orgId) as Row[]).map(toCallRecord);

  return {
    avgHandleSec: Math.round(cur.handle ?? 0),
    containmentRate: +(1 - escalationRate).toFixed(3),
    escalationRate: +escalationRate.toFixed(3),
    csat: csatOf(cur.qa),
    costPerCallInr: costPerCall(cur),
    deltas: {
      avgHandleSec: pct(cur.handle ?? 0, prev.handle ?? 0),
      containmentRate: +(escalationPrev - escalationRate).toFixed(3),
      escalationRate: +(escalationRate - escalationPrev).toFixed(3),
      csat: +(csatOf(cur.qa) - csatOf(prev.qa)).toFixed(2),
      costPerCallInr: pct(costPerCall(cur), costPerCall(prev)),
    },
    csatTrend,
    costTrend,
    outcomeMix,
    scoredCalls,
  };
}

function toCallRecord(r: Row) {
  return {
    id: r.id as string,
    phone: r.phone as string,
    agentName: r.agent_name as string,
    intent: r.intent as string,
    language: r.language as string,
    direction: r.direction as string,
    startedAt: r.started_at as string,
    durationSec: r.duration_sec as number,
    outcome: (r.outcome as string) ?? "dropped",
    sentiment: r.sentiment as string,
    qaScore: r.qa_score as number | null,
    qaFlag: r.qa_flag as string | null,
    costInr: +(((r.ai_cost_inr as number) ?? 0) + ((r.telephony_cost_inr as number) ?? 0)).toFixed(2),
  };
}

/* ── billing ─────────────────────────────────────────────────────────────── */

export function usage(orgId: string) {
  const d = db();
  const { start, end } = cycleBounds();
  const org = d.prepare("SELECT plan FROM orgs WHERE id=?").get(orgId) as { plan: string };
  const plan = PLANS.find((p) => p.id === org.plan) ?? PLANS[1];

  const usedMinutes = Math.round(
    ((d.prepare(
      "SELECT COALESCE(SUM(duration_sec),0) s FROM calls WHERE org_id=? AND started_at>=?",
    ).get(orgId, start) as { s: number }).s) / 60,
  );

  const costs = d.prepare(
    `SELECT SUM(CASE WHEN kind='ai_tokens' THEN cost_inr ELSE 0 END) ai,
            SUM(CASE WHEN kind='telephony_minutes' THEN cost_inr ELSE 0 END) tel
     FROM usage_events WHERE org_id=? AND at>=?`,
  ).get(orgId, start) as { ai: number | null; tel: number | null };

  const dailyMinutes = (d.prepare(
    `SELECT substr(started_at,1,10) day, SUM(duration_sec)/60.0 m
     FROM calls WHERE org_id=? AND started_at>=? GROUP BY day ORDER BY day`,
  ).all(orgId, daysAgoIso(14)) as { day: string; m: number }[]).map((r) => ({
    date: r.day,
    minutes: Math.round(r.m),
  }));

  return {
    plan: plan.id,
    planLabel: plan.name,
    planPriceInr: plan.priceInr,
    includedMinutes: plan.includedMinutes,
    usedMinutes,
    overageRateInr: plan.overageInr,
    cycleStart: start,
    cycleEnd: end,
    aiCostInr: +(costs.ai ?? 0).toFixed(2),
    telephonyCostInr: +(costs.tel ?? 0).toFixed(2),
    dailyMinutes,
  };
}

/**
 * Past cycles as invoices. Generated lazily from usage_events on read and
 * upserted, so an invoice always agrees with the meter — there is no job that
 * could fail and leave the two apart. Payment state lives on the row.
 */
export function invoices(orgId: string) {
  const d = db();
  const org = d.prepare("SELECT plan, created_at FROM orgs WHERE id=?").get(orgId) as {
    plan: string; created_at: string;
  };
  const plan = PLANS.find((p) => p.id === org.plan) ?? PLANS[1];

  const first = d.prepare(
    "SELECT MIN(started_at) m FROM calls WHERE org_id=?",
  ).get(orgId) as { m: string | null };
  const from = new Date(first.m ?? org.created_at);

  const cursor = new Date(from.getFullYear(), from.getMonth(), 1);
  const currentCycleStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

  while (cursor < currentCycleStart) {
    const cycleStart = new Date(cursor);
    const cycleEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
    const minutes = Math.round(
      ((d.prepare(
        "SELECT COALESCE(SUM(duration_sec),0) s FROM calls WHERE org_id=? AND started_at>=? AND started_at<?",
      ).get(orgId, cycleStart.toISOString(), cycleEnd.toISOString()) as { s: number }).s) / 60,
    );
    if (minutes > 0) {
      const overageMinutes = Math.max(0, minutes - plan.includedMinutes);
      const overageInr = overageMinutes * plan.overageInr;
      const total = plan.priceInr + overageInr;
      const id = `inv_${orgId}_${cycleStart.toISOString().slice(0, 7)}`;
      d.prepare(
        `INSERT INTO invoices (id, org_id, cycle_start, cycle_end, plan, plan_fee_inr, overage_minutes, overage_inr, total_inr, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'due', ?)
         ON CONFLICT (org_id, cycle_start) DO NOTHING`,
      ).run(id, orgId, cycleStart.toISOString(), cycleEnd.toISOString(), plan.id, plan.priceInr, overageMinutes, overageInr, total, nowIso());
    }
    cursor.setMonth(cursor.getMonth() + 1);
  }

  return (d.prepare(
    "SELECT * FROM invoices WHERE org_id=? ORDER BY cycle_start DESC",
  ).all(orgId) as Row[]).map((r) => ({
    id: r.id as string,
    cycleStart: r.cycle_start as string,
    cycleEnd: r.cycle_end as string,
    plan: r.plan as string,
    planFeeInr: r.plan_fee_inr as number,
    overageMinutes: r.overage_minutes as number,
    overageInr: r.overage_inr as number,
    totalInr: r.total_inr as number,
    status: r.status as string,
    paidAt: (r.paid_at as string) ?? null,
  }));
}

/**
 * Payment capture. With RAZORPAY_KEY_ID unset this records a simulated
 * capture so the flow is walkable end to end; with keys set, this is where the
 * order-create call goes. The invoice/payment bookkeeping is identical either
 * way, which is the part that must not change when the gateway arrives.
 */
export function payInvoice(orgId: string, invoiceId: string, userEmail: string) {
  const d = db();
  const invoice = d.prepare(
    "SELECT * FROM invoices WHERE id=? AND org_id=?",
  ).get(invoiceId, orgId) as Row | undefined;
  if (!invoice) return { error: "No such invoice" } as const;
  if (invoice.status === "paid") return { error: "Already paid" } as const;

  const simulated = !process.env.RAZORPAY_KEY_ID;
  const paymentId = uid("pay");
  const now = nowIso();
  d.prepare(
    `INSERT INTO payments (id, org_id, invoice_id, amount_inr, method, provider, provider_ref, status, at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'captured', ?)`,
  ).run(paymentId, orgId, invoiceId, invoice.total_inr, simulated ? "simulated" : "upi", "razorpay", simulated ? null : "TODO", now);
  d.prepare("UPDATE invoices SET status='paid', paid_at=? WHERE id=?").run(now, invoiceId);
  d.prepare(
    "INSERT INTO audit_log (org_id, user_id, event, detail, at) VALUES (?, NULL, 'payment', ?, ?)",
  ).run(orgId, `${userEmail} paid ${invoiceId} (₹${invoice.total_inr})${simulated ? " [simulated]" : ""}`, now);
  return { error: null, paymentId } as const;
}

/* ── calls ────────────────────────────────────────────────────────────────── */

export function liveCalls(orgId: string) {
  const d = db();
  return (d.prepare(
    `SELECT * FROM calls WHERE org_id=? AND status='live' AND started_at>=?
     ORDER BY started_at DESC`,
  ).all(orgId, new Date(Date.now() - 30 * 60_000).toISOString()) as Row[]).map((r) => ({
    id: r.id as string,
    phone: r.phone as string,
    customerName: (r.customer_name as string) ?? undefined,
    agentId: (r.agent_id as string) ?? "",
    agentName: r.agent_name as string,
    intent: r.intent as string,
    language: r.language as string,
    direction: r.direction as string,
    startedAt: r.started_at as string,
    sentiment: r.sentiment as string,
    sentimentScore: r.sentiment_score as number,
    transcriptPreview: lastTranscriptLine(r.transcript as string | null) ?? (r.summary as string) ?? undefined,
    source: ((r.source as string) || "phone") as "phone" | "browser",
  }));
}

export function callRecords(orgId: string) {
  const d = db();
  return (d.prepare(
    "SELECT * FROM calls WHERE org_id=? AND status='completed' ORDER BY started_at DESC LIMIT 100",
  ).all(orgId) as Row[]).map(toCallRecord);
}

export function startCall(params: {
  orgId: string;
  agentId: string;
  agentName: string;
  intent: string;
  source: "browser" | "phone";
  /** Caller's number for phone calls. */
  phone?: string;
  direction?: "inbound" | "outbound";
  plivoUuid?: string;
  campaignId?: string;
  campaignContactId?: string;
}) {
  const id = uid("call");
  db().prepare(
    `INSERT INTO calls (id, org_id, agent_id, agent_name, phone, direction, intent, source, status, started_at, plivo_uuid, campaign_id, campaign_contact_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'live', ?, ?, ?, ?)`,
  ).run(id, params.orgId, params.agentId, params.agentName,
    params.phone ?? (params.source === "browser" ? "browser test" : "unknown"),
    params.direction ?? "inbound", params.intent, params.source, nowIso(),
    params.plivoUuid ?? null, params.campaignId ?? null, params.campaignContactId ?? null);
  return id;
}

function lastTranscriptLine(raw: string | null) {
  if (!raw) return undefined;
  try {
    const turns = JSON.parse(raw) as { text?: string }[];
    const last = [...turns].reverse().find((t) => t.text?.trim());
    return last?.text?.slice(0, 240);
  } catch {
    return undefined;
  }
}

/** A handoff mid-call: the row now belongs to the agent that took over. */
export function reassignCall(orgId: string, callId: string, agentId: string, agentName: string) {
  db().prepare("UPDATE calls SET agent_id=?, agent_name=? WHERE id=? AND org_id=?")
    .run(agentId, agentName, callId, orgId);
}

/** Streaming transcript for a live phone call, so the Live board can show it
 *  before the call completes. */
export function updateLiveTranscript(orgId: string, callId: string, transcript: { role: string; text: string }[]) {
  db().prepare("UPDATE calls SET transcript=? WHERE id=? AND org_id=? AND status='live'")
    .run(JSON.stringify(transcript.slice(-400)), callId, orgId);
}

/** Which agent answers this number, or null when nothing is assigned. */
export function agentForNumber(e164: string) {
  const digits = e164.replace(/\D/g, "");
  const row = db().prepare(
    `SELECT n.org_id, n.assigned_agent_id agent_id FROM numbers n
     WHERE n.assigned_agent_id IS NOT NULL
       AND replace(replace(replace(n.e164,'+',''),' ',''),'-','') LIKE ?
     LIMIT 1`,
  ).get(`%${digits.slice(-10)}`) as { org_id: string; agent_id: string } | undefined;
  return row ? { orgId: row.org_id, agentId: row.agent_id } : null;
}

/** Fallback when a number has no assignment: a live agent that takes inbound
 *  calls — a front door if the plan built one, never an outbound-only dialer. */
export function firstLiveAgent(orgId: string) {
  const row = db().prepare(
    `SELECT id FROM agents WHERE org_id=? AND direction IN ('inbound','both')
     ORDER BY CASE status WHEN 'live' THEN 0 WHEN 'testing' THEN 1 ELSE 2 END,
              CASE WHEN intent='other' THEN 0 ELSE 1 END, updated_at
     LIMIT 1`,
  ).get(orgId) as { id: string } | undefined;
  return row?.id ?? null;
}

export function completeCall(params: {
  orgId: string;
  callId: string;
  durationSec: number;
  tokens: number;
  transcript: { role: string; text: string }[];
  aiCostInr: number;
  telephonyCostInr: number;
}) {
  const d = db();
  const now = nowIso();
  d.prepare(
    `UPDATE calls SET status='completed', ended_at=?, duration_sec=?, tokens=?,
       ai_cost_inr=?, telephony_cost_inr=?, transcript=?, outcome=COALESCE(outcome,'resolved')
     WHERE id=? AND org_id=?`,
  ).run(now, params.durationSec, params.tokens, params.aiCostInr, params.telephonyCostInr,
    JSON.stringify(params.transcript), params.callId, params.orgId);

  const insertUsage = d.prepare(
    "INSERT INTO usage_events (org_id, call_id, kind, quantity, cost_inr, at) VALUES (?, ?, ?, ?, ?, ?)",
  );
  if (params.tokens > 0) {
    insertUsage.run(params.orgId, params.callId, "ai_tokens", params.tokens, params.aiCostInr, now);
  }
  if (params.durationSec > 0) {
    insertUsage.run(params.orgId, params.callId, "telephony_minutes",
      +(params.durationSec / 60).toFixed(2), params.telephonyCostInr, now);
  }
}

export function updateCallAnalysis(callId: string, fields: {
  summary?: string; intent?: string; sentiment?: string; outcome?: string; qaScore?: number | null;
}) {
  db().prepare(
    `UPDATE calls SET summary=COALESCE(?, summary), intent=COALESCE(?, intent),
       sentiment=COALESCE(?, sentiment), outcome=COALESCE(?, outcome), qa_score=COALESCE(?, qa_score)
     WHERE id=?`,
  ).run(fields.summary ?? null, fields.intent ?? null, fields.sentiment ?? null,
    fields.outcome ?? null, fields.qaScore ?? null, callId);
}

/* ── agents / knowledge ──────────────────────────────────────────────────── */

export function agents(orgId: string) {
  const d = db();
  const today = daysAgoIso(0);
  const stats = d.prepare(
    `SELECT agent_id, COUNT(*) n,
            AVG(CASE WHEN outcome='resolved' THEN 1.0 WHEN outcome IS NOT NULL THEN 0 END) rr
     FROM calls WHERE org_id=? AND started_at>=? GROUP BY agent_id`,
  ).all(orgId, today) as { agent_id: string; n: number; rr: number | null }[];
  const weekStats = d.prepare(
    `SELECT agent_id, AVG(CASE WHEN outcome='resolved' THEN 1.0 WHEN outcome IS NOT NULL THEN 0 END) rr
     FROM calls WHERE org_id=? AND started_at>=? GROUP BY agent_id`,
  ).all(orgId, daysAgoIso(7)) as { agent_id: string; rr: number | null }[];
  const todayBy = new Map(stats.map((s) => [s.agent_id, s]));
  const weekBy = new Map(weekStats.map((s) => [s.agent_id, s]));

  return (d.prepare("SELECT * FROM agents WHERE org_id=? ORDER BY name").all(orgId) as Row[]).map((r) => ({
    id: r.id as string,
    name: r.name as string,
    status: r.status as string,
    languages: JSON.parse(r.languages as string),
    intent: r.intent as string,
    direction: r.direction as string,
    voiceId: (r.voice_id as string) ?? undefined,
    mode: r.mode as string,
    prompt: (r.prompt as string) ?? undefined,
    nodes: JSON.parse(r.nodes as string),
    edges: JSON.parse(r.edges as string),
    version: r.version as number,
    callsToday: todayBy.get(r.id as string)?.n ?? 0,
    resolutionRate: +(weekBy.get(r.id as string)?.rr ?? 0).toFixed(2),
    updatedAt: r.updated_at as string,
  }));
}

export function agentVersions(orgId: string) {
  return (db().prepare(
    "SELECT * FROM agent_versions WHERE org_id=? ORDER BY version DESC",
  ).all(orgId) as Row[]).map((r) => ({
    id: r.id as string,
    version: r.version as number,
    label: r.label as string,
    author: r.author as string,
    createdAt: r.created_at as string,
    isLive: Boolean(r.is_live),
  }));
}

export function knowledgeDocs(orgId: string) {
  const d = db();
  return (d.prepare(
    "SELECT k.*, (SELECT COUNT(*) FROM knowledge_chunks c WHERE c.doc_id=k.id) chunk_count FROM knowledge_docs k WHERE org_id=? ORDER BY updated_at DESC",
  ).all(orgId) as Row[]).map((r) => ({
    id: r.id as string,
    name: r.name as string,
    kind: r.kind as string,
    sizeLabel: r.size_label as string,
    // Seeded docs carry no chunks; show their catalogued size instead of 0.
    chunks: (r.chunk_count as number) || fallbackChunks(r),
    status: r.status as string,
    updatedAt: r.updated_at as string,
  }));
}
const fallbackChunks = (r: Row) => (r.status === "indexed" ? 1 : 0);

/* ── complaints / actions / departments ──────────────────────────────────── */

export function complaints(orgId: string) {
  return (db().prepare(
    `SELECT c.*, d.name dept_name FROM complaints c
     LEFT JOIN departments d ON d.id = c.department_id
     WHERE c.org_id=? ORDER BY c.opened_at DESC LIMIT 200`,
  ).all(orgId) as Row[]).map((r) => ({
    id: r.id as string,
    ref: r.ref as string,
    title: r.title as string,
    category: r.category as string,
    severity: r.severity as string,
    stage: r.stage as string,
    customerName: r.customer_name as string,
    phone: r.phone as string,
    openedAt: r.opened_at as string,
    slaDueAt: r.sla_due_at as string,
    assignee: (r.assignee as string) ?? null,
    callId: (r.call_id as string) ?? null,
    department: (r.dept_name as string) ?? null,
    kind: ((r.kind as string) || "complaint") as "enquiry" | "complaint" | "grievance",
    hasRecording: Boolean(r.has_recording),
    hasConsent: Boolean(r.has_consent),
  }));
}

export function departments(orgId: string) {
  const d = db();
  return (d.prepare(
    `SELECT dep.*,
       (SELECT COUNT(*) FROM actions a WHERE a.department_id=dep.id AND a.status!='done') open_actions
     FROM departments dep WHERE dep.org_id=? ORDER BY dep.name`,
  ).all(orgId) as Row[]).map((r) => ({
    id: r.id as string,
    slug: r.slug as string,
    name: r.name as string,
    openActions: r.open_actions as number,
    keywords: JSON.parse((r.keywords as string) ?? "[]") as string[],
    email: (r.email as string) ?? "",
    phone: (r.phone as string) ?? "",
    whatsapp: (r.whatsapp as string) ?? "",
  }));
}

/** The queue a department user works. Org-wide users see everything. */
export function actions(orgId: string, departmentId?: string | null) {
  const rows = departmentId
    ? db().prepare(
        `SELECT a.*, d.name dept_name, c.ref complaint_ref FROM actions a
         JOIN departments d ON d.id=a.department_id
         LEFT JOIN complaints c ON c.id=a.complaint_id
         WHERE a.org_id=? AND a.department_id=? ORDER BY
           CASE a.status WHEN 'open' THEN 0 WHEN 'in_progress' THEN 1 ELSE 2 END,
           a.due_at IS NULL, a.due_at ASC LIMIT 300`,
      ).all(orgId, departmentId)
    : db().prepare(
        `SELECT a.*, d.name dept_name, c.ref complaint_ref FROM actions a
         JOIN departments d ON d.id=a.department_id
         LEFT JOIN complaints c ON c.id=a.complaint_id
         WHERE a.org_id=? ORDER BY
           CASE a.status WHEN 'open' THEN 0 WHEN 'in_progress' THEN 1 ELSE 2 END,
           a.due_at IS NULL, a.due_at ASC LIMIT 300`,
      ).all(orgId);

  return (rows as Row[]).map((r) => ({
    id: r.id as string,
    department: r.dept_name as string,
    departmentId: r.department_id as string,
    callId: (r.call_id as string) ?? null,
    complaintRef: (r.complaint_ref as string) ?? null,
    title: r.title as string,
    detail: r.detail as string,
    severity: r.severity as string,
    status: r.status as string,
    createdAt: r.created_at as string,
    dueAt: (r.due_at as string) ?? null,
  }));
}

export function updateAction(orgId: string, actionId: string, status: string, userName: string) {
  const d = db();
  d.prepare(
    `UPDATE actions SET status=?, completed_at=CASE WHEN ?='done' THEN ? ELSE NULL END,
       completed_by=CASE WHEN ?='done' THEN ? ELSE NULL END
     WHERE id=? AND org_id=?`,
  ).run(status, status, nowIso(), status, userName, actionId, orgId);

  // Closing the last action on a complaint resolves the complaint — the
  // department's work and the complaint board must never say different things.
  const action = d.prepare("SELECT complaint_id FROM actions WHERE id=?").get(actionId) as
    | { complaint_id: string | null }
    | undefined;
  if (status === "done" && action?.complaint_id) {
    const open = (d.prepare(
      "SELECT COUNT(*) n FROM actions WHERE complaint_id=? AND status!='done'",
    ).get(action.complaint_id) as { n: number }).n;
    if (open === 0) {
      d.prepare("UPDATE complaints SET stage='resolved' WHERE id=?").run(action.complaint_id);
    } else {
      d.prepare("UPDATE complaints SET stage='in_progress' WHERE id=? AND stage='new'").run(action.complaint_id);
    }
  }
}

export function createComplaint(params: {
  orgId: string;
  title: string;
  category: string;
  severity: string;
  customerName: string;
  phone: string;
  callId: string | null;
  departmentId: string;
  detail: string;
  slaHours?: number;
  kind?: string;
}) {
  const d = db();
  const now = nowIso();
  const id = uid("cmp");
  // The reference number read out to the caller. Short, digits only —
  // it has to survive being repeated over a bad phone line.
  const ref = `#${String(40000 + Math.floor(Math.random() * 59999))}`;
  const slaDue = new Date(Date.now() + (params.slaHours ?? 24) * 3_600_000).toISOString();
  const kind = params.kind ?? "complaint";

  d.prepare(
    `INSERT INTO complaints (id, org_id, ref, title, category, severity, stage, customer_name, phone, opened_at, sla_due_at, assignee, call_id, department_id, has_recording, has_consent, kind)
     VALUES (?, ?, ?, ?, ?, ?, 'new', ?, ?, ?, ?, NULL, ?, ?, ?, 1, ?)`,
  ).run(id, params.orgId, ref, params.title, params.category, params.severity,
    params.customerName, params.phone, now, slaDue, params.callId, params.departmentId,
    params.callId ? 1 : 0, kind);

  d.prepare(
    `INSERT INTO actions (id, org_id, department_id, call_id, complaint_id, title, detail, severity, status, created_at, due_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)`,
  ).run(uid("act"), params.orgId, params.departmentId, params.callId, id,
    params.title, params.detail, params.severity, now, slaDue);

  const dept = d.prepare("SELECT name FROM departments WHERE id=?").get(params.departmentId) as { name: string } | undefined;
  const deptName = dept?.name ?? "General";
  d.prepare(
    `INSERT INTO notifications (id, org_id, kind, title, body, at, severity, read, href)
     VALUES (?, ?, 'complaint', ?, ?, ?, ?, 0, '/complaints')`,
  ).run(uid("ntf"), params.orgId, `New ${kind} ${ref} → ${deptName}`,
    params.title, now, params.severity);

  // Customer 360: the ticket shows on the caller's timeline.
  const customerId = touchCustomer({
    orgId: params.orgId, phone: params.phone, name: params.customerName, channel: "call",
    sentiment: params.severity === "high" || params.severity === "critical" ? "frustrated" : undefined,
  });
  if (customerId) {
    addTimelineEvent({
      customerId, kind: "complaint",
      title: `${kind === "complaint" ? "Complaint" : kind.replace(/^\w/, (c) => c.toUpperCase())} ${ref} · ${params.category}`,
      detail: `${params.title} → ${deptName}`,
    });
    tagCustomer(customerId, kind === "complaint" ? "complained" : kind);
  }

  return { id, ref };
}

/* ── bookings / campaigns / customers / numbers ──────────────────────────── */

export function bookings(orgId: string) {
  return (db().prepare(
    "SELECT * FROM bookings WHERE org_id=? ORDER BY starts_at ASC LIMIT 200",
  ).all(orgId) as Row[]).map((r) => ({
    id: r.id as string,
    customerName: r.customer_name as string,
    phone: r.phone as string,
    type: r.type as string,
    startsAt: r.starts_at as string,
    durationMin: r.duration_min as number,
    status: r.status as string,
    noShowRisk: r.no_show_risk as number,
    source: r.source as string,
    reminderSent: Boolean(r.reminder_sent),
  }));
}

export function createBooking(params: {
  orgId: string; customerName: string; phone: string; type: string;
  startsAt: string; durationMin: number; source: string;
}) {
  const id = uid("bk");
  db().prepare(
    `INSERT INTO bookings (id, org_id, customer_name, phone, type, starts_at, duration_min, status, no_show_risk, source, reminder_sent)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'confirmed', 0.1, ?, 0)`,
  ).run(id, params.orgId, params.customerName, params.phone, params.type,
    params.startsAt, params.durationMin, params.source);

  const customerId = touchCustomer({ orgId: params.orgId, phone: params.phone, name: params.customerName, channel: "call" });
  if (customerId) {
    const when = new Date(params.startsAt);
    addTimelineEvent({
      customerId, kind: "booking",
      title: `Booked · ${params.type}`,
      detail: Number.isNaN(when.getTime())
        ? params.startsAt
        : when.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" }),
    });
  }
  return id;
}

export function campaigns(orgId: string) {
  return (db().prepare(
    "SELECT * FROM campaigns WHERE org_id=? ORDER BY starts_at DESC",
  ).all(orgId) as Row[]).map((r) => ({
    id: r.id as string,
    name: r.name as string,
    agentId: (r.agent_id as string) ?? "",
    agentName: r.agent_name as string,
    series: r.series as string,
    contacts: r.contacts as number,
    dialed: r.dialed as number,
    connected: r.connected as number,
    connectRate: r.dialed ? +((r.connected as number) / (r.dialed as number)).toFixed(2) : 0,
    status: r.status as string,
    scrubbedCount: r.scrubbed_count as number,
    startsAt: (r.starts_at as string) ?? null,
  }));
}

export function customers(orgId: string) {
  const d = db();
  const events = d.prepare(
    "SELECT * FROM timeline_events WHERE customer_id=? ORDER BY at DESC LIMIT 30",
  );
  return (d.prepare(
    "SELECT * FROM customers WHERE org_id=? ORDER BY last_contact_at DESC LIMIT 200",
  ).all(orgId) as Row[]).map((r) => ({
    id: r.id as string,
    phone: r.phone as string,
    name: r.name as string,
    city: r.city as string,
    preferredLanguage: r.preferred_language as string,
    orders: r.orders as number,
    lifetimeValueInr: r.ltv_inr as number,
    sentiment: r.sentiment as string,
    since: r.since as string,
    lastContactAt: r.last_contact_at as string,
    // Legacy rows may hold a timeline kind here; never let one bad row 400 the page.
    lastChannel: ["call", "whatsapp", "sms", "email"].includes(r.last_channel as string)
      ? (r.last_channel as string)
      : "call",
    tags: JSON.parse(r.tags as string),
    timeline: (events.all(r.id) as Row[]).map((e) => ({
      id: e.id as string,
      kind: e.kind as string,
      title: e.title as string,
      detail: (e.detail as string) ?? undefined,
      at: e.at as string,
      amountInr: (e.amount_inr as number) ?? undefined,
      sentiment: (e.sentiment as string) ?? undefined,
    })),
  }));
}

export function numbers(orgId: string) {
  const d = db();
  const today = daysAgoIso(0);
  return (d.prepare("SELECT * FROM numbers WHERE org_id=?").all(orgId) as Row[]).map((r) => ({
    id: r.id as string,
    e164: r.e164 as string,
    series: r.series as string,
    provider: r.provider as string,
    region: r.region as string,
    assignedAgentId: (r.assigned_agent_id as string) ?? null,
    assignedAgentName: (r.assigned_agent_name as string) ?? null,
    pickupRate: r.pickup_rate as number,
    callsToday: r.assigned_agent_id
      ? (d.prepare(
          "SELECT COUNT(*) n FROM calls WHERE org_id=? AND agent_id=? AND started_at>=?",
        ).get(orgId, r.assigned_agent_id, today) as { n: number }).n
      : 0,
    monthlyRentInr: r.monthly_rent_inr as number,
    status: r.status as string,
  }));
}

/**
 * A tenant registers the number their carrier gave them. We do not buy
 * numbers from here — that is a Plivo console / bridge concern — but the row
 * is what inbound routing (`agentForNumber`) and "Call me now" read, so a
 * tenant without one cannot take or make a phone call.
 */
export function addNumber(orgId: string, data: {
  e164: string; series: string; provider?: string; region?: string; assignedAgentId?: string | null;
}) {
  const d = db();
  const e164 = `+${data.e164.replace(/[^\d]/g, "")}`;
  const dupe = d.prepare("SELECT id FROM numbers WHERE org_id=? AND e164=?").get(orgId, e164);
  if (dupe) return { error: "That number is already in this workspace" } as const;
  const agent = data.assignedAgentId
    ? (d.prepare("SELECT id, name FROM agents WHERE id=? AND org_id=?").get(data.assignedAgentId, orgId) as
        | { id: string; name: string }
        | undefined)
    : undefined;
  const id = uid("num");
  d.prepare(
    `INSERT INTO numbers (id, org_id, e164, series, provider, region, assigned_agent_id, assigned_agent_name, pickup_rate, monthly_rent_inr, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 'active')`,
  ).run(id, orgId, e164, data.series, data.provider ?? "Plivo", data.region ?? "IN", agent?.id ?? null, agent?.name ?? null);
  return { id } as const;
}

export function assignNumber(orgId: string, id: string, agentId: string | null) {
  const d = db();
  const row = d.prepare("SELECT id FROM numbers WHERE id=? AND org_id=?").get(id, orgId);
  if (!row) return { error: "No such number" } as const;
  const agent = agentId
    ? (d.prepare("SELECT id, name FROM agents WHERE id=? AND org_id=?").get(agentId, orgId) as { id: string; name: string } | undefined)
    : undefined;
  if (agentId && !agent) return { error: "No such agent" } as const;
  d.prepare("UPDATE numbers SET assigned_agent_id=?, assigned_agent_name=? WHERE id=? AND org_id=?")
    .run(agent?.id ?? null, agent?.name ?? null, id, orgId);
  return { error: null } as const;
}

export function deleteNumber(orgId: string, id: string) {
  db().prepare("DELETE FROM numbers WHERE id=? AND org_id=?").run(id, orgId);
}

/* ── team / keys / notifications / blobs ─────────────────────────────────── */

export function team(orgId: string) {
  return (db().prepare(
    "SELECT * FROM users WHERE org_id=? ORDER BY created_at",
  ).all(orgId) as Row[]).map((r) => ({
    id: r.id as string,
    name: r.name as string,
    email: r.email as string,
    role: r.role as string,
    status: r.status as string,
    lastActiveAt: (r.last_active_at as string) ?? (r.created_at as string),
  }));
}

export function apiKeys(orgId: string) {
  return (db().prepare(
    "SELECT * FROM api_keys WHERE org_id=? ORDER BY created_at DESC",
  ).all(orgId) as Row[]).map((r) => ({
    id: r.id as string,
    label: r.label as string,
    prefix: r.prefix as string,
    scopes: JSON.parse(r.scopes as string),
    createdAt: r.created_at as string,
    lastUsedAt: (r.last_used_at as string) ?? null,
  }));
}

export function notifications(orgId: string) {
  return (db().prepare(
    "SELECT * FROM notifications WHERE org_id=? ORDER BY at DESC LIMIT 50",
  ).all(orgId) as Row[]).map((r) => ({
    id: r.id as string,
    kind: r.kind as string,
    title: r.title as string,
    body: r.body as string,
    at: r.at as string,
    severity: r.severity as string,
    read: Boolean(r.read),
    href: (r.href as string) ?? null,
  }));
}

export function configBlob(orgId: string, key: string): unknown {
  const row = db().prepare(
    "SELECT json FROM config_blobs WHERE org_id=? AND key=?",
  ).get(orgId, key) as { json: string } | undefined;
  return row ? JSON.parse(row.json) : [];
}

export function createAgent(orgId: string, data: {
  name: string;
  intent: string;
  direction?: string;
  prompt?: string;
  nodes?: unknown[];
  edges?: unknown[];
  voiceId?: string;
  languages?: string[];
}) {
  const id = uid("ag");
  db().prepare(
    `INSERT INTO agents (id, org_id, name, status, languages, intent, direction, voice_id, mode, prompt, nodes, edges, version, updated_at)
     VALUES (?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
  ).run(
    id, orgId, data.name,
    JSON.stringify(data.languages ?? ["hi", "en", "hinglish"]),
    data.intent, data.direction ?? "inbound", data.voiceId ?? null,
    data.nodes && data.nodes.length ? "graph" : "prompt",
    data.prompt ?? null,
    JSON.stringify(data.nodes ?? []),
    JSON.stringify(data.edges ?? []),
    nowIso(),
  );
  return id;
}

export function updateAgent(orgId: string, id: string, data: {
  name?: string;
  prompt?: string;
  status?: string;
  nodes?: unknown[];
  edges?: unknown[];
  voiceId?: string;
}) {
  const current = db().prepare("SELECT * FROM agents WHERE id=? AND org_id=?").get(id, orgId) as Row | undefined;
  if (!current) return { error: "No such agent" } as const;
  db().prepare(
    `UPDATE agents SET name=?, prompt=?, status=?, nodes=?, edges=?, voice_id=?,
       mode=?, version=version+1, updated_at=? WHERE id=? AND org_id=?`,
  ).run(
    data.name ?? current.name,
    data.prompt ?? current.prompt,
    data.status ?? current.status,
    JSON.stringify(data.nodes ?? JSON.parse(current.nodes as string)),
    JSON.stringify(data.edges ?? JSON.parse(current.edges as string)),
    data.voiceId ?? current.voice_id,
    (data.nodes && data.nodes.length) || JSON.parse(current.nodes as string).length ? "graph" : "prompt",
    nowIso(), id, orgId,
  );
  return { error: null } as const;
}

/**
 * Removes an agent and everything that points at it: number assignments,
 * voice assignments, and handoff nodes in other agents' flows (rewritten to
 * plain End nodes so no flow is left calling an agent that no longer exists).
 */
export function deleteAgent(orgId: string, id: string) {
  const d = db();
  const row = d.prepare("SELECT id FROM agents WHERE id=? AND org_id=?").get(id, orgId);
  if (!row) return { error: "No such agent" } as const;
  const running = (d.prepare(
    "SELECT COUNT(*) n FROM campaigns WHERE org_id=? AND agent_id=? AND status IN ('running','scheduled')",
  ).get(orgId, id) as { n: number }).n;
  if (running) return { error: `${running} campaign(s) still use this agent — pause them first` } as const;

  const others = d.prepare("SELECT id, nodes FROM agents WHERE org_id=? AND id!=?").all(orgId, id) as {
    id: string;
    nodes: string;
  }[];
  const fix = d.prepare("UPDATE agents SET nodes=?, updated_at=? WHERE id=? AND org_id=?");
  for (const o of others) {
    const nodes = JSON.parse(o.nodes || "[]") as { kind: string; config?: Record<string, unknown>; title: string }[];
    let touched = false;
    for (const n of nodes) {
      if (n.kind === "handoff" && n.config?.agentId === id) {
        n.kind = "end";
        n.title = "Close (handoff target removed)";
        n.config = { hangUp: true };
        touched = true;
      }
    }
    if (touched) fix.run(JSON.stringify(nodes), nowIso(), o.id, orgId);
  }

  d.prepare("UPDATE numbers SET assigned_agent_id=NULL, assigned_agent_name=NULL WHERE org_id=? AND assigned_agent_id=?").run(orgId, id);
  d.prepare("UPDATE voices SET assigned_agent_id=NULL WHERE org_id=? AND assigned_agent_id=?").run(orgId, id);
  d.prepare("UPDATE campaigns SET agent_id=NULL, agent_name='Unassigned' WHERE org_id=? AND agent_id=?").run(orgId, id);
  d.prepare("DELETE FROM agents WHERE id=? AND org_id=?").run(id, orgId);
  return { error: null } as const;
}

export function createCampaign(orgId: string, data: {
  name: string;
  agentId: string;
  series: string;
}) {
  const agent = db().prepare("SELECT name FROM agents WHERE id=? AND org_id=?").get(data.agentId, orgId) as
    | { name: string }
    | undefined;
  const id = uid("cp");
  db().prepare(
    `INSERT INTO campaigns (id, org_id, name, agent_id, agent_name, series, contacts, dialed, connected, status, scrubbed_count, starts_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, 0, 0, 'draft', 0, NULL)`,
  ).run(id, orgId, data.name, data.agentId, agent?.name ?? "Unassigned", data.series);
  return id;
}

export function updateCampaign(orgId: string, id: string, status: string) {
  db().prepare("UPDATE campaigns SET status=? WHERE id=? AND org_id=?").run(status, id, orgId);
}
