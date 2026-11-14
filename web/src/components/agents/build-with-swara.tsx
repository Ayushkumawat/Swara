"use client";

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { toast } from "sonner";
import { ArrowRight, ArrowRightLeft, Check, Loader2, PhoneIncoming, PhoneOutgoing, Sparkles, TriangleAlert, X } from "lucide-react";
import { Button, IconButton } from "@/components/ui/button";
import { Pill } from "@/components/ui/pill";
import { Select } from "@/components/ui/controls";
import { QuestionCards, type CardQuestion } from "@/components/agents/question-cards";
import { HUMAN_MODE_OPTIONS, usesLabels } from "@/lib/agents/human-mode";
import { LIVE_VOICES } from "@/lib/live/config";
import { IS_MOCK, mutations } from "@/lib/api/client";
import { INTENT_LABEL, type AgentPlan, type PlannedAgent } from "@/lib/api/schemas";
import { cn } from "@/lib/utils";

/**
 * Build with Swara — the guided way to get agents.
 *
 * Three moves, each on its own screen so none of them is a wall of fields:
 *   1. the brief — what the business does and why people call, in the
 *      owner's words;
 *   2. her questions — one card each, with its own answer box, suggested
 *      answers to tap, and Skip; answer any, leave the rest;
 *   3. the plan — read it, rename and re-voice each agent, choose what each
 *      does when a call needs a person, and approve.
 *
 * Nothing is created before approval. The plan comes from the server's
 * planner (Gemini shaping + deterministic flow construction). When Swara
 * proposes a plan in the side-pane chat, this opens straight on step 3.
 */
type Step = "brief" | "planning" | "questions" | "review" | "building" | "done";

const BRIEF_EXAMPLES = [
  "Dental clinic in Pune. People call to book, reschedule and ask fees. Remind patients the day before. If something needs me, don't transfer — email me after the call.",
  "D2C brand, about 400 COD orders a day. Calls are where's-my-order, returns and complaints. Angry callers should be put through to our support lead.",
  "Coaching institute. Admissions enquiries and counselling slots; a counsellor can join the call when a parent is ready to enrol.",
];

export function BuildWithSwara({
  open,
  onClose,
  onCreated,
  seedPlan,
  seedBrief = "",
  onTalk,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (ids: string[]) => void;
  /** A plan Swara already proposed in chat — opens on the review. */
  seedPlan: AgentPlan | null;
  /** Prefills the brief when opening from scratch. */
  seedBrief?: string;
  /** "I'd rather talk it through" — hands over to the side-pane chat. */
  onTalk?: () => void;
}) {
  const [step, setStep] = useState<Step>("brief");
  const [brief, setBrief] = useState(seedBrief);
  // The brief the current plan was made from; answers are added to it, not
  // to the plan's own (already expanded) copy.
  const [baseBrief, setBaseBrief] = useState("");
  const [plan, setPlan] = useState<AgentPlan | null>(seedPlan);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  // Her questions get one screen of their own, once. After that they sit
  // under the plan, where answering them is optional polish.
  const [asked, setAsked] = useState(false);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [built, setBuilt] = useState<string[]>([]);
  const [builtIds, setBuiltIds] = useState<string[]>([]);

  // Decide where to start each time the popup opens. A render-phase
  // compare-and-set, not an effect.
  const [seen, setSeen] = useState<{ open: boolean; seed: AgentPlan | null }>({ open: false, seed: null });
  if (open !== seen.open || seedPlan !== seen.seed) {
    setSeen({ open, seed: seedPlan });
    if (open && seedPlan) {
      setPlan(seedPlan);
      setBaseBrief(seedPlan.brief);
      setSelected(Object.fromEntries(seedPlan.agents.map((a) => [a.key, true])));
      setAnswers({});
      setAsked(true);
      setBuilt([]);
      setBuiltIds([]);
      setStep("review");
    } else if (open && !seen.open) {
      // Opened from scratch. A plan left half-reviewed is still there to
      // come back to, unless this open brings a new brief.
      const resume = plan !== null && !seedBrief && (step === "review" || step === "questions");
      if (!resume) {
        setPlan(null);
        setBrief(seedBrief);
        setBaseBrief("");
        setAnswers({});
        setAsked(false);
        setBuilt([]);
        setBuiltIds([]);
        setStep("brief");
      }
    }
  }

  const reset = () => {
    setPlan(null);
    setBrief("");
    setBaseBrief("");
    setAnswers({});
    setAsked(false);
    setBuilt([]);
    setBuiltIds([]);
    setStep("brief");
  };

  /**
   * Plan, or re-plan. `from` is a new brief (step 1); `more` are answers to
   * add to the ones already given. A failed attempt leaves whatever plan
   * was on screen exactly as it was.
   */
  const runPlan = async (opts: { from?: string; more?: Record<string, string> } = {}) => {
    const source = opts.from ?? baseBrief;
    const all = opts.from !== undefined ? {} : { ...answers, ...(opts.more ?? {}) };
    const back: Step = plan && opts.from === undefined ? "review" : "brief";
    if (IS_MOCK) {
      toast("Demo mode — connect the API and Swara will plan from your brief.");
      return;
    }
    setStep("planning");
    try {
      const next = await mutations.planAgents({ brief: source, answers: all });
      setBaseBrief(source);
      setAnswers(all);
      setPlan(next);
      setSelected(Object.fromEntries(next.agents.map((a) => [a.key, true])));
      // Her questions get a screen of their own once, straight after a new
      // brief. Any later re-plan lands on the plan, with whatever she would
      // still ask listed under it.
      const stillOpen = next.questions.filter((q) => !(q in all));
      const fresh = opts.from !== undefined;
      setAsked(!fresh || stillOpen.length === 0);
      setStep(fresh && stillOpen.length ? "questions" : "review");
    } catch (error) {
      toast.error(plan && opts.from === undefined ? "Planning failed — nothing was replaced" : "Swara could not draft a plan", {
        description: `${plan && opts.from === undefined ? "Your current plan is still here. " : ""}${errorText(error)}`,
      });
      setStep(back);
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
      toast.error("Could not create agents", { description: errorText(error) });
      setStep("review");
    }
  };

  const chosenCount = plan ? plan.agents.filter((a) => selected[a.key]).length : 0;
  const openQuestions: CardQuestion[] = plan
    ? plan.questions
        .filter((q) => !(q in answers))
        .map((q) => ({ question: q, suggestions: plan.questionOptions?.[q] ?? [] }))
    : [];
  const briefReady = brief.trim().length >= 12;
  const guided = step === "brief" || step === "questions" || (step === "planning" && !asked);

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
            aria-label={guided ? "Build with Swara" : "Swara's plan"}
          >
            <header className="flex items-start justify-between gap-3 border-b border-hairline p-4">
              <div className="flex items-center gap-3">
                <SwaraOrb active={step === "planning" || step === "building"} />
                <div>
                  <div className="font-[family-name:var(--font-display)] text-[15px] font-semibold text-t1">
                    {guided ? "Build with Swara" : "Swara\u2019s plan"}
                  </div>
                  <p className="mt-0.5 text-[11.5px] text-t3">
                    {step === "brief" && "Tell her what your agents should handle. She asks about anything that is missing."}
                    {step === "planning" && "Reading your workspace, deciding which agents you need…"}
                    {step === "questions" && "A first draft is ready. Answer what you like — each answer sharpens it."}
                    {step === "review" && "Review the plan. Nothing is created until you approve."}
                    {step === "building" && "Creating agents and wiring their flows…"}
                    {step === "done" && "Done. Each agent has a flow you can open, test and publish."}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <StepDots step={step} />
                <IconButton onClick={onClose} aria-label="Close">
                  <X className="size-4" />
                </IconButton>
              </div>
            </header>

            <div className="flex-1 overflow-y-auto p-5">
              <AnimatePresence mode="wait">
                {step === "brief" ? (
                  <motion.div key="brief" {...fade} className="space-y-3.5">
                    <label className="block">
                      <span className="mb-1.5 block text-[12.5px] font-medium text-t1">What does your business do, and why do people call?</span>
                      <textarea
                        value={brief}
                        onChange={(e) => setBrief(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && briefReady) {
                            e.preventDefault();
                            void runPlan({ from: brief.trim() });
                          }
                        }}
                        rows={6}
                        autoFocus
                        placeholder="A few sentences, the way you'd explain it to a new receptionist."
                        className="glass w-full resize-y rounded-[14px] p-3.5 text-[13px] leading-relaxed text-t1 outline-none placeholder:text-t3 focus:border-cyan/45"
                      />
                    </label>
                    <div className="rounded-[14px] border border-hairline bg-white/[0.02] p-3.5">
                      <div className="mb-2 text-[11px] uppercase tracking-[0.07em] text-t3">Worth mentioning</div>
                      <ul className="grid gap-x-6 gap-y-1 text-[12px] leading-relaxed text-t2 sm:grid-cols-2">
                        <li>· The three or four reasons people call</li>
                        <li>· Who a call should reach, if anyone</li>
                        <li>· Should that person join the call, or be told after it?</li>
                        <li>· Anything you also call customers about</li>
                      </ul>
                    </div>
                    <div>
                      <div className="mb-1.5 text-[11px] text-t3">Or start from an example and edit it</div>
                      <div className="flex flex-col gap-1.5">
                        {BRIEF_EXAMPLES.map((ex) => (
                          <button
                            key={ex}
                            type="button"
                            onClick={() => setBrief(ex)}
                            className="rounded-[11px] border border-hairline bg-white/[0.03] px-3 py-2 text-left text-[11.5px] leading-relaxed text-t2 transition-colors hover:border-cyan/30 hover:text-t1"
                          >
                            {ex}
                          </button>
                        ))}
                      </div>
                    </div>
                  </motion.div>
                ) : null}

                {step === "planning" ? (
                  <motion.div key="planning" {...fade}>
                    <Thinking />
                  </motion.div>
                ) : null}

                {step === "questions" && plan ? (
                  <motion.div key="questions" {...fade} className="space-y-4">
                    <div className="glass rounded-[16px] p-4">
                      <div className="flex items-start gap-3">
                        <Sparkles className="mt-0.5 size-4 shrink-0 text-cyan" />
                        <div className="min-w-0">
                          <p className="text-[13px] leading-relaxed text-t1">{plan.summary}</p>
                          <p className="mt-1 text-[11px] text-t3">
                            First draft: {plan.agents.map((a) => a.name).join(" · ")}
                          </p>
                        </div>
                      </div>
                    </div>
                    <div className="text-[12.5px] font-medium text-t1">
                      {openQuestions.length === 1 ? "One thing Swara would like to know" : `${openQuestions.length} things Swara would like to know`}
                    </div>
                    <QuestionCards
                      key={plan.questions.join("|")}
                      questions={openQuestions}
                      submitLabel="Update the plan"
                      skipAllLabel="Skip — show me the plan"
                      onSubmit={(a) => {
                        setAsked(true);
                        void runPlan({ more: a });
                      }}
                      onSkipAll={() => {
                        setAsked(true);
                        setStep("review");
                      }}
                    />
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
                            {Object.keys(answers).length ? ` · ${Object.keys(answers).length} of your answers used` : ""}
                          </p>
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            <Button size="sm" variant="subtle" onClick={() => void runPlan()}>
                              Retry plan
                            </Button>
                            <Button
                              size="sm"
                              variant="subtle"
                              onClick={() => {
                                setBrief(baseBrief);
                                setStep("brief");
                              }}
                            >
                              Edit the brief
                            </Button>
                          </div>
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

                    {openQuestions.length ? (
                      <div className="glass rounded-[16px] p-4">
                        <div className="mb-1 text-[12.5px] font-medium text-t1">Swara would still ask</div>
                        <p className="mb-3 text-[11.5px] text-t3">
                          Optional. Answer any of these and she redrafts the plan with it; skip them and build as it is.
                        </p>
                        <QuestionCards
                          key={plan.questions.join("|")}
                          questions={openQuestions}
                          submitLabel="Re-plan with answers"
                          onSubmit={(a) => void runPlan({ more: a })}
                        />
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
                      reaches the wrong agent gets passed along with a summary. To change one later, open it and tell
                      Swara what to change.
                    </p>
                  </motion.div>
                ) : null}
              </AnimatePresence>
            </div>

            <footer className="flex items-center justify-between gap-3 border-t border-hairline p-3.5">
              <div className="min-w-0 text-[11.5px] text-t3">
                {step === "brief" && onTalk ? (
                  <button type="button" onClick={onTalk} className="text-t2 underline-offset-2 transition-colors hover:text-t1 hover:underline">
                    Rather talk it through? Chat with Swara instead
                  </button>
                ) : null}
                {step === "review" && plan ? `${chosenCount} of ${plan.agents.length} selected` : ""}
              </div>
              <div className="flex gap-2">
                {step === "brief" ? (
                  <>
                    <Button variant="subtle" onClick={() => void runPlan({ from: "" })} title="Plan from the business details, people and bookable types already in Workspace setup">
                      Use what&apos;s already set up
                    </Button>
                    <Button variant="primary" onClick={() => void runPlan({ from: brief.trim() })} disabled={!briefReady}>
                      Plan my agents
                      <ArrowRight className="size-3.5" />
                    </Button>
                  </>
                ) : null}
                {step === "review" ? (
                  <>
                    <Button variant="subtle" onClick={onClose}>
                      Not now
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

/** Where the owner is in the three moves. */
function StepDots({ step }: { step: Step }) {
  const at = step === "brief" ? 0 : step === "questions" ? 1 : step === "planning" ? -1 : 2;
  if (at < 0) return null;
  return (
    <div className="hidden items-center gap-1.5 text-[10.5px] text-t3 sm:flex" aria-hidden>
      {["Brief", "Questions", "Plan"].map((label, i) => (
        <span key={label} className="flex items-center gap-1.5">
          {i ? <span className="h-px w-3 bg-hairline" /> : null}
          <span className={cn("rounded-full px-2 py-0.5", i === at ? "bg-white/[0.09] text-t1" : i < at ? "text-t2" : "")}>{label}</span>
        </span>
      ))}
    </div>
  );
}

const fade = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -6 },
  transition: { duration: 0.22 },
};

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
  onChange: (patch: Partial<Pick<PlannedAgent, "personaName" | "voice" | "humanMode">>) => void;
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
        <label className="block sm:col-span-2">
          <span className="mb-1 block text-[10.5px] uppercase tracking-wide text-t3">When a call needs a person</span>
          <Select
            size="sm"
            value={agent.humanMode}
            onChange={(v) => onChange({ humanMode: v })}
            options={HUMAN_MODE_OPTIONS}
          />
        </label>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        <Pill tone="violet">{INTENT_LABEL[agent.intent]}</Pill>
        <Pill>
          <Dir className="size-3" /> {agent.direction}
        </Pill>
        <Pill>{agent.nodes.length} steps</Pill>
        {usesLabels(agent.needs).map((n) => (
          <Pill key={n} tone="amber">
            uses {n}
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
  "Reading what your workspace already has",
  "Listing why people call",
  "Separating angry-caller work from sales",
  "Checking who a call can reach, and how",
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
