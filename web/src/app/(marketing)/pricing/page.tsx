"use client";

import { useState } from "react";
import { motion } from "motion/react";
import { Check, Info, Minus } from "lucide-react";
import { Card } from "@/components/ui/card";
import { ButtonLink } from "@/components/ui/button";
import { Pill } from "@/components/ui/pill";
import { Slider } from "@/components/ui/controls";
import { NumberTicker, Reveal } from "@/components/motion/primitives";
import { Mono, Table, Td, Th, Tr } from "@/components/ui/table";
import { CATEGORY_RATE_INR_PER_MIN, PLANS, bestPlanFor } from "@/lib/pricing";
import { cn, formatRupees } from "@/lib/utils";

const COMPARISON: { feature: string; starter: boolean | string; growth: boolean | string; scale: boolean | string }[] = [
  { feature: "Inbound calls", starter: true, growth: true, scale: true },
  { feature: "Outbound campaigns", starter: "Manual only", growth: true, scale: true },
  { feature: "Agents", starter: "3", growth: "Unlimited", scale: "Unlimited" },
  { feature: "Phone numbers included", starter: "1", growth: "3", scale: "10" },
  { feature: "Concurrent calls", starter: "25", growth: "150", scale: "500" },
  { feature: "Indian languages + Hinglish", starter: true, growth: true, scale: true },
  { feature: "Node-graph flow builder", starter: true, growth: true, scale: true },
  { feature: "AI copilot flow editing", starter: true, growth: true, scale: true },
  { feature: "Knowledge base grounding", starter: "1 source", growth: "Unlimited", scale: "Unlimited" },
  { feature: "Live listen and take over", starter: false, growth: true, scale: true },
  { feature: "Calendar booking", starter: true, growth: true, scale: true },
  { feature: "No-show risk scoring", starter: false, growth: true, scale: true },
  { feature: "Complaint kanban with SLA", starter: "Basic", growth: true, scale: true },
  { feature: "Automated call scoring", starter: false, growth: true, scale: true },
  { feature: "Cost-per-call reporting", starter: true, growth: true, scale: true },
  { feature: "Customer 360 timeline", starter: false, growth: true, scale: true },
  { feature: "Voice cloning", starter: false, growth: false, scale: true },
  { feature: "A/B script testing", starter: false, growth: false, scale: true },
  { feature: "Integrations", starter: "3", growth: "Unlimited", scale: "Unlimited" },
  { feature: "REST API + webhooks", starter: true, growth: true, scale: true },
  { feature: "MCP server", starter: false, growth: true, scale: true },
  { feature: "Role-based access control", starter: "Owner only", growth: "Full", scale: "Full + audit log" },
  { feature: "Audit export for regulated buyers", starter: false, growth: false, scale: true },
  { feature: "Dedicated SIP trunk", starter: false, growth: false, scale: true },
];

export default function PricingPage() {
  return (
    <div className="mx-auto max-w-[1180px] px-5 py-16">
      <Reveal>
        <div className="mx-auto max-w-2xl text-center">
          <Pill tone="cyan" className="mb-5">
            No sales call required
          </Pill>
          <h1 className="font-[family-name:var(--font-display)] text-[38px] font-semibold leading-tight tracking-tight text-t1">
            Pricing, in public
          </h1>
          <p className="mt-4 text-[14.5px] leading-relaxed text-t2">
            Every plan includes inbound and outbound, all twelve languages, and compliance. What
            changes between tiers is volume and the depth of the operations tooling.
          </p>
        </div>
      </Reveal>

      <div className="mt-12 grid gap-4 lg:grid-cols-3">
        {PLANS.map((p, i) => (
          <Reveal key={p.id} delay={i * 0.08}>
            <Card
              interactive={false}
              className={cn(
                "flex h-full flex-col p-6",
                p.highlight && "border-cyan/30 bg-cyan/[0.05]",
              )}
            >
              {p.highlight ? (
                <Pill tone="cyan" className="mb-3 self-start">
                  Most popular
                </Pill>
              ) : null}
              <h2 className="font-[family-name:var(--font-display)] text-[18px] font-semibold text-t1">
                {p.name}
              </h2>
              <p className="mt-1.5 text-[12.5px] leading-snug text-t3">{p.blurb}</p>

              <div className="mt-5 font-[family-name:var(--font-display)] text-[34px] font-semibold text-t1">
                {formatRupees(p.priceInr)}
                <span className="text-[15px] font-normal text-t3">/mo</span>
              </div>
              <Mono className="mt-1 block text-[11.5px]">
                {p.includedMinutes.toLocaleString("en-IN")} minutes · then ₹{p.overageInr}/min
              </Mono>
              <Mono className="mt-0.5 block text-[11px] text-cyan">
                ≈ ₹{(p.priceInr / p.includedMinutes).toFixed(2)} per minute at full usage
              </Mono>

              <ButtonLink
                href="/signup"
                variant={p.highlight ? "primary" : "ghost"}
                full
                className="my-5"
              >
                Start free
              </ButtonLink>

              <ul className="space-y-2.5">
                {p.features.map((f) => (
                  <li key={f} className="flex gap-2.5 text-[12.5px] leading-snug text-t2">
                    <Check className="mt-px size-3.5 shrink-0 text-cyan" strokeWidth={2.2} />
                    {f}
                  </li>
                ))}
              </ul>
            </Card>
          </Reveal>
        ))}
      </div>

      <Reveal delay={0.15} className="mt-6">
        <CostCalculator />
      </Reveal>

      <Reveal className="mt-16">
        <h2 className="mb-6 text-center font-[family-name:var(--font-display)] text-[24px] font-semibold tracking-tight text-t1">
          Full comparison
        </h2>
        <Card interactive={false}>
          <Table>
            <thead>
              <tr>
                <Th>Feature</Th>
                <Th align="center">Starter</Th>
                <Th align="center">Growth</Th>
                <Th align="center">Scale</Th>
              </tr>
            </thead>
            <tbody>
              {COMPARISON.map((row, i) => (
                <Tr key={row.feature} index={i}>
                  <Td className="text-t2">{row.feature}</Td>
                  <Td align="center">
                    <Cell value={row.starter} />
                  </Td>
                  <Td align="center">
                    <Cell value={row.growth} />
                  </Td>
                  <Td align="center">
                    <Cell value={row.scale} />
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </Card>
      </Reveal>

      <Reveal className="mt-12">
        <Card interactive={false} className="p-6">
          <div className="flex gap-3">
            <Info className="mt-0.5 size-4 shrink-0 text-violet" strokeWidth={1.7} />
            <div>
              <h3 className="font-[family-name:var(--font-display)] text-[15px] font-semibold text-t1">
                Why we can price this way
              </h3>
              <p className="mt-2 max-w-3xl text-[12.5px] leading-relaxed text-t2">
                We built and host our own speech-to-speech model rather than reselling someone
                else&apos;s stack of speech-to-text, an LLM, and text-to-speech stitched together.
                That removes three vendor margins and one round-trip of latency. It is also why the
                console will show you our cost per call — a number that only looks good because the
                architecture underneath it is ours.
              </p>
            </div>
          </div>
        </Card>
      </Reveal>
    </div>
  );
}

function Cell({ value }: { value: boolean | string }) {
  if (value === true) return <Check className="mx-auto size-4 text-cyan" strokeWidth={2.2} />;
  if (value === false) return <Minus className="mx-auto size-3.5 text-t3" strokeWidth={2} />;
  return <span className="text-[12px] text-t2">{value}</span>;
}

/**
 * The calculator exists because a monthly price with an overage rate is not
 * actually transparent until someone can plug their own volume into it.
 */
function CostCalculator() {
  const [minutes, setMinutes] = useState(4000);
  const best = bestPlanFor(minutes);
  const categoryCost = minutes * CATEGORY_RATE_INR_PER_MIN;
  const saving = categoryCost - best.total;

  return (
    <Card interactive={false} className="p-6">
      <div className="grid gap-8 lg:grid-cols-[1fr_1fr] lg:items-center">
        <div>
          <h3 className="font-[family-name:var(--font-display)] text-[17px] font-semibold text-t1">
            What will it actually cost you?
          </h3>
          <p className="mt-2 text-[12.5px] leading-relaxed text-t2">
            Drag to your expected monthly call minutes. A 3-minute average call means roughly{" "}
            {Math.round(minutes / 3).toLocaleString("en-IN")} calls a month.
          </p>

          <div className="mt-6">
            <Slider
              label="Monthly call minutes"
              value={minutes}
              onChange={(v) => setMinutes(Math.round(v / 250) * 250)}
              min={500}
              max={20000}
              step={250}
              format={(v) => `${Math.round(v).toLocaleString("en-IN")} min`}
            />
          </div>

          <div className="mt-5 flex flex-wrap gap-2">
            {[1000, 2500, 6000, 12000].map((m) => (
              <button
                key={m}
                onClick={() => setMinutes(m)}
                className={cn(
                  "rounded-full border px-3 py-1 text-[11.5px] transition-colors",
                  minutes === m
                    ? "border-cyan/40 bg-cyan/[0.12] text-cyan"
                    : "border-hairline text-t3 hover:text-t1",
                )}
              >
                {m.toLocaleString("en-IN")} min
              </button>
            ))}
          </div>
        </div>

        <motion.div layout className="glass rounded-[18px] p-5">
          <div className="mb-1 text-[11.5px] uppercase tracking-[0.06em] text-t3">
            Best plan for you
          </div>
          <div className="flex items-baseline gap-2">
            <span className="font-[family-name:var(--font-display)] text-[26px] font-semibold text-t1">
              {best.plan.name}
            </span>
            {best.overageMinutes > 0 ? (
              <Pill tone="amber">+{best.overageMinutes.toLocaleString("en-IN")} min overage</Pill>
            ) : (
              <Pill tone="cyan">Within plan</Pill>
            )}
          </div>

          <div className="mt-4 font-[family-name:var(--font-display)] text-[36px] font-semibold text-t1">
            <NumberTicker value={best.total} format={(n) => formatRupees(Math.round(n))} />
            <span className="text-[15px] font-normal text-t3">/mo</span>
          </div>
          <Mono className="mt-1 block text-[11.5px]">
            ₹{(best.total / minutes).toFixed(2)} per minute all-in
          </Mono>

          <div className="mt-5 border-t border-hairline pt-4">
            <div className="flex items-baseline justify-between text-[12.5px]">
              <span className="text-t3">Typical category rate (~₹{CATEGORY_RATE_INR_PER_MIN}/min)</span>
              <Mono>{formatRupees(categoryCost)}</Mono>
            </div>
            <div className="mt-2 flex items-baseline justify-between text-[12.5px]">
              <span className="font-medium text-t1">You keep</span>
              <span className="font-[family-name:var(--font-mono)] text-sm text-cyan">
                {formatRupees(saving)}/mo
              </span>
            </div>
          </div>

          {/* Cheapest-on-price and best-fit aren't always the same plan, and
              pretending otherwise would be the opacity we're selling against. */}
          {best.overageMinutes > 0 ? (
            <p className="mt-4 rounded-[10px] bg-white/[0.04] p-2.5 text-[11px] leading-snug text-t3">
              This is the cheapest plan for your volume, but paying overage on{" "}
              {best.plan.name} means you skip the features in the tier above. Compare the table
              below before deciding on price alone.
            </p>
          ) : null}

          <ButtonLink href="/signup" variant="primary" full className="mt-5">
            Start on {best.plan.name}
          </ButtonLink>
        </motion.div>
      </div>
    </Card>
  );
}
