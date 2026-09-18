import "server-only";
import { getDb, nowIso } from "./db";

/** Next queued, non-DND contact for a running campaign. */
export function nextCampaignContact(orgId: string, campaignId?: string) {
  const campaign = campaignId
    ? (getDb()
        .prepare("SELECT * FROM campaigns WHERE id=? AND org_id=? AND status='running'")
        .get(campaignId, orgId) as CampaignRow | undefined)
    : (getDb()
        .prepare(
          "SELECT * FROM campaigns WHERE org_id=? AND status='running' ORDER BY starts_at DESC LIMIT 1",
        )
        .get(orgId) as CampaignRow | undefined);
  if (!campaign?.agent_id) return null;
  const contact = getDb()
    .prepare(
      `SELECT * FROM campaign_contacts
       WHERE org_id=? AND campaign_id=? AND dnd=0 AND status IN ('queued','retry')
       ORDER BY last_attempt_at IS NOT NULL, last_attempt_at ASC LIMIT 1`,
    )
    .get(orgId, campaign.id) as ContactRow | undefined;
  if (!contact) {
    getDb()
      .prepare("UPDATE campaigns SET status='completed' WHERE id=? AND org_id=?")
      .run(campaign.id, orgId);
    return null;
  }
  return {
    campaignId: campaign.id,
    agentId: campaign.agent_id,
    contactId: contact.id,
    phone: contact.phone,
    name: contact.name,
  };
}

export function markContactAttempt(
  orgId: string,
  contactId: string,
  status: "dialing" | "connected" | "no_answer" | "voicemail" | "failed" | "queued",
) {
  getDb()
    .prepare("UPDATE campaign_contacts SET status=?, last_attempt_at=? WHERE id=? AND org_id=?")
    .run(status, nowIso(), contactId, orgId);
  if (status === "dialing") {
    getDb()
      .prepare(
        `UPDATE campaigns SET dialed=dialed+1, starts_at=COALESCE(starts_at, ?)
         WHERE id=(SELECT campaign_id FROM campaign_contacts WHERE id=?) AND org_id=?`,
      )
      .run(nowIso(), contactId, orgId);
  }
  if (status === "connected") {
    getDb()
      .prepare(
        `UPDATE campaigns SET connected=connected+1
         WHERE id=(SELECT campaign_id FROM campaign_contacts WHERE id=?) AND org_id=?`,
      )
      .run(contactId, orgId);
  }
}

export async function dialNextCampaignContact(orgId: string, campaignId?: string) {
  const next = nextCampaignContact(orgId, campaignId);
  if (!next) return { dialed: false as const };
  const bridge = process.env.TELEPHONY_BRIDGE_URL;
  if (!bridge) return { dialed: false as const, error: "TELEPHONY_BRIDGE_URL is not set" };
  markContactAttempt(orgId, next.contactId, "dialing");
  try {
    const res = await fetch(`${bridge.replace(/\/$/, "")}/dial`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-swara-internal": process.env.TELEPHONY_SHARED_SECRET ?? "",
      },
      body: JSON.stringify({
        to: next.phone,
        agentId: next.agentId,
        orgId,
        campaignId: next.campaignId,
        campaignContactId: next.contactId,
        machineDetection: true,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      markContactAttempt(orgId, next.contactId, "failed");
      const payload = (await res.json().catch(() => ({}))) as { error?: string };
      return { dialed: false as const, error: payload.error ?? `Bridge ${res.status}` };
    }
    return { dialed: true as const, contactId: next.contactId, phone: next.phone };
  } catch (error) {
    markContactAttempt(orgId, next.contactId, "failed");
    return { dialed: false as const, error: error instanceof Error ? error.message : "dial failed" };
  }
}

export async function onCampaignCallEnded(orgId: string, callId: string, outcome?: string | null) {
  const row = getDb()
    .prepare("SELECT campaign_id, campaign_contact_id FROM calls WHERE id=? AND org_id=?")
    .get(callId, orgId) as { campaign_id: string | null; campaign_contact_id: string | null } | undefined;
  if (!row?.campaign_contact_id || !row.campaign_id) return;
  const status =
    outcome === "voicemail"
      ? "voicemail"
      : outcome === "no_answer" || outcome === "dropped"
        ? "no_answer"
        : "connected";
  markContactAttempt(orgId, row.campaign_contact_id, status);
  // Pace: one live campaign call at a time per org, next after this one bills.
  await dialNextCampaignContact(orgId, row.campaign_id);
}

type CampaignRow = {
  id: string;
  agent_id: string | null;
  status: string;
};
type ContactRow = {
  id: string;
  phone: string;
  name: string | null;
  campaign_id: string;
};
