import "server-only";
import { getDb, nowIso, uid } from "./db";
import { analyzeCall } from "./ai";
import { completeCall, updateCallAnalysis } from "./repo";
import { recordCallForCustomer } from "./customers";
import { addTicketMessage, registerTicket } from "./tickets";
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

/**
 * Did the agent tell the caller a ticket exists? Looks for the phrases a
 * Live agent uses when it skips the tool: a hash-number, or "registered /
 * darj / nondavla / logged" in an agent turn, on a call analysis read as a
 * complaint.
 */
function agentClaimedTicket(transcript: Turn[], intent: string) {
  const agentText = transcript
    .filter((t) => t.role !== "user" && t.role !== "caller")
    .map((t) => t.text)
    .join(" ");
  const saidNumber = /#\s?\d{4,6}\b/.test(agentText) || /reference (number|no\.?)|ticket (number|no\.?)|complaint (number|no\.?)|शिकायत संख्या|संदर्भ/i.test(agentText);
  const saidRegistered = /\b(registered|darj|nondavl|nond|logged|filed|raised|complaint (has been )?(noted|taken))\b/i.test(agentText);
  return intent === "complaint" && (saidNumber || saidRegistered);
}

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

    let alreadyQueued = (db
      .prepare("SELECT COUNT(*) n FROM actions WHERE call_id=?")
      .get(params.callId) as { n: number }).n;

    // Safety net. If the agent told the caller "registered, your number is…"
    // but never called register_complaint, the caller believes a ticket
    // exists and nothing does. File it now, from the transcript, so the
    // Tickets board and the caller's next call both see it. Tagged so the
    // desk knows the number the caller heard is not this one.
    const hasTicket = (db
      .prepare("SELECT COUNT(*) n FROM complaints WHERE call_id=? AND org_id=?")
      .get(params.callId, params.orgId) as { n: number }).n > 0;
    if (!hasTicket && !alreadyQueued && call.source === "phone" && agentClaimedTicket(params.transcript, analysis.intent)) {
      const item = analysis.actionItems[0];
      const filed = await registerTicket(params.orgId, params.callId, {
        customer_name: analysis.customerName ?? call.customer_name ?? "Unknown caller",
        phone: call.phone ?? "",
        title: item?.title ?? analysis.summary.slice(0, 80),
        description: `${analysis.summary}${item?.detail ? `\n\n${item.detail}` : ""}`,
        category: "other",
        kind: "complaint",
        severity: item?.severity ?? "medium",
      });
      addTicketMessage({
        orgId: params.orgId,
        complaintId: filed.id,
        direction: "in",
        channel: "note",
        body: "Filed automatically after the call. The agent told the caller a complaint was registered but did not call register_complaint, so any number the caller heard is not real — quote this reference when you reach them.",
      });
      alreadyQueued = 1;
    }

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
