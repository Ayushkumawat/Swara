"use client";

import { useSyncExternalStore } from "react";
import { motion } from "motion/react";
import { cn, formatDuration } from "@/lib/utils";
import type { Sentiment } from "@/lib/api/schemas";

/**
 * Waveform bars. project.md §3 names these a signature element: they sit next
 * to anything live so the interface reads as voice happening now rather than
 * rows in a database. Pure CSS keyframes with a per-bar delay — no JS timer,
 * so twenty of them on a monitoring wall cost nothing.
 */
export function Waveform({
  bars = 7,
  tone = "cyan",
  height = 20,
  active = true,
  className,
}: {
  bars?: number;
  tone?: "cyan" | "coral" | "amber" | "violet";
  height?: number;
  active?: boolean;
  className?: string;
}) {
  const colors = {
    cyan: "bg-cyan",
    coral: "bg-coral",
    amber: "bg-amber",
    violet: "bg-violet",
  } as const;

  // Deterministic pseudo-random heights: same bars every render, no hydration
  // mismatch, but not a visibly repeating pattern.
  const seeds = Array.from({ length: bars }, (_, i) => 0.42 + ((i * 37) % 11) / 18);

  return (
    <div
      className={cn("flex items-center gap-[2.5px]", className)}
      style={{ height }}
      aria-hidden
    >
      {seeds.map((s, i) => (
        <span
          key={i}
          className={cn("w-[2.5px] rounded-full opacity-80", colors[tone])}
          style={{
            height: `${Math.min(100, s * 100)}%`,
            transformOrigin: "center",
            animation: active
              ? `wavebar ${0.72 + (i % 4) * 0.16}s ease-in-out ${i * 0.09}s infinite`
              : undefined,
            transform: active ? undefined : "scaleY(0.35)",
          }}
        />
      ))}
    </div>
  );
}

/**
 * Shared wall clock.
 *
 * One interval per distinct tick rate for the whole app, not one per counter —
 * a monitoring wall can have thirty live durations on screen and thirty
 * independent timers would be thirty separate render cascades a second.
 * The server snapshot is null so a clock value never causes a hydration
 * mismatch; components render a placeholder until they are interactive.
 */
type ClockStore = {
  value: number;
  listeners: Set<() => void>;
  timer?: ReturnType<typeof setInterval>;
};

const clocks = new Map<number, ClockStore>();

function clockFor(intervalMs: number): ClockStore {
  let store = clocks.get(intervalMs);
  if (!store) {
    store = { value: Date.now(), listeners: new Set() };
    clocks.set(intervalMs, store);
  }
  return store;
}

function subscribeToClock(intervalMs: number, onChange: () => void) {
  const store = clockFor(intervalMs);
  store.listeners.add(onChange);

  if (!store.timer) {
    store.timer = setInterval(() => {
      store.value = Date.now();
      store.listeners.forEach((l) => l());
    }, intervalMs);
  }

  return () => {
    store.listeners.delete(onChange);
    if (store.listeners.size === 0 && store.timer) {
      clearInterval(store.timer);
      store.timer = undefined;
    }
  };
}

export function useLiveClock(intervalMs = 1000): number | null {
  return useSyncExternalStore(
    (onChange) => subscribeToClock(intervalMs, onChange),
    () => clockFor(intervalMs).value,
    () => null,
  );
}

/** Live-ticking call duration. Renders a stable placeholder on the server so
 *  hydration never mismatches on a clock value. */
export function CallDuration({
  startedAt,
  className,
}: {
  startedAt: string;
  className?: string;
}) {
  const now = useLiveClock();
  const seconds = now ? Math.max(0, (now - new Date(startedAt).getTime()) / 1000) : 0;

  return (
    <span
      className={cn("font-[family-name:var(--font-mono)] tabular-nums", className)}
      suppressHydrationWarning
    >
      {now === null ? "--:--" : formatDuration(seconds)}
    </span>
  );
}

/**
 * Real-time sentiment as a bar rather than a label. §4.4 requires per-call
 * scoring during the call; showing it as a continuous value makes a call
 * that is *sliding* toward frustrated visible before it gets there.
 */
export function SentimentMeter({
  score,
  sentiment,
  className,
}: {
  score: number;
  sentiment: Sentiment;
  className?: string;
}) {
  const tone =
    sentiment === "frustrated"
      ? "bg-coral"
      : sentiment === "declining"
        ? "bg-amber"
        : sentiment === "positive"
          ? "bg-cyan"
          : "bg-t3";

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div className="h-1 flex-1 overflow-hidden rounded-full bg-white/[0.07]">
        <motion.div
          className={cn("h-full rounded-full", tone)}
          initial={{ width: 0 }}
          animate={{ width: `${score * 100}%` }}
          transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
        />
      </div>
      <span className="font-[family-name:var(--font-mono)] text-[10.5px] tabular-nums text-t3">
        {score.toFixed(2)}
      </span>
    </div>
  );
}

/** Countdown to an SLA deadline; goes coral once breached. */
export function SlaCountdown({ dueAt }: { dueAt: string }) {
  const now = useLiveClock(30_000);
  if (now === null)
    return <span className="font-[family-name:var(--font-mono)] text-[11px] text-t3">—</span>;

  const diffMs = new Date(dueAt).getTime() - now;
  const breached = diffMs < 0;
  const abs = Math.abs(diffMs);
  const hours = Math.floor(abs / 3_600_000);
  const mins = Math.floor((abs % 3_600_000) / 60_000);
  const label = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;

  return (
    <span
      suppressHydrationWarning
      className={cn(
        "font-[family-name:var(--font-mono)] text-[11px] tabular-nums",
        breached ? "text-coral" : diffMs < 3_600_000 ? "text-amber" : "text-t3",
      )}
    >
      {breached ? `SLA +${label}` : `SLA ${label}`}
    </span>
  );
}
