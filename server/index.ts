import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { CalleClient } from "@call-e/calle";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  baseMissionSchema,
  makeIdempotencyKey,
  parseAllowedPhoneNumbers,
  type CallResult
} from "../src/domain/base.js";
import { getTemplate } from "../src/domain/registry.js";
import { interpretIntent } from "../src/domain/interpret.js";
import { translateMissionFields, translateResultStrings } from "../src/domain/translate.js";
import { llmComplete, hasLLMKey } from "../src/domain/llm.js";

const app = Fastify({ logger: true, bodyLimit: 64 * 1024 });
const port = Number(process.env.PORT || 8787);
const allowedPhoneNumbers = parseAllowedPhoneNumbers(process.env.CALLE_ALLOWED_NUMBERS);
const calleRegion = process.env.CALLE_REGION || "US";
// Canonical English tag used as the "friend/family can read it too" copy of
// every result, and as the source language of the mock engine's text.
const ENGLISH_LOCALE = "en-US";

// CALL-E ties the language its voice agent SPEAKS to the recipient region:
// Spanish lives under MX, Hindi under IN, Arabic under AE, and so on (see
// github.com/CALLE-AI/call-e-integrations). So to place a call in the
// person's language we can't just send a `locale` -- we also have to pick a
// `region` that CALL-E supports that language in. This maps a call language
// (bare code or BCP-47 like "es"/"hi-IN") to such a region. Anything we don't
// have a documented mapping for falls back to CALLE_REGION (default US/English)
// rather than guessing a region CALL-E might reject.
const CALLE_SUPPORTED_REGIONS = new Set(["US", "MX", "IN", "AE", "VN", "JP", "SG"]);
const LANGUAGE_TO_CALLE_REGION: Record<string, string> = {
  en: "US", // English
  es: "MX", // Spanish
  hi: "IN", // Hindi
  gu: "IN", // Gujarati
  pa: "IN", // Punjabi
  bn: "IN", // Bengali
  ta: "IN", // Tamil
  te: "IN", // Telugu
  ur: "AE", // Urdu
  ar: "AE", // Arabic
  fa: "AE", // Persian
  vi: "VN", // Vietnamese
  ja: "JP", // Japanese
  zh: "SG" // Chinese (Mandarin, via Singapore)
};

// Pick the CALL-E region for a given call language. If the locale already
// carries a region CALL-E supports (e.g. "es-MX"), honor it; otherwise map by
// language; otherwise fall back to the configured default.
function regionForCallLocale(callLocale: string | undefined): string {
  if (!callLocale) return calleRegion;
  const [langPart, regionPart] = callLocale.split("-");
  const explicitRegion = regionPart?.toUpperCase();
  if (explicitRegion && CALLE_SUPPORTED_REGIONS.has(explicitRegion)) return explicitRegion;
  return LANGUAGE_TO_CALLE_REGION[langPart?.toLowerCase() ?? ""] ?? calleRegion;
}

// In-memory cache of translated UI-string bundles, keyed by target locale.
// Never persisted; a server restart just re-translates on next use.
const uiLocalizeCache = new Map<string, Record<string, string>>();

function extractJsonBlock(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return fenced ? fenced[1].trim() : trimmed;
}

// Real calls require the explicit opt-in flag, a CALL-E API key, AND at least
// one server-side allowlisted number. If any of those is missing, the server
// stays in mock mode -- that is the default and the safe fallback.
const realCallsEnabled =
  process.env.ALLOW_REAL_CALLS === "true" &&
  Boolean(process.env.CALLE_API_KEY) &&
  allowedPhoneNumbers.size > 0;

const inFlightKeys = new Set<string>();

let calleClient: CalleClient | undefined;
function getCalleClient(): CalleClient {
  if (!calleClient) {
    calleClient = new CalleClient({ apiKey: process.env.CALLE_API_KEY as string });
  }
  return calleClient;
}

app.get("/api/health", async () => ({
  ok: true,
  mode: realCallsEnabled ? "real" : "mock",
  realCallsConfigured: realCallsEnabled,
  realCallProtection: realCallsEnabled ? "server_allowlist" : "disabled"
}));

app.post("/api/intent/interpret", async (request, reply) => {
  const body = request.body as { text?: unknown; userLocale?: unknown } | undefined;
  const text = typeof body?.text === "string" ? body.text : "";
  const userLocale = typeof body?.userLocale === "string" ? body.userLocale : "en-US";

  if (text.trim().length < 3) {
    return reply.code(400).send({ error: "Describe what you need in a bit more detail." });
  }

  const plan = await interpretIntent(text, userLocale);
  return { plan };
});

// Detect the language of a piece of text by its script (offline, no key needed).
function detectLocaleByScript(text: string): string | null {
  const ranges: Array<[RegExp, string]> = [
    [/[઀-૿]/, "gu"], // Gujarati
    [/[ऀ-ॿ]/, "hi"], // Devanagari
    [/[ঀ-৿]/, "bn"], // Bengali
    [/[਀-੿]/, "pa"], // Gurmukhi (Punjabi)
    [/[஀-௿]/, "ta"], // Tamil
    [/[ఀ-౿]/, "te"], // Telugu
    [/[ഀ-ൿ]/, "ml"], // Malayalam
    [/[؀-ۿ]/, "ar"], // Arabic script
    [/[֐-׿]/, "he"], // Hebrew
    [/[가-힣]/, "ko"], // Hangul
    [/[぀-ヿ]/, "ja"], // Kana
    [/[一-鿿]/, "zh"], // CJK Han
    [/[Ѐ-ӿ]/, "ru"], // Cyrillic
    [/[Ͱ-Ͽ]/, "el"], // Greek
    [/[฀-๿]/, "th"], // Thai
    [/[԰-֏]/, "hy"], // Armenian
    [/[Ⴀ-ჿ]/, "ka"], // Georgian
    [/[ក-៿]/, "km"], // Khmer
    [/[က-႟]/, "my"], // Burmese
    [/[ሀ-፿]/, "am"] // Ethiopic (Amharic)
  ];
  for (const [re, code] of ranges) {
    if (re.test(text)) return code;
  }
  return null;
}

async function detectLocale(text: string): Promise<string> {
  const byScript = detectLocaleByScript(text);
  if (byScript) return byScript;
  if (!hasLLMKey()) return "en";
  try {
    const raw = await llmComplete({
      system:
        "Identify the language of the user's text. Respond with ONLY its BCP-47 language code (e.g. es, fr, de, vi, tl). Nothing else.",
      user: text.slice(0, 500),
      maxTokens: 16
    });
    const lower = raw.trim().toLowerCase();
    const match = lower.match(/[a-z]{2,3}(-[a-z]{2,4})?/);
    return match ? match[0] : "en";
  } catch {
    return "en";
  }
}

// Lightweight detection for the on-blur auto-localize trigger. Never 500s.
app.post("/api/intent/detect", async (request) => {
  const body = request.body as { text?: unknown } | undefined;
  const text = typeof body?.text === "string" ? body.text : "";
  if (text.trim().length < 3) return { detectedLocale: "en" };
  return { detectedLocale: await detectLocale(text) };
});

// Auto-localizes the whole UI to whatever language the person typed their
// request in (see src/i18n/strings.ts for the EN bundle this translates).
// English in, or no LLM key configured, is always a no-op passthrough -- this
// route must never 500, since the intake flow depends on it not blocking.
app.post("/api/ui/localize", async (request, reply) => {
  const body = request.body as { locale?: unknown; strings?: unknown } | undefined;
  const locale = typeof body?.locale === "string" ? body.locale : "en";
  const strings: Record<string, string> =
    body?.strings && typeof body.strings === "object" && !Array.isArray(body.strings)
      ? (body.strings as Record<string, string>)
      : {};

  if (locale.toLowerCase().startsWith("en") || !hasLLMKey()) {
    return { strings };
  }

  const cached = uiLocalizeCache.get(locale);
  if (cached) {
    return { strings: cached };
  }

  try {
    const text = await llmComplete({
      system: [
        `Translate each value in the given JSON object of UI copy from English to the locale "${locale}".`,
        "Preserve meaning and tone -- this is interface copy (headings, labels, buttons, short sentences), not prose.",
        "Preserve any {placeholder}-style interpolation tokens exactly as written, and never translate the product name \"Warmline\".",
        "Respond with ONLY a JSON object using the exact same keys as the input, each value replaced by its translation. No commentary, no markdown fences."
      ].join(" "),
      user: JSON.stringify(strings),
      maxTokens: 4096,
      json: true
    });

    const parsed = JSON.parse(extractJsonBlock(text)) as Record<string, unknown>;

    const result: Record<string, string> = {};
    for (const key of Object.keys(strings)) {
      const translatedValue = parsed[key];
      result[key] =
        typeof translatedValue === "string" && translatedValue.trim().length > 0
          ? translatedValue
          : strings[key];
    }

    uiLocalizeCache.set(locale, result);
    return { strings: result };
  } catch (error) {
    request.log.error(error, "UI localize failed, falling back to English strings");
    return { strings };
  }
});

app.post("/api/missions/run", async (request, reply) => {
  const base = baseMissionSchema.safeParse(request.body);
  if (!base.success) {
    return reply.code(400).send({
      error: "Mission validation failed",
      issues: base.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message
      }))
    });
  }

  let template;
  try {
    template = getTemplate(base.data.kind);
  } catch (error) {
    return reply.code(400).send({ error: String((error as Error).message) });
  }

  const parsed = template.intakeSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({
      error: "Mission validation failed",
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message
      }))
    });
  }

  const mission = { ...base.data, ...(parsed.data as Record<string, unknown>) } as typeof base.data &
    Record<string, unknown>;

  try {
    template.guards?.(mission as never);
  } catch (error) {
    return reply.code(422).send({ error: String((error as Error).message) });
  }

  if (!realCallsEnabled) {
    // Mock engine speaks English; also render it in the person's language so
    // they read the outcome in their own words, while keeping the English copy
    // for an English-speaking friend or family member helping them.
    const english = mission.targets.map((_target, index) =>
      template.mockResult(mission as never, index)
    );
    const inUserLocale = await Promise.all(
      english.map((result) =>
        translateResultStrings(
          result as CallResult<unknown> & Record<string, unknown>,
          ENGLISH_LOCALE,
          mission.userLocale
        )
      )
    );
    return {
      missionId: mission.id,
      mode: "mock",
      results: inUserLocale,
      resultsEnglish: english
    };
  }

  const disallowedTargets = mission.targets.filter(
    (target) => !allowedPhoneNumbers.has(target.phoneE164)
  );
  if (disallowedTargets.length > 0) {
    return reply.code(403).send({
      error: "Real call blocked. Every recipient must be included in the server-side CALLE_ALLOWED_NUMBERS list."
    });
  }

  const callLocale = mission.callLocale ?? mission.userLocale;
  // Boundary IN: translate free-text fields userLocale -> callLocale (no-op when equal).
  const localizedMission = await translateMissionFields(mission, mission.userLocale, callLocale);

  const client = getCalleClient();
  const results: CallResult<unknown>[] = [];
  const resultsEnglish: CallResult<unknown>[] = [];

  for (const target of mission.targets) {
    const idempotencyKey = makeIdempotencyKey(mission.kind, mission.id, target.id);
    if (inFlightKeys.has(idempotencyKey)) {
      return reply.code(409).send({ error: `Duplicate call blocked for ${target.venueName}.` });
    }

    inFlightKeys.add(idempotencyKey);
    try {
      const providerResult = await client.calls.createAndWait(
        {
          task: template.buildCallTask(localizedMission as never, target),
          recipient: {
            phone: target.phoneE164,
            region: regionForCallLocale(callLocale),
            locale: callLocale
          },
          resultSchema: template.resultSchema,
          metadata: {
            workflow: mission.kind,
            mission_id: mission.id,
            target_id: target.id,
            idempotency_key: idempotencyKey
          }
        },
        { idempotencyKey, timeoutMs: 10 * 60 * 1000 }
      );

      const normalized = template.normalizeResult(
        target,
        providerResult as unknown as Record<string, unknown>
      );
      // Boundary OUT: translate result strings callLocale -> userLocale (no-op
      // when equal), plus an English copy for a friend/family helper.
      const normalizedResult = normalized as CallResult<unknown> & Record<string, unknown>;
      const [translated, translatedEnglish] = await Promise.all([
        translateResultStrings(normalizedResult, callLocale, mission.userLocale),
        translateResultStrings(normalizedResult, callLocale, ENGLISH_LOCALE)
      ]);
      results.push(translated);
      resultsEnglish.push(translatedEnglish);
    } catch (error) {
      request.log.error(error, `CALL-E failed for target ${target.id}`);
      const failure: CallResult<unknown> = {
        targetId: target.id,
        venueName: target.venueName,
        status: "failed",
        outcome: "unknown",
        confidence: "low",
        evidence: [],
        followUpRequired: true,
        followUpInstructions: "The call did not complete. Review the error before retrying.",
        completedAt: new Date().toISOString(),
        data: {} as never
      };
      results.push(failure);
      resultsEnglish.push(failure);
    } finally {
      inFlightKeys.delete(idempotencyKey);
    }
  }

  return { missionId: mission.id, mode: "real", results, resultsEnglish };
});

// Voice callback: after the task is done, Warmline can call the PERSON back and
// read them the outcome out loud, in their own language -- for anyone who would
// rather hear it than read it. Same allowlist + real-calls gating as any other
// call; mock mode just acknowledges without dialing.
app.post("/api/missions/callback", async (request, reply) => {
  const body = (request.body ?? {}) as { phoneE164?: string; locale?: string; summary?: string };
  const phone = (body.phoneE164 ?? "").trim();
  const locale = (body.locale ?? "en-US").trim() || "en-US";
  const summary = (body.summary ?? "").trim();

  if (!/^\+[1-9]\d{7,14}$/.test(phone)) {
    return reply.code(400).send({ error: "A phone number in E.164 format is required (e.g. +12025550123)." });
  }
  if (!summary) {
    return reply.code(400).send({ error: "There is nothing to read back yet." });
  }

  if (!realCallsEnabled) {
    return { mode: "mock", status: "queued" };
  }
  if (!allowedPhoneNumbers.has(phone)) {
    return reply.code(403).send({
      error: "Callback blocked. Your number must be on the server-side CALLE_ALLOWED_NUMBERS list."
    });
  }

  const idempotencyKey = makeIdempotencyKey("callback", phone, String(summary.length));
  if (inFlightKeys.has(idempotencyKey)) {
    return reply.code(409).send({ error: "A callback to this number is already in progress." });
  }
  inFlightKeys.add(idempotencyKey);

  const task = [
    "You are Warmline, an automated AI assistant, calling the person who asked you to handle a task.",
    `Speak entirely in the recipient's own language (locale: ${locale}).`,
    "First, warmly say that this is an automated call from Warmline with the results of their request, and that they do not need to do anything.",
    "Then read them this outcome, clearly and briefly:",
    summary,
    "Do not ask them for any information, and do not take any action on their behalf. When you have delivered the message, thank them and end the call."
  ].join("\n");

  try {
    await getCalleClient().calls.createAndWait(
      {
        task,
        recipient: { phone, region: regionForCallLocale(locale), locale },
        resultSchema: {
          type: "object",
          additionalProperties: false,
          required: ["delivered"],
          properties: { delivered: { type: "boolean" } }
        },
        metadata: { workflow: "callback", idempotency_key: idempotencyKey }
      },
      { idempotencyKey, timeoutMs: 5 * 60 * 1000 }
    );
    return { mode: "real", status: "delivered" };
  } catch (error) {
    request.log.error(error, "Warmline callback failed");
    return reply.code(502).send({ error: "The callback could not be completed." });
  } finally {
    inFlightKeys.delete(idempotencyKey);
  }
});

const webRoot = resolve(process.cwd(), "dist");
if (existsSync(webRoot)) {
  await app.register(fastifyStatic, {
    root: webRoot,
    wildcard: false
  });

  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith("/api/")) {
      return reply.code(404).send({ error: "Not found" });
    }
    return reply.sendFile("index.html");
  });
}

await app.listen({ port, host: "0.0.0.0" });
