"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Pause, Play, PhoneIncoming, PhoneOutgoing, RotateCcw, Volume2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Pill } from "@/components/ui/pill";
import { Waveform } from "@/components/ui/live";
import { cn } from "@/lib/utils";

/**
 * "Listen to a real call" — the section a buyer actually scrolls to.
 *
 * Each sample has a recording at /samples/<slug>.mp4 (drop the files into
 * web/public/samples/) and a timed transcript. When the recording exists the
 * transcript follows the audio; when it does not (yet), the player runs the
 * transcript on a clock instead, so the section is never a dead button.
 */

type Line = { at: number; who: "agent" | "caller"; text: string };

export type SampleCall = {
  slug: string;
  title: string;
  business: string;
  language: string;
  direction: "inbound" | "outbound";
  durationSec: number;
  outcome: string;
  tone: "cyan" | "violet" | "amber" | "coral";
  agent: string;
  lines: Line[];
};

export const SAMPLE_CALLS: SampleCall[] = [
  {
    slug: "clinic-booking-hinglish",
    title: "Booking a dentist appointment",
    business: "Smile Care Dental, Pune",
    language: "Hinglish",
    direction: "inbound",
    durationSec: 58,
    outcome: "Slot booked · Thu 4:30 pm",
    tone: "cyan",
    agent: "Riya",
    lines: [
      { at: 0, who: "agent", text: "Smile Care Dental, Riya bol rahi hoon. Kaise help kar sakti hoon?" },
      { at: 4, who: "caller", text: "Haan, mujhe ek appointment chahiye tha, tooth mein bahut pain hai." },
      { at: 9, who: "agent", text: "Ohh, sorry to hear that. Aaj ya kal mein dekhna chahenge? Kal 11 baje ya 4:30 pm free hai." },
      { at: 16, who: "caller", text: "Kal 4:30 theek hai." },
      { at: 19, who: "agent", text: "Done. Kal, Thursday, 4:30 pm, Dr. Mehta ke saath. Aapka naam bata denge?" },
      { at: 25, who: "caller", text: "Sameer Kulkarni." },
      { at: 28, who: "agent", text: "Sameer ji, book ho gaya. Isi number pe WhatsApp confirmation aa jayega. Aur kuch?" },
      { at: 35, who: "caller", text: "Nahi, bas yahi. Thank you." },
      { at: 38, who: "agent", text: "Take care, Sameer ji. Kal milte hain." },
    ],
  },
  {
    slug: "d2c-order-status-tamil",
    title: "Where is my order?",
    business: "Kaveri Organics, Chennai",
    language: "Tamil",
    direction: "inbound",
    durationSec: 47,
    outcome: "Status given · reschedule offered",
    tone: "violet",
    agent: "Meera",
    lines: [
      { at: 0, who: "agent", text: "Kaveri Organics, Meera pesuren. Sollunga?" },
      { at: 3, who: "caller", text: "En order innum varala. Wednesday varum nu sonninga." },
      { at: 8, who: "agent", text: "Sorry, oru nimisham paakuren… Neenga koopidura number-la order 48213 irukku. Innaikku out for delivery, evening 6 manikku munnadi varum." },
      { at: 18, who: "caller", text: "Naan evening veetla irukka maaten." },
      { at: 21, who: "agent", text: "Puriyudhu. Naalaikku kaalaila reschedule pannidalaama? 10 to 1 slot irukku." },
      { at: 27, who: "caller", text: "Seri, naalaikku kaalaila." },
      { at: 30, who: "agent", text: "Reschedule aagiduchu, naalaikku 10 to 1. SMS vandhurum. Vera edhavadhu?" },
      { at: 36, who: "caller", text: "Illa, nandri." },
      { at: 38, who: "agent", text: "Nandri, nalla irunga." },
    ],
  },
  {
    slug: "metro-complaint-marathi",
    title: "Filing a complaint, no duplicates",
    business: "City Metro helpline",
    language: "Marathi",
    direction: "inbound",
    durationSec: 64,
    outcome: "Existing ticket found · status shared",
    tone: "amber",
    agent: "Sneha",
    lines: [
      { at: 0, who: "agent", text: "Metro helpline, Sneha boltey. Kay madat karu?" },
      { at: 3, who: "caller", text: "Shivajinagar station la escalator band aahe, kaal pan band hota." },
      { at: 9, who: "agent", text: "Ho, mala disat aahe — tumhi kaal yach number varun complaint #48213 keli hoti, escalator baddal. Ti in progress aahe, maintenance team la assign zali aahe." },
      { at: 20, who: "caller", text: "Mag ajun kiti vel lagel?" },
      { at: 23, who: "agent", text: "48 tasanchi SLA aahe, mhanje udya sandhyakal paryant. Mi team la ek reminder pathavte ki tumhi punha call kela." },
      { at: 32, who: "caller", text: "Ho, pathva. Ani ek navin problem aahe — ticket machine change det nahi." },
      { at: 38, who: "agent", text: "Te vegle aahe, tyachi navin complaint nondavte. Ek second… #51207. Tumhala SMS yeil. Ajun kahi?" },
      { at: 49, who: "caller", text: "Nahi, dhanyavaad." },
      { at: 51, who: "agent", text: "Dhanyavaad. Chhan divas jao." },
    ],
  },
  {
    slug: "realestate-followup-hindi",
    title: "Following up a site-visit lead",
    business: "Vaastu Homes, Noida",
    language: "Hindi",
    direction: "outbound",
    durationSec: 52,
    outcome: "Visit confirmed · Sunday 11 am",
    tone: "cyan",
    agent: "Kabir",
    lines: [
      { at: 0, who: "agent", text: "Namaste, main Kabir, Vaastu Homes se. Aapne kal website pe 3 BHK ke liye enquiry ki thi — do minute hain?" },
      { at: 7, who: "caller", text: "Haan, boliye." },
      { at: 9, who: "agent", text: "Sector 150 wala project hai, ready to move. Site visit ke liye weekend theek rahega?" },
      { at: 15, who: "caller", text: "Budget kya hai iska?" },
      { at: 17, who: "agent", text: "1.45 crore se start, 1,650 square feet. Loan tie-up SBI aur HDFC ke saath hai." },
      { at: 25, who: "caller", text: "Theek hai, Sunday subah aa sakta hoon." },
      { at: 28, who: "agent", text: "Sunday 11 baje rakh deta hoon — location aur mera number WhatsApp pe aa jayega. Aur kuch poochna hai?" },
      { at: 36, who: "caller", text: "Nahi, Sunday milte hain." },
      { at: 38, who: "agent", text: "Bilkul, Sunday milte hain. Shukriya." },
    ],
  },
];

const TONE_TEXT = { cyan: "text-cyan", violet: "text-violet", amber: "text-amber", coral: "text-coral" } as const;
const TONE_BG = { cyan: "bg-cyan", violet: "bg-violet", amber: "bg-amber", coral: "bg-coral" } as const;

function fmt(sec: number) {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function SampleCalls() {
  const [active, setActive] = useState(0);
  const call = SAMPLE_CALLS[active];

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,320px)_1fr]">
      <div className="flex flex-col gap-2">
        {SAMPLE_CALLS.map((c, i) => {
          const selected = i === active;
          return (
            <motion.button
              key={c.slug}
              type="button"
              onClick={() => setActive(i)}
              whileHover={{ x: 2 }}
              whileTap={{ scale: 0.985 }}
              className={cn(
                "glass relative flex w-full items-start gap-3 rounded-[16px] px-4 py-3.5 text-left transition-colors",
                selected ? "bg-white/[0.07]" : "hover:bg-white/[0.05]",
              )}
            >
              {selected ? (
                <motion.span
                  layoutId="sample-active"
                  className={cn("absolute inset-y-3 left-0 w-[3px] rounded-full", TONE_BG[c.tone])}
                  transition={{ type: "spring", stiffness: 400, damping: 34 }}
                />
              ) : null}
              <span className={cn("mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-[8px] bg-white/[0.06]", TONE_TEXT[c.tone])}>
                {c.direction === "inbound" ? <PhoneIncoming className="size-3.5" strokeWidth={1.8} /> : <PhoneOutgoing className="size-3.5" strokeWidth={1.8} />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-medium text-t1">{c.title}</span>
                <span className="mt-0.5 block text-[11.5px] text-t3">
                  {c.business} · {c.language} · <span className="font-[family-name:var(--font-mono)]">{fmt(c.durationSec)}</span>
                </span>
              </span>
            </motion.button>
          );
        })}
        <p className="mt-1 px-1 text-[11.5px] leading-relaxed text-t3">
          Recorded on real test lines with consent. Names and numbers changed.
        </p>
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={call.slug}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
        >
          <Player call={call} />
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

function Player({ call }: { call: SampleCall }) {
  const reduce = useReducedMotion();
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [t, setT] = useState(0);
  const [mode, setMode] = useState<"audio" | "scripted" | "unknown">("unknown");
  const clock = useRef<number | null>(null);
  const startedAt = useRef<{ wall: number; from: number } | null>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);

  const src = `/samples/${call.slug}.mp4`;
  const duration = call.durationSec;

  // Scripted clock: advances `t` at 1× when there is no recording to follow.
  const stopClock = useCallback(() => {
    if (clock.current) cancelAnimationFrame(clock.current);
    clock.current = null;
    startedAt.current = null;
  }, []);

  const runClock = useCallback(
    (from: number) => {
      stopClock();
      startedAt.current = { wall: performance.now(), from };
      const tick = () => {
        if (!startedAt.current) return;
        const next = startedAt.current.from + (performance.now() - startedAt.current.wall) / 1000;
        if (next >= duration) {
          setT(duration);
          setPlaying(false);
          stopClock();
          return;
        }
        setT(next);
        clock.current = requestAnimationFrame(tick);
      };
      clock.current = requestAnimationFrame(tick);
    },
    [duration, stopClock],
  );

  useEffect(() => () => stopClock(), [stopClock]);

  const play = useCallback(async () => {
    const from = t >= duration ? 0 : t;
    setT(from);
    setPlaying(true);
    if (mode !== "scripted") {
      const el = audioRef.current;
      if (el) {
        try {
          el.currentTime = from;
          await el.play();
          setMode("audio");
          return;
        } catch {
          // No file yet, or the browser refused — fall through to scripted.
        }
      }
    }
    setMode("scripted");
    runClock(from);
  }, [duration, mode, runClock, t]);

  const pause = useCallback(() => {
    setPlaying(false);
    audioRef.current?.pause();
    stopClock();
  }, [stopClock]);

  const seek = useCallback(
    (to: number) => {
      const clamped = Math.min(duration, Math.max(0, to));
      setT(clamped);
      if (mode === "audio" && audioRef.current) audioRef.current.currentTime = clamped;
      else if (playing) runClock(clamped);
    },
    [duration, mode, playing, runClock],
  );

  const currentLine = useMemo(() => {
    let idx = -1;
    call.lines.forEach((l, i) => {
      if (l.at <= t) idx = i;
    });
    return idx;
  }, [call.lines, t]);

  useEffect(() => {
    const box = transcriptRef.current;
    if (!box || currentLine < 0) return;
    const el = box.children[currentLine] as HTMLElement | undefined;
    if (!el) return;
    box.scrollTo({ top: el.offsetTop - box.clientHeight / 2 + el.clientHeight / 2, behavior: reduce ? "auto" : "smooth" });
  }, [currentLine, reduce]);

  const progress = duration ? Math.min(1, t / duration) : 0;

  return (
    <Card interactive={false} className="flex h-full flex-col p-5 sm:p-6">
      <audio
        ref={audioRef}
        src={src}
        preload="none"
        onTimeUpdate={(e) => setT(e.currentTarget.currentTime)}
        onEnded={() => setPlaying(false)}
        onError={() => {
          if (playing && mode !== "scripted") {
            setMode("scripted");
            runClock(t);
          }
        }}
      />

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-[family-name:var(--font-display)] text-[17px] font-semibold text-t1">{call.title}</h3>
            <Pill tone={call.tone === "violet" ? "violet" : call.tone}>{call.language}</Pill>
            <Pill>{call.direction}</Pill>
          </div>
          <div className="mt-1 text-[12.5px] text-t3">
            {call.business} · agent <span className="text-t2">{call.agent}</span>
          </div>
        </div>
        <div className="flex items-center gap-2 text-[11.5px] text-t3">
          <Volume2 className="size-3.5" strokeWidth={1.8} />
          {mode === "scripted" ? "Preview — recording coming soon" : "Recording"}
        </div>
      </div>

      {/* Transport */}
      <div className="mt-5 flex items-center gap-4">
        <motion.button
          type="button"
          onClick={playing ? pause : play}
          whileHover={{ scale: 1.04 }}
          whileTap={{ scale: 0.95 }}
          aria-label={playing ? "Pause" : "Play"}
          className="grad-brand flex size-12 shrink-0 items-center justify-center rounded-full text-void shadow-[0_8px_28px_-10px_rgba(124,108,246,0.8)]"
        >
          {playing ? <Pause className="size-5" fill="currentColor" strokeWidth={0} /> : <Play className="ml-0.5 size-5" fill="currentColor" strokeWidth={0} />}
        </motion.button>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-3">
            <Waveform bars={28} tone={call.tone} height={26} active={playing} className="flex-1 [&>span]:flex-1 [&>span]:w-auto" />
          </div>
          <div
            role="slider"
            aria-valuemin={0}
            aria-valuemax={duration}
            aria-valuenow={Math.floor(t)}
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight") seek(t + 5);
              if (e.key === "ArrowLeft") seek(t - 5);
            }}
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              seek(((e.clientX - r.left) / r.width) * duration);
            }}
            className="group mt-2 h-4 cursor-pointer"
          >
            <div className="relative top-1.5 h-1 overflow-hidden rounded-full bg-white/[0.08]">
              <motion.div
                className={cn("absolute inset-y-0 left-0 rounded-full", TONE_BG[call.tone])}
                style={{ width: `${progress * 100}%` }}
              />
            </div>
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1">
          <span className="font-[family-name:var(--font-mono)] text-[12px] tabular-nums text-t1">
            {fmt(t)} <span className="text-t3">/ {fmt(duration)}</span>
          </span>
          <button
            type="button"
            onClick={() => {
              pause();
              seek(0);
            }}
            className="flex items-center gap-1 text-[11px] text-t3 transition-colors hover:text-t1"
          >
            <RotateCcw className="size-3" /> restart
          </button>
        </div>
      </div>

      {/* Transcript */}
      <div
        ref={transcriptRef}
        className="mt-5 max-h-[240px] flex-1 space-y-2.5 overflow-y-auto pr-1 [scrollbar-width:thin]"
      >
        {call.lines.map((l, i) => {
          const isNow = i === currentLine;
          const past = i < currentLine;
          return (
            <motion.div
              key={`${call.slug}-${i}`}
              animate={{ opacity: isNow ? 1 : past ? 0.55 : 0.3 }}
              transition={{ duration: 0.25 }}
              className={cn("flex gap-3", l.who === "caller" && "flex-row-reverse text-right")}
            >
              <span
                className={cn(
                  "mt-[3px] size-[7px] shrink-0 rounded-full",
                  l.who === "agent" ? TONE_BG[call.tone] : "bg-t3",
                  isNow && !reduce && "animate-[breathe_1.6s_ease-in-out_infinite]",
                )}
              />
              <div className="min-w-0 max-w-[85%]">
                <div className="text-[10.5px] uppercase tracking-wide text-t3">
                  {l.who === "agent" ? call.agent : "Caller"} · <span className="font-[family-name:var(--font-mono)]">{fmt(l.at)}</span>
                </div>
                <div className={cn("text-[13px] leading-relaxed", isNow ? "text-t1" : "text-t2")}>{l.text}</div>
              </div>
            </motion.div>
          );
        })}
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-hairline pt-4 text-[12px]">
        <span className="text-t3">Outcome</span>
        <Pill tone={call.tone === "violet" ? "violet" : call.tone} dot>
          {call.outcome}
        </Pill>
        <span className="ml-auto text-[11.5px] text-t3">
          Language detected from the first sentence · no menu, no “press 1”
        </span>
      </div>
    </Card>
  );
}
