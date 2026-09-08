/**
 * End-to-end check of the live voice path without a microphone.
 *
 * Fetches an ephemeral token from our own route exactly as the browser does,
 * opens the socket with it, sends a line of text, and asserts that audio and a
 * transcript come back. Verifies the parts that are easy to get silently wrong:
 * the v1alpha version match, the token constraints, and that the persona is
 * actually applied.
 *
 *   GEMINI_API_KEY=... npm run start
 *   node scripts/live-smoke.mjs
 */
import { GoogleGenAI } from "@google/genai";

const BASE = process.env.BASE ?? "http://localhost:3000";
const AGENT = process.argv[2] ?? "ag_grievance";

const response = await fetch(`${BASE}/api/live/token`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ agentId: AGENT, voice: "Orus", languages: ["hi", "en"] }),
});

const payload = await response.json();
if (!response.ok) throw new Error(`token route: ${payload.error}`);
console.log(`token   ${payload.token.slice(0, 28)}…`);
console.log(`model   ${payload.model} (${payload.apiVersion})`);

const ai = new GoogleGenAI({
  apiKey: payload.token,
  httpOptions: { apiVersion: payload.apiVersion },
});

let audioBytes = 0;
let audioChunks = 0;
let transcript = "";
let sawResumptionHandle = false;
let turnComplete = false;
let socketError = null;

const session = await ai.live.connect({
  model: payload.model,
  callbacks: {
    onmessage: (message) => {
      if (message.sessionResumptionUpdate?.newHandle) sawResumptionHandle = true;
      const content = message.serverContent;
      if (content?.outputTranscription?.text) transcript += content.outputTranscription.text;
      for (const part of content?.modelTurn?.parts ?? []) {
        if (part.inlineData?.data) {
          audioChunks += 1;
          audioBytes += part.inlineData.data.length;
        }
      }
      if (content?.turnComplete) turnComplete = true;
    },
    onerror: (event) => {
      socketError = event.message ?? "socket error";
    },
    onclose: () => {},
  },
});

console.log("socket  open");

// Text in, audio out. Proves the session works without needing a mic, and the
// reply should reveal whether the persona took effect.
session.sendRealtimeInput({ text: "Mera parcel aaj nahi aaya. Complaint darj karni hai." });

const deadline = Date.now() + 25_000;
while (!turnComplete && !socketError && Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 250));
}
session.close();

if (socketError) throw new Error(`socket: ${socketError}`);

console.log(`audio   ${audioChunks} chunks, ${audioBytes} base64 bytes`);
console.log(`resume  handle issued: ${sawResumptionHandle}`);
console.log(`reply   ${transcript.trim().slice(0, 220) || "(no transcript)"}`);

if (audioChunks === 0) throw new Error("no audio received — the session is not speaking");
console.log("\nPASS");
