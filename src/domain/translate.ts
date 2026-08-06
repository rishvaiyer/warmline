// STUB translation layer. Per the design doc (section 5b), translation lives at
// exactly two boundaries: free-text mission fields going IN (userLocale ->
// callLocale) and result strings coming OUT (callLocale -> userLocale). Both are
// no-ops when the two locales match.
//
// TODO: replace both functions with a real LLM translation call. For now they
// return the input unchanged when from === to, and otherwise prefix a `[to] `
// marker so it's obvious in the UI that no real translation has happened yet.

function markString(value: string, from: string, to: string): string {
  if (from === to || value.trim().length === 0) return value;
  return `[${to}] ${value}`;
}

/**
 * Translate the free-text fields of a mission object from `from` to `to`.
 * Only touches string-valued fields; leaves ids, enums, phone numbers, and
 * non-string fields untouched. Shallow: does not recurse into nested targets.
 */
export function translateMissionFields<T extends Record<string, unknown>>(
  mission: T,
  from: string,
  to: string
): T {
  if (from === to) return mission;
  const translated: Record<string, unknown> = { ...mission };
  for (const [key, value] of Object.entries(mission)) {
    if (typeof value === "string") {
      translated[key] = markString(value, from, to);
    }
  }
  return translated as T;
}

/**
 * Translate the human-readable strings of a CallResult-shaped object from
 * `from` to `to`. Touches outcome-adjacent free text and the nested `data`
 * payload's string fields; leaves ids, timestamps, and enums untouched.
 */
export function translateResultStrings<T extends Record<string, unknown>>(
  result: T,
  from: string,
  to: string
): T {
  if (from === to) return result;

  const translated: Record<string, unknown> = { ...result };
  if (typeof translated.followUpInstructions === "string") {
    translated.followUpInstructions = markString(translated.followUpInstructions, from, to);
  }
  if (translated.data && typeof translated.data === "object") {
    const data = translated.data as Record<string, unknown>;
    const translatedData: Record<string, unknown> = { ...data };
    for (const [key, value] of Object.entries(data)) {
      if (typeof value === "string") {
        translatedData[key] = markString(value, from, to);
      } else if (Array.isArray(value)) {
        translatedData[key] = value.map((item) =>
          typeof item === "string" ? markString(item, from, to) : item
        );
      }
    }
    translated.data = translatedData;
  }
  return translated as T;
}
