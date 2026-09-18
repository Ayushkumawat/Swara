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
        kind: {
          type: Type.STRING,
          enum: ["enquiry", "complaint", "grievance"],
          description: "enquiry = a question that needs a ticket; complaint = a problem; grievance = a formal/escalated complaint",
        },
        severity: { type: Type.STRING, enum: ["low", "medium", "high", "critical"] },
      },
      required: ["customer_name", "phone", "title", "description", "category", "severity"],
    },
  },
  {
    name: "lookup_ticket",
    description:
      "Look up an existing ticket (enquiry, complaint or grievance) by reference number and the name it was registered under. Call this whenever a caller asks for status or quotes a number like #48213.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        reference_number: { type: Type.STRING, description: "The ticket number, with or without #" },
        customer_name: { type: Type.STRING, description: "Name the ticket was registered with" },
        phone: { type: Type.STRING, description: "Registered mobile, if they do not have the number" },
      },
    },
  },
  {
    name: "notify_stakeholder",
    description:
      "Email, WhatsApp or call the department or person who owns this ticket, with the details just collected. Use after filing when the caller needs that desk informed now.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        reference_number: { type: Type.STRING },
        channel: { type: Type.STRING, enum: ["email", "whatsapp", "sms", "call"] },
        target_name: { type: Type.STRING, description: "Desk or department name from TRANSFER TARGETS / DEPARTMENTS" },
        message: { type: Type.STRING, description: "Short brief to send them" },
      },
      required: ["reference_number", "channel"],
    },
  },
  {
    name: "resolve_ticket",
    description:
      "Mark a ticket done. Use when a registered department or desk calls or writes back confirming they have handled it. Never mark done just because the original caller hangs up.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        reference_number: { type: Type.STRING },
        note: { type: Type.STRING, description: "What the desk confirmed" },
      },
      required: ["reference_number"],
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
    name: "handoff_to_agent",
    description:
      "Pass the caller to another of this business's agents that owns the topic (for example refunds, sales, bookings). Only use an agent named in your AGENT DIRECTORY. Say one sentence to the caller first, then call this. The other agent continues the call with your summary.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        agent_name: { type: Type.STRING, description: "Exact agent name from the AGENT DIRECTORY" },
        summary: {
          type: Type.STRING,
          description: "Two lines: who the caller is, what they need, anything already collected (name, phone, order id)",
        },
      },
      required: ["agent_name", "summary"],
    },
  },
  {
    name: "end_call",
    description:
      "Hang up. Call this ONLY after you have said your closing line and the caller has nothing more. Never call it mid-task.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        outcome: {
          type: Type.STRING,
          enum: ["resolved", "escalated", "callback", "no_answer", "declined"],
          description: "How the call ended from the business's point of view",
        },
      },
      required: ["outcome"],
    },
  },
];

/**
 * Tools only the Swara setup assistant carries. They write workspace rows —
 * departments, transfer desks, appointment types, knowledge, the agent plan —
 * so a business can be configured by talking rather than by filling forms.
 */
export const SETUP_TOOL_DECLARATIONS: FunctionDeclaration[] = [
  {
    name: "get_setup_status",
    description: "Read what the workspace already has configured, so you never ask for something that exists.",
    parameters: { type: Type.OBJECT, properties: {} },
  },
  {
    name: "save_playbook",
    description: "Save what the business does, its hours, its use case, and its policies. Call as soon as you learn each fact; partial saves are fine.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        business_type: { type: Type.STRING, description: "One line: what they do and for whom" },
        use_case: {
          type: Type.STRING,
          enum: ["clinic", "ecommerce", "customer_care", "sales", "civic", "hospitality", "education", "other"],
        },
        hours: { type: Type.STRING },
        has_sales: { type: Type.BOOLEAN, description: "Do they also want outbound sales / lead follow-up?" },
        human_escalation: { type: Type.BOOLEAN, description: "Is there any human a call can be transferred to?" },
        transfer_policy: { type: Type.STRING, description: "When to transfer, in one or two sentences" },
        booking_policy: { type: Type.STRING },
        complaint_sla_hours: { type: Type.NUMBER },
      },
    },
  },
  {
    name: "add_department",
    description: "Create a department that will own follow-up work. Include the words a caller would use so complaints route to it.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        name: { type: Type.STRING },
        keywords: { type: Type.ARRAY, items: { type: Type.STRING } },
      },
      required: ["name"],
    },
  },
  {
    name: "add_transfer_target",
    description: "Add a human the agents may transfer to. Needs a real phone number — ask for it and read it back.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        name: { type: Type.STRING },
        role: { type: Type.STRING },
        phone: { type: Type.STRING, description: "E.164 or 10-digit Indian mobile" },
        hours: { type: Type.STRING },
        when_to_use: { type: Type.STRING },
        department: { type: Type.STRING, description: "Department name, if it belongs to one" },
      },
      required: ["name", "role", "phone", "when_to_use"],
    },
  },
  {
    name: "add_appointment_type",
    description: "Add something that can be booked: a consultation, a delivery slot, a demo.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        name: { type: Type.STRING },
        duration_min: { type: Type.NUMBER },
        hours: { type: Type.STRING },
        location: { type: Type.STRING },
        notes: { type: Type.STRING },
      },
      required: ["name", "duration_min"],
    },
  },
  {
    name: "add_knowledge",
    description: "Save a policy, price list, FAQ or process the agents must quote from instead of guessing. Write it out fully in `text`.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        name: { type: Type.STRING },
        text: { type: Type.STRING, description: "At least a paragraph, in the business's own terms" },
      },
      required: ["name", "text"],
    },
  },
  {
    name: "propose_agents",
    description:
      "Once you understand the use case, propose the set of agents that covers it end to end. Each agent gets a name, a job, direction, and which other agents it hands off to. The console shows this plan for approval and builds the flows.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        brief: { type: Type.STRING, description: "The business and what the agents must handle, in your words" },
        agents: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              name: { type: Type.STRING },
              job: { type: Type.STRING, description: "What this agent does on a call, in 2-3 sentences" },
              intent: {
                type: Type.STRING,
                enum: ["order_status", "delivery_reschedule", "complaint", "sales_enquiry", "booking", "payment_reminder", "feedback", "other"],
              },
              direction: { type: Type.STRING, enum: ["inbound", "outbound", "both"] },
              hands_off_to: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Names of other agents in this plan" },
              is_front_door: { type: Type.BOOLEAN, description: "Answers the main number and routes" },
            },
            required: ["name", "job", "intent", "direction"],
          },
        },
      },
      required: ["brief", "agents"],
    },
  },
];

export type LiveSessionOptions = {
  systemInstruction: string;
  voice?: string;
  /** Extra tools for this session (the setup assistant's writers). */
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
  extraTools = [],
}: LiveSessionOptions): LiveConnectConfig {
  return {
    responseModalities: [Modality.AUDIO],
    speechConfig: {
      voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } },
    },
    systemInstruction: { parts: [{ text: systemInstruction }] },
    // Both directions: the caller transcript drives QA scoring and the
    // complaint audit trail, the agent transcript is what supervisors read
    // when they take over a call mid-conversation.
    inputAudioTranscription: {},
    outputAudioTranscription: {},
    realtimeInputConfig: { automaticActivityDetection: VAD_CONFIG },
    tools: [{ functionDeclarations: [...TOOL_DECLARATIONS, ...extraTools] }],
    contextWindowCompression: COMPRESSION_CONFIG,
    thinkingConfig: THINKING_CONFIG,
    // Always on. An empty object is the "enabled" signal, which asks the
    // server to start issuing handles; a handle present means "restore that
    // conversation". Enabling it costs nothing when unused, and the 10-minute
    // connection ceiling means any call worth having outlives one socket.
    sessionResumption: resumeHandle ? { handle: resumeHandle } : {},
  };
}

/**
 * Native-audio models pick their own language from what they hear and reject an
 * explicit language code, so multilingual behaviour is prompt-level, not
 * config-level. This is appended to every agent's instruction.
 */
export function languageDirective() {
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
