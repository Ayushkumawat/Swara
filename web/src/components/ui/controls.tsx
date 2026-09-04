"use client";

import { motion } from "motion/react";
import { useId } from "react";
import { cn } from "@/lib/utils";

/** Segmented tab bar. The active pill slides between items via a shared
 *  layoutId, so switching reads as one control rather than two states. */
export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  className,
  size = "md",
}: {
  tabs: readonly { value: T; label: string; count?: number }[];
  value: T;
  onChange: (v: T) => void;
  className?: string;
  size?: "sm" | "md";
}) {
  const layoutId = useId();

  return (
    <div
      role="tablist"
      className={cn(
        "glass inline-flex w-fit max-w-full gap-1 overflow-x-auto rounded-xl p-1 no-scrollbar",
        className,
      )}
    >
      {tabs.map((t) => {
        const active = t.value === value;
        return (
          <button
            key={t.value}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(t.value)}
            className={cn(
              "relative shrink-0 rounded-[9px] font-medium transition-colors",
              size === "sm" ? "px-3 py-1.5 text-[11.5px]" : "px-[15px] py-[7px] text-[12.5px]",
              active ? "text-t1" : "text-t2 hover:text-t1",
            )}
          >
            {active ? (
              <motion.span
                layoutId={layoutId}
                className="absolute inset-0 rounded-[9px] bg-white/[0.09]"
                transition={{ type: "spring", stiffness: 420, damping: 34 }}
              />
            ) : null}
            <span className="relative z-10">
              {t.label}
              {typeof t.count === "number" ? (
                <span className="ml-1.5 font-[family-name:var(--font-mono)] text-[10.5px] text-t3">
                  {t.count}
                </span>
              ) : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative h-5 w-9 shrink-0 rounded-full border border-hairline transition-colors",
        checked ? "grad-brand" : "bg-white/[0.08]",
        disabled && "cursor-not-allowed opacity-40",
      )}
    >
      <motion.span
        layout
        transition={{ type: "spring", stiffness: 550, damping: 32 }}
        className="absolute top-[2px] size-3.5 rounded-full bg-white shadow-sm"
        style={{ left: checked ? 19 : 3 }}
      />
    </button>
  );
}

export function Slider({
  value,
  onChange,
  label,
  hint,
  min = 0,
  max = 1,
  step = 0.01,
  format,
}: {
  value: number;
  onChange: (v: number) => void;
  label?: string;
  hint?: string;
  min?: number;
  max?: number;
  step?: number;
  format?: (v: number) => string;
}) {
  const pct = ((value - min) / (max - min)) * 100;

  return (
    <div>
      {label ? (
        <div className="mb-1.5 flex items-baseline justify-between">
          <span className="text-[11px] text-t3">{label}</span>
          <span className="font-[family-name:var(--font-mono)] text-[11px] text-t2">
            {format ? format(value) : value.toFixed(2)}
          </span>
        </div>
      ) : null}
      <div className="relative flex h-[15px] items-center">
        <div className="absolute h-[5px] w-full rounded-full bg-white/[0.08]" />
        <div
          className="absolute h-[5px] rounded-full grad-brand"
          style={{ width: `${pct}%` }}
        />
        <div
          className="pointer-events-none absolute size-[15px] rounded-full border-2 border-void bg-cyan shadow-[0_0_12px_rgba(63,224,197,0.5)] transition-transform"
          style={{ left: `calc(${pct}% - 7.5px)` }}
        />
        <input
          type="range"
          aria-label={label}
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="relative z-10 h-[15px] w-full cursor-pointer opacity-0"
        />
      </div>
      {hint ? <p className="mt-1.5 text-[10.5px] text-t3">{hint}</p> : null}
    </div>
  );
}

export function SearchInput({
  value,
  onChange,
  placeholder,
  className,
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
}) {
  return (
    <div
      className={cn(
        "glass flex items-center gap-2 rounded-full px-[13px] py-[9px] transition-colors focus-within:border-cyan/40",
        className,
      )}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="size-[15px] shrink-0 text-t3">
        <circle cx="11" cy="11" r="7" />
        <path d="M21 21l-4-4" />
      </svg>
      <input
        value={value}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-transparent text-[13px] text-t1 outline-none placeholder:text-t3"
      />
      {value ? (
        <button
          onClick={() => onChange("")}
          aria-label="Clear search"
          className="text-t3 transition-colors hover:text-t1"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="size-[13px]">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      ) : null}
    </div>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[11.5px] font-medium text-t2">{label}</span>
      {children}
      {hint ? <span className="mt-1.5 block text-[10.5px] text-t3">{hint}</span> : null}
    </label>
  );
}

export function TextInput({
  value,
  onChange,
  placeholder,
  type = "text",
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  className?: string;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={cn(
        "glass w-full rounded-[11px] px-3.5 py-2.5 text-[13px] text-t1 outline-none transition-colors placeholder:text-t3 focus:border-cyan/45",
        className,
      )}
    />
  );
}

export function ProgressBar({
  value,
  tone = "brand",
  className,
  height = 8,
}: {
  value: number;
  tone?: "brand" | "amber" | "coral" | "cyan";
  className?: string;
  height?: number;
}) {
  const fills = {
    brand: "grad-brand",
    amber: "bg-amber",
    coral: "bg-coral",
    cyan: "bg-cyan",
  } as const;

  return (
    <div
      className={cn("w-full overflow-hidden rounded-full bg-white/[0.06]", className)}
      style={{ height }}
      role="progressbar"
      aria-valuenow={Math.round(value * 100)}
    >
      <motion.div
        className={cn("h-full rounded-full", fills[tone])}
        initial={{ width: 0 }}
        animate={{ width: `${Math.min(100, Math.max(0, value * 100))}%` }}
        transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
      />
    </div>
  );
}
