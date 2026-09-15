"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, Check, Loader2, Plus, Sparkles, Trash2 } from "lucide-react";
import { PageHead } from "@/components/chrome/page-head";
import { Card, CardHead } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/ui/pill";
import { Field, Tabs, TextInput, Toggle } from "@/components/ui/controls";
import { CardSkeleton, QueryBoundary, RowsSkeleton } from "@/components/ui/feedback";
import { ListRow, Mono } from "@/components/ui/table";
import { Reveal } from "@/components/motion/primitives";
import { SwaraOrb } from "@/components/agents/build-with-swara";
import { IS_MOCK, mutations } from "@/lib/api/client";
import { SWARA_AGENT_ID, SWARA_VOICE } from "@/lib/agents/swara";
import { USE_CASES, type SetupArea } from "@/lib/agents/use-cases";
import {
  qk,
  useAppointmentTypes,
  useConnectors,
  useDepartments,
  useKnowledge,
  usePlaybook,
  useSetupStatus,
  useTransfers,
} from "@/lib/api/hooks";
import { UseCaseSchema, type AppointmentType, type Department, type Playbook, type TransferTarget, type UseCase } from "@/lib/api/schemas";
import { cn } from "@/lib/utils";

const InlineCallPanel = dynamic(() => import("@/components/live/call-panel").then((m) => m.InlineCallPanel), {
  loading: () => <CardSkeleton height={220} />,
});

type Tab = SetupArea;

const TAB_LABEL: Record<Tab, string> = {
  playbook: "Business",
  departments: "Departments",
  transfers: "Transfers",
  appointments: "Appointments",
  knowledge: "Knowledge",
  orders: "Orders",
};

export default function SetupPage() {
  const [tab, setTab] = useState<Tab>("playbook");
  const playbook = usePlaybook();
  const status = useSetupStatus();
  const qc = useQueryClient();
  const router = useRouter();
  const [swaraOpen, setSwaraOpen] = useState(true);
  const [lastSaved, setLastSaved] = useState<string | null>(null);

  const useCase = (playbook.data?.useCase ?? "other") as UseCase;
  const profile = USE_CASES[useCase];

  // Tabs in the use case's priority order, so a clinic sees Appointments
  // before Departments and customer care sees the reverse.
  const tabs = useMemo(() => {
    const order: Tab[] = ["playbook", ...profile.focus.filter((f) => f !== "playbook")];
    for (const t of Object.keys(TAB_LABEL) as Tab[]) if (!order.includes(t)) order.push(t);
    return order.map((value) => ({ value, label: TAB_LABEL[value] }));
  }, [profile]);

  const refreshAll = () => {
    void qc.invalidateQueries({ queryKey: ["setup"] });
    void qc.invalidateQueries({ queryKey: qk.departments });
    void qc.invalidateQueries({ queryKey: qk.knowledge });
    void qc.invalidateQueries({ queryKey: qk.agents });
  };

  return (
    <>
      <PageHead
        title="Workspace setup"
        sub="Everything the agents need before they can act — or just tell Swara and she fills it in"
        actions={
          <Button variant={swaraOpen ? "ghost" : "primary"} onClick={() => setSwaraOpen((v) => !v)}>
            <Sparkles className="size-3.5" />
            {swaraOpen ? "Hide Swara" : "Talk to Swara"}
          </Button>
        }
      />

      <div className={cn("grid gap-3.5", swaraOpen && "lg:grid-cols-[360px_1fr]")}>
        <AnimatePresence initial={false}>
          {swaraOpen ? (
            <motion.div
              key="swara"
              initial={{ opacity: 0, x: -12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -12 }}
              transition={{ duration: 0.22 }}
              className="space-y-3.5 lg:sticky lg:top-[76px] lg:self-start"
            >
              <Card interactive={false}>
                <div className="mb-3 flex items-start gap-3">
                  <SwaraOrb size={40} />
                  <div>
                    <div className="font-[family-name:var(--font-display)] text-[14.5px] font-semibold text-t1">Set up by talking</div>
                    <p className="mt-0.5 text-[11.5px] leading-relaxed text-t3">
                      Swara asks what you do, who handles what, who a call can reach, what can be booked — and saves
                      each answer here as you speak. She raises the edge cases you have not thought of.
                    </p>
                  </div>
                </div>
                <InlineCallPanel
                  agentId={SWARA_AGENT_ID}
                  agentName="Swara"
                  fixedVoice={SWARA_VOICE}
                  startLabel="Start talking to Swara"
                  handlers={{
                    onToolResult: (name, result) => {
                      refreshAll();
                      if (typeof result.error !== "string") setLastSaved(name);
                      if (name === "propose_agents") {
                        toast("Swara proposed your agents", {
                          description: "Open Agents & flows to review and create them.",
                          action: { label: "Open", onClick: () => router.push("/agents") },
                        });
                      }
                    },
                  }}
                />
                <AnimatePresence>
                  {lastSaved ? (
                    <motion.p
                      key={lastSaved}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="mt-2 flex items-center gap-1.5 text-[11px] text-cyan"
                    >
                      <Check className="size-3" /> Saved from the conversation — the forms on the right update live.
                    </motion.p>
                  ) : null}
                </AnimatePresence>
              </Card>

              <ReadinessCard status={status.data} useCase={useCase} onJump={setTab} />
            </motion.div>
          ) : null}
        </AnimatePresence>

        <div className="min-w-0">
          <Tabs tabs={tabs} value={tab} onChange={setTab} className="mb-4" />
          {tab === "playbook" ? <PlaybookTab /> : null}
          {tab === "departments" ? <DepartmentsTab /> : null}
          {tab === "transfers" ? <TransfersTab /> : null}
          {tab === "appointments" ? <AppointmentsTab /> : null}
          {tab === "knowledge" ? <KnowledgeSetupTab /> : null}
          {tab === "orders" ? <OrdersTab /> : null}
        </div>
      </div>
    </>
  );
}

/** What is done, what is missing, in the order this use case cares about. */
function ReadinessCard({
  status,
  useCase,
  onJump,
}: {
  status: { departments: number; transfers: number; appointmentTypes: number; knowledge: number; connectors: number; agents: number } | undefined;
  useCase: UseCase;
  onJump: (t: Tab) => void;
}) {
  const profile = USE_CASES[useCase];
  const rows: { area: Tab; label: string; count: number; must: boolean }[] = profile.focus
    .filter((f) => f !== "playbook")
    .map((area, i) => ({
      area,
      must: i < 2,
      label:
        area === "departments" ? "Departments" : area === "transfers" ? "Transfer desks" : area === "appointments" ? "Bookable types" : area === "knowledge" ? "Knowledge docs" : "Order lookup",
      count:
        area === "departments" ? status?.departments ?? 0 : area === "transfers" ? status?.transfers ?? 0 : area === "appointments" ? status?.appointmentTypes ?? 0 : area === "knowledge" ? status?.knowledge ?? 0 : status?.connectors ?? 0,
    }));
  const done = rows.filter((r) => r.count > 0).length;

  return (
    <Card interactive={false}>
      <CardHead title="Readiness" sub={`${profile.label} · ${done}/${rows.length} in place`} />
      <div className="space-y-1.5">
        {rows.map((r) => (
          <button
            key={r.area}
            onClick={() => onJump(r.area)}
            className="flex w-full items-center gap-2.5 rounded-[10px] px-2 py-1.5 text-left transition-colors hover:bg-white/[0.05]"
          >
            <span className={cn("flex size-4 items-center justify-center rounded-full border", r.count ? "border-cyan bg-cyan/20" : r.must ? "border-amber/50" : "border-hairline")}>
              {r.count ? <Check className="size-2.5 text-cyan" strokeWidth={3} /> : null}
            </span>
            <span className="min-w-0 flex-1 truncate text-[12px] text-t1">{r.label}</span>
            <span className="font-[family-name:var(--font-mono)] text-[11px] text-t3">{r.count}</span>
            {!r.count && r.must ? <Pill tone="amber">needed</Pill> : null}
          </button>
        ))}
      </div>
      <p className="mt-3 text-[11px] leading-relaxed text-t3">{profile.hint}</p>
      <Link href="/agents" className="mt-3 flex items-center gap-1.5 text-[11.5px] font-medium text-cyan hover:underline">
        {status?.agents ? `${status.agents} agent${status.agents === 1 ? "" : "s"} built` : "Build agents with Swara"}
        <ArrowRight className="size-3" />
      </Link>
    </Card>
  );
}

function PlaybookTab() {
  const query = usePlaybook();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);

  return (
    <Reveal>
      <Card interactive={false}>
        <CardHead
          title="How this business works"
          sub="The use case shapes what setup matters and what Swara builds. Hours and policies go into every agent prompt."
        />
        <QueryBoundary query={query} skeleton={<RowsSkeleton rows={5} />}>
          {(book) => (
            <PlaybookForm
              key={JSON.stringify(book)}
              initial={book}
              busy={busy}
              onSave={async (fields) => {
                setBusy(true);
                try {
                  if (!IS_MOCK) await mutations.savePlaybook(fields);
                  toast.success("Playbook saved — live on the next call");
                  void qc.invalidateQueries({ queryKey: ["setup"] });
                } catch {
                  toast.error("Could not save playbook");
                } finally {
                  setBusy(false);
                }
              }}
            />
          )}
        </QueryBoundary>
      </Card>
    </Reveal>
  );
}

function PlaybookForm({ initial, busy, onSave }: { initial: Playbook; busy: boolean; onSave: (fields: Omit<Playbook, "orgId">) => Promise<void> }) {
  const [fields, setFields] = useState<Omit<Playbook, "orgId">>({
    businessType: initial.businessType,
    hours: initial.hours,
    transferPolicy: initial.transferPolicy,
    bookingPolicy: initial.bookingPolicy,
    complaintSlaHours: initial.complaintSlaHours,
    useCase: initial.useCase,
    hasSales: initial.hasSales,
    humanEscalation: initial.humanEscalation,
  });
  const set = <K extends keyof typeof fields>(key: K, value: (typeof fields)[K]) => setFields((f) => ({ ...f, [key]: value }));
  const profile = USE_CASES[fields.useCase];

  return (
    <div className="space-y-5">
      <div>
        <div className="mb-2 text-[12px] font-medium text-t2">What kind of business is this?</div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {UseCaseSchema.options.map((uc) => {
            const p = USE_CASES[uc];
            const active = fields.useCase === uc;
            return (
              <button
                key={uc}
                type="button"
                onClick={() => set("useCase", uc)}
                className={cn(
                  "rounded-[14px] border p-3 text-left transition-colors",
                  active ? "border-cyan/40 bg-cyan/[0.07]" : "border-hairline bg-white/[0.03] hover:bg-white/[0.06]",
                )}
              >
                <div className="text-[12.5px] font-medium text-t1">{p.label}</div>
                <div className="mt-0.5 text-[10.5px] leading-snug text-t3">{p.blurb}</div>
              </button>
            );
          })}
        </div>
        <motion.div
          key={fields.useCase}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-3 rounded-[14px] border border-violet/20 bg-violet/[0.06] p-3.5 text-[12px] leading-relaxed text-t2"
        >
          <span className="font-medium text-t1">Swara will build:</span> {profile.agents.join(" · ")}.{" "}
          <span className="text-t3">{profile.hint}</span>
        </motion.div>
      </div>

      <div className="grid gap-3.5 md:grid-cols-2">
        <Field label="What do you do?" hint="One line the agent can say if asked who you are">
          <TextInput value={fields.businessType} onChange={(v) => set("businessType", v)} placeholder="D2C grocery, metro helpline, clinic…" />
        </Field>
        <Field label="Working hours">
          <TextInput value={fields.hours} onChange={(v) => set("hours", v)} placeholder="10:00-19:00 IST, closed Sundays" />
        </Field>
        <div className="space-y-3 rounded-[14px] border border-hairline p-3.5">
          <Toggle checked={fields.humanEscalation} onChange={(v) => set("humanEscalation", v)} label="Calls can be transferred to a human" />
          <p className="text-[11px] leading-relaxed text-t3">
            {fields.humanEscalation
              ? "Agents may offer the desks listed under Transfers. With no desk configured they take a callback."
              : "Agents never offer a transfer. Stuck or angry callers get a callback promise and a logged action instead."}
          </p>
        </div>
        <div className="space-y-3 rounded-[14px] border border-hairline p-3.5">
          <Toggle checked={fields.hasSales} onChange={(v) => set("hasSales", v)} label="We also want outbound sales / follow-up" />
          <p className="text-[11px] leading-relaxed text-t3">
            Adds inbound sales enquiry and outbound lead follow-up agents to Swara&apos;s plan. Outbound needs a 140-series
            number and DND scrubbing (Campaigns).
          </p>
        </div>
        <Field label="When should the agent transfer?" hint="Without this, and without transfer desks, the agent will not offer a human">
          <textarea
            value={fields.transferPolicy}
            onChange={(e) => set("transferPolicy", e.target.value)}
            rows={4}
            className="glass w-full resize-y rounded-[14px] p-3.5 text-[13px] text-t1 outline-none focus:border-cyan/45"
            placeholder="Transfer on the second stuck turn, or immediately for safety."
          />
        </Field>
        <Field label="Booking rules">
          <textarea
            value={fields.bookingPolicy}
            onChange={(e) => set("bookingPolicy", e.target.value)}
            rows={4}
            className="glass w-full resize-y rounded-[14px] p-3.5 text-[13px] text-t1 outline-none focus:border-cyan/45"
            placeholder="Only offer slots from the appointment types list. Confirm by SMS."
          />
        </Field>
        <Field label="Complaint SLA (hours)">
          <TextInput type="text" value={String(fields.complaintSlaHours)} onChange={(v) => set("complaintSlaHours", Number(v) || 24)} />
        </Field>
        <div className="flex items-end">
          <Button variant="primary" disabled={busy} onClick={() => void onSave(fields)}>
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
            Save playbook
          </Button>
        </div>
      </div>
    </div>
  );
}

function DepartmentsTab() {
  const query = useDepartments();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [keywords, setKeywords] = useState("");

  const save = async () => {
    if (!name.trim()) return;
    try {
      if (!IS_MOCK) {
        await mutations.saveDepartment({
          name: name.trim(),
          keywords: keywords.split(",").map((k) => k.trim()).filter(Boolean),
        });
      }
      toast.success(`${name} can now own follow-up`);
      setName("");
      setKeywords("");
      void qc.invalidateQueries({ queryKey: qk.departments });
    } catch {
      toast.error("Could not save department");
    }
  };

  const remove = async (dept: Department) => {
    try {
      if (!IS_MOCK) {
        const res = await mutations.deleteDepartment(dept.id);
        if ("error" in res && res.error) {
          toast.error(res.error);
          return;
        }
      }
      toast.success(`Removed ${dept.name}`);
      void qc.invalidateQueries({ queryKey: qk.departments });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not remove department");
    }
  };

  return (
    <Reveal>
      <Card interactive={false}>
        <CardHead
          title="Departments"
          sub="Each desk sees only its action queue. Keywords route a complaint when the model is unsure."
        />
        <div className="mb-4 grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
          <Field label="Department name">
            <TextInput value={name} onChange={setName} placeholder="Housekeeping" />
          </Field>
          <Field label="Route on these words" hint="Comma-separated">
            <TextInput value={keywords} onChange={setKeywords} placeholder="dirty, garbage, toilet" />
          </Field>
          <div className="flex items-end">
            <Button variant="primary" onClick={() => void save()}>
              <Plus className="size-3.5" />
              Add
            </Button>
          </div>
        </div>
        <QueryBoundary query={query} skeleton={<RowsSkeleton rows={4} />}>
          {(rows) => (
            <div>
              {rows.map((d) => (
                <ListRow key={d.id}>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] text-t1">{d.name}</span>
                    <span className="text-[11px] text-t3">
                      {d.keywords?.length ? d.keywords.join(" · ") : d.slug}
                      {d.openActions ? ` · ${d.openActions} open` : ""}
                    </span>
                  </span>
                  <Button size="sm" variant="subtle" onClick={() => void remove(d)}>
                    <Trash2 className="size-3" />
                  </Button>
                </ListRow>
              ))}
            </div>
          )}
        </QueryBoundary>
      </Card>
    </Reveal>
  );
}

function TransfersTab() {
  const query = useTransfers();
  const depts = useDepartments();
  const qc = useQueryClient();
  const empty = { name: "", role: "", phone: "", hours: "", whenToUse: "", departmentId: "" };
  const [form, setForm] = useState(empty);

  const save = async () => {
    if (!form.name || !form.role || !form.phone || !form.whenToUse) {
      toast.error("Name, role, phone and when-to-use are required");
      return;
    }
    try {
      if (!IS_MOCK) {
        await mutations.saveTransfer({
          ...form,
          departmentId: form.departmentId || null,
        });
      }
      toast.success(`${form.name} is now a transfer target`);
      setForm(empty);
      void qc.invalidateQueries({ queryKey: qk.transfers });
    } catch {
      toast.error("Could not save transfer");
    }
  };

  const remove = async (row: TransferTarget) => {
    try {
      if (!IS_MOCK) await mutations.deleteTransfer(row.id);
      toast.success(`Removed ${row.name}`);
      void qc.invalidateQueries({ queryKey: qk.transfers });
    } catch {
      toast.error("Could not remove");
    }
  };

  return (
    <Reveal>
      <Card interactive={false}>
        <CardHead
          title="Who can the agent transfer to?"
          sub="A name and a number. Without these rows the agent will take a callback instead of inventing a desk."
        />
        <div className="mb-4 grid gap-3 sm:grid-cols-2">
          <Field label="Name">
            <TextInput value={form.name} onChange={(v) => setForm({ ...form, name: v })} placeholder="Priya Desai" />
          </Field>
          <Field label="Role">
            <TextInput value={form.role} onChange={(v) => setForm({ ...form, role: v })} placeholder="Support lead" />
          </Field>
          <Field label="Phone">
            <TextInput value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} placeholder="+91 98200 11122" />
          </Field>
          <Field label="Hours">
            <TextInput value={form.hours} onChange={(v) => setForm({ ...form, hours: v })} placeholder="10:00-19:00 IST" />
          </Field>
          <Field label="When to use this desk" hint="Spoken into the prompt — be specific">
            <TextInput
              value={form.whenToUse}
              onChange={(v) => setForm({ ...form, whenToUse: v })}
              placeholder="Angry caller, payment dispute, or they asked for a supervisor"
            />
          </Field>
          <Field label="Department (optional)">
            <select
              value={form.departmentId}
              onChange={(e) => setForm({ ...form, departmentId: e.target.value })}
              className="glass w-full rounded-[11px] px-3.5 py-2.5 text-[13px] text-t1 outline-none"
            >
              <option value="">None</option>
              {(depts.data ?? []).map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Button variant="primary" className="mb-4" onClick={() => void save()}>
          <Plus className="size-3.5" />
          Add transfer target
        </Button>
        <QueryBoundary query={query} skeleton={<RowsSkeleton rows={3} />}>
          {(rows) =>
            rows.length === 0 ? (
              <p className="text-[12.5px] text-t3">No desks yet. The agent will not offer a transfer.</p>
            ) : (
              rows.map((t) => (
                <ListRow key={t.id}>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] text-t1">
                      {t.name} · {t.role}
                    </span>
                    <span className="text-[11px] text-t3">
                      <Mono>{t.phone}</Mono>
                      {t.hours ? ` · ${t.hours}` : ""} — {t.whenToUse}
                    </span>
                  </span>
                  <Button size="sm" variant="subtle" onClick={() => void remove(t)}>
                    <Trash2 className="size-3" />
                  </Button>
                </ListRow>
              ))
            )
          }
        </QueryBoundary>
      </Card>
    </Reveal>
  );
}

function AppointmentsTab() {
  const query = useAppointmentTypes();
  const qc = useQueryClient();
  const empty = { name: "", durationMin: "30", hours: "", location: "", notes: "" };
  const [form, setForm] = useState(empty);

  const save = async () => {
    if (!form.name) {
      toast.error("Name the appointment type");
      return;
    }
    try {
      if (!IS_MOCK) {
        await mutations.saveAppointment({
          name: form.name,
          durationMin: Number(form.durationMin) || 30,
          hours: form.hours,
          location: form.location,
          notes: form.notes,
          days: ["mon", "tue", "wed", "thu", "fri"],
        });
      }
      toast.success(`${form.name} can now be booked`);
      setForm(empty);
      void qc.invalidateQueries({ queryKey: qk.appointments });
    } catch {
      toast.error("Could not save appointment type");
    }
  };

  const remove = async (row: AppointmentType) => {
    try {
      if (!IS_MOCK) await mutations.deleteAppointment(row.id);
      toast.success(`Removed ${row.name}`);
      void qc.invalidateQueries({ queryKey: qk.appointments });
    } catch {
      toast.error("Could not remove");
    }
  };

  return (
    <Reveal>
      <Card interactive={false}>
        <CardHead
          title="What can be booked?"
          sub="Duration, hours and location. The agent will not invent a type or a time outside these."
        />
        <div className="mb-4 grid gap-3 sm:grid-cols-2">
          <Field label="Type name">
            <TextInput value={form.name} onChange={(v) => setForm({ ...form, name: v })} placeholder="Service visit" />
          </Field>
          <Field label="Duration (minutes)">
            <TextInput value={form.durationMin} onChange={(v) => setForm({ ...form, durationMin: v })} />
          </Field>
          <Field label="Hours">
            <TextInput value={form.hours} onChange={(v) => setForm({ ...form, hours: v })} placeholder="11:00-18:00" />
          </Field>
          <Field label="Location">
            <TextInput value={form.location} onChange={(v) => setForm({ ...form, location: v })} placeholder="On site / phone / clinic" />
          </Field>
          <Field label="Notes the agent should know">
            <TextInput value={form.notes} onChange={(v) => setForm({ ...form, notes: v })} placeholder="Need a working phone number" />
          </Field>
        </div>
        <Button variant="primary" className="mb-4" onClick={() => void save()}>
          <Plus className="size-3.5" />
          Add appointment type
        </Button>
        <QueryBoundary query={query} skeleton={<RowsSkeleton rows={3} />}>
          {(rows) =>
            rows.length === 0 ? (
              <p className="text-[12.5px] text-t3">No types yet. Booking agents will refuse to invent slots.</p>
            ) : (
              rows.map((a) => (
                <ListRow key={a.id}>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] text-t1">{a.name}</span>
                    <span className="text-[11px] text-t3">
                      {a.durationMin} min{a.hours ? ` · ${a.hours}` : ""}
                      {a.location ? ` · ${a.location}` : ""}
                      {a.notes ? ` — ${a.notes}` : ""}
                    </span>
                  </span>
                  <Button size="sm" variant="subtle" onClick={() => void remove(a)}>
                    <Trash2 className="size-3" />
                  </Button>
                </ListRow>
              ))
            )
          }
        </QueryBoundary>
      </Card>
    </Reveal>
  );
}

function KnowledgeSetupTab() {
  const query = useKnowledge();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [text, setText] = useState("");

  const save = async () => {
    if (!name.trim() || text.trim().length < 20) {
      toast.error("Name the document and paste at least a short paragraph");
      return;
    }
    try {
      if (!IS_MOCK) await mutations.addKnowledge({ name: name.trim(), kind: "text", text });
      toast.success("Indexed — the agent can search this on the next call");
      setName("");
      setText("");
      void qc.invalidateQueries({ queryKey: qk.knowledge });
    } catch {
      toast.error("Could not ingest document");
    }
  };

  return (
    <Reveal>
      <Card interactive={false}>
        <CardHead
          title="Knowledge base"
          sub="Policies, fares, timings — anything the agent must not invent. Pasted text is chunked and searchable mid-call."
        />
        <div className="mb-4 space-y-3">
          <Field label="Document name">
            <TextInput value={name} onChange={setName} placeholder="Refund policy" />
          </Field>
          <Field label="Text">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={8}
              className="glass w-full resize-y rounded-[14px] p-3.5 font-[family-name:var(--font-mono)] text-[12.5px] text-t1 outline-none focus:border-cyan/45"
              placeholder="Paste the policy, timetable or FAQ the agent should quote from…"
            />
          </Field>
          <Button variant="primary" onClick={() => void save()}>
            Add to knowledge base
          </Button>
        </div>
        <QueryBoundary query={query} skeleton={<RowsSkeleton rows={3} />}>
          {(docs) =>
            docs.map((d) => (
              <ListRow key={d.id}>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] text-t1">{d.name}</span>
                  <span className="text-[11px] text-t3">
                    {d.sizeLabel} · {d.chunks.toLocaleString("en-IN")} chunks
                  </span>
                </span>
                <Pill tone={d.status === "indexed" ? "cyan" : "amber"}>{d.status}</Pill>
              </ListRow>
            ))
          }
        </QueryBoundary>
      </Card>
    </Reveal>
  );
}

function OrdersTab() {
  const query = useConnectors();
  const qc = useQueryClient();
  const [name, setName] = useState("Order lookup");
  const [kind, setKind] = useState<"demo" | "rest">("demo");
  const [baseUrl, setBaseUrl] = useState("");
  const [authHeader, setAuthHeader] = useState("Authorization");
  const [authSecret, setAuthSecret] = useState("");

  const save = async () => {
    try {
      if (!IS_MOCK) {
        await mutations.saveConnector({
          name,
          kind,
          tool: "lookup_order",
          baseUrl: kind === "rest" ? baseUrl : undefined,
          authHeader: kind === "rest" ? authHeader : undefined,
          authSecret: kind === "rest" ? authSecret : undefined,
        });
      }
      toast.success(kind === "demo" ? "Demo orders connected" : "Order endpoint saved");
      void qc.invalidateQueries({ queryKey: qk.connectors });
    } catch {
      toast.error("Could not save connector");
    }
  };

  return (
    <Reveal>
      <Card interactive={false}>
        <CardHead
          title="Order lookup"
          sub="We do not take a database password. Point us at a read endpoint, or use the demo catalogue while you wire it."
        />
        <div className="mb-4 grid gap-3 sm:grid-cols-2">
          <Field label="Connector name">
            <TextInput value={name} onChange={setName} />
          </Field>
          <Field label="Mode">
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as "demo" | "rest")}
              className="glass w-full rounded-[11px] px-3.5 py-2.5 text-[13px] text-t1 outline-none"
            >
              <option value="demo">Demo catalogue (no setup)</option>
              <option value="rest">Your order API</option>
            </select>
          </Field>
          {kind === "rest" ? (
            <>
              <Field label="Lookup URL" hint="GET, we append order_id or phone">
                <TextInput value={baseUrl} onChange={setBaseUrl} placeholder="https://api.yoursite.in/orders/lookup" />
              </Field>
              <Field label="Auth header">
                <TextInput value={authHeader} onChange={setAuthHeader} placeholder="Authorization" />
              </Field>
              <Field label="Secret" hint="Stored hashed-side; never shown again">
                <TextInput type="password" value={authSecret} onChange={setAuthSecret} placeholder="Bearer token or API key" />
              </Field>
            </>
          ) : (
            <p className="sm:col-span-2 text-[12.5px] leading-relaxed text-t3">
              Demo mode returns deterministic orders (ORD-48213 and a few others) so the test call
              works before you expose a real endpoint.
            </p>
          )}
        </div>
        <Button variant="primary" onClick={() => void save()}>
          Save order connector
        </Button>
        <QueryBoundary query={query} skeleton={<RowsSkeleton rows={2} />}>
          {(rows) => (
            <div className="mt-4">
              {rows
                .filter((c) => c.tool === "lookup_order")
                .map((c) => (
                  <ListRow key={c.id}>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] text-t1">{c.name}</span>
                      <span className="text-[11px] text-t3">
                        {c.kind} {c.baseUrl ? `· ${c.baseUrl}` : ""}
                      </span>
                    </span>
                    <Pill tone={c.status === "connected" ? "cyan" : "amber"}>{c.status}</Pill>
                  </ListRow>
                ))}
            </div>
          )}
        </QueryBoundary>
      </Card>
    </Reveal>
  );
}
