"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Info, Plus, ShieldCheck } from "lucide-react";
import { PageHead } from "@/components/chrome/page-head";
import { Card, CardHead, MetricCard } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/ui/pill";
import { ProgressBar, Toggle } from "@/components/ui/controls";
import { MetricSkeleton, QueryBoundary, RowsSkeleton } from "@/components/ui/feedback";
import { ListRow, Mono, Table, Td, Th, Tr } from "@/components/ui/table";
import { LazyMount, NumberTicker, Reveal, Stagger, StaggerItem } from "@/components/motion/primitives";
import { useNumbers, useSecuritySettings, useTrunks } from "@/lib/api/hooks";
import { formatRupees } from "@/lib/utils";
import { PhoneCall, Signal, TrendingUp, Wallet } from "lucide-react";

export default function NumbersPage() {
  const numbers = useNumbers();
  const security = useSecuritySettings();
  const trunks = useTrunks();

  const list = numbers.data ?? [];
  const activeNumbers = list.filter((n) => n.status === "active");
  const avgPickup =
    activeNumbers.reduce((s, n) => s + n.pickupRate, 0) / (activeNumbers.length || 1);
  const monthlyRent = list.reduce((s, n) => s + n.monthlyRentInr, 0);
  const callsToday = list.reduce((s, n) => s + n.callsToday, 0);

  return (
    <>
      <PageHead
        title="Numbers & SIP"
        sub="Telephony, provisioning, and call security"
        actions={
          <Button variant="primary" onClick={() => toast.success("Number request submitted")}>
            <Plus className="size-3.5" />
            Add number
          </Button>
        }
      />

      <QueryBoundary
        query={numbers}
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
                icon={<PhoneCall strokeWidth={1.8} />}
                accent="violet"
                value={<NumberTicker value={activeNumbers.length} />}
                label="Active numbers"
                footnote={`${list.length - activeNumbers.length} provisioning`}
              />
            </StaggerItem>
            <StaggerItem>
              {/* Pickup rate is the metric Indian buyers actually compare on
                  (§4.10), so it gets headline treatment rather than a column. */}
              <MetricCard
                icon={<TrendingUp strokeWidth={1.8} />}
                accent="cyan"
                value={<NumberTicker value={avgPickup * 100} decimals={0} suffix="%" />}
                label="Average pickup rate"
                trend="+4%"
                footnote="Category average is ~62%"
              />
            </StaggerItem>
            <StaggerItem>
              <MetricCard
                icon={<Signal strokeWidth={1.8} />}
                accent="amber"
                value={<NumberTicker value={callsToday} />}
                label="Calls routed today"
              />
            </StaggerItem>
            <StaggerItem>
              <MetricCard
                icon={<Wallet strokeWidth={1.8} />}
                accent="coral"
                value={<NumberTicker value={monthlyRent} format={(n) => formatRupees(n)} />}
                label="Monthly number rent"
              />
            </StaggerItem>
          </Stagger>
        )}
      </QueryBoundary>

      <Reveal className="mb-3.5">
        <Card interactive={false}>
          <CardHead
            title="Numbers"
            sub="140 is promotional, 160 is transactional. The series a campaign may use is enforced when it runs, not just labelled here."
          />
          <QueryBoundary query={numbers} skeleton={<RowsSkeleton rows={5} />}>
            {(rows) => (
              <Table>
                <thead>
                  <tr>
                    <Th>Number</Th>
                    <Th>Series</Th>
                    <Th>Provider</Th>
                    <Th>Assigned agent</Th>
                    <Th align="right">Pickup rate</Th>
                    <Th align="right">Calls today</Th>
                    <Th align="right">Status</Th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((n, i) => (
                    <Tr key={n.id} index={i}>
                      <Td mono>{n.e164}</Td>
                      <Td>
                        <Pill tone={n.series === "140" ? "amber" : "cyan"}>
                          {n.series} {n.series === "140" ? "promo" : "service"}
                        </Pill>
                      </Td>
                      <Td className="text-t2">{n.provider}</Td>
                      <Td className="text-t2">{n.assignedAgentName ?? "—"}</Td>
                      <Td align="right">
                        <div className="flex items-center justify-end gap-2">
                          <ProgressBar value={n.pickupRate} height={4} className="w-14" />
                          <Mono>{Math.round(n.pickupRate * 100)}%</Mono>
                        </div>
                      </Td>
                      <Td align="right" mono>
                        {n.callsToday.toLocaleString("en-IN")}
                      </Td>
                      <Td align="right">
                        <Pill tone={n.status === "active" ? "cyan" : "amber"}>{n.status}</Pill>
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
          </QueryBoundary>
        </Card>
      </Reveal>

      <LazyMount>
        <div className="grid gap-3.5 lg:grid-cols-2">
          <Card interactive={false}>
            <CardHead
              title="Call security"
              sub="Labelled by who actually provides each control"
            />
            <QueryBoundary query={security} skeleton={<RowsSkeleton rows={4} />}>
              {(settings) => (
                <div>
                  {settings.map((s) => (
                    <SecurityRow key={s.key} setting={s} />
                  ))}
                  <div className="mt-3 flex gap-2 rounded-[12px] bg-white/[0.03] p-3">
                    <Info className="mt-px size-3.5 shrink-0 text-t3" strokeWidth={1.7} />
                    <p className="text-[11.5px] leading-snug text-t3">
                      Attestation is signed by the telephony partner on their carrier interconnect.
                      We surface its state rather than claiming to provide it — the distinction
                      matters if a regulated buyer audits you.
                    </p>
                  </div>
                </div>
              )}
            </QueryBoundary>
          </Card>

          <Card interactive={false}>
            <CardHead title="SIP trunks" sub="Our orchestration layer over partner carriers" />
            <QueryBoundary query={trunks} skeleton={<RowsSkeleton rows={3} />}>
              {(list) => (
                <div className="space-y-3">
                  {list.map((t) => (
                    <div key={t.id} className="glass rounded-[14px] p-3.5">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <span className="text-[13px] font-medium text-t1">{t.name}</span>
                        <Pill
                          tone={t.status === "healthy" ? "cyan" : t.status === "degraded" ? "amber" : "coral"}
                          dot
                        >
                          {t.status}
                        </Pill>
                      </div>
                      <Mono className="mb-2.5 block truncate text-[10.5px]">{t.host}</Mono>
                      <ProgressBar
                        value={t.channelsInUse / t.channels}
                        tone={t.status === "healthy" ? "brand" : "amber"}
                        height={5}
                      />
                      <div className="mt-2 flex justify-between font-[family-name:var(--font-mono)] text-[10.5px] text-t3">
                        <span>
                          {t.channelsInUse}/{t.channels} channels
                        </span>
                        <span>
                          {t.latencyMs}ms · ASR {Math.round(t.asr * 100)}%
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </QueryBoundary>
          </Card>
        </div>
      </LazyMount>
    </>
  );
}

function SecurityRow({
  setting,
}: {
  setting: {
    key: string;
    label: string;
    description: string;
    enabled: boolean;
    provider: "swara" | "partner";
    availability: "available" | "beta" | "roadmap";
  };
}) {
  const [on, setOn] = useState(setting.enabled);
  const unavailable = setting.availability === "roadmap";

  return (
    <ListRow className="items-start">
      <ShieldCheck
        className={`mt-0.5 size-4 shrink-0 ${on ? "text-cyan" : "text-t3"}`}
        strokeWidth={1.7}
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13px] text-t1">{setting.label}</span>
          <Pill tone={setting.provider === "partner" ? "grey" : "violet"}>
            {setting.provider === "partner" ? "via partner" : "Swara"}
          </Pill>
          {unavailable ? <Pill tone="amber">Roadmap</Pill> : null}
        </div>
        <p className="mt-1 text-[11.5px] leading-snug text-t3">{setting.description}</p>
      </div>
      <Toggle
        checked={on && !unavailable}
        disabled={unavailable}
        label={setting.label}
        onChange={(v) => {
          setOn(v);
          toast.success(`${setting.label} ${v ? "enabled" : "disabled"}`);
        }}
      />
    </ListRow>
  );
}
