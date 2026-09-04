"use client";

import Link from "next/link";
import { motion } from "motion/react";
import {
  ArrowRight,
  BarChart3,
  CalendarCheck,
  Check,
  Headphones,
  Languages,
  PhoneIncoming,
  PhoneOutgoing,
  ShieldCheck,
  Sparkles,
  Waves,
  Zap,
} from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Pill, LiveDot } from "@/components/ui/pill";
import { Waveform } from "@/components/ui/live";
import { Reveal, NumberTicker } from "@/components/motion/primitives";
import { PLANS } from "@/lib/pricing";
import { formatRupees } from "@/lib/utils";

const FEATURES = [
  {
    icon: PhoneIncoming,
    title: "Genuinely good at both directions",
    body: "Most products are an outbound dialer with an inbound bolt-on, or the reverse. One agent handles the call whichever way it started, with the same memory and the same escalation path.",
  },
  {
    icon: Sparkles,
    title: "Edit flows by describing them",
    body: "Tell the copilot “confirm the address before booking” and it shows you the exact node changes. You approve them, they stage as a draft, and you roll back from Versions if it was wrong.",
  },
  {
    icon: Languages,
    title: "Twelve Indian languages, plus Hinglish",
    body: "Language is detected in the first second of the call, not selected on a form. Code-switching mid-sentence is handled, because that's how people actually speak.",
  },
  {
    icon: Headphones,
    title: "Watch and take over any live call",
    body: "Sentiment is scored continuously during the call, so a conversation sliding toward frustrated surfaces before it ends badly. Listen silently or bridge yourself in.",
  },
  {
    icon: CalendarCheck,
    title: "Books against your real calendar",
    body: "The agent checks live availability during the call and commits the slot without double-booking. No-show risk is scored from the customer's own history.",
  },
  {
    icon: BarChart3,
    title: "Shows you what each call cost",
    body: "Cost per call, broken into AI compute and telephony. Nobody else in this category will tell you this, which is exactly why we do.",
  },
];

export default function LandingPage() {
  return (
    <>
      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <section className="mx-auto max-w-[1180px] px-5 pb-16 pt-16 sm:pt-24">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          className="mx-auto max-w-3xl text-center"
        >
          <Pill tone="cyan" className="mb-6">
            <LiveDot />
            Live in Hindi, Tamil, Telugu, Marathi and 8 more
          </Pill>

          <h1 className="font-[family-name:var(--font-display)] text-[38px] font-semibold leading-[1.1] tracking-tight sm:text-[54px]">
            <span className="text-t1">Voice AI that answers</span>
            <br />
            <span className="text-grad">and calls, in every Indian language</span>
          </h1>

          <p className="mx-auto mt-6 max-w-2xl text-[15px] leading-relaxed text-t2">
            One platform for sales, support, complaints and bookings — inbound and outbound.
            Transparent per-minute pricing, DLT and DND compliance built into the product rather
            than promised in a sales call.
          </p>

          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <ButtonLink href="/signup" variant="primary" size="lg">
              Start free — 100 minutes
              <ArrowRight className="size-4" />
            </ButtonLink>
            <ButtonLink href="/pricing" variant="ghost" size="lg">
              See pricing
            </ButtonLink>
          </div>

          <p className="mt-4 text-[12px] text-t3">
            No sales call. No credit card. Pricing is on the pricing page.
          </p>
        </motion.div>

        <Reveal delay={0.15} className="mt-14">
          <HeroCallPreview />
        </Reveal>
      </section>

      {/* ── Proof strip ──────────────────────────────────────────────────── */}
      <section className="border-y border-hairline bg-white/[0.015]">
        <div className="mx-auto grid max-w-[1180px] grid-cols-2 gap-6 px-5 py-8 md:grid-cols-4">
          {[
            { value: 290, suffix: "ms", label: "Median response latency" },
            { value: 12, suffix: "", label: "Indian languages supported" },
            { value: 91, suffix: "%", label: "Calls resolved without a human" },
            { value: 3, prefix: "₹", suffix: "/min", label: "What a call actually costs us" },
          ].map((s, i) => (
            <Reveal key={s.label} delay={i * 0.07}>
              <div className="text-center md:text-left">
                <div className="font-[family-name:var(--font-display)] text-[26px] font-semibold text-t1">
                  <NumberTicker value={s.value} prefix={s.prefix} suffix={s.suffix} />
                </div>
                <div className="mt-1 text-[12px] text-t3">{s.label}</div>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ── Features ─────────────────────────────────────────────────────── */}
      <section id="features" className="mx-auto max-w-[1180px] px-5 py-20">
        <Reveal>
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="font-[family-name:var(--font-display)] text-[30px] font-semibold tracking-tight text-t1">
              Everything the category offers, combined
            </h2>
            <p className="mt-3 text-[14px] leading-relaxed text-t2">
              Each competitor is excellent at one thing and thin everywhere else. We took the best
              feature from each and made them work off one customer record.
            </p>
          </div>
        </Reveal>

        <div className="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f, i) => (
            <Reveal key={f.title} delay={(i % 3) * 0.08}>
              <Card className="h-full p-5">
                <div className="mb-3.5 flex size-9 items-center justify-center rounded-[10px] bg-violet/[0.16]">
                  <f.icon className="size-[17px] text-violet" strokeWidth={1.8} />
                </div>
                <h3 className="font-[family-name:var(--font-display)] text-[15px] font-semibold text-t1">
                  {f.title}
                </h3>
                <p className="mt-2 text-[12.5px] leading-relaxed text-t2">{f.body}</p>
              </Card>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ── Compliance ───────────────────────────────────────────────────── */}
      <section id="compliance" className="border-y border-hairline bg-white/[0.015]">
        <div className="mx-auto grid max-w-[1180px] gap-10 px-5 py-20 lg:grid-cols-2 lg:items-center">
          <Reveal>
            <div>
              <Pill tone="amber" className="mb-5">
                <ShieldCheck className="size-3" />
                Compliance
              </Pill>
              <h2 className="font-[family-name:var(--font-display)] text-[30px] font-semibold leading-tight tracking-tight text-t1">
                DLT, DND and quiet hours are enforced by the dialer
              </h2>
              <p className="mt-4 text-[14px] leading-relaxed text-t2">
                Not a checkbox in settings and not your responsibility to remember. A number on the
                DND registry cannot enter a dialing queue. A retry that would land at 10pm rolls to
                the next morning. A promotional script cannot go out on a 160 service number.
              </p>
              <p className="mt-3 text-[13px] leading-relaxed text-t3">
                Every call keeps its transcript, recording and consent record, so if a regulator or
                an enterprise buyer ever asks, the answer is an export rather than a project.
              </p>
            </div>
          </Reveal>

          <Reveal delay={0.1}>
            <Card interactive={false} className="p-5">
              {[
                { label: "DLT entity + content templates", detail: "Registered and approved", ok: true },
                { label: "National DND registry scrub", detail: "Synced every 4 hours", ok: true },
                { label: "Quiet hours 9pm–9am", detail: "Enforced in the dialer, 0 violations", ok: true },
                { label: "140 / 160 series separation", detail: "Blocked at the data layer", ok: true },
                { label: "Consent capture on every call", detail: "Stored with the recording", ok: true },
                { label: "Data residency — India", detail: "ap-south-1 only", ok: true },
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
            <h2 className="font-[family-name:var(--font-display)] text-[30px] font-semibold tracking-tight text-t1">
              Pricing you can read without booking a demo
            </h2>
            <p className="mt-3 text-[14px] leading-relaxed text-t2">
              Every other platform in this category hides its price behind a sales call. Here are
              ours.
            </p>
          </div>
        </Reveal>

        <div className="mt-12 grid gap-4 lg:grid-cols-3">
          {PLANS.map((p, i) => (
            <Reveal key={p.id} delay={i * 0.08}>
              <Card
                interactive={!p.highlight}
                className={
                  p.highlight
                    ? "h-full border-cyan/30 bg-cyan/[0.05] p-6"
                    : "h-full p-6"
                }
              >
                {p.highlight ? <Pill tone="cyan" className="mb-3">Most popular</Pill> : null}
                <h3 className="font-[family-name:var(--font-display)] text-[17px] font-semibold text-t1">
                  {p.name}
                </h3>
                <div className="mt-3 font-[family-name:var(--font-display)] text-[32px] font-semibold text-t1">
                  {formatRupees(p.priceInr)}
                  <span className="text-[14px] font-normal text-t3">/mo</span>
                </div>
                <div className="mt-1 font-[family-name:var(--font-mono)] text-[11.5px] text-t3">
                  {p.includedMinutes.toLocaleString("en-IN")} minutes · then ₹{p.overageInr}/min
                </div>
                <ButtonLink
                  href="/signup"
                  variant={p.highlight ? "primary" : "ghost"}
                  full
                  className="mt-5"
                >
                  Start free
                </ButtonLink>
              </Card>
            </Reveal>
          ))}
        </div>

        <Reveal delay={0.2}>
          <div className="mt-8 text-center">
            <Link
              href="/pricing"
              className="text-[13px] font-medium text-cyan transition-opacity hover:opacity-80"
            >
              Full feature comparison and a cost calculator →
            </Link>
          </div>
        </Reveal>
      </section>

      {/* ── CTA ──────────────────────────────────────────────────────────── */}
      <section className="mx-auto max-w-[1180px] px-5 pb-24">
        <Reveal>
          <Card
            interactive={false}
            className="overflow-hidden p-10 text-center sm:p-14"
          >
            <Waves className="mx-auto mb-5 size-7 text-cyan" strokeWidth={1.6} />
            <h2 className="mx-auto max-w-xl font-[family-name:var(--font-display)] text-[28px] font-semibold leading-tight tracking-tight text-t1">
              Put your first agent on a real call in about ten minutes
            </h2>
            <p className="mx-auto mt-3 max-w-lg text-[13.5px] leading-relaxed text-t2">
              Pick a template, connect a number, call yourself to hear it. Nothing goes live to your
              customers until you publish it.
            </p>
            <div className="mt-7 flex flex-wrap justify-center gap-3">
              <ButtonLink href="/signup" variant="primary" size="lg">
                <Zap className="size-4" />
                Start free
              </ButtonLink>
              <ButtonLink href="/overview" variant="ghost" size="lg">
                Explore the console
              </ButtonLink>
            </div>
          </Card>
        </Reveal>
      </section>
    </>
  );
}

/** A miniature of the live-calls surface — shows the product rather than a
 *  stock screenshot, and the motion makes it read as a live system. */
function HeroCallPreview() {
  const calls = [
    { phone: "+91 98•• •• 2214", intent: "Delivery reschedule", lang: "Hindi", tone: "cyan" as const, dur: "01:24" },
    { phone: "+91 87•• •• 0091", intent: "Complaint · escalating", lang: "Tamil", tone: "coral" as const, dur: "03:12" },
    { phone: "+91 90•• •• 5527", intent: "Sales enquiry", lang: "Hinglish", tone: "cyan" as const, dur: "02:03" },
  ];

  return (
    <Card interactive={false} className="mx-auto max-w-4xl p-4 sm:p-5">
      <div className="mb-4 flex items-center gap-2.5 border-b border-hairline pb-3.5">
        <LiveDot />
        <span className="text-[12.5px] font-medium text-t1">24 calls happening right now</span>
        <span className="ml-auto flex items-center gap-2">
          <PhoneIncoming className="size-3.5 text-cyan" strokeWidth={1.8} />
          <span className="font-[family-name:var(--font-mono)] text-[11px] text-t3">15 in</span>
          <PhoneOutgoing className="size-3.5 text-violet" strokeWidth={1.8} />
          <span className="font-[family-name:var(--font-mono)] text-[11px] text-t3">9 out</span>
        </span>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {calls.map((c, i) => (
          <motion.div
            key={c.phone}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.35 + i * 0.12, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
            className={`glass rounded-[14px] p-3.5 ${c.tone === "coral" ? "border-coral/25 bg-coral/[0.06]" : ""}`}
          >
            <div className="mb-2 flex items-center justify-between">
              <span className="font-[family-name:var(--font-mono)] text-[11.5px] text-t1">
                {c.phone}
              </span>
              <LiveDot tone={c.tone} />
            </div>
            <div className="mb-2.5 text-[11.5px] text-t2">
              {c.intent} · {c.lang} ·{" "}
              <span className="font-[family-name:var(--font-mono)]">{c.dur}</span>
            </div>
            <Waveform bars={11} tone={c.tone} height={18} />
          </motion.div>
        ))}
      </div>
    </Card>
  );
}
