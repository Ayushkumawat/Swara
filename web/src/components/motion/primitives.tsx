"use client";

import {
  AnimatePresence,
  motion,
  useInView,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
  type Variants,
} from "motion/react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * The motion vocabulary for the whole console.
 *
 * project.md §3 deferred motion until the layout was locked. Now that it is,
 * the rule these follow is: motion explains where something came from or that
 * it is alive, and never delays a user who already knows what they want.
 * Every primitive collapses to a no-op under prefers-reduced-motion.
 */

const EASE = [0.22, 1, 0.36, 1] as const;

/* ── Reveal on scroll ───────────────────────────────────────────────────── */

/**
 * Content must never be permanently invisible because an observer did not
 * fire. `useFailsafe` reveals anything still hidden after a beat, so a
 * missed IntersectionObserver callback costs an animation, not the content.
 */
function useFailsafe(active: boolean, ms = 700) {
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    if (!active || expired) return;
    const t = setTimeout(() => setExpired(true), ms);
    return () => clearTimeout(t);
  }, [active, expired, ms]);

  return expired;
}

export function Reveal({
  children,
  delay = 0,
  y = 14,
  className,
  once = true,
}: {
  children: React.ReactNode;
  delay?: number;
  y?: number;
  className?: string;
  once?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once, margin: "-40px 0px -40px 0px" });
  const reduce = useReducedMotion();
  const failsafe = useFailsafe(!inView);
  // A block that mounts *above* the viewport (the page was scrolled when the
  // route changed) will never intersect on its own. Reveal it immediately
  // rather than leaving a hole until the failsafe fires.
  const [above, setAbove] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (el.getBoundingClientRect().bottom < 0) setAbove(true);
  }, []);
  const show = inView || reduce || failsafe || above;

  return (
    <motion.div
      ref={ref}
      className={className}
      initial={reduce ? false : { opacity: 0, y }}
      animate={show ? { opacity: 1, y: 0 } : { opacity: 0, y }}
      transition={{ duration: 0.55, delay, ease: EASE }}
    >
      {children}
    </motion.div>
  );
}

/* ── Staggered groups ───────────────────────────────────────────────────── */

export const staggerParent: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.055, delayChildren: 0.04 } },
};

export const staggerChild: Variants = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: EASE } },
};

export function Stagger({
  children,
  className,
  as = "div",
}: {
  children: React.ReactNode;
  className?: string;
  as?: "div" | "ul" | "section";
}) {
  const reduce = useReducedMotion();
  const Comp = motion[as];
  return (
    <Comp
      className={className}
      variants={staggerParent}
      initial={reduce ? false : "hidden"}
      animate="show"
    >
      {children}
    </Comp>
  );
}

export function StaggerItem({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <motion.div className={className} variants={staggerChild}>
      {children}
    </motion.div>
  );
}

/* ── Animated numbers ───────────────────────────────────────────────────── */

/**
 * Counts up to `value` on mount and animates between values afterwards.
 * Used on every metric so a live number visibly changing reads as "this
 * updated" rather than silently swapping.
 */
export function NumberTicker({
  value,
  decimals = 0,
  prefix = "",
  suffix = "",
  format,
  className,
  duration = 1.1,
}: {
  value: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  format?: (n: number) => string;
  className?: string;
  duration?: number;
}) {
  const reduce = useReducedMotion();
  const mv = useMotionValue(reduce ? value : 0);
  const spring = useSpring(mv, { duration: duration * 1000, bounce: 0 });
  const text = useTransform(spring, (n) =>
    format
      ? format(n)
      : n.toLocaleString("en-IN", {
          minimumFractionDigits: decimals,
          maximumFractionDigits: decimals,
        }),
  );
  const [display, setDisplay] = useState(() =>
    format
      ? format(reduce ? value : 0)
      : (reduce ? value : 0).toLocaleString("en-IN", {
          minimumFractionDigits: decimals,
          maximumFractionDigits: decimals,
        }),
  );

  useEffect(() => {
    mv.set(value);
  }, [mv, value]);

  useEffect(() => text.on("change", setDisplay), [text]);

  return (
    <span className={className}>
      {prefix}
      {display}
      {suffix}
    </span>
  );
}

/* ── Deferred mounting ──────────────────────────────────────────────────── */

/**
 * Renders `placeholder` until the block scrolls near the viewport, then swaps
 * in the real children. Below-the-fold charts and long tables use this so the
 * first paint only pays for what is actually visible.
 */
export function LazyMount({
  children,
  placeholder,
  rootMargin = "220px",
  className,
}: {
  children: React.ReactNode;
  placeholder?: React.ReactNode;
  rootMargin?: string;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  const failsafe = useFailsafe(!shown, 2500);

  useEffect(() => {
    const el = ref.current;
    if (!el || shown) return;
    if (typeof IntersectionObserver === "undefined") {
      // Pre-2019 browsers: skip deferral entirely rather than never rendering.
      const t = setTimeout(() => setShown(true), 0);
      return () => clearTimeout(t);
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setShown(true);
          io.disconnect();
        }
      },
      { rootMargin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [rootMargin, shown]);

  return (
    <div ref={ref} className={className}>
      <AnimatePresence mode="wait" initial={false}>
        {shown || failsafe ? (
          <motion.div
            key="content"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.4, ease: EASE }}
          >
            {children}
          </motion.div>
        ) : (
          <div key="placeholder">{placeholder}</div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ── Pointer-tracked glow ───────────────────────────────────────────────── */

/**
 * Sets --mx/--my on the element so the `.lit-border` gradient follows the
 * cursor. Attached to cards; costs nothing when the pointer is elsewhere.
 */
export function useLitBorder<T extends HTMLElement>() {
  const ref = useRef<T>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(pointer: coarse)").matches) return;

    let frame = 0;
    const onMove = (e: PointerEvent) => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const r = el.getBoundingClientRect();
        el.style.setProperty("--mx", `${e.clientX - r.left}px`);
        el.style.setProperty("--my", `${e.clientY - r.top}px`);
      });
    };

    el.addEventListener("pointermove", onMove);
    return () => {
      el.removeEventListener("pointermove", onMove);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  return ref;
}

/* ── Page transition ────────────────────────────────────────────────────── */

/**
 * Route change = short cross-fade. The exit is deliberately brief: with
 * `mode="wait"` the new page cannot mount until the old one has left, so a
 * long exit reads as the console hesitating. Scroll resets to the top on
 * every change — the new page's content starts at the top, and leaving the
 * window scrolled to where the *previous* page was is what made sections
 * appear to load blank.
 */
export function PageTransition({
  children,
  routeKey,
}: {
  children: React.ReactNode;
  routeKey: string;
}) {
  const reduce = useReducedMotion();

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "instant" as ScrollBehavior });
  }, [routeKey]);

  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={routeKey}
        initial={reduce ? false : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0, transition: { duration: 0.28, ease: EASE } }}
        exit={reduce ? undefined : { opacity: 0, transition: { duration: 0.12, ease: "easeOut" } }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}

/* ── Ambient background ─────────────────────────────────────────────────── */

/**
 * The violet/cyan/amber glows. project.md §3 calls these load-bearing: glass
 * panels only read as glass when there is coloured light behind them. They
 * drift slowly so a static screenshot and a live screen look different.
 */
export function AmbientGlows({ variant = "console" }: { variant?: "console" | "marketing" }) {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
      <div
        className="absolute rounded-full blur-[110px] animate-[drift_22s_ease-in-out_infinite_alternate]"
        style={{
          width: 640,
          height: 640,
          top: -220,
          left: -160,
          background:
            "radial-gradient(circle, rgba(124,108,246,0.30), transparent 70%)",
        }}
      />
      <div
        className="absolute rounded-full blur-[110px] animate-[drift_28s_ease-in-out_infinite_alternate-reverse]"
        style={{
          width: 560,
          height: 560,
          top: variant === "marketing" ? 120 : 280,
          right: -200,
          background:
            "radial-gradient(circle, rgba(63,224,197,0.20), transparent 70%)",
        }}
      />
      <div
        className="absolute rounded-full blur-[110px] animate-[drift_34s_ease-in-out_infinite_alternate]"
        style={{
          width: 520,
          height: 520,
          bottom: -260,
          left: "38%",
          background:
            "radial-gradient(circle, rgba(245,166,43,0.13), transparent 70%)",
        }}
      />
      {variant === "marketing" && (
        <div
          className="absolute inset-0 opacity-[0.35]"
          style={{
            backgroundImage:
              "linear-gradient(rgba(255,255,255,0.025) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.025) 1px, transparent 1px)",
            backgroundSize: "64px 64px",
            maskImage:
              "radial-gradient(ellipse 80% 60% at 50% 0%, #000 40%, transparent 100%)",
          }}
        />
      )}
    </div>
  );
}

/* ── Small helpers ──────────────────────────────────────────────────────── */

export function FadeIn({
  children,
  delay = 0,
  className,
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
}) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={reduce ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.45, delay, ease: EASE }}
    >
      {children}
    </motion.div>
  );
}

export function Pressable({
  children,
  className,
  onClick,
  disabled,
  title,
  type = "button",
}: {
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
  disabled?: boolean;
  title?: string;
  type?: "button" | "submit";
}) {
  return (
    <motion.button
      type={type}
      title={title}
      disabled={disabled}
      onClick={onClick}
      whileHover={disabled ? undefined : { y: -1 }}
      whileTap={disabled ? undefined : { scale: 0.975 }}
      transition={{ duration: 0.18, ease: EASE }}
      className={cn(disabled && "cursor-not-allowed opacity-50", className)}
    >
      {children}
    </motion.button>
  );
}

export { motion, AnimatePresence, useReducedMotion };
