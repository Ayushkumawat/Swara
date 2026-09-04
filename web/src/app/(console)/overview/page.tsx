"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  CheckCircle2,
  Clock,
  PhoneCall,
  ShieldAlert,
  TrendingUp,
} from "lucide-react";
import { PageHead } from "@/components/chrome/page-head";
import { CopilotBar } from "@/components/chrome/copilot";
import { Card, CardHead, MetricCard } from "@/components/ui/card";
import { ButtonLink } from "@/components/ui/button";
import { LiveDot, Pill, sentimentTone } from "@/components/ui/pill";
import {
  CardSkeleton,
  ChartSkeleton,
  MetricSkeleton,
  QueryBoundary,
  RowsSkeleton,
} from "@/components/ui/feedback";
import { CallDuration, Waveform } from "@/components/ui/live";
import { ListRow } from "@/components/ui/table";
import { LazyMount, NumberTicker, Reveal, Stagger, StaggerItem } from "@/components/motion/primitives";
import { useLiveCalls, useOverview, useUsage } from "@/lib/api/hooks";
import { INTENT_LABEL, LANGUAGE_LABEL } from "@/lib/api/schemas";
import { formatRupees, maskPhone } from "@/lib/utils";

// Charts sit below the fold and pull the SVG/motion path code with them.
const VolumeBars = dynamic(() => import("@/components/viz/charts").then((m) => m.VolumeBars), {
  loading: () => <ChartSkeleton height={150} />,
});
const ShareBar = dynamic(() => import("@/components/viz/charts").then((m) => m.ShareBar), {
  loading: () => <ChartSkeleton height={40} />,
});

export default function OverviewPage() {
  const router = useRouter();
  const overview = useOverview();
  const live = useLiveCalls();
  const usage = useUsage();

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  return (
    <>
      <PageHead
        title={`${greeting}, Rohan`}
        sub={`Here's how your agents are performing today, ${new Date().toLocaleDateString("en-IN", { day: "numeric", month: "short" })}`}
        actions={
          <>
            <ButtonLink href="/campaigns?new=1" variant="ghost">
              New campaign
            </ButtonLink>
            <ButtonLink href="/agents?new=1" variant="primary">
              New agent
            </ButtonLink>
          </>
        }
      />

      <QueryBoundary
        query={overview}
        skeleton={
          <div className="mb-3.5 grid gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <MetricSkeleton key={i} />
            ))}
          </div>
        }
      >
        {(d) => (
          <Stagger className="mb-3.5 grid gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
            <StaggerItem>
              <MetricCard
                icon={<PhoneCall strokeWidth={1.8} />}
                accent="violet"
                value={<NumberTicker value={d.callsToday} />}
                label="Calls handled today"
                trend={`+${Math.round(d.callsTodayDelta * 100)}%`}
                onClick={() => router.push("/analytics")}
              />
            </StaggerItem>
            <StaggerItem>
              <MetricCard
                icon={<Clock strokeWidth={1.8} />}
                accent="cyan"
                value={<NumberTicker value={d.minutesUsed} />}
                label="Minutes used this cycle"
                trend={`+${Math.round(d.minutesDelta * 100)}%`}
                footnote={
                  usage.data
                    ? `${Math.round((usage.data.usedMinutes / usage.data.includedMinutes) * 100)}% of ${usage.data.includedMinutes.toLocaleString("en-IN")} included`
                    : undefined
                }
                onClick={() => router.push("/settings")}
              />
            </StaggerItem>
            <StaggerItem>
              <MetricCard
                icon={<CheckCircle2 strokeWidth={1.8} />}
                accent="amber"
                value={<NumberTicker value={d.resolutionRate * 100} decimals={1} suffix="%" />}
                label="Resolution rate"
                trend={`+${(d.resolutionDelta * 100).toFixed(1)}%`}
                onClick={() => router.push("/analytics")}
              />
            </StaggerItem>
            <StaggerItem>
              {/* Complaints live on the home screen deliberately (§4.1) — no
                  competitor surfaces them this prominently. */}
              <MetricCard
                icon={<ShieldAlert strokeWidth={1.8} />}
                accent="coral"
                value={<NumberTicker value={d.openComplaints} />}
                label="Open complaints"
                trend={`${d.complaintsDelta}`}
                trendTone={d.complaintsDelta < 0 ? "up" : "down"}
                footnote="1 past SLA — needs you today"
                onClick={() => router.push("/complaints")}
              />
            </StaggerItem>
          </Stagger>
        )}
      </QueryBoundary>

      <div className="mb-3.5 grid gap-3.5 lg:grid-cols-[1.5fr_1fr]">
        <Reveal>
          <Card interactive={false} className="h-full">
            <CardHead
              title="Call volume"
              sub="Last 7 days · inbound and outbound"
              action={
                <Link href="/analytics" className="text-xs font-medium text-cyan hover:underline">
                  Analytics →
                </Link>
              }
            />
            <QueryBoundary query={overview} skeleton={<ChartSkeleton height={150} />}>
              {(d) => (
                <>
                  <VolumeBars data={d.volume} />
                  <div className="mt-4 flex gap-5 border-t border-white/[0.05] pt-3.5">
                    <Legend color="var(--color-violet)" label="Inbound" />
                    <Legend color="rgba(63,224,197,0.7)" label="Outbound" />
                    <span className="ml-auto flex items-center gap-1.5 text-[11.5px] text-cyan">
                      <TrendingUp className="size-3.5" />
                      Busiest day was yesterday
                    </span>
                  </div>
                </>
              )}
            </QueryBoundary>
          </Card>
        </Reveal>

        <Reveal delay={0.08}>
          <Card interactive={false} className="h-full">
            <CardHead
              title="Live calls"
              sub={
                <span className="flex items-center gap-1.5">
                  <LiveDot />
                  {live.data?.length ?? 0} active right now
                </span>
              }
              action={
                <Link href="/live" className="text-xs font-medium text-cyan hover:underline">
                  Monitor →
                </Link>
              }
            />
            <QueryBoundary query={live} skeleton={<RowsSkeleton rows={4} />}>
              {(calls) => (
                <div>
                  {calls.slice(0, 5).map((c) => (
                    <ListRow key={c.id} onClick={() => router.push("/live")}>
                      <LiveDot tone={c.sentiment === "frustrated" ? "coral" : "cyan"} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13px] font-medium text-t1">
                          {maskPhone(c.phone)}
                        </div>
                        <div className="font-[family-name:var(--font-mono)] text-[11px] text-t3">
                          {INTENT_LABEL[c.intent]} · <CallDuration startedAt={c.startedAt} />
                        </div>
                      </div>
                      <Waveform
                        bars={5}
                        height={14}
                        tone={c.sentiment === "frustrated" ? "coral" : "cyan"}
                        className="hidden sm:flex"
                      />
                      <Pill tone={sentimentTone[c.sentiment]}>{LANGUAGE_LABEL[c.language]}</Pill>
                    </ListRow>
                  ))}
                </div>
              )}
            </QueryBoundary>
          </Card>
        </Reveal>
      </div>

      <Reveal delay={0.05} className="mb-3.5">
        <CopilotBar />
      </Reveal>

      <LazyMount placeholder={<CardSkeleton height={190} />}>
        <div className="grid items-start gap-3.5 lg:grid-cols-[1fr_1fr]">
          <Card interactive={false}>
            <CardHead
              title="Language mix"
              sub="Share of today's calls by detected language"
            />
            <QueryBoundary query={overview} skeleton={<ChartSkeleton height={60} />}>
              {(d) => (
                <ShareBar
                  segments={d.languageMix.map((l, i) => ({
                    label: LANGUAGE_LABEL[l.language],
                    value: l.share,
                    color: [
                      "var(--color-violet)",
                      "var(--color-cyan)",
                      "var(--color-amber)",
                      "rgba(124,108,246,0.5)",
                      "rgba(63,224,197,0.5)",
                      "rgba(245,166,43,0.5)",
                    ][i % 6],
                  }))}
                />
              )}
            </QueryBoundary>
          </Card>

          <Card interactive={false}>
            <CardHead
              title="Today's unit economics"
              sub="What this traffic actually costs you"
              action={
                <Link href="/analytics" className="text-xs font-medium text-cyan hover:underline">
                  Breakdown →
                </Link>
              }
            />
            <QueryBoundary query={usage} skeleton={<RowsSkeleton rows={3} />}>
              {(u) => {
                const spend = u.aiCostInr + u.telephonyCostInr;
                const revenue = u.planPriceInr;
                return (
                  <div>
                    <ListRow>
                      <span className="flex-1 text-[13px] text-t2">AI compute (self-hosted)</span>
                      <span className="font-[family-name:var(--font-mono)] text-xs text-t1">
                        {formatRupees(u.aiCostInr)}
                      </span>
                    </ListRow>
                    <ListRow>
                      <span className="flex-1 text-[13px] text-t2">Telephony</span>
                      <span className="font-[family-name:var(--font-mono)] text-xs text-t1">
                        {formatRupees(u.telephonyCostInr)}
                      </span>
                    </ListRow>
                    <ListRow>
                      <span className="flex-1 text-[13px] text-t2">Plan revenue this cycle</span>
                      <span className="font-[family-name:var(--font-mono)] text-xs text-cyan">
                        {formatRupees(revenue)}
                      </span>
                    </ListRow>
                    <ListRow>
                      <span className="flex-1 text-[13px] font-medium text-t1">Gross margin</span>
                      <Pill tone={revenue > spend ? "cyan" : "coral"}>
                        {Math.round(((revenue - spend) / revenue) * 100)}%
                      </Pill>
                    </ListRow>
                  </div>
                );
              }}
            </QueryBoundary>
          </Card>
        </div>
      </LazyMount>
    </>
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
