"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { toast } from "sonner";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Headphones,
  MessageSquareWarning,
  PackageSearch,
  PhoneOutgoing,
  Rocket,
  Truck,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/ui/pill";
import { Field, ProgressBar, TextInput } from "@/components/ui/controls";
import { Waveform } from "@/components/ui/live";
import { LANGUAGE_LABEL, type Language } from "@/lib/api/schemas";
import { cn } from "@/lib/utils";

/**
 * First-run wizard.
 *
 * Self-serve pricing only converts if self-serve setup works, so the whole
 * path from empty workspace to a real test call is four steps and no sales
 * contact. Publishing is deliberately not one of them — the wizard ends at
 * "you heard it work", and going live stays an explicit decision.
 */

const TEMPLATES = [
  {
    id: "order_status",
    icon: PackageSearch,
    name: "Order status",
    blurb: "Answers “where is my order” from live tracking data.",
    tag: "Most popular",
  },
  {
    id: "delivery",
    icon: Truck,
    name: "Delivery reschedule",
    blurb: "Rebooks a failed or inconvenient delivery slot.",
    tag: null,
  },
  {
    id: "complaint",
    icon: MessageSquareWarning,
    name: "Complaint intake",
    blurb: "Logs a grievance with severity, category and SLA.",
    tag: null,
  },
  {
    id: "lead",
    icon: PhoneOutgoing,
    name: "Lead qualification",
    blurb: "Outbound. Qualifies and books a callback.",
    tag: "Outbound",
  },
];

const LANGUAGES: Language[] = ["hi", "en", "hinglish", "ta", "te", "mr", "bn", "kn", "ml", "gu"];

const STEPS = ["Choose a template", "Pick languages", "Get a number", "Hear it work"];

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [template, setTemplate] = useState<string | null>("order_status");
  const [languages, setLanguages] = useState<Language[]>(["hi", "en", "hinglish"]);
  const [numberChoice, setNumberChoice] = useState<"new" | "port">("new");
  const [testPhone, setTestPhone] = useState("+91 ");
  const [called, setCalled] = useState(false);

  const canAdvance =
    (step === 0 && template) ||
    (step === 1 && languages.length > 0) ||
    step === 2 ||
    (step === 3 && called);

  const next = () => {
    if (step < STEPS.length - 1) setStep(step + 1);
    else router.push("/overview");
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      className="w-full max-w-[640px]"
    >
      <div className="mb-5">
        <div className="mb-2.5 flex items-center justify-between">
          <span className="text-[12px] text-t3">
            Step {step + 1} of {STEPS.length}
          </span>
          <button
            onClick={() => router.push("/overview")}
            className="text-[12px] text-t3 transition-colors hover:text-t1"
          >
            Skip for now
          </button>
        </div>
        <ProgressBar value={(step + 1) / STEPS.length} height={4} />
      </div>

      <Card interactive={false} className="p-7">
        <h1 className="font-[family-name:var(--font-display)] text-[21px] font-semibold text-t1">
          {STEPS[step]}
        </h1>

        <div className="mt-5 min-h-[290px]">
          <AnimatePresence mode="wait">
            <motion.div
              key={step}
              initial={{ opacity: 0, x: 16 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -16 }}
              transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
            >
              {step === 0 ? (
                <>
                  <p className="mb-4 text-[13px] text-t2">
                    Templates are working agents, not blank canvases. You can rewrite everything
                    later.
                  </p>
                  <div className="grid gap-2.5 sm:grid-cols-2">
                    {TEMPLATES.map((t) => (
                      <button
                        key={t.id}
                        onClick={() => setTemplate(t.id)}
                        className={cn(
                          "rounded-[14px] border p-3.5 text-left transition-colors",
                          template === t.id
                            ? "border-cyan/40 bg-cyan/[0.07]"
                            : "border-hairline bg-white/[0.035] hover:bg-white/[0.06]",
                        )}
                      >
                        <div className="mb-2 flex items-center justify-between">
                          <t.icon className="size-4 text-violet" strokeWidth={1.8} />
                          {t.tag ? <Pill tone="grey">{t.tag}</Pill> : null}
                        </div>
                        <div className="text-[13px] font-medium text-t1">{t.name}</div>
                        <div className="mt-1 text-[11.5px] leading-snug text-t3">{t.blurb}</div>
                      </button>
                    ))}
                  </div>
                </>
              ) : null}

              {step === 1 ? (
                <>
                  <p className="mb-4 text-[13px] text-t2">
                    The agent detects which of these the caller is speaking within the first second.
                    Add as many as your customers actually use.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {LANGUAGES.map((l) => {
                      const on = languages.includes(l);
                      return (
                        <button
                          key={l}
                          onClick={() =>
                            setLanguages((prev) =>
                              on ? prev.filter((x) => x !== l) : [...prev, l],
                            )
                          }
                          className={cn(
                            "flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-[12.5px] transition-colors",
                            on
                              ? "border-cyan/40 bg-cyan/[0.12] text-cyan"
                              : "border-hairline text-t2 hover:text-t1",
                          )}
                        >
                          {on ? <Check className="size-3" strokeWidth={2.5} /> : null}
                          {LANGUAGE_LABEL[l]}
                        </button>
                      );
                    })}
                  </div>
                  <p className="mt-5 rounded-[12px] bg-white/[0.03] p-3 text-[11.5px] leading-relaxed text-t3">
                    Adding a language costs nothing extra and does not slow the call down. Hinglish
                    is worth keeping on even if you think your customers speak English — most
                    code-switch without noticing.
                  </p>
                </>
              ) : null}

              {step === 2 ? (
                <>
                  <p className="mb-4 text-[13px] text-t2">
                    Your agent needs a number to answer on. Both options are ready the same day.
                  </p>
                  <div className="space-y-2.5">
                    {[
                      {
                        id: "new" as const,
                        title: "Get a new Indian number",
                        blurb: "A 160 service-series number, provisioned in a few minutes. Included in your plan.",
                      },
                      {
                        id: "port" as const,
                        title: "Use a number I already have",
                        blurb: "Forward your existing business line to Swara. Nothing changes for customers who have it saved.",
                      },
                    ].map((o) => (
                      <button
                        key={o.id}
                        onClick={() => setNumberChoice(o.id)}
                        className={cn(
                          "flex w-full gap-3 rounded-[14px] border p-3.5 text-left transition-colors",
                          numberChoice === o.id
                            ? "border-cyan/40 bg-cyan/[0.07]"
                            : "border-hairline bg-white/[0.035] hover:bg-white/[0.06]",
                        )}
                      >
                        <span
                          className={cn(
                            "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border",
                            numberChoice === o.id ? "border-cyan bg-cyan" : "border-t3",
                          )}
                        >
                          {numberChoice === o.id ? (
                            <Check className="size-2.5 text-void" strokeWidth={3.5} />
                          ) : null}
                        </span>
                        <span>
                          <span className="block text-[13px] font-medium text-t1">{o.title}</span>
                          <span className="mt-0.5 block text-[11.5px] leading-snug text-t3">
                            {o.blurb}
                          </span>
                        </span>
                      </button>
                    ))}
                  </div>
                  <p className="mt-5 rounded-[12px] border border-amber/20 bg-amber/[0.07] p-3 text-[11.5px] leading-relaxed text-t2">
                    Outbound calling also needs DLT registration under your business name. We start
                    that in the background now — it typically clears in 2–5 working days, and
                    inbound works immediately in the meantime.
                  </p>
                </>
              ) : null}

              {step === 3 ? (
                <>
                  <p className="mb-4 text-[13px] text-t2">
                    Call yourself before any customer hears it. This runs the draft agent, not a
                    recording.
                  </p>
                  <Field label="Call this number">
                    <TextInput value={testPhone} onChange={setTestPhone} placeholder="+91 98765 43210" />
                  </Field>
                  <Button
                    variant="primary"
                    full
                    className="mt-4"
                    disabled={testPhone.trim().length < 8}
                    onClick={() => {
                      setCalled(true);
                      toast.success("Calling you now", {
                        description: "Answer and say “where is my order”.",
                      });
                    }}
                  >
                    <Headphones className="size-3.5" />
                    {called ? "Call again" : "Call me now"}
                  </Button>

                  <AnimatePresence>
                    {called ? (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        className="mt-4 overflow-hidden"
                      >
                        <div className="glass flex items-center gap-3 rounded-[14px] p-3.5">
                          <Waveform bars={9} tone="cyan" height={20} />
                          <span className="text-[12.5px] text-t2">
                            Ringing your phone — the call is live
                          </span>
                        </div>
                      </motion.div>
                    ) : null}
                  </AnimatePresence>
                </>
              ) : null}
            </motion.div>
          </AnimatePresence>
        </div>

        <div className="mt-6 flex items-center gap-3 border-t border-hairline pt-5">
          {step > 0 ? (
            <Button variant="subtle" onClick={() => setStep(step - 1)}>
              <ArrowLeft className="size-3.5" />
              Back
            </Button>
          ) : null}
          <Button
            variant="primary"
            className="ml-auto"
            disabled={!canAdvance}
            onClick={next}
          >
            {step === STEPS.length - 1 ? (
              <>
                <Rocket className="size-3.5" />
                Go to console
              </>
            ) : (
              <>
                Continue
                <ArrowRight className="size-3.5" />
              </>
            )}
          </Button>
        </div>
      </Card>
    </motion.div>
  );
}
