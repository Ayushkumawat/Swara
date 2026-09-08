/**
 * Proves session resumption actually restores conversation context.
 *
 * Worth testing explicitly rather than trusting: the config is accepted and
 * handles are issued even when resumption does nothing, so the failure mode is
 * a cold session that looks like a warm one. The only real check is whether the
 * model still knows something it was told on the previous connection.
 *
 *   GEMINI_API_KEY=... npm run start
 *   node scripts/live-resume-smoke.mjs
 */
import { GoogleGenAI } from "@google/genai";

const BASE = process.env.BASE ?? "http://localhost:3000";
const SECRET = "Rohan Sharma";

async function mint(resumeHandle) {
  const response = await fetch(`${BASE}/api/live/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ agentId: "ag_grievance", voice: "Orus", resumeHandle }),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(`token route: ${payload.error}`);
  return payload;
}

/**
 * One connection, driven exactly as src/lib/live/session.ts drives it: the
 * connect marker first, then caller input. Sending the same markers matters —
 * they are what tells a resumed agent to continue rather than greet again.
 */
async function turn({ resumeHandle, text }) {
  const payload = await mint(resumeHandle);
  const ai = new GoogleGenAI({
    apiKey: payload.token,
    httpOptions: { apiVersion: payload.apiVersion },
  });

  let transcript = "";
  let handle = null;
  let done = false;
  let error = null;

  const session = await ai.live.connect({
    model: payload.model,
    callbacks: {
      onmessage: (message) => {
        if (message.sessionResumptionUpdate?.resumable && message.sessionResumptionUpdate.newHandle) {
          handle = message.sessionResumptionUpdate.newHandle;
        }
        const content = message.serverContent;
        if (content?.outputTranscription?.text) transcript += content.outputTranscription.text;
        if (content?.turnComplete) done = true;
      },
      onerror: (event) => {
        error = event.message ?? "socket error";
      },
      onclose: () => {},
    },
  });

  session.sendRealtimeInput({
    text: resumeHandle ? "[CALL_RECONNECTED]" : "[CALL_CONNECTED]",
  });
  session.sendRealtimeInput({ text });

  const deadline = Date.now() + 25_000;
  while (!done && !error && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 200));
  }
  // Handles keep arriving after turnComplete; give the last one a moment to
  // land or the reconnect below resumes from an older point.
  await new Promise((r) => setTimeout(r, 1500));
  session.close();

  if (error) throw new Error(`socket: ${error}`);
  return { transcript: transcript.trim(), handle };
}

console.log("connection 1 — establishing context");
const first = await turn({
  text: `Meri complaint darj karni hai. Mera naam ${SECRET} hai. Yaad rakhiye.`,
});
console.log(`  reply  ${first.transcript.slice(0, 140)}`);
console.log(`  handle ${first.handle ? `${first.handle.slice(0, 24)}…` : "NONE"}`);

if (!first.handle) throw new Error("no resumption handle issued — resumption is not enabled");

console.log("\nconnection 2 — new socket, resuming with the handle");
const second = await turn({
  resumeHandle: first.handle,
  text: "Mera naam kya tha? Sirf naam bataiye.",
});
console.log(`  reply  ${second.transcript.slice(0, 140)}`);

const remembered = new RegExp(SECRET.split(" ")[0], "i").test(second.transcript);
// A resumed agent that re-introduces itself tells the caller something broke,
// which is the whole thing resumption is supposed to hide.
const regreeted = /thank you for calling|kis tarah madad/i.test(second.transcript);

console.log(`\ncontext survived the reconnect: ${remembered}`);
console.log(`greeted again (should be false): ${regreeted}`);

if (!remembered) throw new Error("FAIL — the resumed session did not retain context");
if (regreeted) throw new Error("FAIL — the resumed session greeted the caller again");
console.log("PASS");
