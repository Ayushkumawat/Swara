"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import {
  Check,
  FileText,
  Globe,
  History,
  Loader2,
  Mic,
  PhoneOutgoing,
  Plus,
  RotateCcw,
  Sparkles,
  Trash2,
  TriangleAlert,
  Undo2,
  Upload,
} from "lucide-react";
import { PageHead } from "@/components/chrome/page-head";
import { Card, CardHead } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/ui/pill";
import { Tabs, TextInput, Field, Select } from "@/components/ui/controls";
import { LIVE_VOICES } from "@/lib/live/config";
import { CardSkeleton, EmptyState, QueryBoundary, RowsSkeleton } from "@/components/ui/feedback";
import { ListRow, Mono } from "@/components/ui/table";
import { Reveal } from "@/components/motion/primitives";
import { Waveform } from "@/components/ui/live";
import { IS_MOCK, mutations } from "@/lib/api/client";
import { AGENT_TEMPLATES, templateById } from "@/lib/agents/templates";
import { compileFlow, NODE_KIND_LABEL, newNode, validateFlow } from "@/lib/agents/flow";
import {
  qk,
  useAgentTemplates,
  useAgentVersions,
  useAgents,
  useAppointmentTypes,
  useKnowledge,
  useTransfers,
} from "@/lib/api/hooks";
import { useUi } from "@/lib/ui-store";
import { INTENT_LABEL, type Agent, type AgentPlan, type FlowEdge, type FlowNode } from "@/lib/api/schemas";
import { cn, initialsOf, relativeTime } from "@/lib/utils";
import type { FlowSelection } from "@/components/flow/flow-canvas";
import { NodeInspector } from "@/components/flow/node-inspector";
import { BuildWithSwara } from "@/components/agents/build-with-swara";
import { SwaraChat } from "@/components/agents/swara-chat";
import { Modal } from "@/components/ui/modal";

// The canvas carries drag handling and per-node SVG; only the Flow builder
// tab needs it, so it loads when that tab is first opened.
const FlowCanvas = dynamic(() => import("@/components/flow/flow-canvas").then((m) => m.FlowCanvas), {
  loading: () => <CardSkeleton height={420} />,
});

// Pulls in the Gemini SDK and the whole audio stack, and is only reachable by
// clicking "Test call" — exactly the shape of thing that should not be in the
// first-paint bundle of a dashboard page.
const CallPanel = dynamic(() => import("@/components/live/call-panel").then((m) => m.CallPanel));

type Tab = "flow" | "prompt" | "knowledge" | "test" | "versions";

const TABS = [
  { value: "flow" as const, label: "Flow builder" },
  { value: "prompt" as const, label: "Agent role" },
  { value: "knowledge" as const, label: "Knowledge base" },
  { value: "test" as const, label: "Test & simulate" },
  { value: "versions" as const, label: "Versions" },
];

export default function AgentsPage() {
  const agentsQuery = useAgents();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("flow");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const openCopilot = useUi((s) => s.openCopilot);
  const [calling, setCalling] = useState<null | "agent" | "swara">(null);
  const [gallery, setGallery] = useState(false);
  const [building, setBuilding] = useState(false);
  const [seedPlan, setSeedPlan] = useState<AgentPlan | null>(null);
  const [deleting, setDeleting] = useState<Agent | null>(null);

  const selected = useMemo(() => {
    const list = agentsQuery.data ?? [];
    return list.find((a) => a.id === selectedId) ?? list[0] ?? null;
  }, [agentsQuery.data, selectedId]);

  const refresh = () => void qc.invalidateQueries({ queryKey: qk.agents });

  const deleteAgent = async (agent: Agent) => {
    try {
      if (!IS_MOCK) await mutations.deleteAgent(agent.id);
      toast.success(`${agent.name} deleted`);
      if (selectedId === agent.id) setSelectedId(null);
      refresh();
    } catch (error) {
      toast.error("Could not delete", { description: error instanceof Error ? error.message : undefined });
    } finally {
      setDeleting(null);
    }
  };

  return (
    <>
      <PageHead
        title="Agents & flows"
        sub="Build, test, and publish voice agents — let Swara design them, or draw the flow yourself"
        actions={
          <>
            <Button variant="ghost" onClick={() => setGallery(true)}>
              Templates
            </Button>
            <Button variant="ghost" onClick={() => setCalling("swara")} title="Ask Swara — she interviews you and drafts the agents">
              <Sparkles className="size-3.5" />
              Ask Swara
            </Button>
            <Button variant="primary" onClick={() => { setSeedPlan(null); setBuilding(true); }}>
              <Sparkles className="size-3.5" />
              Build with Swara
            </Button>
          </>
        }
      />

      <div className="grid gap-3.5 lg:grid-cols-[320px_minmax(0,1fr)]">
        <Reveal>
          <Card interactive={false} className="lg:sticky lg:top-[76px]">
            <CardHead
              title="Your agents"
              sub={`${agentsQuery.data?.filter((a) => a.status === "live").length ?? 0} live`}
              action={
                <Button size="sm" variant="subtle" onClick={() => setGallery(true)}>
                  <Plus className="size-3.5" />
                  New
                </Button>
              }
            />
            <QueryBoundary query={agentsQuery} skeleton={<RowsSkeleton rows={5} />}>
              {(agents) =>
                agents.length === 0 ? (
                  <EmptyState
                    title="No agents yet"
                    body="Let Swara design them from a description of your business, or start from a template."
                    action={
                      <Button size="sm" variant="primary" onClick={() => setBuilding(true)}>
                        <Sparkles className="size-3.5" /> Build with Swara
                      </Button>
                    }
                  />
                ) : (
                  <div className="space-y-2">
                    <AnimatePresence initial={false}>
                      {agents.map((a) => (
                        <motion.div
                          key={a.id}
                          layout
                          initial={{ opacity: 0, y: 6 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, x: -12, height: 0 }}
                          transition={{ duration: 0.22 }}
                        >
                          <AgentRow
                            agent={a}
                            active={selected?.id === a.id}
                            onClick={() => setSelectedId(a.id)}
                            onDelete={() => setDeleting(a)}
                          />
                        </motion.div>
                      ))}
                    </AnimatePresence>
                  </div>
                )
              }
            </QueryBoundary>
          </Card>
        </Reveal>

        <Reveal delay={0.08} className="min-w-0">
          <Card interactive={false} className="min-w-0">
            <CardHead
              title={selected ? `${selected.name} — ${tab === "prompt" ? "prompt" : "flow"}` : "Agent"}
              sub={
                selected
                  ? `${selected.mode === "graph" ? "Node-graph mode" : "Single-prompt mode"} · v${selected.version} · autosaved ${relativeTime(selected.updatedAt)}`
                  : undefined
              }
              action={
                selected ? (
                  <div className="flex gap-2">
                    <Button size="sm" variant="ghost" onClick={() => setCalling("agent")}>
                      <PhoneOutgoing className="size-3.5" />
                      Test call
                    </Button>
                    <PublishButton agent={selected} onDone={refresh} />
                  </div>
                ) : null
              }
            />

            <Tabs tabs={TABS} value={tab} onChange={setTab} className="mb-4" />

            {selected ? (
              <>
                {tab === "flow" ? <FlowTab key={selected.id} agent={selected} allAgents={agentsQuery.data ?? []} /> : null}
                {tab === "prompt" ? <PromptTab key={selected.id} agent={selected} /> : null}
                {tab === "knowledge" ? <KnowledgeTab key={selected.id} agentId={selected.id} agentName={selected.name} /> : null}
                {tab === "test" ? <TestTab agent={selected} onStartCall={() => setCalling("agent")} /> : null}
                {tab === "versions" ? <VersionsTab /> : null}
              </>
            ) : agentsQuery.isLoading ? (
              <CardSkeleton height={380} />
            ) : (
              <div className="rounded-[22px] border border-dashed border-hairline p-10 text-center text-[12.5px] text-t3">
                Select an agent, or build one.
              </div>
            )}

            <button
              onClick={() => openCopilot(selected ? `Edit the ${selected.name.toLowerCase()} agent: ` : undefined)}
              className="glass mt-4 flex w-full items-center gap-2.5 rounded-xl px-3.5 py-2.5 text-left transition-colors hover:bg-white/[0.08]"
            >
              <Sparkles className="size-4 shrink-0 text-cyan" strokeWidth={2} />
              <span className="min-w-0 flex-1 truncate text-[12.5px] text-t2">
                Tell the copilot what to change — e.g. &ldquo;confirm spelling of the address before booking&rdquo;
              </span>
              <span className="shrink-0 text-[11.5px] font-medium text-cyan">Ask copilot</span>
            </button>
          </Card>
        </Reveal>
      </div>

      {selected ? (
        <CallPanel
          key={`${selected.id}:${selected.voice ?? ""}`}
          open={calling === "agent"}
          onClose={() => setCalling(null)}
          agentId={selected.id}
          agentName={selected.name}
          languages={selected.languages}
          initialVoice={selected.voice}
          onUseVoice={async (voice) => {
            try {
              if (!IS_MOCK) await mutations.updateAgent(selected.id, { voice });
              toast.success(`${selected.name} now speaks with ${voice}`, { description: "Real calls use this voice from the next call." });
              void qc.invalidateQueries({ queryKey: qk.agents });
            } catch {
              toast.error("Could not save the voice");
            }
          }}
        />
      ) : null}

      <Modal
        open={calling === "swara"}
        onClose={() => setCalling(null)}
        title="Ask Swara"
        sub="She writes the workspace as you chat, then proposes agents for you to approve. Phone calls to your agents are unchanged."
        width={520}
      >
        <SwaraChat
          onSaved={() => {
            void qc.invalidateQueries({ queryKey: ["setup"] });
            void qc.invalidateQueries({ queryKey: qk.departments });
            void qc.invalidateQueries({ queryKey: qk.knowledge });
          }}
          onPlan={(plan) => {
            setSeedPlan(plan);
            setBuilding(true);
            setCalling(null);
            toast("Swara proposed a plan", { description: "Review it and create the agents. A failed retry leaves this plan in place." });
          }}
        />
      </Modal>

      {gallery ? (
        <TemplateGallery
          onClose={() => setGallery(false)}
          onCreated={(id) => {
            setSelectedId(id);
            setGallery(false);
            refresh();
          }}
        />
      ) : null}

      <BuildWithSwara
        open={building}
        seedPlan={seedPlan}
        onClose={() => setBuilding(false)}
        onCreated={(ids) => {
          setBuilding(false);
          setSeedPlan(null);
          refresh();
          if (ids[0]) setSelectedId(ids[0]);
        }}
      />

      <ConfirmDelete agent={deleting} onCancel={() => setDeleting(null)} onConfirm={() => deleting && void deleteAgent(deleting)} />
    </>
  );
}

function PublishButton({ agent, onDone }: { agent: Agent; onDone: () => void }) {
  const transfers = useTransfers();
  const appointments = useAppointmentTypes();
  const agents = useAgents();
  const [busy, setBusy] = useState(false);

  const errors = useMemo(
    () =>
      validateFlow(agent.nodes, agent.edges, {
        transfers: (transfers.data ?? []).map((t) => t.name),
        appointmentTypes: (appointments.data ?? []).map((a) => a.name),
        agents: (agents.data ?? []).map((a) => ({ id: a.id, name: a.name })),
      }).filter((i) => i.level === "error"),
    [agent.nodes, agent.edges, transfers.data, appointments.data, agents.data],
  );

  return (
    <Button
      size="sm"
      variant="primary"
      disabled={busy || agent.status === "live"}
      title={errors.length ? errors[0].message : undefined}
      onClick={async () => {
        if (errors.length) {
          toast.error("Fix the flow before publishing", { description: errors[0].message });
          return;
        }
        setBusy(true);
        try {
          if (!IS_MOCK) await mutations.updateAgent(agent.id, { status: "live" });
          toast.success("Published", { description: "Live on the next inbound call." });
          onDone();
        } catch {
          toast.error("Could not publish");
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
      {agent.status === "live" ? "Live" : "Publish"}
    </Button>
  );
}

function ConfirmDelete({ agent, onCancel, onConfirm }: { agent: Agent | null; onCancel: () => void; onConfirm: () => void }) {
  return (
    <AnimatePresence>
      {agent ? (
        <>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onCancel} className="fixed inset-0 z-[85] bg-void/70 backdrop-blur-sm" />
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98 }}
            className="glass-strong fixed left-1/2 top-1/2 z-[90] w-[min(420px,92vw)] -translate-x-1/2 -translate-y-1/2 rounded-[20px] border border-hairline p-5"
            role="alertdialog"
          >
            <div className="mb-1 flex items-center gap-2 font-[family-name:var(--font-display)] text-[15px] font-semibold text-t1">
              <Trash2 className="size-4 text-coral" /> Delete {agent.name}?
            </div>
            <p className="text-[12.5px] leading-relaxed text-t3">
              Numbers pointing at it are unassigned and any handoff to it in other flows becomes a plain ending. Call
              history is kept.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button size="sm" variant="subtle" onClick={onCancel}>
                Cancel
              </Button>
              <Button size="sm" variant="danger" onClick={onConfirm}>
                Delete agent
              </Button>
            </div>
          </motion.div>
        </>
      ) : null}
    </AnimatePresence>
  );
}

function TemplateGallery({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const templates = useAgentTemplates();
  const [busyId, setBusyId] = useState<string | null>(null);
  const list =
    templates.data ??
    AGENT_TEMPLATES.map((t) => ({ id: t.id, name: t.name, blurb: t.blurb, intent: t.intent, direction: t.direction, needs: t.needs }));

  const create = async (templateId: string) => {
    setBusyId(templateId);
    try {
      const tpl = templateById(templateId);
      const res = IS_MOCK ? { id: `ag_${templateId}` } : await mutations.createAgent({ templateId });
      toast.success(`${tpl?.name ?? "Agent"} draft created`);
      onCreated(res.id);
    } catch {
      toast.error("Could not create agent");
    } finally {
      setBusyId(null);
    }
  };

  const blank = async () => {
    setBusyId("blank");
    try {
      const res = IS_MOCK ? { id: "ag_blank" } : await mutations.createAgent({ name: "New agent", intent: "other", direction: "inbound" });
      onCreated(res.id);
    } catch {
      toast.error("Could not create agent");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-void/70 p-4 backdrop-blur-sm">
      <div className="glass-strong max-h-[86vh] w-[min(860px,100%)] overflow-y-auto rounded-[22px] p-5">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="font-[family-name:var(--font-display)] text-[16px] font-semibold text-t1">Start from a template</h2>
            <p className="mt-1 text-[12px] text-t3">
              Each template ships a graph and a prompt. Finish Workspace setup for the features it needs — transfers,
              slots, departments, orders.
            </p>
          </div>
          <Button size="sm" variant="subtle" onClick={onClose}>
            Close
          </Button>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {list.map((t) => (
            <button
              key={t.id}
              disabled={busyId !== null}
              onClick={() => void create(t.id)}
              className="rounded-[16px] border border-hairline bg-white/[0.04] p-4 text-left transition-colors hover:border-cyan/30 hover:bg-white/[0.07] disabled:opacity-60"
            >
              <div className="flex items-center justify-between">
                <div className="text-[13.5px] font-medium text-t1">{t.name}</div>
                {busyId === t.id ? <Loader2 className="size-3.5 animate-spin text-cyan" /> : null}
              </div>
              <p className="mt-1 text-[12px] leading-relaxed text-t3">{t.blurb}</p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                <Pill tone="violet">{INTENT_LABEL[t.intent]}</Pill>
                <Pill>{t.direction}</Pill>
                {t.needs.map((n) => (
                  <Pill key={n} tone="amber">
                    needs {n}
                  </Pill>
                ))}
              </div>
            </button>
          ))}
          <button
            disabled={busyId !== null}
            onClick={() => void blank()}
            className="rounded-[16px] border border-dashed border-hairline p-4 text-left transition-colors hover:border-cyan/30 hover:bg-white/[0.04]"
          >
            <div className="text-[13.5px] font-medium text-t1">Blank agent</div>
            <p className="mt-1 text-[12px] leading-relaxed text-t3">Empty flow. Add a Start and draw it yourself.</p>
          </button>
        </div>
      </div>
    </div>
  );
}

function AgentRow({ agent, active, onClick, onDelete }: { agent: Agent; active: boolean; onClick: () => void; onDelete: () => void }) {
  const tone = agent.status === "live" ? "cyan" : agent.status === "testing" ? "amber" : "grey";

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onClick()}
      className={cn(
        "group flex w-full gap-3 rounded-[14px] border p-3 text-left transition-colors",
        active ? "border-cyan/35 bg-white/[0.075]" : "border-hairline bg-white/[0.045] hover:bg-white/[0.07]",
      )}
    >
      <span className="grad-brand flex size-9 shrink-0 items-center justify-center rounded-[10px] font-[family-name:var(--font-display)] text-[13px] font-semibold text-void">
        {initialsOf(agent.name)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="block min-w-0 flex-1 truncate text-[13px] font-medium text-t1">{agent.name}</span>
          <button
            type="button"
            aria-label={`Delete ${agent.name}`}
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            className="rounded p-1 text-t3 opacity-0 transition-opacity hover:bg-coral/15 hover:text-coral group-hover:opacity-100 focus:opacity-100"
          >
            <Trash2 className="size-3.5" />
          </button>
        </span>
        <span className="mt-1 flex items-center gap-1.5">
          <Pill tone={tone} className="capitalize">
            {agent.status}
          </Pill>
          {agent.status === "live" ? <Waveform bars={3} height={11} tone="cyan" /> : null}
          <span className="truncate text-[10.5px] text-t3">
            {agent.direction} · {agent.nodes.length ? `${agent.nodes.length} steps` : "prompt only"}
            {agent.callsToday > 0 ? ` · ${agent.callsToday} calls` : ""}
          </span>
        </span>
      </span>
    </div>
  );
}

/* ── Flow builder ─────────────────────────────────────────────────────────── */

type Graph = { nodes: FlowNode[]; edges: FlowEdge[] };

function FlowTab({ agent, allAgents }: { agent: Agent; allAgents: Agent[] }) {
  const qc = useQueryClient();
  const transfers = useTransfers();
  const appointments = useAppointmentTypes();

  const [graph, setGraph] = useState<Graph>({ nodes: agent.nodes, edges: agent.edges });
  const [history, setHistory] = useState<Graph[]>([]);
  const [selection, setSelection] = useState<FlowSelection>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [generating, setGenerating] = useState(false);
  const saveTimer = useRef<number | null>(null);
  const latest = useRef(graph);
  useEffect(() => {
    latest.current = graph;
  }, [graph]);

  // Server truth wins only when it changes underneath us (e.g. copilot edit),
  // not on every refetch after our own save.
  const serverSig = JSON.stringify([agent.nodes, agent.edges]);
  const lastServerSig = useRef(serverSig);
  useEffect(() => {
    if (serverSig !== lastServerSig.current) {
      lastServerSig.current = serverSig;
      const localSig = JSON.stringify([latest.current.nodes, latest.current.edges]);
      if (localSig !== serverSig) setGraph({ nodes: agent.nodes, edges: agent.edges });
    }
  }, [serverSig, agent.nodes, agent.edges]);

  const flush = useCallback(async () => {
    const g = latest.current;
    setSaveState("saving");
    try {
      if (!IS_MOCK) await mutations.updateAgent(agent.id, { nodes: g.nodes, edges: g.edges });
      lastServerSig.current = JSON.stringify([g.nodes, g.edges]);
      setSaveState("saved");
      void qc.invalidateQueries({ queryKey: qk.agents });
      window.setTimeout(() => setSaveState((s) => (s === "saved" ? "idle" : s)), 1800);
    } catch {
      setSaveState("error");
      toast.error("Could not save flow");
    }
  }, [agent.id, qc]);

  /** Every edit goes through here: push undo, set state, debounce a save. */
  const commit = useCallback(
    (next: Graph | ((g: Graph) => Graph), { undoable = true, immediate = false } = {}) => {
      setGraph((prev) => {
        const resolved = typeof next === "function" ? next(prev) : next;
        if (undoable) setHistory((h) => [...h.slice(-29), prev]);
        return resolved;
      });
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => void flush(), immediate ? 0 : 600);
    },
    [flush],
  );

  const undo = () => {
    setHistory((h) => {
      const prev = h[h.length - 1];
      if (!prev) return h;
      setGraph(prev);
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => void flush(), 300);
      return h.slice(0, -1);
    });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        const tag = (e.target as HTMLElement | null)?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA") return;
        e.preventDefault();
        undo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const siblings = useMemo(() => allAgents.filter((a) => a.id !== agent.id).map((a) => ({ id: a.id, name: a.name })), [allAgents, agent.id]);
  const transferNames = (transfers.data ?? []).map((t) => t.name);
  const appointmentNames = (appointments.data ?? []).map((a) => a.name);

  const issues = useMemo(
    () => validateFlow(graph.nodes, graph.edges, { transfers: transferNames, appointmentTypes: appointmentNames, agents: siblings }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [graph, transfers.data, appointments.data, siblings],
  );
  const issueByNode = useMemo(() => {
    const m: Record<string, { level: "error" | "warn"; message: string }> = {};
    for (const i of issues) if (i.nodeId && (!m[i.nodeId] || i.level === "error")) m[i.nodeId] = { level: i.level, message: i.message };
    return m;
  }, [issues]);

  const compiled = useMemo(
    () => compileFlow(graph.nodes, graph.edges, { agents: siblings, allowTransfer: transferNames.length > 0 }),
    [graph, siblings, transferNames.length],
  );
  const [showCompiled, setShowCompiled] = useState(false);

  const addNode = (kind: FlowNode["kind"]) => {
    const anchor = selection?.kind === "node" ? graph.nodes.find((n) => n.id === selection.id) : undefined;
    const node = newNode(
      kind,
      anchor ? anchor.x + 260 : 80 + (graph.nodes.length % 4) * 220,
      anchor ? anchor.y : 80 + Math.floor(graph.nodes.length / 4) * 140,
    );
    commit((g) => ({
      nodes: [...g.nodes, node],
      // Adding from a selected node wires it in automatically.
      edges: anchor && anchor.kind !== "end" && anchor.kind !== "handoff" && anchor.kind !== "escalate"
        ? [...g.edges, { id: `e_${node.id}`, from: anchor.id, to: node.id, tone: kind === "escalate" ? "danger" : "default" }]
        : g.edges,
    }));
    setSelection({ kind: "node", id: node.id });
  };

  const generate = async () => {
    setGenerating(true);
    const tpl = AGENT_TEMPLATES.find((t) => t.intent === agent.intent) ?? AGENT_TEMPLATES[0];
    await new Promise((r) => setTimeout(r, 500));
    commit({ nodes: tpl.nodes, edges: tpl.edges }, { immediate: true });
    setGenerating(false);
    toast.success(`Starter graph from ${tpl.name}`);
  };

  const selectedNode = selection?.kind === "node" ? graph.nodes.find((n) => n.id === selection.id) : undefined;

  if (graph.nodes.length === 0) {
    return (
      <div className="rounded-[22px] border border-dashed border-hairline bg-white/[0.02] p-10 text-center">
        <p className="text-[13px] text-t2">{agent.name} has no flow yet.</p>
        <p className="mx-auto mt-2 max-w-md text-[12px] leading-relaxed text-t3">
          Start from a graph for this agent&apos;s intent, or add a Start node and draw it. Language is never a step —
          the voice follows the caller.
        </p>
        <div className="mt-5 flex justify-center gap-2">
          <Button variant="primary" size="sm" disabled={generating} onClick={() => void generate()}>
            {generating ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
            Generate starter graph
          </Button>
          <Button variant="ghost" size="sm" onClick={() => addNode("start")}>
            <Plus className="size-3.5" /> Start node
          </Button>
        </div>
      </div>
    );
  }

  const errorCount = issues.filter((i) => i.level === "error").length;
  const warnCount = issues.length - errorCount;

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        {(["say", "collect", "intent", "data_pull", "branch", "book", "escalate", "handoff", "end"] as const).map((kind) => (
          <Button key={kind} size="sm" variant="subtle" onClick={() => addNode(kind)} title={NODE_KIND_LABEL[kind]}>
            + {NODE_KIND_LABEL[kind].toLowerCase()}
          </Button>
        ))}
        <span className="mx-1 h-4 w-px bg-hairline" />
        <Button size="sm" variant="subtle" onClick={undo} disabled={history.length === 0} title="Undo (Ctrl+Z)">
          <Undo2 className="size-3.5" />
        </Button>
        <Button size="sm" variant="subtle" onClick={() => setShowCompiled((v) => !v)}>
          {showCompiled ? "Hide" : "Show"} what the agent follows
        </Button>
        <span className="ml-auto flex items-center gap-2 text-[11px]">
          {issues.length ? (
            <span
              className={cn("flex items-center gap-1", errorCount ? "text-coral" : "text-amber")}
              title={issues.map((i) => i.message).join("\n")}
            >
              <TriangleAlert className="size-3.5" />
              {errorCount ? `${errorCount} blocking` : ""}
              {errorCount && warnCount ? " · " : ""}
              {warnCount ? `${warnCount} warning${warnCount === 1 ? "" : "s"}` : ""}
            </span>
          ) : (
            <span className="flex items-center gap-1 text-cyan">
              <Check className="size-3.5" /> flow is runnable
            </span>
          )}
          <SaveIndicator state={saveState} />
        </span>
      </div>

      <div className={cn("grid min-w-0 gap-3", selectedNode ? "lg:grid-cols-[minmax(0,1fr)_300px]" : "")}>
        <div className="min-w-0">
          <FlowCanvas
            nodes={graph.nodes}
            edges={graph.edges}
            selection={selection}
            onSelect={setSelection}
            issues={issueByNode}
            busy={generating}
            onMove={(id, x, y, done) => {
              // Intermediate moves update the local graph without undo/save
              // churn; the drop is the committed edit.
              if (!done) {
                setGraph((g) => ({ ...g, nodes: g.nodes.map((n) => (n.id === id ? { ...n, x, y } : n)) }));
                return;
              }
              commit((g) => ({ ...g, nodes: g.nodes.map((n) => (n.id === id ? { ...n, x, y } : n)) }), { undoable: false });
            }}
            onConnect={(from, to) => {
              if (graph.edges.some((e) => e.from === from && e.to === to)) return;
              const target = graph.nodes.find((n) => n.id === to);
              commit((g) => ({
                ...g,
                edges: [...g.edges, { id: `e_${Date.now().toString(36)}`, from, to, tone: target?.kind === "escalate" ? "danger" : "default" }],
              }));
            }}
            onDeleteNode={(id) => {
              if (graph.nodes.find((n) => n.id === id)?.kind === "start") {
                toast("Start cannot be removed", { description: "Every flow needs an opening." });
                return;
              }
              commit((g) => ({ nodes: g.nodes.filter((n) => n.id !== id), edges: g.edges.filter((e) => e.from !== id && e.to !== id) }));
              setSelection(null);
            }}
            onDeleteEdge={(id) => {
              commit((g) => ({ ...g, edges: g.edges.filter((e) => e.id !== id) }));
              setSelection(null);
            }}
            onRelabelEdge={(id, label) => commit((g) => ({ ...g, edges: g.edges.map((e) => (e.id === id ? { ...e, label: label || undefined } : e)) }))}
          />
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-t3">
            <span>Drag a node to move · drag the dot on its right onto another node to connect · click a wire and press Delete</span>
            <span className="flex items-center gap-1.5">
              <span className="h-px w-4 bg-cyan/60" /> success
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-px w-4 bg-coral/60" /> transfer
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-px w-4 bg-violet/60" /> handoff
            </span>
          </div>
        </div>

        <AnimatePresence>
          {selectedNode ? (
            <motion.aside
              key={selectedNode.id}
              initial={{ opacity: 0, x: 12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 12 }}
              transition={{ duration: 0.2 }}
              className="glass h-fit rounded-[18px] p-4"
            >
              <NodeInspector
                node={selectedNode}
                outgoing={graph.edges.filter((e) => e.from === selectedNode.id)}
                agents={siblings}
                transfers={transferNames}
                appointmentTypes={appointmentNames}
                onChange={(patch) => commit((g) => ({ ...g, nodes: g.nodes.map((n) => (n.id === selectedNode.id ? { ...n, ...patch } : n)) }))}
                onDelete={() => {
                  commit((g) => ({
                    nodes: g.nodes.filter((n) => n.id !== selectedNode.id),
                    edges: g.edges.filter((e) => e.from !== selectedNode.id && e.to !== selectedNode.id),
                  }));
                  setSelection(null);
                }}
                onRelabelEdge={(id, label) => commit((g) => ({ ...g, edges: g.edges.map((e) => (e.id === id ? { ...e, label: label || undefined } : e)) }))}
                onDeleteEdge={(id) => commit((g) => ({ ...g, edges: g.edges.filter((e) => e.id !== id) }))}
              />
            </motion.aside>
          ) : null}
        </AnimatePresence>
      </div>

      <AnimatePresence>
        {showCompiled ? (
          <motion.pre
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="glass mt-3 max-h-64 overflow-auto whitespace-pre-wrap rounded-[14px] p-4 font-[family-name:var(--font-mono)] text-[11.5px] leading-relaxed text-t2"
          >
            {compiled || "(empty flow)"}
          </motion.pre>
        ) : null}
      </AnimatePresence>

      {issues.length ? (
        <ul className="mt-3 space-y-1 text-[11.5px]">
          {issues.slice(0, 5).map((i, idx) => (
            <li key={idx} className={cn("flex items-start gap-1.5", i.level === "error" ? "text-coral" : "text-amber")}>
              <TriangleAlert className="mt-px size-3 shrink-0" />
              <button className="text-left hover:underline" onClick={() => i.nodeId && setSelection({ kind: "node", id: i.nodeId })}>
                {i.message}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}

function SaveIndicator({ state }: { state: "idle" | "saving" | "saved" | "error" }) {
  return (
    <AnimatePresence mode="wait">
      {state !== "idle" ? (
        <motion.span
          key={state}
          initial={{ opacity: 0, y: 2 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -2 }}
          className={cn(
            "flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10.5px]",
            state === "saving" && "border-hairline text-t3",
            state === "saved" && "border-cyan/30 text-cyan",
            state === "error" && "border-coral/30 text-coral",
          )}
        >
          {state === "saving" ? <Loader2 className="size-3 animate-spin" /> : state === "saved" ? <Check className="size-3" /> : <TriangleAlert className="size-3" />}
          {state === "saving" ? "Saving" : state === "saved" ? "Saved" : "Not saved"}
        </motion.span>
      ) : null}
    </AnimatePresence>
  );
}

/* ── Other tabs ───────────────────────────────────────────────────────────── */

function PromptTab({ agent }: { agent: Agent }) {
  const qc = useQueryClient();
  const [prompt, setPrompt] = useState(agent.prompt ?? "");
  const [personaName, setPersonaName] = useState(agent.personaName ?? "");
  const [voice, setVoice] = useState(agent.voice ?? "");
  const [busy, setBusy] = useState(false);
  const identityDirty = personaName !== (agent.personaName ?? "") || voice !== (agent.voice ?? "");

  const save = async () => {
    setBusy(true);
    try {
      if (!IS_MOCK) await mutations.updateAgent(agent.id, { prompt, personaName, ...(voice ? { voice } : {}) });
      toast.success("Role saved — live on the next test call");
      void qc.invalidateQueries({ queryKey: qk.agents });
    } catch {
      toast.error("Could not save prompt");
    } finally {
      setBusy(false);
    }
  };

  const voiceOptions = LIVE_VOICES.map((v) => ({ value: v.name, label: `${v.label} — ${v.gender}, ${v.blurb}` }));

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Introduces itself as" hint="The first name the caller hears. Not the voice's stock name.">
          <TextInput value={personaName} onChange={setPersonaName} placeholder={agent.name} />
        </Field>
        <Field label="Voice on real calls" hint="Try voices in Test, then save the one you like here or from the test panel.">
          <Select value={voice} onChange={setVoice} options={voiceOptions} placeholder="Default for this job" />
        </Field>
      </div>
      {identityDirty ? <p className="-mt-2 text-[11px] text-amber">Unsaved — Save role writes name and voice too.</p> : null}
      <Field
        label="Agent role"
        hint="The detailed role Swara writes for this agent: purpose, tone, how they speak, and what they must never do. Language follow, the flow, and the tool list are added on the call."
      >
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={16}
          placeholder="You handle order status. Get the order ID or registered phone, look it up, lead with the status then the date. Never invent a status."
          className="glass w-full resize-y rounded-[14px] p-4 font-[family-name:var(--font-mono)] text-[12.5px] leading-relaxed text-t1 outline-none transition-colors focus:border-cyan/45"
        />
      </Field>
      <Button variant="primary" onClick={() => void save()} disabled={busy}>
        {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
        Save role
      </Button>

      <div className="glass rounded-[14px] p-3.5">
        <div className="mb-2 text-[11.5px] font-medium text-t2">Actions this agent can take</div>
        <div className="flex flex-wrap gap-2">
          {(agent.tools?.length ? agent.tools : ["end_call"]).map((t) => (
            <Pill key={t} tone="violet">
              <span className="font-[family-name:var(--font-mono)]">{t}</span>
            </Pill>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-t3">
          Only these run on a call. A transfer is included only when a human desk exists. Language is not set here —
          the agent follows whatever language the caller is speaking, and switches when they do.
        </p>
      </div>
    </div>
  );
}

function KnowledgeTab({ agentId, agentName }: { agentId: string; agentName: string }) {
  const query = useKnowledge();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!name.trim() || text.trim().length < 20) {
      toast.error("Name the document and paste at least a short paragraph");
      return;
    }
    setBusy(true);
    try {
      if (!IS_MOCK) await mutations.addKnowledge({ name: name.trim(), kind: "text", text, agentId });
      toast.success("Indexed for this agent");
      setName("");
      setText("");
      void qc.invalidateQueries({ queryKey: qk.knowledge });
    } catch {
      toast.error("Could not ingest");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-[18px] border border-dashed border-hairline bg-white/[0.02] p-6">
        <Upload className="mb-3 size-5 text-t3" strokeWidth={1.6} />
        <p className="text-[13px] text-t1">Knowledge for {agentName}</p>
        <p className="mt-1 mb-3 text-[11.5px] text-t3">
          Only this agent searches these notes. Other agents do not see them. Paste the facts this role is allowed to quote.
        </p>
        <Field label="Name">
          <TextInput value={name} onChange={setName} placeholder="Refund policy" />
        </Field>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={5}
          className="glass mt-2 w-full resize-y rounded-[14px] p-3 font-[family-name:var(--font-mono)] text-[12.5px] text-t1 outline-none"
          placeholder="Paste the text the agent should quote from…"
        />
        <Button className="mt-3" variant="primary" onClick={() => void save()} disabled={busy}>
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
          Add to knowledge base
        </Button>
      </div>

      <QueryBoundary query={query} skeleton={<RowsSkeleton rows={4} />}>
        {(all) => (
          <div>
            {all.filter((d) => d.agentId === agentId).map((d) => (
              <ListRow key={d.id}>
                <span className="flex size-8 shrink-0 items-center justify-center rounded-[9px] bg-white/[0.06]">
                  {d.kind === "url" ? <Globe className="size-3.5 text-t2" strokeWidth={1.7} /> : <FileText className="size-3.5 text-t2" strokeWidth={1.7} />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] text-t1">{d.name}</span>
                  <span className="text-[11px] text-t3">
                    {d.sizeLabel} · {d.chunks.toLocaleString("en-IN")} chunks
                  </span>
                </span>
                <Pill tone={d.status === "indexed" ? "cyan" : d.status === "indexing" ? "amber" : "coral"}>{d.status}</Pill>
              </ListRow>
            ))}
          </div>
        )}
      </QueryBoundary>
    </div>
  );
}

function TestTab({ agent, onStartCall }: { agent: Agent; onStartCall: () => void }) {
  const [phone, setPhone] = useState("+91 ");
  const [dialing, setDialing] = useState(false);

  const dial = async () => {
    const to = phone.replace(/[^\d+]/g, "");
    if (to.replace(/\D/g, "").length < 10) {
      toast.error("Enter a full number");
      return;
    }
    setDialing(true);
    try {
      const res = await fetch("/api/v1/telephony/outbound", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ to, agentId: agent.id }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error ?? "Dial failed");
      toast.success("Dialling", { description: `${agent.name} is calling ${to}.` });
    } catch (error) {
      toast.error("Could not place the call", {
        description: error instanceof Error ? error.message : "Start the Plivo bridge (see docs/telephony.md).",
      });
    } finally {
      setDialing(false);
    }
  };

  return (
    <div className="grid gap-3.5 md:grid-cols-2">
      <div className="glass rounded-[18px] p-4">
        <h4 className="mb-1 font-[family-name:var(--font-display)] text-[13.5px] font-semibold text-t1">Talk to it right now</h4>
        <p className="mb-4 text-[11.5px] leading-relaxed text-t3">
          Speech to speech from this browser against the draft version. Interrupt it mid-sentence, ask for a human, ask
          for something another agent owns — handoffs and the hang-up happen for real.
        </p>
        <Button variant="primary" full onClick={onStartCall}>
          <Mic className="size-3.5" />
          Start voice test
        </Button>

        <div className="mt-4 border-t border-hairline pt-3.5">
          <Field label="Or have it dial a real number" hint="Needs the Plivo bridge running — docs/telephony.md.">
            <TextInput value={phone} onChange={setPhone} placeholder="+91 98765 43210" />
          </Field>
          <Button full className="mt-2.5" onClick={() => void dial()} disabled={dialing}>
            {dialing ? <Loader2 className="size-3.5 animate-spin" /> : <PhoneOutgoing className="size-3.5" />}
            Call me now
          </Button>
        </div>
      </div>

      <div className="glass rounded-[18px] p-4">
        <h4 className="mb-1 font-[family-name:var(--font-display)] text-[13.5px] font-semibold text-t1">What to try</h4>
        <ul className="space-y-2 text-[12px] leading-relaxed text-t2">
          <li>· Speak Hinglish, then switch to English mid-sentence. It should follow without comment.</li>
          <li>· Ask for a manager. It should name a configured desk, or take a callback if none exists.</li>
          <li>· Ask about something another agent owns. It should hand you off with a summary.</li>
          <li>· Say &ldquo;that&apos;s all, thanks&rdquo;. It should close and hang up itself.</li>
          <li>· Give a phone number. It should read it back in pairs before saving anything.</li>
        </ul>
      </div>
    </div>
  );
}

function VersionsTab() {
  const query = useAgentVersions();

  return (
    <QueryBoundary query={query} skeleton={<RowsSkeleton rows={4} />}>
      {(versions) => (
        <div>
          <p className="mb-3 text-[11.5px] text-t3">
            Every publish and every copilot edit is a version. Rolling back takes effect on the next call — no redeploy.
          </p>
          {versions.map((v) => (
            <ListRow key={v.id}>
              <span className="flex size-8 shrink-0 items-center justify-center rounded-[9px] bg-white/[0.06]">
                <History className="size-3.5 text-t2" strokeWidth={1.7} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <Mono className="text-t1">v{v.version}</Mono>
                  <span className="truncate text-[12.5px] text-t1">{v.label}</span>
                </span>
                <span className="mt-0.5 block text-[11px] text-t3">
                  {v.author} · {relativeTime(v.createdAt)}
                </span>
              </span>
              {v.isLive ? (
                <Pill tone="cyan">Live</Pill>
              ) : (
                <Button size="sm" variant="subtle" onClick={() => toast.success(`Rolled back to v${v.version}`)}>
                  <RotateCcw className="size-3" />
                  Roll back
                </Button>
              )}
            </ListRow>
          ))}
        </div>
      )}
    </QueryBoundary>
  );
}
