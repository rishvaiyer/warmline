# Warmline

An accessibility-first calling concierge. Say what you need, in any language, plus who to call — Warmline
turns that into a plan you approve, places the call (mock by default; real calls opt-in, see below), and
reports the answer back in your own language.

Built for non-native speakers and people with phone anxiety: you never have to make the call yourself.

## Built on CALL-E

Warmline places its real phone calls through [**CALL-E**](https://call-e.devpost.com/) ("Your Code Is
Calling"), an agentic calling platform: you hand it a task and a phone number, and its voice agent makes
the call and hands back a structured result. CALL-E is what turns Warmline from a nice intent form into
something that actually reaches a human on the other end.

**How the integration works** (`server/index.ts`): for each approved target, Warmline calls
`CalleClient.calls.createAndWait(...)` from the `@call-e/calle` SDK, passing:

- **`task`** — the per-mission call goal Warmline generated from the user's intent (e.g. "ask for the
  earliest appointment; do not book anything"), always prefixed with a spoken AI-disclosure line.
- **`recipient`** — the business phone in E.164, plus a **`locale`** (the `callLocale`) so the call can
  happen in a different language than the person's own UI language.
- **`resultSchema`** — the mission's structured-output schema, so CALL-E returns typed fields
  (availability, price, outcome, evidence) rather than a blob of text.

Warmline wraps every CALL-E call in its own trust layer so "call anyone" stays safe: an **approval-first
plan review** the user must confirm, a spoken **AI disclosure**, a **server-side allowlist**
(`CALLE_ALLOWED_NUMBERS`), **E.164 validation**, a **max of 5 targets**, per-call **idempotency keys**,
and a hard rule that the agent never books, pays, or commits anything on the user's behalf. Real calls
are **off by default** and only run when `ALLOW_REAL_CALLS=true`, `CALLE_API_KEY` is set, and the number
is allowlisted (see [Environment](#environment)); otherwise Warmline uses a deterministic mock engine.

## Current state

- Intent box -> plan review -> results, three-screen flow.
- Intent interpretation (`src/domain/interpret.ts`): real LLM classification + field extraction via
  `@anthropic-ai/sdk` when `ANTHROPIC_API_KEY` is set, falling back to a keyword classifier otherwise
  (or if the LLM call fails).
- Four mission templates: lost & found, appointment scout, reachability check, generic.
- Call engine (`server/index.ts`): mock by default. Real CALL-E calls only run when
  `ALLOW_REAL_CALLS=true`, `CALLE_API_KEY` is set, and the target is in the server-side
  `CALLE_ALLOWED_NUMBERS` allowlist — any of those missing keeps the server in mock mode.
- Translation boundaries (`src/domain/translate.ts`): real LLM translation (batched per boundary) when
  `ANTHROPIC_API_KEY` is set; no-op when `userLocale === callLocale`; otherwise a `[locale] ` marker
  stub, same as the no-key fallback.

## Environment

Copy `.env.example` to `.env` and fill in what you need:

- Nothing set: keyword-based interpretation, marker-stub translation, mock calls. No network calls,
  fully offline-safe.
- `ANTHROPIC_API_KEY` only: real LLM interpretation + translation, calls still mocked.
- `ANTHROPIC_API_KEY` + `ALLOW_REAL_CALLS=true` + `CALLE_API_KEY` + `CALLE_ALLOWED_NUMBERS`: real phone
  calls via CALL-E, restricted to the allowlisted numbers.

## Run locally

```bash
pnpm install
pnpm dev
```

Open `http://localhost:5173`. The Vite dev server proxies `/api` to `http://localhost:8787`.

## Production build

```bash
pnpm build
pnpm start
```

## Project structure

```text
src/
  App.tsx             Three-screen intent -> plan -> results UI
  domain/
    base.ts            Shared target/mission schemas, safety preamble, guards
    template.ts         MissionTemplate<TInput, TData> contract
    missions/           lostAndFound, appointmentScout, reachability, generic
    registry.ts          kind -> template lookup
    interpret.ts         free-text -> plan (LLM, keyword-classifier fallback)
    translate.ts          locale-boundary translation (LLM, marker-stub fallback)
    llm.ts               shared Anthropic client + model constants
  styles.css
server/
  index.ts             Fastify API: intent/interpret, missions/run, health; real CALL-E path
docs/
  design.md            Full design spec (copied from foundline)
```

## License

MIT
