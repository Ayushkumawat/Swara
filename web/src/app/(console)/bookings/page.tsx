"use client";

import { useMemo, useState } from "react";
import { motion } from "motion/react";
import { toast } from "sonner";
import { AlertTriangle, BellRing, CalendarPlus, RefreshCw } from "lucide-react";
import { PageHead } from "@/components/chrome/page-head";
import { Card, CardHead, MetricCard } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/ui/pill";
import { MetricSkeleton, QueryBoundary, RowsSkeleton } from "@/components/ui/feedback";
import { ListRow, Mono } from "@/components/ui/table";
import { LazyMount, NumberTicker, Reveal, Stagger, StaggerItem } from "@/components/motion/primitives";
import { useBookings } from "@/lib/api/hooks";
import type { Booking } from "@/lib/api/schemas";
import { cn, maskPhone } from "@/lib/utils";
import { CalendarCheck, CalendarX2, Percent } from "lucide-react";

export default function BookingsPage() {
  const query = useBookings();
  const bookings = useMemo(
    () => [...(query.data ?? [])].sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
    [query.data],
  );

  const atRisk = bookings.filter((b) => b.noShowRisk >= 0.3);
  const avgRisk = bookings.reduce((s, b) => s + b.noShowRisk, 0) / (bookings.length || 1);
  const unconfirmed = bookings.filter((b) => b.status === "pending");

  return (
    <>
      <PageHead
        title="Bookings"
        sub="Live calendar availability, confirmations, and no-show risk"
        actions={
          <>
            <Button variant="ghost" onClick={() => toast.success("Calendar re-synced")}>
              <RefreshCw className="size-3.5" />
              Sync calendar
            </Button>
            <Button variant="primary" onClick={() => toast.success("Booking created")}>
              <CalendarPlus className="size-3.5" />
              New booking
            </Button>
          </>
        }
      />

      <QueryBoundary
        query={query}
        skeleton={
          <div className="mb-3.5 grid gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <MetricSkeleton key={i} />
            ))}
          </div>
        }
      >
        {() => (
          <Stagger className="mb-3.5 grid gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
            <StaggerItem>
              <MetricCard
                icon={<CalendarCheck strokeWidth={1.8} />}
                accent="violet"
                value={<NumberTicker value={bookings.length} />}
                label="Upcoming bookings"
              />
            </StaggerItem>
            <StaggerItem>
              <MetricCard
                icon={<AlertTriangle strokeWidth={1.8} />}
                accent="amber"
                value={<NumberTicker value={atRisk.length} />}
                label="At risk of no-show"
                footnote="≥30% predicted"
              />
            </StaggerItem>
            <StaggerItem>
              <MetricCard
                icon={<Percent strokeWidth={1.8} />}
                accent="cyan"
                value={<NumberTicker value={avgRisk * 100} decimals={0} suffix="%" />}
                label="Average no-show risk"
                trend="-4%"
              />
            </StaggerItem>
            <StaggerItem>
              <MetricCard
                icon={<CalendarX2 strokeWidth={1.8} />}
                accent="coral"
                value={<NumberTicker value={unconfirmed.length} />}
                label="Awaiting confirmation"
              />
            </StaggerItem>
          </Stagger>
        )}
      </QueryBoundary>

      <div className="grid gap-3.5 lg:grid-cols-[1fr_1.4fr]">
        <Reveal>
          <Card interactive={false} className="h-full">
            <CardHead
              title="Next up"
              sub="Risk is scored from past reschedules and confirmation response"
            />
            <QueryBoundary query={query} skeleton={<RowsSkeleton rows={5} />}>
              {() => (
                <div>
                  {bookings.slice(0, 6).map((b) => (
                    <BookingRow key={b.id} booking={b} />
                  ))}
                </div>
              )}
            </QueryBoundary>
          </Card>
        </Reveal>

        <Reveal delay={0.08}>
          <Card interactive={false} className="h-full">
            <CardHead
              title="This week"
              sub="Agents check this calendar live during a call before committing a slot"
            />
            <WeekCalendar bookings={bookings} />
          </Card>
        </Reveal>
      </div>

      <LazyMount className="mt-3.5">
        <Card interactive={false}>
          <CardHead
            title="Reminder automation"
            sub="A reminder call costs about ₹3 and recovers a slot worth far more"
          />
          <div className="grid gap-3 md:grid-cols-3">
            {[
              { when: "24 hours before", channel: "WhatsApp", state: "Active", tone: "cyan" as const },
              { when: "3 hours before", channel: "Voice call", state: "Active", tone: "cyan" as const },
              { when: "On high risk only", channel: "Voice call", state: "Suggested", tone: "amber" as const },
            ].map((r) => (
              <div key={r.when} className="glass rounded-[14px] p-3.5">
                <div className="mb-2 flex items-center justify-between">
                  <BellRing className="size-4 text-cyan" strokeWidth={1.7} />
                  <Pill tone={r.tone}>{r.state}</Pill>
                </div>
                <div className="text-[13px] font-medium text-t1">{r.when}</div>
                <div className="mt-0.5 text-[11.5px] text-t3">via {r.channel}</div>
              </div>
            ))}
          </div>
          <p className="mt-3.5 text-[11.5px] leading-relaxed text-t3">
            The third rule fires only when predicted risk crosses 30%, so you are not paying to
            remind customers who reliably show up. It is off by default until there is enough
            booking history per customer to score against.
          </p>
        </Card>
      </LazyMount>
    </>
  );
}

function BookingRow({ booking }: { booking: Booking }) {
  const risk = booking.noShowRisk;
  const tone = risk >= 0.4 ? "coral" : risk >= 0.25 ? "amber" : "cyan";
  const when = new Date(booking.startsAt);

  return (
    <ListRow>
      <span
        className={cn(
          "flex size-9 shrink-0 flex-col items-center justify-center rounded-[10px] font-[family-name:var(--font-mono)] leading-none",
          tone === "coral" ? "bg-coral/[0.14] text-coral" : tone === "amber" ? "bg-amber/[0.14] text-amber" : "bg-cyan/[0.12] text-cyan",
        )}
      >
        <span className="text-[11px] font-medium">
          {when.toLocaleTimeString("en-IN", { hour: "numeric", hour12: false })}
        </span>
        <span className="mt-px text-[8px] opacity-70">
          {when.toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
        </span>
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium text-t1">
          {booking.customerName}
        </span>
        <span className="block truncate text-[11px] text-t3">
          {booking.type} · {maskPhone(booking.phone)}
        </span>
      </span>
      <Pill tone={tone}>
        {risk < 0.25 ? "Low risk" : `No-show ${Math.round(risk * 100)}%`}
      </Pill>
    </ListRow>
  );
}

function WeekCalendar({ bookings }: { bookings: Booking[] }) {
  const [selected, setSelected] = useState<string | null>(null);

  const days = useMemo(() => {
    const today = new Date();
    const monday = new Date(today);
    monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      const key = d.toISOString().slice(0, 10);
      return {
        key,
        date: d,
        isToday: key === today.toISOString().slice(0, 10),
        items: bookings.filter((b) => b.startsAt.slice(0, 10) === key),
      };
    });
  }, [bookings]);

  const selectedDay = days.find((d) => d.key === selected);

  return (
    <>
      <div className="grid grid-cols-7 gap-1.5">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
          <div key={d} className="pb-1.5 text-center text-[11px] text-t3">
            {d}
          </div>
        ))}
        {days.map((d, i) => (
          <motion.button
            key={d.key}
            onClick={() => setSelected(selected === d.key ? null : d.key)}
            initial={{ opacity: 0, scale: 0.94 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: i * 0.04, duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
            whileHover={{ y: -2 }}
            className={cn(
              "flex aspect-[1/0.9] flex-col rounded-[10px] border p-1.5 text-left transition-colors",
              d.isToday ? "border-cyan/50" : "border-hairline",
              selected === d.key ? "bg-white/[0.09]" : "bg-white/[0.03] hover:bg-white/[0.06]",
            )}
          >
            <span
              className={cn(
                "font-[family-name:var(--font-mono)] text-[11px]",
                d.isToday ? "text-cyan" : "text-t2",
              )}
            >
              {d.date.getDate()}
            </span>
            {d.items.length > 0 ? (
              <span className="mt-1 rounded-[5px] bg-violet/[0.18] px-1.5 py-0.5 text-[9.5px] text-violet">
                {d.items.length} slot{d.items.length > 1 ? "s" : ""}
              </span>
            ) : null}
            {d.items.some((b) => b.noShowRisk >= 0.4) ? (
              <span className="mt-auto self-start rounded-[5px] bg-coral/[0.16] px-1.5 py-0.5 text-[9px] text-coral">
                risk
              </span>
            ) : null}
          </motion.button>
        ))}
      </div>

      {selectedDay ? (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          className="mt-4 overflow-hidden border-t border-hairline pt-3.5"
        >
          <div className="mb-2 text-[12px] font-medium text-t2">
            {selectedDay.date.toLocaleDateString("en-IN", {
              weekday: "long",
              day: "numeric",
              month: "long",
            })}
          </div>
          {selectedDay.items.length === 0 ? (
            <p className="text-[12px] text-t3">Nothing booked. Fully available.</p>
          ) : (
            selectedDay.items.map((b) => (
              <ListRow key={b.id}>
                <Mono className="w-12 shrink-0">
                  {new Date(b.startsAt).toLocaleTimeString("en-IN", {
                    hour: "2-digit",
                    minute: "2-digit",
                    hour12: false,
                  })}
                </Mono>
                <span className="min-w-0 flex-1 truncate text-[12.5px] text-t1">
                  {b.customerName} — {b.type}
                </span>
                <Pill tone={b.status === "confirmed" ? "cyan" : "amber"}>{b.status}</Pill>
              </ListRow>
            ))
          )}
        </motion.div>
      ) : null}
    </>
  );
}
