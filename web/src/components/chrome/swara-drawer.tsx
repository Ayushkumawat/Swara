"use client";

import { useMemo, useState } from "react";
import { Wand2 } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { toast } from "sonner";
import { RotateCcw, Sparkles, X } from "lucide-react";
import { useUi } from "@/lib/ui-store";
import { qk } from "@/lib/api/hooks";
import { BuildWithSwara, SwaraOrb } from "@/components/agents/build-with-swara";
import { SwaraChat, resetSwaraThread } from "@/components/agents/swara-chat";
import { cn } from "@/lib/utils";

/**
 * Swara, everywhere, in two sizes.
 *
 * The side pane (⌘J, the sparkle in the top bar, the Swara button on Agents
 * and Setup) is for talking: set the workspace up, change an agent, ask what
 * one does. The large "Build with Swara" popup is for making agents: a
 * brief, her questions as cards, then the plan to approve. Both are mounted
 * here so either can be opened from any screen, and a plan she proposes in
 * the pane opens the popup on its review step.
 */
export function SwaraDrawer() {
  const open = useUi((s) => s.swaraOpen);
  const setSwara = useUi((s) => s.setSwara);
  const context = useUi((s) => s.swaraContext);
  const seed = useUi((s) => s.swaraSeed);
  const consumeSeed = useUi((s) => s.consumeSwaraSeed);
  const setPendingAgentSelect = useUi((s) => s.setPendingAgentSelect);
  const qc = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();
  const buildOpen = useUi((s) => s.buildOpen);
  const buildBrief = useUi((s) => s.buildBrief);
  const buildPlan = useUi((s) => s.buildPlan);
  const openBuild = useUi((s) => s.openBuild);
  const closeBuild = useUi((s) => s.closeBuild);
  const openSwara = useUi((s) => s.openSwara);

  // Read the seed once per open so typing over it does not get reset.
  const [seedForThisOpen, setSeedForThisOpen] = useState("");
  const [seenOpen, setSeenOpen] = useState(false);
  if (open !== seenOpen) {
    setSeenOpen(open);
    if (open) setSeedForThisOpen(seed ? consumeSeed() : "");
  }

  const suggestions = useMemo(() => {
    if (context.agentName) {
      const n = context.agentName;
      return [
        `Make ${n} shorter and quicker on the phone`,
        `${n} should ask for the order number before anything else`,
        `Give ${n} a calmer voice`,
        `What does ${n} do when it can't find the order?`,
      ];
    }
    return [
      "We're a dental clinic in Pune — book, reschedule and remind patients",
      "D2C brand, 400 COD orders a day: where's my order, returns, complaints",
      "Add a complaints agent with a slower voice",
      "What do my agents do when nobody can take a transfer?",
    ];
  }, [context.agentName]);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["setup"] });
    void qc.invalidateQueries({ queryKey: qk.departments });
    void qc.invalidateQueries({ queryKey: qk.knowledge });
    void qc.invalidateQueries({ queryKey: qk.agents });
    void qc.invalidateQueries({ queryKey: qk.voices });
  };

  return (
    <>
      <AnimatePresence>
        {open ? (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSwara(false)}
              className="fixed inset-0 z-[80] bg-void/55 backdrop-blur-[2px]"
            />
            <motion.aside
              initial={{ x: 40, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: 40, opacity: 0 }}
              transition={{ type: "spring", stiffness: 340, damping: 34 }}
              role="dialog"
              aria-label="Swara"
              className="glass-popover fixed right-3 top-3 bottom-3 z-[82] flex w-[min(440px,calc(100vw-24px))] flex-col overflow-hidden rounded-[22px] border border-hairline"
            >
              <header className="flex items-center gap-3 border-b border-hairline px-4 py-3.5">
                <SwaraOrb size={34} />
                <div className="min-w-0 flex-1">
                  <div className="font-[family-name:var(--font-display)] text-[14.5px] font-semibold text-t1">Swara</div>
                  <div className="truncate text-[11px] text-t3">
                    {context.agentName ? `Looking at ${context.agentName} — tell her what to change` : "Sets up, builds and edits your agents"}
                  </div>
                </div>
                {!context.agentName ? (
                  <button
                    onClick={() => {
                      setSwara(false);
                      openBuild();
                    }}
                    title="Open the guided builder: brief, her questions, then the plan"
                    className="flex items-center gap-1.5 rounded-full border border-hairline bg-white/[0.04] px-2.5 py-1 text-[11px] text-t2 transition-colors hover:border-cyan/30 hover:text-t1"
                  >
                    <Wand2 className="size-3" /> Guided build
                  </button>
                ) : null}
                <button
                  onClick={() => {
                    resetSwaraThread();
                    toast("New conversation");
                  }}
                  title="New conversation"
                  aria-label="New conversation"
                  className="text-t3 transition-colors hover:text-t1"
                >
                  <RotateCcw className="size-4" />
                </button>
                <button onClick={() => setSwara(false)} aria-label="Close Swara" className="text-t3 transition-colors hover:text-t1">
                  <X className="size-4" />
                </button>
              </header>

              <div className="flex min-h-0 flex-1 flex-col px-4 pb-4 pt-3">
                <SwaraChat
                  className="min-h-0 flex-1"
                  seed={seedForThisOpen}
                  context={{ ...context, page: pathname.replace(/^\//, "") || undefined }}
                  suggestions={suggestions}
                  onSaved={refresh}
                  onPlan={(p) => openBuild({ plan: p })}
                />
                <p className="mt-2 text-center text-[10.5px] text-t3">
                  Every change she makes is a version you can roll back. <kbd className="rounded border border-hairline px-1 font-[family-name:var(--font-mono)]">⌘J</kbd> opens her anywhere.
                </p>
              </div>
            </motion.aside>
          </>
        ) : null}
      </AnimatePresence>

      <BuildWithSwara
        open={buildOpen}
        seedPlan={buildPlan}
        seedBrief={buildBrief}
        onClose={closeBuild}
        onTalk={() => {
          closeBuild();
          openSwara("", {});
        }}
        onCreated={(ids) => {
          closeBuild();
          refresh();
          if (ids[0]) setPendingAgentSelect(ids[0]);
          setSwara(false);
          if (!pathname.startsWith("/agents")) router.push("/agents");
        }}
      />
    </>
  );
}

/** Inline entry point for Overview: the same drawer, with a hint. */
export function SwaraBar({
  hint = "make the complaints agent slower and more patient",
  seed,
  className,
}: {
  hint?: string;
  seed?: string;
  className?: string;
}) {
  const openSwara = useUi((s) => s.openSwara);

  return (
    <motion.button
      onClick={() => openSwara(seed, {})}
      whileHover={{ y: -2 }}
      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
      className={cn(
        "group relative flex w-full items-center gap-3 overflow-hidden rounded-[22px] border border-hairline p-[18px] text-left backdrop-blur-[24px]",
        className,
      )}
      style={{ background: "linear-gradient(120deg, rgba(124,108,246,0.14), rgba(63,224,197,0.08))" }}
    >
      <span className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/[0.07] to-transparent transition-transform duration-[1100ms] group-hover:translate-x-full" />
      <span className="grad-brand flex size-8 shrink-0 items-center justify-center rounded-[9px]">
        <Sparkles className="size-4 text-void" strokeWidth={2} />
      </span>
      <span className="min-w-0 flex-1 text-[13px] text-t2">
        Ask Swara to set up, build or change an agent — <span className="font-medium text-t1">&ldquo;{hint}&rdquo;</span>
      </span>
      <span className="hidden shrink-0 text-xs font-medium text-cyan sm:block">Open Swara →</span>
    </motion.button>
  );
}
