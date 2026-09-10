/**
 * One definition of what a Swara live voice session is.
 *
 * The browser never sends its own session config: it receives an ephemeral
 * token whose `liveConnectConstraints` were built from this file, so the server
 * decides the model, the voice, and the system instruction. That matters
 * because a token is visible in devtools — if the client could name its own
 * model and prompt, a leaked token would be a free general-purpose Gemini key
 * billed to us.
 *
 * The Python telephony worker mirrors these values (see `agent/live_session.py`).
 * Keep the two in sync; they are the same product decision expressed twice
 * because one runs in a browser and the other next to a SIP leg.
 */

import {
  type FunctionDeclaration,
  type LiveConnectConfig,
  Modality,
  ThinkingLevel,
  Type,
} from "@google/genai";
import { DEFAULT_VOICE, VOICE_CATALOG, type VoiceCatalogEntry } from "./voices";

export { DEFAULT_VOICE, VOICE_CATALOG };
export type { VoiceCatalogEntry };

/** Native-audio dialogue model. Audio in, audio out, no cascade. */
export const LIVE_MODEL = "gemini-3.1-flash-live-preview";

/**
 * Ephemeral tokens are only served on v1alpha, and the version has to match on
 * both the minting call and the client connection or the socket dies with an
 * unhelpful handshake error.
 */
export const LIVE_API_VERSION = "v1alpha";

/** Live API is fixed at 16 kHz mono PCM in, 24 kHz mono PCM out. */
export const INPUT_SAMPLE_RATE = 16000;
export const OUTPUT_SAMPLE_RATE = 24000;

export type LiveVoice = VoiceCatalogEntry;

/** Voices we've actually listened to on Indian-accented Hinglish. */
export const LIVE_VOICES: LiveVoice[] = VOICE_CATALOG;

/**
 * Voice activity detection.
 *
 * These are the values a phone call needs, and they differ from the defaults.
 * Indian callers pause mid-sentence while switching between Hindi and English,
 * and a barge-in that fires on those pauses makes the agent feel like it is
 * talking over people — the single most common complaint about voice bots.
 *
 * - `prefixPaddingMs` at 20 ms would clip the first syllable, which is exactly
 *   where "haan" and "nahi" live, so we look back further.
 * - `silenceDurationMs` buys tolerance for thinking pauses at the cost of
 *   response latency. 700 ms is the point where the agent still feels prompt
 *   but stops interrupting.
 *
 * Known server-side issue: gemini-3.1-flash-live-preview currently ignores
 * `silenceDurationMs` and ends turns at roughly 2 s regardless
 * (googleapis/js-genai#1467). We still send it so the behaviour arrives for
 * free when that is fixed, and so the 2.5 fallback model honours it.
 */
export const VAD_CONFIG = {
  disabled: false,
  prefixPaddingMs: 300,
  silenceDurationMs: 700,
} as const;

/**
 * Context window compression.
 *
 * Audio burns roughly 25 tokens per second of conversation, so an uncompressed
 * audio session hits the 128k window and dies at about 15 minutes. A sliding
 * window makes the session effectively unbounded, which support and grievance
 * calls need — those run long.
 *
 * `triggerTokens` well below the 128k ceiling because compression itself costs
 * a latency spike, and it is better to pay that early in a call than to have it
 * land while a caller is mid-complaint. System instructions are never
 * discarded, so the agent's persona survives compression.
 */
export const COMPRESSION_CONFIG = {
  // Strings, not numbers: these are int64 proto fields, and the JS SDK types
  // them as strings because a JS number cannot hold the full range.
  triggerTokens: "32000",
  slidingWindow: { targetTokens: "16000" },
} as const;

/**
 * Thinking depth. `MINIMAL` is the default and the right one here: on a phone
 * call, a thoughtful answer that arrives 800 ms late is worse than a decent one
 * that arrives now. Raise this only for agents doing real reasoning mid-call.
 *
 * Note this is nested under `thinkingConfig`, not set at the top level of the
 * session config. A stray top-level `thinkingLevel` type-checks in some
 * positions and is then dropped on the wire, so the model quietly runs at its
 * default while the code claims otherwise.
 */
export const THINKING_CONFIG = { thinkingLevel: ThinkingLevel.MINIMAL } as const;

/** How long a minted token stays valid, and how long the holder has to open a
 *  session with it. Short windows are the entire point of ephemeral tokens. */
export const TOKEN_TTL_MS = 30 * 60 * 1000;
export const TOKEN_SESSION_START_TTL_MS = 2 * 60 * 1000;

/**
 * Function declarations the model can call mid-conversation.
 *
 * Declarations live here — shared config, baked into the token constraints —
 * but execution is server-side only (`lib/server/tools.ts`). The model pauses,
 * emits a toolCall over the socket, the client ferries it to POST
 * /api/v1/tools/execute, and the JSON result goes back over the socket for the
 * model to speak from. The browser never resolves a tool itself: a tool
 * answered client-side would let anyone with devtools file complaints or read
 * orders as someone else.
 */
export const TOOL_DECLARATIONS: FunctionDeclaration[] = [
  {
    name: "lookup_order",
    description:
      "Look up a customer's order by order ID or registered phone number. Returns status, expected delivery and amount. Call this before answering ANY order question; never guess order details.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        order_id: { type: Type.STRING, description: "Order ID if the caller has it, e.g. ORD-48213" },
        phone: { type: Type.STRING, description: "10-digit registered mobile, if no order ID" },
      },
    },
  },
  {
    name: "register_complaint",
    description:
      "Register a formal complaint. Call this once you have the caller's name, phone and the issue — the returned reference number is what you read back. Never promise a reference number without calling this first.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        customer_name: { type: Type.STRING },
        phone: { type: Type.STRING },
        title: { type: Type.STRING, description: "One line, in English, e.g. 'AC not working in coach 3'" },
        description: { type: Type.STRING, description: "What happened, where, when — in English" },
        category: {
          type: Type.STRING,
          description:
            "One of: cleanliness, technical fault, delay, staff behaviour, refund, safety, wrong item, other",
        },
        severity: { type: Type.STRING, enum: ["low", "medium", "high", "critical"] },
      },
      required: ["customer_name", "phone", "title", "description", "category", "severity"],
    },
  },
  {
    name: "book_slot",
    description:
      "Confirm an appointment or delivery slot. Call only after the caller has agreed to a specific date and time window.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        customer_name: { type: Type.STRING },
        phone: { type: Type.STRING },
        type: { type: Type.STRING, description: "e.g. 'Home delivery slot', 'Service visit'" },
        date: { type: Type.STRING, description: "YYYY-MM-DD" },
        time_window: { type: Type.STRING, description: "e.g. '18:00-21:00'" },
      },
      required: ["customer_name", "phone", "type", "date", "time_window"],
    },
  },
  {
    name: "search_knowledge",
    description:
      "Search the company knowledge base for policies, fares, timings, processes. Use when asked something factual you were not told in your instructions.",
    parameters: {
      type: Type.OBJECT,
      properties: { query: { type: Type.STRING } },
      required: ["query"],
    },
  },
  {
    name: "transfer_to_human",
    description:
      "Warm-transfer the caller to a human. Call this only after you have a transfer target from your instructions or after the caller asked for a person. Never invent a phone number.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        reason: { type: Type.STRING, description: "Why the transfer is needed" },
        target_name: {
          type: Type.STRING,
          description: "Name of the person or desk from the transfer list, if the caller asked for someone specific",
        },
      },
      required: ["reason"],
    },
  },
  {
    name: "transfer_to_agent",
    description:
      "Hand the caller to another AI agent on this workspace that specialises in what they need (listed under OTHER AGENTS in your instructions). Announce the transfer in one short line first, then call this. The other agent has its own knowledge base.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        agent_name: { type: Type.STRING, description: "Name of the target agent from OTHER AGENTS" },
        reason: { type: Type.STRING, description: "What the caller needs, in one line, so the next agent has context" },
      },
      required: ["agent_name", "reason"],
    },
  },
  {
    name: "end_call",
    description:
      "End the call. Use when the caller's need is fully handled and they have nothing else, when they say goodbye, or when they ask to hang up. Say one short goodbye BEFORE calling this; after it the line closes.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        reason: { type: Type.STRING, description: "Why the call is ending, e.g. 'resolved', 'caller said goodbye'" },
      },
      required: ["reason"],
    },
  },
];

export const SETUP_TOOL_DECLARATIONS: FunctionDeclaration[] = [
  {
    name: "note_setup_answer",
    description: "Save a fact you just learned from the business owner while designing their agents.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        topic: { type: Type.STRING, description: "e.g. business_type, hours, treatments, departments, escalation" },
        answer: { type: Type.STRING },
      },
      required: ["topic", "answer"],
    },
  },
  {
    name: "apply_setup_plan",
    description: "Create the agreed agents, departments, knowledge and transfers. Call only after they said yes.",
    parameters: { type: Type.OBJECT, properties: {} },
  },
];

export type LiveSessionOptions = {
  systemInstruction: string;
  voice?: string;
  extraTools?: FunctionDeclaration[];
  /**
   * Handle from a previous connection's `sessionResumptionUpdate`. Passing it
   * makes the server restore that conversation's context instead of starting
   * cold.
   *
   * This is set server-side, inside the token constraints, rather than by the
   * client at connect time. Tokens are single-use, so resuming needs a fresh
   * token anyway, and a constrained token rejects a client config that differs
   * from what it was minted with. Minting the handle in is the only path that
   * satisfies both.
   */
  resumeHandle?: string;
};

/**
 * The session config.
 *
 * The return type is annotated rather than inferred, and that is load-bearing:
 * TypeScript only rejects unknown properties on a *fresh* object literal, so an
 * inferred return lets a misspelled or misplaced field pass the build and get
 * dropped on the wire. That is how a top-level `thinkingLevel` sat here looking
 * correct while the model ran at its default.
 */
export function buildLiveConfig({
  systemInstruction,
  voice = DEFAULT_VOICE,
  resumeHandle,
  extraTools,
}: LiveSessionOptions): LiveConnectConfig {
  return {
    responseModalities: [Modality.AUDIO],
    speechConfig: {
      voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } },
    },
    systemInstruction: { parts: [{ text: systemInstruction }] },
    inputAudioTranscription: {},
    outputAudioTranscription: {},
    realtimeInputConfig: { automaticActivityDetection: VAD_CONFIG },
    tools: [{ functionDeclarations: [...TOOL_DECLARATIONS, ...(extraTools ?? [])] }],
    contextWindowCompression: COMPRESSION_CONFIG,
    thinkingConfig: THINKING_CONFIG,
    sessionResumption: resumeHandle ? { handle: resumeHandle } : {},
  };
}

/**
 * Native-audio models pick their own language from what they hear and reject an
 * explicit language code, so multilingual behaviour is prompt-level, not
 * config-level. This is appended to every agent's instruction.
 */
export function languageDirective(_languages?: string[]) {
  // Language is detected from the caller's speech. Asking "Hindi or English?"
  // is a hold-menu behaviour and the thing Indian callers hang up on.
  return [
    "\n\nLANGUAGE",
    "Never ask which language they prefer. Detect it from the first words you hear and answer in that language — Hindi, English, Hinglish, Tamil, Telugu, Kannada, Malayalam, Marathi, Bengali, Gujarati, Punjabi or Odia.",
    "If they switch mid-sentence, switch with them in the same turn. Match script and register: Hinglish stays Hinglish, not formal Hindi.",
    "Never announce that you are switching. Just switch.",
    "Your opening line may be bilingual (Namaste / hello) so either kind of caller feels addressed; after that, follow them.",
  ].join(" ");
}
