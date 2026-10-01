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
  lookup_ticket: "Looking up ticket",
  notify_stakeholder: "Notifying the team",
  resolve_ticket: "Closing ticket",
  book_slot: "Booking slot",
  search_knowledge: "Searching knowledge base",
  transfer_to_human: "Transferring to a person",
  handoff_to_agent: "Handing off to another agent",
  end_call: "Wrapping up",
  get_setup_status: "Checking what's configured",
  save_playbook: "Saving business details",
  add_department: "Adding department",
  add_transfer_target: "Adding transfer desk",
  add_appointment_type: "Adding appointment type",
  add_knowledge: "Saving knowledge",
  propose_agents: "Drafting your agents",
  list_agents: "Looking at your agents",
  get_agent: "Reading the agent",
  update_agent: "Updating the agent",
};

export type ToolEvent = { id: number; name: string; label: string; result: Record<string, unknown>; at: number };

export type LiveSessionHandlers = {
  onToolResult?: (name: string, result: Record<string, unknown>) => void;
  onHandoff?: (agent: { id: string; name: string }, summary: string) => void;
  onEnded?: (outcome: string) => void;
};

export function useLiveSession(handlers: LiveSessionHandlers = {}) {
  const sessionRef = useRef<LiveVoiceSession | null>(null);
  // Latest handlers without re-creating the session when a parent re-renders.
  const handlersRef = useRef(handlers);
  useEffect(() => {
    handlersRef.current = handlers;
  });

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
  /** Every tool result this session, newest last — the setup panel renders
   *  these as "Swara saved…" receipts. */
  const [toolEvents, setToolEvents] = useState<ToolEvent[]>([]);
  /** Which agent is on the line now; changes on handoff. */
  const [activeAgent, setActiveAgent] = useState<{ id: string; name: string } | null>(null);
  const [endedOutcome, setEndedOutcome] = useState<string | null>(null);
  const toolTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const start = useCallback(async (params: LiveSessionParams & { agentName?: string }) => {
    if (sessionRef.current) await sessionRef.current.stop();

    setTranscript([]);
    setStatus("connecting");
    setStatusDetail(null);
    setError(null);
    setHasMic(true);
    setTotalTokens(0);
    setMuted(false);
    setToolEvents([]);
    setEndedOutcome(null);
    setActiveAgent({ id: params.agentId, name: params.agentName ?? params.agentId });
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
      onToolResult: (name, result) => {
        setToolEvents((prev) => [
          ...prev.slice(-30),
          { id: Date.now() + prev.length, name, label: TOOL_LABEL[name] ?? name, result, at: Date.now() },
        ]);
        handlersRef.current.onToolResult?.(name, result);
      },
      onHandoff: (agent, summary) => {
        setActiveAgent(agent);
        handlersRef.current.onHandoff?.(agent, summary);
      },
      onEnded: (outcome) => {
        setEndedOutcome(outcome);
        handlersRef.current.onEnded?.(outcome);
      },
      onMicUnavailable: () => {
        setHasMic(false);
        setMuted(true);
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
    toolEvents,
    activeAgent,
    endedOutcome,
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
