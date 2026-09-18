import "server-only";
import { getDb, nowIso, uid } from "./db";

/**
 * Customer 360, fed from the things that actually happen.
 *
 * The phone number is the identity (project.md §4.8): every call, ticket and
 * booking arrives with one, so a customer row is created the first time a
 * number is seen and enriched on every contact after. Nothing here is typed
 * in by hand — the Customers page is a read model over calls, complaints and
 * bookings, which is what makes it trustworthy.
 */

export type TimelineKind = "call" | "whatsapp" | "sms" | "email" | "order" | "booking" | "complaint";
/** How the customer last reached us. Distinct from the timeline kind: a
 *  complaint or booking raised on a call still means the channel was "call". */
export type ContactChannel = "call" | "whatsapp" | "sms" | "email";

/** Normalise to digits with a leading + so "98765 43210", "+91 98765-43210"
 *  and "919876543210" collapse to the same row. Returns null for anything
 *  that is not a phone number (browser tests, "unknown"). */
export function normalisePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/[^\d]/g, "");
  if (digits.length < 8) return null;
  // Indian 10-digit mobiles get the country code; anything else is trusted
  // as already international.
  if (digits.length === 10 && /^[6-9]/.test(digits)) return `+91${digits}`;
  return `+${digits}`;
}

/** Names that mean "we do not know" — ours ("Caller 3210") or a tool's default. */
function isPlaceholderName(name: string) {
  return name.trim() === "" || /^(unknown( caller)?|caller( \d+)?|customer|guest|n\/?a|-)$/i.test(name.trim());
}

/**
 * Find-or-create the customer for a phone number and record a contact.
 * Returns the customer id, or null when the phone is not a real number.
 */
export function touchCustomer(params: {
  orgId: string;
  phone: string | null | undefined;
  name?: string | null;
  channel?: ContactChannel;
  sentiment?: string | null;
  language?: string | null;
  at?: string;
}): string | null {
  const phone = normalisePhone(params.phone);
  if (!phone) return null;
  const d = getDb();
  const at = params.at ?? nowIso();
  const existing = d
    .prepare("SELECT id, name FROM customers WHERE org_id=? AND phone=?")
    .get(params.orgId, phone) as { id: string; name: string } | undefined;

  const cleanName = params.name?.trim() ?? "";
  const hasRealName = Boolean(cleanName) && !isPlaceholderName(cleanName);

  if (existing) {
    // A real name always beats a placeholder we generated or a tool default.
    const newName = hasRealName && isPlaceholderName(existing.name) ? cleanName : existing.name;
    // No channel means this is our own action (a stage change, a note) and
    // not a contact — keep last_contact_at / last_channel as they were.
    d.prepare(
      `UPDATE customers SET
         name = ?,
         last_contact_at = CASE WHEN ? IS NULL THEN last_contact_at ELSE MAX(last_contact_at, ?) END,
         last_channel = COALESCE(?, last_channel),
         sentiment = COALESCE(?, sentiment),
         preferred_language = COALESCE(?, preferred_language)
       WHERE id = ?`,
    ).run(
      newName, params.channel ?? null, at, params.channel ?? null,
      params.sentiment ?? null, params.language ?? null, existing.id,
    );
    return existing.id;
  }

  const id = uid("cus");
  d.prepare(
    `INSERT INTO customers (id, org_id, phone, name, city, preferred_language, orders, ltv_inr, sentiment, since, last_contact_at, last_channel, tags)
     VALUES (?, ?, ?, ?, '', ?, 0, 0, ?, ?, ?, ?, '[]')`,
  ).run(
    id, params.orgId, phone,
    hasRealName ? cleanName : `Caller ${phone.slice(-4)}`,
    params.language ?? "hi", params.sentiment ?? "neutral", at, at, params.channel ?? "call",
  );
  return id;
}

export function addTimelineEvent(params: {
  customerId: string;
  kind: TimelineKind;
  title: string;
  detail?: string | null;
  at?: string;
  amountInr?: number | null;
  sentiment?: string | null;
}) {
  getDb().prepare(
    `INSERT INTO timeline_events (id, customer_id, kind, title, detail, at, amount_inr, sentiment)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    uid("tl"), params.customerId, params.kind, params.title, params.detail ?? null,
    params.at ?? nowIso(), params.amountInr ?? null, params.sentiment ?? null,
  );
}

/** Add a tag once (tags are a JSON string[] on the row). */
export function tagCustomer(customerId: string, tag: string) {
  const d = getDb();
  const row = d.prepare("SELECT tags FROM customers WHERE id=?").get(customerId) as { tags: string } | undefined;
  if (!row) return;
  const tags = new Set<string>(JSON.parse(row.tags || "[]"));
  if (tags.has(tag)) return;
  tags.add(tag);
  d.prepare("UPDATE customers SET tags=? WHERE id=?").run(JSON.stringify([...tags]), customerId);
}

/** A completed call → customer row + one "call" timeline entry. */
export function recordCallForCustomer(params: {
  orgId: string;
  callId: string;
  phone: string | null;
  customerName?: string | null;
  agentName: string;
  intent: string;
  summary?: string | null;
  sentiment?: string | null;
  durationSec: number;
  language?: string | null;
  at?: string;
}) {
  const customerId = touchCustomer({
    orgId: params.orgId,
    phone: params.phone,
    name: params.customerName,
    channel: "call",
    sentiment: params.sentiment,
    language: params.language,
    at: params.at,
  });
  if (!customerId) return null;
  const mins = Math.max(1, Math.round(params.durationSec / 60));
  addTimelineEvent({
    customerId,
    kind: "call",
    title: `${humanIntent(params.intent)} · ${params.agentName} · ${mins} min`,
    detail: params.summary ?? undefined,
    sentiment: params.sentiment,
    at: params.at,
  });
  if (params.sentiment === "frustrated") tagCustomer(customerId, "at-risk");
  return customerId;
}

function humanIntent(intent: string) {
  return intent.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}
