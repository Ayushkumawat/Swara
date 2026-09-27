"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useState } from "react";
import { AnimatePresence, motion, useReducedMotion, useScroll, useSpring, useTransform } from "motion/react";
import {
  ArrowRight,
  BarChart3,
  CalendarCheck,
  Check,
  ChevronDown,
  Headphones,
  Languages,
  LayoutDashboard,
  MessageSquareText,
  Mic,
  PhoneCall,
  PhoneIncoming,
  PhoneOutgoing,
  Play,
  ShieldCheck,
  Sparkles,
  TicketCheck,
  Waves,
  Zap,
} from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Pill, LiveDot } from "@/components/ui/pill";
import { Waveform } from "@/components/ui/live";
import { LazyMount, NumberTicker, Reveal } from "@/components/motion/primitives";
import { PLANS } from "@/lib/pricing";
import { cn, formatRupees } from "@/lib/utils";

/**
 * The marketing home. Two heavy, below-the-fold blocks — the sample-call
 * player and the use-case carousel — are code-split and only mounted when
 * they scroll near the viewport, so the first paint is the hero.
 */
const SampleCalls = dynamic(() => import("./sample-calls").then((m) => m.SampleCalls), {
  ssr: false,
  loading: () => <SectionSkeleton height={460} />,
});
const UseCaseCarousel = dynamic(() => import("./use-case-carousel").then((m) => m.UseCaseCarousel), {
  ssr: false,
  loading: () => <SectionSkeleton height={420} />,
});

const EASE = [0.22, 1, 0.36, 1] as const;

const OUTCOMES = [
  {
    icon: PhoneCall,
    tone: "cyan" as const,
    value: 100,
    suffix: "%",
    title: "Every call picked up",
    body: "Lunch hour, Sunday, 2 am. The agent answers on the first ring and never puts anyone on hold. Calls you were losing become customers you keep.",
  },
  {
    icon: TicketCheck,
    tone: "violet" as const,
    value: 9,
    suffix: " of 10",
    title: "Handled without your team",
    body: "Order status, bookings, complaints, callbacks — done on the call, with a real reference number. The tenth call reaches a person with the context already written down.",
  },
  {
    icon: BarChart3,
    tone: "amber" as const,
    value: 3,
    prefix: "₹",
    suffix: "/min",
    title: "Costs you can see",
    body: "Every call shows what it cost and what it produced. No per-seat licence, no minimum commit, no sales call to learn the price.",
  },
];

const STEPS = [
  {
    icon: MessageSquareText,
    title: "Tell Swara about your business",
    body: "Type or talk. What you do, what people call about, who should get a message when something needs a human. Ten minutes, no forms.",
    detail: "“We're a dental clinic in Pune, open 9–8, two doctors. People call to book or ask about fees.”",
  },
  {
    icon: Sparkles,
    title: "She builds your agents",
    body: "One agent per job — bookings, complaints, enquiries — each with its own role, tone, tools and knowledge. You pick the name and the voice, then call it to hear it.",
    detail: "Riya · books against your calendar · Hinglish, Marathi, English · warm, unhurried",
  },
  {
    icon: PhoneIncoming,
    title: "Connect a number and go live",
    body: "Point your existing number at Swara or take a new one. Watch calls live, read transcripts, see what each one cost. Change anything by describing the change.",
    detail: "Live in Hindi, Marathi, Tamil, Telugu, Kannada, Bengali, Gujarati and more",
  },
];

const FEATURES = [
  {
    icon: Languages,
    title: "Speaks your customer's language, automatically",
    body: "Language is picked up from the first sentence — no “press 1 for Hindi”. If the caller switches mid-call, so does the agent. Hinglish included.",
  },
  {
    icon: Mic,
    title: "Sounds like a person, not a menu",
    body: "Short sentences, a pause before a number, a natural “ek second” while it looks something up. Callers stay on the line because it does not feel like talking to a machine.",
  },
  {
    icon: TicketCheck,
    title: "Remembers who is calling",
    body: "The agent sees the caller's open tickets before they finish the sentence, gives status in plain words, and asks before filing a duplicate.",
  },
  {
    icon: PhoneOutgoing,
    title: "Calls out, not just in",
    body: "Lead follow-ups, appointment reminders, payment nudges, feedback calls — the same agent, the same memory, with DND and quiet hours enforced.",
  },
  {
    icon: Headphones,
    title: "Watch live, step in when you want",
    body: "Sentiment is scored during the call. A conversation going wrong surfaces before it ends badly. Listen in silently or take the call over.",
  },
  {
    icon: CalendarCheck,
    title: "Books against your real calendar",
    body: "Live availability, no double bookings, a confirmation on WhatsApp. Reschedules and cancellations handled the same way.",
  },
];

const FAQ = [
  {
    q: "Do I need to write prompts or scripts?",
    a: "No. You describe your business to Swara in plain language and she writes each agent's role, picks its tools and drafts the call flow. You can edit any of it, but most owners never do.",
  },
  {
    q: "What happens when the agent cannot help?",
    a: "It says so honestly, takes a name and a callback number, and files a ticket routed to the right department with the full transcript attached. If you have staff available it can transfer the call live.",
  },
  {
    q: "Which languages does it handle?",
    a: "Hindi, English, Hinglish, Marathi, Tamil, Telugu, Kannada, Bengali, Gujarati, Malayalam, Punjabi and Odia. The caller is never asked to choose — the agent follows them.",
  },
  {
    q: "Can I use my existing phone number?",
    a: "Yes. Forward your current number to Swara, or take a new virtual number from inside the console. Nothing goes live to customers until you publish.",
  },
  {
    q: "How is pricing worked out?",
    a: "Per minute of talk time, with a monthly plan that includes a block of minutes. The price is on the pricing page, and every call in the console shows exactly what it cost.",
  },
];

const MARQUEE = [
  "Hindi", "Clinics", "Marathi", "D2C brands", "Tamil", "Metro helplines", "Telugu", "Real estate",
  "Kannada", "Restaurants", "Bengali", "Coaching institutes", "Gujarati", "Retail", "Hinglish", "Logistics",
];

export function Landing({ signedIn, firstName }: { signedIn: boolean; firstName?: string }) {
  const primaryHref = signedIn ? "/overview" : "/signup";
  const primaryLabel = signedIn ? "Go to Dashboard" : "Start free — 100 minutes";

  return (
    <>
      <ScrollProgress />

      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <section className="relative mx-auto max-w-[1180px] px-5 pb-16 pt-14 sm:pt-24">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: EASE }}
          className="mx-auto max-w-3xl text-center"
        >
          <Pill tone="cyan" className="mb-6">
            <LiveDot />
            {signedIn && firstName ? `Welcome back, ${firstName}` : "Answering calls in 12 Indian languages right now"}
          </Pill>

          <h1 className="font-[family-name:var(--font-display)] text-[38px] font-semibold leading-[1.08] tracking-tight sm:text-[56px]">
            <span className="text-t1">Every call answered.</span>
            <br />
            <span className="text-grad">In your customer&apos;s language. Without hiring.</span>
          </h1>

          <p className="mx-auto mt-6 max-w-2xl text-[15.5px] leading-relaxed text-t2">
            Swara puts an AI agent on your phone line that books appointments, answers “where is my
            order”, files complaints properly and calls your leads back — sounding like a person, in
            Hindi, Marathi, Tamil or whatever the caller speaks. You describe your business; she does
            the rest.
          </p>

          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <ButtonLink href={primaryHref} variant="primary" size="lg">
              {signedIn ? <LayoutDashboard className="size-4" /> : null}
              {primaryLabel}
              {!signedIn ? <ArrowRight className="size-4" /> : null}
            </ButtonLink>
            <ButtonLink href="#listen" variant="ghost" size="lg">
              <Play className="size-4" />
              Hear a real call
            </ButtonLink>
          </div>

          <p className="mt-4 text-[12px] text-t3">
            {signedIn ? "Your agents, calls and tickets are where you left them." : "No sales call. No credit card. Live in about ten minutes."}
          </p>
        </motion.div>

        <HeroParallax>
          <HeroCallPreview />
        </HeroParallax>
      </section>

      {/* ── Marquee ──────────────────────────────────────────────────────── */}
      <Marquee />

      {/* ── Outcomes ─────────────────────────────────────────────────────── */}
      <section className="mx-auto max-w-[1180px] px-5 py-20">
        <Reveal>
          <div className="mx-auto max-w-2xl text-center">
            <Pill tone="violet" className="mb-4">What changes for you</Pill>
            <h2 className="font-[family-name:var(--font-display)] text-[30px] font-semibold tracking-tight text-t1 sm:text-[34px]">
              The phone stops being the thing you dread
            </h2>
            <p className="mt-3 text-[14.5px] leading-relaxed text-t2">
              You did not start a business to answer the same five questions all day. Swara takes the
              calls, does the work, and leaves you a clean record of what happened.
            </p>
          </div>
        </Reveal>

        <div className="mt-12 grid gap-4 md:grid-cols-3">
          {OUTCOMES.map((o, i) => (
            <Reveal key={o.title} delay={i * 0.1}>
              <TiltCard>
                <Card className="flex h-full flex-col p-6">
                  <div
                    className={cn(
                      "mb-5 flex size-10 items-center justify-center rounded-[11px]",
                      o.tone === "cyan" ? "bg-cyan/[0.14] text-cyan" : o.tone === "violet" ? "bg-violet/[0.16] text-violet" : "bg-amber/[0.14] text-amber",
                    )}
                  >
                    <o.icon className="size-[18px]" strokeWidth={1.8} />
                  </div>
                  <div className="font-[family-name:var(--font-display)] text-[38px] font-semibold leading-none tracking-tight text-t1">
                    <NumberTicker value={o.value} prefix={o.prefix} suffix={o.suffix} />
                  </div>
                  <h3 className="mt-3 font-[family-name:var(--font-display)] text-[16px] font-semibold text-t1">{o.title}</h3>
                  <p className="mt-2 text-[13px] leading-relaxed text-t2">{o.body}</p>
                </Card>
              </TiltCard>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ── Listen ───────────────────────────────────────────────────────── */}
      <section id="listen" className="scroll-mt-20 border-y border-hairline bg-white/[0.015]">
        <div className="mx-auto max-w-[1180px] px-5 py-20">
          <Reveal>
            <div className="mx-auto max-w-2xl text-center">
              <Pill tone="cyan" className="mb-4">
                <Waves className="size-3" />
                Listen before you decide
              </Pill>
              <h2 className="font-[family-name:var(--font-display)] text-[30px] font-semibold tracking-tight text-t1 sm:text-[34px]">
                This is what your customers will hear
              </h2>
              <p className="mt-3 text-[14.5px] leading-relaxed text-t2">
                Four real calls from test lines — a booking, an order query, a complaint, a sales
                follow-up. Press play and follow the transcript. Notice what the agent does not do:
                no menu, no “please hold”, no asking for a number it already has.
              </p>
            </div>
          </Reveal>
          <Reveal delay={0.1} className="mt-12">
            <LazyMount placeholder={<SectionSkeleton height={460} />} rootMargin="400px">
              <SampleCalls />
            </LazyMount>
          </Reveal>
        </div>
      </section>

      {/* ── How it works ─────────────────────────────────────────────────── */}
      <section id="how" className="mx-auto max-w-[1180px] scroll-mt-20 px-5 py-20">
        <div className="grid gap-12 lg:grid-cols-[0.9fr_1.1fr]">
          <Reveal>
            <div className="lg:sticky lg:top-28">
              <Pill tone="amber" className="mb-4">How it works</Pill>
              <h2 className="font-[family-name:var(--font-display)] text-[30px] font-semibold leading-tight tracking-tight text-t1 sm:text-[34px]">
                From “here is my business” to a live number, in one sitting
              </h2>
              <p className="mt-4 text-[14.5px] leading-relaxed text-t2">
                No prompt engineering, no flow charts to draw. Swara interviews you the way a good
                operations manager would, then builds and tests the agents herself.
              </p>
              <div className="mt-7">
                <ButtonLink href={primaryHref} variant="primary" size="md">
                  {signedIn ? "Open the console" : "Try it with your business"}
                  <ArrowRight className="size-4" />
                </ButtonLink>
              </div>
            </div>
          </Reveal>

          <ol className="relative">
            <StepLine />
            {STEPS.map((s, i) => (
              <Reveal key={s.title} delay={i * 0.08}>
                <li className="relative flex gap-5 pb-10 last:pb-0">
                  <div className="relative z-10 flex size-10 shrink-0 items-center justify-center rounded-full border border-white/[0.1] bg-void">
                    <s.icon className="size-[17px] text-cyan" strokeWidth={1.8} />
                  </div>
                  <Card interactive={false} className="flex-1 p-5">
                    <div className="font-[family-name:var(--font-mono)] text-[11px] text-t3">Step {i + 1}</div>
                    <h3 className="mt-1 font-[family-name:var(--font-display)] text-[17px] font-semibold text-t1">{s.title}</h3>
                    <p className="mt-2 text-[13.5px] leading-relaxed text-t2">{s.body}</p>
                    <div className="mt-4 rounded-[12px] border border-white/[0.06] bg-white/[0.03] px-3.5 py-2.5 text-[12.5px] italic leading-relaxed text-t2">
                      {s.detail}
                    </div>
                  </Card>
                </li>
              </Reveal>
            ))}
          </ol>
        </div>
      </section>

      {/* ── Use cases ────────────────────────────────────────────────────── */}
      <section id="use-cases" className="scroll-mt-20 border-y border-hairline bg-white/[0.015]">
        <div className="mx-auto max-w-[1180px] px-5 py-20">
          <Reveal>
            <div className="mx-auto max-w-2xl text-center">
              <Pill tone="violet" className="mb-4">Where it earns its keep</Pill>
              <h2 className="font-[family-name:var(--font-display)] text-[30px] font-semibold tracking-tight text-t1 sm:text-[34px]">
                Built for the calls Indian businesses actually get
              </h2>
              <p className="mt-3 text-[14.5px] leading-relaxed text-t2">
                Pick your industry. Each one shows the problem, what the agent does about it, and a
                line from a real call.
              </p>
            </div>
          </Reveal>
          <Reveal delay={0.1} className="mt-12">
            <LazyMount placeholder={<SectionSkeleton height={420} />} rootMargin="400px">
              <UseCaseCarousel />
            </LazyMount>
          </Reveal>
        </div>
      </section>

      {/* ── Features ─────────────────────────────────────────────────────── */}
      <section id="features" className="mx-auto max-w-[1180px] scroll-mt-20 px-5 py-20">
        <Reveal>
          <div className="mx-auto max-w-2xl text-center">
            <Pill tone="cyan" className="mb-4">Why Swara</Pill>
            <h2 className="font-[family-name:var(--font-display)] text-[30px] font-semibold tracking-tight text-t1 sm:text-[34px]">
              The details that decide whether callers stay on the line
            </h2>
            <p className="mt-3 text-[14.5px] leading-relaxed text-t2">
              Most voice bots are a menu with a nicer voice. These are the things we built so that
              yours is not.
            </p>
          </div>
        </Reveal>

        <div className="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f, i) => (
            <Reveal key={f.title} delay={(i % 3) * 0.08}>
              <TiltCard>
                <Card className="h-full p-5">
                  <div className="mb-3.5 flex size-9 items-center justify-center rounded-[10px] bg-violet/[0.16]">
                    <f.icon className="size-[17px] text-violet" strokeWidth={1.8} />
                  </div>
                  <h3 className="font-[family-name:var(--font-display)] text-[15px] font-semibold text-t1">{f.title}</h3>
                  <p className="mt-2 text-[12.5px] leading-relaxed text-t2">{f.body}</p>
                </Card>
              </TiltCard>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ── Compliance ───────────────────────────────────────────────────── */}
      <section id="compliance" className="scroll-mt-20 border-y border-hairline bg-white/[0.015]">
        <div className="mx-auto grid max-w-[1180px] gap-10 px-5 py-20 lg:grid-cols-2 lg:items-center">
          <Reveal>
            <div>
              <Pill tone="amber" className="mb-5">
                <ShieldCheck className="size-3" />
                Compliance
              </Pill>
              <h2 className="font-[family-name:var(--font-display)] text-[30px] font-semibold leading-tight tracking-tight text-t1">
                DLT, DND and quiet hours are enforced by the dialer — not by you remembering
              </h2>
              <p className="mt-4 text-[14px] leading-relaxed text-t2">
                A number on the DND registry cannot enter a dialing queue. A retry that would land at
                10 pm rolls to the next morning. A promotional script cannot go out on a 160 service
                number. None of this is a setting you can forget to switch on.
              </p>
              <p className="mt-3 text-[13px] leading-relaxed text-t3">
                Every call keeps its transcript, recording and consent record. If a regulator or an
                enterprise buyer asks, the answer is an export, not a project.
              </p>
            </div>
          </Reveal>

          <Reveal delay={0.1}>
            <Card interactive={false} className="p-5">
              {[
                { label: "DLT entity + content templates", detail: "Registered and approved" },
                { label: "National DND registry scrub", detail: "Synced every 4 hours" },
                { label: "Quiet hours 9pm–9am", detail: "Enforced in the dialer" },
                { label: "140 / 160 series separation", detail: "Blocked at the data layer" },
                { label: "Consent capture on every call", detail: "Stored with the recording" },
                { label: "Data residency — India", detail: "ap-south-1 only" },
              ].map((c, i) => (
                <motion.div
                  key={c.label}
                  initial={{ opacity: 0, x: 10 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.06, duration: 0.4 }}
                  className="flex items-center gap-3 border-b border-white/[0.05] py-3 last:border-b-0 last:pb-0"
                >
                  <Check className="size-4 shrink-0 text-cyan" strokeWidth={2.2} />
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] text-t1">{c.label}</div>
                    <div className="text-[11.5px] text-t3">{c.detail}</div>
                  </div>
                </motion.div>
              ))}
            </Card>
          </Reveal>
        </div>
      </section>

      {/* ── Pricing teaser ───────────────────────────────────────────────── */}
      <section className="mx-auto max-w-[1180px] px-5 py-20">
        <Reveal>
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="font-[family-name:var(--font-display)] text-[30px] font-semibold tracking-tight text-t1 sm:text-[34px]">
              Pricing you can read without booking a demo
            </h2>
            <p className="mt-3 text-[14.5px] leading-relaxed text-t2">
              Pay for minutes on the phone. Nothing per seat, nothing per agent. Here it is.
            </p>
          </div>
        </Reveal>

        <div className="mt-12 grid gap-4 lg:grid-cols-3">
          {PLANS.map((p, i) => (
            <Reveal key={p.id} delay={i * 0.08}>
              <Card
                interactive={!p.highlight}
                className={cn("flex h-full flex-col p-6", p.highlight && "border-cyan/30 bg-cyan/[0.05]")}
              >
                <div className="min-h-[22px]">{p.highlight ? <Pill tone="cyan">Most popular</Pill> : null}</div>
                <h3 className="mt-3 font-[family-name:var(--font-display)] text-[17px] font-semibold text-t1">{p.name}</h3>
                <div className="mt-3 font-[family-name:var(--font-display)] text-[32px] font-semibold text-t1">
                  {formatRupees(p.priceInr)}
                  <span className="text-[14px] font-normal text-t3">/mo</span>
                </div>
                <div className="mt-1 font-[family-name:var(--font-mono)] text-[11.5px] text-t3">
                  {p.includedMinutes.toLocaleString("en-IN")} minutes · then ₹{p.overageInr}/min
                </div>
                <div className="mt-auto pt-5">
                  <ButtonLink href={primaryHref} variant={p.highlight ? "primary" : "ghost"} full>
                    {signedIn ? "Manage plan" : "Start free"}
                  </ButtonLink>
                </div>
              </Card>
            </Reveal>
          ))}
        </div>

        <Reveal delay={0.2}>
          <div className="mt-8 text-center">
            <Link href="/pricing" className="text-[13px] font-medium text-cyan transition-opacity hover:opacity-80">
              Full feature comparison and a cost calculator →
            </Link>
          </div>
        </Reveal>
      </section>

      {/* ── FAQ ──────────────────────────────────────────────────────────── */}
      <section className="mx-auto max-w-[820px] px-5 pb-20">
        <Reveal>
          <h2 className="text-center font-[family-name:var(--font-display)] text-[26px] font-semibold tracking-tight text-t1">
            Questions owners ask before they start
          </h2>
        </Reveal>
        <Reveal delay={0.08} className="mt-8">
          <Faq />
        </Reveal>
      </section>

      {/* ── CTA ──────────────────────────────────────────────────────────── */}
      <section className="mx-auto max-w-[1180px] px-5 pb-24">
        <Reveal>
          <Card interactive={false} className="relative overflow-hidden p-10 text-center sm:p-14">
            <div
              aria-hidden
              className="pointer-events-none absolute -top-32 left-1/2 h-64 w-[560px] -translate-x-1/2 rounded-full blur-[90px]"
              style={{ background: "radial-gradient(circle, rgba(124,108,246,0.35), transparent 70%)" }}
            />
            <Waves className="mx-auto mb-5 size-7 text-cyan" strokeWidth={1.6} />
            <h2 className="mx-auto max-w-xl font-[family-name:var(--font-display)] text-[28px] font-semibold leading-tight tracking-tight text-t1 sm:text-[32px]">
              {signedIn ? "Your agents are waiting" : "Hear your own agent on a real call in about ten minutes"}
            </h2>
            <p className="mx-auto mt-3 max-w-lg text-[13.5px] leading-relaxed text-t2">
              {signedIn
                ? "Check today's calls, clear the queue, or build the next agent with Swara."
                : "Describe your business, pick a voice, call yourself. Nothing reaches your customers until you publish."}
            </p>
            <div className="mt-7 flex flex-wrap justify-center gap-3">
              <ButtonLink href={primaryHref} variant="primary" size="lg">
                {signedIn ? <LayoutDashboard className="size-4" /> : <Zap className="size-4" />}
                {signedIn ? "Go to Dashboard" : "Start free"}
              </ButtonLink>
              {!signedIn ? (
                <ButtonLink href="/pricing" variant="ghost" size="lg">
                  See pricing
                </ButtonLink>
              ) : null}
            </div>
          </Card>
        </Reveal>
      </section>
    </>
  );
}

/* ── Pieces ─────────────────────────────────────────────────────────────── */

/** Thin brand-gradient bar at the very top that fills as you read. */
function ScrollProgress() {
  const { scrollYProgress } = useScroll();
  const scaleX = useSpring(scrollYProgress, { stiffness: 140, damping: 26, mass: 0.3 });
  return (
    <motion.div
      aria-hidden
      className="grad-brand fixed inset-x-0 top-0 z-[60] h-[2px] origin-left"
      style={{ scaleX }}
    />
  );
}

/** The hero preview drifts up slightly slower than the page — depth without a stock image. */
function HeroParallax({ children }: { children: React.ReactNode }) {
  const reduce = useReducedMotion();
  const { scrollY } = useScroll();
  const y = useTransform(scrollY, [0, 600], [0, reduce ? 0 : -50]);
  return (
    <motion.div style={{ y }} className="mt-14">
      <Reveal delay={0.15}>{children}</Reveal>
    </motion.div>
  );
}

/** Pointer-following tilt. Subtle on purpose; the lit-border does the rest. */
function TiltCard({ children }: { children: React.ReactNode }) {
  const reduce = useReducedMotion();
  const [tilt, setTilt] = useState({ x: 0, y: 0 });
  if (reduce) return <div className="h-full">{children}</div>;
  return (
    <motion.div
      className="h-full"
      style={{ perspective: 900 }}
      onPointerMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        setTilt({ x: ((e.clientY - r.top) / r.height - 0.5) * -5, y: ((e.clientX - r.left) / r.width - 0.5) * 5 });
      }}
      onPointerLeave={() => setTilt({ x: 0, y: 0 })}
    >
      <motion.div
        className="h-full"
        animate={{ rotateX: tilt.x, rotateY: tilt.y }}
        transition={{ type: "spring", stiffness: 220, damping: 22, mass: 0.5 }}
        style={{ transformStyle: "preserve-3d" }}
      >
        {children}
      </motion.div>
    </motion.div>
  );
}

/** The vertical connector behind the steps, drawn as you scroll to it. */
function StepLine() {
  return (
    <motion.div
      aria-hidden
      className="absolute bottom-6 left-5 top-6 w-px origin-top bg-gradient-to-b from-cyan/60 via-violet/50 to-transparent"
      initial={{ scaleY: 0 }}
      whileInView={{ scaleY: 1 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 1.1, ease: EASE }}
    />
  );
}

function Marquee() {
  const items = [...MARQUEE, ...MARQUEE];
  return (
    <div className="border-y border-hairline bg-white/[0.015] py-4 [mask-image:linear-gradient(90deg,transparent,#000_12%,#000_88%,transparent)]">
      <div className="flex w-max animate-[marquee_48s_linear_infinite] gap-10 motion-reduce:animate-none">
        {items.map((m, i) => (
          <span key={`${m}-${i}`} className="flex items-center gap-10 text-[12.5px] text-t3">
            {m}
            <span className="size-1 rounded-full bg-white/[0.18]" />
          </span>
        ))}
      </div>
    </div>
  );
}

function Faq() {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <div className="divide-y divide-white/[0.06] overflow-hidden rounded-[18px] border border-hairline bg-white/[0.02]">
      {FAQ.map((f, i) => {
        const isOpen = open === i;
        return (
          <div key={f.q}>
            <button
              type="button"
              onClick={() => setOpen(isOpen ? null : i)}
              aria-expanded={isOpen}
              className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left transition-colors hover:bg-white/[0.03]"
            >
              <span className="text-[14px] font-medium text-t1">{f.q}</span>
              <motion.span animate={{ rotate: isOpen ? 180 : 0 }} transition={{ duration: 0.25 }} className="shrink-0 text-t3">
                <ChevronDown className="size-4" />
              </motion.span>
            </button>
            <AnimatePresence initial={false}>
              {isOpen ? (
                <motion.div
                  key="body"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.3, ease: EASE }}
                  className="overflow-hidden"
                >
                  <p className="px-5 pb-5 text-[13.5px] leading-relaxed text-t2">{f.a}</p>
                </motion.div>
              ) : null}
            </AnimatePresence>
          </div>
        );
      })}
    </div>
  );
}

function SectionSkeleton({ height }: { height: number }) {
  return <div className="glass animate-pulse rounded-[22px]" style={{ height }} aria-hidden />;
}

/** A miniature of the live-calls surface — shows the product rather than a
 *  stock screenshot, and the motion makes it read as a live system. */
function HeroCallPreview() {
  const calls = [
    { phone: "+91 98•• •• 2214", intent: "Delivery reschedule", lang: "Hindi", tone: "cyan" as const, dur: "01:24" },
    { phone: "+91 87•• •• 0091", intent: "Complaint · ticket #48213 found", lang: "Marathi", tone: "amber" as const, dur: "03:12" },
    { phone: "+91 90•• •• 5527", intent: "Booking · Thu 4:30 pm", lang: "Hinglish", tone: "cyan" as const, dur: "02:03" },
  ];

  return (
    <Card interactive={false} className="mx-auto max-w-4xl p-4 sm:p-5">
      <div className="mb-4 flex items-center gap-2.5 border-b border-hairline pb-3.5">
        <LiveDot />
        <span className="text-[12.5px] font-medium text-t1">Live calls · what you see in the console</span>
        <span className="ml-auto flex items-center gap-2">
          <PhoneIncoming className="size-3.5 text-cyan" strokeWidth={1.8} />
          <span className="font-[family-name:var(--font-mono)] text-[11px] text-t3">2 in</span>
          <PhoneOutgoing className="size-3.5 text-violet" strokeWidth={1.8} />
          <span className="font-[family-name:var(--font-mono)] text-[11px] text-t3">1 out</span>
        </span>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {calls.map((c, i) => (
          <motion.div
            key={c.phone}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            whileHover={{ y: -3 }}
            transition={{ delay: 0.35 + i * 0.12, duration: 0.5, ease: EASE }}
            className={cn("glass rounded-[14px] p-3.5", c.tone === "amber" && "border-amber/25 bg-amber/[0.06]")}
          >
            <div className="mb-2 flex items-center justify-between">
              <span className="font-[family-name:var(--font-mono)] text-[11.5px] text-t1">{c.phone}</span>
              <LiveDot tone={c.tone} />
            </div>
            <div className="mb-2.5 text-[11.5px] text-t2">
              {c.intent} · {c.lang} · <span className="font-[family-name:var(--font-mono)]">{c.dur}</span>
            </div>
            <Waveform bars={11} tone={c.tone} height={18} />
          </motion.div>
        ))}
      </div>
    </Card>
  );
}
