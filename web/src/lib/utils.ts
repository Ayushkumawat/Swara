import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** 3847 → "3,847" using Indian digit grouping (38,47 style is wrong; en-IN handles it). */
export function formatNumber(n: number) {
  return new Intl.NumberFormat("en-IN").format(n);
}

/** 24999 → "₹24,999" */
export function formatRupees(n: number, opts?: { decimals?: number }) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: opts?.decimals ?? 0,
    maximumFractionDigits: opts?.decimals ?? 0,
  }).format(n);
}

/** 84 → "01:24". Call durations are shown in mono everywhere (project.md §3). */
export function formatDuration(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** "+919876542214" → "+91 98•• •• 2214". Masking is a privacy requirement on
 *  every monitoring surface, not a display preference. */
export function maskPhone(e164: string) {
  const digits = e164.replace(/\D/g, "");
  if (digits.length < 8) return e164;
  const cc = digits.slice(0, 2);
  const head = digits.slice(2, 4);
  const tail = digits.slice(-4);
  return `+${cc} ${head}•• •• ${tail}`;
}

export function relativeTime(iso: string, now = Date.now()) {
  const diff = now - new Date(iso).getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "yesterday" : `${days} days ago`;
}

export function initialsOf(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

export function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}
