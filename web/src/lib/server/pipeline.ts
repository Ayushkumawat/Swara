import "server-only";
import { getDb, nowIso, uid } from "./db";
import { analyzeCall } from "./ai";
import { completeCall, updateCallAnalysis } from "./repo";
import { recordCallForCustomer } from "./customers";
import { IntentSchema } from "@/lib/api/schemas";

/**
 * What happens after the caller hangs up.
 *
 * Metering first, analysis second: the call row and its usage events are
 * written synchronously before any model call, so billing survives an AI
 * outage. Analysis then fills in the summary, QA score and — the routing step
 * — department actions for anything the call left behind that a human must do.
 *
 * If the agent already registered a complaint mid-call (the register_complaint
 * tool), that work is queued and has a reference number; the pipeline only
 * adds actions for calls where follow-up surfaced without a formal complaint,
 * so nothing is double-filed.
 */

/**
 * Metering rates. The token rate is a blended ₹/1k figure derived from the
 * Live API price list — revisit against the actual bill each cycle; ₹ costs
 * also move with USD/INR. Telephony applies only to PSTN legs; browser test
 * calls carry no carrier cost.
 */
const AI_INR_PER_1K_TOKENS = Number(process.env.AI_INR_PER_1K_TOKENS ?? 0.28);
const TELEPHONY_INR_PER_MIN = Number(process.env.TELEPHONY_INR_PER_MIN ?? 0.45);

export type Turn = { role: string; text: string };

export async function finishCall(params: {
  orgId: string;
  callId: string;
  durationSec: number;
  tokens: number;
  transcript: Turn[];
}) {
  const db = getDb();
  const call = db
    .prepare("SELECT source, status, outcome, phone, customer_name, agent_name, intent, language FROM calls WHERE id=? AND org_id=?")
    .get(params.callId, params.orgId) as
    | { source: string; status: string; outcome: string | null; phone: string | null; customer_name: string | null; agent_name: string; intent: string; language: string | null }
    | undefined;
  if (!call || call.status === "completed") return;
  // An outcome the agent declared (end_call, transfer) or the carrier reported
  // is a fact; the transcript analysis below is a guess and must not override it.
  const declaredOutcome = call.outcome;

  const aiCostInr = +((params.tokens / 1000) * AI_INR_PER_1K_TOKENS).toFixed(2);
  const telephonyCostInr =
    call.source === "phone" ? +((params.durationSec / 60) * TELEPHONY_INR_PER_MIN).toFixed(2) : 0;

  completeCall({
    orgId: params.orgId,
    callId: params.callId,
    durationSec: params.durationSec,
    tokens: params.tokens,
    transcript: params.transcript,
    aiCostInr,
    telephonyCostInr,
  });

  // Customer 360: the row exists from this point even if analysis fails, so
  // a Gemini outage costs a summary, not the customer's history. Phone calls
  // only — a browser test has no customer.
  const customerFor = (summary?: string | null, sentiment?: string | null, name?: string | null) =>
    call.source === "phone"
      ? recordCallForCustomer({
          orgId: params.orgId,
          callId: params.callId,
          phone: call.phone,
          customerName: name ?? call.customer_name,
          agentName: call.agent_name,
          intent: call.intent,
          summary,
          sentiment,
          durationSec: params.durationSec,
          language: call.language,
        })
      : null;

  // Analysis is best-effort from here down.
  try {
    const departments = (db
      .prepare("SELECT slug, name, keywords FROM departments WHERE org_id=?")
      .all(params.orgId) as { slug: string; name: string; keywords: string }[])
      .map((d) => ({ ...d, keywords: JSON.parse(d.keywords) as string[] }));

    const analysis = await analyzeCall(params.transcript, departments, [...IntentSchema.options]);
    if (!analysis) {
      customerFor();
      return;
    }
    customerFor(analysis.summary, analysis.sentiment, analysis.customerName);

    updateCallAnalysis(params.callId, {
      summary: analysis.summary,
      intent: analysis.intent,
      sentiment: analysis.sentiment,
      outcome: declaredOutcome ? undefined : analysis.outcome,
      qaScore: analysis.qaScore,
    });
    if (analysis.customerName) {
      db.prepare("UPDATE calls SET customer_name=? WHERE id=?").run(analysis.customerName, params.callId);
    }

    const alreadyQueued = (db
      .prepare("SELECT COUNT(*) n FROM actions WHERE call_id=?")
      .get(params.callId) as { n: number }).n;

    if (!alreadyQueued && analysis.departmentSlug && analysis.actionItems.length > 0) {
      const dept = db
        .prepare("SELECT id, name FROM departments WHERE org_id=? AND slug=?")
        .get(params.orgId, analysis.departmentSlug) as { id: string; name: string } | undefined;
      if (dept) {
        const insert = db.prepare(
          `INSERT INTO actions (id, org_id, department_id, call_id, complaint_id, title, detail, severity, status, created_at, due_at)
           VALUES (?, ?, ?, ?, NULL, ?, ?, ?, 'open', ?, ?)`,
        );
        const now = nowIso();
        const due = new Date(Date.now() + 48 * 3_600_000).toISOString();
        for (const item of analysis.actionItems) {
          insert.run(uid("act"), params.orgId, dept.id, params.callId, item.title, item.detail, item.severity, now, due);
        }
        db.prepare(
          `INSERT INTO notifications (id, org_id, kind, title, body, at, severity, read, href)
           VALUES (?, ?, 'system', ?, ?, ?, 'medium', 0, '/queue')`,
        ).run(
          uid("ntf"), params.orgId,
          `${analysis.actionItems.length} action${analysis.actionItems.length > 1 ? "s" : ""} routed to ${dept.name}`,
          analysis.summary.slice(0, 140), now,
        );
      }
    }
  } catch (error) {
    console.error("[pipeline] post-call analysis failed:", error);
    try {
      customerFor();
    } catch (inner) {
      console.error("[pipeline] customer record failed:", inner);
    }
  }
}
