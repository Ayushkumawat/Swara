"use client";

import { useState } from "react";
import { motion } from "motion/react";
import { ArrowRight, Check, Loader2, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type CardQuestion = { question: string; suggestions?: string[] };

/**
 * Swara's questions, one card each.
 *
 * Every question has its own answer box, so the owner answers the ones they
 * care about and leaves the rest — nothing forces a reply to all of them in
 * one paragraph. Suggested answers are one tap and stay editable; "Skip"
 * says "use your judgement" out loud instead of leaving a box ambiguously
 * empty. Used in the Build-with-Swara popup and in the side-pane chat, so
 * the two behave the same.
 */
export function QuestionCards({
  questions,
  onSubmit,
  onSkipAll,
  busy,
  submitLabel = "Send answers",
  skipAllLabel = "Skip all",
  dense,
  className,
}: {
  questions: CardQuestion[];
  /** Only the questions that were answered; skipped and blank ones are left out. */
  onSubmit: (answers: Record<string, string>) => void;
  onSkipAll?: () => void;
  busy?: boolean;
  submitLabel?: string;
  skipAllLabel?: string;
  /** Tighter spacing for the side pane. */
  dense?: boolean;
  className?: string;
}) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [skipped, setSkipped] = useState<Record<string, boolean>>({});

  const answered = questions.filter((q) => !skipped[q.question] && (answers[q.question] ?? "").trim());
  const submit = () => {
    if (!answered.length || busy) return;
    onSubmit(Object.fromEntries(answered.map((q) => [q.question, answers[q.question].trim()])));
  };

  return (
    <div className={cn(dense ? "space-y-2" : "space-y-3", className)}>
      {questions.map((q, i) => {
        const value = answers[q.question] ?? "";
        const isSkipped = Boolean(skipped[q.question]);
        const done = !isSkipped && value.trim().length > 0;
        return (
          <motion.div
            key={q.question}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05, duration: 0.24 }}
            className={cn(
              "rounded-[14px] border transition-colors",
              dense ? "p-3" : "p-3.5",
              isSkipped ? "border-hairline bg-white/[0.015] opacity-60" : done ? "border-cyan/30 bg-cyan/[0.04]" : "border-hairline bg-white/[0.03]",
            )}
          >
            <div className="flex items-start gap-2.5">
              <span
                className={cn(
                  "mt-px flex size-[18px] shrink-0 items-center justify-center rounded-full border text-[10px] font-medium",
                  done ? "border-cyan bg-cyan/20 text-cyan" : "border-hairline text-t3",
                )}
              >
                {done ? <Check className="size-2.5" strokeWidth={3} /> : i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className={cn("leading-snug text-t1", dense ? "text-[12.5px]" : "text-[13px]", isSkipped && "line-through decoration-t3/60")}>
                  {q.question}
                </div>

                {isSkipped ? (
                  <button
                    type="button"
                    onClick={() => setSkipped((s) => ({ ...s, [q.question]: false }))}
                    className="mt-1.5 flex items-center gap-1 text-[11px] text-t3 transition-colors hover:text-t1"
                  >
                    <Undo2 className="size-3" /> Skipped — Swara will use her judgement. Answer after all
                  </button>
                ) : (
                  <>
                    {q.suggestions?.length ? (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {q.suggestions.map((s) => {
                          const picked = value.trim() === s;
                          return (
                            <button
                              key={s}
                              type="button"
                              disabled={busy}
                              onClick={() => setAnswers((a) => ({ ...a, [q.question]: picked ? "" : s }))}
                              className={cn(
                                "rounded-full border px-2.5 py-1 text-left text-[11.5px] transition-colors",
                                picked
                                  ? "border-cyan/50 bg-cyan/[0.12] text-t1"
                                  : "border-hairline bg-white/[0.03] text-t2 hover:border-cyan/30 hover:text-t1",
                              )}
                            >
                              {s}
                            </button>
                          );
                        })}
                      </div>
                    ) : null}
                    <div className="mt-2 flex items-end gap-2">
                      <textarea
                        value={value}
                        disabled={busy}
                        onChange={(e) => setAnswers((a) => ({ ...a, [q.question]: e.target.value }))}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                            e.preventDefault();
                            submit();
                          }
                        }}
                        rows={1}
                        placeholder={q.suggestions?.length ? "Or say it in your own words…" : "Your answer…"}
                        aria-label={q.question}
                        className="glass min-h-[34px] flex-1 resize-y rounded-[10px] px-2.5 py-1.5 text-[12.5px] text-t1 outline-none placeholder:text-t3 focus:border-cyan/45"
                      />
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => setSkipped((s) => ({ ...s, [q.question]: true }))}
                        className="shrink-0 rounded-[9px] border border-hairline px-2.5 py-1.5 text-[11.5px] text-t2 transition-colors hover:bg-white/[0.05] hover:text-t1"
                      >
                        Skip
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </motion.div>
        );
      })}

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" size={dense ? "sm" : "md"} disabled={busy || answered.length === 0} onClick={submit}>
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
          {submitLabel}
          {!busy ? <ArrowRight className="size-3.5" /> : null}
        </Button>
        {onSkipAll ? (
          <Button variant="subtle" size={dense ? "sm" : "md"} disabled={busy} onClick={onSkipAll}>
            {skipAllLabel}
          </Button>
        ) : null}
        <span className="text-[11px] text-t3">
          {answered.length} of {questions.length} answered — answer any, skip the rest
        </span>
      </div>
    </div>
  );
}

/** How answers travel back to Swara: one "Q / A" pair per answered question. */
export function formatAnswers(answers: Record<string, string>) {
  return Object.entries(answers)
    .map(([q, a]) => `Q: ${q}\nA: ${a}`)
    .join("\n\n");
}
