/**
 * What an agent does when a call needs a person.
 *
 * One setting per agent, because businesses differ: one agent only notes a
 * complaint and the owner is told afterwards; another can put the caller
 * straight through to someone who resolves it on the same call.
 *
 * - live:  may connect the caller to a person during the call.
 * - after: never connects live; the right person is informed when the call ends.
 * - both:  connects live when it is needed, and informs after the call about
 *          anything filed that nobody was told about on the call.
 * - never: neither.
 *
 * Who is reached, and how, comes from each person's own ticks (Calls /
 * Email) in Workspace setup.
 */
export const HUMAN_MODES = ["both", "live", "after", "never"] as const;
export type HumanMode = (typeof HUMAN_MODES)[number];

/** A new agent connects live and informs after; the owner narrows it. */
export const DEFAULT_HUMAN_MODE: HumanMode = "both";

export function normaliseHumanMode(value: unknown): HumanMode {
  return (HUMAN_MODES as readonly string[]).includes(String(value)) ? (value as HumanMode) : DEFAULT_HUMAN_MODE;
}

export const canConnectLive = (mode: HumanMode) => mode === "live" || mode === "both";
export const informsAfterCall = (mode: HumanMode) => mode === "after" || mode === "both";

export const HUMAN_MODE_OPTIONS: readonly { value: HumanMode; label: string; hint: string }[] = [
  {
    value: "both",
    label: "Connect live, and inform after the call",
    hint: "Puts the caller through when needed; anything else filed is sent to the right person when the call ends",
  },
  {
    value: "live",
    label: "Connect live during the call",
    hint: "Puts the caller through to a person who takes calls; nothing is sent afterwards",
  },
  {
    value: "after",
    label: "Inform after the call",
    hint: "Notes it down; the right person gets a call or email when the call ends",
  },
  {
    value: "never",
    label: "Handle it alone",
    hint: "No transfer and nobody is informed — the agent takes a callback note",
  },
];

export const HUMAN_MODE_SHORT: Record<HumanMode, string> = {
  both: "Live + after call",
  live: "Live transfer",
  after: "Inform after call",
  never: "No person",
};

/**
 * What an agent draws on from Workspace setup, in the owner's words. Teams
 * are optional — complaints work without any — so "departments" is not
 * something an agent needs and has no label.
 */
const USES_LABEL: Record<string, string | null> = {
  departments: null,
  transfers: "people to reach",
  appointments: "appointment types",
  orders: "order lookup",
  knowledge: "knowledge",
};

export function usesLabels(needs: readonly string[]) {
  return needs.map((n) => (n in USES_LABEL ? USES_LABEL[n] : n)).filter((l): l is string => Boolean(l));
}
