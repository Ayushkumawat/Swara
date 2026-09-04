"use client";

import { useState } from "react";
import { motion } from "motion/react";
import { toast } from "sonner";
import { Info, Mic, Pause, Play, Trophy } from "lucide-react";
import { PageHead } from "@/components/chrome/page-head";
import { Card, CardHead } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/ui/pill";
import { ProgressBar, Slider } from "@/components/ui/controls";
import { CardSkeleton, QueryBoundary } from "@/components/ui/feedback";
import { Waveform } from "@/components/ui/live";
import { Mono } from "@/components/ui/table";
import { LazyMount, Reveal } from "@/components/motion/primitives";
import { useScriptTests, useVoices } from "@/lib/api/hooks";
import { LANGUAGE_LABEL, type ScriptTest, type Voice } from "@/lib/api/schemas";
import { cn } from "@/lib/utils";

export default function VoiceStudioPage() {
  const voices = useVoices();
  const tests = useScriptTests();
  const [playing, setPlaying] = useState<string | null>(null);

  return (
    <>
      <PageHead
        title="Voice studio"
        sub="Pick, tune, or clone voices per agent and language"
        actions={
          <Button variant="primary" onClick={() => toast("Record 40 seconds to clone a voice")}>
            <Mic className="size-3.5" />
            Clone a voice
          </Button>
        }
      />

      <Reveal className="mb-3.5">
        <div className="flex gap-3 rounded-[18px] border border-violet/20 bg-violet/[0.07] px-4 py-3.5">
          <Info className="mt-px size-4 shrink-0 text-violet" strokeWidth={1.7} />
          <p className="text-[12.5px] leading-relaxed text-t2">
            These sliders map to parameters the self-hosted speech-to-speech model actually exposes.
            Anything the model cannot tune is deliberately absent rather than shown as a control
            that quietly does nothing.
          </p>
        </div>
      </Reveal>

      <QueryBoundary
        query={voices}
        skeleton={
          <div className="grid gap-3.5 md:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <CardSkeleton key={i} height={250} />
            ))}
          </div>
        }
      >
        {(list) => (
          <div className="grid gap-3.5 md:grid-cols-2 xl:grid-cols-3">
            {list.map((v, i) => (
              <VoiceCard
                key={v.id}
                voice={v}
                index={i}
                playing={playing === v.id}
                onPlay={() => setPlaying(playing === v.id ? null : v.id)}
              />
            ))}
          </div>
        )}
      </QueryBoundary>

      <LazyMount className="mt-3.5" placeholder={<CardSkeleton height={280} />}>
        <QueryBoundary query={tests} skeleton={<CardSkeleton height={280} />}>
          {(list) => (
            <div className="space-y-3.5">
              {list.map((t) => (
                <ScriptTestCard key={t.id} test={t} />
              ))}
            </div>
          )}
        </QueryBoundary>
      </LazyMount>
    </>
  );
}

function VoiceCard({
  voice,
  index,
  playing,
  onPlay,
}: {
  voice: Voice;
  index: number;
  playing: boolean;
  onPlay: () => void;
}) {
  const [pace, setPace] = useState(voice.pace);
  const [formality, setFormality] = useState(voice.formality);
  const [warmth, setWarmth] = useState(voice.warmth);
  const dirty = pace !== voice.pace || formality !== voice.formality || warmth !== voice.warmth;

  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.06, duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
    >
      <Card interactive={false} className="h-full">
        <div className="mb-4 flex items-center gap-3">
          <button
            onClick={onPlay}
            aria-label={playing ? "Stop preview" : "Play preview"}
            className="grad-brand flex size-9 shrink-0 items-center justify-center rounded-full transition-transform hover:scale-105"
          >
            {playing ? (
              <Pause className="size-3.5 text-void" fill="currentColor" />
            ) : (
              <Play className="size-3.5 translate-x-px text-void" fill="currentColor" />
            )}
          </button>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate text-[13px] font-medium text-t1">{voice.name}</span>
              {voice.cloned ? <Pill tone="violet">Cloned</Pill> : null}
            </div>
            <div className="mt-0.5 truncate text-[11px] text-t3">
              {LANGUAGE_LABEL[voice.language]} · {voice.descriptor}
            </div>
          </div>
        </div>

        <div className="mb-4 flex h-6 items-center">
          {playing ? (
            <Waveform bars={22} height={22} tone="cyan" className="w-full [&>span]:flex-1" />
          ) : (
            <div className="h-px w-full bg-hairline" />
          )}
        </div>

        <div className="space-y-3.5">
          <Slider label="Pace" value={pace} onChange={setPace} format={(v) => `${(0.7 + v * 0.6).toFixed(2)}×`} />
          <Slider label="Formality" value={formality} onChange={setFormality} format={(v) => `${Math.round(v * 100)}%`} />
          <Slider label="Warmth" value={warmth} onChange={setWarmth} format={(v) => `${Math.round(v * 100)}%`} />
        </div>

        <div className="mt-4 flex items-center justify-between border-t border-hairline pt-3">
          <Mono className="text-[10.5px]">
            {voice.latencyMs}ms first token
          </Mono>
          {dirty ? (
            <Button size="sm" variant="primary" onClick={() => toast.success(`${voice.name} saved`)}>
              Save
            </Button>
          ) : (
            <span className="text-[11px] text-t3">
              {voice.assignedTo ?? "Unassigned"}
            </span>
          )}
        </div>
      </Card>
    </motion.div>
  );
}

/**
 * A/B on real outcome data rather than listener preference. §4.9 makes the
 * dependency explicit: this is only meaningful once call-outcome tagging is
 * accurate, so an underpowered test says so instead of declaring a winner.
 */
function ScriptTestCard({ test }: { test: ScriptTest }) {
  const conclusive = test.winner !== null;
  const lift =
    ((test.variantB.resolveRate - test.variantA.resolveRate) / test.variantA.resolveRate) * 100;

  return (
    <Card interactive={false}>
      <CardHead
        title="A/B script test"
        sub={`${test.agentName} · ${test.hypothesis}`}
        action={
          conclusive ? (
            <Pill tone="cyan">
              <Trophy className="size-3" />
              Variant {test.winner} wins
            </Pill>
          ) : (
            <Pill tone="amber">Not conclusive yet</Pill>
          )
        }
      />

      <div className="grid gap-3 md:grid-cols-2">
        {(["A", "B"] as const).map((key) => {
          const v = key === "A" ? test.variantA : test.variantB;
          const winner = test.winner === key;
          return (
            <div
              key={key}
              className={cn(
                "rounded-[14px] border p-3.5 transition-colors",
                winner ? "border-cyan/35 bg-cyan/[0.06]" : "border-hairline bg-white/[0.035]",
              )}
            >
              <Pill tone={winner ? "cyan" : "violet"} className="mb-2.5">
                Variant {key}
                {winner ? " — winning" : ""}
              </Pill>
              <p className="mb-3 text-[12.5px] italic leading-snug text-t2">
                &ldquo;{v.script}&rdquo;
              </p>
              <ProgressBar value={v.resolveRate} tone={winner ? "cyan" : "brand"} height={5} />
              <div className="mt-2 flex justify-between font-[family-name:var(--font-mono)] text-[10.5px] text-t3">
                <span>{Math.round(v.resolveRate * 100)}% resolved</span>
                <span>{v.calls.toLocaleString("en-IN")} calls</span>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-3.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-hairline pt-3 text-[11.5px] text-t3">
        <span>
          Lift:{" "}
          <span className={lift > 0 ? "text-cyan" : "text-coral"}>
            {lift > 0 ? "+" : ""}
            {lift.toFixed(1)}%
          </span>
        </span>
        <span>Confidence: {Math.round(test.confidence * 100)}%</span>
        {conclusive ? (
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto"
            onClick={() => toast.success(`Variant ${test.winner} promoted to 100% of traffic`)}
          >
            Ship the winner
          </Button>
        ) : (
          <span className="ml-auto">
            Needs ~{Math.round((0.95 - test.confidence) * 4000)} more calls to call it
          </span>
        )}
      </div>
    </Card>
  );
}
