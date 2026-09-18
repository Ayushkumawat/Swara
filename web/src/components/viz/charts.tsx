"use client";

import { useId, useMemo, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";

/**
 * Hand-rolled SVG charts.
 *
 * A chart library would pull ~90KB and still need overriding to match the
 * glass/glow language. These are small, animate on reveal, and use the brand
 * gradient directly. All are client-only and imported lazily where they sit
 * below the fold.
 */

const EASE = [0.22, 1, 0.36, 1] as const;

/* ── Grouped bar chart (call volume: inbound vs outbound) ───────────────── */

export function VolumeBars({
  data,
  height = 150,
}: {
  data: { date: string; inbound: number; outbound: number }[];
  height?: number;
}) {
  const reduce = useReducedMotion();
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(...data.map((d) => d.inbound + d.outbound), 1);

  return (
    <div>
      <div className="flex items-end gap-2.5" style={{ height }}>
        {data.map((d, i) => {
          const total = d.inbound + d.outbound;
          const inPct = (d.inbound / max) * 100;
          const outPct = (d.outbound / max) * 100;
          const isHover = hover === i;

          return (
            <div
              key={d.date}
              className="group relative flex h-full flex-1 flex-col justify-end gap-[3px]"
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            >
              {isHover ? (
                <motion.div
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="glass-strong absolute -top-1 left-1/2 z-20 -translate-x-1/2 -translate-y-full rounded-lg px-2.5 py-1.5 text-center whitespace-nowrap"
                >
                  <div className="font-[family-name:var(--font-mono)] text-[11px] text-t1">
                    {total.toLocaleString("en-IN")} calls
                  </div>
                  <div className="mt-0.5 text-[10px] text-t3">
                    {d.inbound.toLocaleString("en-IN")} in · {d.outbound.toLocaleString("en-IN")} out
                  </div>
                </motion.div>
              ) : null}

              <motion.div
                className="w-full rounded-t-[3px] bg-cyan/70"
                initial={reduce ? false : { height: 0 }}
                animate={{ height: `${outPct}%` }}
                transition={{ duration: 0.75, delay: i * 0.05, ease: EASE }}
                style={{ opacity: hover === null || isHover ? 1 : 0.4 }}
              />
              <motion.div
                className="w-full rounded-t-[7px] rounded-b-[3px]"
                style={{
                  background:
                    "linear-gradient(180deg, var(--color-violet), rgba(124,108,246,0.25))",
                  opacity: hover === null || isHover ? 1 : 0.4,
                }}
                initial={reduce ? false : { height: 0 }}
                animate={{ height: `${inPct}%` }}
                transition={{ duration: 0.75, delay: i * 0.05, ease: EASE }}
              />
            </div>
          );
        })}
      </div>
      <div className="mt-2.5 flex gap-2.5">
        {data.map((d) => (
          <div
            key={d.date}
            className="flex-1 text-center font-[family-name:var(--font-mono)] text-[10px] text-t3"
          >
            {new Date(d.date).toLocaleDateString("en-IN", { weekday: "short" })}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Area / line trend ──────────────────────────────────────────────────── */

export function TrendArea({
  data,
  height = 130,
  tone = "cyan",
  valueFormat = (v: number) => v.toFixed(2),
  yMin,
  yMax,
}: {
  data: { date: string; value: number }[];
  height?: number;
  tone?: "cyan" | "violet" | "amber";
  valueFormat?: (v: number) => string;
  yMin?: number;
  yMax?: number;
}) {
  const gid = useId();
  const reduce = useReducedMotion();
  const [hover, setHover] = useState<number | null>(null);

  const colors = {
    cyan: "var(--color-cyan)",
    violet: "var(--color-violet)",
    amber: "var(--color-amber)",
  } as const;
  const stroke = colors[tone];

  const W = 100;
  const H = 40;

  const { line, area, points, lo, hi } = useMemo(() => {
    const values = data.map((d) => d.value);
    const lo = yMin ?? Math.min(...values) * 0.96;
    const hi = yMax ?? Math.max(...values) * 1.04;
    const span = hi - lo || 1;

    const points = data.map((d, i) => ({
      x: (i / Math.max(1, data.length - 1)) * W,
      y: H - ((d.value - lo) / span) * H,
      ...d,
    }));

    // An empty series must not emit a path without a moveto — the browser
    // logs an attribute error for every render.
    const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");
    const area = points.length ? `${line} L${W},${H} L0,${H} Z` : "";
    return { line, area, points, lo, hi };
  }, [data, yMin, yMax]);

  const active = hover !== null ? points[hover] : null;

  return (
    <div className="relative" style={{ height }}>
      {active ? (
        <div
          className="glass-strong pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-full rounded-lg px-2.5 py-1.5 whitespace-nowrap"
          style={{ left: `${active.x}%`, top: `${(active.y / H) * 100}%` }}
        >
          <div className="font-[family-name:var(--font-mono)] text-[11px] text-t1">
            {valueFormat(active.value)}
          </div>
          <div className="text-[10px] text-t3">
            {new Date(active.date).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
          </div>
        </div>
      ) : null}

      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="size-full overflow-visible"
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id={`fill-${gid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={stroke} stopOpacity="0.34" />
            <stop offset="100%" stopColor={stroke} stopOpacity="0" />
          </linearGradient>
        </defs>

        {[0.25, 0.5, 0.75].map((f) => (
          <line
            key={f}
            x1="0"
            x2={W}
            y1={H * f}
            y2={H * f}
            stroke="rgba(255,255,255,0.05)"
            strokeWidth="0.25"
          />
        ))}

        <motion.path
          d={area}
          fill={`url(#fill-${gid})`}
          initial={reduce ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.8, delay: 0.3, ease: EASE }}
        />
        <motion.path
          d={line}
          fill="none"
          stroke={stroke}
          strokeWidth="0.7"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
          initial={reduce ? false : { pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 1.1, ease: EASE }}
        />

        {active ? (
          <>
            <line
              x1={active.x}
              x2={active.x}
              y1="0"
              y2={H}
              stroke="rgba(255,255,255,0.16)"
              strokeWidth="0.25"
            />
            <circle cx={active.x} cy={active.y} r="1.1" fill={stroke} />
          </>
        ) : null}

        {points.map((p, i) => (
          <rect
            key={i}
            x={p.x - W / points.length / 2}
            y={0}
            width={W / points.length}
            height={H}
            fill="transparent"
            onMouseEnter={() => setHover(i)}
          />
        ))}
      </svg>

      <div className="mt-1.5 flex justify-between font-[family-name:var(--font-mono)] text-[10px] text-t3">
        <span>{valueFormat(lo)}</span>
        <span>{valueFormat(hi)}</span>
      </div>
    </div>
  );
}

/* ── Stacked cost bars ──────────────────────────────────────────────────── */

export function StackedCostBars({
  data,
  height = 130,
}: {
  data: { date: string; ai: number; telephony: number }[];
  height?: number;
}) {
  const reduce = useReducedMotion();
  const max = Math.max(...data.map((d) => d.ai + d.telephony), 1);
  const [hover, setHover] = useState<number | null>(null);

  return (
    <div className="flex items-end gap-[3px]" style={{ height }}>
      {data.map((d, i) => {
        const isHover = hover === i;
        return (
          <div
            key={d.date}
            className="relative flex h-full flex-1 flex-col justify-end gap-px"
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          >
            {isHover ? (
              <motion.div
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                className="glass-strong absolute -top-1 left-1/2 z-20 -translate-x-1/2 -translate-y-full rounded-lg px-2.5 py-1.5 text-center whitespace-nowrap"
              >
                <div className="font-[family-name:var(--font-mono)] text-[11px] text-t1">
                  ₹{(d.ai + d.telephony).toFixed(2)}/min
                </div>
                <div className="mt-0.5 text-[10px] text-t3">
                  AI ₹{d.ai.toFixed(2)} · telephony ₹{d.telephony.toFixed(2)}
                </div>
              </motion.div>
            ) : null}
            <motion.div
              className="w-full rounded-t-[2px] bg-amber/60"
              initial={reduce ? false : { height: 0 }}
              animate={{ height: `${(d.telephony / max) * 100}%` }}
              transition={{ duration: 0.6, delay: i * 0.012, ease: EASE }}
              style={{ opacity: hover === null || isHover ? 1 : 0.4 }}
            />
            <motion.div
              className="w-full rounded-t-[3px] bg-violet/70"
              initial={reduce ? false : { height: 0 }}
              animate={{ height: `${(d.ai / max) * 100}%` }}
              transition={{ duration: 0.6, delay: i * 0.012, ease: EASE }}
              style={{ opacity: hover === null || isHover ? 1 : 0.4 }}
            />
          </div>
        );
      })}
    </div>
  );
}

/* ── Horizontal share bar (language mix) ────────────────────────────────── */

export function ShareBar({
  segments,
  className,
}: {
  segments: { label: string; value: number; color: string }[];
  className?: string;
}) {
  const reduce = useReducedMotion();
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;

  return (
    <div className={className}>
      <div className="flex h-2.5 w-full gap-[3px] overflow-hidden rounded-full">
        {segments.map((s, i) => (
          <motion.div
            key={s.label}
            className="h-full rounded-full first:rounded-l-full last:rounded-r-full"
            style={{ background: s.color }}
            initial={reduce ? false : { width: 0 }}
            animate={{ width: `${(s.value / total) * 100}%` }}
            transition={{ duration: 0.8, delay: i * 0.07, ease: EASE }}
          />
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2">
        {segments.map((s) => (
          <div key={s.label} className="flex items-center gap-1.5">
            <span className="size-2 rounded-full" style={{ background: s.color }} />
            <span className="text-[11.5px] text-t2">{s.label}</span>
            <span className="font-[family-name:var(--font-mono)] text-[11px] text-t3">
              {Math.round((s.value / total) * 100)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Radial gauge (containment, pickup rate) ────────────────────────────── */

export function Gauge({
  value,
  label,
  size = 96,
  tone = "cyan",
}: {
  value: number;
  label?: string;
  size?: number;
  tone?: "cyan" | "violet" | "amber" | "coral";
}) {
  const reduce = useReducedMotion();
  const colors = {
    cyan: "var(--color-cyan)",
    violet: "var(--color-violet)",
    amber: "var(--color-amber)",
    coral: "var(--color-coral)",
  } as const;

  const r = 42;
  const circumference = 2 * Math.PI * r;

  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg viewBox="0 0 100 100" className="size-full -rotate-90">
        <circle cx="50" cy="50" r={r} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="7" />
        <motion.circle
          cx="50"
          cy="50"
          r={r}
          fill="none"
          stroke={colors[tone]}
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={circumference}
          initial={reduce ? false : { strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: circumference * (1 - value) }}
          transition={{ duration: 1.2, ease: EASE }}
        />
      </svg>
      <div className="absolute text-center">
        <div className="font-[family-name:var(--font-display)] text-[17px] font-semibold text-t1">
          {Math.round(value * 100)}%
        </div>
        {label ? <div className="text-[10px] text-t3">{label}</div> : null}
      </div>
    </div>
  );
}

/* ── Compact sparkline for inline use ───────────────────────────────────── */

export function Sparkline({
  values,
  tone = "cyan",
  className,
  width = 72,
  height = 22,
}: {
  values: number[];
  tone?: "cyan" | "violet" | "coral";
  className?: string;
  width?: number;
  height?: number;
}) {
  const reduce = useReducedMotion();
  const colors = { cyan: "var(--color-cyan)", violet: "var(--color-violet)", coral: "var(--color-coral)" } as const;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo || 1;
  const d = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * width;
      const y = height - ((v - lo) / span) * height;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <svg width={width} height={height} className={cn("overflow-visible", className)}>
      <motion.path
        d={d}
        fill="none"
        stroke={colors[tone]}
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={reduce ? false : { pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.9, ease: EASE }}
      />
    </svg>
  );
}
