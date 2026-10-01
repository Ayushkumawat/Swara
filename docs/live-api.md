# Speech-to-speech: how it works and what the model can do

The conversational layer is Gemini's Live API — one bidirectional WebSocket,
audio in and audio out, no separate speech-to-text or text-to-speech stage. That
single fact drives most of the design here: there is no transcript to inspect
between hearing and speaking, so tone, interruption and language switching are
the model's job rather than ours.

- Browser path: `web/src/lib/live/`, token route at `web/src/app/api/live/token/`
- Server path: `agent/live_session.py`, personas in `agent/prompts.py`

---

## Rotate the API key first

The prototype had a working key committed in `live audio.py`, so it is in git
history (commit `6e27025`). Deleting the line does not un-leak it.

1. Revoke it at [aistudio.google.com/apikey](https://aistudio.google.com/apikey)
2. Create a new one and put it in `web/.env.local` as `GEMINI_API_KEY`
3. Never let it reach the browser — see [Why ephemeral tokens](#why-ephemeral-tokens)

Rewriting history with `git filter-repo` is optional and does not help: assume
anything ever pushed is public.

---

## Two paths, because a phone call is not a browser tab

Both run the same model with the same config. They differ in who owns the
socket, and that is decided by where the audio comes from.

**Browser to Google directly** (`web/src/lib/live/`) is the lowest-latency
option for audio that starts in a browser, because it skips our server
entirely. Used for the in-app test bench and anything web- or app-originated.
Requires an ephemeral token, since the credential is visible to the client.

**Server to Google** (`agent/live_session.py`) is mandatory for real phone
calls. A customer dialling a number is not in a browser; their audio arrives
from the carrier over SIP at infrastructure we run, so the model socket has to
live next to the SIP leg. Proxying it out to a browser and back would add two
network hops to a medium where 200 ms is audible.

The practical consequence: **the browser path is a test bench, not the product**.
It proves the agent's behaviour — prompt, voice, languages, interruption
handling — before a phone number points at it.

### Every integration option, and why we picked these two

| Option | What it is | Verdict here |
|---|---|---|
| **GenAI SDK, server-side** | `google-genai` holds the socket in Python/Node | **Using it** for telephony. Also the only sane place for tools that touch our database. |
| **GenAI SDK, client-side** | Same SDK in the browser, ephemeral token | **Using it** for the test bench. Lowest latency for browser audio. |
| **Raw WebSocket** | Hand-rolled JSON against `BidiGenerateContent` | Rejected. Same wire protocol, but you reimplement setup messages, base64 framing and reconnect for no gain. Worth it only in a language with no SDK. |
| **Firebase AI Logic** | Live API via Firebase, with App Check | Rejected. Buys client-side key management we already solved with ephemeral tokens, and adds a Firebase dependency. Its docs are still the clearest reference on sessions. |
| **ADK (Agent Development Kit)** | Google's agent framework, Java/Python, with `adk web` | Rejected. Real value if you want its tool orchestration and session services, but it means a JVM service beside Next.js, and its dev UI explicitly is not for production. Revisit if agent logic outgrows a prompt. |
| **LiveKit / Pipecat / Agora / Voximplant** | Partner platforms carrying Live API over WebRTC or SIP | **Watch closely.** Voximplant and LiveKit already solve the SIP-to-Live bridge that is our largest remaining piece of work. Cheaper than building it; costs per-minute margin and a dependency on the thing that makes us a platform. |
| **Vertex / Agent Platform** | Same model via Google Cloud | Later. Gives 24-hour resumption windows instead of 2, mid-session system-instruction updates, and enterprise contracts. Costs GCP setup. Worth it when a regulated buyer asks. |

---

## Limits that shape the product

| Limit | Value | What it means |
|---|---|---|
| Context window | 128k tokens | Audio spends ~25 tokens/second, so ~15 minutes of unmanaged audio fills it |
| Single connection | ~10 minutes | Hard ceiling per socket, regardless of context |
| `goAway` warning | 60 seconds before close | Time to swap sockets before the drop |
| Resumption window | 2 hours (Gemini API) / 24 (Vertex) | How long the server keeps state after a disconnect |
| Audio in | 16 kHz mono PCM16 LE | Not negotiable |
| Audio out | 24 kHz mono PCM16 LE | Not negotiable, and different from the input rate |
| Languages | 97, incl. all major Indian ones | Native-audio models switch on their own |

Support and grievance calls routinely run past both the 15-minute context cap
and the 10-minute connection cap, so neither is optional to handle.

---

## Context window compression

Enabled with a sliding window, which makes session length effectively
unbounded. The server drops or summarises the oldest turns when the context
crosses a trigger. System instructions are never discarded, so the persona
survives.

```ts
contextWindowCompression: {
  triggerTokens: "32000",              // strings: int64 proto fields
  slidingWindow: { targetTokens: "16000" },
}
```

Defaults are 80% of the window as the trigger and half of that as the target.
We trigger much earlier, at 32k, because compression itself causes a latency
spike and it is better to pay it early in a call than while a caller is
mid-complaint.

The tradeoff sits in `targetTokens`: low frees more room for streaming but the
agent forgets earlier turns faster; close to `triggerTokens` preserves memory
but compresses far more often.

---

## Session resumption

Enabled by passing a resumption config at all; the server then periodically
sends handles. Reconnecting with the latest handle restores the conversation.

Three things it covers:

1. **The 10-minute ceiling.** On `goAway`, reconnect while the old socket still
   works, so the swap lands between turns instead of mid-word.
2. **Network drops.** WiFi to 5G, tower handoff — state is held ~10 minutes.
3. **Later resumption.** State survives a few hours (2 on the Gemini API).

Two implementation details that are easy to get wrong:

**Version.** Resumption is served on `v1alpha`. On `v1beta` the config is
accepted and handles simply never arrive, which looks like a broken feature
rather than a wrong endpoint.

**Tokens are single-use.** A resumed browser connection needs a *new* token, and
a constrained token rejects a client config that differs from what it was minted
with. So the handle is sent to our own token route and minted into the
constraints server-side, never passed by the client at connect time.

**Only keep the latest handle.** Older ones resume to a staler point.

Verified end to end by `npm run live:smoke:resume`, which establishes a fact on
one socket, reconnects on another, and asserts the model still knows it.

---

## The agent has to speak first

The model waits to be spoken to. On a phone call that is silence after pickup,
which is how callers decide the line is dead.

Handled with a marker: on connect the client sends `[CALL_CONNECTED]` as
realtime text, and every persona is instructed to deliver its opening line
immediately and never read the marker aloud. A resumed connection sends
`[CALL_RECONNECTED]` instead, which tells the agent to continue rather than
introduce itself to the same person twice.

Sent as realtime text rather than conversation history so it never appears as
something the caller said. Measured at ~2.4 s from connect to first audio.

---

## Interruption and turn-taking

The model runs voice activity detection on the input stream and reports
`interrupted` when the caller talks over it. Handling that flag is not optional:
audio already streamed to us is audio the model has retracted, so it must be
dropped rather than played.

The browser player stops scheduled sources with a 20 ms ramp — a hard stop
clicks. The Python runner clears its playback queue.

VAD is tuned away from the defaults for Indian callers:

```ts
{ disabled: false, prefixPaddingMs: 300, silenceDurationMs: 700 }
```

`prefixPaddingMs` defaults low enough to clip the first syllable, which is
exactly where "haan" and "nahi" live. `silenceDurationMs` buys tolerance for the
pauses people make while switching between Hindi and English; too low and the
agent talks over anyone who thinks mid-sentence.

Google's guidance for `silenceDurationMs` is 500–800 ms: under ~200 ms a
breath fragments the sentence, over ~2 s the caller feels lag. We sit at 700.
(The 3.1 preview ignored this field and cut turns at ~2 s —
[js-genai#1467](https://github.com/googleapis/js-genai/issues/1467); `gemini-3.8-live`
honours it.)

**Manual VAD** is available: set `automaticActivityDetection.disabled` and send
`activityStart` / `activityEnd` yourself. Relevant for telephony, where the
carrier often has better silence detection than anything derived from a decoded
RTP stream.

---

## Transcription

Both directions are on. The input transcript is what QA scoring and the
complaint audit trail are built from; the output transcript is what a supervisor
reads when taking over a call mid-conversation.

Fragments stream token-by-token, so both clients coalesce them into whole turns
before displaying. Rendering each fragment separately gives you a transcript one
word per line.

---

## Why ephemeral tokens

The browser cannot hold the real API key. It gets a token that is:

- **single use** — a token lifted from the network tab cannot open a second session
- **short-lived** — 30 minutes to exist, 2 minutes to start a session
- **constrained** — `liveConnectConstraints` bind it to one model and one full
  session config

That last one is the load-bearing part. Without constraints, a leaked token is a
general-purpose Gemini key on our billing. With them, it can only ever be this
agent, with this prompt, on this model.

`apiVersion: 'v1alpha'` must match on both the minting call and the client
connection. Mismatched, the socket fails to handshake with an unhelpful error —
a common enough mistake that it has its own SDK issue thread.

Because the config is bound to the token, the browser sends **no config** when
connecting. It cannot pick its own model or override the persona.

---

## Model features and where we stand (`gemini-3.8-live`)

| Feature | Status | Note |
|---|---|---|
| Thinking level | **Removed from the API** | 3.8 reasons interleaved with speech; `thinkingConfig` is rejected in the setup message. Nothing to tune. |
| Function calling | Using, async | Lookups (`lookup_order`, `search_knowledge`, `book_slot`, …) are declared `NON_BLOCKING`, so the agent keeps talking while they run; the response carries `scheduling: WHEN_IDLE`. `end_call`, `handoff_to_agent`, `transfer_to_human` stay blocking because they change what happens at the end of the turn. See `ASYNC_TOOLS` in `config.ts`. |
| Google Search grounding | Available | Not wanted. These agents must answer from our data, not the web. |
| Proactive audio | **Always on** | The model may decline to answer audio not directed at it (TV, a side conversation). There is no switch. |
| Affective dialogue | Prompt-level | `enable_affective_dialog` is gone from 3.8; tone adaptation is part of the model and steered through the role text. |
| Voices | 30 prebuilt | All listed in `voices.ts`, each previewable from Voice Studio. No speaking-rate parameter exists; pace is prompt-level. |
| Video input | Available | No use on a phone call. |
| Explicit language code | Not available | Native-audio models choose their own language and reject a language code, so multilingual behaviour is prompt-level. See `languageDirective()`. |
| `usageMetadata` | Using | Real token counts per session. What honest per-minute pricing has to be built on. |

---

## Testing

```bash
cd web
cp .env.example .env.local     # add GEMINI_API_KEY
npm run build && npm run start

npm run live:smoke             # token → socket → audio comes back
npm run live:smoke:resume      # context survives a reconnect, no re-greeting
node scripts/live-greeting-smoke.mjs   # agent speaks first
```

Each script drives the real token route exactly as the browser does, so they
cover the parts most likely to break silently: the version match, the token
constraints, resumption, and the greeting.

For the interactive microphone version of the server path:

```bash
export GEMINI_API_KEY=...
python -m agent.live_session --agent grievance    # or delivery, order, lead, booking, cod
```

Use headphones. Without them the agent hears itself through the speakers and
interrupts its own turn — the browser client avoids this by leaving the
platform's echo canceller on.

---

## What still stands between this and answering a real phone

Everything above is the conversation. The call is separate:

1. **SIP trunk to Live API bridge.** Terminate the carrier leg, decode RTP,
   resample 8 kHz G.711 to 16 kHz PCM, feed `LiveSession.send_audio`, and send
   24 kHz output back down. The hardest remaining piece, and where a partner
   like Voximplant or LiveKit is worth pricing against building it.
2. **Function calling against real data.** Order lookups, slot availability,
   complaint writes. Without this the agent takes messages rather than resolving
   anything.
3. **Recording, consent and retention.** The console already claims a consent
   record per complaint; the audio pipeline has to actually produce one.
4. **Concurrency and cost metering per call.** `usageMetadata` gives tokens per
   session; billing needs it aggregated per number, per agent, per tenant.
