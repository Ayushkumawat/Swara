"use client";

import Link from "next/link";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "ghost" | "subtle" | "danger";
type Size = "sm" | "md" | "lg";

const base =
  "inline-flex items-center justify-center gap-2 rounded-[11px] font-medium whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-45 [&>svg]:size-[14px] [&>svg]:shrink-0";

const variants: Record<Variant, string> = {
  primary:
    "grad-brand text-void font-semibold shadow-[0_6px_24px_-8px_rgba(124,108,246,0.7)] hover:brightness-110",
  ghost: "glass text-t1 hover:bg-white/[0.085]",
  subtle: "text-t2 hover:text-t1 hover:bg-white/[0.05]",
  danger:
    "bg-coral/[0.14] text-coral border border-coral/25 hover:bg-coral/[0.2]",
};

const sizes: Record<Size, string> = {
  sm: "px-[11px] py-1.5 text-xs",
  md: "px-[15px] py-[9px] text-[13px]",
  lg: "px-5 py-3 text-sm",
};

export function Button({
  children,
  variant = "ghost",
  size = "md",
  className,
  onClick,
  disabled,
  type = "button",
  title,
  full,
}: {
  children: React.ReactNode;
  variant?: Variant;
  size?: Size;
  className?: string;
  onClick?: () => void;
  disabled?: boolean;
  type?: "button" | "submit";
  title?: string;
  full?: boolean;
}) {
  return (
    <motion.button
      type={type}
      title={title}
      disabled={disabled}
      onClick={onClick}
      whileHover={disabled ? undefined : { y: -1 }}
      whileTap={disabled ? undefined : { scale: 0.97 }}
      transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
      className={cn(base, variants[variant], sizes[size], full && "w-full", className)}
    >
      {children}
    </motion.button>
  );
}

export function ButtonLink({
  children,
  href,
  variant = "ghost",
  size = "md",
  className,
  full,
}: {
  children: React.ReactNode;
  href: string;
  variant?: Variant;
  size?: Size;
  className?: string;
  full?: boolean;
}) {
  return (
    <motion.div
      whileHover={{ y: -1 }}
      whileTap={{ scale: 0.97 }}
      transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
      className={cn("inline-flex", full && "w-full")}
    >
      <Link
        href={href}
        className={cn(base, variants[variant], sizes[size], full && "w-full", className)}
      >
        {children}
      </Link>
    </motion.div>
  );
}

export function IconButton({
  children,
  onClick,
  title,
  badge,
  className,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  title?: string;
  badge?: number;
  className?: string;
}) {
  return (
    <motion.button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      whileHover={{ y: -1 }}
      whileTap={{ scale: 0.94 }}
      transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
      className={cn(
        "glass relative flex size-[34px] items-center justify-center rounded-[10px] text-t2 transition-colors hover:text-t1 [&>svg]:size-4",
        className,
      )}
    >
      {children}
      {badge && badge > 0 ? (
        <span className="absolute -right-1 -top-1 flex min-w-[16px] items-center justify-center rounded-full bg-coral px-1 font-[family-name:var(--font-mono)] text-[9px] font-medium text-void">
          {badge > 9 ? "9+" : badge}
        </span>
      ) : null}
    </motion.button>
  );
}
