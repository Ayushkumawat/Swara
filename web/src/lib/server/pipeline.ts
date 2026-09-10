import "server-only";
import { getDb, nowIso, uid } from "./db";
import { analyzeCall } from "./ai";
import { completeCall, updateCallAnalysis } from "./repo";
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
    .prepare("SELECT source, status FROM calls WHERE id=? AND org_id=?")
    .get(params.callId, params.orgId) as { source: string; status: string } | undefined;
  if (!call || call.status === "completed") return;

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

  // Analysis is best-effort from here down.
  try {
    const departments = (db
      .prepare("SELECT slug, name, keywords FROM departments WHERE org_id=?")
      .all(params.orgId) as { slug: string; name: string; keywords: string }[])
      .map((d) => ({ ...d, keywords: JSON.parse(d.keywords) as string[] }));

    const analysis = await analyzeCall(params.transcript, departments, [...IntentSchema.options]);
    if (!analysis) return;

    updateCallAnalysis(params.callId, {
      summary: analysis.summary,
      intent: analysis.intent,
      sentiment: analysis.sentiment,
      outcome: analysis.outcome,
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
  }
}
