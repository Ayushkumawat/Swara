"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Check, ChevronDown, Loader2, Mail, Pencil, Phone, Plus, Sparkles, Star, Trash2 } from "lucide-react";
import { PageHead } from "@/components/chrome/page-head";
import { Card, CardHead } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/ui/pill";
import { Checkbox, Field, Select, Tabs, TextInput, Toggle } from "@/components/ui/controls";
import { QueryBoundary, RowsSkeleton } from "@/components/ui/feedback";
import { ListRow, Mono } from "@/components/ui/table";
import { Reveal } from "@/components/motion/primitives";
import { SwaraOrb } from "@/components/agents/build-with-swara";
import { useUi } from "@/lib/ui-store";
import { IS_MOCK, mutations } from "@/lib/api/client";
import { USE_CASES, type SetupArea } from "@/lib/agents/use-cases";
import {
  qk,
  useAppointmentTypes,
  useConnectors,
  useDepartmentSuggestions,
  useDepartments,
  useKnowledge,
  usePlaybook,
  useSetupStatus,
  useTransfers,
} from "@/lib/api/hooks";
import { UseCaseSchema, type AppointmentType, type Department, type Playbook, type TransferTarget, type UseCase } from "@/lib/api/schemas";
import { cn } from "@/lib/utils";

/**
 * Workspace setup.
 *
 * Not every business uses every part of the product, so the page starts
 * from one question — "what do your agents do?" — and shows only the
 * sections that answer switched on. Everything else waits under "Add more"
 * with whatever was already saved in it; switching a section off hides it,
 * it never deletes anything.
 *
 * People are entered once, here. A team (department) is an optional label
 * on a person, not a second list with the same phone numbers in it.
 */

type Section = "business" | "people" | "complaints" | "appointments" | "knowledge" | "orders";

const SECTION_LABEL: Record<Section, string> = {
  business: "Business",
  people: "People & teams",
  complaints: "Complaints",
  appointments: "Appointments",
  knowledge: "Knowledge",
  orders: "Orders",
};

/** Use-case profiles still speak in the older area names. */
const AREA_TO_SECTION: Record<SetupArea, Section> = {
  playbook: "business",
  transfers: "people",
  departments: "complaints",
  appointments: "appointments",
  knowledge: "knowledge",
  orders: "orders",
};

/** The switches. Each one is something an agent does, not a settings page. */
type Switch = "people" | "complaints" | "appointments" | "orders" | "outbound";

const SWITCHES: { key: Switch; label: string; on: string; off: string }[] = [
  {
    key: "people",
    label: "Pass callers to a person",
    on: "Agents can connect a caller to someone, or tell them about it after the call. Who, and how, is under People & teams.",
    off: "Agents handle every call alone and take a callback note. Nobody is transferred to or informed.",
  },
  {
    key: "complaints",
    label: "Take complaints and requests",
    on: "Filed with a reference number and sent to whoever owns them.",
    off: "Section hidden. Agents you already built are not changed.",
  },
  {
    key: "appointments",
    label: "Book appointments",
    on: "Agents offer slots from the types you list — never an invented one.",
    off: "Section hidden. Agents you already built are not changed.",
  },
  {
    key: "orders",
    label: "Look up orders",
    on: "Agents read order status from your system, or the demo catalogue while you wire it.",
    off: "Section hidden. Agents you already built are not changed.",
  },
  {
    key: "outbound",
    label: "Make outbound calls",
    on: "Reminders, follow-ups, sales. Swara includes outbound agents in her plan; calling needs a 140-series number and DND scrubbing (Campaigns).",
    off: "Swara plans inbound agents only.",
  },
];

function switchState(book: Playbook): Record<Switch, boolean> {
  return {
    people: book.humanEscalation,
    complaints: book.features.complaints,
    appointments: book.features.appointments,
    orders: book.features.orders,
    outbound: book.hasSales,
  };
}

/** The API answers errors as `{"error": "…"}`; show the sentence, not the JSON. */
function errorText(error: unknown, fallback: string) {
  if (!(error instanceof Error)) return fallback;
  try {
    const parsed = JSON.parse(error.message) as { error?: unknown };
    if (typeof parsed.error === "string" && parsed.error) return parsed.error;
  } catch {
    /* not JSON — fall through */
  }
  return error.message && error.message.length < 200 ? error.message : fallback;
}

export default function SetupPage() {
  const [tab, setTab] = useState<Section>("business");
  // Knowledge has no switch of its own: it is shown once it has documents,
  // or once the owner opens it from "Add more".
  const [knowledgeOpened, setKnowledgeOpened] = useState(false);
  const playbook = usePlaybook();
  const status = useSetupStatus();
  const people = useTransfers();
  const departments = useDepartments();
  const openSwara = useUi((s) => s.openSwara);
  const qc = useQueryClient();

  const book = playbook.data;
  const useCase = (book?.useCase ?? "other") as UseCase;
  const profile = USE_CASES[useCase];
  const switches = book ? switchState(book) : null;

  const shown = useMemo(() => {
    const on = new Set<Section>(["business"]);
    if (switches?.people) on.add("people");
    if (switches?.complaints) on.add("complaints");
    if (switches?.appointments) on.add("appointments");
    if (switches?.orders) on.add("orders");
    if (knowledgeOpened || (status.data?.knowledge ?? 0) > 0) on.add("knowledge");
    return on;
  }, [switches?.people, switches?.complaints, switches?.appointments, switches?.orders, knowledgeOpened, status.data?.knowledge]);

  // Shown sections in the order this kind of business cares about.
  const tabs = useMemo(() => {
    const order: Section[] = ["business"];
    for (const area of profile.focus) {
      const s = AREA_TO_SECTION[area];
      if (!order.includes(s)) order.push(s);
    }
    for (const s of Object.keys(SECTION_LABEL) as Section[]) if (!order.includes(s)) order.push(s);
    return order;
  }, [profile]);
  const visibleTabs = tabs.filter((s) => shown.has(s)).map((value) => ({ value, label: SECTION_LABEL[value] }));
  const hidden = tabs.filter((s) => !shown.has(s));
  const active: Section = shown.has(tab) ? tab : "business";

  const savedIn = (s: Section) =>
    s === "people"
      ? status.data?.transfers ?? 0
      : s === "complaints"
        ? status.data?.departments ?? 0
        : s === "appointments"
          ? status.data?.appointmentTypes ?? 0
          : s === "knowledge"
            ? status.data?.knowledge ?? 0
            : s === "orders"
              ? status.data?.connectors ?? 0
              : 0;

  // `jump` opens the section that was just switched on — right when it came
  // from "Add more", wrong when the owner is flipping several switches.
  const setSwitch = async (key: Switch, on: boolean, jump = false) => {
    if (!book) return;
    const next: Playbook =
      key === "people"
        ? { ...book, humanEscalation: on }
        : key === "outbound"
          ? { ...book, hasSales: on }
          : { ...book, features: { ...book.features, [key]: on } };
    // Show the result at once; the server copy follows.
    qc.setQueryData(qk.playbook, next);
    if (jump && on && key !== "outbound") setTab(key);
    try {
      if (!IS_MOCK) {
        await mutations.savePlaybook(
          key === "people" ? { humanEscalation: on } : key === "outbound" ? { hasSales: on } : { features: { [key]: on } },
        );
        void qc.invalidateQueries({ queryKey: ["setup"] });
      }
    } catch (error) {
      qc.setQueryData(qk.playbook, book);
      toast.error(errorText(error, "Could not save that"));
    }
  };

  const addSection = (s: Section) => {
    if (s === "knowledge") {
      setKnowledgeOpened(true);
      setTab("knowledge");
    } else if (s !== "business") {
      void setSwitch(s, true, true);
    }
  };

  return (
    <>
      <PageHead
        title="Workspace setup"
        sub="Only what your business uses. Switch things on when you need them — or just tell Swara and she fills it in"
        actions={
          <Button variant="primary" onClick={() => openSwara()}>
            <Sparkles className="size-3.5" />
            Talk to Swara
          </Button>
        }
      />

      <div className="grid gap-3.5 lg:grid-cols-[320px_1fr]">
        <div className="space-y-3.5 lg:sticky lg:top-[76px] lg:self-start">
          <Card interactive={false}>
            <div className="flex items-start gap-3">
              <SwaraOrb size={40} />
              <div className="min-w-0">
                <div className="font-[family-name:var(--font-display)] text-[14.5px] font-semibold text-t1">Set up by talking</div>
                <p className="mt-0.5 text-[11.5px] leading-relaxed text-t3">
                  Tell Swara what you do and who a call should reach. She saves each answer here as you chat — and can
                  change or remove people, teams and bookable types the same way.
                </p>
                <Button size="sm" variant="subtle" className="mt-2.5" onClick={() => openSwara()}>
                  <Sparkles className="size-3.5" /> Open Swara
                </Button>
              </div>
            </div>
          </Card>

          <ReadinessCard
            useCase={useCase}
            shown={shown}
            status={status.data}
            people={people.data ?? []}
            teams={(departments.data ?? []).filter((d) => !d.system)}
            peopleOn={switches?.people ?? true}
            onJump={setTab}
          />
        </div>

        <div className="min-w-0">
          <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
            <Tabs tabs={visibleTabs} value={active} onChange={setTab} />
            {book && hidden.length ? (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] text-t3">Add more</span>
                {hidden.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => addSection(s)}
                    className="glass flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] text-t2 transition-colors hover:border-cyan/40 hover:text-t1"
                  >
                    <Plus className="size-3" />
                    {SECTION_LABEL[s]}
                    {savedIn(s) ? <span className="text-t3">· {savedIn(s)} saved</span> : null}
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          {active === "business" ? <BusinessSection onSwitch={setSwitch} /> : null}
          {active === "people" ? <PeopleSection /> : null}
          {active === "complaints" ? <ComplaintsSection onJump={setTab} peopleOn={switches?.people ?? true} /> : null}
          {active === "appointments" ? <AppointmentsSection /> : null}
          {active === "knowledge" ? <KnowledgeSection /> : null}
          {active === "orders" ? <OrdersSection /> : null}
        </div>
      </div>
    </>
  );
}

/** What is in place and what is missing — for the switched-on sections only. */
function ReadinessCard({
  useCase,
  shown,
  status,
  people,
  teams,
  peopleOn,
  onJump,
}: {
  useCase: UseCase;
  shown: Set<Section>;
  status: { appointmentTypes: number; knowledge: number; connectors: number; agents: number } | undefined;
  people: TransferTarget[];
  teams: Department[];
  peopleOn: boolean;
  onJump: (s: Section) => void;
}) {
  const profile = USE_CASES[useCase];
  const fallback = people.find((p) => p.isDefault) ?? null;
  const rows: { section: Section; label: string; value: string; ok: boolean; needed: boolean }[] = [];
  if (shown.has("people")) {
    rows.push({
      section: "people",
      label: "People to reach",
      value: String(people.length),
      ok: people.length > 0,
      needed: true,
    });
  }
  if (shown.has("complaints")) {
    const inbox = teams.some((t) => t.email || t.phone);
    rows.push({
      section: "complaints",
      label: "Complaints go to",
      value: !peopleOn ? "the queue" : fallback ? fallback.name : inbox ? "team inbox" : people.length ? "pick a default" : "nobody yet",
      ok: !peopleOn || Boolean(fallback) || inbox,
      needed: peopleOn,
    });
  }
  if (shown.has("appointments")) {
    rows.push({ section: "appointments", label: "Bookable types", value: String(status?.appointmentTypes ?? 0), ok: (status?.appointmentTypes ?? 0) > 0, needed: true });
  }
  if (shown.has("orders")) {
    rows.push({ section: "orders", label: "Order lookup", value: (status?.connectors ?? 0) > 0 ? "connected" : "not yet", ok: (status?.connectors ?? 0) > 0, needed: true });
  }
  if (shown.has("knowledge")) {
    rows.push({ section: "knowledge", label: "Knowledge docs", value: String(status?.knowledge ?? 0), ok: (status?.knowledge ?? 0) > 0, needed: false });
  }
  const done = rows.filter((r) => r.ok).length;

  return (
    <Card interactive={false}>
      <CardHead
        title="Readiness"
        sub={rows.length ? `${profile.label} · ${done}/${rows.length} in place` : profile.label}
      />
      {rows.length ? (
        <div className="space-y-1.5">
          {rows.map((r) => (
            <button
              key={r.section}
              onClick={() => onJump(r.section)}
              className="flex w-full items-center gap-2.5 rounded-[10px] px-2 py-1.5 text-left transition-colors hover:bg-white/[0.05]"
            >
              <span className={cn("flex size-4 shrink-0 items-center justify-center rounded-full border", r.ok ? "border-cyan bg-cyan/20" : r.needed ? "border-amber/50" : "border-hairline")}>
                {r.ok ? <Check className="size-2.5 text-cyan" strokeWidth={3} /> : null}
              </span>
              <span className="min-w-0 flex-1 truncate text-[12px] text-t1">{r.label}</span>
              <span className={cn("truncate text-[11px]", r.ok || !r.needed ? "text-t3" : "text-amber")}>{r.value}</span>
            </button>
          ))}
        </div>
      ) : (
        <p className="text-[12px] leading-relaxed text-t3">
          Nothing else is switched on. Agents answer from what you tell them; add a section when you need one.
        </p>
      )}
      <p className="mt-3 text-[11px] leading-relaxed text-t3">{profile.hint}</p>
      <Link href="/agents" className="mt-3 flex items-center gap-1.5 text-[11.5px] font-medium text-cyan hover:underline">
        {status?.agents ? `${status.agents} agent${status.agents === 1 ? "" : "s"} built` : "Build agents with Swara"}
        <ArrowRight className="size-3" />
      </Link>
    </Card>
  );
}

/* ── Business ─────────────────────────────────────────────────────────────── */

function BusinessSection({ onSwitch }: { onSwitch: (key: Switch, on: boolean) => Promise<void> }) {
  const query = usePlaybook();

  return (
    <Reveal>
      <div className="space-y-3.5">
        <Card interactive={false}>
          <CardHead title="Your business" sub="Three lines every agent knows. The kind of business only changes what this page suggests." />
          <QueryBoundary query={query} skeleton={<RowsSkeleton rows={3} />}>
            {(book) => <BusinessForm key={`${book.useCase}|${book.businessType}|${book.hours}`} book={book} />}
          </QueryBoundary>
        </Card>

        <Card interactive={false}>
          <CardHead
            title="What do your agents do?"
            sub="Switch on what you use; this page shows only those sections. Switching one off hides it — nothing you saved is deleted."
          />
          <QueryBoundary query={query} skeleton={<RowsSkeleton rows={5} />}>
            {(book) => {
              const state = switchState(book);
              return (
                <div className="divide-y divide-white/[0.05]">
                  {SWITCHES.map((s) => (
                    <div key={s.key} className="flex items-start gap-3.5 py-3 first:pt-0 last:pb-0">
                      <div className="pt-0.5">
                        <Toggle checked={state[s.key]} onChange={(v) => void onSwitch(s.key, v)} label={s.label} />
                      </div>
                      <div className="min-w-0">
                        <div className="text-[13px] font-medium text-t1">{s.label}</div>
                        <p className="mt-0.5 text-[11.5px] leading-relaxed text-t3">{state[s.key] ? s.on : s.off}</p>
                      </div>
                    </div>
                  ))}
                </div>
              );
            }}
          </QueryBoundary>
        </Card>
      </div>
    </Reveal>
  );
}

function BusinessForm({ book }: { book: Playbook }) {
  const qc = useQueryClient();
  const [useCase, setUseCase] = useState<UseCase>(book.useCase);
  const [businessType, setBusinessType] = useState(book.businessType);
  const [hours, setHours] = useState(book.hours);
  const [busy, setBusy] = useState(false);
  const dirty = useCase !== book.useCase || businessType !== book.businessType || hours !== book.hours;
  const profile = USE_CASES[useCase];

  const save = async () => {
    setBusy(true);
    try {
      if (!IS_MOCK) await mutations.savePlaybook({ useCase, businessType: businessType.trim(), hours: hours.trim() });
      toast.success("Saved — agents use it from the next call");
      void qc.invalidateQueries({ queryKey: ["setup"] });
      void qc.invalidateQueries({ queryKey: qk.departmentSuggestions });
    } catch (error) {
      toast.error(errorText(error, "Could not save"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3.5">
      <div className="grid gap-3.5 md:grid-cols-2">
        <Field label="Kind of business">
          <Select<UseCase>
            value={useCase}
            onChange={setUseCase}
            options={UseCaseSchema.options.map((uc) => ({ value: uc, label: USE_CASES[uc].label, hint: USE_CASES[uc].blurb }))}
          />
        </Field>
        <Field label="Working hours">
          <TextInput value={hours} onChange={setHours} placeholder="10:00-19:00 IST, closed Sundays" onSubmit={() => void save()} />
        </Field>
        <div className="md:col-span-2">
          <Field label="What do you do?" hint="One line the agent can say if asked who you are">
            <TextInput value={businessType} onChange={setBusinessType} placeholder="D2C grocery, metro helpline, dental clinic…" onSubmit={() => void save()} />
          </Field>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="primary" disabled={busy || !dirty} onClick={() => void save()}>
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
          Save
        </Button>
        <p className="min-w-0 flex-1 text-[11.5px] leading-relaxed text-t3">
          <span className="text-t2">Swara usually builds:</span> {profile.agents.join(" · ")}
        </p>
      </div>
    </div>
  );
}

/* ── People & teams ───────────────────────────────────────────────────────── */

const digits = (s: string) => s.replace(/\D/g, "");

function reachSummary(p: { contactCalls: boolean; contactEmail: boolean }) {
  return p.contactCalls && p.contactEmail ? "calls and email" : p.contactCalls ? "calls" : "email";
}

function PeopleSection() {
  const people = useTransfers();
  const departments = useDepartments();
  const playbook = usePlaybook();
  const qc = useQueryClient();
  // Which person's form is open: an id, "new", or none.
  const [editing, setEditing] = useState<string | null>(null);

  const teams = (departments.data ?? []).filter((d) => !d.system);
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["setup"] });
    void qc.invalidateQueries({ queryKey: qk.departments });
    void qc.invalidateQueries({ queryKey: qk.departmentSuggestions });
  };

  const remove = async (row: TransferTarget) => {
    try {
      if (!IS_MOCK) await mutations.deleteTransfer(row.id);
      toast.success(`Removed ${row.name}`);
      if (editing === row.id) setEditing(null);
      invalidate();
    } catch (error) {
      toast.error(errorText(error, "Could not remove"));
    }
  };

  const makeDefault = async (row: TransferTarget) => {
    try {
      if (!IS_MOCK) await mutations.saveTransfer({ ...row, isDefault: true });
      toast.success(`${row.name} now gets anything no team owns`);
      invalidate();
    } catch (error) {
      toast.error(errorText(error, "Could not update"));
    }
  };

  return (
    <Reveal>
      <div className="space-y-3.5">
        <Card interactive={false}>
          <CardHead
            title="People"
            sub="Anyone a call should reach — entered once. Tick how each wants to be reached; agents use this for live transfers and for telling them after a call."
            action={
              editing === null ? (
                <Button variant="primary" size="sm" onClick={() => setEditing("new")}>
                  <Plus className="size-3.5" />
                  Add a person
                </Button>
              ) : null
            }
          />

          {editing === "new" ? (
            <PersonForm
              initial={null}
              teams={teams}
              firstPerson={(people.data?.length ?? 0) === 0}
              onCancel={() => setEditing(null)}
              onSaved={() => {
                setEditing(null);
                invalidate();
              }}
            />
          ) : null}

          <QueryBoundary query={people} skeleton={<RowsSkeleton rows={3} />}>
            {(rows) =>
              rows.length === 0 ? (
                editing === "new" ? null : (
                  <div className="rounded-[14px] border border-dashed border-hairline p-4 text-[12.5px] leading-relaxed text-t3">
                    Nobody yet. Agents will take a callback note and nobody is told about it. Add yourself first — one
                    person is enough for most businesses.
                  </div>
                )
              ) : (
                <div>
                  {rows.length > 1 && !rows.some((r) => r.isDefault) ? (
                    <div className="mb-2 rounded-[12px] border border-amber/25 bg-amber/[0.07] px-3 py-2 text-[11.5px] leading-relaxed text-t2">
                      Pick a default contact (the star) — the person who gets anything no team owns. Until then such
                      items wait in the Unassigned queue.
                    </div>
                  ) : null}
                  {rows.map((p) =>
                    editing === p.id ? (
                      <PersonForm
                        key={p.id}
                        initial={p}
                        teams={teams}
                        firstPerson={false}
                        onCancel={() => setEditing(null)}
                        onSaved={() => {
                          setEditing(null);
                          invalidate();
                        }}
                      />
                    ) : (
                      <ListRow key={p.id}>
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-1.5 text-[13px] text-t1">
                            <span className="font-medium">{p.name}</span>
                            <span className="text-t3">· {p.role}</span>
                            {p.contactCalls ? (
                              <Pill tone="cyan"><Phone className="size-2.5" /> Calls</Pill>
                            ) : null}
                            {p.contactEmail ? (
                              <Pill tone="violet"><Mail className="size-2.5" /> Email</Pill>
                            ) : null}
                            {p.department ? <Pill tone="grey">{p.department}</Pill> : null}
                            {p.isDefault ? <Pill tone="amber">Default contact</Pill> : null}
                          </span>
                          <span className="mt-0.5 block truncate text-[11px] text-t3">
                            {[p.contactCalls ? p.phone : "", p.contactEmail ? p.email : ""].filter(Boolean).map((c, i) => (
                              <span key={c}>
                                {i ? " · " : ""}
                                <Mono>{c}</Mono>
                              </span>
                            ))}
                            {p.hours ? ` · ${p.hours}` : ""} — {p.whenToUse}
                          </span>
                        </span>
                        {!p.isDefault ? (
                          <Button size="sm" variant="subtle" title="Make default contact" onClick={() => void makeDefault(p)}>
                            <Star className="size-3" />
                          </Button>
                        ) : null}
                        <Button size="sm" variant="subtle" onClick={() => setEditing(p.id)}>
                          <Pencil className="size-3" />
                          Edit
                        </Button>
                        <Button size="sm" variant="subtle" title={`Remove ${p.name}`} onClick={() => void remove(p)}>
                          <Trash2 className="size-3" />
                        </Button>
                      </ListRow>
                    ),
                  )}
                </div>
              )
            }
          </QueryBoundary>

          <p className="mt-4 border-t border-white/[0.05] pt-3 text-[11.5px] leading-relaxed text-t3">
            Whether an agent <span className="text-t2">connects the caller live</span> or only{" "}
            <span className="text-t2">informs the person after the call</span> is chosen per agent —{" "}
            <Link href="/agents" className="text-cyan hover:underline">Agents → Agent role → When a call needs a person</Link>.
            If a live transfer is not answered, the caller is told to expect a callback and the person is informed
            straight away.
          </p>
        </Card>

        <TeamsCard teams={teams} people={people.data ?? []} unassignedOpen={departments.data?.find((d) => d.system)?.openActions ?? 0} onChanged={invalidate} />

        {playbook.data ? <PolicyCard key={playbook.data.transferPolicy} initial={playbook.data.transferPolicy} /> : null}
      </div>
    </Reveal>
  );
}

const NEW_TEAM = "__new__";

function PersonForm({
  initial,
  teams,
  firstPerson,
  onCancel,
  onSaved,
}: {
  initial: TransferTarget | null;
  teams: Department[];
  firstPerson: boolean;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [role, setRole] = useState(initial?.role ?? "");
  const [calls, setCalls] = useState(initial ? initial.contactCalls : true);
  const [phone, setPhone] = useState(initial?.phone ?? "");
  const [email, setEmail] = useState(initial ? initial.contactEmail : false);
  const [address, setAddress] = useState(initial?.email ?? "");
  const [teamId, setTeamId] = useState(initial?.departmentId ?? "");
  const [newTeam, setNewTeam] = useState("");
  const [isDefault, setIsDefault] = useState(initial ? initial.isDefault : firstPerson);
  const [whenToUse, setWhenToUse] = useState(initial?.whenToUse ?? "");
  const [hours, setHours] = useState(initial?.hours ?? "");
  const [whatsapp, setWhatsapp] = useState(initial?.whatsapp ?? "");
  const [more, setMore] = useState(Boolean(initial?.hours || initial?.whatsapp));
  const [busy, setBusy] = useState(false);

  const problem = !name.trim()
    ? "Add a name"
    : !calls && !email
      ? "Tick Calls, Email, or both"
      : calls && digits(phone).length < 10
        ? "Add a full phone number for calls"
        : email && !/^\S+@\S+\.\S+$/.test(address.trim())
          ? "Add a valid email address"
          : teamId === NEW_TEAM && !newTeam.trim()
            ? "Name the new team"
            : null;

  const save = async () => {
    if (problem) {
      toast.error(problem);
      return;
    }
    setBusy(true);
    try {
      let departmentId: string | null = teamId && teamId !== NEW_TEAM ? teamId : null;
      if (!IS_MOCK) {
        if (teamId === NEW_TEAM) departmentId = (await mutations.saveDepartment({ name: newTeam.trim() })).id;
        await mutations.saveTransfer({
          id: initial?.id,
          name: name.trim(),
          role: role.trim(),
          phone: phone.trim(),
          email: address.trim(),
          whatsapp: whatsapp.trim(),
          contactCalls: calls,
          contactEmail: email,
          isDefault,
          hours: hours.trim(),
          whenToUse: whenToUse.trim(),
          departmentId,
        });
      }
      toast.success(
        initial
          ? `${name.trim()} updated`
          : `${name.trim()} added — reached by ${reachSummary({ contactCalls: calls, contactEmail: email })}`,
      );
      onSaved();
    } catch (error) {
      toast.error(errorText(error, "Could not save this person"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mb-3 rounded-[16px] border border-cyan/20 bg-cyan/[0.03] p-4">
      <div className="mb-3 text-[12.5px] font-medium text-t1">{initial ? `Edit ${initial.name}` : "New person"}</div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name">
          <TextInput value={name} onChange={setName} placeholder="Priya Desai" autoFocus={!initial} />
        </Field>
        <Field label="What they do (optional)">
          <TextInput value={role} onChange={setRole} placeholder="Owner, manager, billing…" />
        </Field>
      </div>

      <div className="mt-4 text-[11.5px] font-medium text-t2">How do they want to be reached?</div>
      <div className="mt-2 grid gap-3 sm:grid-cols-2">
        <div className="rounded-[14px] border border-hairline p-3">
          <Checkbox
            checked={calls}
            onChange={setCalls}
            label="Calls"
            hint="Can be connected to a caller live, and called after a call"
          />
          {calls ? (
            <TextInput className="mt-2.5" value={phone} onChange={setPhone} placeholder="+91 98200 11122" type="tel" />
          ) : null}
        </div>
        <div className="rounded-[14px] border border-hairline p-3">
          <Checkbox checked={email} onChange={setEmail} label="Email" hint="Gets the details in writing after a call" />
          {email ? (
            <TextInput className="mt-2.5" value={address} onChange={setAddress} placeholder="priya@yourcompany.in" type="email" />
          ) : null}
        </div>
      </div>
      {!calls && email ? (
        <p className="mt-2 text-[11px] leading-relaxed text-amber">
          Email only: agents cannot put a caller through to {name.trim() || "this person"} — they are told after the call.
        </p>
      ) : null}

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Field label="Team (optional)">
          <Select
            value={teamId}
            onChange={setTeamId}
            options={[
              { value: "", label: "No team" },
              ...teams.map((t) => ({ value: t.id, label: t.name })),
              { value: NEW_TEAM, label: "New team…", hint: "Only if different people handle different things" },
            ]}
          />
        </Field>
        {teamId === NEW_TEAM ? (
          <Field label="New team name">
            <TextInput value={newTeam} onChange={setNewTeam} placeholder="Billing" autoFocus />
          </Field>
        ) : (
          <Field label="When should an agent bring them in? (optional)">
            <TextInput value={whenToUse} onChange={setWhenToUse} placeholder="Caller asks for a person, or the agent is stuck" />
          </Field>
        )}
      </div>

      <div className="mt-4">
        <Checkbox
          checked={isDefault}
          onChange={setIsDefault}
          label="Default contact"
          hint="Gets anything no team owns. One person at a time."
        />
      </div>

      <button
        type="button"
        onClick={() => setMore((m) => !m)}
        className="mt-3 flex items-center gap-1 text-[11.5px] text-t3 transition-colors hover:text-t1"
      >
        <ChevronDown className={cn("size-3 transition-transform", more && "rotate-180")} />
        More details
      </button>
      {more ? (
        <div className="mt-2.5 grid gap-3 sm:grid-cols-2">
          <Field label="Available" hint="Agents will say when they can be reached">
            <TextInput value={hours} onChange={setHours} placeholder="10:00-19:00 IST" />
          </Field>
          <Field label="WhatsApp number" hint="Only if different from the phone above">
            <TextInput value={whatsapp} onChange={setWhatsapp} placeholder="+91 98…" type="tel" />
          </Field>
          {teamId === NEW_TEAM ? (
            <Field label="When should an agent bring them in?">
              <TextInput value={whenToUse} onChange={setWhenToUse} placeholder="Caller asks for a person, or the agent is stuck" />
            </Field>
          ) : null}
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button variant="primary" disabled={busy} onClick={() => void save()}>
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
          {initial ? "Save changes" : "Add person"}
        </Button>
        <Button variant="subtle" onClick={onCancel}>Cancel</Button>
        {problem ? <span className="text-[11px] text-t3">{problem}</span> : null}
      </div>
    </div>
  );
}

function TeamsCard({
  teams,
  people,
  unassignedOpen,
  onChanged,
}: {
  teams: Department[];
  people: TransferTarget[];
  unassignedOpen: number;
  onChanged: () => void;
}) {
  const suggestions = useDepartmentSuggestions();
  const [editing, setEditing] = useState<string | null>(null);
  const fallback = people.find((p) => p.isDefault);

  const addSuggested = async (s: { slug: string; name: string; keywords: string[] }) => {
    try {
      if (!IS_MOCK) await mutations.saveDepartment(s);
      toast.success(`Added ${s.name}`);
      onChanged();
    } catch (error) {
      toast.error(errorText(error, "Could not add team"));
    }
  };

  const remove = async (team: Department) => {
    try {
      const res = IS_MOCK ? { ok: true, movedTo: null, openMoved: 0 } : await mutations.deleteDepartment(team.id);
      toast.success(
        res.movedTo
          ? `Removed ${team.name} — its work moved to ${res.movedTo}${res.openMoved ? ` (${res.openMoved} still open)` : ""}`
          : `Removed ${team.name}`,
      );
      if (editing === team.id) setEditing(null);
      onChanged();
    } catch (error) {
      toast.error(errorText(error, "Could not remove team"));
    }
  };

  return (
    <Card interactive={false}>
      <CardHead
        title={
          <span className="flex items-center gap-2">
            Teams <Pill tone="grey">optional</Pill>
          </span>
        }
        sub={
          teams.length
            ? "A complaint goes to the team whose words it matches, and to that team's people. Anything else goes to your default contact."
            : `Only if different people handle different things. Without teams, everything goes to ${fallback ? fallback.name : "your default contact"}.`
        }
        action={
          editing === null ? (
            <Button size="sm" variant="subtle" onClick={() => setEditing("new")}>
              <Plus className="size-3.5" />
              Add a team
            </Button>
          ) : null
        }
      />

      {editing === "new" ? (
        <TeamForm initial={null} onCancel={() => setEditing(null)} onSaved={() => { setEditing(null); onChanged(); }} />
      ) : null}

      {teams.map((t) => {
        const members = people.filter((p) => p.departmentId === t.id);
        const inbox = [t.email, t.phone && `☏ ${t.phone}`].filter(Boolean).join(" · ");
        return editing === t.id ? (
          <TeamForm key={t.id} initial={t} onCancel={() => setEditing(null)} onSaved={() => { setEditing(null); onChanged(); }} />
        ) : (
          <ListRow key={t.id}>
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-1.5 text-[13px] text-t1">
                <span className="font-medium">{t.name}</span>
                {t.openActions ? <Pill tone="amber">{t.openActions} open</Pill> : null}
                {!members.length && !inbox ? <Pill tone="grey">nobody to inform</Pill> : null}
              </span>
              <span className="mt-0.5 block truncate text-[11px] text-t3">
                {members.length ? members.map((m) => m.name).join(", ") : "No people"}
                {inbox ? ` · inbox ${inbox}` : ""}
                {t.keywords?.length ? ` — routes on: ${t.keywords.join(", ")}` : " — no routing words"}
              </span>
            </span>
            <Button size="sm" variant="subtle" onClick={() => setEditing(t.id)}>
              <Pencil className="size-3" />
              Edit
            </Button>
            <Button size="sm" variant="subtle" title={`Remove ${t.name}`} onClick={() => void remove(t)}>
              <Trash2 className="size-3" />
            </Button>
          </ListRow>
        );
      })}

      {suggestions.data?.length ? (
        <div className={cn("flex flex-wrap items-center gap-1.5", teams.length || editing ? "mt-3" : "")}>
          <span className="text-[11px] text-t3">Common for your kind of business:</span>
          {suggestions.data.map((s) => (
            <button
              key={s.slug}
              type="button"
              onClick={() => void addSuggested(s)}
              className="glass flex items-center gap-1 rounded-full px-2.5 py-1 text-[11.5px] text-t2 transition-colors hover:border-cyan/40 hover:text-t1"
            >
              <Plus className="size-3" />
              {s.name}
            </button>
          ))}
        </div>
      ) : null}

      {unassignedOpen > 0 ? (
        <Link href="/queue" className="mt-3 flex items-center gap-1.5 text-[11.5px] font-medium text-amber hover:underline">
          {unassignedOpen} open item{unassignedOpen === 1 ? "" : "s"} in the Unassigned queue
          <ArrowRight className="size-3" />
        </Link>
      ) : null}
    </Card>
  );
}

function TeamForm({ initial, onCancel, onSaved }: { initial: Department | null; onCancel: () => void; onSaved: () => void }) {
  const [name, setName] = useState(initial?.name ?? "");
  const [keywords, setKeywords] = useState((initial?.keywords ?? []).join(", "));
  const [email, setEmail] = useState(initial?.email ?? "");
  const [phone, setPhone] = useState(initial?.phone ?? "");
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      if (!IS_MOCK) {
        await mutations.saveDepartment({
          id: initial?.id,
          name: name.trim(),
          keywords: keywords.split(",").map((k) => k.trim()).filter(Boolean),
          // Sent even when empty, so clearing a field clears it.
          email: email.trim(),
          phone: phone.trim(),
        });
      }
      toast.success(initial ? `${name.trim()} updated` : `${name.trim()} team added`);
      onSaved();
    } catch (error) {
      toast.error(errorText(error, "Could not save team"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mb-3 rounded-[16px] border border-cyan/20 bg-cyan/[0.03] p-4">
      <div className="mb-3 text-[12.5px] font-medium text-t1">{initial ? `Edit ${initial.name}` : "New team"}</div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Team name">
          <TextInput value={name} onChange={setName} placeholder="Housekeeping" autoFocus={!initial} onSubmit={() => void save()} />
        </Field>
        <Field label="Route on these words" hint="Comma-separated — what a caller would say">
          <TextInput value={keywords} onChange={setKeywords} placeholder="dirty, garbage, toilet" onSubmit={() => void save()} />
        </Field>
        <Field label="Shared inbox (optional)" hint="Used when nobody on the team is listed above">
          <TextInput value={email} onChange={setEmail} type="email" placeholder="housekeeping@yourcompany.in" />
        </Field>
        <Field label="Desk phone (optional)">
          <TextInput value={phone} onChange={setPhone} type="tel" placeholder="+91 98…" />
        </Field>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="primary" disabled={busy || !name.trim()} onClick={() => void save()}>
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
          {initial ? "Save changes" : "Add team"}
        </Button>
        <Button variant="subtle" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}

/** One free-text rule saved on its own, next to the thing it is about. */
function PolicyCard({ initial }: { initial: string }) {
  const qc = useQueryClient();
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      if (!IS_MOCK) await mutations.savePlaybook({ transferPolicy: value.trim() });
      toast.success("Saved — agents use it from the next call");
      void qc.invalidateQueries({ queryKey: ["setup"] });
    } catch (error) {
      toast.error(errorText(error, "Could not save"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card interactive={false}>
      <CardHead title="When should an agent bring a person in?" sub="Optional. One or two sentences, in your words — every agent follows it." />
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        rows={3}
        className="glass w-full resize-y rounded-[14px] p-3.5 text-[13px] text-t1 outline-none focus:border-cyan/45"
        placeholder="When the caller asks twice, when it is about money, or immediately for anything about safety."
      />
      <Button className="mt-3" variant="primary" disabled={busy || value === initial} onClick={() => void save()}>
        {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
        Save
      </Button>
    </Card>
  );
}

/* ── Complaints ───────────────────────────────────────────────────────────── */

function ComplaintsSection({ onJump, peopleOn }: { onJump: (s: Section) => void; peopleOn: boolean }) {
  const playbook = usePlaybook();
  const people = useTransfers();
  const departments = useDepartments();
  const teams = (departments.data ?? []).filter((d) => !d.system);
  const unassigned = departments.data?.find((d) => d.system);
  const fallback = (people.data ?? []).find((p) => p.isDefault);

  return (
    <Reveal>
      <Card interactive={false}>
        <CardHead
          title="Complaints and requests"
          sub="An agent files each one with a reference number while the caller is on the line. This is where it goes next."
        />

        <div className="space-y-2 rounded-[14px] border border-hairline p-3.5 text-[12.5px] leading-relaxed text-t2">
          {teams.length ? (
            <p>
              <span className="text-t1">1.</span> To the team whose words it matches —{" "}
              <span className="text-t1">{teams.map((t) => t.name).join(", ")}</span> — and that team&apos;s people.
            </p>
          ) : null}
          <p>
            <span className="text-t1">{teams.length ? "2." : "1."}</span>{" "}
            {!peopleOn ? (
              <>Into the queue. &ldquo;Pass callers to a person&rdquo; is off, so nobody is informed.</>
            ) : fallback ? (
              <>
                {teams.length ? "Anything else goes" : "Everything goes"} to <span className="text-t1">{fallback.name}</span>, by{" "}
                {reachSummary(fallback)}.
              </>
            ) : (
              <>
                {teams.length ? "Anything else waits" : "Everything waits"} in the Unassigned queue —{" "}
                <span className="text-amber">nobody is the default contact yet</span>.
              </>
            )}
          </p>
          <p className="text-[11.5px] text-t3">
            When they are told — on the call or after it — is set on each agent. Tickets a person closes by replying or
            calling back close themselves.
          </p>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {peopleOn ? (
            <Button size="sm" variant="ghost" onClick={() => onJump("people")}>
              People &amp; teams
              <ArrowRight className="size-3" />
            </Button>
          ) : null}
          {unassigned?.openActions ? (
            <Link
              href="/queue"
              className="glass inline-flex items-center gap-1.5 rounded-[11px] px-[11px] py-1.5 text-xs font-medium text-amber"
            >
              {unassigned.openActions} unassigned
              <ArrowRight className="size-3" />
            </Link>
          ) : null}
        </div>

        <div className="mt-5 border-t border-white/[0.05] pt-4">
          {playbook.data ? <SlaForm key={playbook.data.complaintSlaHours} initial={playbook.data.complaintSlaHours} /> : null}
        </div>
      </Card>
    </Reveal>
  );
}

function SlaForm({ initial }: { initial: number }) {
  const qc = useQueryClient();
  const [value, setValue] = useState(String(initial));
  const [busy, setBusy] = useState(false);
  const hours = Math.round(Number(value));
  const valid = Number.isFinite(hours) && hours >= 1 && hours <= 168;

  const save = async () => {
    if (!valid) {
      toast.error("Between 1 and 168 hours");
      return;
    }
    setBusy(true);
    try {
      if (!IS_MOCK) await mutations.savePlaybook({ complaintSlaHours: hours });
      toast.success(`Complaints are now due within ${hours} hours`);
      void qc.invalidateQueries({ queryKey: ["setup"] });
    } catch (error) {
      toast.error(errorText(error, "Could not save"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="w-44">
        <Field label="Resolve within (hours)" hint="Sets the due time on every new ticket">
          <TextInput value={value} onChange={setValue} onSubmit={() => void save()} />
        </Field>
      </div>
      <Button variant="primary" className="mb-[22px]" disabled={busy || !valid || hours === initial} onClick={() => void save()}>
        {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
        Save
      </Button>
    </div>
  );
}

/* ── Appointments ─────────────────────────────────────────────────────────── */

function AppointmentsSection() {
  const query = useAppointmentTypes();
  const playbook = usePlaybook();
  const qc = useQueryClient();
  const empty = { name: "", durationMin: "30", hours: "", location: "", notes: "" };
  const [form, setForm] = useState(empty);

  const save = async () => {
    if (!form.name.trim()) {
      toast.error("Name the appointment type");
      return;
    }
    try {
      if (!IS_MOCK) {
        await mutations.saveAppointment({
          name: form.name.trim(),
          durationMin: Number(form.durationMin) || 30,
          hours: form.hours,
          location: form.location,
          notes: form.notes,
          days: ["mon", "tue", "wed", "thu", "fri"],
        });
      }
      toast.success(`${form.name} can now be booked`);
      setForm(empty);
      void qc.invalidateQueries({ queryKey: ["setup"] });
    } catch (error) {
      toast.error(errorText(error, "Could not save appointment type"));
    }
  };

  const remove = async (row: AppointmentType) => {
    try {
      if (!IS_MOCK) await mutations.deleteAppointment(row.id);
      toast.success(`Removed ${row.name}`);
      void qc.invalidateQueries({ queryKey: ["setup"] });
    } catch (error) {
      toast.error(errorText(error, "Could not remove"));
    }
  };

  return (
    <Reveal>
      <div className="space-y-3.5">
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
                    <Button size="sm" variant="subtle" title={`Remove ${a.name}`} onClick={() => void remove(a)}>
                      <Trash2 className="size-3" />
                    </Button>
                  </ListRow>
                ))
              )
            }
          </QueryBoundary>
        </Card>

        {playbook.data ? <BookingRulesCard key={playbook.data.bookingPolicy} initial={playbook.data.bookingPolicy} /> : null}
      </div>
    </Reveal>
  );
}

function BookingRulesCard({ initial }: { initial: string }) {
  const qc = useQueryClient();
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      if (!IS_MOCK) await mutations.savePlaybook({ bookingPolicy: value.trim() });
      toast.success("Saved — agents use it from the next call");
      void qc.invalidateQueries({ queryKey: ["setup"] });
    } catch (error) {
      toast.error(errorText(error, "Could not save"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card interactive={false}>
      <CardHead title="Booking rules" sub="Optional. Anything every booking must respect." />
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        rows={3}
        className="glass w-full resize-y rounded-[14px] p-3.5 text-[13px] text-t1 outline-none focus:border-cyan/45"
        placeholder="No same-day bookings after 4pm. Confirm by SMS."
      />
      <Button className="mt-3" variant="primary" disabled={busy || value === initial} onClick={() => void save()}>
        {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
        Save
      </Button>
    </Card>
  );
}

/* ── Knowledge ────────────────────────────────────────────────────────────── */

function KnowledgeSection() {
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
      void qc.invalidateQueries({ queryKey: ["setup"] });
    } catch (error) {
      toast.error(errorText(error, "Could not ingest document"));
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

/* ── Orders ───────────────────────────────────────────────────────────────── */

function OrdersSection() {
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
      void qc.invalidateQueries({ queryKey: ["setup"] });
    } catch (error) {
      toast.error(errorText(error, "Could not save connector"));
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
            <Select<"demo" | "rest">
              value={kind}
              onChange={setKind}
              options={[
                { value: "demo", label: "Demo catalogue (no setup)", hint: "Deterministic orders for test calls" },
                { value: "rest", label: "Your order API", hint: "GET endpoint, we append order_id or phone" },
              ]}
            />
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
