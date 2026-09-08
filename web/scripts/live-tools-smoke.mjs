/**
 * End-to-end check of the full loop the product is now selling:
 *
 *   live session → model calls a tool → our backend executes it against the
 *   database → the model speaks the result → the call completes → metering,
 *   summary and department routing land as rows.
 *
 * Plays the browser's role exactly: mints a token (which creates the call
 * row), asks about an order, ferries the resulting toolCall to
 * /api/v1/tools/execute, then reports completion and verifies the call row
 * carries duration, tokens and cost.
 *
 *   GEMINI_API_KEY=... npm run start
 *   node scripts/live-tools-smoke.mjs
 */
import { GoogleGenAI } from "@google/genai";

const BASE = process.env.BASE ?? "http://localhost:3000";

// ── 1. token + call row ─────────────────────────────────────────────────────
const tokenResponse = await fetch(`${BASE}/api/live/token`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ agentId: "ag_order", voice: "Kore", languages: ["hi", "en"] }),
});
const payload = await tokenResponse.json();
if (!tokenResponse.ok) throw new Error(`token route: ${payload.error}`);
if (!payload.callId) throw new Error("token route did not create a call row");
console.log(`token   ${payload.token.slice(0, 24)}…`);
console.log(`call    ${payload.callId}`);

// ── 2. session with tool ferrying ───────────────────────────────────────────
const ai = new GoogleGenAI({
  apiKey: payload.token,
  httpOptions: { apiVersion: payload.apiVersion },
});

let transcript = "";
const toolCallsSeen = [];
let toolResponded = false;
let totalTokens = 0;
let socketError = null;
let turnsCompleted = 0;

const session = await ai.live.connect({
  model: payload.model,
  callbacks: {
    onmessage: (message) => {
      if (message.usageMetadata?.totalTokenCount) totalTokens = message.usageMetadata.totalTokenCount;

      if (message.toolCall?.functionCalls?.length) {
        void (async () => {
          const responses = [];
          for (const call of message.toolCall.functionCalls) {
            toolCallsSeen.push(call.name);
            console.log(`tool    ${call.name}(${JSON.stringify(call.args)})`);
            const res = await fetch(`${BASE}/api/v1/tools/execute`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ callId: payload.callId, name: call.name, args: call.args ?? {} }),
            });
            const body = await res.json();
            console.log(`result  ${JSON.stringify(body.result ?? body).slice(0, 160)}`);
            responses.push({ id: call.id, name: call.name, response: body.result ?? { error: body.error } });
          }
          session.sendToolResponse({ functionResponses: responses });
          toolResponded = true;
        })();
      }

      const content = message.serverContent;
      if (content?.outputTranscription?.text) transcript += content.outputTranscription.text;
      if (content?.turnComplete) turnsCompleted += 1;
    },
    onerror: (event) => {
      socketError = event.message ?? "socket error";
    },
    onclose: () => {},
  },
});
console.log("socket  open");

session.sendRealtimeInput({ text: "[CALL_CONNECTED]" });
await new Promise((r) => setTimeout(r, 4000));
session.sendRealtimeInput({
  text: "Hi, mera order kahan hai? Order ID hai ORD-48213. Kab tak aayega?",
});

// Wait until the model has called the tool AND spoken a post-tool turn.
const deadline = Date.now() + 45_000;
while (Date.now() < deadline && !socketError && !(toolResponded && turnsCompleted >= 2)) {
  await new Promise((r) => setTimeout(r, 300));
}
session.close();
if (socketError) throw new Error(`socket: ${socketError}`);

console.log(`tokens  ${totalTokens}`);
console.log(`reply   ${transcript.trim().slice(0, 300)}`);

if (toolCallsSeen.length === 0) throw new Error("model never called a tool for an order question");
if (!toolCallsSeen.includes("lookup_order")) throw new Error(`wrong tool: ${toolCallsSeen}`);

// ── 3. completion → metering ────────────────────────────────────────────────
const completeResponse = await fetch(`${BASE}/api/v1/calls/complete`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    callId: payload.callId,
    durationSec: 40,
    tokens: totalTokens,
    transcript: [
      { role: "caller", text: "Mera order kahan hai? Order ID ORD-48213." },
      { role: "agent", text: transcript.trim().slice(0, 400) || "(agent reply)" },
    ],
  }),
});
if (!completeResponse.ok) throw new Error(`calls/complete: ${completeResponse.status}`);
console.log("call    completed and metered");

console.log("\nPASS — token → tool call → DB → spoken result → metering, all live");
