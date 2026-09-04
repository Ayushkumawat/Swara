"use client";

import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  FileText,
  Globe,
  History,
  PhoneOutgoing,
  Plus,
  RotateCcw,
  Sparkles,
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
import { useAgentVersions, useAgents, useKnowledge } from "@/lib/api/hooks";
import { useUi } from "@/lib/ui-store";
import { LANGUAGE_LABEL, type Agent } from "@/lib/api/schemas";
import { cn, initialsOf, relativeTime } from "@/lib/utils";

// The canvas carries drag handling and per-node SVG; only the Flow builder
// tab needs it, so it loads when that tab is first opened.
const FlowCanvas = dynamic(() => import("@/components/flow/flow-canvas").then((m) => m.FlowCanvas), {
  loading: () => <CardSkeleton height={420} />,
});

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
  const [tab, setTab] = useState<Tab>("flow");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const openCopilot = useUi((s) => s.openCopilot);

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
            <Button variant="ghost" onClick={() => toast("Template gallery coming in the next pass")}>
              Templates
            </Button>
            <Button variant="primary" onClick={() => toast.success("New draft agent created")}>
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
                <div className="flex gap-2">
                  <Button size="sm" variant="ghost" onClick={() => toast.success("Test call queued")}>
                    <PhoneOutgoing className="size-3.5" />
                    Test call
                  </Button>
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={() => toast.success("Published", { description: "Live on the next inbound call." })}
                  >
                    Publish
                  </Button>
                </div>
              }
            />

            <Tabs tabs={TABS} value={tab} onChange={setTab} className="mb-4" />

            {selected ? (
              <>
                {tab === "flow" ? <FlowTab agent={selected} /> : null}
                {tab === "prompt" ? <PromptTab agent={selected} /> : null}
                {tab === "knowledge" ? <KnowledgeTab /> : null}
                {tab === "test" ? <TestTab agent={selected} /> : null}
                {tab === "versions" ? <VersionsTab /> : null}
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
    </>
  );
}

function AgentRow({
  agent,
  active,
  onClick,
}: {
  agent: Agent;
  active: boolean;
  onClick: () => void;
}) {
  const tone =
    agent.status === "live" ? "cyan" : agent.status === "testing" ? "amber" : "grey";

  return (
    <button
      onClick={onClick}
      className={cn(
        "flex w-full gap-3 rounded-[14px] border p-3 text-left transition-colors",
        active
          ? "border-cyan/35 bg-white/[0.075]"
          : "border-hairline bg-white/[0.045] hover:bg-white/[0.07]",
      )}
    >
      <span className="grad-brand flex size-9 shrink-0 items-center justify-center rounded-[10px] font-[family-name:var(--font-display)] text-[13px] font-semibold text-void">
        {initialsOf(agent.name)}
      </span>
      <span className="min-w-0 flex-1">
        {/* Name gets the full row width; status moves below rather than
            competing with it and truncating every agent to "Delivery resc…" */}
        <span className="block truncate text-[13px] font-medium text-t1">{agent.name}</span>
        <span className="mt-1 flex items-center gap-1.5">
          <Pill tone={tone} className="capitalize">
            {agent.status}
          </Pill>
          {agent.status === "live" ? <Waveform bars={3} height={11} tone="cyan" /> : null}
          <span className="truncate text-[10.5px] text-t3">
            {agent.languages.length > 2
              ? `${agent.languages.length} langs`
              : agent.languages.map((l) => LANGUAGE_LABEL[l]).join(", ")}
            {agent.callsToday > 0 ? ` · ${agent.callsToday} calls` : ""}
          </span>
        </span>
      </span>
    </button>
  );
}

function FlowTab({ agent }: { agent: Agent }) {
  const [selectedNode, setSelectedNode] = useState<string | null>(null);

  if (agent.nodes.length === 0) {
    return (
      <div className="rounded-[22px] border border-dashed border-hairline bg-white/[0.02] p-10 text-center">
        <p className="text-[13px] text-t2">
          {agent.name} is authored in single-prompt mode.
        </p>
        <p className="mx-auto mt-2 max-w-md text-[12px] leading-relaxed text-t3">
          Prompt agents still compile down to a graph underneath. Generate the graph to add
          deterministic branching — useful once a flow needs compliance-sensitive steps like
          consent capture or grievance intake.
        </p>
        <Button
          variant="ghost"
          size="sm"
          className="mt-5"
          onClick={() => toast.success("Generating graph from prompt…")}
        >
          Generate graph from prompt
        </Button>
      </div>
    );
  }

  return (
    <>
      <FlowCanvas
        nodes={agent.nodes}
        edges={agent.edges}
        selectedId={selectedNode}
        onSelect={setSelectedNode}
      />
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-t3">
        <span>Drag nodes to rearrange · click to configure</span>
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
  const [prompt, setPrompt] = useState(
    agent.prompt ??
      "This agent is authored as a graph. Switching to single-prompt mode will flatten it.",
  );

  return (
    <div className="space-y-4">
      <Field
        label="System prompt"
        hint="Single-prompt mode is the fast path for straightforward agents. It compiles to the same graph engine, so you can switch to the canvas later without rebuilding."
      >
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={9}
          className="glass w-full resize-y rounded-[14px] p-4 font-[family-name:var(--font-mono)] text-[12.5px] leading-relaxed text-t1 outline-none transition-colors focus:border-cyan/45"
        />
      </Field>

      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Interruption handling">
          <TextInput value="Allow barge-in" onChange={() => {}} />
        </Field>
        <Field label="Max call length">
          <TextInput value="6 minutes" onChange={() => {}} />
        </Field>
        <Field label="Silence timeout">
          <TextInput value="4 seconds" onChange={() => {}} />
        </Field>
      </div>

      <div className="glass rounded-[14px] p-3.5">
        <div className="mb-2 text-[11.5px] font-medium text-t2">Tools this agent can call</div>
        <div className="flex flex-wrap gap-2">
          {["order_status", "reschedule_delivery", "send_payment_link", "transfer_to_human"].map(
            (t) => (
              <Pill key={t} tone="violet">
                <span className="font-[family-name:var(--font-mono)]">{t}</span>
              </Pill>
            ),
          )}
        </div>
      </div>
    </div>
  );
}

function KnowledgeTab() {
  const query = useKnowledge();

  return (
    <div className="space-y-4">
      <div className="rounded-[18px] border border-dashed border-hairline bg-white/[0.02] p-8 text-center transition-colors hover:border-cyan/30">
        <Upload className="mx-auto mb-3 size-5 text-t3" strokeWidth={1.6} />
        <p className="text-[13px] text-t1">Drop PDFs, CSVs or paste a URL</p>
        <p className="mt-1 text-[11.5px] text-t3">
          Grounds answers in your own content so the agent stops guessing on FAQ-shaped questions
        </p>
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

function TestTab({ agent }: { agent: Agent }) {
  const [phone, setPhone] = useState("+91 ");

  return (
    <div className="grid gap-3.5 md:grid-cols-2">
      <div className="glass rounded-[18px] p-4">
        <h4 className="mb-1 font-[family-name:var(--font-display)] text-[13.5px] font-semibold text-t1">
          Place a real test call
        </h4>
        <p className="mb-4 text-[11.5px] leading-relaxed text-t3">
          Calls the draft version, not the published one. A bad first live call loses the customer,
          so nothing reaches production untested.
        </p>
        <Field label="Call this number">
          <TextInput value={phone} onChange={setPhone} placeholder="+91 98765 43210" />
        </Field>
        <Button
          variant="primary"
          full
          className="mt-3"
          onClick={() => toast.success("Calling now", { description: `Testing ${agent.name} v${agent.version} (draft)` })}
        >
          <PhoneOutgoing className="size-3.5" />
          Call me now
        </Button>
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

function VersionsTab() {
  const query = useAgentVersions();

  return (
    <QueryBoundary query={query} skeleton={<RowsSkeleton rows={4} />}>
      {(versions) => (
        <div>
          <p className="mb-3 text-[11.5px] text-t3">
            Every publish and every copilot edit is a version. Rolling back takes effect on the next
            call — no redeploy.
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
                <Button
                  size="sm"
                  variant="subtle"
                  onClick={() => toast.success(`Rolled back to v${v.version}`)}
                >
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
