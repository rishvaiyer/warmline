// Translation layer. Per the design doc (section 5b), translation lives at
// exactly two boundaries: free-text mission fields going IN (userLocale ->
// callLocale) and result strings coming OUT (callLocale -> userLocale). Both
// are no-ops when the two locales match.
//
// Real path: a single batched LLM call (see src/domain/llm.ts) per boundary,
// translating only human-readable string values -- never ids, kind
// discriminators, locale codes, enum-valued fields, or phone numbers. Falls
// back to the marker-stub (`[to] ...`) when no ANTHROPIC_API_KEY is
// configured, or if the LLM call fails for any reason.

import { getAnthropicClient, hasAnthropicKey, TRANSLATE_MODEL } from "./llm.js";

function markString(value: string, from: string, to: string): string {
  if (from === to || value.trim().length === 0) return value;
  return `[${to}] ${value}`;
}

function markBatch(values: Record<string, string>, from: string, to: string): Record<string, string> {
  const marked: Record<string, string> = {};
  for (const [key, value] of Object.entries(values)) {
    marked[key] = markString(value, from, to);
  }
  return marked;
}

function extractJson(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return fenced ? fenced[1].trim() : trimmed;
}

// Translates a flat map of key -> free-text string in a single LLM call, and
// returns a map with the same keys. Never touches non-string data, since only
// strings are ever passed in.
async function translateBatch(
  values: Record<string, string>,
  from: string,
  to: string
): Promise<Record<string, string>> {
  const keys = Object.keys(values);
  if (keys.length === 0) return {};

  if (!hasAnthropicKey()) {
    return markBatch(values, from, to);
  }

  try {
    const client = getAnthropicClient();
    const response = await client.messages.create({
      model: TRANSLATE_MODEL,
      max_tokens: 2048,
      system: [
        `Translate each value in the given JSON object from locale "${from}" to locale "${to}".`,
        "Preserve meaning and tone. Keep proper nouns, phone numbers, dates, and reference codes unchanged unless a locale-appropriate form is obviously expected.",
        "Respond with ONLY a JSON object using the exact same keys as the input, each value replaced by its translation. No commentary, no markdown fences."
      ].join(" "),
      messages: [{ role: "user", content: JSON.stringify(values) }]
    });

    const text = response.content.find((block) => block.type === "text")?.text ?? "";
    const parsed = JSON.parse(extractJson(text)) as Record<string, unknown>;

    const result: Record<string, string> = {};
    for (const key of keys) {
      const translatedValue = parsed[key];
      result[key] =
        typeof translatedValue === "string" && translatedValue.trim().length > 0
          ? translatedValue
          : values[key];
    }
    return result;
  } catch (error) {
    console.error("translateBatch: LLM call failed, falling back to marker stub", error);
    return markBatch(values, from, to);
  }
}

// Mission keys that are never free text: ids, the kind discriminator, locale
// codes, and known enum-valued intake fields (reachability's `mode`). Target
// phone numbers/ids live in a nested array and are already untouched since
// this only looks at top-level string fields.
const PROTECTED_MISSION_KEYS = new Set(["id", "kind", "userLocale", "callLocale", "mode"]);

/**
 * Translate the free-text fields of a mission object from `from` to `to`.
 * Only touches string-valued fields that are not ids, the kind discriminator,
 * locale codes, or known enums; leaves phone numbers and non-string fields
 * untouched. Shallow: does not recurse into nested targets.
 */
export async function translateMissionFields<T extends Record<string, unknown>>(
  mission: T,
  from: string,
  to: string
): Promise<T> {
  if (from === to) return mission;

  const toTranslate: Record<string, string> = {};
  for (const [key, value] of Object.entries(mission)) {
    if (typeof value === "string" && value.trim().length > 0 && !PROTECTED_MISSION_KEYS.has(key)) {
      toTranslate[key] = value;
    }
  }

  const translatedValues = await translateBatch(toTranslate, from, to);

  const translated: Record<string, unknown> = { ...mission };
  for (const [key, value] of Object.entries(translatedValues)) {
    translated[key] = value;
  }
  return translated as T;
}

/**
 * Translate the human-readable strings of a CallResult-shaped object from
 * `from` to `to`. Touches follow-up instructions and the nested `data`
 * payload's string/string-array fields; leaves ids, timestamps, status, and
 * outcome enums untouched.
 */
export async function translateResultStrings<T extends Record<string, unknown>>(
  result: T,
  from: string,
  to: string
): Promise<T> {
  if (from === to) return result;

  const flat: Record<string, string> = {};

  const followUp = result.followUpInstructions;
  if (typeof followUp === "string" && followUp.trim().length > 0) {
    flat.followUpInstructions = followUp;
  }

  const data =
    result.data && typeof result.data === "object" ? (result.data as Record<string, unknown>) : undefined;
  if (data) {
    for (const [key, value] of Object.entries(data)) {
      if (typeof value === "string" && value.trim().length > 0) {
        flat[`data.${key}`] = value;
      } else if (Array.isArray(value)) {
        value.forEach((item, index) => {
          if (typeof item === "string" && item.trim().length > 0) {
            flat[`data.${key}.${index}`] = item;
          }
        });
      }
    }
  }

  const translatedValues = await translateBatch(flat, from, to);

  const translated: Record<string, unknown> = { ...result };
  if (typeof translatedValues.followUpInstructions === "string") {
    translated.followUpInstructions = translatedValues.followUpInstructions;
  }

  if (data) {
    const translatedData: Record<string, unknown> = { ...data };
    for (const [key, value] of Object.entries(data)) {
      if (typeof value === "string" && value.trim().length > 0) {
        const t = translatedValues[`data.${key}`];
        if (typeof t === "string") translatedData[key] = t;
      } else if (Array.isArray(value)) {
        translatedData[key] = value.map((item, index) => {
          if (typeof item === "string" && item.trim().length > 0) {
            const t = translatedValues[`data.${key}.${index}`];
            return typeof t === "string" ? t : item;
          }
          return item;
        });
      }
    }
    translated.data = translatedData;
  }

  return translated as T;
}
