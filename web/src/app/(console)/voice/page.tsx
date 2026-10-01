"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { Info, Loader2, Play, Square } from "lucide-react";
import { PageHead } from "@/components/chrome/page-head";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/ui/pill";
import { Field, Tabs } from "@/components/ui/controls";
import { CardSkeleton, QueryBoundary } from "@/components/ui/feedback";
import { Waveform } from "@/components/ui/live";
import { Reveal } from "@/components/motion/primitives";
import { IS_MOCK, mutations } from "@/lib/api/client";
import { qk, useVoices } from "@/lib/api/hooks";
import type { Voice } from "@/lib/api/schemas";
import { VOICE_PREVIEW_AGENT_ID } from "@/lib/live/voices";
import { useLiveSession } from "@/lib/live/use-live-session";
import { cn } from "@/lib/utils";

type Filter = "all" | "female" | "male";

const FILTERS = [
  { value: "all", label: "All voices" },
  { value: "female", label: "Women" },
  { value: "male", label: "Men" },
] as const satisfies readonly { value: Filter; label: string }[];

/**
 * Voice Studio. The Live API exposes exactly one thing about how an agent
 * sounds — which of its prebuilt voices to use — so that is all this page
 * offers: every voice, a play button that has it introduce itself, and the
 * talking-style text that makes a voice into a person. No sliders for knobs
 * the model cannot hear, no cloning the API does not do.
 */
export default function VoiceStudioPage() {
  const voices = useVoices();
  const [filter, setFilter] = useState<Filter>("all");

  // One preview at a time, page-wide: a real Live session with the mic off.
  const [requestedId, setRequestedId] = useState<string | null>(null);
  const preview = useLiveSession({ onEnded: () => setRequestedId(null) });
  // A card only counts as playing while the session is actually alive, so a
  // session that closes on its own needs no state sync here.
  const sessionAlive = preview.status !== "closed" && preview.status !== "error";
  const previewId = sessionAlive ? requestedId : null;
  const setPreviewId = setRequestedId;

  useEffect(() => {
    if (preview.error) toast.error(preview.error);
  }, [preview.error]);

  const togglePreview = async (v: Voice) => {
    if (previewId === v.id) {
      setPreviewId(null);
      await preview.stop();
      return;
    }
    setPreviewId(v.id);
    try {
      await preview.start({
        agentId: VOICE_PREVIEW_AGENT_ID,
        voice: v.liveName ?? v.name,
        listenOnly: true,
        agentName: v.personaName ?? v.name,
      });
    } catch (e) {
      setPreviewId(null);
      toast.error(e instanceof Error ? e.message : "Could not start preview");
    }
  };

  const spoken = useMemo(() => {
    const agent = [...preview.transcript].reverse().find((t) => t.role === "agent");
    return agent?.text ?? "";
  }, [preview.transcript]);

  return (
    <>
      <PageHead
        title="Voice studio"
        sub="Every voice the model can speak with. Press play and each one introduces itself."
        actions={<Tabs tabs={FILTERS} value={filter} onChange={setFilter} size="sm" />}
      />

      <Reveal className="mb-3.5">
        <div className="flex gap-3 rounded-[18px] border border-violet/20 bg-violet/[0.07] px-4 py-3.5">
          <Info className="mt-px size-4 shrink-0 text-violet" strokeWidth={1.7} />
          <p className="text-[12.5px] leading-relaxed text-t2">
            The voice itself is fixed by the model — there is no pace, warmth or cloning to set.
            What you can shape is the person behind it: the name it gives, the gendered Hindi it
            uses, how fast and how formal it talks. That lives in the talking style, and every
            agent assigned to the voice picks it up. Language is never chosen here: the voice
            follows the caller.
          </p>
        </div>
      </Reveal>

      <QueryBoundary
        query={voices}
        skeleton={
          <div className="grid gap-3.5 md:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 9 }).map((_, i) => (
              <CardSkeleton key={i} height={200} />
            ))}
          </div>
        }
      >
        {(list) => {
          const shown = filter === "all" ? list : list.filter((v) => v.gender === filter);
          return (
            <div className="grid gap-3.5 md:grid-cols-2 xl:grid-cols-3">
              {shown.map((v, i) => (
                <VoiceCard
                  key={v.id}
                  voice={v}
                  index={i}
                  state={
                    previewId !== v.id
                      ? "idle"
                      : preview.status === "live" && preview.agentSpeaking
                        ? "speaking"
                        : "connecting"
                  }
                  spoken={previewId === v.id ? spoken : ""}
                  level={previewId === v.id ? preview.agentLevel : 0}
                  onPlay={() => void togglePreview(v)}
                />
              ))}
            </div>
          );
        }}
      </QueryBoundary>
    </>
  );
}

type PreviewState = "idle" | "connecting" | "speaking";

function VoiceCard({
  voice,
  index,
  state,
  spoken,
  level,
  onPlay,
}: {
  voice: Voice;
  index: number;
  state: PreviewState;
  spoken: string;
  level: number;
  onPlay: () => void;
}) {
  const qc = useQueryClient();
  const stockName = voice.personaName ?? voice.name;
  const [personaName, setPersonaName] = useState(stockName);
  const [promptTemplate, setPromptTemplate] = useState(voice.promptTemplate ?? "");
  const [openPrompt, setOpenPrompt] = useState(false);
  const [saving, setSaving] = useState(false);
  const dirty = personaName !== stockName || promptTemplate !== (voice.promptTemplate ?? "");
  const active = state !== "idle";

  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index, 8) * 0.05, duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
    >
      <Card interactive={false} className={cn("h-full", active && "ring-1 ring-cyan/30")}>
        <div className="mb-3 flex items-center gap-3">
          <button
            onClick={onPlay}
            aria-label={active ? "Stop preview" : `Play ${voice.liveName ?? voice.name}`}
            className={cn(
              "flex size-9 shrink-0 items-center justify-center rounded-full transition-transform hover:scale-105",
              active ? "bg-cyan/20 text-cyan" : "grad-brand text-void",
            )}
          >
            {state === "connecting" ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : state === "speaking" ? (
              <Square className="size-3 fill-current" />
            ) : (
              <Play className="size-3.5 translate-x-px fill-current" />
            )}
          </button>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate text-[13px] font-medium text-t1">
                {voice.liveName ? `${voice.liveName} · ${personaName}` : voice.name}
              </span>
              {voice.character ? <Pill tone="violet">{voice.character}</Pill> : null}
            </div>
            <div className="mt-0.5 truncate text-[11px] text-t3">
              {voice.gender === "female" ? "woman" : voice.gender === "male" ? "man" : "neutral"} · {voice.descriptor}
            </div>
          </div>
        </div>

        <div className="mb-3 min-h-[38px]">
          {active ? (
            <div className="space-y-1.5">
              {/* Amplitude only brightens the bars; it drives nothing else. */}
              <div style={{ opacity: 0.55 + Math.min(level, 1) * 0.45 }}>
                <Waveform
                  bars={22}
                  height={18}
                  tone="cyan"
                  active={state === "speaking"}
                  className="w-full [&>span]:flex-1"
                />
              </div>
              <p className="line-clamp-2 text-[11.5px] italic leading-snug text-t2">
                {spoken || (state === "connecting" ? "Connecting…" : "…")}
              </p>
            </div>
          ) : (
            <p className="text-[12px] leading-snug text-t2">
              Good for <span className="text-t1">{voice.bestFor ?? "general calls"}</span>.
            </p>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-hairline pt-3">
          <span className="truncate text-[11px] text-t3">
            {voice.assignedTo ? `Used by ${voice.assignedTo}` : "Not assigned to an agent"}
          </span>
          <div className="flex shrink-0 items-center gap-1.5">
            <Button size="sm" variant="subtle" onClick={() => setOpenPrompt((v) => !v)}>
              {openPrompt ? "Hide style" : "Talking style"}
            </Button>
            {dirty ? (
              <Button
                size="sm"
                variant="primary"
                disabled={saving}
                onClick={async () => {
                  setSaving(true);
                  try {
                    if (!IS_MOCK) await mutations.updateVoice(voice.id, { personaName, promptTemplate });
                    toast.success(`${personaName} saved`);
                    void qc.invalidateQueries({ queryKey: qk.voices });
                  } catch {
                    toast.error("Could not save voice");
                  } finally {
                    setSaving(false);
                  }
                }}
              >
                Save
              </Button>
            ) : null}
          </div>
        </div>

        {openPrompt ? (
          <div className="mt-3 space-y-2.5 border-t border-hairline pt-3">
            <Field label="Spoken name" hint="What this voice calls itself. Agents without their own name use it.">
              <input
                value={personaName}
                onChange={(e) => setPersonaName(e.target.value)}
                maxLength={40}
                className="glass w-full rounded-[11px] px-3 py-2 text-[13px] text-t1 outline-none"
              />
            </Field>
            <Field
              label="Talking style"
              hint="Gendered verbs and register are load-bearing. This is what every call on this voice hears."
            >
              <textarea
                value={promptTemplate}
                onChange={(e) => setPromptTemplate(e.target.value)}
                rows={5}
                className="glass w-full resize-y rounded-[12px] p-3 font-[family-name:var(--font-mono)] text-[11.5px] leading-relaxed text-t1 outline-none"
              />
            </Field>
          </div>
        ) : null}
      </Card>
    </motion.div>
  );
}
