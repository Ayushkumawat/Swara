"use client";

import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { CalendarRange, Download } from "lucide-react";
import { PageHead } from "@/components/chrome/page-head";
import { Card, CardHead } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/ui/pill";
import { ProgressBar, Tabs } from "@/components/ui/controls";
import {
  CardSkeleton,
  ChartSkeleton,
  MetricSkeleton,
  QueryBoundary,
  RowsSkeleton,
} from "@/components/ui/feedback";
import { Mono, Table, Td, Th, Tr } from "@/components/ui/table";
import { LazyMount, NumberTicker, Reveal, Stagger, StaggerItem } from "@/components/motion/primitives";
import { useAnalytics } from "@/lib/api/hooks";
import { INTENT_LABEL } from "@/lib/api/schemas";
import { cn, formatDuration, maskPhone } from "@/lib/utils";

const TrendArea = dynamic(() => import("@/components/viz/charts").then((m) => m.TrendArea), {
  loading: () => <ChartSkeleton height={130} />,
});
const StackedCostBars = dynamic(
  () => import("@/components/viz/charts").then((m) => m.StackedCostBars),
  { loading: () => <ChartSkeleton height={130} /> },
);
const Gauge = dynamic(() => import("@/components/viz/charts").then((m) => m.Gauge), {
  loading: () => <div className="size-24 skeleton rounded-full" />,
});

type Range = "7d" | "30d" | "90d";

export default function AnalyticsPage() {
  const query = useAnalytics();
  const [range, setRange] = useState<Range>("30d");
  const [qaFilter, setQaFilter] = useState<"all" | "flagged">("all");

  const scored = useMemo(() => {
    const rows = query.data?.scoredCalls ?? [];
    return qaFilter === "flagged" ? rows.filter((r) => r.qaFlag) : rows;
  }, [query.data, qaFilter]);

  const days = range === "7d" ? 7 : range === "30d" ? 30 : 30;

  return (
    <>
      <PageHead
        title="Analytics"
        sub="Call quality, cost, and outcome reporting"
        actions={
          <>
            <Tabs
              size="sm"
              value={range}
              onChange={setRange}
              tabs={[
                { value: "7d", label: "7 days" },
                { value: "30d", label: "30 days" },
                { value: "90d", label: "90 days" },
              ]}
            />
            <Button variant="ghost" onClick={() => toast("Date picker coming next")}>
              <CalendarRange className="size-3.5" />
              Custom
            </Button>
            <Button variant="ghost" onClick={() => toast.success("CSV export queued")}>
              <Download className="size-3.5" />
              Export
            </Button>
          </>
        }
      />

      <QueryBoundary
        query={query}
        skeleton={
          <div className="mb-3.5 grid gap-3.5 sm:grid-cols-2 xl:grid-cols-5">
            {Array.from({ length: 5 }).map((_, i) => (
              <MetricSkeleton key={i} />
            ))}
          </div>
        }
      >
        {(d) => (
          <Stagger className="mb-3.5 grid gap-3.5 sm:grid-cols-2 xl:grid-cols-5">
            <StaggerItem>
              <Kpi
                value={formatDuration(d.avgHandleSec)}
                label="Avg handle time"
                delta={d.deltas.avgHandleSec}
                lowerIsBetter
              />
            </StaggerItem>
            <StaggerItem>
              <Kpi
                value={<NumberTicker value={d.containmentRate * 100} decimals={0} suffix="%" />}
                label="Containment rate"
                delta={d.deltas.containmentRate}
              />
            </StaggerItem>
            <StaggerItem>
              <Kpi
                value={<NumberTicker value={d.escalationRate * 100} decimals={0} suffix="%" />}
                label="Escalation rate"
                delta={d.deltas.escalationRate}
                lowerIsBetter
              />
            </StaggerItem>
            <StaggerItem>
              <Kpi
                value={<NumberTicker value={d.csat} decimals={1} />}
                label="CSAT (of 5)"
                delta={d.deltas.csat}
              />
            </StaggerItem>
            <StaggerItem>
              {/* No competitor researched shows the customer their own unit
                  economics (§4.5). It only works if the number is real. */}
              <Kpi
                value={
                  <NumberTicker
                    value={d.costPerCallInr}
                    decimals={2}
                    format={(n) => `₹${n.toFixed(2)}`}
                  />
                }
                label="Cost per call"
                delta={d.deltas.costPerCallInr}
                lowerIsBetter
                highlight
              />
            </StaggerItem>
          </Stagger>
        )}
      </QueryBoundary>

      <div className="mb-3.5 grid gap-3.5 lg:grid-cols-[1.4fr_1fr]">
        <Reveal>
          <Card interactive={false} className="h-full">
            <CardHead title="CSAT trend" sub={`Last ${days} days`} />
            <QueryBoundary query={query} skeleton={<ChartSkeleton height={130} />}>
              {(d) => (
                <TrendArea
                  data={d.csatTrend.slice(-days)}
                  tone="cyan"
                  valueFormat={(v) => v.toFixed(2)}
                />
              )}
            </QueryBoundary>
          </Card>
        </Reveal>

        <Reveal delay={0.08}>
          <Card interactive={false} className="h-full">
            <CardHead title="Outcome mix" sub="Where calls actually end up" />
            <QueryBoundary query={query} skeleton={<RowsSkeleton rows={5} />}>
              {(d) => {
                const total = d.outcomeMix.reduce((s, o) => s + o.count, 0);
                return (
                  <div className="flex items-center gap-5">
                    <Gauge value={d.containmentRate} label="contained" size={96} />
                    <div className="min-w-0 flex-1 space-y-2.5">
                      {d.outcomeMix.map((o) => (
                        <div key={o.outcome}>
                          <div className="mb-1 flex items-baseline justify-between gap-2">
                            <span className="truncate text-[11.5px] text-t2">{o.outcome}</span>
                            <Mono className="text-[10.5px]">
                              {Math.round((o.count / total) * 100)}%
                            </Mono>
                          </div>
                          <ProgressBar
                            value={o.count / total}
                            height={3}
                            tone={o.outcome.includes("Resolved") ? "cyan" : "brand"}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                );
              }}
            </QueryBoundary>
          </Card>
        </Reveal>
      </div>

      <LazyMount className="mb-3.5" placeholder={<CardSkeleton height={230} />}>
        <Card interactive={false}>
          <CardHead
            title="Cost per minute, broken out"
            sub="AI compute is self-hosted, so this is your real marginal cost — not a reseller markup"
          />
          <QueryBoundary query={query} skeleton={<ChartSkeleton height={130} />}>
            {(d) => (
              <>
                <StackedCostBars data={d.costTrend.slice(-days)} />
                <div className="mt-4 flex flex-wrap gap-5 border-t border-white/[0.05] pt-3.5">
                  <Legend color="rgba(124,108,246,0.7)" label="AI compute (self-hosted)" />
                  <Legend color="rgba(245,166,43,0.6)" label="Telephony" />
                  <span className="ml-auto text-[11.5px] text-t3">
                    Planning target is ₹3.00/min total
                  </span>
                </div>
              </>
            )}
          </QueryBoundary>
        </Card>
      </LazyMount>

      <LazyMount placeholder={<CardSkeleton height={380} />}>
        <Card interactive={false}>
          <CardHead
            title="Automated call scoring"
            sub="Rubric-based QA run against every transcript — no manual review queue"
            action={
              <Tabs
                size="sm"
                value={qaFilter}
                onChange={setQaFilter}
                tabs={[
                  { value: "all", label: "All" },
                  { value: "flagged", label: "Flagged only" },
                ]}
              />
            }
          />
          <QueryBoundary query={query} skeleton={<RowsSkeleton rows={6} />}>
            {() => (
              <Table>
                <thead>
                  <tr>
                    <Th>Call</Th>
                    <Th>Caller</Th>
                    <Th>Agent</Th>
                    <Th>Intent</Th>
                    <Th align="right">Duration</Th>
                    <Th align="right">Cost</Th>
                    <Th align="right">QA score</Th>
                    <Th align="right">Flag</Th>
                  </tr>
                </thead>
                <tbody>
                  {scored.slice(0, 14).map((c, i) => (
                    <Tr key={c.id} index={i}>
                      <Td mono>#{c.id}</Td>
                      <Td mono>{maskPhone(c.phone)}</Td>
                      <Td className="text-t2">{c.agentName}</Td>
                      <Td className="text-t2">{INTENT_LABEL[c.intent]}</Td>
                      <Td align="right" mono>
                        {formatDuration(c.durationSec)}
                      </Td>
                      <Td align="right" mono>
                        ₹{c.costInr.toFixed(2)}
                      </Td>
                      <Td align="right">
                        <span
                          className={cn(
                            "font-[family-name:var(--font-mono)] text-xs",
                            (c.qaScore ?? 0) >= 85
                              ? "text-cyan"
                              : (c.qaScore ?? 0) >= 70
                                ? "text-amber"
                                : "text-coral",
                          )}
                        >
                          {c.qaScore}/100
                        </span>
                      </Td>
                      <Td align="right">
                        {c.qaFlag ? (
                          <Pill tone={(c.qaScore ?? 0) < 70 ? "coral" : "amber"}>{c.qaFlag}</Pill>
                        ) : (
                          <Pill tone="cyan">Clean</Pill>
                        )}
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
          </QueryBoundary>
        </Card>
      </LazyMount>
    </>
  );
}

function Kpi({
  value,
  label,
  delta,
  lowerIsBetter,
  highlight,
}: {
  value: React.ReactNode;
  label: string;
  delta: number;
  lowerIsBetter?: boolean;
  highlight?: boolean;
}) {
  const improved = lowerIsBetter ? delta < 0 : delta > 0;
  const pct = `${delta > 0 ? "+" : ""}${(delta * 100).toFixed(1)}%`;

  return (
    <Card className={cn("p-[18px]", highlight && "border-cyan/25 bg-cyan/[0.05]")}>
      <div className="font-[family-name:var(--font-display)] text-2xl font-semibold text-t1">
        {value}
      </div>
      <div className="mt-1 flex items-baseline justify-between gap-2">
        <span className="text-xs text-t2">{label}</span>
        <span
          className={cn(
            "font-[family-name:var(--font-mono)] text-[11px]",
            improved ? "text-cyan" : "text-coral",
          )}
        >
          {pct}
        </span>
      </div>
    </Card>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5 text-[11.5px] text-t2">
      <span className="size-2 rounded-full" style={{ background: color }} />
      {label}
    </span>
  );
}
