# The backend

Every screen in the console now reads from a real backend. This document is
the map: what runs where, how a call becomes rows, how money is metered, how
work reaches departments, and how the agent reaches a tenant's own data.

Run it:

```bash
cd web
npm install
# .env.local needs GEMINI_API_KEY and NEXT_PUBLIC_API_BASE_URL=/api/v1
npm run build && npm run start
```

First request seeds a demo workspace. Sign in as:

| Who | Email | Password | Sees |
|---|---|---|---|
| Owner | `demo@swara.in` | `swara-demo` | everything |
| Cleaning desk | `cleaning@swara.in` | `swara-demo` | only their action queue |
| Technical desk | `technical@swara.in` | `swara-demo` | only their action queue |

(One such user exists per department: `support`, `logistics`, `technical`,
`cleaning`, `payments`, `security` @swara.in.)

## Shape

```
Browser (React Query + Zod)
   │  /api/v1/*  session cookie
   ▼
Next.js route handlers ── src/app/api/v1/[...path]/route.ts   one router
   │
   ├─ lib/server/auth.ts      scrypt + hashed session tokens + audit log
   ├─ lib/server/repo.ts      every read, computed from rows at query time
   ├─ lib/server/pipeline.ts  post-call: metering → analysis → routing
   ├─ lib/server/tools.ts     mid-call function calling executor
   ├─ lib/server/ai.ts        Gemini text analysis + embeddings + fallbacks
   └─ lib/server/db.ts        SQLite (WAL), schema, self-seeding
                                └─ web/data/swara.db
```

Choices worth defending:

* **Backend inside Next.js, not a separate service.** The frontend already
  spoke a Zod contract through `lib/api/client.ts`; route handlers serve that
  exact contract from the same deployable. A second service adds a network
  boundary and a deploy pipeline before there is a single tenant who needs
  either. The contract file *is* the extraction seam if that day comes.
* **SQLite, not Postgres.** `npm run dev` is the entire infrastructure. All
  SQL lives in `repo.ts`; the Postgres migration is a driver swap, not a
  rewrite. The database is derived state at this stage — deleting it rebuilds
  the demo workspace.
* **No stored aggregates.** `callsToday`, resolution rate, the volume chart,
  the usage meter, invoices — all computed from `calls` and `usage_events` at
  read time. The dashboard cannot disagree with the invoice because they are
  the same query family over the same rows.
* **Demo-data parity.** With `NEXT_PUBLIC_API_BASE_URL` unset the console
  still runs on fixtures. The seed imports those same fixtures, so switching
  the backend on does not change what a demo looks like — it changes what the
  numbers are made of.

## Life of a call

1. **Token mint** (`/api/live/token`) — creates a `calls` row with
   `status='live'`. The browser test call appears on the Live board the moment
   it starts. Reconnects reuse the row via `callId`.
2. **Mid-call tools** — the model calls a function; the browser ferries it to
   `/api/v1/tools/execute`; the server runs it against the database or the
   tenant's connector; the model speaks the JSON result. The browser never
   resolves a tool itself — devtools must not be able to file complaints.
3. **Completion** (`/api/v1/calls/complete`) — duration, tokens and transcript
   land on the row; `usage_events` get the metering rows (₹/1k tokens for AI,
   ₹/min for PSTN legs — browser calls carry no carrier cost). Written
   synchronously *before* any model call, so billing survives an AI outage.
4. **Analysis** — `gemini-flash-latest` (with a pinned fallback model, then a
   keyword classifier) produces: summary, intent, sentiment, outcome, QA score
   0–100, the customer's name, and — the product's point — **department-routed
   action items**. A call that fails to classify still lands in a queue via
   keywords; misrouted is recoverable, dropped is not.

## Department routing — the metro case

Departments are per-org rows with keyword lists (`departments` table). Work
reaches them two ways:

* **During the call**: the agent's `register_complaint` tool classifies from
  category + description, creates the complaint *and* its action, and returns
  the reference number the caller hears. The complaint exists before hangup.
* **After the call**: the pipeline reads the transcript and writes action
  items in the department's terms ("Inspect and repair Gate C escalator",
  critical, Technical / Maintenance) — not restatements of the caller's mood.

A user created with a `department_id` gets a server-side-scoped `/queue`: they
log in and see only their department's work, ordered by SLA. Marking the last
action of a complaint done resolves the complaint — the department's board and
the complaints board are views of the same state and cannot diverge.

## Money

`usage_events` is append-only; everything else is a view over it:

* `/billing/usage` — current cycle: minutes against plan, AI vs telephony cost,
  daily series. Rates are env-tunable (`AI_INR_PER_1K_TOKENS`,
  `TELEPHONY_INR_PER_MIN`) and must be re-checked against the actual Gemini
  bill each cycle.
* `/billing/invoices` — past cycles, generated lazily from the same events and
  upserted, so an invoice always equals its meter. `/billing/pay` records a
  simulated capture until `RAZORPAY_KEY_ID` is set; the bookkeeping
  (invoice → payment → audit log) is identical either way.
* Logins, payments and seeds land in `audit_log`.

## Getting the tenant's data to the agent

Two different problems, two different mechanisms:

**Per-call facts** ("where is order ORD-48213") — the `connectors` table.
The agent's `lookup_order` tool resolves through whichever connector the org
configured:

| Option | Verdict |
|---|---|
| **REST pull (implemented)** — tenant exposes a read endpoint + header credential; we call it per enquiry with a 4 s timeout | The default. Tenant keeps custody of their data; we cache nothing; a slow API degrades to "I'll confirm by SMS" instead of dead air. Works for Shopify/Zoho-class systems (their existing APIs) and for custom stacks (one endpoint to write). |
| **Direct DB credentials** | Rejected. Holding write-capable credentials to a customer's production database is a liability we cannot price, schema drift breaks silently, and SMB databases are rarely reachable from outside anyway. |
| **CSV/batch sync** | Fallback for tenants with no API at all — upload becomes a `demo`-style local lookup. Data is stale by definition; fine for catalogues, wrong for order status. |
| **Webhook push** | The eventual complement: tenant pushes order events to us, we keep a read model. Right once call volume makes per-enquiry pulls expensive; premature now. |

The demo org ships a `demo` connector with deterministic synthetic orders so
the flow works with zero setup.

**Ambient knowledge** ("what is the refund policy") — the knowledge base.
`POST /api/v1/agents/knowledge` takes extracted text, chunks it on paragraph
boundaries (~1200 chars), embeds with `gemini-embedding-001`, and stores
vectors in SQLite. The agent's `search_knowledge` tool does cosine ranking
(term-overlap fallback if embedding is unavailable) and the prompt forbids
improvising policy when the search comes back empty. PDF parsing and URL
crawling belong in a worker later; the API takes text so everything downstream
is already real.

## Testing

```bash
node scripts/live-tools-smoke.mjs   # token → live socket → lookup_order →
                                    # spoken result → completion → metering
node scripts/live-smoke.mjs         # basic audio round-trip
node scripts/live-resume-smoke.mjs  # session resumption without re-greeting
node scripts/shots.mjs              # signs in, screenshots every screen
```

The tools smoke test is the one that proves the story end to end: on a live
socket the model called `lookup_order("ORD-48213")`, our server answered from
the connector, and the agent replied *"status bata raha hai ki ye hub par
delayed hai, delivery ab parso tak"* — then the call metered ₹ against the
demo org.

## Not built yet, on purpose

* **Postgres + real migrations** — when a tenant's data must survive schema
  changes. The `SCHEMA_VERSION` gate in `db.ts` marks the spot.
* **Razorpay live mode** — the integration point is `repo.payInvoice`; keys
  flip it from simulated to real.
* **SSE/websocket dashboards** — Live board and queue currently poll (8 s /
  15 s). Fine below hundreds of concurrent calls.
* **Encryption-at-rest for connector secrets** — required before the first
  non-demo tenant configures one.
* **PSTN leg** — `agent/live_session.py` mirrors the browser session for the
  telephony worker; its tool executor should call the same `/api/v1/tools/execute`.
