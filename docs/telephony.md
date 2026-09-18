# Telephony: putting a phone number on an agent (Plivo)

The browser test bench proves an agent's behaviour. This is the part that lets a
customer *dial* it. It is built on Plivo's audio streaming and their
`Google-Live-API-Python` sample, reworked into a process that serves every agent
in the console instead of one hard-coded persona.

```
caller ──PSTN──▶ Plivo ──WebSocket, 16 kHz PCM──▶ telephony/bridge.py ──google-genai──▶ Gemini Live
                                                        │
                                                        └──HTTP + shared secret──▶ Next.js /api/internal/telephony/*
                                                             which agent answers · prompt · tools · transcript · billing
```

What you get:

- **Inbound.** A number assigned to an agent (Numbers & SIP) rings that agent.
  Unassigned numbers fall back to the org's first live agent.
- **Outbound.** "Call me now" on the Agents → Test tab, and campaign dialling,
  go through `POST /dial` on the bridge.
- **Tools on the phone.** `lookup_order`, `book_slot`, `register_complaint`,
  `lookup_ticket`, `notify_stakeholder`, `resolve_ticket`, `search_knowledge`,
  `transfer_to_human`, `handoff_to_agent`, `end_call` all execute in the console.
  Greeting discloses recording. Plivo records the leg into `recordings`.
  Supervisors can silent-listen and take over from Live Calls.
- **Every call is a row.** Live transcript on the Live calls board while the
  call is up; minutes, tokens and cost on completion; the post-call pipeline
  (summary, routing, QA) runs as for browser calls.

---

## What you need from Plivo

1. **An account** — [console.plivo.com](https://console.plivo.com). Trial accounts
   can only call *verified* numbers (Phone Numbers → Sandbox Numbers). Add your
   own mobile there first.
2. **Auth ID and Auth Token** — Account → API keys. Go in `telephony/.env`.
3. **A voice-capable number.** Phone Numbers → Buy Numbers. For India:
   - Inbound on an Indian number needs KYC/regulatory documents uploaded to
     Plivo; expect a few working days.
   - Outbound to Indian mobiles from a trial account works only to sandbox
     numbers. For production outbound you need DLT registration and a 140-series
     number (the Campaigns page already enforces this); Plivo's support team
     handles the number provisioning once your DLT entity is approved.
   - A US/UK number works immediately for testing the flow end to end.
4. **A Plivo Application** (Voice → Applications → Add New Application):
   - **Answer URL:** `https://<your-public-host>/plivo/answer`, method POST
   - **Hangup URL:** `https://<your-public-host>/plivo/hangup`, method POST
   - Save, then on your number (Phone Numbers → Your Numbers) set
     **Application Type = XML Application** and pick this app.
5. Audio streaming is a normal feature of Plivo voice — nothing extra to enable.

Costs to expect: number rent (a few USD/month), per-minute voice, and Gemini
Live tokens. The console meters the last two per call (`TELEPHONY_INR_PER_MIN`,
`AI_INR_PER_1K_TOKENS` in `web/.env.local`).

---

## Run it

Two processes plus a tunnel in dev.

```bash
# 1. console
cd web
cp .env.example .env.local        # GEMINI_API_KEY, then:
#   TELEPHONY_SHARED_SECRET=<long random string>
#   TELEPHONY_BRIDGE_URL=http://127.0.0.1:5000
npm run dev                       # http://localhost:3000

# 2. a public URL for Plivo to reach the bridge
ngrok http 5000                   # copy the https://….ngrok.app URL

# 3. bridge
cd telephony
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
cp .env.example .env              # GEMINI_API_KEY, PLIVO_*, PUBLIC_URL=https://….ngrok.app,
                                  # CONSOLE_URL=http://127.0.0.1:3000, TELEPHONY_SHARED_SECRET=<same>
.venv/bin/python bridge.py
```

Then set the Plivo application's Answer/Hangup URLs to the ngrok host as above.
Every ngrok restart gives a new host; a reserved domain (paid ngrok, or
Cloudflare Tunnel) avoids re-pasting it.

**Check it works**

- `curl http://127.0.0.1:5000/health` → `{"ok": true, "calls": 0}`
- Console → Numbers & SIP: assign the Plivo number to an agent (or leave it and
  the first live agent answers).
- Dial the number. The agent should greet within ~2–3 s. Say "where is my
  order" — the tool receipt shows in the bridge log and on the Live calls board.
- Agents → Test → "Call me now" with your sandbox-verified mobile places an
  outbound call with that agent.

---

## How the bridge decides things

**Who answers.** `POST /api/internal/telephony/session` with Plivo's `To`/`From`.
The console looks the number up in `numbers.assigned_agent_id`, composes the
same system instruction the browser test bench uses (`composeLivePrompt`:
persona, compiled flow, workspace playbook, agent directory, language
directive), and returns it with the tool declarations and voice. Outbound and
handoff sessions name the agent explicitly.

**Audio.** Plivo sends `audio/x-l16;rate=16000` frames; the bridge forwards
them in 20 ms chunks and drops backlog beyond 500 ms rather than let the model
answer stale audio. Model output is 24 kHz PCM, sent back as `playAudio`.
`interrupted` from the model → `clearAudio` to Plivo so the agent stops
mid-word when the caller barges in.

**Long calls.** Session resumption and `goAway` handling are the same as
`agent/live_session.py`: the 10-minute socket ceiling becomes a reconnect
between turns, not a dropped call.

**Tool control signals.** Tool results can carry a private `__control` that
never reaches the model:

| kind | bridge action |
|---|---|
| `end` | wait for the closing line to play (checkpoint → `playedStream`), then Plivo `calls.delete` |
| `handoff` | drain, fetch the target agent's session from the console, reconnect with a `[HANDOFF: …]` marker; same call row, new `agent_id` |
| `transfer` | drain, then Plivo `calls.transfer` the A-leg to `/plivo/transfer?to=…`, which `<Dial>`s the desk |

**Completion.** Whichever ends first — Plivo `stop`, the hangup webhook, or the
model loop — the bridge posts `complete` once with duration, tokens, transcript
and outcome. Billing and the post-call pipeline follow from there.

---

## Production notes

- Run the bridge behind a fixed hostname with TLS; Plivo requires `wss://` for
  streams on public hosts.
- Put a real random value in `TELEPHONY_SHARED_SECRET`; the console refuses
  internal calls without it in production.
- One bridge process handles many concurrent calls (asyncio); scale
  horizontally behind a load balancer — calls are independent and the state
  lives in the console.
- Recording and consent: the bridge starts a Plivo recording on stream start
  and posts the URL to `recordings`. Every calling agent discloses recording in
  the greeting; a `consent_artefacts` row is written when the call opens.
- Live-listen / takeover: Live Calls → Listen opens a silent monitor websocket
  on the bridge. Take over / Transfer posts `/intervene` and bridges a human
  onto a Plivo conference (takeover) or Dial (transfer).
- Campaigns: PATCH a campaign to `running` dials the next queued contact with
  answering-machine detection. Voicemail hangs up and the next contact is dialed.
- India-specific: DND scrubbing before outbound (Campaigns does this), DLT
  template IDs for any SMS follow-up, and TRAI's 140-series requirement for
  promotional outbound.
