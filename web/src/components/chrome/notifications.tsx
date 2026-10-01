"use client";

import Link from "next/link";
import { useRef } from "react";
import { motion } from "motion/react";
import { Bell, X } from "lucide-react";
import { useNotifications } from "@/lib/api/hooks";
import { useUi } from "@/lib/ui-store";
import { IconButton } from "@/components/ui/button";
import { Pill, severityTone } from "@/components/ui/pill";
import { RowsSkeleton } from "@/components/ui/feedback";
import { AnchoredPopover } from "@/components/ui/popover";
import { relativeTime } from "@/lib/utils";

/**
 * Alert centre.
 *
 * Sentiment and SLA alerts are the RevComm-style pattern from §4.7 — they are
 * worthless if the owner has to be on the Complaints screen to see them, so
 * they surface globally with the unread count on the bell.
 */
export function NotificationCenter() {
  const open = useUi((s) => s.notificationsOpen);
  const setOpen = useUi((s) => s.setNotifications);
  const { data, isPending } = useNotifications();
  const anchor = useRef<HTMLSpanElement>(null);

  const unread = data?.filter((n) => !n.read).length ?? 0;

  return (
    <>
      <span ref={anchor} className="inline-flex">
        <IconButton title="Notifications" badge={unread} onClick={() => setOpen(!open)}>
          <Bell strokeWidth={1.6} />
        </IconButton>
      </span>

      <AnchoredPopover open={open} onClose={() => setOpen(false)} anchorRef={anchor} width={380} label="Alerts">
        <div className="flex items-center justify-between border-b border-hairline px-4 py-3">
          <span className="font-[family-name:var(--font-display)] text-[13.5px] font-semibold text-t1">
            Alerts
          </span>
          <button
            onClick={() => setOpen(false)}
            aria-label="Close alerts"
            className="text-t3 transition-colors hover:text-t1"
          >
            <X className="size-3.5" />
          </button>
        </div>

        <div className="max-h-[420px] overflow-y-auto p-2">
          {isPending ? (
            <div className="p-3">
              <RowsSkeleton rows={3} />
            </div>
          ) : (
            data?.map((n, i) => (
              <motion.div
                key={n.id}
                initial={{ opacity: 0, x: 8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.04, duration: 0.32 }}
              >
                <Link
                  href={n.href ?? "#"}
                  onClick={() => setOpen(false)}
                  className="flex gap-3 rounded-[12px] p-2.5 transition-colors hover:bg-white/[0.05]"
                >
                  <span
                    className={`mt-1.5 size-1.5 shrink-0 rounded-full ${n.read ? "bg-transparent" : "bg-cyan"}`}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-[12.5px] font-medium leading-snug text-t1">
                        {n.title}
                      </span>
                      <Pill tone={severityTone[n.severity]} className="shrink-0">
                        {n.severity}
                      </Pill>
                    </div>
                    <p className="mt-1 text-[11.5px] leading-snug text-t3">{n.body}</p>
                    <span className="mt-1 block font-[family-name:var(--font-mono)] text-[10px] text-t3">
                      {relativeTime(n.at)}
                    </span>
                  </div>
                </Link>
              </motion.div>
            ))
          )}
          {!isPending && !data?.length ? (
            <p className="px-3 py-6 text-center text-[12px] text-t3">Nothing needs you right now.</p>
          ) : null}
        </div>
      </AnchoredPopover>
    </>
  );
}
