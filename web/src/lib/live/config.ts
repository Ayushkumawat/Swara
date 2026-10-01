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
  Behavior,
  type FunctionDeclaration,
  FunctionResponseScheduling,
  type LiveConnectConfig,
  Modality,
  Type,
} from "@google/genai";
import { DEFAULT_VOICE, VOICE_CATALOG, type VoiceCatalogEntry } from "./voices";

export { DEFAULT_VOICE, VOICE_CATALOG };
export type { VoiceCatalogEntry };

/**
 * Native-audio dialogue model. Audio in, audio out, no cascade.
 *
 * 3.8 Live over 3.1 Flash Live, for a calling agent specifically:
 *  - function calls are asynchronous by default, so a lookup no longer
 *    freezes the conversation (see `ASYNC_TOOLS` below);
 *  - 128k context, so long grievance calls compress later and forget less;
 *  - proactive audio is always on: the model may choose not to answer audio
 *    that is not directed at it (TV in the background, a side conversation);
 *  - `thinking_level` and `enable_affective_dialog` are gone from the API —
 *    reasoning is interleaved, and tone adaptation is prompt-level.
 */
export const LIVE_MODEL = "gemini-3.8-live";

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
 *   response latency. Google's own guidance is 500–800 ms: below ~200 ms
 *   breathing pauses fragment the caller's sentence, above ~2 s the caller
 *   feels lag. 700 ms is where the agent still feels prompt but stops
 *   interrupting Hinglish code-switchers.
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

/** How long a minted token stays valid, and how long the holder has to open a
 *  session with it. Short windows are the entire point of ephemeral tokens. */
export const TOKEN_TTL_MS = 30 * 60 * 1000;
export const TOKEN_SESSION_START_TTL_MS = 2 * 60 * 1000;

/**
 * Tools that run in the background while the agent keeps talking.
 *
 * On 3.1 every tool call blocked: the agent went silent until the order
 * system answered. On 3.8 a `NON_BLOCKING` declaration lets the model say
 * "ek second, dekhti hoon" and carry on; the result is folded in according
 * to the scheduling the client attaches to the response (`WHEN_IDLE` — wait
 * for the caller to stop talking, which is right for every lookup here).
 *
 * The three control tools stay blocking on purpose. `end_call` and
 * `handoff_to_agent` change what happens at the end of the turn, and
 * `transfer_to_human` dials a desk; none of them should be racing audio.
 */
export const ASYNC_TOOLS = new Set([
  "lookup_order",
  "register_complaint",
  "lookup_ticket",
  "notify_stakeholder",
  "resolve_ticket",
  "book_slot",
  "search_knowledge",
]);

/** Scheduling attached to a NON_BLOCKING tool's response. Ignored for the rest. */
export const ASYNC_TOOL_SCHEDULING = FunctionResponseScheduling.WHEN_IDLE;

export function isAsyncTool(name: string | undefined) {
  return name != null && ASYNC_TOOLS.has(name);
}

/**
 * Function declarations the model can call mid-conversation.
 *
 * Declarations live here — shared config, baked into the token constraints —
 * but execution is server-side only (`lib/server/tools.ts`). The model emits a
 * toolCall over the socket, the client ferries it to POST
 * /api/v1/tools/execute, and the JSON result goes back over the socket for the
 * model to speak from. The browser never resolves a tool itself: a tool
 * answered client-side would let anyone with devtools file complaints or read
 * orders as someone else.
 */
const DECLARATIONS: FunctionDeclaration[] = [
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
      "File a ticket for the caller's problem. You have NO reference number and nothing is registered until this returns registered:true — never say 'noted', 'registered' or any number before that. If it returns possible_duplicate, the caller already has an open ticket for something similar: read them its status, ask if this is the same issue, and call again with confirm_new:true only if they say it is different.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        customer_name: { type: Type.STRING },
        phone: { type: Type.STRING, description: "Leave empty to use the number they are calling from. Never send a masked or made-up number." },
        confirm_new: {
          type: Type.BOOLEAN,
          description: "true only after the caller confirmed this is a different issue from their existing open ticket",
        },
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
      "Look up the caller's tickets (enquiry, complaint or grievance). Call this whenever they ask for status, quote a number like #48213, or say they already complained. With no arguments it finds every ticket filed from the number they are calling on — so you never need to ask for a reference number first.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        reference_number: { type: Type.STRING, description: "The ticket number, with or without #, if they gave one" },
        customer_name: { type: Type.STRING, description: "Name the ticket was registered with, if they gave one" },
        phone: { type: Type.STRING, description: "Only if they are asking about a ticket filed from a different phone. Never send a masked number." },
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
      "Hang up. Call this ONLY after the caller has answered 'no' to 'anything else?' AND you have said your closing line. Never in the same turn as the 'anything else?' question — the caller has not answered yet. Never call it mid-task.",
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

export const TOOL_DECLARATIONS: FunctionDeclaration[] = DECLARATIONS.map((d) =>
  isAsyncTool(d.name) ? { ...d, behavior: Behavior.NON_BLOCKING } : d,
);

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
    description: "Save a policy, price list, FAQ or process one agent must quote from instead of guessing. Write it out fully in `text`, and set agent_name so only that agent searches it.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        name: { type: Type.STRING },
        text: { type: Type.STRING, description: "At least a paragraph, in the business's own terms" },
        agent_name: { type: Type.STRING, description: "Which agent may quote this. Omit only for a fact every agent shares." },
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
              persona_name: { type: Type.STRING, description: "The first name this agent uses on the call, if the owner chose one" },
              voice: {
                type: Type.STRING,
                description: `If the owner has a preference. One of: ${VOICE_CATALOG.map((v) => `${v.name} (${v.gender}, ${v.descriptor})`).join(", ")}`,
              },
            },
            required: ["name", "job", "intent", "direction"],
          },
        },
      },
      required: ["brief", "agents"],
    },
  },
  // ── Editing agents that already exist ────────────────────────────────────
  {
    name: "list_agents",
    description: "The agents this workspace already has: id, name, job, status, voice, persona name. Call before editing so you change the right one.",
    parameters: { type: Type.OBJECT, properties: {} },
  },
  {
    name: "get_agent",
    description: "Read one agent in full — its role text, tools, voice, persona name and flow steps — before proposing a change to it.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        agent: { type: Type.STRING, description: "Agent id or exact name" },
      },
      required: ["agent"],
    },
  },
  {
    name: "update_agent",
    description:
      "Change an existing agent. Send only the fields that change. For the role, send the complete new role text (read it with get_agent first, then rewrite with the owner's change folded in — keep it short and job-specific, use {name} where the agent says its own name). Takes effect on the next call.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        agent: { type: Type.STRING, description: "Agent id or exact name" },
        name: { type: Type.STRING, description: "New display name for the agent" },
        role: { type: Type.STRING, description: "Complete new role text" },
        persona_name: { type: Type.STRING, description: "First name it introduces itself with" },
        voice: {
          type: Type.STRING,
          description: `One of: ${VOICE_CATALOG.map((v) => `${v.name} (${v.gender})`).join(", ")}. Gender must match persona_name.`,
        },
        direction: { type: Type.STRING, enum: ["inbound", "outbound", "both"] },
        status: { type: Type.STRING, enum: ["draft", "testing", "live", "paused"] },
        add_tools: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Tool names to allow, e.g. book_slot, search_knowledge" },
        remove_tools: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Tool names to take away" },
      },
      required: ["agent"],
    },
  },
];

export type LiveSessionOptions = {
  systemInstruction: string;
  voice?: string;
  /** Extra tools for this session (the setup assistant's writers). */
  extraTools?: FunctionDeclaration[];
  /** When set, only these call tools are offered. Setup tools are still appended. */
  toolNames?: string[];
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
 * dropped on the wire. That is how a misplaced field once sat here looking
 * correct while the model ran at its default.
 */
export function buildLiveConfig({
  systemInstruction,
  voice = DEFAULT_VOICE,
  resumeHandle,
  extraTools = [],
  toolNames,
}: LiveSessionOptions): LiveConnectConfig {
  const callTools = toolNames
    ? TOOL_DECLARATIONS.filter((t) => t.name != null && toolNames.includes(t.name))
    : TOOL_DECLARATIONS;
  const declarations = [...callTools, ...extraTools];
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
    // A voice preview carries no tools at all; an empty declaration list is
    // not the same thing as no tools block.
    ...(declarations.length ? { tools: [{ functionDeclarations: declarations }] } : {}),
    contextWindowCompression: COMPRESSION_CONFIG,
    // No thinkingConfig: 3.8 Live removed `thinking_level` in favour of
    // interleaved reasoning, and sending it now fails the setup message.
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
    "\n\nLANGUAGE — this overrides whatever language you opened in.",
    "From the caller's first words, answer in the language they are using. If they switch mid-call — Hindi, English, Hinglish, Tamil, Telugu, Kannada, Malayalam, Marathi, Bengali, Gujarati, Punjabi or Odia — switch in that same turn.",
    "Do not keep a house language. Do not ask which language they prefer. Do not announce that you switched. Match their register: Hinglish stays Hinglish.",
  ].join(" ");
}
