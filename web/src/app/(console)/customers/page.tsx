"use client";

import { useMemo, useState } from "react";
import { motion } from "motion/react";
import {
  CalendarCheck,
  Mail,
  MessageCircle,
  MessageSquare,
  Package,
  PhoneCall,
  ShieldAlert,
} from "lucide-react";
import { PageHead } from "@/components/chrome/page-head";
import { Card, CardHead } from "@/components/ui/card";
import { Pill, sentimentTone } from "@/components/ui/pill";
import { SearchInput } from "@/components/ui/controls";
import { CardSkeleton, QueryBoundary, RowsSkeleton } from "@/components/ui/feedback";
import { Mono } from "@/components/ui/table";
import { Reveal } from "@/components/motion/primitives";
import { useCustomers } from "@/lib/api/hooks";
import { LANGUAGE_LABEL, type Customer, type TimelineEvent } from "@/lib/api/schemas";
import { cn, formatRupees, initialsOf, maskPhone, relativeTime } from "@/lib/utils";

const CHANNEL_ICON = {
  call: PhoneCall,
  whatsapp: MessageCircle,
  sms: MessageSquare,
  email: Mail,
  order: Package,
  booking: CalendarCheck,
  complaint: ShieldAlert,
} as const;

const CHANNEL_TONE = {
  call: "text-cyan",
  whatsapp: "text-cyan",
  sms: "text-violet",
  email: "text-violet",
  order: "text-amber",
  booking: "text-cyan",
  complaint: "text-coral",
} as const;

export default function CustomersPage() {
  const query = useCustomers();
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const list = query.data ?? [];
    if (!search.trim()) return list;
    const q = search.toLowerCase();
    return list.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.phone.includes(q) ||
        c.city.toLowerCase().includes(q) ||
        c.tags.some((t) => t.toLowerCase().includes(q)),
    );
  }, [query.data, search]);

  const selected = filtered.find((c) => c.id === selectedId) ?? filtered[0] ?? null;

  return (
    <>
      <PageHead
        title="Customer 360"
        sub="Every channel, one timeline — call, WhatsApp, SMS, and order history together"
      />

      <div className="grid gap-3.5 lg:grid-cols-[320px_1fr]">
        <Reveal>
          <Card interactive={false} className="lg:sticky lg:top-[76px]">
            <SearchInput
              value={search}
              onChange={setSearch}
              placeholder="Name, phone, city or tag…"
              className="mb-3.5"
            />
            <QueryBoundary query={query} skeleton={<RowsSkeleton rows={5} />}>
              {() =>
                filtered.length === 0 ? (
                  <p className="py-8 text-center text-[12.5px] text-t3">
                    No customer matches “{search}”.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {filtered.map((c) => (
                      <button
                        key={c.id}
                        onClick={() => setSelectedId(c.id)}
                        className={cn(
                          "flex w-full items-center gap-3 rounded-[14px] border p-3 text-left transition-colors",
                          selected?.id === c.id
                            ? "border-cyan/35 bg-white/[0.075]"
                            : "border-hairline bg-white/[0.04] hover:bg-white/[0.07]",
                        )}
                      >
                        <span className="grad-brand flex size-9 shrink-0 items-center justify-center rounded-[10px] font-[family-name:var(--font-display)] text-[12px] font-semibold text-void">
                          {initialsOf(c.name)}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] font-medium text-t1">
                            {c.name}
                          </span>
                          <span className="block truncate text-[11px] text-t3">
                            {c.lastChannel} · {relativeTime(c.lastContactAt)}
                          </span>
                        </span>
                        <Pill tone={sentimentTone[c.sentiment]} dot>
                          {c.sentiment}
                        </Pill>
                      </button>
                    ))}
                  </div>
                )
              }
            </QueryBoundary>
          </Card>
        </Reveal>

        <Reveal delay={0.08}>
          <QueryBoundary query={query} skeleton={<CardSkeleton height={520} />}>
            {() => (selected ? <CustomerDetail customer={selected} /> : <CardSkeleton height={520} />)}
          </QueryBoundary>
        </Reveal>
      </div>
    </>
  );
}

function CustomerDetail({ customer }: { customer: Customer }) {
  return (
    <div className="space-y-3.5">
      <Card interactive={false}>
        <div className="flex flex-wrap items-start gap-4">
          <span className="grad-brand flex size-12 shrink-0 items-center justify-center rounded-[14px] font-[family-name:var(--font-display)] text-[16px] font-semibold text-void">
            {initialsOf(customer.name)}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-[family-name:var(--font-display)] text-lg font-semibold text-t1">
                {customer.name}
              </h2>
              <Pill tone={sentimentTone[customer.sentiment]}>{customer.sentiment}</Pill>
              {customer.tags.map((t) => (
                <Pill key={t} tone="grey">
                  {t}
                </Pill>
              ))}
            </div>
            <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11.5px] text-t3">
              <Mono>{maskPhone(customer.phone)}</Mono>
              <span>{customer.city}</span>
              <span>Prefers {LANGUAGE_LABEL[customer.preferredLanguage]}</span>
              <span>
                Customer since{" "}
                {new Date(customer.since).toLocaleDateString("en-IN", {
                  month: "long",
                  year: "numeric",
                })}
              </span>
            </div>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 border-t border-hairline pt-4 sm:grid-cols-4">
          <Stat label="Orders" value={String(customer.orders)} />
          <Stat label="Lifetime value" value={formatRupees(customer.lifetimeValueInr)} />
          <Stat label="Interactions" value={String(customer.timeline.length)} />
          <Stat label="Last contact" value={relativeTime(customer.lastContactAt)} />
        </div>
      </Card>

      {/* This unified record is what the agent's data-pull nodes read from, so
          the agent already knows the last three orders before saying hello. */}
      <Card interactive={false}>
        <CardHead
          title="Unified timeline"
          sub="Phone number is the identity key — calls, messages and orders resolve to one person"
        />
        <div className="relative pl-6">
          <div className="absolute bottom-1 left-[5px] top-1 w-px bg-hairline" />
          {customer.timeline.map((e, i) => (
            <TimelineRow key={e.id} event={e} index={i} />
          ))}
        </div>
      </Card>
    </div>
  );
}

function TimelineRow({ event, index }: { event: TimelineEvent; index: number }) {
  const Icon = CHANNEL_ICON[event.kind];

  return (
    <motion.div
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.06, duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      className="relative pb-5 last:pb-0"
    >
      <span className="absolute -left-6 top-0.5 flex size-[11px] items-center justify-center rounded-full border-2 border-void bg-cyan" />
      <div className="flex flex-wrap items-baseline gap-2">
        <Icon className={cn("size-3.5 shrink-0", CHANNEL_TONE[event.kind])} strokeWidth={1.8} />
        <span className="text-[12.5px] font-medium text-t1">{event.title}</span>
        {event.amountInr ? (
          <Mono className="text-amber">{formatRupees(event.amountInr)}</Mono>
        ) : null}
      </div>
      {event.detail ? (
        <div className="mt-1 text-[11.5px] text-t2">{event.detail}</div>
      ) : null}
      <Mono className="mt-1 block text-[10.5px]">{relativeTime(event.at)}</Mono>
    </motion.div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="font-[family-name:var(--font-display)] text-[17px] font-semibold text-t1">
        {value}
      </div>
      <div className="mt-0.5 text-[11px] text-t3">{label}</div>
    </div>
  );
}
