"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion, type PanInfo } from "motion/react";
import {
  Building2,
  ChevronLeft,
  ChevronRight,
  GraduationCap,
  HeartPulse,
  Package,
  ShoppingBag,
  TrainFront,
  Utensils,
  type LucideIcon,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Pill } from "@/components/ui/pill";
import { cn } from "@/lib/utils";

type UseCase = {
  icon: LucideIcon;
  industry: string;
  title: string;
  pain: string;
  does: string[];
  exchange: { who: "caller" | "agent"; text: string }[];
  metric: { value: string; label: string };
  tone: "cyan" | "violet" | "amber" | "coral";
};

const USE_CASES: UseCase[] = [
  {
    icon: HeartPulse,
    industry: "Clinics & hospitals",
    title: "Appointments booked while the front desk is busy",
    pain: "Reception answers one line while three ring out. Patients who cannot get through book somewhere else.",
    does: ["Books, reschedules and cancels against your real calendar", "Reminds patients the evening before, in their language", "Hands genuine emergencies to a person immediately"],
    exchange: [
      { who: "caller", text: "Kal Dr. Mehta ke saath slot milega?" },
      { who: "agent", text: "Kal 11 baje ya 4:30 — kaunsa theek rahega?" },
    ],
    metric: { value: "0", label: "missed calls after 6 pm" },
    tone: "cyan",
  },
  {
    icon: Package,
    industry: "D2C & e-commerce",
    title: "“Where is my order?” answered before they get angry",
    pain: "Seventy percent of your support volume is the same question. Your team answers it on WhatsApp, email and phone, one at a time.",
    does: ["Looks the order up from the number they call from", "Reschedules deliveries, files a return, confirms COD", "Files a ticket for the one call in ten that needs a human"],
    exchange: [
      { who: "caller", text: "Order #48213 ka kya hua?" },
      { who: "agent", text: "Aaj out for delivery hai, 6 baje se pehle. Ghar pe koi hoga?" },
    ],
    metric: { value: "9 in 10", label: "status calls closed without a person" },
    tone: "violet",
  },
  {
    icon: TrainFront,
    industry: "Transport & public helplines",
    title: "Complaints filed once, routed right, never lost",
    pain: "The same escalator gets reported fifteen times. The team works fifteen tickets. Nobody knows which one is real.",
    does: ["Knows the caller's open tickets before they finish the sentence", "Asks before filing a duplicate; gives status in plain words", "Routes to the right department by what was said, not a menu"],
    exchange: [
      { who: "caller", text: "Escalator band aahe Shivajinagar la." },
      { who: "agent", text: "Ho — tumhi kaal #48213 keli hoti, ti in progress aahe. Tich baat aahe ka?" },
    ],
    metric: { value: "−60%", label: "duplicate tickets" },
    tone: "amber",
  },
  {
    icon: Building2,
    industry: "Real estate",
    title: "Every website lead called back in five minutes",
    pain: "Leads go cold in an hour. Your sales team calls back the next morning, if at all.",
    does: ["Calls the lead back while they are still on your site", "Qualifies budget, location and timeline like a good telecaller", "Books the site visit and drops it into the agent's calendar"],
    exchange: [
      { who: "agent", text: "Aapne 3 BHK ke liye enquiry ki thi — weekend site visit chalega?" },
      { who: "caller", text: "Sunday subah aa sakta hoon." },
    ],
    metric: { value: "3×", label: "more site visits from the same leads" },
    tone: "cyan",
  },
  {
    icon: Utensils,
    industry: "Restaurants & cloud kitchens",
    title: "Reservations and order calls during the dinner rush",
    pain: "The phone rings hardest exactly when nobody can pick it up.",
    does: ["Takes table bookings and large-order enquiries", "Confirms timings and party size, sends a WhatsApp note", "Tells regulars about today's specials if you want it to"],
    exchange: [
      { who: "caller", text: "Table for four tonight, around eight?" },
      { who: "agent", text: "Eight is full — 8:30 or 7:30 works. Which one?" },
    ],
    metric: { value: "100%", label: "of rush-hour calls answered" },
    tone: "coral",
  },
  {
    icon: GraduationCap,
    industry: "Education & coaching",
    title: "Admission enquiries answered the moment they come in",
    pain: "Parents call in the evening. Your counsellors left at six. By morning they have called two other institutes.",
    does: ["Explains courses, fees and batches from your own material", "Books a counselling call with the right person", "Follows up on enquiries that went quiet"],
    exchange: [
      { who: "caller", text: "NEET batch ki fees kya hai?" },
      { who: "agent", text: "Two-year programme ₹1,20,000, instalments mein bhi. Counsellor se baat karwaun?" },
    ],
    metric: { value: "2 min", label: "median first response, any hour" },
    tone: "violet",
  },
  {
    icon: ShoppingBag,
    industry: "Retail & services",
    title: "Store hours, stock checks and service bookings",
    pain: "Simple questions tie up the one person on the floor.",
    does: ["Answers hours, location and availability from your notes", "Books service slots and pick-ups", "Passes a message to the store when it really needs a human"],
    exchange: [
      { who: "caller", text: "Aaj kitne baje tak khule ho?" },
      { who: "agent", text: "Raat 9 tak. Kuch specific dekhna hai to bata dijiye, main check kar leti hoon." },
    ],
    metric: { value: "24 × 7", label: "someone answers" },
    tone: "cyan",
  },
];

const TONE_TEXT = { cyan: "text-cyan", violet: "text-violet", amber: "text-amber", coral: "text-coral" } as const;
const TONE_SOFT = { cyan: "bg-cyan/[0.14]", violet: "bg-violet/[0.16]", amber: "bg-amber/[0.14]", coral: "bg-coral/[0.14]" } as const;
const TONE_BAR = { cyan: "bg-cyan", violet: "bg-violet", amber: "bg-amber", coral: "bg-coral" } as const;

const AUTOPLAY_MS = 6500;
const EASE = [0.22, 1, 0.36, 1] as const;

export function UseCaseCarousel() {
  const reduce = useReducedMotion();
  const [index, setIndex] = useState(0);
  const [dir, setDir] = useState(1);
  const [paused, setPaused] = useState(false);
  const [cycle, setCycle] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const go = useCallback(
    (to: number, direction = 1) => {
      setDir(direction);
      setIndex((to + USE_CASES.length) % USE_CASES.length);
      setCycle((c) => c + 1);
    },
    [],
  );

  useEffect(() => {
    if (paused || reduce) return;
    timer.current = setTimeout(() => go(index + 1, 1), AUTOPLAY_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [index, paused, reduce, go, cycle]);

  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.x < -70 || info.velocity.x < -400) go(index + 1, 1);
    else if (info.offset.x > 70 || info.velocity.x > 400) go(index - 1, -1);
  };

  const uc = USE_CASES[index];

  return (
    <div
      className="relative"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
    >
      {/* Industry tabs */}
      <div className="mb-5 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none]">
        {USE_CASES.map((u, i) => (
          <button
            key={u.industry}
            type="button"
            onClick={() => go(i, i > index ? 1 : -1)}
            className={cn(
              "relative shrink-0 rounded-full border px-3 py-1.5 text-[12px] transition-colors",
              i === index ? "border-white/[0.14] bg-white/[0.08] text-t1" : "border-hairline text-t3 hover:text-t1",
            )}
          >
            <span className="flex items-center gap-1.5">
              <u.icon className={cn("size-3.5", i === index ? TONE_TEXT[u.tone] : "")} strokeWidth={1.8} />
              {u.industry}
            </span>
            {i === index && !paused && !reduce ? (
              <motion.span
                key={`bar-${index}-${cycle}`}
                className={cn("absolute inset-x-3 -bottom-[1px] h-[2px] origin-left rounded-full", TONE_BAR[u.tone])}
                initial={{ scaleX: 0 }}
                animate={{ scaleX: 1 }}
                transition={{ duration: AUTOPLAY_MS / 1000, ease: "linear" }}
              />
            ) : null}
          </button>
        ))}
      </div>

      <div className="relative overflow-hidden">
        <AnimatePresence mode="wait" custom={dir} initial={false}>
          <motion.div
            key={index}
            custom={dir}
            variants={{
              enter: (d: number) => ({ opacity: 0, x: reduce ? 0 : 60 * d }),
              center: { opacity: 1, x: 0 },
              exit: (d: number) => ({ opacity: 0, x: reduce ? 0 : -60 * d }),
            }}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.38, ease: EASE }}
            drag={reduce ? false : "x"}
            dragConstraints={{ left: 0, right: 0 }}
            dragElastic={0.12}
            onDragEnd={onDragEnd}
            className="cursor-grab active:cursor-grabbing"
          >
            <Card interactive={false} className="grid gap-8 p-6 sm:p-8 lg:grid-cols-[1.15fr_1fr]">
              <div>
                <div className="flex items-center gap-2.5">
                  <span className={cn("flex size-9 items-center justify-center rounded-[10px]", TONE_SOFT[uc.tone], TONE_TEXT[uc.tone])}>
                    <uc.icon className="size-[17px]" strokeWidth={1.8} />
                  </span>
                  <Pill tone={uc.tone === "violet" ? "violet" : uc.tone}>{uc.industry}</Pill>
                </div>
                <h3 className="mt-4 font-[family-name:var(--font-display)] text-[22px] font-semibold leading-tight tracking-tight text-t1 sm:text-[26px]">
                  {uc.title}
                </h3>
                <p className="mt-3 text-[13.5px] leading-relaxed text-t2">{uc.pain}</p>
                <ul className="mt-5 space-y-2.5">
                  {uc.does.map((d, i) => (
                    <motion.li
                      key={d}
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.15 + i * 0.08, duration: 0.35, ease: EASE }}
                      className="flex items-start gap-2.5 text-[13px] text-t1"
                    >
                      <span className={cn("mt-[7px] size-1.5 shrink-0 rounded-full", TONE_BAR[uc.tone])} />
                      {d}
                    </motion.li>
                  ))}
                </ul>
              </div>

              <div className="flex flex-col justify-between gap-5">
                <div className="glass rounded-[16px] p-4">
                  <div className="mb-3 text-[10.5px] uppercase tracking-wide text-t3">On a call</div>
                  <div className="space-y-2.5">
                    {uc.exchange.map((e, i) => (
                      <motion.div
                        key={`${index}-${i}`}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.25 + i * 0.35, duration: 0.4, ease: EASE }}
                        className={cn("flex", e.who === "caller" ? "justify-end" : "justify-start")}
                      >
                        <div
                          className={cn(
                            "max-w-[88%] rounded-[14px] px-3.5 py-2 text-[13px] leading-relaxed",
                            e.who === "caller" ? "bg-white/[0.08] text-t1" : cn(TONE_SOFT[uc.tone], "text-t1"),
                          )}
                        >
                          {e.text}
                        </div>
                      </motion.div>
                    ))}
                  </div>
                </div>
                <div className="flex items-end justify-between gap-4">
                  <div>
                    <div className={cn("font-[family-name:var(--font-display)] text-[34px] font-semibold leading-none tracking-tight", TONE_TEXT[uc.tone])}>
                      {uc.metric.value}
                    </div>
                    <div className="mt-1.5 text-[12px] text-t3">{uc.metric.label}</div>
                  </div>
                  <span className="font-[family-name:var(--font-mono)] text-[11px] text-t3">
                    {index + 1} / {USE_CASES.length}
                  </span>
                </div>
              </div>
            </Card>
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Controls */}
      <div className="mt-4 flex items-center justify-between">
        <div className="flex gap-1.5">
          {USE_CASES.map((u, i) => (
            <button
              key={u.industry}
              type="button"
              aria-label={`Go to ${u.industry}`}
              onClick={() => go(i, i > index ? 1 : -1)}
              className={cn(
                "h-1.5 rounded-full transition-all",
                i === index ? cn("w-6", TONE_BAR[u.tone]) : "w-1.5 bg-white/[0.14] hover:bg-white/[0.3]",
              )}
            />
          ))}
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            aria-label="Previous use case"
            onClick={() => go(index - 1, -1)}
            className="glass flex size-9 items-center justify-center rounded-full text-t2 transition-colors hover:text-t1"
          >
            <ChevronLeft className="size-4" />
          </button>
          <button
            type="button"
            aria-label="Next use case"
            onClick={() => go(index + 1, 1)}
            className="glass flex size-9 items-center justify-center rounded-full text-t2 transition-colors hover:text-t1"
          >
            <ChevronRight className="size-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
