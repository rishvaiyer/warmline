# Warmline

An accessibility-first calling concierge. Say what you need, in any language, plus who to call — Warmline
turns that into a plan you approve, places the call (mock by default; real calls opt-in, see below), and
reports the answer back in your own language.

Built for non-native speakers and people with phone anxiety: you never have to make the call yourself.

See `docs/design.md` for the full design spec (intent-first flow, MissionTemplate model, the two-knob
language model, and the safety/permitted-use model). Warmline generalizes
[FoundLine](../foundline)'s lost-item calling engine into an intent-first, multi-template concierge.

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
