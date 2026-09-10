/**
 * Pricing is a product surface, not a marketing asset.
 *
 * project.md §1 makes transparent pricing the wedge against Gnani/Yellow.ai/
 * PolyAI, and §2 fixes the tiers. Both the public pricing page and the
 * in-console plan switcher read from here so they can never disagree — a
 * customer finding two different numbers is worse than showing none.
 */

export type PlanId = "starter" | "growth" | "scale";

export type Plan = {
  id: PlanId;
  name: string;
  priceInr: number;
  includedMinutes: number;
  overageInr: number;
  blurb: string;
  highlight?: boolean;
  features: string[];
};

export const PLANS: Plan[] = [
  {
    id: "starter",
    name: "Starter",
    priceInr: 12999,
    includedMinutes: 2500,
    overageInr: 5,
    blurb: "For a first agent handling order status and delivery calls.",
    features: [
      "Inbound and outbound from day one",
      "Up to 3 agents",
      "1 phone number included",
      "All 12 Indian languages + Hinglish",
      "DLT/DND compliance built in",
      "Live call monitoring",
      "Email support",
    ],
  },
  {
    id: "growth",
    name: "Growth",
    priceInr: 24999,
    includedMinutes: 6000,
    overageInr: 5,
    highlight: true,
    blurb: "For a team running campaigns alongside always-on support.",
    features: [
      "Everything in Starter",
      "Unlimited agents",
      "3 phone numbers included",
      "Outbound campaigns with retry logic",
      "Live listen, take over and warm transfer",
      "Automated call scoring and CSAT",
      "Customer 360 and integrations",
      "Priority support",
    ],
  },
  {
    id: "scale",
    name: "Scale",
    priceInr: 49999,
    includedMinutes: 14000,
    overageInr: 4,
    blurb: "For high-volume operations that need concurrency headroom.",
    features: [
      "Everything in Growth",
      "10 phone numbers included",
      "500 concurrent calls",
      "Voice cloning and A/B script testing",
      "Full RBAC and audit exports",
      "Dedicated SIP trunk",
      "Slack channel support",
    ],
  },
];

/** What a given monthly volume costs on the cheapest plan that fits. */
export function bestPlanFor(minutes: number) {
  const options = PLANS.map((p) => {
    const overageMinutes = Math.max(0, minutes - p.includedMinutes);
    const total = p.priceInr + overageMinutes * p.overageInr;
    return { plan: p, total, overageMinutes };
  });
  return options.reduce((best, o) => (o.total < best.total ? o : best));
}

/** Rough comparison anchor. Category per-minute rates sit around ₹8–12 for
 *  Indian voice AI once overages and platform fees are counted. */
export const CATEGORY_RATE_INR_PER_MIN = 9;
