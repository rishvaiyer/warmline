# Warmline, Devpost submission draft

Paste-ready copy for the CALL-E ("Your Code Is Calling") submission. Fill the
placeholders in **Submission checklist** at the bottom.

---

## Tagline

An accessibility-first calling concierge. Say what you need in any language,
Warmline makes the call and gives you the answer back in writing and in your own
language.

---

## Inspiration

A phone call is a small thing until it is not. If you are Deaf or hard of
hearing, if English is not your first language, or if calling a stranger fills
you with dread, "just call the clinic and ask when they open" can be a wall.
Millions of people put off appointments, benefits, and basic errands for exactly
this reason.

We wanted the wall to disappear. Not a better hold-music experience, not a
smarter IVR, but a concierge that takes the entire call off your plate and hands
you back only the answer, in words you can read, in the language you think in.
CALL-E made the hard part, actually reaching a human and holding a real
conversation, something we could build on instead of build.

## What it does

Warmline turns a sentence into a finished phone call.

1. **You say what you need, in any language.** Type "quiero una cita con mi
   dentista lo antes posible" and Warmline detects the language and offers to
   flip the entire interface into it. You can also pick your language from a
   switcher in the top-right at any time, so someone who cannot read the English
   form can switch first and fill it in after.
2. **You review a plan.** Warmline interprets your request into a concrete call
   goal (for example, "ask for the earliest appointment; do not book anything")
   and shows it to you. Nothing dials until you approve.
3. **CALL-E places the call, in the right language.** Its voice agent has the
   conversation, discloses itself as an AI, and returns a structured result.
4. **You get the answer in writing.** Results come back in your language and in
   English side by side, with a one-tap toggle, so an English-speaking friend or
   family member can read along.
5. **Or you hear it out loud.** If you would rather listen than read, Warmline
   can call you back and read the results aloud in your language.

The whole experience is typed and read, so a Deaf or hard-of-hearing person
never has to hear or speak on a call. It is, in effect, a modern, multilingual,
AI take on a relay service, built for anyone who finds phone calls hard.

## How we used CALL-E

CALL-E is the engine that lets Warmline actually reach a human. For every target
the user approves, Warmline calls `CalleClient.calls.createAndWait(...)` from the
`@call-e/calle` SDK (see `server/index.ts`) and passes:

- **`task`**: the per-mission call goal Warmline generated from the user's
  intent, always prefixed with a spoken AI-disclosure line and a hard rule that
  the agent must not book, pay, or commit to anything.
- **`recipient`**: the business phone in E.164, plus a **`locale`** and a
  **`region`**. This is the key to multilingual calling. CALL-E ties the language
  its agent *speaks* to the recipient region (Spanish under `MX`, Hindi under
  `IN`, Arabic under `AE`, and so on), so Warmline maps the chosen call language
  to a region CALL-E supports it in (`regionForCallLocale`). That is how the call
  can happen in a different language than the caller's own interface.
- **`resultSchema`**: the mission's structured-output schema, so CALL-E returns
  typed fields (availability, price, outcome, evidence) instead of a wall of
  text, which Warmline can render, translate, and read aloud reliably.
- **`metadata`** and an **`idempotencyKey`**: so every call is traceable and can
  never be accidentally placed twice.

We use CALL-E twice in the same flow: once to call the **business** and get the
answer, and again, optionally, to call the **user back** and deliver that answer
as speech in their language. The structured result CALL-E returns is what makes
the second call trustworthy, we are reading back typed fields, not improvising.

CALL-E's `region` plus `locale` model is what turns "an English calling bot" into
"a calling concierge that meets people in their language on both ends of the
call."

## How we built it

- **Frontend**: React 19 + TypeScript + Vite, with a calm three-screen flow
  (describe, review, results) on a warm, editorial design system.
- **Backend**: a Fastify server exposing intent interpretation, live UI
  localization, the CALL-E call path, and the voice-callback route.
- **Language everywhere**: the UI ships only English source strings; every other
  language is produced live by an LLM and cached. Two independent "language
  knobs" (the interface/report language and the on-call language) are translated
  at each boundary.
- **Provider-agnostic LLM layer**: Warmline runs on either an Anthropic or an
  OpenAI key, chosen at runtime, and degrades gracefully to offline keyword and
  script-based fallbacks when no key is present.
- **Safety by construction**: approval-first review, spoken AI disclosure, a
  server-side number allowlist, E.164 validation, a five-target cap, per-call
  idempotency keys, and real calls off by default (mock engine otherwise).

## Challenges we ran into

- **Making language invisible.** The hard part was not translating strings, it
  was the choreography: detect the language from what someone typed, flip the
  page without a jarring reload, show a loading state that already speaks their
  language, and keep an English copy for a helper, all without the user ever
  touching a settings menu.
- **Speaking the right language on the call.** Learning that CALL-E scopes spoken
  language to `region`, not just `locale`, and mapping our language picker onto
  the regions CALL-E supports.
- **Trust.** "Call anyone on my behalf" is powerful and scary. Most of the work
  was the guardrails that make it safe to hand a phone call to software.

## Accomplishments we are proud of

- A calling tool that a Deaf or hard-of-hearing person can use end to end without
  ever hearing or speaking.
- A UI that localizes itself into the user's language automatically, on both the
  screen and the phone call.
- Answers delivered three ways: in the user's language, in English, and as a
  spoken callback.

## What we learned

Accessibility is not a feature you add at the end, it is the shape of the whole
product. Once we designed for someone who cannot hear, cannot speak comfortably,
or cannot read English, the product got simpler and better for everyone.

## What's next

Deeper call transcripts surfaced as text, more mission templates, and continued
work on making the spoken callback as natural as possible across languages.

---

## Submission checklist

- [ ] **GitHub Pull Request** to the "Awesome Phone Call Agents" repo, in the
      right category (follow that repo's README).
- [ ] **Demo video** (~3 min, public on YouTube or Vimeo). Show: typing a
      request in Spanish, the page flipping, approving the plan, a real CALL-E
      call landing, and the bilingual result plus the voice callback.
- [ ] **CALL-E account email**: `__________`
- [ ] **Project description**: the sections above.
- [ ] **Live demo URL**: https://warmline-production-a583.up.railway.app/
- [ ] **Repository**: https://github.com/rishvaiyer/warmline

> Note for the video: real calls require `CALLE_API_KEY` set on the server (with
> `ALLOW_REAL_CALLS=true` and the target number allowlisted). Until then the app
> runs its deterministic mock engine.
