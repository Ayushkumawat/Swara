/**
 * Asserts the agent speaks first.
 *
 * Connects and sends nothing but the [CALL_CONNECTED] marker, exactly as the
 * browser client does, then waits. Any audio at all means the greeting fired;
 * silence means a real caller would hear a dead line and hang up.
 *
 *   GEMINI_API_KEY=... npm run start
 *   node scripts/live-greeting-smoke.mjs
 */
import { GoogleGenAI } from "@google/genai";

const BASE = process.env.BASE ?? "http://localhost:3000";
const AGENT = process.argv[2] ?? "ag_grievance";

const response = await fetch(`${BASE}/api/live/token`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ agentId: AGENT, voice: "Orus" }),
});
const payload = await response.json();
if (!response.ok) throw new Error(payload.error);

const ai = new GoogleGenAI({
  apiKey: payload.token,
  httpOptions: { apiVersion: payload.apiVersion },
});

let transcript = "";
let audioChunks = 0;
let firstAudioAt = null;
const openedAt = Date.now();

const session = await ai.live.connect({
  model: payload.model,
  callbacks: {
    onmessage: (message) => {
      const content = message.serverContent;
      if (content?.outputTranscription?.text) transcript += content.outputTranscription.text;
      for (const part of content?.modelTurn?.parts ?? []) {
        if (part.inlineData?.data) {
          audioChunks += 1;
          firstAudioAt ??= Date.now();
        }
      }
    },
    onerror: (event) => {
      throw new Error(event.message ?? "socket error");
    },
    onclose: () => {},
  },
});

// The only thing sent. No caller audio, no caller text.
session.sendRealtimeInput({ text: "[CALL_CONNECTED]" });

await new Promise((r) => setTimeout(r, 12_000));
session.close();

console.log(`agent  ${payload.agent.name}`);
console.log(`audio  ${audioChunks} chunks`);
console.log(
  `first  ${firstAudioAt ? `${firstAudioAt - openedAt} ms after connect` : "never"}`,
);
console.log(`said   ${transcript.trim().slice(0, 200) || "(nothing)"}`);

if (audioChunks === 0) throw new Error("FAIL — agent stayed silent; a caller would hang up");
if (/CALL_CONNECTED/i.test(transcript)) throw new Error("FAIL — agent read the marker aloud");
console.log("\nPASS");
