"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  LiveVoiceSession,
  type LiveSessionParams,
  type LiveStatus,
  type TranscriptTurn,
} from "./session";

/**
 * React binding for a live voice session.
 *
 * The session object lives in a ref, not in state: it owns an audio graph and a
 * socket, and putting it in state would re-create it on every render. React's
 * job here is only to render what the session reports.
 */
const TOOL_LABEL: Record<string, string> = {
  lookup_order: "Looking up order",
  register_complaint: "Registering complaint",
  book_slot: "Booking slot",
  search_knowledge: "Searching knowledge base",
  transfer_to_human: "Connecting to a person",
  transfer_to_agent: "Handing to another agent",
  end_call: "Ending the call",
  note_setup_answer: "Saving what you said",
  apply_setup_plan: "Creating agents",
};

export function useLiveSession() {
  const sessionRef = useRef<LiveVoiceSession | null>(null);

  const [status, setStatus] = useState<LiveStatus>("idle");
  const [statusDetail, setStatusDetail] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<TranscriptTurn[]>([]);
  const [micLevel, setMicLevel] = useState(0);
  const [agentSpeaking, setAgentSpeaking] = useState(false);
  const [totalTokens, setTotalTokens] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [hasMic, setHasMic] = useState(true);
  const [muted, setMuted] = useState(false);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [agentLevel, setAgentLevel] = useState(0);
  /** Human label for a tool the agent is using right now, e.g. "Looking up
   *  order". Cleared a few seconds after it fires. */
  const [toolActivity, setToolActivity] = useState<string | null>(null);
  const toolTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const start = useCallback(async (params: LiveSessionParams) => {
    if (sessionRef.current) await sessionRef.current.stop();

    setTranscript([]);
    setError(null);
    setHasMic(true);
    setTotalTokens(0);
    setMuted(false);
    setStartedAt(Date.now());

    const session = new LiveVoiceSession(params, {
      onStatus: (next, detail) => {
        setStatus(next);
        setStatusDetail(detail ?? null);
      },
      onTranscript: setTranscript,
      onMicLevel: setMicLevel,
      onAgentSpeaking: setAgentSpeaking,
      onUsage: ({ totalTokens: tokens }) => setTotalTokens(tokens),
      // Tool use looks like unexplained silence without a caption for it.
      onTool: (name) => {
        setToolActivity(TOOL_LABEL[name] ?? "Checking systems");
        if (toolTimerRef.current) clearTimeout(toolTimerRef.current);
        toolTimerRef.current = setTimeout(() => setToolActivity(null), 5000);
      },
      onMicUnavailable: () => {
        setHasMic(false);
        setMuted(true);
      },
      onHangup: () => {
        setToolActivity("Ending call");
        window.setTimeout(() => {
          if (sessionRef.current === session) void session.stop();
        }, 1600);
      },
      onError: setError,
    });

    sessionRef.current = session;
    await session.start();
  }, []);

  const stop = useCallback(async () => {
    await sessionRef.current?.stop();
    sessionRef.current = null;
    setStartedAt(null);
    setMicLevel(0);
    setAgentSpeaking(false);
  }, []);

  const toggleMute = useCallback(() => {
    setMuted((current) => {
      const next = !current;
      sessionRef.current?.setMuted(next);
      return next;
    });
  }, []);

  const sendText = useCallback((text: string) => {
    sessionRef.current?.sendText(text);
  }, []);

  // A live session holds the microphone. Leaving it open after the component
  // unmounts leaves the browser's recording indicator on, which reads as
  // spyware even when it is a bug.
  useEffect(() => {
    return () => {
      void sessionRef.current?.stop();
      sessionRef.current = null;
    };
  }, []);

  // The agent's amplitude is polled, not pushed: sampling on the frame clock
  // and only while it is actually speaking keeps this off the render path for
  // the rest of the call.
  useEffect(() => {
    if (!agentSpeaking) return;
    let frame = 0;
    const sample = () => {
      setAgentLevel(sessionRef.current?.outputLevel ?? 0);
      frame = requestAnimationFrame(sample);
    };
    frame = requestAnimationFrame(sample);
    return () => cancelAnimationFrame(frame);
  }, [agentSpeaking]);

  return {
    status,
    statusDetail,
    transcript,
    micLevel,
    // Masked rather than reset when the agent stops, so the polling effect
    // never has to write state on its way out.
    agentLevel: agentSpeaking ? agentLevel : 0,
    agentSpeaking,
    totalTokens,
    toolActivity,
    error,
    hasMic,
    muted,
    startedAt,
    isActive: status === "connecting" || status === "live" || status === "reconnecting",
    start,
    stop,
    toggleMute,
    sendText,
  };
}
