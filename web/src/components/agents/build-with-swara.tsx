"use client";

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { toast } from "sonner";
import { ArrowRight, ArrowRightLeft, Check, Loader2, PhoneIncoming, PhoneOutgoing, Sparkles, TriangleAlert, X } from "lucide-react";
import { Button, IconButton } from "@/components/ui/button";
import { Pill } from "@/components/ui/pill";
import { Select } from "@/components/ui/controls";
import { LIVE_VOICES } from "@/lib/live/config";
import { IS_MOCK, mutations } from "@/lib/api/client";
import { usePlaybook } from "@/lib/api/hooks";
import { INTENT_LABEL, type AgentPlan, type PlannedAgent } from "@/lib/api/schemas";
import { cn } from "@/lib/utils";

/**
 * "Build with Swara" — the agent-creation wizard.
 *
 * Brief → plan → (questions) → approve → agents exist. The plan comes from
 * the server's planner (Gemini shaping + deterministic flow construction);
 * this component's job is to make waiting feel like work happening, show the
 * plan as something reviewable, and never create anything before approval.
 *
 * It can be seeded with a plan Swara proposed on a voice call (the
 * propose_agents tool), in which case it opens on the review step.
 */
export function BuildWithSwara({
  open,
  onClose,
  onCreated,
  seedPlan,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (ids: string[]) => void;
  seedPlan?: AgentPlan | null;
}) {
  const playbook = usePlaybook();
  const [step, setStep] = useState<"brief" | "planning" | "review" | "building" | "done">("brief");
  const [brief, setBrief] = useState("");
  const [plan, setPlan] = useState<AgentPlan | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [built, setBuilt] = useState<string[]>([]);
  const [builtIds, setBuiltIds] = useState<string[]>([]);

  // Seed from a plan Swara produced on a voice call, or from the playbook, on
  // open. Done as a render-phase transition (compare-and-set), not an effect.
  const [seenOpen, setSeenOpen] = useState<{ open: boolean; seed: AgentPlan | null | undefined }>({ open: false, seed: null });
  if (open !== seenOpen.open || seedPlan !== seenOpen.seed) {
    setSeenOpen({ open, seed: seedPlan });
    if (open) {
      if (seedPlan) {
        setPlan(seedPlan);
        setSelected(Object.fromEntries(seedPlan.agents.map((a) => [a.key, true])));
        setStep("review");
      } else if (!brief && playbook.data?.businessType) {
        setBrief(playbook.data.businessType);
      }
    }
  }

  const reset = () => {
    setStep("brief");
    setPlan(null);
    setAnswers({});
    setBuilt([]);
    setBuiltIds([]);
  };

  const runPlan = async (extraAnswers?: Record<string, string>) => {
    const kept = plan;
    setStep("planning");
    try {
      const next = IS_MOCK
        ? mockPlan(brief)
        : await mutations.planAgents({ brief, answers: extraAnswers ?? answers });
      setPlan(next);
      setSelected(Object.fromEntries(next.agents.map((a) => [a.key, true])));
      setStep("review");
    } catch (error) {
      toast.error("Planning failed — nothing was replaced", {
        description: kept
          ? "Your current plan is still here. Retry when the model responds."
          : errorText(error),
      });
      setStep(kept ? "review" : "brief");
    }
  };

  const build = async () => {
    if (!plan) return;
    const chosen = plan.agents.filter((a) => selected[a.key]);
    if (chosen.length === 0) return;
    setStep("building");
    setBuilt([]);
    try {
      // Handoffs to agents that were deselected become plain endings, so a
      // partial approval still yields runnable flows.
      const keys = new Set(chosen.map((a) => a.key));
      const trimmed = chosen.map((a) => ({
        ...a,
        handsOffTo: a.handsOffTo.filter((k) => keys.has(k)),
        nodes: a.nodes.map((n) =>
          n.kind === "handoff" && !keys.has(String((n.config as { agentKey?: string }).agentKey ?? ""))
            ? { ...n, kind: "end" as const, title: "Close", config: { hangUp: true } }
            : n,
        ),
      }));
      const res = IS_MOCK
        ? { created: trimmed.map((a) => ({ key: a.key, id: `ag_${a.key}`, name: a.name })) }
        : await mutations.applyPlan({ agents: trimmed });
      // Reveal one at a time — the owner sees each agent land.
      for (const c of res.created) {
        await new Promise((r) => setTimeout(r, 420));
        setBuilt((b) => [...b, c.key]);
      }
      setBuiltIds(res.created.map((c) => c.id));
      setStep("done");
    } catch (error) {
      toast.error("Could not create agents", { description: error instanceof Error ? error.message : undefined });
      setStep("review");
    }
  };

  const chosenCount = plan ? plan.agents.filter((a) => selected[a.key]).length : 0;

  return (
    <AnimatePresence>
      {open ? (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-[85] bg-void/75 backdrop-blur-sm"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.97, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: 8 }}
            transition={{ type: "spring", stiffness: 320, damping: 30 }}
            className="glass-strong fixed left-1/2 top-1/2 z-[90] flex max-h-[90vh] w-[min(920px,94vw)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-[22px] border border-hairline"
            role="dialog"
            aria-label="Build with Swara"
          >
            <header className="flex items-start justify-between gap-3 border-b border-hairline p-4">
              <div className="flex items-center gap-3">
                <SwaraOrb active={step === "planning" || step === "building"} />
                <div>
                  <div className="font-[family-name:var(--font-display)] text-[15px] font-semibold text-t1">
                    Build with Swara
                  </div>
                  <p className="mt-0.5 text-[11.5px] text-t3">
                    {step === "brief" && "Describe the business and its calls. Swara designs the agents."}
                    {step === "planning" && "Reading your workspace, deciding which agents you need…"}
                    {step === "review" && "Review the plan. Nothing is created until you approve."}
                    {step === "building" && "Creating agents and wiring their flows…"}
                    {step === "done" && "Done. Each agent has a flow you can open, test and publish."}
                  </p>
                </div>
              </div>
              <IconButton onClick={onClose} aria-label="Close">
                <X className="size-4" />
              </IconButton>
            </header>

            <div className="flex-1 overflow-y-auto p-5">
              <AnimatePresence mode="wait">
                {step === "brief" ? (
                  <motion.div key="brief" {...fade} className="space-y-4">
                    <textarea
                      value={brief}
                      onChange={(e) => setBrief(e.target.value)}
                      rows={6}
                      autoFocus
                      className="glass w-full resize-y rounded-[16px] p-4 text-[13px] leading-relaxed text-t1 outline-none focus:border-cyan/40"
                      placeholder="e.g. We're a D2C skincare brand shipping 400 COD orders a day. Callers ask where their order is, want to return something, or complain about damaged items. We also want to call customers whose delivery failed and remind COD customers before delivery. Two people in support can take escalations."
                    />
                    <div className="flex flex-wrap gap-2">
                      {EXAMPLES.map((ex) => (
                        <button
                          key={ex.label}
                          onClick={() => setBrief(ex.text)}
                          className="rounded-full border border-hairline bg-white/[0.03] px-3 py-1 text-[11.5px] text-t2 transition-colors hover:border-cyan/30 hover:text-t1"
                        >
                          {ex.label}
                        </button>
                      ))}
                    </div>
                    <p className="text-[11.5px] leading-relaxed text-t3">
                      Swara already knows what&apos;s in Workspace setup — departments, transfer desks, bookable types,
                      knowledge. She&apos;ll design around it, list what&apos;s still missing, and ask at most three
                      questions.
                    </p>
                  </motion.div>
                ) : null}

                {step === "planning" ? (
                  <motion.div key="planning" {...fade}>
                    <Thinking />
                  </motion.div>
                ) : null}

                {step === "review" && plan ? (
                  <motion.div key="review" {...fade} className="space-y-4">
                    <div className="glass rounded-[16px] p-4">
                      <div className="flex items-start gap-3">
                        <Sparkles className="mt-0.5 size-4 shrink-0 text-cyan" />
                        <div className="min-w-0">
                          <p className="text-[13px] leading-relaxed text-t1">{plan.summary}</p>
                          <p className="mt-1 text-[11px] text-t3">
                            {plan.source === "gemini" ? "Designed by Swara" : "Designed from your playbook (no model key)"} ·{" "}
                            {plan.agents.length} agents · {plan.agents.reduce((n, a) => n + a.nodes.length, 0)} steps
                          </p>
                          <Button size="sm" variant="subtle" className="mt-2" onClick={() => void runPlan()}>
                            Retry plan
                          </Button>
                        </div>
                      </div>
                    </div>

                    {plan.gaps.length ? (
                      <div className="rounded-[14px] border border-amber/25 bg-amber/[0.07] p-3.5">
                        <div className="mb-1.5 flex items-center gap-2 text-[12px] font-medium text-amber">
                          <TriangleAlert className="size-3.5" /> Still missing in Workspace setup
                        </div>
                        <ul className="space-y-1 text-[11.5px] leading-relaxed text-t2">
                          {plan.gaps.map((g) => (
                            <li key={g}>· {g}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null}

                    <div className="grid gap-3 sm:grid-cols-2">
                      {plan.agents.map((a, i) => (
                        <PlannedAgentCard
                          key={a.key}
                          agent={a}
                          index={i}
                          plan={plan}
                          checked={!!selected[a.key]}
                          onToggle={() => setSelected((s) => ({ ...s, [a.key]: !s[a.key] }))}
                          onChange={(patch) =>
                            setPlan((p) =>
                              p ? { ...p, agents: p.agents.map((x) => (x.key === a.key ? { ...x, ...patch } : x)) } : p,
                            )
                          }
                        />
                      ))}
                    </div>

                    {plan.questions.length ? (
                      <div className="glass rounded-[16px] p-4">
                        <div className="mb-2 text-[12.5px] font-medium text-t1">Swara would still ask</div>
                        <div className="space-y-3">
                          {plan.questions.map((q) => (
                            <div key={q}>
                              <div className="mb-1 text-[12px] text-t2">{q}</div>
                              <input
                                value={answers[q] ?? ""}
                                onChange={(e) => setAnswers((s) => ({ ...s, [q]: e.target.value }))}
                                placeholder="Answer, or leave blank"
                                className="glass w-full rounded-[11px] px-3 py-2 text-[12.5px] text-t1 outline-none"
                              />
                            </div>
                          ))}
                        </div>
                        <Button
                          size="sm"
                          className="mt-3"
                          onClick={() => void runPlan(answers)}
                          disabled={!Object.values(answers).some((v) => v.trim())}
                        >
                          Re-plan with answers
                        </Button>
                      </div>
                    ) : null}
                  </motion.div>
                ) : null}

                {step === "building" && plan ? (
                  <motion.div key="building" {...fade} className="space-y-2.5">
                    {plan.agents
                      .filter((a) => selected[a.key])
                      .map((a) => {
                        const done = built.includes(a.key);
                        return (
                          <motion.div
                            key={a.key}
                            layout
                            className={cn(
                              "flex items-center gap-3 rounded-[14px] border p-3.5 transition-colors",
                              done ? "border-cyan/30 bg-cyan/[0.06]" : "border-hairline bg-white/[0.03]",
                            )}
                          >
                            <span className="flex size-7 items-center justify-center">
                              {done ? (
                                <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 400, damping: 20 }}>
                                  <Check className="size-4 text-cyan" />
                                </motion.span>
                              ) : (
                                <Loader2 className="size-4 animate-spin text-violet" />
                              )}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block text-[13px] font-medium text-t1">{a.name}</span>
                              <span className="text-[11px] text-t3">
                                {done ? `${a.nodes.length} steps wired` : "Writing prompt, laying out flow…"}
                              </span>
                            </span>
                          </motion.div>
                        );
                      })}
                  </motion.div>
                ) : null}

                {step === "done" && plan ? (
                  <motion.div key="done" {...fade} className="py-6 text-center">
                    <motion.div
                      initial={{ scale: 0.6, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      transition={{ type: "spring", stiffness: 260, damping: 18 }}
                      className="mx-auto mb-4 flex size-14 items-center justify-center rounded-full bg-cyan/15"
                    >
                      <Check className="size-6 text-cyan" />
                    </motion.div>
                    <div className="font-[family-name:var(--font-display)] text-[16px] font-semibold text-t1">
                      {built.length} agent{built.length === 1 ? "" : "s"} ready as drafts
                    </div>
                    <p className="mx-auto mt-2 max-w-md text-[12.5px] leading-relaxed text-t3">
                      Open each one, run a test call, then publish. Handoffs between them already work — a caller who
                      reaches the wrong agent gets passed along with a summary.
                    </p>
                  </motion.div>
                ) : null}
              </AnimatePresence>
            </div>

            <footer className="flex items-center justify-between gap-3 border-t border-hairline p-3.5">
              <div className="text-[11.5px] text-t3">
                {step === "review" && plan ? `${chosenCount} of ${plan.agents.length} selected` : ""}
              </div>
              <div className="flex gap-2">
                {step === "brief" ? (
                  <Button variant="primary" onClick={() => void runPlan()} disabled={brief.trim().length < 12}>
                    <Sparkles className="size-3.5" />
                    Design my agents
                  </Button>
                ) : null}
                {step === "review" ? (
                  <>
                    <Button variant="subtle" onClick={reset}>
                      Start over
                    </Button>
                    <Button variant="primary" onClick={() => void build()} disabled={chosenCount === 0}>
                      Create {chosenCount} agent{chosenCount === 1 ? "" : "s"}
                      <ArrowRight className="size-3.5" />
                    </Button>
                  </>
                ) : null}
                {step === "done" ? (
                  <Button
                    variant="primary"
                    onClick={() => {
                      onCreated(builtIds);
                      reset();
                    }}
                  >
                    Open agents
                  </Button>
                ) : null}
              </div>
            </footer>
          </motion.div>
        </>
      ) : null}
    </AnimatePresence>
  );
}

const fade = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -6 },
  transition: { duration: 0.22 },
};

const EXAMPLES = [
  {
    label: "Dental clinic",
    text: "Dental clinic with two doctors in Pune. Callers want to book, reschedule or cancel appointments, ask fees and timings. Consultations are 30 minutes, 10am–7pm Mon–Sat. Receptionist Neha can take urgent calls. We'd like reminder calls the day before.",
  },
  {
    label: "D2C e-commerce",
    text: "D2C skincare brand shipping ~400 orders a day, half COD. Callers ask where their order is, want returns or refunds, complain about damaged items. We want outbound calls for failed deliveries and COD confirmation. Support lead Rahul handles disputes.",
  },
  {
    label: "Customer care + sales",
    text: "Broadband provider. Inbound: outages, billing disputes, plan changes, complaints. Outbound: follow up on website leads and book installation slots. Separate billing and technical teams; a floor manager can take escalations 9–9.",
  },
];

function PlannedAgentCard({
  agent,
  index,
  plan,
  checked,
  onToggle,
  onChange,
}: {
  agent: PlannedAgent;
  index: number;
  plan: AgentPlan;
  checked: boolean;
  onToggle: () => void;
  onChange: (patch: Partial<Pick<PlannedAgent, "personaName" | "voice">>) => void;
}) {
  const handoffNames = useMemo(
    () => agent.handsOffTo.map((k) => plan.agents.find((a) => a.key === k)?.name ?? k),
    [agent.handsOffTo, plan.agents],
  );
  const Dir = agent.direction === "outbound" ? PhoneOutgoing : PhoneIncoming;
  const voiceOptions = LIVE_VOICES.map((v) => ({ value: v.name, label: `${v.label} · ${v.gender}` }));

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.06, duration: 0.3 }}
      className={cn(
        "rounded-[16px] border p-4 text-left transition-colors",
        checked ? "border-cyan/35 bg-white/[0.06]" : "border-hairline bg-white/[0.02] opacity-60",
      )}
    >
      <button type="button" onClick={onToggle} className="flex w-full items-start justify-between gap-2 text-left">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "flex size-5 items-center justify-center rounded-full border",
              checked ? "border-cyan bg-cyan text-void" : "border-hairline",
            )}
          >
            {checked ? <Check className="size-3" strokeWidth={3} /> : null}
          </span>
          <span className="text-[13.5px] font-medium text-t1">{agent.name}</span>
        </div>
        {agent.isFrontDoor ? <Pill tone="cyan">Front door</Pill> : null}
      </button>
      <p className="mt-2 text-[12px] leading-relaxed text-t2">{agent.job}</p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-[10.5px] uppercase tracking-wide text-t3">Introduces itself as</span>
          <input
            value={agent.personaName}
            onChange={(e) => onChange({ personaName: e.target.value })}
            placeholder="First name"
            className="glass w-full rounded-[10px] px-2.5 py-1.5 text-[12px] text-t1 outline-none"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-[10.5px] uppercase tracking-wide text-t3">Voice</span>
          <Select size="sm" value={agent.voice} onChange={(v) => onChange({ voice: v })} options={voiceOptions} />
        </label>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        <Pill tone="violet">{INTENT_LABEL[agent.intent]}</Pill>
        <Pill>
          <Dir className="size-3" /> {agent.direction}
        </Pill>
        <Pill>{agent.nodes.length} steps</Pill>
        {agent.needs.map((n) => (
          <Pill key={n} tone="amber">
            needs {n}
          </Pill>
        ))}
      </div>
      {handoffNames.length ? (
        <div className="mt-2.5 flex items-center gap-1.5 text-[11px] text-t3">
          <ArrowRightLeft className="size-3 text-violet" />
          hands off to {handoffNames.join(", ")}
        </div>
      ) : null}
    </motion.div>
  );
}

const THOUGHTS = [
  "Reading the playbook and departments",
  "Listing why people call",
  "Separating angry-caller work from sales",
  "Checking who can take a transfer",
  "Deciding which agents hand off to which",
  "Laying out each flow",
];

function Thinking() {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((n) => Math.min(n + 1, THOUGHTS.length - 1)), 900);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="py-10">
      <div className="mx-auto max-w-sm space-y-2.5">
        {THOUGHTS.map((t, idx) => (
          <motion.div
            key={t}
            initial={{ opacity: 0, x: -6 }}
            animate={{ opacity: idx <= i ? 1 : 0.25, x: 0 }}
            transition={{ duration: 0.3 }}
            className="flex items-center gap-2.5 text-[12.5px] text-t2"
          >
            <span className="flex size-5 items-center justify-center">
              {idx < i ? (
                <Check className="size-3.5 text-cyan" />
              ) : idx === i ? (
                <Loader2 className="size-3.5 animate-spin text-violet" />
              ) : (
                <span className="size-1.5 rounded-full bg-t3/40" />
              )}
            </span>
            {t}
          </motion.div>
        ))}
      </div>
    </div>
  );
}

/** Swara's mark: a soft orb that breathes while she works. */
export function SwaraOrb({ active, size = 36 }: { active?: boolean; size?: number }) {
  return (
    <span className="relative inline-flex shrink-0 items-center justify-center" style={{ width: size, height: size }}>
      <motion.span
        className="absolute inset-0 rounded-full"
        style={{ background: "radial-gradient(circle at 35% 35%, rgba(124,108,246,0.9), rgba(63,224,197,0.7))" }}
        animate={active ? { scale: [1, 1.08, 1], opacity: [0.85, 1, 0.85] } : { scale: 1, opacity: 0.9 }}
        transition={active ? { duration: 1.6, repeat: Infinity, ease: "easeInOut" } : undefined}
      />
      <motion.span
        className="absolute inset-0 rounded-full border border-cyan/40"
        animate={active ? { scale: [1, 1.5], opacity: [0.6, 0] } : { opacity: 0 }}
        transition={active ? { duration: 1.6, repeat: Infinity, ease: "easeOut" } : undefined}
      />
      <Sparkles className="relative size-[45%] text-void" strokeWidth={2.4} />
    </span>
  );
}

function errorText(error: unknown) {
  const raw = error instanceof Error ? error.message : "";
  try {
    const parsed = JSON.parse(raw) as { error?: string };
    if (parsed.error) return parsed.error;
  } catch {
    /* body was plain text */
  }
  return raw || "The model did not respond.";
}

/** Mock-mode plan so the wizard demos without a backend. */
function mockPlan(brief: string): AgentPlan {
  const mk = (key: string, name: string, job: string, intent: PlannedAgent["intent"], direction: PlannedAgent["direction"], handsOffTo: string[] = [], isFrontDoor = false): PlannedAgent => ({
    key, name, job, intent, direction, handsOffTo, isFrontDoor, needs: [], prompt: job, tools: [], knowledge: "", personaName: "Riya", voice: "Kore",
    nodes: [
      { id: `${key}_s`, kind: "start", title: "Greet", x: 40, y: 40, config: {} },
      { id: `${key}_i`, kind: "intent", title: "What do they need?", x: 300, y: 40, config: {} },
      { id: `${key}_e`, kind: "end", title: "Close and hang up", x: 560, y: 40, config: { hangUp: true } },
    ],
    edges: [
      { id: `${key}_e1`, from: `${key}_s`, to: `${key}_i`, tone: "default" },
      { id: `${key}_e2`, from: `${key}_i`, to: `${key}_e`, tone: "success" },
    ],
  });
  const agents = [
    mk("front", "Front door", "Greets, works out what the caller needs, hands off.", "other", "inbound", ["order", "complaints"], true),
    mk("order", "Order status", "Looks up the order and says where it is.", "order_status", "inbound", ["complaints"]),
    mk("complaints", "Complaints & refunds", "Registers complaints, reads back a reference number.", "complaint", "inbound"),
  ];
  return { brief, summary: "Three agents: a front door that routes, order status, and complaints.", questions: [], gaps: [], agents, source: "heuristic" };
}
