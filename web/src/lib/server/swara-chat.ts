import "server-only";
import { GoogleGenAI, type Content, type Part } from "@google/genai";
import { AgentPlanSchema, type AgentPlan } from "@/lib/api/schemas";
import { SWARA_SYSTEM_PROMPT, SWARA_TOOL_RULES } from "@/lib/agents/swara";
import { SETUP_TOOL_DECLARATIONS } from "@/lib/live/config";
import { TEXT_MODELS } from "./models";
import { executeTool } from "./tools";

/**
 * Dashboard Swara. Same tools as the old voice setup session, but a stable
 * text model — planning and workspace edits do not need a Live audio socket.
 */

const SYSTEM = [
  SWARA_SYSTEM_PROMPT,
  SWARA_TOOL_RULES,
  "If a tool returns an error, say so and ask the owner to retry. Do not invent departments, numbers, policies, or a replacement set of agents.",
].join("\n\n");

export type SwaraTurn = { role: "user" | "model"; text: string };

export async function runSwaraChat(orgId: string, messages: SwaraTurn[]) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("Swara needs a Gemini API key. Nothing in the workspace was changed.");
  }
  const ai = new GoogleGenAI({ apiKey });
  let last = "model unavailable";
  for (const model of TEXT_MODELS) {
    try {
      return await chatOnce(ai, model, orgId, messages);
    } catch (error) {
      last = String(error).slice(0, 240);
      console.error(`[swara-chat] ${model} failed:`, last);
    }
  }
  throw new Error("Swara's model is unavailable right now. Your workspace is unchanged — retry.");
}

async function chatOnce(ai: GoogleGenAI, model: string, orgId: string, messages: SwaraTurn[]) {
  const contents: Content[] = messages
    .filter((m) => m.text.trim())
    .map((m) => ({ role: m.role, parts: [{ text: m.text }] }));

  const tools: { name: string; result: Record<string, unknown> }[] = [];
  let plan: AgentPlan | null = null;

  for (let step = 0; step < 8; step++) {
    const response = await ai.models.generateContent({
      model,
      contents,
      config: {
        systemInstruction: SYSTEM,
        tools: [{ functionDeclarations: SETUP_TOOL_DECLARATIONS }],
        temperature: 0.4,
      },
    });

    const calls = response.functionCalls ?? [];
    if (calls.length === 0) {
      const reply = (response.text ?? "").trim();
      if (!reply) throw new Error("empty reply");
      return { reply, tools, plan, model };
    }

    const modelContent = response.candidates?.[0]?.content;
    if (modelContent) contents.push(modelContent);

    const parts: Part[] = [];
    for (const call of calls) {
      const name = call.name ?? "";
      const args = (call.args ?? {}) as Record<string, unknown>;
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
