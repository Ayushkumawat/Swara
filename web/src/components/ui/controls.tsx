"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { useMounted } from "@/lib/use-mounted";

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

/** A tick box with its label, for choices that are not on/off settings —
 *  "reach this person by: [x] Calls  [ ] Email". */
export function Checkbox({
  checked,
  onChange,
  label,
  hint,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn("group flex items-start gap-2.5 text-left outline-none", disabled && "cursor-not-allowed opacity-40")}
    >
      <span
        className={cn(
          "mt-px flex size-[18px] shrink-0 items-center justify-center rounded-[6px] border transition-colors group-focus-visible:border-cyan/60",
          checked ? "border-cyan bg-cyan/20" : "border-hairline bg-white/[0.04] group-hover:border-white/25",
        )}
      >
        {checked ? <Check className="size-3 text-cyan" strokeWidth={3} /> : null}
      </span>
      <span className="min-w-0">
        <span className="block text-[12.5px] font-medium text-t1">{label}</span>
        {hint ? <span className="mt-0.5 block text-[10.5px] leading-snug text-t3">{hint}</span> : null}
      </span>
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
  onSubmit,
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  className?: string;
  /** Enter key. Forms here are small enough that this replaces <form>. */
  onSubmit?: () => void;
  autoFocus?: boolean;
}) {
  return (
    <input
      type={type}
      value={value}
      autoFocus={autoFocus}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={onSubmit ? (e) => { if (e.key === "Enter") { e.preventDefault(); onSubmit(); } } : undefined}
      placeholder={placeholder}
      className={cn(
        "glass w-full rounded-[11px] px-3.5 py-2.5 text-[13px] text-t1 outline-none transition-colors placeholder:text-t3 focus:border-cyan/45",
        className,
      )}
    />
  );
}

/* ── Select ─────────────────────────────────────────────────────────────── */

export type SelectOption<T extends string> = {
  value: T;
  label: string;
  hint?: string;
  disabled?: boolean;
};

const EASE = [0.22, 1, 0.36, 1] as const;

/**
 * The dropdown. A native <select> pops the operating system's own list —
 * white, un-themed, and wrong on a dark console — so the list is ours: a
 * portal-mounted listbox positioned under the trigger, with the same glass
 * as every other surface, full keyboard support, and flip-to-above when the
 * viewport runs out below.
 */
export function Select<T extends string>({
  value,
  onChange,
  options,
  placeholder = "Choose…",
  className,
  disabled,
  size = "md",
  "aria-label": ariaLabel,
}: {
  value: T | "";
  onChange: (v: T) => void;
  options: readonly SelectOption<T>[];
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  size?: "sm" | "md";
  "aria-label"?: string;
}) {
  const id = useId();
  const reduce = useReducedMotion();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [pos, setPos] = useState<{ top: number; left: number; width: number; up: boolean } | null>(null);
  // Portals cannot be hydrated; mount the list container only on the client.
  const mounted = useMounted();

  const selected = options.find((o) => o.value === value);
  const enabled = options.map((o, i) => (o.disabled ? -1 : i)).filter((i) => i >= 0);

  const place = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const estimate = Math.min(options.length, 8) * 36 + 12;
    const below = window.innerHeight - r.bottom;
    const up = below < estimate + 12 && r.top > below;
    setPos({ top: up ? r.top - 6 : r.bottom + 6, left: r.left, width: r.width, up });
  }, [options.length]);

  // Opening is an event, so position and the highlighted row are computed
  // right there rather than in an effect that runs after the first paint.
  const openList = () => {
    if (disabled) return;
    place();
    const i = options.findIndex((o) => o.value === value);
    setActive(i >= 0 ? i : enabled[0] ?? -1);
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      const t = e.target as Node | null;
      if (triggerRef.current?.contains(t) || listRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onScroll = (e: Event) => {
      if (listRef.current?.contains(e.target as Node)) return;
      place();
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open, place]);

  useEffect(() => {
    if (!open || active < 0) return;
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  const commit = (i: number) => {
    const o = options[i];
    if (!o || o.disabled) return;
    onChange(o.value);
    setOpen(false);
    triggerRef.current?.focus();
  };

  const step = (dir: 1 | -1) => {
    if (!enabled.length) return;
    const at = enabled.indexOf(active);
    const next = at === -1 ? (dir === 1 ? enabled[0] : enabled[enabled.length - 1])
      : enabled[(at + dir + enabled.length) % enabled.length];
    setActive(next);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        if (!open) openList();
        else step(1);
        break;
      case "ArrowUp":
        e.preventDefault();
        if (!open) openList();
        else step(-1);
        break;
      case "Home":
        if (open) { e.preventDefault(); setActive(enabled[0] ?? -1); }
        break;
      case "End":
        if (open) { e.preventDefault(); setActive(enabled[enabled.length - 1] ?? -1); }
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        if (!open) openList();
        else commit(active);
        break;
      case "Escape":
        if (open) { e.preventDefault(); setOpen(false); }
        break;
      case "Tab":
        setOpen(false);
        break;
      default: {
        // Type-ahead: jump to the first option starting with the key.
        if (e.key.length === 1 && /\S/.test(e.key)) {
          const k = e.key.toLowerCase();
          const start = active + 1;
          const order = [...options.keys()].map((i) => (start + i) % options.length);
          const hit = order.find((i) => !options[i].disabled && options[i].label.toLowerCase().startsWith(k));
          if (hit !== undefined) {
            setActive(hit);
            if (!open) commit(hit);
          }
        }
      }
    }
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? `${id}-list` : undefined}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={onKeyDown}
        className={cn(
          "glass flex w-full items-center justify-between gap-2 rounded-[11px] text-left outline-none transition-colors",
          size === "sm" ? "px-3 py-1.5 text-[12px]" : "px-3.5 py-2.5 text-[13px]",
          open ? "border-cyan/45" : "focus-visible:border-cyan/45",
          disabled && "cursor-not-allowed opacity-50",
          className,
        )}
      >
        <span className={cn("min-w-0 truncate", selected ? "text-t1" : "text-t3")}>
          {selected?.label ?? placeholder}
        </span>
        <ChevronDown
          className={cn("size-3.5 shrink-0 text-t3 transition-transform duration-200", open && "rotate-180")}
          strokeWidth={2}
        />
      </button>

      {mounted
        ? createPortal(
            <AnimatePresence>
              {open && pos ? (
                <motion.div
                  ref={listRef}
                  id={`${id}-list`}
                  role="listbox"
                  aria-activedescendant={active >= 0 ? `${id}-opt-${active}` : undefined}
                  initial={reduce ? false : { opacity: 0, y: pos.up ? 4 : -4, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={reduce ? undefined : { opacity: 0, y: pos.up ? 4 : -4, scale: 0.98 }}
                  transition={{ duration: 0.16, ease: EASE }}
                  style={{
                    position: "fixed",
                    left: pos.left,
                    width: pos.width,
                    ...(pos.up ? { bottom: window.innerHeight - pos.top } : { top: pos.top }),
                    transformOrigin: pos.up ? "bottom center" : "top center",
                  }}
                  className="glass-popover z-[200] max-h-[300px] overflow-y-auto rounded-[12px] p-1"
                >
                  {options.length === 0 ? (
                    <div className="px-3 py-2.5 text-[12px] text-t3">Nothing to choose from yet</div>
                  ) : null}
                  {options.map((o, i) => {
                    const isSel = o.value === value;
                    const isActive = i === active;
                    return (
                      <div
                        key={o.value}
                        id={`${id}-opt-${i}`}
                        data-index={i}
                        role="option"
                        aria-selected={isSel}
                        aria-disabled={o.disabled}
                        onPointerMove={() => !o.disabled && active !== i && setActive(i)}
                        onClick={() => commit(i)}
                        className={cn(
                          "flex cursor-pointer items-center gap-2 rounded-[8px] px-2.5 py-2 text-[12.5px] transition-colors",
                          isActive ? "bg-white/[0.09] text-t1" : "text-t2",
                          o.disabled && "cursor-not-allowed opacity-40",
                        )}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate">{o.label}</span>
                          {o.hint ? <span className="block truncate text-[10.5px] text-t3">{o.hint}</span> : null}
                        </span>
                        {isSel ? <Check className="size-3.5 shrink-0 text-cyan" strokeWidth={2.2} /> : null}
                      </div>
                    );
                  })}
                </motion.div>
              ) : null}
            </AnimatePresence>,
            document.body,
          )
        : null}
    </>
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
