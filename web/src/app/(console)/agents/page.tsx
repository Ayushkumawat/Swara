"use client";

import dynamic from "next/dynamic";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import {
  Copy,
  FileText,
  Globe,
  History,
  Mic,
  Pause,
  PhoneOutgoing,
  Play,
  Plus,
  RotateCcw,
  Sparkles,
  Trash2,
  Upload,
} from "lucide-react";
import { PageHead } from "@/components/chrome/page-head";
import { Card, CardHead } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/ui/pill";
import { Tabs, TextInput, Field } from "@/components/ui/controls";
import { CardSkeleton, QueryBoundary, RowsSkeleton } from "@/components/ui/feedback";
import { ListRow, Mono } from "@/components/ui/table";
import { Reveal } from "@/components/motion/primitives";
import { Waveform } from "@/components/ui/live";
import { IS_MOCK, mutations } from "@/lib/api/client";
import { AGENT_TEMPLATES, templateById } from "@/lib/agents/templates";
import { qk, useAgentTemplates, useAgentVersions, useAgents, useKnowledge } from "@/lib/api/hooks";
import { useUi } from "@/lib/ui-store";
import { INTENT_LABEL, type Agent, type FlowEdge, type FlowNode } from "@/lib/api/schemas";
import { cn, initialsOf, relativeTime } from "@/lib/utils";

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
  { value: "prompt" as const, label: "Single prompt" },
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
  const [calling, setCalling] = useState(false);
  const [gallery, setGallery] = useState(false);

  const selected = useMemo(() => {
    const list = agentsQuery.data ?? [];
    return list.find((a) => a.id === selectedId) ?? list[0] ?? null;
  }, [agentsQuery.data, selectedId]);

  return (
    <>
      <PageHead
        title="Agents & flows"
        sub="Build, test, and publish voice agents — no-code or full graph control"
        actions={
          <>
            <Button variant="ghost" onClick={() => setGallery(true)}>
              Templates
            </Button>
            <Button variant="primary" onClick={() => setGallery(true)}>
              <Plus className="size-3.5" />
              New agent
            </Button>
          </>
        }
      />

      <div className="grid gap-3.5 lg:grid-cols-[320px_1fr]">
        <Reveal>
          <Card interactive={false} className="lg:sticky lg:top-[76px]">
            <CardHead
              title="Your agents"
              sub={`${agentsQuery.data?.filter((a) => a.status === "live").length ?? 0} live`}
            />
            <QueryBoundary query={agentsQuery} skeleton={<RowsSkeleton rows={5} />}>
              {(agents) => (
                <div className="space-y-2">
                  {agents.map((a) => (
                    <AgentRow
                      key={a.id}
                      agent={a}
                      active={selected?.id === a.id}
                      onClick={() => setSelectedId(a.id)}
                      onChanged={() => void qc.invalidateQueries({ queryKey: qk.agents })}
                      onDeleted={() => {
                        if (selectedId === a.id) setSelectedId(null);
                        void qc.invalidateQueries({ queryKey: qk.agents });
                      }}
                    />
                  ))}
                </div>
              )}
            </QueryBoundary>
          </Card>
        </Reveal>

        <Reveal delay={0.08}>
          <Card interactive={false}>
            <CardHead
              title={selected ? `${selected.name} — ${tab === "prompt" ? "prompt" : "flow"}` : "Agent"}
              sub={
                selected
                  ? `${selected.mode === "graph" ? "Node-graph mode" : "Single-prompt mode"} · v${selected.version} · autosaved ${relativeTime(selected.updatedAt)}`
                  : undefined
              }
              action={
                selected ? (
                  <AgentActions
                    agent={selected}
                    onTest={() => setCalling(true)}
                    onChanged={() => void qc.invalidateQueries({ queryKey: qk.agents })}
                    onDeleted={() => {
                      setSelectedId(null);
                      void qc.invalidateQueries({ queryKey: qk.agents });
                    }}
                  />
                ) : null
              }
            />

            <Tabs tabs={TABS} value={tab} onChange={setTab} className="mb-4" />

            {selected ? (
              <>
                {tab === "flow" ? <FlowTab key={selected.id} agent={selected} /> : null}
                {tab === "prompt" ? <PromptTab key={selected.id} agent={selected} /> : null}
                {tab === "knowledge" ? <KnowledgeTab key={selected.id} agent={selected} /> : null}
                {tab === "test" ? (
                  <TestTab agent={selected} onStartCall={() => setCalling(true)} />
                ) : null}
                {tab === "versions" ? <VersionsTab agent={selected} /> : null}
              </>
            ) : (
              <CardSkeleton height={380} />
            )}

            <button
              onClick={() =>
                openCopilot(
                  selected ? `Edit the ${selected.name.toLowerCase()} agent: ` : undefined,
                )
              }
              className="glass mt-4 flex w-full items-center gap-2.5 rounded-xl px-3.5 py-2.5 text-left transition-colors hover:bg-white/[0.08]"
            >
              <Sparkles className="size-4 shrink-0 text-cyan" strokeWidth={2} />
              <span className="min-w-0 flex-1 truncate text-[12.5px] text-t2">
                Tell the copilot what to change — e.g. &ldquo;confirm spelling of the address before
                booking&rdquo;
              </span>
              <span className="shrink-0 text-[11.5px] font-medium text-cyan">Ask copilot</span>
            </button>
          </Card>
        </Reveal>
      </div>

      {selected ? (
        <CallPanel
          open={calling}
          onClose={() => setCalling(false)}
          agentId={selected.id}
          agentName={selected.name}
          languages={selected.languages}
        />
      ) : null}

      {gallery ? (
        <TemplateGallery
          onClose={() => setGallery(false)}
          onCreated={(id) => {
            setSelectedId(id);
            setGallery(false);
            void qc.invalidateQueries({ queryKey: qk.agents });
          }}
        />
      ) : null}
    </>
  );
}

function TemplateGallery({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const templates = useAgentTemplates();
  const list = templates.data ?? AGENT_TEMPLATES.map((t) => ({
    id: t.id, name: t.name, blurb: t.blurb, intent: t.intent, direction: t.direction, needs: t.needs,
  }));

  const create = async (templateId: string) => {
    try {
      const tpl = templateById(templateId);
      const res = IS_MOCK
        ? { id: `ag_${templateId}` }
        : await mutations.createAgent({ templateId });
      toast.success(`${tpl?.name ?? "Agent"} draft created`);
      onCreated(res.id);
    } catch {
      toast.error("Could not create agent");
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-void/70 p-4 backdrop-blur-sm">
      <div className="glass-strong max-h-[86vh] w-[min(860px,100%)] overflow-y-auto rounded-[22px] p-5">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="font-[family-name:var(--font-display)] text-[16px] font-semibold text-t1">
              Start from a template
            </h2>
            <p className="mt-1 text-[12px] text-t3">
              Each template ships a graph and a prompt. Finish Workspace setup for the features it
              needs — transfers, slots, departments, orders.
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
              onClick={() => void create(t.id)}
              className="rounded-[16px] border border-hairline bg-white/[0.04] p-4 text-left transition-colors hover:border-cyan/30 hover:bg-white/[0.07]"
            >
              <div className="text-[13.5px] font-medium text-t1">{t.name}</div>
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
        </div>
      </div>
    </div>
  );
}

async function setAgentStatus(id: string, status: Agent["status"]) {
  if (!IS_MOCK) await mutations.updateAgent(id, { status });
}

async function removeAgent(id: string) {
  if (!IS_MOCK) await mutations.deleteAgent(id);
}

function AgentActions({
  agent,
  onTest,
  onChanged,
  onDeleted,
}: {
  agent: Agent;
  onTest: () => void;
  onChanged: () => void;
  onDeleted: () => void;
}) {
  const qc = useQueryClient();

  const setStatus = async (status: Agent["status"], ok: string) => {
    try {
      await setAgentStatus(agent.id, status);
      toast.success(ok);
      onChanged();
    } catch {
      toast.error("Could not update agent");
    }
  };

  return (
    <div className="flex flex-wrap gap-2">
      <Button size="sm" variant="ghost" onClick={onTest}>
        <PhoneOutgoing className="size-3.5" />
        Test call
      </Button>
      {agent.status === "live" ? (
        <Button
          size="sm"
          variant="subtle"
          onClick={() => void setStatus("paused", "Stopped — it will not answer new calls")}
        >
          <Pause className="size-3.5" />
          Stop
        </Button>
      ) : (
        <Button
          size="sm"
          variant="primary"
          onClick={() =>
            void setStatus("live", agent.status === "paused" ? "Resumed" : "Published")
          }
        >
          <Play className="size-3.5" />
          {agent.status === "paused" ? "Resume" : "Publish"}
        </Button>
      )}
      <Button
        size="sm"
        variant="subtle"
        onClick={async () => {
          try {
            const res = IS_MOCK
              ? { id: `${agent.id}_copy` }
              : await mutations.createAgent({
                  name: `${agent.name} copy`,
                  intent: agent.intent,
                  direction: agent.direction,
                  prompt: agent.prompt,
                  nodes: agent.nodes,
                  edges: agent.edges,
                });
            toast.success("Duplicated as a draft");
            void qc.invalidateQueries({ queryKey: qk.agents });
            return res.id;
          } catch {
            toast.error("Could not duplicate");
          }
        }}
      >
        <Copy className="size-3.5" />
      </Button>
      <Button
        size="sm"
        variant="danger"
        onClick={async () => {
          if (!window.confirm(`Delete ${agent.name}? Numbers will be unassigned. Call history stays.`)) return;
          try {
            await removeAgent(agent.id);
            toast.success("Agent deleted");
            onDeleted();
          } catch (error) {
            toast.error(error instanceof Error ? error.message : "Could not delete");
          }
        }}
      >
        <Trash2 className="size-3.5" />
      </Button>
    </div>
  );
}

function AgentRow({
  agent,
  active,
  onClick,
  onChanged,
  onDeleted,
}: {
  agent: Agent;
  active: boolean;
  onClick: () => void;
  onChanged: () => void;
  onDeleted: () => void;
}) {
  const tone =
    agent.status === "live" ? "cyan" : agent.status === "testing" || agent.status === "paused" ? "amber" : "grey";

  return (
    <div
      className={cn(
        "flex w-full gap-3 rounded-[14px] border p-3 text-left transition-colors",
        active
          ? "border-cyan/35 bg-white/[0.075]"
          : "border-hairline bg-white/[0.045] hover:bg-white/[0.07]",
      )}
    >
      <button onClick={onClick} className="flex min-w-0 flex-1 gap-3 text-left">
        <span className="grad-brand flex size-9 shrink-0 items-center justify-center rounded-[10px] font-[family-name:var(--font-display)] text-[13px] font-semibold text-void">
          {initialsOf(agent.name)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium text-t1">{agent.name}</span>
          <span className="mt-1 flex items-center gap-1.5">
            <Pill tone={tone} className="capitalize">
              {agent.status}
            </Pill>
            {agent.status === "live" ? <Waveform bars={3} height={11} tone="cyan" /> : null}
            <span className="truncate text-[10.5px] text-t3">
              Follows the caller
              {agent.callsToday > 0 ? ` · ${agent.callsToday} calls` : ""}
            </span>
          </span>
        </span>
      </button>
      <div className="flex shrink-0 flex-col gap-1">
        {agent.status === "live" ? (
          <button
            type="button"
            title="Stop agent"
            onClick={async (e) => {
              e.stopPropagation();
              try {
                await setAgentStatus(agent.id, "paused");
                toast.success("Stopped");
                onChanged();
              } catch {
                toast.error("Could not stop");
              }
            }}
            className="rounded-md p-1 text-t3 hover:bg-white/[0.08] hover:text-amber"
          >
            <Pause className="size-3.5" />
          </button>
        ) : (
          <button
            type="button"
            title="Publish"
            onClick={async (e) => {
              e.stopPropagation();
              try {
                await setAgentStatus(agent.id, "live");
                toast.success("Live");
                onChanged();
              } catch {
                toast.error("Could not publish");
              }
            }}
            className="rounded-md p-1 text-t3 hover:bg-white/[0.08] hover:text-cyan"
          >
            <Play className="size-3.5" />
          </button>
        )}
        <button
          type="button"
          title="Delete agent"
          onClick={async (e) => {
            e.stopPropagation();
            if (!window.confirm(`Delete ${agent.name}?`)) return;
            try {
              await removeAgent(agent.id);
              toast.success("Deleted");
              onDeleted();
            } catch (error) {
              toast.error(error instanceof Error ? error.message : "Could not delete");
            }
          }}
          className="rounded-md p-1 text-t3 hover:bg-coral/[0.12] hover:text-coral"
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>
    </div>
  );
}

function FlowTab({ agent }: { agent: Agent }) {
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null);
  const [linkingFrom, setLinkingFrom] = useState<string | null>(null);
  const [nodes, setNodes] = useState(agent.nodes);
  const [edges, setEdges] = useState(agent.edges);
  const [name, setName] = useState(agent.name);
  const moveTimer = useRef<number | null>(null);
  const nameTimer = useRef<number | null>(null);
  const agentsQuery = useAgents();
  const siblings = (agentsQuery.data ?? []).filter((a) => a.id !== agent.id);

  const persist = async (nextNodes: FlowNode[], nextEdges: FlowEdge[]) => {
    setNodes(nextNodes);
    setEdges(nextEdges);
    try {
      if (!IS_MOCK) await mutations.updateAgent(agent.id, { nodes: nextNodes, edges: nextEdges });
    } catch {
      toast.error("Could not save flow");
    }
  };

  const generate = async () => {
    const tpl = AGENT_TEMPLATES.find((t) => t.intent === agent.intent) ?? AGENT_TEMPLATES[0];
    await persist(tpl.nodes, tpl.edges);
    toast.success(`Graph from ${tpl.name}`);
  };

  const addNode = (kind: FlowNode["kind"]) => {
    const labels: Partial<Record<FlowNode["kind"], string>> = {
      collect: "Ask",
      data_pull: "Look up",
      book: "Book",
      branch: "Branch",
      escalate: "Transfer",
      end: "Hang up",
    };
    const node: FlowNode = {
      id: `n_${Date.now()}`,
      kind,
      title: labels[kind] ?? kind.replace("_", " "),
      x: 80 + (nodes.length % 4) * 220,
      y: 80 + Math.floor(nodes.length / 4) * 140,
      config: kind === "escalate" ? { transferKind: "agent" } : kind === "data_pull" ? { tool: "search_knowledge" } : {},
    };
    const nextNodes = [...nodes, node];
    const nextEdges =
      selectedNode && nodes.find((n) => n.id === selectedNode)?.kind !== "end"
        ? [
            ...edges,
            {
              id: `e_${Date.now()}`,
              from: selectedNode,
              to: node.id,
              tone: "default" as const,
            },
          ]
        : edges;
    setSelectedNode(node.id);
    void persist(nextNodes, nextEdges);
  };

  const removeNode = (id: string) => {
    const node = nodes.find((n) => n.id === id);
    if (!node || node.kind === "start") {
      toast.error("The start node stays — the call has to begin somewhere");
      return;
    }
    setSelectedNode(null);
    void persist(
      nodes.filter((n) => n.id !== id),
      edges.filter((e) => e.from !== id && e.to !== id),
    );
  };

  const connect = (from: string, to: string) => {
    setLinkingFrom(null);
    if (from === to) return;
    if (edges.some((e) => e.from === from && e.to === to)) return;
    const source = nodes.find((n) => n.id === from);
    if (source?.kind === "end") return;
    void persist(nodes, [
      ...edges,
      { id: `e_${Date.now()}`, from, to, tone: source?.kind === "escalate" ? "danger" : "default" },
    ]);
  };

  const removeEdge = (id: string) => {
    setSelectedEdge(null);
    void persist(nodes, edges.filter((e) => e.id !== id));
  };

  const selected = nodes.find((n) => n.id === selectedNode) ?? null;
  const edge = edges.find((e) => e.id === selectedEdge) ?? null;

  if (nodes.length === 0) {
    return (
      <div className="rounded-[22px] border border-dashed border-hairline bg-white/[0.02] p-10 text-center">
        <p className="text-[13px] text-t2">{agent.name} is authored in single-prompt mode.</p>
        <p className="mx-auto mt-2 max-w-md text-[12px] leading-relaxed text-t3">
          Generate a starter graph from this agent&apos;s intent, then drag and wire nodes.
          Language is never a step — the voice follows the caller.
        </p>
        <Button variant="ghost" size="sm" className="mt-5" onClick={() => void generate()}>
          Generate graph from prompt
        </Button>
      </div>
    );
  }

  return (
    <>
      <Field label="Agent name">
        <TextInput
          value={name}
          onChange={(v) => {
            setName(v);
            if (nameTimer.current) window.clearTimeout(nameTimer.current);
            nameTimer.current = window.setTimeout(() => {
              if (!IS_MOCK && v.trim()) void mutations.updateAgent(agent.id, { name: v.trim() });
            }, 500);
          }}
        />
      </Field>
      <p className="mb-3 rounded-[14px] border border-hairline bg-white/[0.03] px-3.5 py-3 text-[12.5px] leading-relaxed text-t2">
        Each box is a real step the voice agent must take. Look-up calls{" "}
        <span className="font-[family-name:var(--font-mono)] text-[11.5px] text-t1">lookup_order</span>{" "}
        or knowledge search, Book calls{" "}
        <span className="font-[family-name:var(--font-mono)] text-[11.5px] text-t1">book_slot</span>, Transfer
        hands the caller to a human or another agent (that agent&apos;s knowledge, not this one), Hang up
        says goodbye and closes the line. The canvas is compiled into the live prompt — skipping a tool
        means the action did not happen.
      </p>
      <div className="mb-3 flex flex-wrap gap-1.5">
        {(
          [
            ["collect", "Ask"],
            ["data_pull", "Look up"],
            ["book", "Book"],
            ["branch", "Branch"],
            ["escalate", "Transfer"],
            ["end", "Hang up"],
          ] as const
        ).map(([kind, label]) => (
          <Button key={kind} size="sm" variant="subtle" onClick={() => addNode(kind)}>
            + {label}
          </Button>
        ))}
      </div>
      {linkingFrom ? (
        <div className="mb-3 flex items-center justify-between rounded-[12px] border border-cyan/25 bg-cyan/[0.06] px-3 py-2 text-[12px] text-t2">
          <span>Click a node to connect from {nodes.find((n) => n.id === linkingFrom)?.title ?? "this step"}.</span>
          <Button size="sm" variant="subtle" onClick={() => setLinkingFrom(null)}>
            Cancel
          </Button>
        </div>
      ) : null}
      <FlowCanvas
        nodes={nodes}
        edges={edges}
        selectedId={selectedNode}
        selectedEdgeId={selectedEdge}
        linkingFrom={linkingFrom}
        onSelect={setSelectedNode}
        onSelectEdge={setSelectedEdge}
        onLinkStart={setLinkingFrom}
        onLinkCancel={() => setLinkingFrom(null)}
        onConnect={connect}
        onDelete={removeNode}
        onDeleteEdge={removeEdge}
        onMove={(id, x, y) => {
          setNodes((prev) => {
            const next = prev.map((n) => (n.id === id ? { ...n, x, y } : n));
            if (moveTimer.current) window.clearTimeout(moveTimer.current);
            moveTimer.current = window.setTimeout(() => {
              void persist(next, edges);
            }, 400);
            return next;
          });
        }}
      />
      {selected || edge ? (
        <div className="mt-3 grid gap-3 rounded-[16px] border border-hairline bg-white/[0.03] p-3.5 sm:grid-cols-2">
          {selected ? (
            <>
              <Field label="Step title">
                <TextInput
                  value={selected.title}
                  onChange={(v) => {
                    const next = nodes.map((n) => (n.id === selected.id ? { ...n, title: v } : n));
                    void persist(next, edges);
                  }}
                />
              </Field>
              <Field label="Detail">
                <TextInput
                  value={selected.detail ?? ""}
                  onChange={(v) => {
                    const next = nodes.map((n) => (n.id === selected.id ? { ...n, detail: v } : n));
                    void persist(next, edges);
                  }}
                />
              </Field>
              {selected.kind === "data_pull" ? (
                <Field label="Tool this step must call" hint="If the model skips the tool, the fact does not exist.">
                  <select
                    value={String(selected.config?.tool ?? "search_knowledge")}
                    onChange={(e) => {
                      const next = nodes.map((n) =>
                        n.id === selected.id
                          ? { ...n, config: { ...n.config, tool: e.target.value } }
                          : n,
                      );
                      void persist(next, edges);
                    }}
                    className="glass w-full rounded-[11px] px-3.5 py-2.5 text-[13px] text-t1 outline-none"
                  >
                    <option value="lookup_order">Look up order</option>
                    <option value="register_complaint">Register complaint</option>
                    <option value="search_knowledge">Search this agent&apos;s knowledge</option>
                  </select>
                </Field>
              ) : null}
              {selected.kind === "escalate" ? (
                <>
                  <Field label="Hand off to">
                    <select
                      value={String(
                        selected.config?.transferKind ??
                          (selected.config?.targetAgentName ? "agent" : "human"),
                      )}
                      onChange={(e) => {
                        const transferKind = e.target.value;
                        const next = nodes.map((n) =>
                          n.id === selected.id
                            ? {
                                ...n,
                                config:
                                  transferKind === "human"
                                    ? { transferKind: "human" }
                                    : { ...n.config, transferKind: "agent" },
                              }
                            : n,
                        );
                        void persist(next, edges);
                      }}
                      className="glass w-full rounded-[11px] px-3.5 py-2.5 text-[13px] text-t1 outline-none"
                    >
                      <option value="agent">Another agent (their knowledge)</option>
                      <option value="human">A human desk</option>
                    </select>
                  </Field>
                  {String(selected.config?.transferKind ?? (selected.config?.targetAgentName ? "agent" : "human")) ===
                  "agent" ? (
                    <Field
                      label="Which agent"
                      hint={
                        siblings.length === 0
                          ? "Create another agent first — Setup → Swara will suggest the split."
                          : "The caller is handed to that line and its knowledge base."
                      }
                    >
                      <select
                        value={String(selected.config?.targetAgentId ?? "")}
                        onChange={(e) => {
                          const sib = siblings.find((s) => s.id === e.target.value);
                          const next = nodes.map((n) =>
                            n.id === selected.id
                              ? {
                                  ...n,
                                  title: sib ? `To ${sib.name}` : n.title,
                                  config: {
                                    transferKind: "agent",
                                    targetAgentId: sib?.id,
                                    targetAgentName: sib?.name,
                                  },
                                }
                              : n,
                          );
                          void persist(next, edges);
                        }}
                        className="glass w-full rounded-[11px] px-3.5 py-2.5 text-[13px] text-t1 outline-none"
                      >
                        <option value="">Pick an agent</option>
                        {siblings.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name} · {INTENT_LABEL[s.intent]}
                          </option>
                        ))}
                      </select>
                    </Field>
                  ) : (
                    <p className="text-[11.5px] text-t3">
                      Uses desks from Workspace setup → Transfers. If that list is empty the agent
                      takes a callback instead of inventing a person.
                    </p>
                  )}
                </>
              ) : null}
              {selected.kind === "end" ? (
                <p className="text-[11.5px] text-t3">
                  Speaks a one-line goodbye, calls end_call, and the line closes.
                </p>
              ) : null}
              {selected.kind !== "start" ? (
                <Button size="sm" variant="danger" onClick={() => removeNode(selected.id)}>
                  <Trash2 className="size-3.5" />
                  Remove node
                </Button>
              ) : (
                <p className="text-[11.5px] text-t3">Start cannot be removed.</p>
              )}
            </>
          ) : null}
          {edge ? (
            <>
              <Field label="Wire label">
                <TextInput
                  value={edge.label ?? ""}
                  onChange={(v) => {
                    const next = edges.map((e) => (e.id === edge.id ? { ...e, label: v } : e));
                    void persist(nodes, next);
                  }}
                />
              </Field>
              <Field label="Path">
                <select
                  value={edge.tone}
                  onChange={(e) => {
                    const tone = e.target.value as FlowEdge["tone"];
                    const next = edges.map((row) => (row.id === edge.id ? { ...row, tone } : row));
                    void persist(nodes, next);
                  }}
                  className="glass w-full rounded-[11px] px-3.5 py-2.5 text-[13px] text-t1 outline-none"
                >
                  <option value="default">Default</option>
                  <option value="success">Success</option>
                  <option value="danger">Escalation</option>
                </select>
              </Field>
              <Button size="sm" variant="danger" onClick={() => removeEdge(edge.id)}>
                <Trash2 className="size-3.5" />
                Remove wire
              </Button>
            </>
          ) : null}
        </div>
      ) : null}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-t3">
        <span>Drag to move · right port to wire · Delete to remove · layout saves as you go</span>
        <span className="flex items-center gap-1.5">
          <span className="h-px w-4 bg-cyan/60" /> success path
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-px w-4 bg-coral/60" /> escalation path
        </span>
      </div>
    </>
  );
}

function PromptTab({ agent }: { agent: Agent }) {
  const qc = useQueryClient();
  const [prompt, setPrompt] = useState(
    agent.prompt ??
      "This agent is authored as a graph. Switching to single-prompt mode will flatten it.",
  );

  const save = async () => {
    try {
      if (!IS_MOCK) await mutations.updateAgent(agent.id, { prompt });
      toast.success("Prompt saved — live on the next test call");
      void qc.invalidateQueries({ queryKey: qk.agents });
    } catch {
      toast.error("Could not save prompt");
    }
  };

  return (
    <div className="space-y-4">
      <Field
        label="System prompt"
        hint="Voice craft, language-follow and workspace details (transfers, slots, departments) are added automatically at call time. Write the role here — not the language, not the voice."
      >
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={9}
          className="glass w-full resize-y rounded-[14px] p-4 font-[family-name:var(--font-mono)] text-[12.5px] leading-relaxed text-t1 outline-none transition-colors focus:border-cyan/45"
        />
      </Field>
      <Button variant="primary" onClick={() => void save()}>
        Save prompt
      </Button>

      <div className="glass rounded-[14px] p-3.5">
        <div className="mb-2 text-[11.5px] font-medium text-t2">Tools this agent can call</div>
        <div className="flex flex-wrap gap-2">
          {["lookup_order", "register_complaint", "book_slot", "search_knowledge", "transfer_to_human", "transfer_to_agent", "end_call"].map(
            (t) => (
              <Pill key={t} tone="violet">
                <span className="font-[family-name:var(--font-mono)]">{t}</span>
              </Pill>
            ),
          )}
        </div>
        <p className="mt-2 text-[11px] text-t3">
          Transfer to another agent hands the caller to that line&apos;s knowledge. Hang-up is
          end_call — not a suggestion. Desks and slots come from Workspace setup.
        </p>
      </div>
    </div>
  );
}

function KnowledgeTab({ agent }: { agent: Agent }) {
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
      if (!IS_MOCK) await mutations.addKnowledge({ name: name.trim(), kind: "text", text, agentId: agent.id });
      toast.success(`Indexed for ${agent.name}`);
      setName("");
      setText("");
      void qc.invalidateQueries({ queryKey: qk.knowledge });
    } catch {
      toast.error("Could not ingest");
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-[18px] border border-dashed border-hairline bg-white/[0.02] p-6">
        <Upload className="mb-3 size-5 text-t3" strokeWidth={1.6} />
        <p className="text-[13px] text-t1">Paste policy, fare or FAQ text for {agent.name}</p>
        <p className="mt-1 mb-3 text-[11.5px] leading-relaxed text-t3">
          Search is scoped to this agent, plus any org-wide docs. That is how a bookings agent
          stays out of order-status answers.
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
        <Button className="mt-3" variant="primary" onClick={() => void save()}>
          Add to knowledge base
        </Button>
      </div>

      <QueryBoundary query={query} skeleton={<RowsSkeleton rows={4} />}>
        {(docs) => (
          <div>
            {docs.map((d) => (
              <ListRow key={d.id}>
                <span className="flex size-8 shrink-0 items-center justify-center rounded-[9px] bg-white/[0.06]">
                  {d.kind === "url" ? (
                    <Globe className="size-3.5 text-t2" strokeWidth={1.7} />
                  ) : (
                    <FileText className="size-3.5 text-t2" strokeWidth={1.7} />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] text-t1">{d.name}</span>
                  <span className="text-[11px] text-t3">
                    {d.sizeLabel} · {d.chunks.toLocaleString("en-IN")} chunks
                    {d.agentId === agent.id
                      ? ` · ${agent.name}`
                      : d.agentId
                        ? " · another agent"
                        : " · shared"}
                  </span>
                </span>
                <Pill tone={d.status === "indexed" ? "cyan" : d.status === "indexing" ? "amber" : "coral"}>
                  {d.status}
                </Pill>
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

  return (
    <div className="grid gap-3.5 md:grid-cols-2">
      <div className="glass rounded-[18px] p-4">
        <h4 className="mb-1 font-[family-name:var(--font-display)] text-[13.5px] font-semibold text-t1">
          Talk to it right now
        </h4>
        <p className="mb-4 text-[11.5px] leading-relaxed text-t3">
          Speech to speech from this browser against the draft version. Interrupt it mid-sentence —
          barge-in is the thing customers notice first, and the thing that is hardest to fake.
        </p>
        <Button variant="primary" full onClick={onStartCall}>
          <Mic className="size-3.5" />
          Start voice test
        </Button>

        <div className="mt-4 border-t border-hairline pt-3.5">
          <Field label="Or have it dial a real number">
            <TextInput value={phone} onChange={setPhone} placeholder="+91 98765 43210" />
          </Field>
          <Button
            full
            className="mt-2.5"
            onClick={() =>
              toast("Outbound dialling needs the telephony leg", {
                description: `${agent.name} v${agent.version} is ready; the SIP bridge is not wired up yet.`,
              })
            }
          >
            <PhoneOutgoing className="size-3.5" />
            Call me now
          </Button>
        </div>
      </div>

      <div className="glass rounded-[18px] p-4">
        <h4 className="mb-1 font-[family-name:var(--font-display)] text-[13.5px] font-semibold text-t1">
          Simulate a conversation
        </h4>
        <p className="mb-4 text-[11.5px] leading-relaxed text-t3">
          Type as the caller and watch which nodes fire — faster than dialling for checking branch
          logic.
        </p>
        <div className="space-y-2.5">
          {[
            { who: "agent", text: "Namaste, main Swara bol rahi hoon. Aapka order kis baare mein hai?" },
            { who: "caller", text: "Mera parcel aaj nahi aaya" },
            { who: "agent", text: "Order #48213 out for delivery hai. Kal shaam ka slot rakh doon?" },
          ].map((m, i) => (
            <div
              key={i}
              className={cn(
                "max-w-[88%] rounded-[12px] px-3 py-2 text-[12px] leading-snug",
                m.who === "agent"
                  ? "bg-white/[0.06] text-t2"
                  : "ml-auto bg-violet/[0.18] text-t1",
              )}
            >
              {m.text}
            </div>
          ))}
        </div>
        <div className="mt-3 flex gap-2">
          <TextInput value="" onChange={() => {}} placeholder="Type as the caller…" />
        </div>
      </div>
    </div>
  );
}

function VersionsTab({ agent }: { agent: Agent }) {
  const query = useAgentVersions();
  const qc = useQueryClient();

  return (
    <QueryBoundary query={query} skeleton={<RowsSkeleton rows={4} />}>
      {(versions) => {
        const mine = versions.filter((v) => !v.agentId || v.agentId === agent.id);
        return (
          <div>
            <p className="mb-3 text-[11.5px] text-t3">
              Publish writes a snapshot. Rolling back restores that prompt and graph on the next call.
            </p>
            {mine.length === 0 ? (
              <p className="text-[12.5px] text-t3">No published versions yet.</p>
            ) : (
              mine.map((v) => (
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
                    <Button
                      size="sm"
                      variant="subtle"
                      disabled={v.hasSnapshot === false}
                      onClick={async () => {
                        try {
                          if (!IS_MOCK) await mutations.rollbackAgent(agent.id, v.id);
                          toast.success(`Rolled back to v${v.version}`);
                          void qc.invalidateQueries({ queryKey: qk.agents });
                          void qc.invalidateQueries({ queryKey: qk.agentVersions });
                        } catch {
                          toast.error("This version has no snapshot to restore");
                        }
                      }}
                    >
                      <RotateCcw className="size-3" />
                      Roll back
                    </Button>
                  )}
                </ListRow>
              ))
            )}
          </div>
        );
      }}
    </QueryBoundary>
  );
}
