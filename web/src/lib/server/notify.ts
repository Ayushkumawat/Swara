import "server-only";

/**
 * Outbound notify: email (Resend), WhatsApp/SMS (Plivo REST or the bridge),
 * call (bridge /dial with a briefing). Always persist-first in tickets.ts;
 * this module only delivers.
 */

type Channel = "email" | "whatsapp" | "sms" | "call";

export async function notifyStakeholder(params: {
  orgId: string;
  channel: Channel;
  to: string;
  subject: string;
  body: string;
  ticketRef: string;
  callId?: string | null;
  agentHint?: string;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    if (params.channel === "email") return sendEmail(params.to, params.subject, params.body);
    if (params.channel === "call") return placeBriefingCall(params);
    return sendPlivoMessage(params.channel, params.to, params.body);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "notify failed" };
  }
}

async function sendEmail(to: string, subject: string, body: string) {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.NOTIFY_FROM_EMAIL;
  if (!key || !from) {
    console.warn("[notify] email queued on platform only — set RESEND_API_KEY and NOTIFY_FROM_EMAIL to deliver");
    return { ok: true, error: "Logged on the ticket. Configure RESEND_API_KEY to send the email." };
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ from, to, subject, text: body }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) return { ok: false, error: `Email provider ${res.status}` };
  return { ok: true };
}

async function sendPlivoMessage(channel: "whatsapp" | "sms", to: string, text: string) {
  const authId = process.env.PLIVO_AUTH_ID;
  const authToken = process.env.PLIVO_AUTH_TOKEN;
  const src =
    channel === "whatsapp"
      ? process.env.PLIVO_WHATSAPP_FROM || process.env.PLIVO_FROM_NUMBER
      : process.env.PLIVO_FROM_NUMBER;
  if (authId && authToken && src) {
    const payload: Record<string, string> = {
      src: src.replace(/^\+/, ""),
      dst: to.replace(/^\+/, ""),
      text,
    };
    if (channel === "whatsapp") payload.type = "whatsapp";
    const res = await fetch(`https://api.plivo.com/v1/Account/${authId}/Message/`, {
      method: "POST",
      headers: {
        authorization: "Basic " + Buffer.from(`${authId}:${authToken}`).toString("base64"),
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return { ok: false, error: `Plivo message ${res.status}` };
    return { ok: true };
  }

  const bridge = process.env.TELEPHONY_BRIDGE_URL;
  if (!bridge) {
    return { ok: true, error: "Logged on the ticket. Set Plivo keys or TELEPHONY_BRIDGE_URL to deliver." };
  }
  const res = await fetch(`${bridge.replace(/\/$/, "")}/notify`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-swara-internal": process.env.TELEPHONY_SHARED_SECRET ?? "",
    },
    body: JSON.stringify({ channel, to, text }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) return { ok: false, error: `Bridge notify ${res.status}` };
  return { ok: true };
}

async function placeBriefingCall(params: {
  orgId: string;
  to: string;
  ticketRef: string;
  agentHint?: string;
}) {
  const bridge = process.env.TELEPHONY_BRIDGE_URL;
  if (!bridge) return { ok: false, error: "TELEPHONY_BRIDGE_URL is not set; cannot call the desk." };
  const { firstLiveAgent } = await import("./repo");
  const agentId = firstLiveAgent(params.orgId);
  if (!agentId) return { ok: false, error: "No live agent to place the briefing call." };
  const res = await fetch(`${bridge.replace(/\/$/, "")}/dial`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-swara-internal": process.env.TELEPHONY_SHARED_SECRET ?? "",
    },
    body: JSON.stringify({
      to: params.to,
      agentId,
      orgId: params.orgId,
      briefing: params.agentHint,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as { error?: string };
    return { ok: false, error: payload.error ?? `Bridge ${res.status}` };
  }
  return { ok: true };
}
