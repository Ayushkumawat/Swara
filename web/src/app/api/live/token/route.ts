/**
 * Mints a short-lived token so the browser can hold the Live API socket open
 * itself.
 *
 * Why not proxy the audio through this server? Because every proxied hop is
 * added round-trip time on a medium where 200 ms is audible. A direct
 * browser-to-Google socket is the lowest-latency path available for
 * browser-originated audio, and an ephemeral token is what makes it safe.
 *
 * Real phone calls do NOT come through here — their audio arrives from the
 * carrier at our own infrastructure, so they run server-side (see
 * `agent/live_session.py`). This route is for the in-app test bench: "call the
 * agent from this browser tab before you point a phone number at it".
 */
import { GoogleGenAI } from "@google/genai";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  LIVE_API_VERSION,
  LIVE_MODEL,
  LIVE_VOICES,
  SETUP_TOOL_DECLARATIONS,
  TOKEN_SESSION_START_TTL_MS,
  TOKEN_TTL_MS,
  buildLiveConfig,
} from "@/lib/live/config";
import { currentUser } from "@/lib/server/auth";
import { startCall } from "@/lib/server/repo";
import { composeLivePrompt } from "@/lib/server/live-prompt";

const BodySchema = z.object({
  /** Which stored agent's persona to run. */
  agentId: z.string().min(1),
  voice: z.string().optional(),
  languages: z.array(z.string()).max(12).optional(),
  /** Present when the client is reconnecting and wants its context back. */
  resumeHandle: z.string().optional(),
  /** The call row this session belongs to; sent on reconnects so a dropped
   *  socket does not spawn a second call in the log. */
  callId: z.string().optional(),
});

/** Persona → intent, for the call row. The console's own agents carry a real
 *  intent column; the built-in test personas map here. */
const PERSONA_INTENT: Record<string, string> = {
  ag_grievance: "complaint",
  ag_delivery: "delivery_reschedule",
  ag_order: "order_status",
  ag_lead: "sales_enquiry",
  ag_booking: "booking",
  ag_cod: "payment_reminder",
  ag_swara: "other",
};

export async function POST(request: Request) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    // Loud and specific: a missing key here looks identical to a network fault
    // from the client, and that is an afternoon lost to the wrong bug.
    return NextResponse.json(
      { error: "GEMINI_API_KEY is not set on the server. See web/.env.example." },
      { status: 500 },
    );
  }

  const parsed = BodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const { agentId, voice, resumeHandle, callId } = parsed.data;

  const user = await currentUser().catch(() => null);
  const orgId = user?.orgId ?? "org_demo";
  const prompt = composeLivePrompt(orgId, agentId, voice);
  const voiceName = LIVE_VOICES.find((v) => v.name === voice)?.name;
  const systemInstruction = prompt.systemInstruction;

  try {
    const client = new GoogleGenAI({ apiKey, httpOptions: { apiVersion: LIVE_API_VERSION } });

    const token = await client.authTokens.create({
      config: {
        // Single use, so a token lifted from the network tab cannot open a
        // second session alongside the legitimate one.
        uses: 1,
        expireTime: new Date(Date.now() + TOKEN_TTL_MS).toISOString(),
        newSessionExpireTime: new Date(Date.now() + TOKEN_SESSION_START_TTL_MS).toISOString(),
        // The load-bearing part. Binding the model and the full session config
        // to the token means a stolen token can only ever be this agent, with
        // this prompt, on this model. Without it, the token is a general
        // Gemini key with our billing attached.
        liveConnectConstraints: {
          model: LIVE_MODEL,
          config: buildLiveConfig({
            systemInstruction,
            voice: voiceName,
            resumeHandle,
            extraTools: agentId === "ag_swara" ? SETUP_TOOL_DECLARATIONS : undefined,
          }),
        },
        httpOptions: { apiVersion: LIVE_API_VERSION },
      },
    });

    if (!token.name) {
      return NextResponse.json({ error: "Token minted without a name" }, { status: 502 });
    }

    // Every session is a call row from the moment the token exists — that is
    // what puts a browser test call on the Live board and, once completed,
    // into minutes, tokens and cost. A reconnect reuses its row via `callId`.
    // Sessions started before login (the onboarding test call) book against
    // the demo org rather than being invisible.
    const activeCallId =
      callId ??
      startCall({
        orgId: user?.orgId ?? "org_demo",
        agentId,
        agentName: prompt.name,
        intent: PERSONA_INTENT[agentId] ?? prompt.intent ?? "other",
        source: "browser",
      });

    return NextResponse.json(
      {
        token: token.name,
        model: LIVE_MODEL,
        apiVersion: LIVE_API_VERSION,
        expiresAt: new Date(Date.now() + TOKEN_TTL_MS).toISOString(),
        callId: activeCallId,
        agent: { id: agentId, name: prompt.name, greeting: prompt.greeting },
      },
      // A cached credential is a shared credential.
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[live/token] mint failed:", message);
    return NextResponse.json({ error: `Could not mint token: ${message}` }, { status: 502 });
  }
}
