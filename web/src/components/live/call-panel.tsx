"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Loader2, Mic, MicOff, PhoneOff, Send, TriangleAlert, X } from "lucide-react";
import { Button, IconButton } from "@/components/ui/button";
import { Pill } from "@/components/ui/pill";
import { useLiveClock } from "@/components/ui/live";
import { useLiveSession } from "@/lib/live/use-live-session";
import { LIVE_VOICES } from "@/lib/live/config";
import { cn, formatDuration } from "@/lib/utils";

/**
 * The real speech-to-speech test bench.
 *
 * Every other screen in this console renders data about calls. This one is an
 * actual call: browser mic straight to the model, model audio straight back.
 *
 * Deliberately framed as a test rather than as the product's call surface,
 * because a customer's call arrives over SIP and never touches a browser. What
 * this proves is the agent's behaviour — the prompt, the voice, the languages,
 * the interruption handling — which is what you want to check before pointing a
 * phone number at it.
 */
export function CallPanel({
  open,
  onClose,
  agentId,
  agentName,
  languages,
}: {
  open: boolean;
  onClose: () => void;
  agentId: string;
  agentName: string;
  languages?: string[];
}) {
  const live = useLiveSession();
  const [voice, setVoice] = useState(LIVE_VOICES[0].name);
  const [draft, setDraft] = useState("");

  // Ending the call when the panel closes, rather than on unmount only, so
  // dismissing the dialog releases the microphone immediately.
  //
  // Depends on the two stable values rather than the hook result, which is a
  // fresh object every render and would re-run this constantly.
  const { isActive, stop } = live;
  useEffect(() => {
    if (!open && isActive) void stop();
  }, [open, isActive, stop]);

  return (
    <AnimatePresence>
      {open ? (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-[90] bg-void/70 backdrop-blur-sm"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.97, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: 8 }}
            transition={{ type: "spring", stiffness: 320, damping: 30 }}
            className="glass-strong fixed left-1/2 top-1/2 z-[95] flex max-h-[88vh] w-[min(560px,92vw)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-[22px] border border-hairline"
            role="dialog"
            aria-label={`Test call with ${agentName}`}
          >
            <header className="flex items-start justify-between gap-3 border-b border-hairline p-4">
              <div className="min-w-0">
                <div className="font-[family-name:var(--font-display)] text-[15px] font-semibold text-t1">
                  Test call — {agentName}
                </div>
                <p className="mt-0.5 text-[11.5px] text-t3">
                  Speech to speech from this browser. Use headphones.
                </p>
              </div>
              <IconButton onClick={onClose} aria-label="Close">
                <X className="size-4" />
              </IconButton>
            </header>

            <div className="flex-1 overflow-y-auto p-4">
              {live.status === "idle" || live.status === "closed" ? (
                <Setup voice={voice} onVoice={setVoice} />
              ) : (
                <Active live={live} />
              )}

              {live.error ? (
                <div className="mt-3 flex gap-2.5 rounded-[12px] border border-coral/25 bg-coral/[0.08] p-3">
                  <TriangleAlert className="mt-px size-4 shrink-0 text-coral" strokeWidth={1.7} />
                  <p className="text-[11.5px] leading-snug text-t2">{live.error}</p>
                </div>
              ) : null}
            </div>

            <footer className="border-t border-hairline p-3.5">
              {live.isActive ? (
                <div className="space-y-2.5">
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      if (!draft.trim()) return;
                      live.sendText(draft.trim());
                      setDraft("");
                    }}
                    className="flex gap-2"
                  >
                    <input
                      value={draft}
                      onChange={(event) => setDraft(event.target.value)}
                      placeholder="Or type instead of speaking…"
                      className="glass min-w-0 flex-1 rounded-[11px] px-3 py-2 text-[12.5px] text-t1 outline-none placeholder:text-t3"
                    />
                    <Button type="submit" size="sm" disabled={!draft.trim()}>
                      <Send className="size-3.5" />
                    </Button>
                  </form>
                  <div className="flex gap-2">
                    <Button size="md" full onClick={live.toggleMute} disabled={!live.hasMic}>
                      {live.muted ? <MicOff className="size-4" /> : <Mic className="size-4" />}
                      {!live.hasMic ? "No mic" : live.muted ? "Unmute" : "Mute"}
                    </Button>
                    <Button size="md" variant="danger" full onClick={() => void live.stop()}>
                      <PhoneOff className="size-4" />
                      End call
                    </Button>
                  </div>
                </div>
              ) : (
                <Button
                  size="lg"
                  variant="primary"
                  full
                  onClick={() => void live.start({ agentId, voice, languages })}
                >
                  <Mic className="size-4" />
                  Start call
                </Button>
              )}
            </footer>
          </motion.div>
        </>
      ) : null}
    </AnimatePresence>
  );
}

function Setup({ voice, onVoice }: { voice: string; onVoice: (v: string) => void }) {
  return (
    <div>
      <div className="mb-2 text-[11.5px] font-medium text-t2">Voice</div>
      <div className="grid gap-2 sm:grid-cols-2">
        {LIVE_VOICES.map((v) => (
          <button
            key={v.id}
            onClick={() => onVoice(v.name)}
            className={cn(
              "rounded-[12px] border p-2.5 text-left transition-colors",
              voice === v.name
                ? "border-cyan/35 bg-cyan/[0.06]"
                : "border-hairline bg-white/[0.035] hover:bg-white/[0.06]",
            )}
          >
            <div className="text-[12.5px] font-medium text-t1">{v.label}</div>
            <div className="mt-0.5 text-[10.5px] text-t3">
              {v.gender} · {v.style} · {v.blurb}
            </div>
          </button>
        ))}
      </div>
      <p className="mt-3 text-[11px] leading-relaxed text-t3">
        It never asks which language you prefer. Speak Hindi, English or Hinglish — it
        follows you. Each voice has a gendered talking style you can edit in Voice studio.
      </p>
    </div>
  );
}

function Active({ live }: { live: ReturnType<typeof useLiveSession> }) {
  const now = useLiveClock(1000);
  const elapsed = live.startedAt && now ? Math.floor((now - live.startedAt) / 1000) : 0;

  const transcriptEnd = useRef<HTMLDivElement>(null);
  useEffect(() => {
    transcriptEnd.current?.scrollIntoView({ block: "end" });
  }, [live.transcript]);

  const statusPill = useMemo(() => {
    switch (live.status) {
      case "connecting":
        return { tone: "amber" as const, label: "Connecting" };
      case "reconnecting":
        // Named honestly: the socket is being replaced but the conversation
        // is not restarting, and those are very different things to a user.
        return { tone: "amber" as const, label: "Resuming" };
      case "live":
        // Tool use gets top billing: mid-call the agent goes quiet while it
        // hits the order system or files the complaint, and an unexplained
        // pause reads as a hang.
        if (live.toolActivity) return { tone: "violet" as const, label: `${live.toolActivity}…` };
        return { tone: "cyan" as const, label: live.agentSpeaking ? "Agent speaking" : "Listening" };
      case "closing":
        return { tone: "grey" as const, label: "Ending" };
      case "error":
        return { tone: "coral" as const, label: "Failed" };
      default:
        return { tone: "grey" as const, label: live.status };
    }
  }, [live.status, live.agentSpeaking, live.toolActivity]);

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-2">
        <Pill tone={statusPill.tone} dot>
          {statusPill.label}
        </Pill>
        <div className="flex items-center gap-3 font-[family-name:var(--font-mono)] text-[11px] text-t3">
          {live.totalTokens > 0 ? <span>{live.totalTokens.toLocaleString("en-IN")} tok</span> : null}
          <span>{formatDuration(elapsed)}</span>
        </div>
      </div>

      {/* Whichever side is actually making sound drives the meter. */}
      {!live.hasMic ? (
        <p className="mb-3 rounded-[12px] border border-amber/25 bg-amber/[0.08] px-3 py-2 text-[11.5px] leading-snug text-t2">
          No microphone on this machine — type below. The agent can still speak.
        </p>
      ) : null}

      <LiveMeter
        level={live.agentSpeaking ? live.agentLevel : live.micLevel}
        agentSpeaking={live.agentSpeaking}
        muted={!live.hasMic || (live.muted && !live.agentSpeaking)}
      />

      <div className="mt-4 space-y-2">
        {live.transcript.length === 0 ? (
          <p className="py-6 text-center text-[12px] text-t3">
            {live.status === "connecting" ? (
              <span className="inline-flex items-center gap-2">
                <Loader2 className="size-3.5 animate-spin" />
                Opening the session…
              </span>
            ) : (
              "Say something — the transcript appears here as you both speak."
            )}
          </p>
        ) : (
          live.transcript.map((turn) => (
            <div
              key={turn.id}
              className={cn(
                "max-w-[85%] rounded-[12px] px-3 py-2 text-[12.5px] leading-relaxed",
                turn.role === "caller"
                  ? "ml-auto bg-white/[0.07] text-t1"
                  : "bg-cyan/[0.08] text-t1",
              )}
            >
              <div className="mb-0.5 text-[10px] uppercase tracking-wide text-t3">
                {turn.role === "caller" ? "You" : "Agent"}
              </div>
              {turn.text}
            </div>
          ))
        )}
        <div ref={transcriptEnd} />
      </div>
    </div>
  );
}

/**
 * Amplitude meter driven by actual microphone RMS, unlike the decorative
 * Waveform used elsewhere in the console. On a test bench the bars have to be
 * real: "is it hearing me?" is the first question when a call goes wrong, and a
 * pretty animation that moves regardless answers it wrongly.
 */
function LiveMeter({
  level,
  agentSpeaking,
  muted,
}: {
  level: number;
  agentSpeaking: boolean;
  muted: boolean;
}) {
  const BARS = 32;
  // RMS on speech sits low; the square root opens up the bottom of the range
  // so normal speaking voice uses most of the meter instead of a third of it.
  const scaled = Math.min(1, Math.sqrt(level) * 2.1);

  return (
    <div className="flex h-14 items-center justify-center gap-[3px] rounded-[14px] border border-hairline bg-white/[0.02] px-3">
      {Array.from({ length: BARS }, (_, i) => {
        // Centre-weighted so the meter reads as a single voice rather than a
        // row of independent LEDs.
        const distance = Math.abs(i - (BARS - 1) / 2) / ((BARS - 1) / 2);
        const envelope = 1 - distance * 0.75;
        const height = muted ? 0.06 : Math.max(0.06, scaled * envelope);

        return (
          <motion.span
            key={i}
            className={cn(
              "w-[3px] rounded-full",
              muted ? "bg-t3/40" : agentSpeaking ? "bg-cyan" : "bg-violet",
            )}
            animate={{ height: `${height * 100}%` }}
            transition={{ duration: 0.08, ease: "linear" }}
          />
        );
      })}
    </div>
  );
}
