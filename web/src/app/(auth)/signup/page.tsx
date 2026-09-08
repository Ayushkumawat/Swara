"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { motion } from "motion/react";
import { Check } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, TextInput } from "@/components/ui/controls";
import { IS_MOCK, mutations } from "@/lib/api/client";

export default function SignupPage() {
  const router = useRouter();
  const [form, setForm] = useState({ name: "", business: "", email: "", phone: "", password: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));
  const valid =
    form.name && form.business && form.email.includes("@") && (IS_MOCK || form.password.length >= 8);

  const submit = async () => {
    if (!valid) return;
    setBusy(true);
    setError(null);
    if (IS_MOCK) {
      setTimeout(() => router.push("/onboarding"), 700);
      return;
    }
    try {
      // Creates the org and signs the owner in; onboarding runs authenticated.
      await mutations.signup(form.business, form.name, form.email, form.password);
      router.push("/onboarding");
      router.refresh();
    } catch (e) {
      const raw = e instanceof Error ? e.message : "";
      try {
        setError((JSON.parse(raw) as { error?: string }).error ?? "Could not create workspace");
      } catch {
        setError(raw || "Could not create workspace");
      }
      setBusy(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      className="w-full max-w-[860px]"
    >
      <Card interactive={false} className="grid gap-0 overflow-hidden p-0 md:grid-cols-[1.1fr_1fr]">
        <div className="p-7 sm:p-9">
          <h1 className="font-[family-name:var(--font-display)] text-[22px] font-semibold text-t1">
            Create your workspace
          </h1>
          <p className="mt-1.5 text-[13px] text-t2">
            100 free minutes. No card, no sales call.
          </p>

          <div className="mt-6 space-y-4">
            <Field label="Your name">
              <TextInput value={form.name} onChange={set("name")} placeholder="Rohan Suresh" />
            </Field>
            <Field label="Business name">
              <TextInput
                value={form.business}
                onChange={set("business")}
                placeholder="Robosapien LLP"
              />
            </Field>
            <Field label="Work email">
              <TextInput
                value={form.email}
                onChange={set("email")}
                type="email"
                placeholder="rohan@yourcompany.in"
              />
            </Field>
            <Field
              label="Mobile number"
              hint="We call this number for your first test call, so it needs to be reachable."
            >
              <TextInput value={form.phone} onChange={set("phone")} placeholder="+91 98765 43210" />
            </Field>
            {!IS_MOCK ? (
              <Field label="Password" hint="At least 8 characters.">
                <TextInput
                  value={form.password}
                  onChange={set("password")}
                  type="password"
                  placeholder="••••••••"
                />
              </Field>
            ) : null}
          </div>

          {error ? (
            <p className="mt-3 rounded-lg border border-coral/30 bg-coral/10 px-3 py-2 text-[12px] text-coral">
              {error}
            </p>
          ) : null}

          <Button
            variant="primary"
            full
            className="mt-6"
            disabled={!valid || busy}
            onClick={submit}
          >
            {busy ? "Creating workspace…" : "Create workspace"}
          </Button>

          <p className="mt-4 text-center text-[12px] text-t3">
            Already have one?{" "}
            <Link href="/login" className="font-medium text-cyan hover:underline">
              Sign in
            </Link>
          </p>
        </div>

        <div className="border-t border-hairline bg-white/[0.025] p-7 sm:p-9 md:border-l md:border-t-0">
          <div className="text-[11.5px] uppercase tracking-[0.07em] text-t3">
            What happens next
          </div>
          <div className="mt-4 space-y-4">
            {[
              { t: "Pick a template", b: "Order status, delivery reschedule, complaint intake or lead qualification." },
              { t: "Connect a number", b: "We provision an Indian 160 service number, or port yours." },
              { t: "Call yourself", b: "Hear the agent before a single customer does." },
              { t: "Publish", b: "Nothing reaches your customers until you press this." },
            ].map((s, i) => (
              <motion.div
                key={s.t}
                initial={{ opacity: 0, x: 8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.15 + i * 0.08, duration: 0.4 }}
                className="flex gap-3"
              >
                <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-cyan/[0.14] font-[family-name:var(--font-mono)] text-[10px] text-cyan">
                  {i + 1}
                </span>
                <div>
                  <div className="text-[12.5px] font-medium text-t1">{s.t}</div>
                  <div className="mt-0.5 text-[11.5px] leading-snug text-t3">{s.b}</div>
                </div>
              </motion.div>
            ))}
          </div>

          <div className="mt-7 border-t border-hairline pt-5">
            {["DLT and DND handled for you", "All 12 Indian languages", "Cancel any time"].map(
              (x) => (
                <div key={x} className="flex items-center gap-2 py-1 text-[12px] text-t2">
                  <Check className="size-3.5 text-cyan" strokeWidth={2.2} />
                  {x}
                </div>
              ),
            )}
          </div>
        </div>
      </Card>
    </motion.div>
  );
}
