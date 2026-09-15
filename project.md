# Swara — Project Reference (project.md)

*Placeholder brand name — swap throughout once finalized. This document is the single source of truth connecting business context → design system → screen-by-screen build spec. Read this before touching UI code.*

---

## 1. What we're building and why

**One-line aim:** An AI voice calling platform that combines every feature scattered across today's calling-agent products (sales, enquiry, complaints/grievances, bookings, support — inbound *and* outbound) into a single Indian-first platform, priced to undercut the market while staying profitable from day one, so that no competitor can out-feature us on any single vertical.

**Who it's for (in order):**
1. Indian SMB/startup e-commerce and fast-delivery businesses (first wedge — order status, delivery rescheduling, complaint handling, COD reminders are the highest-value use cases here)
2. Expansion into other Indian verticals once proven
3. Eventual enterprise customers, once track record + compliance depth justify it

**Core differentiation thesis (from market research):**
- Nobody in the market is genuinely excellent at both inbound *and* outbound — we will be, from day one
- Pricing across the category is opaque (Gnani, Yellow.ai, PolyAI all hide pricing behind sales calls) — we lead with transparent, predictable pricing
- Compliance (DLT, DND, consent, data residency) is bolted on elsewhere — we build it as a first-class, visible part of the product, not a backend afterthought
- We own a **self-hosted, self-built speech-to-speech model** (already latency-tested across Indian languages/dialects) — this is our core technical moat and cost advantage; we are not reselling someone else's LLM/STT/TTS stack

**Business constraints that shape every build decision:**
- Solo founder, building and deploying everything (backend, APIs, frontend) — no team, no office
- ₹10,00,000 total launch budget, bootstrapped — raising only after market traction is proven
- MVP targeted within a few weeks — **build order matters**; not every screen in this doc ships at once (see §7)
- Robosapien LLP already registered — legally sufficient to build/sell the software; no telecom license (OSP) required as long as we route through a licensed telephony partner (Plivo/Exotel/Vobiz-class) rather than self-operating a carrier interconnect
- DLT registration (TRAI) is the one hard regulatory prerequisite before the first commercial call, inbound or outbound — must be in progress before/alongside MVP development, not after
- India-only focus for now; no ILD/international requirements yet

---

## 2. Cost & pricing model (what the product must reflect operationally)

- Our AI compute cost is **fully self-hosted** — the quoted per-token pricing (input $0.50 text / $3.00 audio, output $2.00 text / $12.00 audio incl. thinking tokens) represents our *entire* loaded AI cost (compute + RAM + serving). Backend/frontend hosting, telephony, and go-to-market are separate, additional costs.
- Planning estimate: **~₹2.5/min AI cost + ~₹0.5/min telephony ≈ ₹3/min total variable cost per call** (to be tightened once real GPU-cost-per-concurrent-call or tokens/sec telemetry is available — this number directly determines final pricing, so the Settings/Billing screen's usage metering must be built to actually measure this accurately from day one, not just display placeholder numbers).
- Monthly fixed burn estimate (excluding AI compute, which is variable): **~₹40,000/month** (backend hosting, telephony base fees, tools, marketing) — ~23 months of runway on the ₹10L budget at zero revenue.
- **Pricing tiers to build billing/metering around:**
  - Starter: ₹12,999/month, up to 2,500 minutes
  - Growth: ₹24,999/month, up to 6,000 minutes
  - Overage: ₹5/min beyond plan cap
- **Breakeven target:** ~8 paying subscription customers covers fixed costs; ~25 customers is a strong profitability threshold. The Settings/Billing screen and any internal admin dashboard should be built with these thresholds as real KPIs to track, not abstract numbers.
- Implication for engineering: usage metering (minutes consumed, per-customer cost vs. plan revenue) needs to be accurate and real-time from the first billing cycle — this is a financial control, not just a UI nicety.

---

## 3. Design system (the visual language every screen must follow)

**Brand concept:** "Swara" (Sanskrit/Hindi: voice/note/sound) — the entire visual language is built around the idea of *signal*: sound traveling through the air, always-on, at night, across a network. This is why the design is dark-first with glowing color bleeding through frosted glass panels, rather than a flat, generic SaaS-light theme.

**Color tokens**
| Token | Hex | Use |
|---|---|---|
| Void (base bg) | `#0A0E1A` | Page background |
| Panel | `#121828` / `#161E32` | Card base before glass tint |
| Signal Violet | `#7C6CF6` | Primary gradient start, active states, brand mark |
| Signal Cyan | `#3FE0C5` | Primary gradient end, waveform, success-adjacent accents |
| Amber Flag | `#F5A62B` | Attention/warning/medium-severity |
| Coral Alert | `#FF6B6B` | Critical/danger/high-severity |
| Text 1/2/3 | `#F3F5FA` / `#9AA3B8` / `#5C6478` | Primary / secondary / tertiary text |

Glass panels are `rgba(255,255,255,0.045–0.07)` with `backdrop-filter: blur(20–30px)` and a `1px rgba(255,255,255,0.09)` border. **The blurred violet/cyan/amber glow shapes behind the layout are load-bearing** — without colored light behind them, the glass panels read as plain grey boxes, not glass. Do not remove the background glows when implementing.

**Typography**
- **Space Grotesk** — headings, big numbers/metrics, brand mark (has character, technical feel)
- **Inter** — all body text, labels, nav, buttons (disappears, does its job)
- **JetBrains Mono** — anything data-shaped: phone numbers, call durations, timestamps, minute counts, call IDs. This is a deliberate choice specific to this product — a calling platform shows numeric/temporal data constantly, and giving it a dedicated monospace voice makes the whole UI feel more precise and "operational."

**Layout philosophy:** Command-center / live-ops structure, not a generic analytics-SaaS layout — icon-rail sidebar grouped by workflow stage (Workspace / Operations / Voice & Telephony / Platform), glass metric cards, live data given visual priority (waveforms, live dots, real-time counts) over static charts. This mirrors how someone would actually want to watch a contact center in real time.

**Signature interaction elements (carry across every relevant screen):**
- **Waveform bars** next to any live/active call — reinforces "this is voice, happening now"
- **Copilot bar** ("Ask the copilot to build or edit a flow…") — the AI-assisted flow-editing pattern is our single biggest differentiator from the builder-UX research (modeled on Retell's "Conductor," which almost no competitor has shipped). This should eventually be a real natural-language-to-flow-edit feature, not just a UI element — treat the bar as a preview of a load-bearing feature, not decoration.

**Explicitly deferred:** animations/transitions/micro-interactions — current screens are intentionally static-only. Motion design is a later pass once layout and information architecture are locked.

---

## 4. Screen-by-screen build spec

For each screen: **purpose**, **why it exists** (competitor gap it closes or feature it combines), and **what each component needs to actually do** once wired to real data.

### 4.1 Overview (home/dashboard)
**Purpose:** Single-glance daily status for the business owner — "is everything working, and does anything need my attention right now."
- **Metric cards** (calls today, minutes used, resolution rate, open complaints): must pull live aggregate counts from the call-logging backend; the complaints counter specifically needs to be real-time (not batch-updated), since it's meant to catch the owner's eye immediately — this is deliberately placed on the home screen because no competitor surfaces complaints this prominently.
- **Call volume chart:** 7-day rolling aggregate, inbound+outbound combined — needs a backend job that buckets calls by day.
- **Live calls panel:** a live-updating feed (websocket or polling) of currently-active calls with caller number (masked for privacy), intent/agent assigned, duration, detected language. This is a preview/summary of the full Live Calls screen — clicking through should deep-link there.
- **Copilot bar:** entry point to the flow-editing assistant — should be clickable/functional even from the home screen since it's a core differentiator, not buried in the builder only.

### 4.2 Agents & Flows (the builder)
**Purpose:** Where every agent (use case) gets created, configured, tested, and published. This is the single most important screen competitively — it's the one every competitor treats as their signature screen (Synthflow's no-code builder, Bland's Pathways, Retell's Conductor).
- **Agent list (left panel):** every agent the business has built, with status (Live/Draft/Testing), assigned languages, and quick identification. Needs CRUD against the agents table.
- **Tab bar (Flow builder / Single prompt / Knowledge base / Test & simulate / Versions):** these map to the two builder modes we're combining from competitor research — deterministic node-graph (Bland's strength, needed for compliance-sensitive flows like grievance intake) and simple single-prompt mode (Retell's simpler option, faster for straightforward agents). **Do not build only one mode** — the node-graph engine should be the underlying data model, with single-prompt as a simplified view/generation shortcut on top of it, not a separate system.
- **Flow canvas (node-graph):** each node (Start/Greeting, Intent detection, Data pull, Branch, Escalate) represents a real configurable unit — greeting node needs language-detection logic, data-pull nodes need to call external APIs (order status, CRM lookups) mid-conversation, branch nodes need conditional logic editable by a non-technical user, escalate nodes need to trigger a real warm-transfer-to-human with context handoff.
- **Copilot input on the canvas:** natural-language instruction → flow edit. This needs real NLU/agentic tooling behind it eventually (not in MVP scope necessarily, but the UI affordance should exist early so it's not a bolt-on later).
- **Knowledge base tab:** document/website ingestion for FAQ-grounding — competitor gap this closes: Retell's knowledge-base grounding feature, needed for the Enquiry/Support use case specifically.
- **Test & simulate tab:** must let the founder (or later, the customer) place a real test call against a draft agent before publishing — non-negotiable for trust, since a bad live call is a lost customer.
- **Versions tab:** rollback capability — protects against a bad copilot edit or manual mistake breaking a live agent.

### 4.3 Campaigns (outbound)
**Purpose:** Manage all outbound calling — sales, reminders, collections, surveys. This is where we close the "nobody is good at both inbound and outbound" gap.
- **Campaign table:** name, assigned agent, number series (140 promotional vs 160 transactional/service — this distinction is India-regulatory, not cosmetic, and must be enforced at the data layer, not just displayed), contact count, connect rate, status.
- **Contact upload:** CSV import → contact list, needs validation against the DND/DLT scrub list before any number enters a dialing queue — this cannot be optional or an afterthought, it's a compliance requirement.
- **DND/DLT scrub status card:** shows entity/template approval status and how many numbers were auto-excluded — this needs to be a real, queryable compliance state, since a violation here has legal consequence, not just a UX issue.
- **Retry logic panel:** configurable retry attempts, backoff gap, and quiet hours (9pm–9am) — quiet-hours enforcement should be a hard backend rule, not just a UI default, since it protects against TRAI/TCCCPR violations.

### 4.4 Live Calls (monitoring wall)
**Purpose:** Real-time supervisor view — watch every active call, intervene when needed. Closes Retell's live-listen/takeover gap and extends it with sentiment-based triage.
- **Live call cards:** need a real-time audio stream connection for "Listen," and a mechanism to inject a human into an active call for "Take over"/"Transfer" — this is genuinely complex telephony/media engineering (SIP/RTP bridging), flag for early architecture planning, not a late add-on.
- **Sentiment filter tabs (All / Frustrated / Sales / Support):** requires real-time sentiment scoring running per-call, not post-call — this is what differentiates our monitoring from a plain call list. Ties to the RevComm-style real-time complaint-alert pattern.

### 4.5 Analytics
**Purpose:** Deep reporting for quality, cost, and outcomes — where the business owner (or eventually enterprise buyer) justifies ROI.
- **KPI row (AHT, containment rate, escalation rate, CSAT, cost-per-call):** cost-per-call is a deliberate inclusion — no competitor researched surfaces unit economics transparently to the customer; this becomes a trust/differentiation feature, but requires the billing/metering backend (§2) to be accurate, since a wrong number here damages trust badly.
- **Automated call scoring table:** rubric-based QA score per call, computed automatically (not manually reviewed) — this needs a scoring model/prompt run against each call transcript post-call, flagging issues (tone, slow resolution) automatically.
- **CSAT trend chart:** requires either explicit post-call feedback capture (IVR "rate this call 1-5") or inferred sentiment-based scoring as a fallback.

### 4.6 Bookings
**Purpose:** Live appointment scheduling — the single strongest individual feature from competitor research (Retell's live calendar booking).
- **Calendar view:** must sync bidirectionally with Google Calendar/Cal.com — an agent needs to check real availability *during* a live call and commit the booking without double-booking risk (concurrency-safe booking logic required).
- **No-show risk badge:** a genuinely new feature (borrowed from healthcare scheduling) — needs a model/heuristic scoring past reschedule/cancellation history per customer; not required for MVP but the data model (booking history per customer) should be built to support this from the start so it's not a schema migration later.
- **Reminder automation:** auto-triggered call/SMS before an appointment, tied to the same booking record.

### 4.7 Complaints & Grievances
**Purpose:** Structured intake, tracking, and resolution of complaints — the RevComm-style real-time alerting gap, extended into a full workflow (borrowed from support-ticketing tools like Zendesk).
- **Kanban board (New/In progress/Escalated/Resolved):** each card needs severity (auto-classified from sentiment/keywords during the call), category, and an SLA countdown — SLA timers need a real backend job, not just a static display.
- **Audit trail/export:** every complaint needs its full transcript, recording, and consent record exportable — this is a compliance requirement for any future regulated-industry customer (BFSI/insurance), so the data model should retain these links from day one even if the export UI ships later.

### 4.8 Customer 360
**Purpose:** Unify every channel (call, WhatsApp, SMS, email) and order history into one timeline per customer — closes the omnichannel gap (Yellow.ai/Verloop pattern) and delivers on the "cross-call memory" feature from our own feature-audit.
- **Conversation list:** requires a unified customer-identity model (phone number as primary key, linked across call/WhatsApp/SMS records) — this is a data-modeling decision that needs to happen early, since retrofitting identity resolution later is painful.
- **Timeline:** every interaction (call, message, order) in one chronological feed — this is what powers the "agent already knows the customer's last 3 orders before saying hello" real-time-optimization feature from our feature audit. The agent's live data-pull nodes (§4.2) should read from this same unified customer record.

### 4.9 Voice Studio
**Purpose:** Configure and test the actual voice/persona per agent and language — since our core moat is the self-hosted speech-to-speech model, this screen is where that technical asset becomes a usable product feature.
- **Voice cards (pace/formality sliders, play preview):** need to map directly to real parameters our S2S model actually exposes — don't build UI controls for parameters the model can't tune; confirm the model's actual configurable surface before finalizing this screen's controls.
- **A/B script test panel:** compares two script/voice variants by real outcome data (resolve rate) — needs the same call-outcome tagging data used in Analytics; this is a genuinely differentiated feature (borrowed from marketing/growth tooling), build it once outcome tracking exists, not before.

### 4.10 Numbers & SIP
**Purpose:** Telephony and number management, plus call security — where our SIP/telephony strategy (Tier 2 hybrid: Plivo/Exotel/Vobiz-class partner + our own orchestration layer) becomes visible and manageable.
- **Numbers table:** number, series (140/160), assigned agent, pickup rate — pickup rate is a genuine differentiator (Vomyra's pitch) and needs real call-connect data, not a vanity number.
- **Call security toggles (STIR/SHAKEN, voice biometric verification, spam/robocall detection, auto-block):** STIR/SHAKEN attestation is typically handled by the telephony partner (confirm what Plivo/Exotel/Vobiz expose via API) — voice biometric verification is a genuinely new build (borrowed from banking security/SOC dashboards) and would need real biometric-matching capability, likely a later-phase feature, not MVP.

### 4.11 Integrations
**Purpose:** Connect the platform to the tools our customers already use — CRM, e-commerce, calendar, messaging, and our own API/MCP surface.
- **Integration cards:** each needs a real OAuth/API-key connection flow per service (Salesforce, HubSpot, Zoho, Shopify, WooCommerce, Shiprocket, WhatsApp Business, Google Calendar) — prioritize Zoho/Shiprocket-class Indian tools over Salesforce for the first customer segment (e-commerce/delivery SMBs), not the other way around.
- **MCP server card:** lets customers control campaigns from Claude/ChatGPT directly — matches Vomyra's differentiator; scope this as a real MCP server implementation once core API is stable, not a placeholder.
- **Webhooks/REST API:** needed early regardless of UI polish — developer-minded customers will want this before they trust a no-code builder alone.

### 4.12 Settings
**Purpose:** Billing, compliance, team, and API management — where opaque competitor pricing/compliance becomes a trust signal instead of a black box.
- **Usage/billing card:** must reflect real, accurate metering (see §2) — this is the one place a wrong number directly costs money or trust.
- **Compliance status card (DLT, GST, consent capture, data residency):** should reflect real, live status wherever possible (e.g., DLT approval state via API if the DLT provider exposes one) rather than a manually-updated flag — compliance status going stale silently is a real business risk.
- **Team & roles / API keys tabs:** role-based access control was noted as a weak point for some competitors (Retell) — building this properly from the start is a differentiator, not just parity.

---

## 5. Feature completeness checklist (cross-referenced against competitor research)

Use this to confirm no screen above is missing something the market already offers. ✅ = covered by a screen in §4.

- Inbound + outbound from day one ✅ (Campaigns + Live Calls + Agents)
- Node-graph deterministic builder (Bland) ✅ (Agents & Flows)
- Single-prompt simple mode (Retell) ✅ (Agents & Flows)
- No-code templates (Synthflow) ✅ (Agents & Flows — Templates button)
- AI-copilot flow editing (Retell Conductor) ✅ (Overview + Agents & Flows)
- Knowledge-base grounding (Retell) ✅ (Agents & Flows)
- Live calendar booking (Retell) ✅ (Bookings)
- Warm transfer with context (Retell) ✅ (Live Calls + Agents flow escalate node)
- Live-listen/takeover (Retell) ✅ (Live Calls)
- Automated call scoring/QA (Retell) ✅ (Analytics)
- Real-time complaint/sentiment alerting (RevComm) ✅ (Overview + Live Calls + Complaints)
- Structured grievance logging + audit export (Vomyra) ✅ (Complaints)
- Omnichannel unification (Yellow.ai/Verloop) ✅ (Customer 360)
- Voice cloning/customization (ElevenLabs/Bland) ✅ (Voice Studio)
- High-pickup-rate Indian numbers (Vomyra) ✅ (Numbers & SIP)
- MCP server for external AI control (Vomyra) ✅ (Integrations)
- DLT/DND compliance built into onboarding ✅ (Campaigns + Settings)
- Deep Indic language + Hinglish support ✅ (Agents, Overview language mix, Voice Studio)
- Transparent, self-serve pricing (market gap — Gnani/Yellow.ai/PolyAI are opaque) ✅ (Settings — usage/billing)
- RBAC/team roles (weak point for some competitors) ✅ (Settings)

**Additional/cross-industry features included (beyond anything found in direct competitor research):**
- No-show risk prediction (Bookings) — from healthcare scheduling software
- SLA-tracked kanban for grievances (Complaints) — from support-ticketing tools (Zendesk-style)
- A/B script/voice testing with live outcome comparison (Voice Studio) — from marketing/growth tooling
- Voice biometric verification + fraud/spam detection (Numbers & SIP) — from banking security/SOC dashboards
- Cost-per-call transparency (Analytics) — from cloud infra billing dashboards
- Cross-call customer memory (Customer 360) — original addition, not seen in any competitor researched

---

## 6. Build order recommendation (given solo founder + few-weeks MVP timeline)

Not everything in §4 ships at once. Recommended sequence:

1. **MVP core:** Overview (basic), Agents & Flows (single-prompt mode first, node-graph can follow), Live Calls (basic monitoring, live-listen can come after), Numbers & SIP (basic provisioning)
2. **First customer readiness:** Campaigns (with DND/DLT compliance non-negotiable), Bookings, Complaints (basic kanban, no-show scoring later)
3. **Retention/expansion features:** Analytics (deep scoring), Customer 360, Voice Studio, Integrations marketplace
4. **Trust/scale features:** full RBAC, voice biometrics, MCP server, audit exports for regulated verticals

Compliance (DLT registration) and the copilot-editing affordance are the two things worth front-loading even though they feel like "later" features — DLT because it blocks the first legal commercial call, and the copilot bar because it's the single most defensible differentiator identified in the entire competitive research and is easy to under-invest in if left for "later."

---

## 7. Implementation status and how to run

What exists in this repo, mapped to the spec above. Details in `docs/`.

| Area | State | Where |
|---|---|---|
| Console (all §4 screens) | Real backend on SQLite, self-seeding demo org (`demo@swara.in` / `swara-demo`) | `web/`, `docs/backend.md` |
| Voice engine | Gemini Live native audio, auto language detection, tools executed server-side | `web/src/lib/live/`, `docs/live-api.md` |
| Agents & Flows | Node-graph is the data model; flows compile into the prompt. Drag, connect, delete, inspector, undo, autosave. `handoff_to_agent` and `end_call` make flows act. | `web/src/lib/agents/flow.ts`, `web/src/components/flow/` |
| Swara (setup agent) | Female-voiced consultant that interviews the owner, writes the workspace (playbook, departments, transfers, appointments, knowledge) through tools, and proposes agents. "Build with Swara" turns the plan into agents. | `web/src/lib/agents/swara.ts`, `web/src/lib/server/planner.ts`, `web/src/components/agents/build-with-swara.tsx` |
| Workspace setup | Use-case profile (clinic, e-commerce, customer care, sales, civic, hospitality, education) reorders and marks what each business needs; Swara panel fills it live. | `web/src/app/(console)/setup/page.tsx`, `web/src/lib/agents/use-cases.ts` |
| Telephony | Plivo audio-streaming bridge: inbound by number assignment, outbound "Call me now" and campaigns, tools on the phone, end/handoff/transfer, per-call metering. | `telephony/bridge.py`, `docs/telephony.md` |
| Not yet | Call recording + consent artefacts on the phone leg, live-listen/takeover audio, DLT status API, voice biometrics | — |

**Run**

```bash
# console
cd web && cp .env.example .env.local   # GEMINI_API_KEY, TELEPHONY_* (see file)
npm install && npm run dev             # http://localhost:3000

# phone calls (separate process; Plivo account + public URL needed)
cd telephony && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
cp .env.example .env && .venv/bin/python bridge.py   # then follow docs/telephony.md
```

**Verify**

```bash
cd web && npx tsc --noEmit && npx eslint src     # types + lint
npm run live:smoke && npm run live:smoke:resume  # token → socket → audio, resumption
python3 -m py_compile telephony/bridge.py agent/live_session.py
```
