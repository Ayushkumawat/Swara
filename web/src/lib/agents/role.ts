/**
 * What Swara writes onto an agent, and what a live call is allowed to do.
 *
 * One role prompt, one tool list, one knowledge note — scoped to the job.
 * Language is never pinned: the caller’s speech picks it, and a switch
 * mid-call switches the agent in that same turn.
 */

export const AGENT_LANGUAGES = [
  "hi", "en", "hinglish", "ta", "te", "kn", "ml", "mr", "bn", "gu", "pa", "or",
] as const;

/**
 * Placeholder the role text uses for the agent's own spoken name, so renaming
 * the persona or switching voice never means rewriting the role.
 */
export const NAME_PLACEHOLDER = "{name}";

/**
 * One line of job colour, used only when the planner did not write a role
 * (a template, a hand-made agent). A model-written role carries its own.
 */
const JOB_HINT: Record<string, string> = {
  complaint: "Let them tell the whole story first. Acknowledge it in one plain line, file it, then say what happens next and by when.",
  order_status: "Find the order — number if they gave one, else the number they are calling from — and say the status and date in one breath.",
  delivery_reschedule: "Say what happened in one line, offer two windows, confirm the address, read the slot back once.",
  booking: "Find out what and roughly when, then offer two real slots. Never ask an open 'when are you free?'.",
  sales_enquiry: "Ask about their situation before describing anything. Answer in two sentences tied to what they said. Leave with one agreed next step.",
  payment_reminder: "Who you are, which order, the amount, when it arrives, will they be there. A cancellation is accepted without argument.",
  feedback: "One question at a time, let them answer fully, thank them and stop.",
  other: "Understand what they want first, do the one job you were given, then hand off or close.",
};

export function toolsForRole(input: {
  intent: string;
  isFrontDoor: boolean;
  canTransfer: boolean;
  canHandoff: boolean;
  canBook: boolean;
}): string[] {
  const tools = new Set<string>(["end_call"]);
  if (input.isFrontDoor) {
    tools.add("handoff_to_agent");
    return [...tools];
  }
  switch (input.intent) {
    case "order_status":
      tools.add("lookup_order");
      tools.add("lookup_ticket");
      tools.add("search_knowledge");
      break;
    case "complaint":
      tools.add("register_complaint");
      tools.add("lookup_ticket");
      tools.add("update_ticket");
      tools.add("resolve_ticket");
      tools.add("notify_stakeholder");
      tools.add("search_knowledge");
      break;
    case "booking":
    case "delivery_reschedule":
      if (input.canBook) tools.add("book_slot");
      tools.add("search_knowledge");
      break;
    case "sales_enquiry":
      tools.add("search_knowledge");
      if (input.canBook) tools.add("book_slot");
      break;
    case "payment_reminder":
      tools.add("search_knowledge");
      break;
    default:
      tools.add("search_knowledge");
      tools.add("lookup_ticket");
      break;
  }
  if (input.canHandoff) tools.add("handoff_to_agent");
  if (input.canTransfer) tools.add("transfer_to_human");
  return [...tools];
}

/**
 * The stored role: only what is specific to this agent's job at this
 * business. Everything true of every phone call — natural pauses, one question
 * a turn, tools as source of truth, how to end — is added once at call time
 * (`CONVERSATION_RULES` in live-prompt.ts), not repeated into every agent.
 * Tool schemas live in `TOOL_DECLARATIONS` so the prompt stays free of
 * function/parameter syntax that a voice model might read aloud.
 */
export function buildRolePrompt(input: {
  name: string;
  job: string;
  role?: string;
  intent: string;
  isFrontDoor: boolean;
  direction: string;
  tools?: string[];
}): string {
  const body = (input.role ?? "").trim();
  const fallback = input.isFrontDoor
    ? "Greet, work out in a turn or two who the caller needs, and hand them over to the right team. You do not solve the request yourself."
    : (JOB_HINT[input.intent] ?? JOB_HINT.other);
  const direction =
    input.direction === "outbound" ? "You make outbound calls." : input.direction === "both" ? "You take and make calls." : "You answer inbound calls.";
  const job = input.job.trim().replace(/\.?$/, ".");
  return [
    `ROLE — ${input.name}`,
    `${job} ${direction}`,
    "",
    body || fallback,
  ].join("\n");
}

/** Which catalog voice suits a job when the owner has not chosen one. */
export function defaultVoiceFor(intent: string, isFrontDoor: boolean, gender?: "male" | "female" | null): string {
  if (gender === "female") return intent === "complaint" ? "Aoede" : "Kore";
  if (gender === "male") return intent === "complaint" ? "Charon" : intent === "sales_enquiry" ? "Puck" : "Orus";
  if (isFrontDoor) return "Kore";
  switch (intent) {
    case "complaint":
      return "Aoede";
    case "sales_enquiry":
      return "Puck";
    case "payment_reminder":
    case "order_status":
      return "Kore";
    case "delivery_reschedule":
    case "booking":
      return "Orus";
    default:
      return "Orus";
  }
}

export const FIRST_NAMES: Record<"male" | "female" | "neutral", string[]> = {
  female: ["Riya", "Meera", "Ananya", "Priya", "Kavya", "Neha", "Isha", "Sneha", "Pooja", "Divya", "Swara", "Anjali", "Shreya", "Tanvi", "Nisha", "Aisha", "Sara", "Simran"],
  male: ["Arjun", "Kabir", "Vikram", "Aarav", "Arav", "Rohan", "Karan", "Aditya", "Nikhil", "Rahul", "Dev", "Rajesh", "Amit", "Vivek", "Sameer", "Rohit", "Varun", "Yash"],
  neutral: ["Kiran", "Noor", "Aman", "Jay"],
};

/** Best guess from common Indian first names; null when unsure. */
export function guessGender(name: string | undefined | null): "male" | "female" | null {
  const first = (name ?? "").trim().split(/\s+/)[0]?.toLowerCase();
  if (!first) return null;
  if (FIRST_NAMES.female.some((n) => n.toLowerCase() === first)) return "female";
  if (FIRST_NAMES.male.some((n) => n.toLowerCase() === first)) return "male";
  if (/(ika|iya|ita|ini|shi|thi|vi|ali|ani)$/.test(first)) return "female";
  if (/(esh|ish|eet|it|av|an|deep|raj|jit)$/.test(first)) return "male";
  return null;
}
