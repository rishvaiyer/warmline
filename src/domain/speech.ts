// Warmline's ear: turns a recording of someone saying what they need into
// text, in whatever language they said it in, and reports back which language
// that was.
//
// Provider-agnostic in the same shape as llm.ts, and resolved the same way --
// by which key happens to be present:
//
//   ELEVENLABS_API_KEY -> ElevenLabs Scribe v2 (90+ languages, and the only
//                         provider that returns a CONFIDENCE score for the
//                         language it detected, which is what lets us refuse
//                         to flip the interface on a doubtful guess)
//   OPENAI_API_KEY     -> OpenAI transcription, reusing the key the app
//                         already uses for interpretation and translation, so
//                         voice input costs no new account and no new secret
//   neither            -> the microphone never appears
//
// "No key configured" is decided in one place, hasSpeechKey(), so the client
// can hide the microphone rather than offer a button that fails on tap.
//
// Speaking is always an ADDITION, never a requirement. Warmline's promise is
// that the entire flow works without hearing or speaking, so nothing here is
// ever on the critical path: a failed transcription leaves the textarea alone.

import { openaiKey, getOpenAIClient } from "./llm.js";
import { toFile } from "openai";

const API_ROOT = "https://api.elevenlabs.io/v1";

// Scribe v2 covers 90+ languages and returns the detected language with the
// transcript, which is exactly the pair Warmline needs: the words to interpret,
// and the language to flip the interface into.
export const DEFAULT_STT_MODEL = "scribe_v2";

// OpenAI's fallback transcription model. gpt-transcribe reports the language
// it detected alongside the transcript, which is what Warmline needs; whisper-1
// reports language NAMES ("english") rather than codes, so it is not the
// default here.
export const DEFAULT_OPENAI_STT_MODEL = "gpt-transcribe";

// Ceiling on an uploaded clip. The intake box is a sentence or two spoken
// aloud, so this is generous; it exists to stop a pathological upload.
export const MAX_AUDIO_BYTES = 10 * 1024 * 1024;

// Thrown when speech is simply not available (no key, empty clip). Callers
// turn this into a 503/400 rather than a 502, so the client can tell "not
// configured" apart from "the provider failed".
export class SpeechUnavailableError extends Error {}

// Accept the correct name plus the misspellings a key is likely to be pasted
// under, the same tolerance llm.ts extends to the OpenAI key.
export function elevenLabsKey(): string | undefined {
  for (const name of [
    "ELEVENLABS_API_KEY",
    "ELEVEN_LABS_API_KEY",
    "ELEVENLABS_KEY",
    "XI_API_KEY"
  ]) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return undefined;
}

export type SpeechProvider = "elevenlabs" | "openai";

// ElevenLabs wins when both keys are present: Scribe is stronger on the
// non-English languages Warmline exists for, and it is the only one of the two
// that scores its own language guess.
export function speechProvider(): SpeechProvider | null {
  if (elevenLabsKey()) return "elevenlabs";
  if (openaiKey()) return "openai";
  return null;
}

export function hasSpeechKey(): boolean {
  return speechProvider() !== null;
}

function sttModel(): string {
  return process.env.ELEVENLABS_STT_MODEL?.trim() || DEFAULT_STT_MODEL;
}

function openaiSttModel(): string {
  return process.env.OPENAI_STT_MODEL?.trim() || DEFAULT_OPENAI_STT_MODEL;
}

export type TranscribeRequest = {
  audio: Buffer;
  /** MIME type the browser recorded in, e.g. "audio/webm" or "audio/mp4". */
  mimeType: string;
};

export type Transcription = {
  text: string;
  /** Bare language code Scribe detected, e.g. "es". "" when unreported. */
  languageCode: string;
  /** Scribe's confidence in that language, 0 to 1. 0 when unreported. */
  languageProbability: number;
};

// A file extension Scribe will accept, derived from what the browser recorded.
// Chrome gives audio/webm, Safari gives audio/mp4; anything unexpected is sent
// as .webm rather than guessed at, since Scribe sniffs the content anyway.
function extensionFor(mimeType: string): string {
  const base = mimeType.split(";")[0].trim().toLowerCase();
  const byType: Record<string, string> = {
    "audio/webm": "webm",
    "audio/ogg": "ogg",
    "audio/mp4": "mp4",
    "audio/mpeg": "mp3",
    "audio/mpga": "mp3",
    "audio/wav": "wav",
    "audio/x-wav": "wav",
    "audio/flac": "flac"
  };
  return byType[base] ?? "webm";
}

function normalizeMimeType(mimeType: string): string {
  return mimeType.split(";")[0].trim() || "audio/webm";
}

// Transcribe a spoken request. Language is deliberately NOT pinned on either
// provider: the whole point is that someone can say what they need in any
// language without first telling us which one.
export async function transcribeSpeech(request: TranscribeRequest): Promise<Transcription> {
  const provider = speechProvider();
  if (!provider) {
    throw new SpeechUnavailableError("No speech-to-text key is configured.");
  }
  if (request.audio.byteLength === 0) {
    throw new SpeechUnavailableError("The recording was empty.");
  }
  return provider === "elevenlabs"
    ? transcribeWithElevenLabs(request)
    : transcribeWithOpenAI(request);
}

// Accepts either a single `language` or a `languages` array, in whichever
// shape the model returns, and only trusts a value that actually looks like a
// language code. whisper-1 reports names ("english") rather than codes; those
// are dropped rather than mapped back, because returning "" here simply hands
// the job to the existing text-based detector, which already handles it.
function firstLanguageCode(response: Record<string, unknown>): string {
  const candidates: unknown[] = [];
  if (Array.isArray(response.languages)) candidates.push(...response.languages);
  candidates.push(response.language);

  for (const candidate of candidates) {
    const raw =
      typeof candidate === "string"
        ? candidate
        : typeof (candidate as { code?: unknown } | null)?.code === "string"
          ? (candidate as { code: string }).code
          : "";
    const lang = raw.split("-")[0].toLowerCase();
    if (/^[a-z]{2,3}$/.test(lang)) return lang;
  }
  return "";
}

// OpenAI reports a detected language but no confidence score, so a language it
// names is taken at face value. When it names nothing usable we return "" and
// let /api/intent/detect work the language out from the transcript instead --
// the same path a typed request already takes, so nothing is lost.
async function transcribeWithOpenAI(request: TranscribeRequest): Promise<Transcription> {
  const mimeType = normalizeMimeType(request.mimeType);
  const file = await toFile(request.audio, `request.${extensionFor(mimeType)}`, {
    type: mimeType
  });

  const response = (await getOpenAIClient().audio.transcriptions.create({
    file,
    model: openaiSttModel()
  })) as unknown as Record<string, unknown>;

  const text = typeof response.text === "string" ? response.text.trim() : "";
  const languageCode = firstLanguageCode(response);

  return { text, languageCode, languageProbability: languageCode ? 1 : 0 };
}

async function transcribeWithElevenLabs(request: TranscribeRequest): Promise<Transcription> {
  const apiKey = elevenLabsKey();
  if (!apiKey) {
    throw new SpeechUnavailableError("No ElevenLabs API key is configured.");
  }

  const mimeType = normalizeMimeType(request.mimeType);
  const form = new FormData();
  form.append("model_id", sttModel());
  form.append(
    "file",
    new Blob([new Uint8Array(request.audio)], { type: mimeType }),
    `request.${extensionFor(mimeType)}`
  );

  const response = await fetch(`${API_ROOT}/speech-to-text`, {
    method: "POST",
    headers: { "xi-api-key": apiKey },
    body: form
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `ElevenLabs speech-to-text failed (${response.status}): ${detail.slice(0, 300)}`
    );
  }

  const body = (await response.json()) as {
    text?: unknown;
    language_code?: unknown;
    language_probability?: unknown;
  };

  return {
    text: typeof body.text === "string" ? body.text.trim() : "",
    languageCode: typeof body.language_code === "string" ? body.language_code : "",
    languageProbability:
      typeof body.language_probability === "number" ? body.language_probability : 0
  };
}
