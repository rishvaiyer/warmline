// Provider-agnostic LLM layer. Everything that calls an LLM (interpret.ts,
// translate.ts, server/index.ts) goes through llmComplete() here, so the
// provider stays swappable in one place, and so mock-mode fallback behavior
// is decided the same way everywhere: hasLLMKey() === false means "no key
// configured, stay in stub/mock mode."
//
// Supports both Anthropic and OpenAI, and is robust to how the key is named:
// an OpenAI key pasted into ANTHROPIC_API_KEY (instead of OPENAI_API_KEY)
// still works, since anthropicKey() only claims ANTHROPIC_API_KEY when it
// actually looks like an Anthropic key (starts with "sk-ant"). Anthropic is
// preferred whenever a real Anthropic key is present.

import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";

export const INTERPRET_MODEL = "claude-sonnet-5";
export const TRANSLATE_MODEL = "claude-haiku-4-5";
export const OPENAI_MODEL = "gpt-4o-mini";

// Returns ANTHROPIC_API_KEY only if it looks like a real Anthropic key.
export function anthropicKey(): string | undefined {
  const key = process.env.ANTHROPIC_API_KEY;
  return key && key.startsWith("sk-ant") ? key : undefined;
}

// Returns OPENAI_API_KEY if set; otherwise, if ANTHROPIC_API_KEY is set but
// does NOT look like an Anthropic key (i.e. someone pasted an OpenAI key into
// the Anthropic variable), returns that instead. This makes the app work no
// matter which env var name the user used for an OpenAI key.
export function openaiKey(): string | undefined {
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY;
  const anthropicVar = process.env.ANTHROPIC_API_KEY;
  if (anthropicVar && !anthropicVar.startsWith("sk-ant")) return anthropicVar;
  return undefined;
}

export function provider(): "anthropic" | "openai" | null {
  if (anthropicKey()) return "anthropic";
  if (openaiKey()) return "openai";
  return null;
}

export function hasLLMKey(): boolean {
  return provider() !== null;
}

// Retained as an alias for any code that still imports it -- nothing should
// gate on Anthropic specifically anymore, but the name stays valid.
export const hasAnthropicKey = hasLLMKey;

let anthropicClient: Anthropic | undefined;

// Lazily constructed so importing this module never throws in mock mode
// (Anthropic() reads ANTHROPIC_API_KEY from env at construction time).
export function getAnthropicClient(): Anthropic {
  if (!anthropicClient) {
    anthropicClient = new Anthropic();
  }
  return anthropicClient;
}

let openaiClient: OpenAI | undefined;

// Constructed explicitly with the resolved key -- never rely on the default
// OPENAI_API_KEY env var, since the key may actually live in
// ANTHROPIC_API_KEY (see openaiKey() above).
export function getOpenAIClient(): OpenAI {
  if (!openaiClient) {
    openaiClient = new OpenAI({ apiKey: openaiKey() });
  }
  return openaiClient;
}

export type LLMCompleteOptions = {
  system: string;
  user: string;
  maxTokens: number;
  json?: boolean;
};

// Unified text completion across providers. Returns "" if no key is
// configured -- callers already handle empty/fallback in that case.
export async function llmComplete(opts: LLMCompleteOptions): Promise<string> {
  const active = provider();

  if (active === "anthropic") {
    const client = getAnthropicClient();
    const response = await client.messages.create({
      model: TRANSLATE_MODEL,
      max_tokens: opts.maxTokens,
      system: opts.system,
      messages: [{ role: "user", content: opts.user }]
    });
    return response.content.find((block) => block.type === "text")?.text ?? "";
  }

  if (active === "openai") {
    const client = getOpenAIClient();
    const response = await client.chat.completions.create({
      model: OPENAI_MODEL,
      max_tokens: opts.maxTokens,
      messages: [
        { role: "system", content: opts.system },
        { role: "user", content: opts.user }
      ],
      ...(opts.json ? { response_format: { type: "json_object" as const } } : {})
    });
    return response.choices[0]?.message?.content ?? "";
  }

  return "";
}
