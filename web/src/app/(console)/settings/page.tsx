"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { toast } from "sonner";
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Copy,
  KeyRound,
  Plus,
  RefreshCw,
  UserPlus,
} from "lucide-react";
import { PageHead } from "@/components/chrome/page-head";
import { Card, CardHead } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/ui/pill";
import { ProgressBar, Tabs } from "@/components/ui/controls";
import { ChartSkeleton, QueryBoundary, RowsSkeleton } from "@/components/ui/feedback";
import { ListRow, Mono, Table, Td, Th, Tr } from "@/components/ui/table";
import { NumberTicker, Reveal } from "@/components/motion/primitives";
import { useLiveClock } from "@/components/ui/live";
import { useApiKeys, useCompliance, useTeam, useUsage } from "@/lib/api/hooks";
import type { ComplianceItem } from "@/lib/api/schemas";
import { PLANS } from "@/lib/pricing";
import { cn, formatRupees, relativeTime } from "@/lib/utils";

const TrendArea = dynamic(() => import("@/components/viz/charts").then((m) => m.TrendArea), {
  loading: () => <ChartSkeleton height={120} />,
});

type Tab = "billing" | "compliance" | "team" | "keys";

export default function SettingsPage() {
  const [tab, setTab] = useState<Tab>("billing");

  return (
    <>
      <PageHead title="Settings" sub="Billing, compliance, team, and API access" />

      <Tabs
        className="mb-4"
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "billing", label: "Billing & usage" },
          { value: "compliance", label: "Compliance" },
          { value: "team", label: "Team & roles" },
          { value: "keys", label: "API keys" },
        ]}
      />

      {tab === "billing" ? <BillingTab /> : null}
      {tab === "compliance" ? <ComplianceTab /> : null}
      {tab === "team" ? <TeamTab /> : null}
      {tab === "keys" ? <KeysTab /> : null}
    </>
  );
}

function BillingTab() {
  const query = useUsage();
  const now = useLiveClock(60_000);
  const currentPlan = query.data?.plan;

  return (
    <div className="grid gap-3.5 lg:grid-cols-[1.2fr_1fr]">
      <Reveal>
        <Card interactive={false} className="h-full">
          <CardHead title="Usage this cycle" sub="Metered per second, not rounded up per minute" />
          <QueryBoundary query={query} skeleton={<RowsSkeleton rows={5} />}>
            {(u) => {
              const pct = u.usedMinutes / u.includedMinutes;
              const overage = Math.max(0, u.usedMinutes - u.includedMinutes);
              // Projection runs off the real cycle window, and the invoice is
              // derived from the same numbers as the warning above it — a bill
              // that contradicts its own forecast destroys the trust the
              // transparent-pricing pitch depends on.
              const start = new Date(u.cycleStart).getTime();
              const end = new Date(u.cycleEnd).getTime();
              const cycleDays = Math.max(1, Math.round((end - start) / 86_400_000));
              const daysLeft = Math.max(0, Math.ceil((end - (now ?? end)) / 86_400_000));
              const daysElapsed = Math.max(1, cycleDays - daysLeft);
              const projected = Math.round((u.usedMinutes / daysElapsed) * cycleDays);
              const projectedOverage = Math.max(0, projected - u.includedMinutes);
              const projectedInvoice = u.planPriceInr + projectedOverage * u.overageRateInr;

              return (
                <>
                  <div className="mb-1 font-[family-name:var(--font-display)] text-[26px] font-semibold text-t1">
                    <NumberTicker value={u.usedMinutes} />
                    <span className="text-sm font-normal text-t3">
                      {" "}
                      / {u.includedMinutes.toLocaleString("en-IN")} min
                    </span>
                  </div>
                  <ProgressBar
                    value={pct}
                    tone={pct > 0.9 ? "coral" : pct > 0.75 ? "amber" : "brand"}
                    className="mb-4"
                  />

                  {projectedOverage > 0 ? (
                    <div className="mb-4 flex gap-2.5 rounded-[12px] border border-amber/20 bg-amber/[0.07] p-3">
                      <AlertCircle className="mt-px size-4 shrink-0 text-amber" strokeWidth={1.7} />
                      <p className="text-[11.5px] leading-snug text-t2">
                        At the current pace you&apos;ll finish around{" "}
                        {projected.toLocaleString("en-IN")} minutes — about{" "}
                        {formatRupees(projectedOverage * u.overageRateInr)} in overage. Upgrading
                        before the cycle closes is cheaper.
                      </p>
                    </div>
                  ) : null}

                  <ListRow>
                    <span className="flex-1 text-[13px] text-t2">{u.planLabel} plan</span>
                    <Mono className="text-t1">{formatRupees(u.planPriceInr)}/mo</Mono>
                  </ListRow>
                  <ListRow>
                    <span className="flex-1 text-[13px] text-t2">Overage rate</span>
                    <Mono>{formatRupees(u.overageRateInr)}/min</Mono>
                  </ListRow>
                  <ListRow>
                    <span className="flex-1 text-[13px] text-t2">Overage so far</span>
                    <Mono className={overage > 0 ? "text-amber" : undefined}>
                      {overage > 0 ? `${overage} min` : "None"}
                    </Mono>
                  </ListRow>
                  <ListRow>
                    <span className="flex-1 text-[13px] text-t2">Days left in cycle</span>
                    <Mono>{daysLeft}</Mono>
                  </ListRow>
                  <ListRow>
                    <span className="flex-1 text-[13px] font-medium text-t1">
                      Projected invoice
                      {projectedOverage > 0 ? (
                        <span className="text-t3"> · incl. overage</span>
                      ) : null}
                    </span>
                    <Mono className="text-t1">{formatRupees(projectedInvoice)}</Mono>
                  </ListRow>

                  <div className="mt-4">
                    <div className="mb-2 text-[11.5px] text-t3">Daily minutes this cycle</div>
                    <TrendArea
                      data={u.dailyMinutes.map((d) => ({ date: d.date, value: d.minutes }))}
                      tone="violet"
                      height={110}
                      valueFormat={(v) => `${Math.round(v)} min`}
                    />
                  </div>
                </>
              );
            }}
          </QueryBoundary>
        </Card>
      </Reveal>

      <Reveal delay={0.08}>
        <div className="space-y-3.5">
          <Card interactive={false}>
            <CardHead title="Your plan" sub="Change any time, prorated to the day" />
            <div className="space-y-2.5">
              {PLANS.map((plan) => ({
                name: plan.name,
                price: plan.priceInr,
                mins: plan.includedMinutes,
                current: plan.id === currentPlan,
              })).map((p) => (
                <div
                  key={p.name}
                  className={cn(
                    "flex items-center gap-3 rounded-[14px] border p-3.5 transition-colors",
                    p.current ? "border-cyan/35 bg-cyan/[0.06]" : "border-hairline bg-white/[0.035]",
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] font-medium text-t1">{p.name}</span>
                      {p.current ? <Pill tone="cyan">Current</Pill> : null}
                    </div>
                    <Mono className="mt-0.5 block text-[10.5px]">
                      {p.mins.toLocaleString("en-IN")} minutes included
                    </Mono>
                  </div>
                  <div className="text-right">
                    <div className="font-[family-name:var(--font-display)] text-[15px] font-semibold text-t1">
                      {formatRupees(p.price)}
                    </div>
                    {!p.current ? (
                      <button
                        onClick={() => toast.success(`Switched to ${p.name}`)}
                        className="text-[11px] font-medium text-cyan hover:underline"
                      >
                        Switch
                      </button>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <Card interactive={false}>
            <CardHead
              title="What this traffic costs us"
              sub="Shown because opaque pricing is what we're selling against"
            />
            <QueryBoundary query={query} skeleton={<RowsSkeleton rows={3} />}>
              {(u) => {
                const cost = u.aiCostInr + u.telephonyCostInr;
                const margin = (u.planPriceInr - cost) / u.planPriceInr;
                return (
                  <div>
                    <ListRow>
                      <span className="flex-1 text-[13px] text-t2">AI compute</span>
                      <Mono>{formatRupees(u.aiCostInr)}</Mono>
                    </ListRow>
                    <ListRow>
                      <span className="flex-1 text-[13px] text-t2">Telephony</span>
                      <Mono>{formatRupees(u.telephonyCostInr)}</Mono>
                    </ListRow>
                    <ListRow>
                      <span className="flex-1 text-[13px] text-t2">Effective rate</span>
                      <Mono>₹{(cost / u.usedMinutes).toFixed(2)}/min</Mono>
                    </ListRow>
                    <ListRow>
                      <span className="flex-1 text-[13px] font-medium text-t1">Gross margin</span>
                      <Pill tone={margin > 0.4 ? "cyan" : "amber"}>
                        {Math.round(margin * 100)}%
                      </Pill>
                    </ListRow>
                  </div>
                );
              }}
            </QueryBoundary>
          </Card>
        </div>
      </Reveal>
    </div>
  );
}

function ComplianceTab() {
  const query = useCompliance();
  const now = useLiveClock(60_000);

  return (
    <QueryBoundary query={query} skeleton={<RowsSkeleton rows={8} />}>
      {(items) => {
        const blocking = items.filter((i) => i.status === "pending" || i.status === "blocked");
        const stale = items.filter(
          (i) =>
            !i.automated &&
            now !== null &&
            now - new Date(i.checkedAt).getTime() > 2 * 86_400_000,
        );

        return (
          <div className="space-y-3.5">
            {blocking.length > 0 ? (
              <Reveal>
                <div className="flex gap-3 rounded-[18px] border border-amber/25 bg-amber/[0.08] px-4 py-3.5">
                  <AlertCircle className="mt-px size-4 shrink-0 text-amber" strokeWidth={1.7} />
                  <p className="text-[12.5px] leading-relaxed text-t2">
                    <span className="font-medium text-t1">
                      {blocking.length} item{blocking.length > 1 ? "s" : ""} not yet in place.
                    </span>{" "}
                    DLT registration is the one hard prerequisite before a first commercial call,
                    inbound or outbound — everything else can run in parallel with development.
                  </p>
                </div>
              </Reveal>
            ) : null}

            <Card interactive={false}>
              <CardHead
                title="Compliance status"
                sub="Automated checks poll the source. Manual ones can go stale silently, so they say when they were last verified."
                action={
                  <Button size="sm" variant="subtle" onClick={() => toast.success("Re-checking…")}>
                    <RefreshCw className="size-3" />
                    Re-check
                  </Button>
                }
              />
              <div>
                {items.map((item) => (
                  <ComplianceRow key={item.key} item={item} />
                ))}
              </div>

              {stale.length > 0 ? (
                <p className="mt-3.5 rounded-[12px] bg-white/[0.03] p-3 text-[11.5px] leading-snug text-t3">
                  {stale.length} manually-tracked item{stale.length > 1 ? "s haven't" : " hasn't"}{" "}
                  been verified in over two days. These are the ones that quietly drift out of
                  date — worth automating before an audit rather than after.
                </p>
              ) : null}
            </Card>
          </div>
        );
      }}
    </QueryBoundary>
  );
}

function ComplianceRow({ item }: { item: ComplianceItem }) {
  const tone =
    item.status === "approved" || item.status === "active"
      ? "cyan"
      : item.status === "review"
        ? "amber"
        : "coral";

  const Icon = tone === "cyan" ? CheckCircle2 : tone === "amber" ? Clock : AlertCircle;

  return (
    <ListRow className="items-start">
      <Icon
        className={cn(
          "mt-0.5 size-4 shrink-0",
          tone === "cyan" ? "text-cyan" : tone === "amber" ? "text-amber" : "text-coral",
        )}
        strokeWidth={1.7}
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13px] text-t1">{item.label}</span>
          {!item.automated ? <Pill tone="grey">Manual</Pill> : null}
        </div>
        <p className="mt-1 text-[11.5px] leading-snug text-t3">{item.description}</p>
        <Mono className="mt-1 block text-[10.5px]">
          {item.detail} · checked {relativeTime(item.checkedAt)}
        </Mono>
      </div>
      <Pill tone={tone} className="shrink-0 capitalize">
        {item.status}
      </Pill>
    </ListRow>
  );
}

const ROLE_BLURB: Record<string, string> = {
  owner: "Everything, including billing and deleting the workspace",
  admin: "Everything except billing and workspace deletion",
  supervisor: "Monitor and take over live calls, manage complaints",
  agent: "Handle transferred calls only, no configuration access",
  analyst: "Read-only analytics and exports, no customer PII",
  billing: "Invoices and plan changes only",
};

function TeamTab() {
  const query = useTeam();

  return (
    <div className="grid gap-3.5 lg:grid-cols-[1.3fr_1fr]">
      <Reveal>
        <Card interactive={false}>
          <CardHead
            title="Team"
            action={
              <Button size="sm" variant="ghost" onClick={() => toast.success("Invite sent")}>
                <UserPlus className="size-3.5" />
                Invite
              </Button>
            }
          />
          <QueryBoundary query={query} skeleton={<RowsSkeleton rows={3} />}>
            {(members) => (
              <Table>
                <thead>
                  <tr>
                    <Th>Member</Th>
                    <Th>Role</Th>
                    <Th align="right">Last active</Th>
                    <Th align="right">Status</Th>
                  </tr>
                </thead>
                <tbody>
                  {members.map((m, i) => (
                    <Tr key={m.id} index={i}>
                      <Td>
                        <div className="font-medium">{m.name}</div>
                        <div className="text-[11px] text-t3">{m.email}</div>
                      </Td>
                      <Td>
                        <Pill tone={m.role === "owner" ? "violet" : "grey"} className="capitalize">
                          {m.role}
                        </Pill>
                      </Td>
                      <Td align="right" mono>
                        {relativeTime(m.lastActiveAt)}
                      </Td>
                      <Td align="right">
                        <Pill tone={m.status === "active" ? "cyan" : "amber"}>{m.status}</Pill>
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
          </QueryBoundary>
        </Card>
      </Reveal>

      <Reveal delay={0.08}>
        <Card interactive={false}>
          <CardHead
            title="Roles"
            sub="Granular from the start — retrofitting permissions onto a live product is the painful version"
          />
          <div className="space-y-2.5">
            {Object.entries(ROLE_BLURB).map(([role, blurb]) => (
              <div key={role} className="glass rounded-[12px] p-3">
                <div className="text-[12.5px] font-medium capitalize text-t1">{role}</div>
                <p className="mt-0.5 text-[11.5px] leading-snug text-t3">{blurb}</p>
              </div>
            ))}
          </div>
        </Card>
      </Reveal>
    </div>
  );
}

function KeysTab() {
  const query = useApiKeys();

  return (
    <Card interactive={false}>
      <CardHead
        title="API keys"
        sub="Scoped per key. Rotate without downtime by creating the new one first."
        action={
          <Button size="sm" variant="primary" onClick={() => toast.success("Key created — copy it now, it won't be shown again")}>
            <Plus className="size-3.5" />
            New key
          </Button>
        }
      />
      <QueryBoundary query={query} skeleton={<RowsSkeleton rows={2} />}>
        {(keys) => (
          <div className="space-y-3">
            {keys.map((k) => (
              <div key={k.id} className="glass rounded-[14px] p-3.5">
                <div className="mb-2.5 flex flex-wrap items-center gap-2">
                  <KeyRound className="size-3.5 text-t2" strokeWidth={1.7} />
                  <span className="text-[13px] font-medium text-t1">{k.label}</span>
                  <Pill tone={k.prefix.startsWith("sk_live") ? "coral" : "grey"}>
                    {k.prefix.startsWith("sk_live") ? "Live" : "Test"}
                  </Pill>
                  <button
                    onClick={() => toast.success("Key prefix copied")}
                    className="ml-auto flex items-center gap-1.5 text-[11px] text-t3 transition-colors hover:text-t1"
                  >
                    <Mono>{k.prefix}••••••••</Mono>
                    <Copy className="size-3" />
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {k.scopes.map((s) => (
                    <Pill key={s} tone="violet">
                      <span className="font-[family-name:var(--font-mono)]">{s}</span>
                    </Pill>
                  ))}
                </div>
                <Mono className="mt-2.5 block text-[10.5px]">
                  Created {relativeTime(k.createdAt)}
                  {k.lastUsedAt ? ` · last used ${relativeTime(k.lastUsedAt)}` : " · never used"}
                </Mono>
              </div>
            ))}
          </div>
        )}
      </QueryBoundary>
    </Card>
  );
}
