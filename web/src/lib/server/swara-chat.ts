import "server-only";
import { GoogleGenAI, Type, type Content, type Part } from "@google/genai";
import { AgentPlanSchema, type AgentPlan, type SwaraQuestion } from "@/lib/api/schemas";
import { SWARA_SYSTEM_PROMPT, SWARA_TOOL_RULES } from "@/lib/agents/swara";
import { ASK_OWNER_DECLARATION, SETUP_TOOL_DECLARATIONS } from "@/lib/live/config";
import { geminiKeyError, TEXT_MODELS } from "./models";
import { executeTool, setupSnapshot } from "./tools";

/**
 * Dashboard Swara. Same tools as the old voice setup session, but a stable
 * text model — planning and workspace edits do not need a Live audio socket.
 */

// Her spoken persona opens in Hinglish. In a typed chat that line outweighs
// "mirror the owner's language" and she answers English in Hinglish, so here
// the owner's own typing decides and the feminine forms apply only in Hindi.
const TYPED_PERSONA = SWARA_SYSTEM_PROMPT.replace(
  'Speak as a woman in Hindi/Hinglish ("main samajh gayi", "karti hoon").',
  'Write in the language of the owner\'s latest message: English to English, Hindi to Hindi, Hinglish to Hinglish. When you write Hindi or Hinglish, use a woman\'s verb forms ("main samajh gayi", "karti hoon").',
);

const SYSTEM = [
  TYPED_PERSONA,
  SWARA_TOOL_RULES,
  "If a tool returns an error, say so and ask the owner to retry. Do not invent departments, numbers, policies, or a replacement set of agents.",
  // Typed chat only: there is a screen, so questions can be cards.
  [
    "ASKING QUESTIONS ON SCREEN",
    "This is a typed chat with a screen. Whenever you need more than one fact from the owner, or one fact with obvious choices, call ask_owner instead of writing the questions out: each question becomes a card with its own answer box and suggested answers to tap, and the owner can skip any of them.",
    "Up to four questions at a time, the ones that matter most first. Give two to four suggestions wherever there are natural choices (how someone wants to be reached, what happens after hours, live or after the call); none for names, numbers and addresses.",
    "After ask_owner, write one short line — what you have understood so far, or why you are asking — and stop. Do not repeat the questions in your reply.",
    "The owner's answers come back as lines of 'Q: … / A: …'. A question that is missing was skipped: carry on with a sensible default, say which default you used, and do not ask it again unless it blocks you.",
    "A single open question with no natural choices can just be asked in your reply.",
  ].join("\n"),
  "LANGUAGE IN THIS CHAT\nEvery line you write, and every question and suggestion you put on a card, is in the language the owner's latest message is written in. An English message gets an English reply — no Hindi or Hinglish words in it.",
].join("\n\n");

const CHAT_TOOLS = [...SETUP_TOOL_DECLARATIONS, ASK_OWNER_DECLARATION];

export type SwaraTurn = { role: "user" | "model"; text: string };

/** Where the owner is in the console, so "this agent" means something. */
export type SwaraContext = { agentId?: string; agentName?: string; page?: string };

export async function runSwaraChat(orgId: string, messages: SwaraTurn[], context: SwaraContext = {}) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("Swara needs a Gemini API key. Nothing in the workspace was changed.");
  }
  const ai = new GoogleGenAI({ apiKey });
  let last = "model unavailable";
  for (const model of TEXT_MODELS) {
    try {
      return await chatOnce(ai, model, orgId, messages, context);
    } catch (error) {
      last = String(error).slice(0, 240);
      console.error(`[swara-chat] ${model} failed:`, last);
      const keyError = geminiKeyError(error);
      if (keyError) throw new Error(keyError);
    }
  }
  throw new Error("Swara's model is unavailable right now. Your workspace is unchanged — retry.");
}

function contextBlock(context: SwaraContext) {
  const lines: string[] = [];
  if (context.agentName || context.agentId) {
    lines.push(
      `The owner currently has the agent "${context.agentName ?? context.agentId}"${context.agentId ? ` (id ${context.agentId})` : ""} open. "This agent", "it", "her" mean that one unless they name another.`,
    );
  }
  if (context.page) lines.push(`They are on the ${context.page} screen.`);
  return lines.length ? `WHERE THE OWNER IS\n${lines.join("\n")}` : "";
}

/**
 * The workspace as it stands at the start of this turn. Owners should not
 * be asked twice for what they already entered — in Setup, or earlier in
 * this conversation.
 */
function alreadySetUp(orgId: string) {
  try {
    return [
      "ALREADY SET UP (read before asking anything)",
      JSON.stringify(setupSnapshot(orgId)),
      "Never ask for something listed here — people and how they are reached, teams, hours, appointment types, what the agents do. Use it, and say you are using it ('I'll use Asha as the person to reach'). Ask only for what is missing and needed. This is the state at the start of this message; after you change something, trust your tool results.",
    ].join("\n");
  } catch {
    return "";
  }
}

async function chatOnce(ai: GoogleGenAI, model: string, orgId: string, messages: SwaraTurn[], context: SwaraContext) {
  const contents: Content[] = messages
    .filter((m) => m.text.trim())
    .map((m) => ({ role: m.role, parts: [{ text: m.text }] }));

  const tools: { name: string; result: Record<string, unknown> }[] = [];
  let plan: AgentPlan | null = null;
  let questions: SwaraQuestion[] = [];
  const systemInstruction = [SYSTEM, contextBlock(context), alreadySetUp(orgId)].filter(Boolean).join("\n\n");

  for (let step = 0; step < 8; step++) {
    const response = await ai.models.generateContent({
      model,
      contents,
      config: {
        systemInstruction,
        tools: [{ functionDeclarations: CHAT_TOOLS }],
        temperature: 0.4,
      },
    });

    const calls = response.functionCalls ?? [];
    if (calls.length === 0) {
      let reply = (response.text ?? "").trim() || (questions.length ? "A few quick questions — answer what you can and skip the rest." : "");
      if (!reply) throw new Error("empty reply");
      // She asked in prose instead of calling ask_owner (the smaller model
      // does this). The owner still gets cards: lift the questions out.
      if (!questions.length && !plan && reply.includes("?")) {
        const lifted = await cardsFromReply(ai, model, reply);
        if (lifted) {
          questions = lifted.questions;
          reply = lifted.lead;
        }
      }
      return { reply, tools, plan, questions, model };
    }

    const modelContent = response.candidates?.[0]?.content;
    if (modelContent) contents.push(modelContent);

    const parts: Part[] = [];
    for (const call of calls) {
      const name = call.name ?? "";
      const args = (call.args ?? {}) as Record<string, unknown>;
      // Cards are drawn by the console, not written to the workspace.
      if (name === "ask_owner") {
        questions = readQuestions(args.questions);
        parts.push({
          functionResponse: {
            name,
            response: questions.length
              ? { shown: true, note: "The cards are on screen. Write one short line and stop; do not repeat the questions." }
              : { shown: false, note: "No questions were given. Ask in your reply instead." },
          },
        });
        continue;
      }
      const raw = await executeTool(orgId, null, name, args);
      if (name === "propose_agents" && raw.__plan) {
        const parsed = AgentPlanSchema.safeParse(raw.__plan);
        if (parsed.success) plan = parsed.data;
      }
      const { __plan: _drop, ...visible } = raw;
      void _drop;
      tools.push({ name, result: visible });
      parts.push({ functionResponse: { name, response: visible } });
    }
    contents.push({ role: "user", parts });
  }

  throw new Error("too many tool steps");
}

/**
 * Turn questions written into a reply into cards. One short structured
 * call, given a few seconds; if it fails or finds nothing, the reply is
 * shown exactly as she wrote it — the owner can always just type.
 */
async function cardsFromReply(ai: GoogleGenAI, model: string, reply: string) {
  try {
    const response = await ai.models.generateContent({
      model,
      contents: [
        {
          role: "user",
          parts: [
            {
              text: [
                "Below is a message a setup assistant wrote to a business owner in a chat. Split it into what she said and what she asked.",
                "- questions: each thing she asks the owner, as one plain question, in the same language and words as the message. At most four. If she asks nothing (a rhetorical question, or only an offer like 'anything else?'), return an empty list.",
                "- suggestions: for each question, two to four short answers the owner could tap, written the way the owner would say them. Use the choices the message itself offers first. Leave empty when the answer is a name, a number, an address or free description.",
                "- lead: the message with the questions taken out — what she understood or did, in her own words and language. Do not add anything she did not say. Empty if nothing is left.",
                "",
                "MESSAGE:",
                reply,
              ].join("\n"),
            },
          ],
        },
      ],
      config: {
        temperature: 0,
        abortSignal: AbortSignal.timeout(12_000),
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            lead: { type: Type.STRING },
            questions: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  question: { type: Type.STRING },
                  suggestions: { type: Type.ARRAY, items: { type: Type.STRING } },
                },
                required: ["question", "suggestions"],
              },
            },
          },
          required: ["lead", "questions"],
        },
      },
    });
    const parsed = JSON.parse(response.text ?? "{}") as { lead?: unknown; questions?: unknown };
    const questions = readQuestions(parsed.questions);
    if (!questions.length) return null;
    const lead = typeof parsed.lead === "string" ? parsed.lead.trim() : "";
    return { questions, lead: lead || "A quick question — tap an answer or type your own." };
  } catch (error) {
    console.error("[swara-chat] could not turn questions into cards:", String(error).slice(0, 200));
    return null;
  }
}

function readQuestions(raw: unknown): SwaraQuestion[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: SwaraQuestion[] = [];
  for (const item of raw) {
    const q = item as { question?: unknown; suggestions?: unknown };
    const question = typeof q?.question === "string" ? q.question.trim() : "";
    if (!question || seen.has(question.toLowerCase())) continue;
    seen.add(question.toLowerCase());
    const suggestions = Array.isArray(q.suggestions)
      ? [...new Set(q.suggestions.map((s) => String(s).trim()).filter(Boolean))].slice(0, 4)
      : [];
    out.push({ question: question.slice(0, 240), suggestions: suggestions.map((s) => s.slice(0, 80)) });
    if (out.length === 4) break;
  }
  return out;
}
