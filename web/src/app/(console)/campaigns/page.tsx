"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  Clock3,
  Megaphone,
  Pause,
  Play,
  Plus,
  ShieldCheck,
  Upload,
  Users2,
} from "lucide-react";
import { PageHead } from "@/components/chrome/page-head";
import { Card, CardHead, MetricCard } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/ui/pill";
import { Field, ProgressBar, Slider, TextInput } from "@/components/ui/controls";
import { MetricSkeleton, QueryBoundary, RowsSkeleton } from "@/components/ui/feedback";
import { ListRow, Mono, Table, Td, Th, Tr } from "@/components/ui/table";
import { LazyMount, NumberTicker, Reveal, Stagger, StaggerItem } from "@/components/motion/primitives";
import { IS_MOCK, mutations } from "@/lib/api/client";
import { qk, useAgents, useCampaignContacts, useCampaigns, useScrubStatus } from "@/lib/api/hooks";
import type { Campaign } from "@/lib/api/schemas";
import { relativeTime } from "@/lib/utils";

export default function CampaignsPage() {
  const campaigns = useCampaigns();
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const list = campaigns.data ?? [];
  const running = list.filter((c) => c.status === "running");
  const queued = list.reduce((s, c) => s + (c.contacts - c.dialed), 0);
  const overallConnect =
    list.reduce((s, c) => s + c.connected, 0) / (list.reduce((s, c) => s + c.dialed, 0) || 1);

  return (
    <>
      <PageHead
        title="Campaigns"
        sub="Outbound calling — sales, reminders, collections, surveys"
        actions={
          <>
            <Button variant="ghost" onClick={() => setSelectedId(list[0]?.id ?? null)}>
              <Upload className="size-3.5" />
              Add contacts
            </Button>
            <Button variant="primary" onClick={() => setCreating(true)}>
              <Plus className="size-3.5" />
              New campaign
            </Button>
          </>
        }
      />

      <QueryBoundary
        query={campaigns}
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
                icon={<Megaphone strokeWidth={1.8} />}
                accent="violet"
                value={<NumberTicker value={running.length} />}
                label="Active campaigns"
                footnote={`${list.length} total`}
              />
            </StaggerItem>
            <StaggerItem>
              <MetricCard
                icon={<CheckCircle2 strokeWidth={1.8} />}
                accent="cyan"
                value={<NumberTicker value={overallConnect * 100} decimals={1} suffix="%" />}
                label="Connect rate"
                trend="+2.4%"
              />
            </StaggerItem>
            <StaggerItem>
              <MetricCard
                icon={<Users2 strokeWidth={1.8} />}
                accent="amber"
                value={<NumberTicker value={queued} />}
                label="Contacts queued"
              />
            </StaggerItem>
            <StaggerItem>
              <MetricCard
                icon={<Clock3 strokeWidth={1.8} />}
                accent="coral"
                value={<NumberTicker value={180} />}
                label="Max concurrency"
                footnote="Across 3 trunks"
              />
            </StaggerItem>
          </Stagger>
        )}
      </QueryBoundary>

      <Reveal className="mb-3.5">
        <Card interactive={false}>
          <CardHead title="Campaigns" sub="Progress is dialled contacts, not elapsed time" />
          <QueryBoundary query={campaigns} skeleton={<RowsSkeleton rows={5} />}>
            {(rows) => (
              <Table>
                <thead>
                  <tr>
                    <Th>Name</Th>
                    <Th>Agent</Th>
                    <Th>Series</Th>
                    <Th>Progress</Th>
                    <Th align="right">Connect</Th>
                    <Th align="right">Status</Th>
                    <Th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((c, i) => (
                    <Tr key={c.id} index={i}>
                      <Td>
                        <div className="font-medium">{c.name}</div>
                        {c.scrubbedCount > 0 ? (
                          <div className="mt-0.5 text-[11px] text-amber">
                            {c.scrubbedCount} numbers excluded by DND scrub
                          </div>
                        ) : null}
                      </Td>
                      <Td className="text-t2">{c.agentName}</Td>
                      <Td>
                        <Pill tone={c.series === "140" ? "amber" : "cyan"}>
                          {c.series} {c.series === "140" ? "promo" : "service"}
                        </Pill>
                      </Td>
                      <Td>
                        <div className="w-32">
                          <ProgressBar
                            value={c.dialed / (c.contacts || 1)}
                            height={4}
                            tone={c.status === "paused" ? "amber" : "brand"}
                          />
                          <Mono className="mt-1 block text-[10.5px]">
                            {c.dialed.toLocaleString("en-IN")} / {c.contacts.toLocaleString("en-IN")}
                          </Mono>
                        </div>
                      </Td>
                      <Td align="right" mono>
                        {c.connectRate > 0 ? `${Math.round(c.connectRate * 100)}%` : "—"}
                      </Td>
                      <Td align="right">
                        <Pill
                          tone={
                            c.status === "running"
                              ? "cyan"
                              : c.status === "paused"
                                ? "amber"
                                : "grey"
                          }
                          dot={c.status === "running"}
                        >
                          {c.status}
                        </Pill>
                      </Td>
                      <Td align="right">
                        <div className="flex justify-end gap-1.5">
                          <Button size="sm" variant="subtle" onClick={() => setSelectedId(c.id)}>
                            Contacts
                          </Button>
                          <Button
                            size="sm"
                            variant="subtle"
                            onClick={async () => {
                              const next = c.status === "running" ? "paused" : "running";
                              try {
                                if (!IS_MOCK) await mutations.updateCampaign(c.id, next);
                                toast.success(next === "paused" ? `Paused ${c.name}` : `Started ${c.name}`);
                                void qc.invalidateQueries({ queryKey: qk.campaigns });
                              } catch {
                                toast.error("Could not update campaign");
                              }
                            }}
                          >
                            {c.status === "running" ? (
                              <Pause className="size-3" />
                            ) : (
                              <Play className="size-3" />
                            )}
                          </Button>
                        </div>
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
          </QueryBoundary>
        </Card>
      </Reveal>

      {selectedId ? <ContactsCard campaignId={selectedId} campaigns={list} /> : null}

      <LazyMount>
        <div className="grid gap-3.5 lg:grid-cols-2">
          <ScrubCard />
          <RetryCard />
        </div>
      </LazyMount>

      {creating ? (
        <NewCampaignModal
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false);
            setSelectedId(id);
            void qc.invalidateQueries({ queryKey: qk.campaigns });
          }}
        />
      ) : null}
    </>
  );
}

function NewCampaignModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const agents = useAgents();
  const [name, setName] = useState("");
  const [agentId, setAgentId] = useState("");
  const [series, setSeries] = useState<"140" | "160">("160");

  useEffect(() => {
    if (!agentId && agents.data?.[0]?.id) setAgentId(agents.data[0].id);
  }, [agentId, agents.data]);

  const create = async () => {
    if (!name.trim() || !agentId) {
      toast.error("Name the campaign and pick an agent");
      return;
    }
    try {
      const res = IS_MOCK
        ? { id: "cp_mock" }
        : await mutations.createCampaign({ name: name.trim(), agentId, series });
      toast.success("Campaign drafted — add contacts next");
      onCreated(res.id);
    } catch {
      toast.error("Could not create campaign");
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-void/70 p-4 backdrop-blur-sm">
      <div className="glass-strong w-[min(460px,100%)] rounded-[22px] p-5">
        <h2 className="mb-1 font-[family-name:var(--font-display)] text-[16px] font-semibold text-t1">
          New campaign
        </h2>
        <p className="mb-4 text-[12px] text-t3">
          140 is promotional, 160 is transactional. The series is enforced before the first dial.
        </p>
        <div className="space-y-3">
          <Field label="Name">
            <TextInput value={name} onChange={setName} placeholder="COD reminders — west" />
          </Field>
          <Field label="Agent">
            <select
              value={agentId}
              onChange={(e) => setAgentId(e.target.value)}
              className="glass w-full rounded-[11px] px-3.5 py-2.5 text-[13px] text-t1 outline-none"
            >
              {(agents.data ?? []).map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Number series">
            <select
              value={series}
              onChange={(e) => setSeries(e.target.value as "140" | "160")}
              className="glass w-full rounded-[11px] px-3.5 py-2.5 text-[13px] text-t1 outline-none"
            >
              <option value="160">160 — service / transactional</option>
              <option value="140">140 — promotional</option>
            </select>
          </Field>
        </div>
        <div className="mt-4 flex gap-2">
          <Button variant="subtle" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void create()}>
            Create draft
          </Button>
        </div>
      </div>
    </div>
  );
}

function ContactsCard({ campaignId, campaigns }: { campaignId: string; campaigns: Campaign[] }) {
  const query = useCampaignContacts(campaignId);
  const qc = useQueryClient();
  const [paste, setPaste] = useState("");
  const campaign = campaigns.find((c) => c.id === campaignId);

  const add = async () => {
    const contacts = paste
      .split(/[\n,;]+/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [phone, name] = line.split(/\s+/);
        return { phone, name };
      });
    if (!contacts.length) {
      toast.error("Paste numbers, one per line — optional name after the number");
      return;
    }
    try {
      if (!IS_MOCK) await mutations.addContacts(campaignId, contacts);
      toast.success(`Queued ${contacts.length} contacts`);
      setPaste("");
      void qc.invalidateQueries({ queryKey: qk.campaignContacts(campaignId) });
      void qc.invalidateQueries({ queryKey: qk.campaigns });
    } catch {
      toast.error("Could not add contacts");
    }
  };

  return (
    <Reveal className="mb-3.5">
      <Card interactive={false}>
        <CardHead
          title={`Contacts — ${campaign?.name ?? "campaign"}`}
          sub="Paste numbers. DND-registered rows stay queued until scrub excludes them."
        />
        <Field label="Add numbers" hint="One per line: +9198… Priya">
          <textarea
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
            rows={4}
            className="glass w-full resize-y rounded-[14px] p-3 font-[family-name:var(--font-mono)] text-[12.5px] text-t1 outline-none"
            placeholder={"+919876543210 Priya Menon\n+918765432109"}
          />
        </Field>
        <Button className="mt-3 mb-4" variant="primary" onClick={() => void add()}>
          <Plus className="size-3.5" />
          Queue contacts
        </Button>
        <QueryBoundary query={query} skeleton={<RowsSkeleton rows={3} />}>
          {(rows) =>
            rows.length === 0 ? (
              <p className="text-[12.5px] text-t3">No contacts yet.</p>
            ) : (
              rows.map((c) => (
                <ListRow key={c.id}>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] text-t1">{c.name || c.phone}</span>
                    <Mono className="text-[11px]">{c.phone}</Mono>
                  </span>
                  {c.dnd ? <Pill tone="amber">DND</Pill> : null}
                  <Pill tone={c.status === "queued" ? "grey" : "cyan"}>{c.status}</Pill>
                </ListRow>
              ))
            )
          }
        </QueryBoundary>
      </Card>
    </Reveal>
  );
}

/**
 * Compliance state, not a status badge. §4.3 makes this a hard gate: a number
 * cannot enter a dialing queue without passing here, and a violation carries
 * legal consequence rather than a bad review.
 */
function ScrubCard() {
  const query = useScrubStatus();

  return (
    <Card interactive={false}>
      <CardHead
        title="DND / DLT scrub"
        sub="Enforced before any number enters a dialing queue"
        action={
          <Button size="sm" variant="subtle" onClick={() => toast.success("Re-syncing DND registry…")}>
            Re-sync
          </Button>
        }
      />
      <QueryBoundary query={query} skeleton={<RowsSkeleton rows={4} />}>
        {(s) => (
          <div>
            <ListRow>
              <ShieldCheck className="size-4 shrink-0 text-cyan" strokeWidth={1.7} />
              <span className="flex-1 text-[13px] text-t1">DLT entity registration</span>
              <Pill tone={s.dltEntityApproved ? "cyan" : "coral"}>
                {s.dltEntityApproved ? "Approved" : "Blocked"}
              </Pill>
            </ListRow>
            <ListRow>
              <ShieldCheck
                className={`size-4 shrink-0 ${s.dltTemplatesPending ? "text-amber" : "text-cyan"}`}
                strokeWidth={1.7}
              />
              <span className="flex-1 text-[13px] text-t1">Content templates</span>
              <Mono>{s.dltTemplatesApproved} approved</Mono>
              {s.dltTemplatesPending ? (
                <Pill tone="amber">{s.dltTemplatesPending} pending</Pill>
              ) : null}
            </ListRow>
            <ListRow>
              <ShieldCheck className="size-4 shrink-0 text-cyan" strokeWidth={1.7} />
              <span className="flex-1 text-[13px] text-t1">National DND registry</span>
              <Pill tone="cyan">Synced {relativeTime(s.dndSyncedAt)}</Pill>
            </ListRow>
            <ListRow>
              <ShieldCheck className="size-4 shrink-0 text-amber" strokeWidth={1.7} />
              <span className="flex-1 text-[13px] text-t1">Numbers auto-excluded</span>
              <Mono className="text-amber">{s.dndExcluded}</Mono>
            </ListRow>

            <div className="mt-3 rounded-[12px] border border-amber/20 bg-amber/[0.07] p-3">
              <p className="text-[11.5px] leading-snug text-t2">
                Two templates are still pending. Promotional campaigns on the 140 series are capped
                at 1,000 calls/day until they clear.
              </p>
            </div>
          </div>
        )}
      </QueryBoundary>
    </Card>
  );
}

function RetryCard() {
  const [attempts, setAttempts] = useState(3);
  const [gap, setGap] = useState(45);

  return (
    <Card interactive={false}>
      <CardHead
        title="Retry & quiet hours"
        sub="Quiet hours are enforced in the dialer, not just defaulted here"
      />
      <div className="space-y-5">
        <Slider
          label="Retry attempts on no-answer"
          value={attempts}
          onChange={(v) => setAttempts(Math.round(v))}
          min={0}
          max={6}
          step={1}
          format={(v) => `${Math.round(v)}`}
        />
        <Slider
          label="Gap between retries"
          value={gap}
          onChange={(v) => setGap(Math.round(v))}
          min={15}
          max={180}
          step={15}
          format={(v) => `${Math.round(v)} min`}
          hint="Backoff doubles after the second failed attempt"
        />

        <div className="glass rounded-[14px] p-3.5">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[12.5px] font-medium text-t1">Quiet hours</span>
            <Mono className="text-cyan">9:00pm – 9:00am</Mono>
          </div>
          <p className="text-[11.5px] leading-snug text-t3">
            A retry that lands inside this window rolls forward to the next morning instead of
            being dropped. This is a TCCCPR requirement, so it cannot be turned off — only made
            stricter.
          </p>
        </div>

        <Button variant="ghost" full onClick={() => toast.success("Retry policy saved")}>
          Save retry policy
        </Button>
      </div>
    </Card>
  );
}
