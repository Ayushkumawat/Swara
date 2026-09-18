/**
 * The bridge's side door.
 *
 * The Plivo bridge (`telephony/bridge.py`) owns the carrier leg and the model
 * socket; everything it needs to *know* — which agent answers this number, the
 * prompt, the tools, what a tool call returns — lives here in the console's
 * database. These routes hand that over and take the results back.
 *
 * Auth is a shared secret in `x-swara-internal`, not a user session: there is
 * no browser here, and the bridge runs as our own process next to the trunk.
 *
 *   POST /api/internal/telephony/session     resolve number → agent, open a call row, return prompt+config
 *   POST /api/internal/telephony/tool        execute a tool the model called
 *   POST /api/internal/telephony/transcript  streaming transcript for the Live board
 *   POST /api/internal/telephony/complete    the call ended; bill it and run the pipeline
 */
import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { LIVE_API_VERSION, LIVE_MODEL, TOOL_DECLARATIONS } from "@/lib/live/config";
import { composeLivePrompt } from "@/lib/server/live-prompt";
import { finishCall } from "@/lib/server/pipeline";
import { agentForNumber, firstLiveAgent, reassignCall, startCall, updateLiveTranscript } from "@/lib/server/repo";
import { executeTool } from "@/lib/server/tools";
import { getDb } from "@/lib/server/db";
import {
  attachPlivoUuid,
  captureRecordingConsent,
  ingestInboundReply,
  saveRecording,
  tagCampaignContact,
} from "@/lib/server/tickets";
import { onCampaignCallEnded } from "@/lib/server/campaign-dialer";

export const runtime = "nodejs";

const json = (data: unknown, status = 200) => NextResponse.json(data, { status });

function authorised(req: NextRequest) {
  const expected = process.env.TELEPHONY_SHARED_SECRET;
  if (!expected) return process.env.NODE_ENV !== "production";
  const got = req.headers.get("x-swara-internal") ?? "";
  const a = Buffer.from(got);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

const SessionBody = z.object({
  /** Plivo's To / From in E.164-ish. */
  to: z.string().optional(),
  from: z.string().optional(),
  direction: z.enum(["inbound", "outbound"]).default("inbound"),
  plivoCallUuid: z.string().optional(),
  /** Outbound dials and mid-call handoffs name the agent explicitly. */
  agentId: z.string().optional(),
  orgId: z.string().optional(),
  /** Reuse the call row on handoff / reconnect. */
  callId: z.string().optional(),
  handoff: z.boolean().default(false),
  briefing: z.string().optional(),
  campaignId: z.string().optional(),
  campaignContactId: z.string().optional(),
});

const ToolBody = z.object({
  orgId: z.string(),
  callId: z.string().nullable(),
  name: z.string(),
  args: z.record(z.string(), z.unknown()).default({}),
});

const TranscriptBody = z.object({
  orgId: z.string(),
  callId: z.string(),
  transcript: z.array(z.object({ role: z.string(), text: z.string() })).max(2000),
});

const CompleteBody = z.object({
  orgId: z.string(),
  callId: z.string(),
  durationSec: z.number().int().min(0),
  tokens: z.number().int().min(0).default(0),
  transcript: z.array(z.object({ role: z.string(), text: z.string() })).max(2000).default([]),
  outcome: z.string().optional(),
});

export async function POST(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  if (!authorised(req)) return json({ error: "Bad or missing x-swara-internal" }, 401);
  const { path } = await ctx.params;
  const key = path.join("/");
  const body = await req.json().catch(() => ({}));

  if (key === "session") {
    const parsed = SessionBody.safeParse(body);
    if (!parsed.success) return json({ error: "Invalid session request" }, 400);
    const p = parsed.data;

    // Who answers? Explicit agent (outbound / handoff) beats the number's
    // assignment, which beats the org's first live agent.
    let orgId = p.orgId ?? null;
    let agentId = p.agentId ?? null;
    if (!agentId && p.to) {
      const hit = agentForNumber(p.to);
      if (hit) ({ orgId, agentId } = hit);
    }
    if (!orgId) orgId = "org_demo";
    if (!agentId) agentId = firstLiveAgent(orgId);
    if (!agentId) return json({ error: "No agent is assigned to this number and the workspace has no agents." }, 404);

    const prompt = composeLivePrompt(orgId, agentId, undefined, {
      fromNumber: p.direction === "inbound" ? p.from : undefined,
      briefing: p.briefing,
    });
    let callId = p.callId ?? null;
    if (callId && p.handoff) {
      reassignCall(orgId, callId, agentId, prompt.name);
    } else if (!callId) {
      callId = startCall({
        orgId,
        agentId,
        agentName: prompt.name,
        intent: prompt.intent ?? "other",
        source: "phone",
        direction: p.direction,
        phone: (p.direction === "inbound" ? p.from : p.to) ?? "unknown",
        plivoUuid: p.plivoCallUuid,
        campaignId: p.campaignId,
        campaignContactId: p.campaignContactId,
      });
      captureRecordingConsent(orgId, callId);
    }
    if (p.plivoCallUuid && callId) attachPlivoUuid(orgId, callId, p.plivoCallUuid);
    if (p.campaignId && p.campaignContactId && callId) {
      tagCampaignContact(orgId, callId, p.campaignId, p.campaignContactId);
    }
    return json({
      callId,
      orgId,
      agentId,
      agent: { name: prompt.name, greeting: prompt.greeting, voice: prompt.voice },
      model: LIVE_MODEL,
      apiVersion: LIVE_API_VERSION,
      systemInstruction: prompt.systemInstruction,
      voice: prompt.voice,
      // Plain JSON declarations; the bridge validates them into SDK types.
      tools: TOOL_DECLARATIONS,
    });
  }

  if (key === "tool") {
    const parsed = ToolBody.safeParse(body);
    if (!parsed.success) return json({ error: "Invalid tool request" }, 400);
    const { orgId, callId, name, args } = parsed.data;
    const result = await executeTool(orgId, callId, name, args);
    return json({ result });
  }

  if (key === "transcript") {
    const parsed = TranscriptBody.safeParse(body);
    if (!parsed.success) return json({ error: "Invalid transcript" }, 400);
    updateLiveTranscript(parsed.data.orgId, parsed.data.callId, parsed.data.transcript);
    return json({ ok: true });
  }

  if (key === "complete") {
    const parsed = CompleteBody.safeParse(body);
    if (!parsed.success) return json({ error: "Invalid completion" }, 400);
    const { orgId, callId, outcome, ...rest } = parsed.data;
    if (outcome) {
      getDb().prepare("UPDATE calls SET outcome=COALESCE(outcome, ?) WHERE id=? AND org_id=?")
        .run(outcome, callId, orgId);
    }
    await finishCall({ orgId, callId, ...rest });
    await onCampaignCallEnded(orgId, callId, outcome);
    return json({ ok: true });
  }

  if (key === "recording") {
    const parsed = z
      .object({
        orgId: z.string(),
        callId: z.string(),
        url: z.string().min(1),
        durationSec: z.number().optional(),
      })
      .safeParse(body);
    if (!parsed.success) return json({ error: "Invalid recording" }, 400);
    saveRecording({
      orgId: parsed.data.orgId,
      callId: parsed.data.callId,
      objectKey: parsed.data.url,
      durationSec: parsed.data.durationSec,
    });
    return json({ ok: true });
  }

  if (key === "ticket-reply") {
    const parsed = z
      .object({
        orgId: z.string().optional(),
        from: z.string().min(1),
        body: z.string().min(1),
        channel: z.enum(["email", "whatsapp", "sms"]),
        subject: z.string().optional(),
      })
      .safeParse(body);
    if (!parsed.success) return json({ error: "Invalid reply" }, 400);
    return json(ingestInboundReply(parsed.data));
  }

  return json({ error: `No route /${key}` }, 404);
}
