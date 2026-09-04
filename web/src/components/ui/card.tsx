"use client";

import { motion } from "motion/react";
import { useLitBorder } from "@/components/motion/primitives";
import { cn } from "@/lib/utils";

export function Card({
  children,
  className,
  interactive = true,
  padded = true,
  onClick,
}: {
  children: React.ReactNode;
  className?: string;
  interactive?: boolean;
  padded?: boolean;
  onClick?: () => void;
}) {
  const ref = useLitBorder<HTMLDivElement>();

  return (
    <motion.div
      ref={ref}
      onClick={onClick}
      whileHover={interactive ? { y: -2 } : undefined}
      transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
      className={cn(
        "glass rounded-[22px] relative",
        interactive && "lit-border transition-colors hover:bg-white/[0.062]",
        onClick && "cursor-pointer",
        padded && "p-5",
        className,
      )}
    >
      {children}
    </motion.div>
  );
}

export function CardHead({
  title,
  sub,
  action,
  className,
}: {
  title: React.ReactNode;
  sub?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "mb-4 flex flex-wrap items-center justify-between gap-2",
        className,
      )}
    >
      <div className="min-w-0">
        <h3 className="font-[family-name:var(--font-display)] text-[14.5px] font-semibold text-t1">
          {title}
        </h3>
        {sub ? <div className="mt-0.5 text-[11.5px] text-t3">{sub}</div> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

/** The metric tile used across Overview, Campaigns, Analytics. */
export function MetricCard({
  icon,
  accent = "violet",
  value,
  label,
  trend,
  trendTone,
  footnote,
  onClick,
}: {
  icon: React.ReactNode;
  accent?: "violet" | "cyan" | "amber" | "coral";
  value: React.ReactNode;
  label: string;
  trend?: string;
  trendTone?: "up" | "down" | "flat";
  footnote?: React.ReactNode;
  onClick?: () => void;
}) {
  const accents = {
    violet: "bg-violet/[0.16] text-violet",
    cyan: "bg-cyan/[0.14] text-cyan",
    amber: "bg-amber/[0.14] text-amber",
    coral: "bg-coral/[0.14] text-coral",
  } as const;

  return (
    <Card className="p-[18px]" onClick={onClick}>
      <div className="mb-3 flex items-center justify-between">
        <div
          className={cn(
            "flex size-[30px] items-center justify-center rounded-[9px] [&>svg]:size-[15px]",
            accents[accent],
          )}
        >
          {icon}
        </div>
        {trend ? (
          <span
            className={cn(
              "font-[family-name:var(--font-mono)] text-[11px]",
              trendTone === "down" ? "text-coral" : trendTone === "flat" ? "text-t3" : "text-cyan",
            )}
          >
            {trend}
          </span>
        ) : null}
      </div>
      <div className="font-[family-name:var(--font-display)] text-2xl font-semibold tracking-tight text-t1">
        {value}
      </div>
      <div className="mt-0.5 text-xs text-t2">{label}</div>
      {footnote ? <div className="mt-2 text-[11px] text-t3">{footnote}</div> : null}
    </Card>
  );
}
