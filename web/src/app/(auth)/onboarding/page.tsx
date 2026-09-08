"use client";

import dynamic from "next/dynamic";
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
import { IS_MOCK, mutations } from "@/lib/api/client";
import { cn } from "@/lib/utils";

// The Gemini SDK plus the audio stack, needed only on the last step of the
// wizard. Loading it up front would slow the step nobody has reached yet.
const CallPanel = dynamic(() => import("@/components/live/call-panel").then((m) => m.CallPanel));

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

const STEPS = ["Choose a template", "How you work", "Get a number", "Hear it work"];

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [template, setTemplate] = useState<string | null>("order_status");
  const [hours, setHours] = useState("10:00-19:00 IST");
  const [transferName, setTransferName] = useState("");
  const [transferPhone, setTransferPhone] = useState("");
  const [numberChoice, setNumberChoice] = useState<"new" | "port">("new");
  const [testPhone, setTestPhone] = useState("+91 ");
  const [called, setCalled] = useState(false);
  const [calling, setCalling] = useState(false);

  const canAdvance =
    (step === 0 && template) ||
    step === 1 ||
    step === 2 ||
    (step === 3 && called);

  const next = async () => {
    if (step === 1 && !IS_MOCK) {
      try {
        await mutations.savePlaybook({ hours, transferPolicy: transferName ? `Transfer to ${transferName}` : "" });
        if (transferName && transferPhone) {
          await mutations.saveTransfer({
            name: transferName,
            role: "On-call",
            phone: transferPhone,
            whenToUse: "Caller asked for a person, or the agent is stuck",
          });
        }
      } catch {
        // Wizard still advances — setup can be finished in the console.
      }
    }
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
                    Language is detected from speech — we never ask Hindi or English. What we do
                    need is hours and, if you have one, the person a stuck call should reach.
                  </p>
                  <div className="space-y-3">
                    <Field label="Working hours">
                      <TextInput value={hours} onChange={setHours} placeholder="10:00-19:00 IST" />
                    </Field>
                    <Field label="Transfer to (optional)">
                      <TextInput value={transferName} onChange={setTransferName} placeholder="Priya Desai, support lead" />
                    </Field>
                    <Field label="Their phone">
                      <TextInput value={transferPhone} onChange={setTransferPhone} placeholder="+91 98200 11122" />
                    </Field>
                  </div>
                  <p className="mt-5 rounded-[12px] bg-white/[0.03] p-3 text-[11.5px] leading-relaxed text-t3">
                    You can add departments, appointment types and a knowledge base later in
                    Workspace setup. Without a transfer number the agent will take a callback
                    instead of inventing a desk.
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
                    Hear it before any customer does. This runs the draft agent, not a recording —
                    interrupt it, switch to Hindi mid-sentence, try to confuse it.
                  </p>

                  {/* Browser first, because it works this second and needs no
                      number, no DLT approval, and no waiting for a callback.
                      The fastest possible path to "oh, it actually works". */}
                  <Button
                    variant="primary"
                    full
                    onClick={() => {
                      setCalled(true);
                      setCalling(true);
                    }}
                  >
                    <Headphones className="size-3.5" />
                    {called ? "Talk to it again" : "Talk to it now"}
                  </Button>
                  <p className="mt-2 text-center text-[11px] text-t3">
                    Uses your mic — headphones recommended
                  </p>

                  <div className="mt-5 border-t border-hairline pt-4">
                    <Field label="Or have it call your phone">
                      <TextInput
                        value={testPhone}
                        onChange={setTestPhone}
                        placeholder="+91 98765 43210"
                      />
                    </Field>
                    <Button
                      full
                      className="mt-2.5"
                      disabled={testPhone.trim().length < 8}
                      onClick={() =>
                        toast("Phone testing unlocks once your number is provisioned", {
                          description: "The browser test above runs the same agent right now.",
                        })
                      }
                    >
                      Call me now
                    </Button>
                  </div>

                  <CallPanel
                    open={calling}
                    onClose={() => setCalling(false)}
                    agentId="ag_order"
                    agentName="Order status lookup"
                    languages={["hi", "en", "hinglish"]}
                  />
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
            onClick={() => void next()}
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
