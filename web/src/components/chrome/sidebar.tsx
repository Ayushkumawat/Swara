"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "motion/react";
import { NAV } from "@/lib/nav";
import { useComplaints, useLiveCalls, useUsage } from "@/lib/api/hooks";
import { useLiveClock } from "@/components/ui/live";
import { cn, formatNumber } from "@/lib/utils";

export function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { data: live } = useLiveCalls();
  const { data: complaints } = useComplaints();

  const badges = {
    liveCalls: live?.length ?? 0,
    openComplaints: complaints?.filter((c) => c.stage !== "resolved").length ?? 0,
  };

  return (
    <div className="flex h-full flex-col gap-5 overflow-y-auto p-3">
      <Link
        href="/overview"
        onClick={onNavigate}
        className="flex items-center gap-2.5 px-2 pb-2.5 pt-1"
      >
        <motion.div
          whileHover={{ rotate: -8, scale: 1.06 }}
          transition={{ type: "spring", stiffness: 380, damping: 18 }}
          className="grad-brand flex size-8 items-center justify-center rounded-[9px] font-[family-name:var(--font-display)] text-[15px] font-bold text-void"
        >
          S
        </motion.div>
        <div>
          <div className="font-[family-name:var(--font-display)] text-base font-semibold text-t1">
            Swara
          </div>
          <div className="-mt-0.5 text-[10.5px] text-t3">Voice AI console</div>
        </div>
      </Link>

      {NAV.map((group) => (
        <div key={group.label}>
          <div className="mb-1.5 px-3 text-[10.5px] uppercase tracking-[0.08em] text-t3">
            {group.label}
          </div>
          <nav className="flex flex-col gap-0.5">
            {group.items.map((item) => {
              const active = pathname.startsWith(item.href);
              const count = item.badge ? badges[item.badge] : 0;
              const Icon = item.icon;

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={onNavigate}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "group relative flex items-center gap-2.5 rounded-[9px] px-3 py-2 text-[13.5px] font-medium transition-colors",
                    active ? "text-t1" : "text-t2 hover:bg-white/[0.045] hover:text-t1",
                  )}
                >
                  {active ? (
                    <motion.span
                      layoutId="nav-active"
                      className="absolute inset-0 rounded-[9px] border border-hairline bg-white/[0.07]"
                      transition={{ type: "spring", stiffness: 400, damping: 34 }}
                    />
                  ) : null}
                  <Icon
                    className={cn(
                      "relative z-10 size-[17px] shrink-0 transition-colors",
                      active ? "text-cyan" : "opacity-85",
                    )}
                    strokeWidth={1.6}
                  />
                  <span className="relative z-10 truncate">{item.label}</span>
                  {count > 0 ? (
                    <span
                      className={cn(
                        "relative z-10 ml-auto rounded-full border px-[7px] py-px font-[family-name:var(--font-mono)] text-[10px]",
                        item.badge === "openComplaints"
                          ? "border-coral/25 bg-coral/[0.16] text-coral"
                          : "border-cyan/25 bg-cyan/[0.14] text-cyan",
                      )}
                    >
                      {count}
                    </span>
                  ) : null}
                </Link>
              );
            })}
          </nav>
        </div>
      ))}

      <PlanFooter />
    </div>
  );
}

/**
 * Usage sits in the rail rather than only in Settings. Transparent pricing is
 * the wedge (project.md §1) — hiding consumption two clicks deep would be the
 * same opacity we are selling against.
 */
function PlanFooter() {
  const { data: usage } = useUsage();
  const now = useLiveClock(60_000);

  if (!usage) return <div className="skeleton mt-auto h-[74px] rounded-[14px]" />;

  const pct = Math.min(100, Math.round((usage.usedMinutes / usage.includedMinutes) * 100));
  const daysLeft = now
    ? Math.max(0, Math.ceil((new Date(usage.cycleEnd).getTime() - now) / 86_400_000))
    : null;
  // Overage is the moment a customer feels the pricing, so warn before it lands.
  const tone = pct >= 90 ? "text-amber" : pct >= 75 ? "text-t2" : "text-t3";

  return (
    <Link
      href="/settings"
      className="glass mt-auto rounded-[14px] p-3 transition-colors hover:bg-white/[0.07]"
    >
      <div className="flex items-center justify-between gap-2 text-[11.5px]">
        <span className="truncate font-medium text-t2">{usage.planLabel}</span>
        <span
          className={cn("font-[family-name:var(--font-mono)] text-[10.5px] shrink-0", tone)}
        >
          {pct}%
        </span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[0.07]">
        <motion.div
          className="h-full rounded-full grad-brand"
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 1, ease: [0.22, 1, 0.36, 1] }}
        />
      </div>
      <div className="mt-1.5 flex items-baseline justify-between gap-2 font-[family-name:var(--font-mono)] text-[10px] text-t3">
        <span className="truncate">
          {formatNumber(usage.usedMinutes)}/{formatNumber(usage.includedMinutes)} min
        </span>
        {daysLeft !== null ? <span className="shrink-0">{daysLeft}d left</span> : null}
      </div>
    </Link>
  );
}

export function Sidebar() {
  return (
    <aside className="sticky top-0 hidden h-screen w-[238px] shrink-0 border-r border-hairline bg-white/[0.02] backdrop-blur-[30px] lg:block">
      <SidebarContent />
    </aside>
  );
}
