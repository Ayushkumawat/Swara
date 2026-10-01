/**
 * A live voice session, from the browser.
 *
 * Owns the socket, the mic, the speaker, and the reconnect logic. Emits plain
 * events so React only ever renders state — no audio concern reaches a
 * component.
 *
 * The reconnect behaviour is the substance of this file. The Live API caps a
 * single WebSocket at roughly 10 minutes and warns 60 seconds ahead with a
 * `goAway`. Handled naively, every call over 10 minutes drops mid-sentence.
 * Handled properly, the socket is swapped underneath a conversation that keeps
 * its memory, and the caller hears nothing.
 */

import { GoogleGenAI, type LiveServerMessage, type Session } from "@google/genai";
import { AudioPlayer, MicCapture, fromBase64 } from "./audio";
import { ASYNC_TOOL_SCHEDULING, isAsyncTool } from "./config";

export type LiveStatus =
  | "idle"
  | "connecting"
  | "live"
  | "reconnecting"
  | "closing"
  | "closed"
  | "error";

export type TranscriptTurn = {
  id: string;
  role: "caller" | "agent";
  text: string;
  at: number;
};

export type LiveEvents = {
  onStatus: (status: LiveStatus, detail?: string) => void;
  /** Streaming transcript. Fragments arrive token-by-token and are coalesced
   *  into the current turn until the speaker changes. */
  onTranscript: (turns: TranscriptTurn[]) => void;
  onMicLevel: (level: number) => void;
  onAgentSpeaking: (speaking: boolean) => void;
  /** Cumulative tokens. This is what a per-minute price is actually built on,
   *  so it is surfaced rather than hidden. */
  onUsage: (usage: { totalTokens: number }) => void;
  /** Fires when the agent uses a tool mid-call, so the UI can show the work
   *  ("Looking up order…") instead of unexplained silence. */
  onTool?: (name: string) => void;
  /** Fires with the tool's result once it lands — the setup assistant's
   *  writes invalidate the console's caches through this, and a proposed
   *  agent plan reaches the Build panel this way. */
  onToolResult?: (name: string, result: Record<string, unknown>) => void;
  /** The call moved to another agent (handoff_to_agent). */
  onHandoff?: (agent: { id: string; name: string }, summary: string) => void;
  /** The agent hung up (end_call) — after its closing audio finished. */
  onEnded?: (outcome: string) => void;
  /** Mic could not be opened. The session still starts; the caller types. */
  onMicUnavailable?: (detail: string) => void;
  onError: (message: string) => void;
};

export type LiveSessionParams = {
  agentId: string;
  voice?: string;
  languages?: string[];
  /**
   * Speaker only: no microphone, and the session ends by itself once the
   * agent's first turn has finished playing. Used by Voice Studio's preview,
   * where the agent introduces itself and nobody is meant to answer.
   */
  listenOnly?: boolean;
};

type TokenResponse = {
  token: string;
  model: string;
  apiVersion: string;
  callId: string;
  agent: { id: string; name: string; greeting: string; voice?: string };
  error?: string;
};

type Control =
  | { kind: "handoff"; agentId: string; agentName: string; summary: string }
  | { kind: "end"; outcome: string }
  | { kind: "transfer"; phone: string; name: string };

/** Background tools say when their result may be spoken; blocking ones don't. */
function schedulingFor(name: string | undefined) {
  return isAsyncTool(name) ? { scheduling: ASYNC_TOOL_SCHEDULING } : {};
}

export class LiveVoiceSession {
  private session: Session | null = null;
  private mic = new MicCapture();
  private player = new AudioPlayer();
  private status: LiveStatus = "idle";

  private turns: TranscriptTurn[] = [];
  private pendingRole: "caller" | "agent" | null = null;

  /** Latest handle the server issued. The whole conversation's continuity
   *  hangs off this string. */
  private resumeHandle: string | null = null;
  private totalTokens = 0;
  private stopping = false;
  private reconnectAttempts = 0;

  /** The backend's call row for this conversation. Assigned by the first
   *  token mint, reused across reconnects, completed exactly once on stop. */
  private callId: string | null = null;
  private startedAtMs = 0;
  private completionSent = false;

  /** Set by a handoff: the next connect opens as this agent, and greets with
   *  the summary marker instead of [CALL_CONNECTED]. */
  private pendingHandoff: { agentId: string; agentName: string; summary: string } | null = null;
  /** Set by end_call: stop once the closing audio has drained. */
  private endingOutcome: string | null = null;

  constructor(
    private params: LiveSessionParams,
    private events: LiveEvents,
  ) {}

  async start() {
    this.stopping = false;
    this.setStatus("connecting");

    try {
      // Microphone first, still inside the click. Opening the playback
      // context and then waiting on a token mint before getUserMedia is
      // what produced "Requested device not found" on Linux Chrome —
      // PulseAudio treats the output context as exclusive, and the user
      // gesture has also expired by the time we ask for the input.
      if (this.params.listenOnly) {
        this.events.onMicUnavailable?.("listen only");
      } else {
        try {
          await this.mic.start({
            onAudio: (base64) => this.sendAudio(base64),
            onLevel: (level) => this.events.onMicLevel(level),
          });
        } catch (micError) {
          const message = micError instanceof Error ? micError.message : String(micError);
          this.events.onMicUnavailable?.(this.explain(message));
        }
      }

      // Created after the mic is held, then resumed explicitly: getUserMedia
      // counts as user activation, so this is not silent-under-autoplay.
      await this.player.start((speaking) => this.events.onAgentSpeaking(speaking));
      await this.connect();
      this.setStatus("live");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.events.onError(this.explain(message));
      this.setStatus("error", message);
      await this.stop();
    }
  }

  /**
   * Markers the persona is told to react to. A real agent speaks the instant
   * the line opens; the model otherwise sits silent until spoken to, which on a
   * phone reads as a dead line.
   *
   * Sent as realtime text rather than as conversation history so it does not
   * appear in the caller transcript — no caller said this.
   */
  private static readonly CONNECTED = "[CALL_CONNECTED]";
  private static readonly RECONNECTED = "[CALL_RECONNECTED]";

  /** Opens one socket. Called again, with a handle, on every reconnect. */
  private async connect() {
    const handoff = this.pendingHandoff;
    this.pendingHandoff = null;
    // A handoff is a new persona on the same call row: no resume handle (that
    // would restore the *old* agent's context), the summary carries the
    // context instead.
    const resuming = !handoff && this.resumeHandle !== null;

    const response = await fetch("/api/live/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agentId: this.params.agentId,
        voice: this.params.voice,
        languages: this.params.languages,
        resumeHandle: this.resumeHandle ?? undefined,
        callId: this.callId ?? undefined,
      }),
    });

    const payload = (await response.json()) as TokenResponse;
    if (!response.ok) throw new Error(payload.error ?? `Token request failed (${response.status})`);
    if (!this.callId) {
      this.callId = payload.callId;
      this.startedAtMs = Date.now();
    }

    // The token string is the API key for this one session. The api version
    // must match the one it was minted under or the socket fails to handshake.
    const ai = new GoogleGenAI({
      apiKey: payload.token,
      httpOptions: { apiVersion: payload.apiVersion },
    });

    this.session = await ai.live.connect({
      model: payload.model,
      // No config: the token's constraints carry it. Sending one here risks a
      // mismatch rejection, and would let the client override the persona.
      callbacks: {
        onmessage: (message) => this.handleMessage(message),
        onerror: (event) => {
          this.events.onError(this.explain(event.message ?? "Socket error"));
          void this.recover("socket error");
        },
        onclose: () => {
          // Only unexpected closes are worth recovering from; a close we
          // asked for is just the call ending.
          if (!this.stopping) void this.recover("connection closed");
        },
      },
    });

    // A resumed session must not greet again — it is mid-conversation. A
    // handed-off session gets the previous agent's summary and continues.
    this.session.sendRealtimeInput({
      text: handoff
        ? `[HANDOFF: ${handoff.summary || "caller passed from another agent; continue the conversation"}]`
        : resuming
          ? LiveVoiceSession.RECONNECTED
          : LiveVoiceSession.CONNECTED,
    });
  }

  private handleMessage(message: LiveServerMessage) {
    // Resumption handles arrive periodically throughout the session. Keeping
    // only the latest is correct — older handles resume to a staler point.
    const resumption = message.sessionResumptionUpdate;
    if (resumption?.resumable && resumption.newHandle) {
      this.resumeHandle = resumption.newHandle;
    }

    // 60 seconds of warning. Reconnecting now, while the current socket still
    // works, means the swap lands in a gap between turns instead of mid-word.
    if (message.goAway) {
      void this.recover(`server going away (${message.goAway.timeLeft ?? "unknown"} left)`);
    }

    if (message.usageMetadata?.totalTokenCount) {
      this.totalTokens = message.usageMetadata.totalTokenCount;
      this.events.onUsage({ totalTokens: this.totalTokens });
    }

    // The model wants to use a tool. The browser is only a courier here: the
    // call goes to our backend, which executes against the database or the
    // tenant's connector and returns what the model should speak from.
    if (message.toolCall?.functionCalls?.length) {
      void this.runTools(message.toolCall.functionCalls);
    }

    const content = message.serverContent;
    if (!content) return;

    // Barge-in: the caller started talking. Everything already buffered is
    // audio the model has retracted.
    if (content.interrupted) {
      this.player.interrupt();
      this.pendingRole = null;
    }

    if (content.inputTranscription?.text) {
      this.appendTranscript("caller", content.inputTranscription.text);
    }
    if (content.outputTranscription?.text) {
      this.appendTranscript("agent", content.outputTranscription.text);
    }

    // A single event can carry several parts — audio and transcript together —
    // so every part gets read rather than just the first.
    for (const part of content.modelTurn?.parts ?? []) {
      const inline = part.inlineData;
      if (inline?.data && inline.mimeType?.startsWith("audio/pcm")) {
        this.player.enqueue(fromBase64(inline.data));
      }
    }

    if (content.turnComplete) {
      this.pendingRole = null;
      // A preview is one turn long: the agent introduces itself and the
      // session closes once that audio has drained.
      if (this.params.listenOnly && this.endingOutcome === null) this.endingOutcome = "preview";
      // end_call / handoff take effect at the end of the turn that called
      // them, so the bridge sentence ("connecting you to...") is heard.
      if (this.endingOutcome !== null) void this.finishAfterAudio();
      else if (this.pendingHandoff) void this.performHandoff();
    }
  }

  private async runTools(
    calls: { id?: string; name?: string; args?: Record<string, unknown> }[],
  ) {
    const responses = await Promise.all(
      calls.map(async (call) => {
        this.events.onTool?.(call.name ?? "tool");
        try {
          const res = await fetch("/api/v1/tools/execute", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ callId: this.callId, name: call.name, args: call.args ?? {} }),
          });
          const payload = await res.json();
          const result: Record<string, unknown> = res.ok
            ? (payload.result ?? {})
            : { error: payload.error ?? "Tool failed" };

          // Control records are for this runtime, not the model. Strip them
          // before the response goes back so the model only sees the
          // confirmation it should speak from.
          const { __control, ...spoken } = result;
          if (__control) this.applyControl(__control as Control);
          this.events.onToolResult?.(call.name ?? "tool", result);

          return { id: call.id, name: call.name, response: spoken, ...schedulingFor(call.name) };
        } catch {
          // The model is mid-sentence waiting on this. An error payload it can
          // apologise from beats a hung turn.
          return { id: call.id, name: call.name, response: { error: "Tool unreachable" }, ...schedulingFor(call.name) };
        }
      }),
    );

    // The session may have been swapped by a reconnect while the tool ran;
    // whatever socket is current gets the response.
    this.session?.sendToolResponse({ functionResponses: responses });
  }

  private applyControl(control: Control) {
    if (control.kind === "handoff") {
      this.pendingHandoff = { agentId: control.agentId, agentName: control.agentName, summary: control.summary };
    } else if (control.kind === "end") {
      this.endingOutcome = control.outcome;
    }
    // "transfer" in the browser bench is a caption only; the phone bridge
    // dials the desk. onToolResult carries the details to the UI.
  }

  /** Wait for the closing line to finish playing, then hang up. */
  private async finishAfterAudio() {
    const outcome = this.endingOutcome;
    if (outcome === null || this.stopping) return;
    this.endingOutcome = null;
    await this.player.drain(6000);
    if (this.stopping) return;
    this.events.onEnded?.(outcome);
    await this.stop();
  }

  /**
   * Swap the persona under the same call: close this socket, mint a token
   * for the target agent, reconnect with the summary marker. The mic and
   * speaker stay open, so the caller hears a beat of silence, not a drop.
   */
  private async performHandoff() {
    const target = this.pendingHandoff;
    if (!target || this.stopping) return;
    await this.player.drain(6000);
    if (this.stopping) return;

    this.setStatus("reconnecting", `handing off to ${target.agentName}`);
    try {
      this.session?.close();
    } catch {
      // Already gone.
    }
    this.session = null;
    this.resumeHandle = null;
    this.params = { ...this.params, agentId: target.agentId };
    this.events.onHandoff?.({ id: target.agentId, name: target.agentName }, target.summary);

    try {
      await this.connect();
      this.setStatus("live", `now with ${target.agentName}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.events.onError(`Handoff failed: ${message}`);
      this.setStatus("error", message);
      await this.stop();
    }
  }

  /**
   * Coalesces streamed fragments into turns. Transcription arrives in small
   * pieces; appending each as its own entry would render a transcript one word
   * per line.
   */
  private appendTranscript(role: "caller" | "agent", text: string) {
    const last = this.turns[this.turns.length - 1];
    if (this.pendingRole === role && last?.role === role) {
      last.text += text;
    } else {
      this.turns.push({ id: `${role}-${Date.now()}-${this.turns.length}`, role, text, at: Date.now() });
      this.pendingRole = role;
    }
    this.events.onTranscript([...this.turns]);
  }

  private sendAudio(base64: string) {
    // Mid-reconnect there is no socket. Dropping these frames is right: the
    // alternative is queueing stale audio that arrives after the caller has
    // moved on, so the agent answers a question from four seconds ago.
    if (!this.session || this.status === "reconnecting") return;
    try {
      this.session.sendRealtimeInput({
        audio: { data: base64, mimeType: "audio/pcm;rate=16000" },
      });
    } catch {
      void this.recover("send failed");
    }
  }

  /** Text into a voice session — used by the console's "say this" box and by
   *  supervisors steering a live call. */
  sendText(text: string) {
    if (!this.session) return;
    this.session.sendRealtimeInput({ text });
  }

  setMuted(muted: boolean) {
    this.mic.setMuted(muted);
  }

  /** Amplitude of the agent's own voice, polled by the UI's meter. Read on
   *  demand rather than pushed as an event: at 60 fps an event stream would
   *  mean 60 React state updates a second. */
  get outputLevel() {
    return this.player.level;
  }

  /**
   * Swaps the socket without losing the conversation.
   *
   * Guarded against pile-up: `goAway` and `onclose` both fire for the same
   * underlying event, and two concurrent reconnects would open two sockets
   * resuming the same handle.
   */
  private async recover(reason: string) {
    if (this.stopping || this.status === "reconnecting") return;

    if (!this.resumeHandle) {
      // Without a handle there is nothing to resume into, and a silent cold
      // restart would drop the conversation's memory while appearing to work.
      this.events.onError(`Connection lost (${reason}) and no resume handle was issued yet.`);
      this.setStatus("error", reason);
      await this.stop();
      return;
    }

    this.reconnectAttempts += 1;
    if (this.reconnectAttempts > 5) {
      this.events.onError("Reconnected too many times; ending the session.");
      await this.stop();
      return;
    }

    this.setStatus("reconnecting", reason);

    try {
      this.session?.close();
    } catch {
      // Already gone.
    }
    this.session = null;

    // Brief backoff so a server-side fault doesn't turn into a reconnect loop.
    await new Promise((resolve) => setTimeout(resolve, 250 * this.reconnectAttempts));
    if (this.stopping) return;

    try {
      await this.connect();
      this.setStatus("live", "resumed");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.events.onError(`Could not resume: ${message}`);
      this.setStatus("error", message);
      await this.stop();
    }
  }

  async stop() {
    this.stopping = true;
    this.setStatus("closing");
    try {
      this.session?.close();
    } catch {
      // Already closed.
    }
    this.session = null;
    await this.mic.stop();
    await this.player.stop();
    this.reportCompletion();
    this.setStatus("closed");
  }

  /**
   * Tells the backend the call is over — duration, tokens, transcript. This is
   * what turns the session into minutes on the usage meter, cost on the
   * dashboard, and a transcript for the post-call pipeline to classify and
   * route. `keepalive` because the commonest way a call ends is the tab
   * closing, and a normal fetch would be cancelled mid-flight.
   */
  private reportCompletion() {
    if (!this.callId || this.completionSent) return;
    this.completionSent = true;

    void fetch("/api/v1/calls/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      keepalive: true,
      body: JSON.stringify({
        callId: this.callId,
        durationSec: Math.round((Date.now() - this.startedAtMs) / 1000),
        tokens: this.totalTokens,
        transcript: this.turns.map((t) => ({ role: t.role, text: t.text })),
      }),
    }).catch(() => {
      // The 30-minute liveness window in the repo cleans up calls whose
      // completion never arrived.
    });
  }

  private setStatus(status: LiveStatus, detail?: string) {
    this.status = status;
    this.events.onStatus(status, detail);
  }

  /** Raw SDK errors are unreadable to whoever is testing an agent at 11pm. */
  private explain(message: string) {
    if (/permission|NotAllowed/i.test(message)) {
      return "Microphone permission was denied. Allow mic access and try again.";
    }
    if (/NotFound|not found|no microphone|Overconstrained|could not start audio/i.test(message)) {
      return "No microphone found. Check the system input device, or type instead of speaking.";
    }
    if (/GEMINI_API_KEY/i.test(message)) {
      return "Server is missing GEMINI_API_KEY — see web/.env.example.";
    }
    if (/quota|RESOURCE_EXHAUSTED|429/i.test(message)) {
      return "Gemini quota exhausted for this key.";
    }
    return message;
  }
}
