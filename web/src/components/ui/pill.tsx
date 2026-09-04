"use client";

import { cn } from "@/lib/utils";
import type { Sentiment, Severity } from "@/lib/api/schemas";

export type Tone = "violet" | "cyan" | "amber" | "coral" | "grey";

const tones: Record<Tone, string> = {
  violet: "bg-violet/[0.14] text-violet border-violet/25",
  cyan: "bg-cyan/[0.14] text-cyan border-cyan/25",
  amber: "bg-amber/[0.14] text-amber border-amber/25",
  coral: "bg-coral/[0.14] text-coral border-coral/25",
  grey: "bg-white/[0.06] text-t2 border-hairline",
};

export function Pill({
  children,
  tone = "grey",
  className,
  dot,
}: {
  children: React.ReactNode;
  tone?: Tone;
  className?: string;
  dot?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10.5px] font-medium whitespace-nowrap",
        tones[tone],
        className,
      )}
    >
      {dot ? <span className="size-1.5 rounded-full bg-current" /> : null}
      {children}
    </span>
  );
}

export const sentimentTone: Record<Sentiment, Tone> = {
  positive: "cyan",
  neutral: "grey",
  declining: "amber",
  frustrated: "coral",
};

export const severityTone: Record<Severity, Tone> = {
  low: "grey",
  medium: "amber",
  high: "coral",
  critical: "coral",
};

/** A live indicator that visibly breathes — used anywhere a call is active. */
export function LiveDot({
  tone = "cyan",
  className,
}: {
  tone?: "cyan" | "amber" | "coral" | "grey";
  className?: string;
}) {
  const colors = {
    cyan: "bg-cyan",
    amber: "bg-amber",
    coral: "bg-coral",
    grey: "bg-t3",
  } as const;

  return (
    <span className={cn("relative flex size-[7px] shrink-0", className)}>
      {tone !== "grey" ? (
        <span
          className={cn(
            "absolute inline-flex size-full animate-ping rounded-full opacity-60",
            colors[tone],
          )}
          style={{ animationDuration: "2.2s" }}
        />
      ) : null}
      <span className={cn("relative inline-flex size-full rounded-full", colors[tone])} />
    </span>
  );
}
