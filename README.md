# Warmline

An accessibility-first calling concierge. Say what you need, in any language, plus who to call — Warmline
turns that into a plan you approve, places the call (mock in this scaffold), and reports the answer back
in your own language.

Built for non-native speakers and people with phone anxiety: you never have to make the call yourself.

See `docs/design.md` for the full design spec (intent-first flow, MissionTemplate model, the two-knob
language model, and the safety/permitted-use model). Warmline generalizes
[FoundLine](../foundline)'s lost-item calling engine into an intent-first, multi-template concierge.

## Current state (v0 scaffold)

- Intent box -> plan review -> results, three-screen flow.
- Mock keyword-based intent interpreter (`src/domain/interpret.ts`) — TODO: real LLM interpretation.
- Four mission templates: lost & found, appointment scout, reachability check, generic.
- Mock-only call engine (`server/index.ts`); the real CALL-E path is a clearly-commented stub that
  throws `"real calls not implemented in scaffold"`.
- Translation boundaries (`src/domain/translate.ts`) are stubs: no-op when locales match, otherwise
  prefix a `[locale] ` marker — TODO: real LLM translation.

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
    interpret.ts         mock free-text -> plan classifier
    translate.ts          stub translation boundaries
  styles.css
server/
  index.ts             Fastify API: intent/interpret, missions/run, health
docs/
  design.md            Full design spec (copied from foundline)
```

## TODO before this is more than a scaffold

- Real CALL-E integration for `POST /api/missions/run` (currently mock-only).
- Real LLM-based intent interpretation (currently keyword matching).
- Real LLM-based translation at the two locale boundaries.

## License

MIT
