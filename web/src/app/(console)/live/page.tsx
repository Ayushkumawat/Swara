"use client";

import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { toast } from "sonner";
import { Headphones, PhoneForwarded, Radio, UserRoundPlus } from "lucide-react";
import { PageHead } from "@/components/chrome/page-head";
import { Card, CardHead } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { LiveDot, Pill } from "@/components/ui/pill";
import { Tabs } from "@/components/ui/controls";
import { CardSkeleton, EmptyState, QueryBoundary } from "@/components/ui/feedback";
import { CallDuration, SentimentMeter, Waveform } from "@/components/ui/live";
import { useLiveCalls } from "@/lib/api/hooks";
import { INTENT_LABEL, LANGUAGE_LABEL, type LiveCall } from "@/lib/api/schemas";
import { maskPhone } from "@/lib/utils";

type Filter = "all" | "frustrated" | "sales" | "support";

export default function LiveCallsPage() {
  const query = useLiveCalls();
  const [filter, setFilter] = useState<Filter>("all");
  const [listening, setListening] = useState<string | null>(null);

  const calls = useMemo(() => query.data ?? [], [query.data]);

  const counts = useMemo(
    () => ({
      all: calls.length,
      frustrated: calls.filter((c) => c.sentiment === "frustrated" || c.sentiment === "declining").length,
      sales: calls.filter((c) => c.intent === "sales_enquiry" || c.intent === "payment_reminder").length,
      support: calls.filter((c) =>
        ["order_status", "delivery_reschedule", "complaint", "booking"].includes(c.intent),
      ).length,
    }),
    [calls],
  );

  const filtered = useMemo(() => {
    if (filter === "all") return calls;
    if (filter === "frustrated")
      return calls.filter((c) => c.sentiment === "frustrated" || c.sentiment === "declining");
    if (filter === "sales")
      return calls.filter((c) => c.intent === "sales_enquiry" || c.intent === "payment_reminder");
    return calls.filter((c) =>
      ["order_status", "delivery_reschedule", "complaint", "booking"].includes(c.intent),
    );
  }, [calls, filter]);

  const needsAttention = calls.filter((c) => c.sentiment === "frustrated");

  return (
    <>
      <PageHead
        title="Live calls"
        sub={`${calls.length} active · real-time monitoring, listen-in, and transfer`}
        actions={
          <Button variant="ghost" onClick={() => query.refetch()}>
            <Radio className="size-3.5" />
            Refresh
          </Button>
        }
      />

      {/* Frustrated calls get pulled out of the grid entirely. On a wall of
          equal cards the one that needs a human is the one you miss. */}
      <AnimatePresence>
        {needsAttention.length > 0 ? (
          <motion.div
            initial={{ opacity: 0, y: -8, height: 0 }}
            animate={{ opacity: 1, y: 0, height: "auto" }}
            exit={{ opacity: 0, y: -8, height: 0 }}
            className="mb-3.5 overflow-hidden"
          >
            <div className="flex flex-wrap items-center gap-3 rounded-[18px] border border-coral/25 bg-coral/[0.09] px-4 py-3">
              <LiveDot tone="coral" />
              <span className="flex-1 text-[13px] text-t1">
                <span className="font-medium">{needsAttention.length} caller</span>
                {needsAttention.length > 1 ? "s are" : " is"} frustrated right now — sentiment
                dropped below 0.30 mid-call.
              </span>
              <Button size="sm" variant="danger" onClick={() => setFilter("frustrated")}>
                Show them
              </Button>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <Tabs
        className="mb-4"
        value={filter}
        onChange={setFilter}
        tabs={[
          { value: "all", label: "All", count: counts.all },
          { value: "frustrated", label: "Needs attention", count: counts.frustrated },
          { value: "sales", label: "Sales", count: counts.sales },
          { value: "support", label: "Support", count: counts.support },
        ]}
      />

      <QueryBoundary
        query={query}
        skeleton={
          <div className="grid gap-3.5 md:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <CardSkeleton key={i} height={230} />
            ))}
          </div>
        }
      >
        {() =>
          filtered.length === 0 ? (
            <Card interactive={false}>
              <EmptyState
                icon={<Radio strokeWidth={1.6} />}
                title="No calls in this view"
                body="Nothing matches this filter right now. Live calls appear here the moment they connect."
              />
            </Card>
          ) : (
            <motion.div layout className="grid gap-3.5 md:grid-cols-2 xl:grid-cols-3">
              <AnimatePresence mode="popLayout">
                {filtered.map((c) => (
                  <CallCard
                    key={c.id}
                    call={c}
                    listening={listening === c.id}
                    onListen={() => {
                      const next = listening === c.id ? null : c.id;
                      setListening(next);
                      if (next)
                        toast("Listening in", {
                          description: "The caller and agent cannot hear you.",
                        });
                    }}
                  />
                ))}
              </AnimatePresence>
            </motion.div>
          )
        }
      </QueryBoundary>

      <Card interactive={false} className="mt-3.5">
        <CardHead
          title="What supervisors can do mid-call"
          sub="Listen is passive. Take over and transfer both bridge a human onto the live leg."
        />
        <div className="grid gap-3 sm:grid-cols-3">
          {[
            {
              icon: Headphones,
              title: "Listen",
              body: "Silent monitor. Neither party hears you; used for spot-checking quality.",
            },
            {
              icon: UserRoundPlus,
              title: "Take over",
              body: "You replace the agent on the call. The transcript so far is handed to you first.",
            },
            {
              icon: PhoneForwarded,
              title: "Transfer",
              body: "Warm transfer to a teammate with the conversation summary attached.",
            },
          ].map((x) => (
            <div key={x.title} className="glass rounded-[14px] p-3.5">
              <x.icon className="mb-2 size-4 text-cyan" strokeWidth={1.7} />
              <div className="text-[12.5px] font-medium text-t1">{x.title}</div>
              <p className="mt-1 text-[11.5px] leading-snug text-t3">{x.body}</p>
            </div>
          ))}
        </div>
      </Card>
    </>
  );
}

function CallCard({
  call,
  listening,
  onListen,
}: {
  call: LiveCall;
  listening: boolean;
  onListen: () => void;
}) {
  const hot = call.sentiment === "frustrated";
  const warm = call.sentiment === "declining";
  const tone = hot ? "coral" : warm ? "amber" : "cyan";

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
    >
      <Card
        interactive={false}
        className={hot ? "border-coral/30 bg-coral/[0.06]" : undefined}
      >
        <div className="mb-2.5 flex items-center justify-between gap-2">
          <span className="font-[family-name:var(--font-mono)] text-xs text-t1">
            {maskPhone(call.phone)}
          </span>
          <div className="flex items-center gap-2">
            <Pill tone={call.direction === "inbound" ? "violet" : "grey"}>{call.direction}</Pill>
            <LiveDot tone={tone} />
          </div>
        </div>

        <div className="mb-1 text-[12.5px] text-t2">
          {INTENT_LABEL[call.intent]} · {LANGUAGE_LABEL[call.language]} ·{" "}
          <CallDuration startedAt={call.startedAt} className="text-t1" />
        </div>
        <div className="mb-3 text-[11.5px] text-t3">
          {call.customerName ?? "Unknown caller"} · {call.agentName}
        </div>

        <Waveform bars={9} tone={tone} height={22} className="mb-3" />

        <SentimentMeter score={call.sentimentScore} sentiment={call.sentiment} className="mb-3" />

        {call.transcriptPreview ? (
          <p className="mb-3 line-clamp-2 rounded-[10px] bg-white/[0.04] px-2.5 py-2 text-[11.5px] italic leading-snug text-t3">
            {call.transcriptPreview}
          </p>
        ) : null}

        <div className="flex gap-2">
          <Button
            size="sm"
            variant={listening ? "primary" : "ghost"}
            className="flex-1"
            onClick={onListen}
          >
            <Headphones className="size-3.5" />
            {listening ? "Listening" : "Listen"}
          </Button>
          {hot ? (
            <Button
              size="sm"
              variant="danger"
              className="flex-1"
              onClick={() => toast.success("Bridging you onto the call…")}
            >
              Take over
            </Button>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              className="flex-1"
              onClick={() => toast.success("Warm transfer started")}
            >
              Transfer
            </Button>
          )}
        </div>
      </Card>
    </motion.div>
  );
}
