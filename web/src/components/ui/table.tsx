"use client";

import { motion } from "motion/react";
import { cn } from "@/lib/utils";

export function Table({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className="-mx-1 overflow-x-auto px-1">
      <table className={cn("w-full border-collapse text-[13px]", className)}>
        {children}
      </table>
    </div>
  );
}

export function Th({
  children,
  className,
  align = "left",
}: {
  children?: React.ReactNode;
  className?: string;
  align?: "left" | "right" | "center";
}) {
  return (
    <th
      className={cn(
        "border-b border-hairline px-2.5 pb-2.5 text-[11px] font-medium uppercase tracking-[0.05em] text-t3",
        align === "right" && "text-right",
        align === "center" && "text-center",
        align === "left" && "text-left",
        className,
      )}
    >
      {children}
    </th>
  );
}

export function Td({
  children,
  className,
  align = "left",
  mono,
}: {
  children?: React.ReactNode;
  className?: string;
  align?: "left" | "right" | "center";
  mono?: boolean;
}) {
  return (
    <td
      className={cn(
        "border-b border-white/[0.04] px-2.5 py-3 text-t1",
        align === "right" && "text-right",
        align === "center" && "text-center",
        mono && "font-[family-name:var(--font-mono)] text-xs text-t2",
        className,
      )}
    >
      {children}
    </td>
  );
}

/** Rows fade in with a small stagger so a table landing after a fetch reads
 *  as data arriving rather than a flash of content. */
export function Tr({
  children,
  index = 0,
  onClick,
  className,
}: {
  children: React.ReactNode;
  index?: number;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <motion.tr
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: Math.min(index * 0.035, 0.4), ease: [0.22, 1, 0.36, 1] }}
      onClick={onClick}
      className={cn(
        "transition-colors last:[&>td]:border-b-0",
        onClick && "cursor-pointer hover:bg-white/[0.035]",
        className,
      )}
    >
      {children}
    </motion.tr>
  );
}

export function Mono({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "font-[family-name:var(--font-mono)] text-xs tabular-nums text-t2",
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Row separator list used in side panels (compliance, retry settings, etc). */
export function ListRow({
  children,
  className,
  onClick,
}: {
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className={cn(
        "flex items-center gap-3 border-b border-white/[0.05] py-2.5 last:border-b-0 last:pb-0",
        onClick && "cursor-pointer transition-colors hover:bg-white/[0.03]",
        className,
      )}
    >
      {children}
    </div>
  );
}
