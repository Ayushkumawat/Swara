# Swara console (`web/`)

The frontend for the Swara voice AI platform — marketing site, auth, first-run
onboarding, and the twelve-screen operations console described in
[`../project.md`](../project.md).

```bash
npm install
npm run dev      # http://localhost:3000
npm run build
npm run start
```

Ships with its own backend. With `NEXT_PUBLIC_API_BASE_URL=/api/v1` in
`.env.local` (the default in `.env.example`), the route handlers under
`src/app/api/v1` serve every screen from SQLite — auth and sessions, calls
with per-call token/cost metering, complaints routed to department queues,
usage and invoices computed from raw usage events. The database self-seeds a
demo workspace on first run; sign in as `demo@swara.in` / `swara-demo`, or as
a department desk like `cleaning@swara.in` to see the scoped action queue.
Details in [`../docs/backend.md`](../docs/backend.md). Unset the variable and
the console falls back to the in-bundle demo dataset with no auth.

The voice agent talks to Gemini Live for real. Set `GEMINI_API_KEY` in
`.env.local` (see `.env.example`) and "Test call" on the Agents screen opens
an actual speech-to-speech session — mic in, agent voice out, interruption,
and mid-call function calling: the agent looks up orders, registers complaints
(with a real reference number that lands in a department's queue) and books
slots against the backend while the caller is on the line. Architecture, model
features and limits are in [`../docs/live-api.md`](../docs/live-api.md).

---

## Stack

| Concern | Choice | Why |
|---|---|---|
| Framework | Next.js 16 (App Router) | Route-level code splitting, and marketing + app on one deploy |
| Styling | Tailwind v4 | CSS-first tokens, so `project.md` §3 lives in `globals.css` rather than a JS config |
| Motion | `motion` (Framer) | Layout animations and shared-element transitions |
| Data | TanStack Query + Zod | Every response is schema-parsed, so backend drift fails loudly |
| State | Zustand | Only for cross-screen UI (palette, copilot, alerts) |
| Charts | Hand-rolled SVG | A chart library is ~90KB and would still need overriding to match the glass theme |

---

## Wiring up the real backend

Everything goes through one transport in `src/lib/api/client.ts`:

```bash
# .env.local — unset means "use the demo dataset"
NEXT_PUBLIC_API_BASE_URL=https://api.swara.in/v1
```

Set it and every screen switches to live HTTP. Nothing else changes.

The contract is `src/lib/api/schemas.ts` — Zod schemas that double as the
TypeScript types and the spec your backend implements. Endpoints your backend
needs to serve (all `GET`, all listed in `endpoints` at the bottom of
`client.ts`):

| Path | Returns | Notes |
|---|---|---|
| `/overview` | `Overview` | Today's aggregates + 7-day volume buckets |
| `/agents` | `Agent[]` | Includes the node graph inline |
| `/agents/versions` | `AgentVersion[]` | Rollback history |
| `/agents/knowledge` | `KnowledgeDoc[]` | Ingestion status per source |
| `/calls/live` | `LiveCall[]` | Polled every 8s — see note below |
| `/calls` | `CallRecord[]` | Completed calls with QA scores |
| `/campaigns` | `Campaign[]` | |
| `/campaigns/scrub-status` | `ScrubStatus` | DLT/DND state, quiet hours, retry policy |
| `/bookings` | `Booking[]` | |
| `/complaints` | `Complaint[]` | SLA deadline is absolute; the countdown is derived client-side |
| `/customers` | `Customer[]` | Phone number is the identity key |
| `/voices` | `Voice[]` | Only expose parameters the S2S model can actually tune |
| `/voices/script-tests` | `ScriptTest[]` | |
| `/numbers` | `PhoneNumber[]` | |
| `/numbers/security` | `SecuritySetting[]` | `provider` distinguishes ours from the telephony partner's |
| `/numbers/trunks` | `SipTrunk[]` | |
| `/integrations` | `Integration[]` | |
| `/analytics` | `Analytics` | |
| `/billing/usage` | `Usage` | Must be real metering, not estimates |
| `/compliance` | `ComplianceItem[]` | `automated: false` means it can go stale silently |
| `/team` | `TeamMember[]` | |
| `/api-keys` | `ApiKey[]` | |
| `/notifications` | `AppNotification[]` | |

**Live calls should become a subscription.** They currently poll on an 8-second
interval, which is fine for a demo and wrong for a monitoring wall. Swap
`useLiveCalls` in `src/lib/api/hooks.ts` for a WebSocket or SSE feed when the
backend has one. The per-second duration counters are already client-side and
won't change.

**Regulatory fields are closed enums on purpose.** `NumberSeries` (140/160),
quiet hours, and DND scrub state are typed narrowly because a violation here
has legal consequence. Keep them enforced at the data layer, not just rendered.

---

## Layout

```
src/
  app/
    (marketing)/     landing, pricing        — public, statically rendered
    (auth)/          login, signup, onboarding
    (console)/       the twelve product screens + shared shell
  components/
    chrome/          sidebar, topbar, command palette, copilot, alerts
    ui/              glass primitives (card, button, pill, tabs, table, controls)
    viz/             SVG charts
    flow/            node-graph canvas
    motion/          reveal, stagger, ticker, lazy-mount, ambient glows
  lib/
    api/             schemas (the contract), client (transport), hooks, fixtures
    live/            Gemini Live session: config, personas, audio, reconnect
    nav.ts           navigation model, also feeds the command palette
    pricing.ts       single source for public and in-app pricing
```

---

## Performance

Lazy loading works at three levels:

1. **Route** — automatic per-page bundles from the App Router.
2. **Component** — `next/dynamic` for anything not needed on first paint: the
   command palette and copilot (keystroke-triggered), the flow canvas (one tab
   of one screen), and every chart.
3. **Viewport** — `<LazyMount>` defers below-the-fold blocks until they scroll
   near, showing a shape-matched skeleton meanwhile.

Loading states are skeletons shaped like the content they replace, never
spinners, so nothing reflows when data lands.

## Motion

`project.md` §3 deferred motion until the layout was locked. The rule the
implementation follows: **motion explains where something came from or shows
that something is alive, and never delays a user who already knows what they
want.**

Every primitive in `src/components/motion/primitives.tsx` collapses to a no-op
under `prefers-reduced-motion`, and `globals.css` kills all animation durations
under the same query. Reveal-on-scroll has a failsafe timer — if an
IntersectionObserver callback never fires, the content appears anyway. Content
is never permanently hidden behind an animation.

---

## Screenshots

```bash
npm run build && npm run start
node scripts/shots.mjs /tmp/swara-shots
```

Drives the system Chrome over CDP, scrolls each route so deferred sections
mount, waits for animations to settle, then captures. Set `CHROME_PATH` if
Chrome isn't at `/usr/bin/google-chrome`.

---

## What is UI-only right now

These render and behave correctly but are not wired to anything real. They are
marked here so nobody mistakes a convincing screen for a working feature:

- **Copilot** proposes changes from a scripted keyword planner
  (`respond()` in `src/components/chrome/copilot.tsx`). The review/stage/discard
  flow around it is real and won't change when a model goes behind it.
- **Listen / take over / transfer** are UI affordances. The underlying
  SIP/RTP bridging is genuinely hard and needs architecture work early.
- **Outbound dialling** — the agent conversation is real, but nothing places a
  call to a phone number yet. That needs the telephony leg.
- **Auth** navigates without authenticating.
- **Mutations** are optimistic-only in demo mode.

The voice agent is the exception: it is genuinely live, and the personas it runs
are the ones in `src/lib/live/prompts.ts`.
