/**
 * Every prebuilt voice the Live API serves — each one is a person, not a slider.
 *
 * The API exposes exactly one knob: the voice name. There is no speaking-rate,
 * warmth or formality parameter, and no cloning. Anything else about how the
 * agent sounds — gender agreement in Hindi, pace, register — lives in the
 * prompt, which is why every voice carries a short craft template. Editing
 * that template in Voice Studio is how a tenant makes "Kore" into their Riya
 * without us inventing controls the model cannot hear.
 *
 * `character` is Google's own one-word description of the voice. `gender` is
 * how the voice reads to listeners (Google does not publish one); it matters
 * because Hindi verbs agree with the speaker, so a mismatch is audible on the
 * first sentence.
 */

export type VoiceGender = "female" | "male";

export type VoiceCatalogEntry = {
  id: string;
  /** Prebuilt Live API voice name — the only thing the API actually takes. */
  name: string;
  /** "Kore · Riya" — the API name and the person we made of it. */
  label: string;
  gender: VoiceGender;
  /** Google's one-word character for the voice. */
  character: string;
  /** Kept for rows/UI that read it; same as `character`, lower-cased. */
  style: string;
  /** The name the agent uses for itself on the call. Editable per org. */
  personaName: string;
  /** One line for pickers. */
  blurb: string;
  descriptor: string;
  /** What this voice suits. Spoken in the Voice Studio preview. */
  bestFor: string;
  /** How this person talks. Gendered verbs are load-bearing. */
  promptTemplate: string;
};

type Seed = {
  name: string;
  gender: VoiceGender;
  character: string;
  personaName: string;
  blurb: string;
  bestFor: string;
  /** Hand-tuned craft for the voices we have listened to the most. */
  craft?: string;
};

const SEEDS: Seed[] = [
  // ── Hand-tuned: the five we shipped first ──────────────────────────────
  {
    name: "Orus", gender: "male", character: "Firm", personaName: "Arjun",
    blurb: "Warm, mid-range, unhurried", bestFor: "support lines and order follow-ups",
    craft: `Mid-range, unhurried, slightly warm. Do not rush a worried caller. Laugh softly if they joke; do not perform cheerfulness.`,
  },
  {
    name: "Kore", gender: "female", character: "Firm", personaName: "Riya",
    blurb: "Crisp and businesslike", bestFor: "a front desk or a receptionist",
    craft: `Crisp and businesslike. Short sentences. No trailing warmth that wastes their time. You are competent, not cold.`,
  },
  {
    name: "Puck", gender: "male", character: "Upbeat", personaName: "Kabir",
    blurb: "Brighter, higher energy", bestFor: "sales follow-ups and reminders",
    craft: `Higher energy, brighter, a little faster — a sales follow-up or a reminder, not a grievance. Do not sound manic. One smile in the voice, then the point.`,
  },
  {
    name: "Charon", gender: "male", character: "Informative", personaName: "Vikram",
    blurb: "Lower, calm, reassuring", bestFor: "complaints and angry callers",
    craft: `Lower and calm. This is the voice for an angry or frightened caller. Slow down. Do not match their volume. Reassure, then act.`,
  },
  {
    name: "Aoede", gender: "female", character: "Breezy", personaName: "Meera",
    blurb: "Softer, slower cadence", bestFor: "grievance intake and elderly callers",
    craft: `Soft and unhurried. Give people room. Never clip a sentence to sound efficient.`,
  },
  // ── The rest of the prebuilt set ───────────────────────────────────────
  { name: "Zephyr", gender: "female", character: "Bright", personaName: "Ananya", blurb: "Bright and clear", bestFor: "appointment booking and confirmations" },
  { name: "Fenrir", gender: "male", character: "Excitable", personaName: "Rohan", blurb: "Energetic, quick", bestFor: "outbound campaigns and event invites" },
  { name: "Leda", gender: "female", character: "Youthful", personaName: "Tara", blurb: "Young, light", bestFor: "D2C brands and student-facing lines" },
  { name: "Callirrhoe", gender: "female", character: "Easy-going", personaName: "Nisha", blurb: "Relaxed, friendly", bestFor: "feedback calls and casual check-ins" },
  { name: "Autonoe", gender: "female", character: "Bright", personaName: "Pooja", blurb: "Bright, upbeat", bestFor: "renewals and offer reminders" },
  { name: "Enceladus", gender: "male", character: "Breathy", personaName: "Dev", blurb: "Soft-spoken, intimate", bestFor: "wellness and clinic reminders" },
  { name: "Iapetus", gender: "male", character: "Clear", personaName: "Aditya", blurb: "Clear, even", bestFor: "order status and delivery updates" },
  { name: "Umbriel", gender: "male", character: "Easy-going", personaName: "Nikhil", blurb: "Relaxed, approachable", bestFor: "payment reminders that should not feel like threats" },
  { name: "Algieba", gender: "male", character: "Smooth", personaName: "Siddharth", blurb: "Smooth, measured", bestFor: "premium brands and concierge lines" },
  { name: "Despina", gender: "female", character: "Smooth", personaName: "Kavya", blurb: "Smooth, polished", bestFor: "hospitality and premium support" },
  { name: "Erinome", gender: "female", character: "Clear", personaName: "Shreya", blurb: "Clear, precise", bestFor: "verification calls and KYC follow-ups" },
  { name: "Algenib", gender: "male", character: "Gravelly", personaName: "Raghav", blurb: "Deep, gravelly", bestFor: "security desks and collections" },
  { name: "Rasalgethi", gender: "male", character: "Informative", personaName: "Manish", blurb: "Informative, steady", bestFor: "helplines and FAQ lines" },
  { name: "Laomedeia", gender: "female", character: "Upbeat", personaName: "Isha", blurb: "Upbeat, warm", bestFor: "lead qualification and demos" },
  { name: "Achernar", gender: "female", character: "Soft", personaName: "Sneha", blurb: "Soft, gentle", bestFor: "healthcare and sensitive follow-ups" },
  { name: "Alnilam", gender: "male", character: "Firm", personaName: "Varun", blurb: "Firm, confident", bestFor: "B2B sales and escalations" },
  { name: "Schedar", gender: "male", character: "Even", personaName: "Karthik", blurb: "Even, neutral", bestFor: "IVR replacements and general enquiries" },
  { name: "Gacrux", gender: "female", character: "Mature", personaName: "Sunita", blurb: "Mature, assured", bestFor: "banking, insurance and senior citizens" },
  { name: "Pulcherrima", gender: "female", character: "Forward", personaName: "Divya", blurb: "Forward, direct", bestFor: "collections and firm reminders" },
  { name: "Achird", gender: "male", character: "Friendly", personaName: "Amit", blurb: "Friendly, open", bestFor: "small-business front desks" },
  { name: "Zubenelgenubi", gender: "male", character: "Casual", personaName: "Sameer", blurb: "Casual, conversational", bestFor: "food delivery and quick-commerce support" },
  { name: "Vindemiatrix", gender: "female", character: "Gentle", personaName: "Lakshmi", blurb: "Gentle, patient", bestFor: "grievance redressal and elder care" },
  { name: "Sadachbia", gender: "male", character: "Lively", personaName: "Yash", blurb: "Lively, animated", bestFor: "event promotions and surveys" },
  { name: "Sadaltager", gender: "male", character: "Knowledgeable", personaName: "Rajesh", blurb: "Knowledgeable, calm", bestFor: "technical support and product questions" },
  { name: "Sulafat", gender: "female", character: "Warm", personaName: "Priya", blurb: "Warm, welcoming", bestFor: "customer care and welcome calls" },
];

/** Hindi agreement is the first thing a caller hears wrong. Keep it explicit. */
function genderLine(gender: VoiceGender) {
  return gender === "male"
    ? `Speak strictly with masculine grammar in Hindi/Hinglish ("main samajh gaya", "dekhta hoon", "bata raha hoon", "karta hoon") — never feminine forms.`
    : `Speak strictly with feminine grammar in Hindi/Hinglish ("main samajh gayi", "dekhti hoon", "bata rahi hoon", "karti hoon") — never masculine forms.`;
}

function craftFor(s: Seed) {
  const body = s.craft ?? `${s.blurb}. Keep that colour in every sentence without overdoing it.`;
  return `VOICE — you are ${s.personaName}, a ${s.gender === "male" ? "man" : "woman"}. ${genderLine(s.gender)} ${body} Sound like a real person on the phone: use natural micro-pauses and soft spoken expressions like "ummm...", "ohh...", "hmm...", or "accha..." when thinking or reacting to what the caller says.`;
}

export const VOICE_CATALOG: VoiceCatalogEntry[] = SEEDS.map((s) => ({
  id: s.name.toLowerCase(),
  name: s.name,
  label: `${s.name} · ${s.personaName}`,
  gender: s.gender,
  character: s.character,
  style: s.character.toLowerCase(),
  personaName: s.personaName,
  blurb: s.blurb,
  descriptor: s.blurb.toLowerCase(),
  bestFor: s.bestFor,
  promptTemplate: craftFor(s),
}));

export const DEFAULT_VOICE = "Orus";

/**
 * Pseudo-agent id for Voice Studio's play button. The token route composes a
 * one-line introduction for the chosen voice instead of a stored agent, and
 * skips the call row and consent artefact a real test call would create.
 */
export const VOICE_PREVIEW_AGENT_ID = "ag_voice_preview";

export function voiceByName(name: string | undefined) {
  if (!name) return VOICE_CATALOG[0];
  const n = name.toLowerCase();
  return VOICE_CATALOG.find((v) => v.name.toLowerCase() === n || v.id === n) ?? VOICE_CATALOG[0];
}

export function voiceCraft(name: string | undefined) {
  return voiceByName(name).promptTemplate;
}

/** Every voice name, for schema enums and tool declarations. */
export const VOICE_NAMES = VOICE_CATALOG.map((v) => v.name);
