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
import { getAnthropicClient, hasAnthropicKey, TRANSLATE_MODEL } from "../src/domain/llm.js";

const app = Fastify({ logger: true, bodyLimit: 64 * 1024 });
const port = Number(process.env.PORT || 8787);
const allowedPhoneNumbers = parseAllowedPhoneNumbers(process.env.CALLE_ALLOWED_NUMBERS);
const calleRegion = process.env.CALLE_REGION || "US";

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
  if (!hasAnthropicKey()) return "en";
  try {
    const client = getAnthropicClient();
    const response = await client.messages.create({
      model: TRANSLATE_MODEL,
      max_tokens: 16,
      system:
        "Identify the language of the user's text. Respond with ONLY its BCP-47 language code (e.g. es, fr, de, vi, tl). Nothing else.",
      messages: [{ role: "user", content: text.slice(0, 500) }]
    });
    const raw = (response.content.find((b) => b.type === "text")?.text ?? "").trim().toLowerCase();
    const match = raw.match(/[a-z]{2,3}(-[a-z]{2,4})?/);
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
// English in, or no ANTHROPIC_API_KEY, is always a no-op passthrough -- this
// route must never 500, since the intake flow depends on it not blocking.
app.post("/api/ui/localize", async (request, reply) => {
  const body = request.body as { locale?: unknown; strings?: unknown } | undefined;
  const locale = typeof body?.locale === "string" ? body.locale : "en";
  const strings: Record<string, string> =
    body?.strings && typeof body.strings === "object" && !Array.isArray(body.strings)
      ? (body.strings as Record<string, string>)
      : {};

  if (locale.toLowerCase().startsWith("en") || !hasAnthropicKey()) {
    return { strings };
  }

  const cached = uiLocalizeCache.get(locale);
  if (cached) {
    return { strings: cached };
  }

  try {
    const client = getAnthropicClient();
    const response = await client.messages.create({
      model: TRANSLATE_MODEL,
      max_tokens: 4096,
      system: [
        `Translate each value in the given JSON object of UI copy from English to the locale "${locale}".`,
        "Preserve meaning and tone -- this is interface copy (headings, labels, buttons, short sentences), not prose.",
        "Preserve any {placeholder}-style interpolation tokens exactly as written, and never translate the product name \"Warmline\".",
        "Respond with ONLY a JSON object using the exact same keys as the input, each value replaced by its translation. No commentary, no markdown fences."
      ].join(" "),
      messages: [{ role: "user", content: JSON.stringify(strings) }]
    });

    const text = response.content.find((block) => block.type === "text")?.text ?? "";
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
    return {
      missionId: mission.id,
      mode: "mock",
      results: mission.targets.map((_target, index) => template.mockResult(mission as never, index))
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
          recipient: { phone: target.phoneE164, region: calleRegion, locale: callLocale },
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
      // Boundary OUT: translate result strings callLocale -> userLocale (no-op when equal).
      const translated = await translateResultStrings(
        normalized as CallResult<unknown> & Record<string, unknown>,
        callLocale,
        mission.userLocale
      );
      results.push(translated);
    } catch (error) {
      request.log.error(error, `CALL-E failed for target ${target.id}`);
      results.push({
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
      });
    } finally {
      inFlightKeys.delete(idempotencyKey);
    }
  }

  return { missionId: mission.id, mode: "real", results };
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
