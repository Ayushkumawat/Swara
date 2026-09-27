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

const TONE: Record<string, string> = {
  complaint:
    "Slow and warm. Let them tell the whole story before you ask anything. Acknowledge what happened in one plain line — no 'I understand your frustration' slogan, no cheerfulness. Then ask only what you need to file it. Once it is filed, say what happens next and by when.",
  order_status:
    "Plain and quick. They want to know where the thing is. Get the order number or use the number they are calling from, look it up, and say the status and the date in one breath. If it is late, say so plainly and say what you can do. Do not pad.",
  delivery_reschedule:
    "Practical and a little sorry, without grovelling. Say what happened in one line, offer two windows, confirm the address, read the slot back once.",
  booking:
    "Calm and concrete. Find out what they need booked and roughly when, then offer two real slots. Never ask an open 'when are you free?'. Confirm once.",
  sales_enquiry:
    "You are a good salesperson, not a brochure. Ask what they are trying to get done and listen. Ask about their situation before you describe anything — size, timeline, what they use today, who decides. Answer the question they asked, tied to what they told you, in two sentences. No feature dumps, no pressure, no invented price or discount. If it is not a fit, say so. Always leave with one concrete next step they agreed to — a demo, a callback at a named time, or a message with details.",
  payment_reminder:
    "Matter-of-fact and brief. Who you are, which order, the amount, when it arrives. Ask if they will be there. Never pressure. A cancellation is accepted without an argument; note it and close.",
  feedback: "Light and short. One question at a time, let them answer fully. Thank them and stop.",
  other: "Brief and friendly. Understand what they want first. Do the one job you were given, then hand off or close.",
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
      break;
  }
  if (input.canHandoff) tools.add("handoff_to_agent");
  if (input.canTransfer) tools.add("transfer_to_human");
  return [...tools];
}

const TOOL_LINE: Record<string, string> = {
  lookup_order: "lookup_order — before you state any order status. Use the order number if they gave one, else the phone number they are calling from. Never guess one.",
  register_complaint: "register_complaint — after you understand what happened and have their name. Leave phone empty; it uses the number they are calling from. You have no reference number until this returns one — then read it back, once. If it returns possible_duplicate, they already have an open ticket for this: tell them its status and ask if it is the same thing before doing anything else.",
  lookup_ticket: "lookup_ticket — the moment they mention an earlier complaint, ask for status, or quote a number. Call it with no arguments to see every ticket from their phone; never ask them for a reference number first.",
  notify_stakeholder: "notify_stakeholder — after a ticket exists, to tell the desk that owns it.",
  book_slot: "book_slot — only after they accept one of the two slots you offered.",
  search_knowledge: "search_knowledge — before any policy, fee, timing or process answer. If it is not there, say you don't have it.",
  transfer_to_human: "transfer_to_human — only to a desk named in TRANSFER TARGETS, and only after you say you are connecting them.",
  handoff_to_agent: "handoff_to_agent — when the caller needs a different agent. One sentence, then the exact agent name.",
  end_call: "end_call — after the closing line, when they have nothing else.",
};

export function buildRolePrompt(input: {
  name: string;
  job: string;
  role?: string;
  intent: string;
  isFrontDoor: boolean;
  direction: string;
  canTransfer: boolean;
  tools: string[];
}): string {
  const tone = input.isFrontDoor
    ? "Short. You greet, work out who they need in one or two turns, and hand them over. You do not solve the request yourself and you do not collect details for the next agent."
    : (TONE[input.intent] ?? TONE.other);
  const body = (input.role ?? "").trim() || input.job;
  const never = [
    "Invent a fact, a price, a slot, a status, or a policy that a tool did not return.",
    "Ask for name and phone number before you know what the caller wants. Understand first; collect only when you need it to act.",
    "Ask for anything the caller already told you, or ask two questions in one turn.",
    "Repeat your last sentence when they did not understand — rephrase it shorter.",
    "Say \"anything else?\" and \"thank you for calling\" in the same turn. Ask, stop, wait for the answer; the goodbye is its own turn, only after they say no.",
    "Say a complaint is registered, or speak any reference number, before the register_complaint tool has returned one. No tool result, no number.",
    "Stay on a job that belongs to another agent — hand it off.",
    "Ask which language they prefer, or keep speaking a language they have left.",
  ];
  if (!input.canTransfer) {
    never.push(
      "Offer a transfer, say you are connecting them to a person, or name a colleague. Nobody is available. Say that, and take a name and callback number.",
    );
  }
  return [
    `ROLE — ${input.name}`,
    `You handle ${input.direction} calls. This is your only job. The name you introduce yourself with is given to you at the top of this instruction — use that one, not any name in the text below.`,
    body,
    "",
    "TONE",
    tone,
    "",
    "HOW YOU SOUND",
    "You are a person on a phone, not a menu and not a script. Talk the way a good colleague on the desk would.",
    "Short sentences. Say one thing, then stop and let them respond. A small pause before a number, a date, or a name you are about to read back.",
    "A light filler now and then — \"ah\", \"um\", \"hmm\", \"ek second\", \"accha\" — when you are looking something up or choosing a word. At most one in a turn. Never stack them. Never while reading a reference number, an amount, or a phone number.",
    "Vary your acknowledgements. Not the same \"ji\" or \"got it\" twice in a row.",
    "Do not announce that you are an AI unless they ask. If they ask, say yes in a word and continue.",
    "",
    "ACTIONS — these are the only tools you may call",
    ...input.tools.map((t) => `- ${TOOL_LINE[t] ?? t}`),
    "",
    "NEVER",
    ...never.map((n) => `- ${n}`),
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
