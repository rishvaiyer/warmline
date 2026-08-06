# A calling agent for people who can't or won't make the call

**The product:** a trust-first phone concierge that calls businesses on your behalf and reports back,
so you never have to make the call yourself. Built for the people a phone call shuts out: **non-native
speakers** (operate the whole thing in your own language) and **people with phone anxiety** (you
approve every word, it makes the call, you just read the answer). By extension, anyone who finds calls
hard, draining, or inaccessible.

**What it does:** call anyone, for any permitted everyday reason, to get a real answer back. Finding a
lost item, asking for the earliest appointment, checking whether something is in stock, confirming
hours, and so on. Those are starting points, not a fixed menu. The engine is general; each use-case is
a lightweight **mission template** on top of it, and the safety model (section 9) is what keeps "call
anyone for any reason" honest.

**Why FoundLine already gets us most of the way:** the hard part is built. E.164 validation, server
allowlist, max-5 targets, idempotency, mock/real switch, the CALL-E adapter, and the "AI discloses
itself, never commits" safety model. Lost & Found becomes the first template; new errands are new
templates, not new plumbing.

---

## 1. The core idea: intent-first

The user just **says what they want, in any language.** The system translates the intent, works out a
plan, shows it for approval, makes the call on CALL-E, and reports the answer back in the user's
language. **Mission templates still exist, but they are auto-selected from the intent, not picked from
a menu.** Anything that does not match a known template runs on a **generic** template.

```
user writes intent (any language) + who to call
        |  translate intent -> callLocale, interpret into a plan
        v
"here is exactly what I'll ask, and who I'll call"  -> user approves   (safety + calms anxiety)
        |
        v
CALL-E places the call in callLocale
        |  extract structured result -> translate -> userLocale
        v
answer reported back in the user's language
```

The interpreter picks a template (appointment / reachability / lost item / generic) behind the scenes,
which sets the result shape and guardrails. The user never sees a mission menu. Adding a new sharpened
use-case is still one template file; the generic path means the product already handles requests no one
wrote a template for.

---

## 1b. Intent-first intake + plan review (the primary UX)

**Screen 1: one intent box.** "What do you want handled? Say it in any language." Plus the target(s)
to call (business name + phone in E.164) and an approval checkbox. That is the whole intake: no mission
picker, no per-field form. The *what* is free text; the *who* stays explicit because the safety model
requires user-selected targets + the allowlist.

**Interpret step.** The server turns the free-text intent into a plan:
`{ kind, fields, callGoal, disclosureLine }`. `kind` selects the template (or `generic`); `fields` are
whatever that template needs, pulled from the intent; `callGoal` is the callLocale instruction the
agent will follow; `disclosureLine` is the spoken AI disclosure in callLocale.

**Screen 2: plan review.** Show the user, in their own language, exactly what will happen: "I'll call
[venue] and ask: [callGoal in the user's language]. I'll say I'm an AI calling for you. I won't book or
pay anything." The user approves. This one screen is the safety gate and the anxiety-reducer at once.

**Then the normal engine runs** (section 7): translate in, call on CALL-E, extract, translate the
answer back to userLocale, display it.

New server surface: `POST /api/intent/interpret` returns `{ plan }`. It is the only addition; the run
route stays as in section 7, now receiving a `kind` + fields that came from the interpreter rather than
from a menu.

## 2. The MissionTemplate contract

New file `src/domain/template.ts`:

```ts
import { z } from "zod";
import type { TargetInput, BaseMission, CallResult } from "./base.js";

export interface MissionTemplate<TInput, TData> {
  kind: string;                 // "lost_and_found" | "appointment_scout" | "reachability"
  label: string;                // picker title
  blurb: string;                // one-line pitch in the picker
  intakeSchema: z.ZodType<TInput>;            // mission-only fields (base fields added by engine)
  resultSchema: Record<string, unknown>;      // JSON schema CALL-E extracts into
  outcomes: readonly string[];                // allowed outcome enum for this mission

  buildCallTask(mission: TInput & BaseMission, target: TargetInput): string;
  normalizeResult(target: TargetInput, provider: Record<string, unknown>): CallResult<TData>;
  rank(results: CallResult<TData>[]): CallResult<TData>[];   // ordering for the "best answer" view
  resultColumns: { key: string; label: string }[];          // how the unified table renders TData
  guards?(mission: TInput & BaseMission): void;              // extra validation; throws on violation
  mockResult(mission: TInput & BaseMission, targetIndex: number): CallResult<TData>;
}
```

---

## 3. Shared vs per-mission

| Concern | Today (in `domain.ts` / `server/index.ts`) | After |
|---|---|---|
| Target validation (`targetSchema`, E.164) | shared, lost-item defaults baked in | **shared** in `base.ts`, drop lost-item defaults |
| Mission id / disclosure / targets / **locale** | inside `missionSchema` | **shared** `baseMissionSchema` |
| Allowlist, idempotency, mock/real switch, run loop | `server/index.ts` | **shared**, unchanged |
| Mission fields (itemType, lostWindow, ...) | `missionSchema` | **per template** `intakeSchema` |
| Call script (`buildCallTask`) | lost-item wording | **per template** |
| Extraction schema (`calleResultSchema`) | lost-item fields | **per template** `resultSchema` |
| Outcome enum (`outcomeValues`) | one lost-item list | **per template** `outcomes` |
| `normalizeResult`, mock, ranking | lost-item only | **per template** |
| Safety base (AI disclosure, no payment/pickup/impersonation, no commitment) | inline in `buildCallTask` | **shared** helper injected into every template's task |
| `assertSafeDescription` (private-proof leak check) | shared | **lost-item guard only** |

---

## 4. Generalized base types

New file `src/domain/base.ts` (extracted from today's `domain.ts`):

```ts
export const targetSchema = z.object({
  id: z.string().min(1),
  venueName: z.string().trim().min(2).max(100),
  phoneE164: z.string().regex(/^\+[1-9]\d{7,14}$/, "Use E.164 format, such as +12025550123"),
  department: z.string().trim().max(80).optional(),   // was defaulted to "Lost and Found"
  approved: z.literal(true)
});

export const baseMissionSchema = z.object({
  id: z.string().min(1),
  kind: z.string(),                          // discriminator, selects the template
  userLocale: z.string().default("en-US"),   // the person's language: the UI and the report back
  callLocale: z.string().optional(),         // language spoken ON the call; defaults to userLocale
  disclosureAccepted: z.literal(true),
  targets: z.array(targetSchema).min(1).max(5)
});
export type BaseMission = z.infer<typeof baseMissionSchema>;
export type TargetInput = z.infer<typeof targetSchema>;

export type CallResult<TData = unknown> = {
  targetId: string;
  venueName: string;
  status: "completed" | "failed";
  outcome: string;
  confidence: "high" | "medium" | "low";
  evidence: string[];
  followUpRequired: boolean;
  followUpInstructions: string;
  completedAt: string;
  data: TData;                             // mission-specific payload
};

// The safety preamble every mission's call task must start with.
export function baseCallPreamble(mission: BaseMission, target: TargetInput): string[] {
  return [
    `Call ${target.venueName} at ${target.phoneE164}.`,
    "At the start, clearly say you are an AI assistant calling on someone's behalf.",
    "Do not impersonate the caller. Do not make payments, bookings, purchases, or any commitment.",
    "If the venue asks not to receive automated calls, apologize, end the call, and record the refusal."
  ];
}
```

Keep `parseAllowedPhoneNumbers` and `makeIdempotencyKey` in `base.ts` unchanged (drop the
`foundline_` literal from the key in favor of `${mission.kind}_`).

---

## 5. The three templates

Files under `src/domain/missions/`. Each is ~40 lines.

### 5.1 Lost & Found (`lostAndFound.ts`) - today's behavior, now a template
- **intake:** `itemType`, `safeDescription`, `privateProof`, `lostWindow`, `lastSeen`; `department` per target.
- **guard:** `assertSafeDescription` (unchanged private-proof leak check).
- **resultSchema:** today's `calleResultSchema` (outcome, department_reached, claim_reference, follow_up_*).
- **data:** `{ claimReference, departmentReached }`.
- **outcomes:** found, possible_match, not_found, closed, voicemail, refused, follow_up_required, unknown.
- **rank:** possible_match / found first, then confidence high→low.

### 5.2 Appointment Scout (`appointmentScout.ts`)
- **intake:** `service` (e.g. "dentist cleaning"), `earliestAcceptable` + `latestAcceptable` (date window),
  `partySize?`, `notes?`.
- **call goal:** ask for the **earliest availability** for the service within the window. **Explicitly:
  do not book or hold anything**, only report what is offered.
- **resultSchema:**
  ```json
  { "outcome": "enum", "earliest_slot": "string",
    "slots": { "type": "array", "items": { "type": "string" }, "maxItems": 5 },
    "notes": "string" }
  ```
- **data:** `{ earliest: string, slots: string[] }`.
- **outcomes:** slots_offered, none_available, callback_required, voicemail, refused, unknown.
- **rank:** by parsed `earliest` ascending (soonest first). Highlight the soonest as "best".

### 5.3 Reachability Check (`reachability.ts`)
- **intake:** `mode` (`open_now` | `price` | `stock` | `general`), `subject` (e.g. "large oat latte"),
  `question` (free text the agent asks).
- **call goal:** ask the single question, capture the answer verbatim, do not negotiate or commit.
- **resultSchema:**
  ```json
  { "outcome": "enum", "answer": "string", "price": "string",
    "open_now": "string", "in_stock": "string" }
  ```
- **data:** `{ answer, price?, openNow?, inStock? }`.
- **outcomes:** answered, unknown_to_staff, voicemail, refused, closed, unknown.
- **rank:** answered first; in `price` mode, cheapest parsed price first.

### 5.4 Generic (`generic.ts`) - the fallback for anything else
- **intake:** none beyond the free-text intent; the interpreter supplies `callGoal` directly.
- **call goal:** the interpreter's `callGoal`, wrapped in the shared safety preamble.
- **resultSchema:** `{ "outcome": "enum", "summary": "string", "details": "string", "follow_up": "string" }`.
- **data:** `{ summary, details }`.
- **outcomes:** answered, partial, refused, voicemail, closed, unknown.
- **rank:** answered first.

This template is what makes "call anyone for any permitted reason" real: no one has to have written a
template, the intent carries the goal, and the guardrails still apply.

> Note: confirm the CALL-E `resultSchema` accepts nested arrays (Appointment Scout `slots`). Today's
> schema is flat. If arrays are not supported, fall back to `slot_1..slot_5` string fields. **This is
> the one thing to test early.**

---

## 5b. Language: two independent knobs

"Multilingual" is really two separate settings, and conflating them is the usual mistake.

| Knob | Controls | Who does it | Reliability |
|---|---|---|---|
| **`userLocale`** | the website + the report back to the user | pure text translation (LLM) | rock solid, any language |
| **`callLocale`** | the language the agent *speaks on the phone* | the voice stack (TTS/STT) | depends on the voice provider |

The accessibility win (a Spanish speaker, or someone who just dreads calls, running the whole tool in
their own language) is the **`userLocale`** knob, and it has **zero dependency on the agent speaking
Spanish**. The call itself can happen in English.

**Translation lives at exactly two boundaries, nowhere else:**

```
user types in userLocale
      │  boundary IN: translate free-text fields  userLocale → callLocale
      ▼
call happens in callLocale  (CALL-E)
      │  boundary OUT: translate result strings   callLocale → userLocale
      ▼
user reads the report in userLocale
```

- **UI strings** (labels, buttons) are static per-language files keyed by `userLocale`. No AI.
- **Free-text fields** (item description, service wanted, the question) are translated to `callLocale`
  at the server boundary when building the call task. One small LLM pass.
- **Result strings** (outcome text, follow-up, slots) are translated back to `userLocale` before display.
- **Skip translation entirely when `callLocale === userLocale`** (Spanish user calling Spanish venues).
- The spoken **AI-disclosure line must be in `callLocale`**, and the agent should auto-detect and mirror
  the language the business actually answers in (they may reply in English regardless).

Default `callLocale = userLocale`, so "operate in Spanish, call Spanish businesses" just works, while
"operate in Spanish, call English businesses" is the same code with the two set differently.

## 6. Registry

`src/domain/registry.ts`:

```ts
import { lostAndFound } from "./missions/lostAndFound.js";
import { appointmentScout } from "./missions/appointmentScout.js";
import { reachability } from "./missions/reachability.js";

export const templates = { [lostAndFound.kind]: lostAndFound,
  [appointmentScout.kind]: appointmentScout, [reachability.kind]: reachability } as const;

export function getTemplate(kind: string) {
  const t = templates[kind as keyof typeof templates];
  if (!t) throw new Error(`Unknown mission kind: ${kind}`);
  return t;
}
```

---

## 7. Server changes (`server/index.ts`)

The route stays almost identical; it just resolves a template first.

```ts
app.post("/api/missions/run", async (request, reply) => {
  const base = baseMissionSchema.safeParse(request.body);
  if (!base.success) return reply.code(400).send(/* ...issues... */);

  const template = getTemplate(base.data.kind);                 // NEW
  const parsed = template.intakeSchema.safeParse(request.body); // per-mission fields
  if (!parsed.success) return reply.code(400).send(/* ...issues... */);
  const mission = { ...base.data, ...parsed.data };

  try { template.guards?.(mission); }                           // e.g. private-proof check
  catch (e) { return reply.code(422).send({ error: String(e.message) }); }

  if (!realCallsEnabled)
    return { missionId: mission.id, mode: "mock",
      results: mission.targets.map((_, i) => template.mockResult(mission, i)) };

  // ... allowlist + in-flight checks UNCHANGED ...
  const callLocale = mission.callLocale ?? mission.userLocale;

  // Boundary IN: user's free-text arrives in userLocale; the call happens in callLocale.
  // No-op when the two match.
  const localized = await translateMissionFields(mission, mission.userLocale, callLocale);

  const providerResult = await client.calls.createAndWait({
    task: template.buildCallTask(localized, target),           // was buildCallTask(...)
    recipient: { phone: target.phoneE164, region: calleRegion, locale: callLocale },
    resultSchema: template.resultSchema,                       // was calleResultSchema
    metadata: { workflow: mission.kind, mission_id: mission.id, target_id: target.id, idempotency_key }
  }, { idempotencyKey, timeoutMs: 10 * 60 * 1000 });

  const result = template.normalizeResult(target, providerResult);
  // Boundary OUT: human-readable strings go back in userLocale. No-op when the two match.
  results.push(await translateResultStrings(result, callLocale, mission.userLocale));
  // ...
});
```

`translateMissionFields` / `translateResultStrings` live in `src/domain/translate.ts` (a thin LLM
call, early-returns when `from === to`). They only touch human-readable strings, never phone numbers,
ids, enums, or the E.164/allowlist checks.

Everything else in the file (health, static serving, allowlist, idempotency) is untouched.

---

## 8. Frontend changes (`src/App.tsx`)

1. **Screen 1 - intent box + targets.** One free-text intent field (any language) + the target(s) to
   call (name + E.164) + approval. No mission picker (section 1b). Call `POST /api/intent/interpret`.
2. **Screen 2 - plan review.** Render the returned plan in the user's language (venue, the exact
   question, the disclosure, "won't book or pay"). Approve to run. This replaces the old per-field form
   and is the safety + anxiety gate.
3. **Language (two knobs, section 5b).** A language select sets `userLocale` (UI + report). An optional
   "call in a different language" control sets `callLocale` (defaults to `userLocale`). Prompt the agent
   to auto-detect and mirror the language the business actually answers in, and to speak the disclosure
   line in `callLocale`.
4. **Unified results view.** One table driven by `template.resultColumns`, rows ordered by
   `template.rank`, with the top row flagged as the answer ("soonest: Tue 9:40 AM", "cheapest: $4.25",
   "possible match: Security desk, ref FL-2213-1"). Keep the existing outcome chips + evidence
   disclosure.

---

## 9. Safety model (unchanged spirit, now explicit)

"Call anyone for any reason" only works because the reasons are bounded. The engine is general; the
**permitted-use policy** is what makes that safe.

- **Permitted purposes:** everyday errands where the caller could lawfully ask the same question
  themselves, and the venue would expect to be asked: availability, hours, stock, prices, lost
  property, general public info. New templates must fit this shape.
- **Not permitted (blocked or out of scope):** payments, bookings, purchases, or any commitment;
  impersonating the user; harassment, deception, or pressure; bulk/spam outreach; evading do-not-call;
  sensitive or regulated pretexting (medical, legal, financial account access); and, in the MVP,
  calling **individuals** rather than user-selected **businesses**.
- **Base guarantees (every mission):** discloses it is an AI; makes no commitment on the user's behalf;
  honors do-not-call; server allowlist + E.164 + max 5 targets + idempotency.
- **Lost & Found guard:** `assertSafeDescription` keeps private proof out of the call.
- **Appointment Scout:** reports availability only; **never books** (the user books after reviewing).
- **Reachability:** information only; no negotiation.

Everything is read-only toward the outside world: it asks and reports, it never commits. That
consistency is the pitch, not a limitation, and it is what lets the product help anxious and
multilingual users trust it with anything on the permitted list.

---

## 10. Migration plan (each step ships and keeps Lost & Found working)

1. **Extract base.** Move shared code to `base.ts`; wrap current lost-item logic as `lostAndFound`
   template; server reads `kind` (default `"lost_and_found"`). Behavior identical, no UI change.
2. **Registry + two mock templates.** Add `appointmentScout` + `reachability` with `mockResult` only.
   Reachable via API, mock mode. Confirm the `slots` array in `resultSchema` (section 5.3 note).
3. **Mission picker + dynamic intake** in the UI.
4. **Unified ranked results view** with per-mission columns and the "best" highlight.
5. **Per-mission locale + language picker** (folds in the multilingual work).
6. **Polish:** localized disclosure line, per-mission safety copy, empty/failed states.

Steps 1 and 4 are the load-bearing ones; 2, 3, 5, 6 are additive.

---

## 11. Scope guardrail (hackathon)

Ship: the template system + these three missions + the shared ranked-results view. Stop there. The
story is "one trustworthy calling agent with range," demoed as: pick mission → review disclosure →
watch it call → read one ranked answer. Do not add booking, payments, or a 4th mission before the demo.

## 12. Open questions
- **Naming.** FoundLine is lost-item-specific. Umbrella name for the product? (Dialback / Ringer / On Your Behalf / keep FoundLine as one mode.)
- **CALL-E arrays.** Does `resultSchema` support arrays for Appointment Scout `slots`? Test in step 2.
- **Locale coverage.** Confirm CALL-E's supported-language list before promising a language in the picker.
