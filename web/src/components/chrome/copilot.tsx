"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { toast } from "sonner";
import { Sparkles, X, ArrowUp, Check, Undo2 } from "lucide-react";
import { useUi } from "@/lib/ui-store";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/ui/pill";
import { cn } from "@/lib/utils";

/**
 * The flow copilot.
 *
 * project.md §3/§6 treats this as the most defensible feature in the product
 * and warns it is easy to under-invest in. So it is built as a real surface:
 * a conversation that proposes a concrete, reviewable change set which the
 * user applies or discards — never an edit that silently mutates a live agent.
 *
 * The responder below is a scripted stand-in. Replacing it means swapping
 * `respond()` for a streaming call to the agentic backend; the review/apply
 * UI around it does not change.
 */

type Change = { kind: "add" | "edit" | "remove"; target: string; detail: string };

type Message =
  | { id: string; role: "user"; text: string }
  | {
      id: string;
      role: "copilot";
      text: string;
      changes?: Change[];
      applied?: boolean;
      pending?: boolean;
    };

const SUGGESTIONS = [
  "Add a Tamil greeting to the delivery-reschedule agent",
  "Confirm spelling of the address before booking a slot",
  "Escalate to a human if sentiment drops below 0.3",
  "Stop the COD reminder campaign calling after 8pm",
];

/** Scripted planner. Keyword-matched so the demo responds sensibly to the
 *  suggestions above and to freeform text alike. */
function respond(input: string): { text: string; changes?: Change[] } {
  const q = input.toLowerCase();

  if (q.includes("tamil") || q.includes("greeting") || q.includes("language")) {
    return {
      text: "I'll add Tamil to the greeting node's detection set and write a matching opening line. Language detection already runs in the first 1.2s, so this needs no extra latency budget.",
      changes: [
        { kind: "edit", target: "Start · Greeting + language detect", detail: "Detection set → hi, ta, en (was hi, en)" },
        { kind: "add", target: "Start · script variant", detail: '"வணக்கம், உங்கள் டெலிவரி பற்றி அழைக்கிறேன்."' },
        { kind: "edit", target: "Agent · Delivery reschedule", detail: "Voice for ta → Karthik (brisk, Tamil)" },
      ],
    };
  }

  if (q.includes("address") || q.includes("spelling") || q.includes("confirm")) {
    return {
      text: "I'll insert a confirmation step between the branch and the booking commit. It reads the address back and waits for a yes before the slot is held, which should cut re-delivery failures.",
      changes: [
        { kind: "add", target: "Collect · Confirm address", detail: "Reads address back, requires explicit confirmation" },
        { kind: "edit", target: "Branch → Book", detail: "Now routes through Confirm address" },
        { kind: "edit", target: "Book · Commit new delivery slot", detail: "Hold extended 45s → 60s to cover the extra turn" },
      ],
    };
  }

  if (q.includes("sentiment") || q.includes("escalate") || q.includes("frustrat")) {
    return {
      text: "I'll add a sentiment guard that runs continuously, not just at the branch. Below 0.3 it hands off to a human with the transcript summary attached.",
      changes: [
        { kind: "add", target: "Guard · Sentiment watchdog", detail: "Triggers when rolling score < 0.30" },
        { kind: "edit", target: "Escalate · Transfer to human", detail: "Accepts trigger from watchdog as well as branch" },
      ],
    };
  }

  if (q.includes("8pm") || q.includes("quiet") || q.includes("hours") || q.includes("cod")) {
    return {
      text: "Quiet hours are enforced in the dialer rather than the flow, so this is a campaign setting. Note the regulatory floor is 9pm — tightening to 8pm is stricter than required, which is fine.",
      changes: [
        { kind: "edit", target: "Campaign · COD payment reminders", detail: "Quiet hours 21:00–09:00 → 20:00–09:00" },
        { kind: "edit", target: "Retry policy", detail: "Retries falling in quiet hours roll to the next morning" },
      ],
    };
  }

  return {
    text: "I can edit flows, agent prompts, voices, campaign settings and escalation rules. Tell me the outcome you want — for example “stop asking for the order number when we already know it from the caller ID” — and I'll show you the exact changes before anything goes live.",
  };
}

export function CopilotDrawer() {
  const open = useUi((s) => s.copilotOpen);
  const setCopilot = useUi((s) => s.setCopilot);
  const seed = useUi((s) => s.copilotSeed);

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Prefill on the closed→open transition only, so typing isn't clobbered if
  // the seed prop changes while the drawer is already open.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open && seed) setInput(seed);
  }

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 250);
  }, [open]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  const send = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || busy) return;

    const userMsg: Message = { id: crypto.randomUUID(), role: "user", text: trimmed };
    setMessages((m) => [...m, userMsg]);
    setInput("");
    setBusy(true);

    setTimeout(() => {
      const { text: reply, changes } = respond(trimmed);
      setMessages((m) => [
        ...m,
        { id: crypto.randomUUID(), role: "copilot", text: reply, changes, pending: Boolean(changes) },
      ]);
      setBusy(false);
    }, 900);
  };

  const resolve = (id: string, apply: boolean) => {
    setMessages((m) =>
      m.map((msg) =>
        msg.id === id && msg.role === "copilot"
          ? { ...msg, pending: false, applied: apply }
          : msg,
      ),
    );
    if (apply) {
      toast.success("Changes staged on a draft version", {
        description: "Nothing is live until you publish. Roll back any time from Versions.",
      });
    }
  };

  return (
    <AnimatePresence>
      {open ? (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={() => setCopilot(false)}
            className="fixed inset-0 z-[90] bg-void/60 backdrop-blur-sm"
          />
          <motion.aside
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", stiffness: 320, damping: 36 }}
            className="glass-strong fixed right-0 top-0 z-[95] flex h-full w-full max-w-[460px] flex-col border-l border-hairline"
          >
            <header className="flex items-center gap-3 border-b border-hairline px-5 py-4">
              <div className="grad-brand flex size-8 items-center justify-center rounded-[9px]">
                <Sparkles className="size-4 text-void" strokeWidth={2} />
              </div>
              <div className="flex-1">
                <div className="font-[family-name:var(--font-display)] text-[14.5px] font-semibold text-t1">
                  Flow copilot
                </div>
                <div className="text-[11px] text-t3">Edits are staged as a draft, never applied live</div>
              </div>
              <button
                onClick={() => setCopilot(false)}
                aria-label="Close copilot"
                className="text-t3 transition-colors hover:text-t1"
              >
                <X className="size-4" />
              </button>
            </header>

            <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto px-5 py-5">
              {messages.length === 0 ? (
                <div className="space-y-4">
                  <p className="text-[13px] leading-relaxed text-t2">
                    Describe the outcome you want and I&apos;ll show you the exact changes to your
                    agents, flows or campaigns before anything ships.
                  </p>
                  <div className="space-y-2">
                    {SUGGESTIONS.map((s, i) => (
                      <motion.button
                        key={s}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.06 * i, duration: 0.4 }}
                        onClick={() => send(s)}
                        className="glass w-full rounded-[12px] px-3.5 py-2.5 text-left text-[12.5px] text-t2 transition-colors hover:bg-white/[0.08] hover:text-t1"
                      >
                        {s}
                      </motion.button>
                    ))}
                  </div>
                </div>
              ) : null}

              {messages.map((m) =>
                m.role === "user" ? (
                  <motion.div
                    key={m.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="ml-auto max-w-[85%] rounded-[14px] rounded-br-[4px] bg-violet/[0.18] px-3.5 py-2.5 text-[13px] text-t1"
                  >
                    {m.text}
                  </motion.div>
                ) : (
                  <motion.div
                    key={m.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="max-w-[92%] space-y-3"
                  >
                    <p className="text-[13px] leading-relaxed text-t2">{m.text}</p>

                    {m.changes ? (
                      <div className="glass overflow-hidden rounded-[14px]">
                        <div className="flex items-center justify-between border-b border-hairline px-3.5 py-2">
                          <span className="text-[11.5px] font-medium text-t2">
                            Proposed changes
                          </span>
                          {m.applied ? (
                            <Pill tone="cyan">Staged</Pill>
                          ) : m.pending ? (
                            <Pill tone="amber">Needs review</Pill>
                          ) : (
                            <Pill tone="grey">Discarded</Pill>
                          )}
                        </div>
                        <div className="divide-y divide-white/[0.05]">
                          {m.changes.map((c, i) => (
                            <div key={i} className="flex gap-2.5 px-3.5 py-2.5">
                              <span
                                className={cn(
                                  "mt-px font-[family-name:var(--font-mono)] text-[11px]",
                                  c.kind === "add"
                                    ? "text-cyan"
                                    : c.kind === "remove"
                                      ? "text-coral"
                                      : "text-amber",
                                )}
                              >
                                {c.kind === "add" ? "+" : c.kind === "remove" ? "−" : "~"}
                              </span>
                              <div className="min-w-0">
                                <div className="text-[12.5px] text-t1">{c.target}</div>
                                <div className="mt-0.5 text-[11.5px] leading-snug text-t3">
                                  {c.detail}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                        {m.pending ? (
                          <div className="flex gap-2 border-t border-hairline p-2.5">
                            <Button
                              size="sm"
                              variant="primary"
                              className="flex-1"
                              onClick={() => resolve(m.id, true)}
                            >
                              <Check className="size-3.5" />
                              Stage changes
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => resolve(m.id, false)}>
                              <Undo2 className="size-3.5" />
                              Discard
                            </Button>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </motion.div>
                ),
              )}

              {busy ? (
                <div className="flex items-center gap-2 text-[12.5px] text-t3">
                  <span className="flex gap-1">
                    {[0, 1, 2].map((i) => (
                      <motion.span
                        key={i}
                        className="size-1.5 rounded-full bg-cyan"
                        animate={{ opacity: [0.25, 1, 0.25] }}
                        transition={{ duration: 1.1, repeat: Infinity, delay: i * 0.18 }}
                      />
                    ))}
                  </span>
                  Working out the change set…
                </div>
              ) : null}
            </div>

            <div className="border-t border-hairline p-3.5">
              <div className="glass flex items-end gap-2 rounded-[14px] p-2.5">
                <textarea
                  ref={inputRef}
                  rows={1}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      send(input);
                    }
                  }}
                  placeholder="Ask the copilot to build or edit a flow…"
                  className="max-h-32 flex-1 resize-none bg-transparent px-1 py-1 text-[13px] text-t1 outline-none placeholder:text-t3"
                />
                <Button
                  size="sm"
                  variant="primary"
                  disabled={!input.trim() || busy}
                  onClick={() => send(input)}
                  className="!px-2.5"
                >
                  <ArrowUp className="size-3.5" />
                </Button>
              </div>
            </div>
          </motion.aside>
        </>
      ) : null}
    </AnimatePresence>
  );
}

/** The inline entry point used on Overview and the flow canvas. */
export function CopilotBar({
  hint = "add a Tamil greeting to the delivery-reschedule agent",
  seed,
  className,
}: {
  hint?: string;
  seed?: string;
  className?: string;
}) {
  const openCopilot = useUi((s) => s.openCopilot);

  return (
    <motion.button
      onClick={() => openCopilot(seed)}
      whileHover={{ y: -2 }}
      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
      className={cn(
        "group relative flex w-full items-center gap-3 overflow-hidden rounded-[22px] border border-hairline p-[18px] text-left backdrop-blur-[24px]",
        className,
      )}
      style={{
        background:
          "linear-gradient(120deg, rgba(124,108,246,0.14), rgba(63,224,197,0.08))",
      }}
    >
      {/* Light sweeps across on hover — signals this is the live, AI surface. */}
      <span className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/[0.07] to-transparent transition-transform duration-[1100ms] group-hover:translate-x-full" />

      <span className="grad-brand flex size-8 shrink-0 items-center justify-center rounded-[9px]">
        <Sparkles className="size-4 text-void" strokeWidth={2} />
      </span>
      <span className="min-w-0 flex-1 text-[13px] text-t2">
        Ask the copilot to build or edit a flow —{" "}
        <span className="font-medium text-t1">&ldquo;{hint}&rdquo;</span>
      </span>
      <span className="hidden shrink-0 text-xs font-medium text-cyan sm:block">
        Open copilot →
      </span>
    </motion.button>
  );
}
