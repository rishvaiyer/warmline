// Shared Anthropic client + model constants. Everything that calls the LLM
// (interpret.ts, translate.ts) goes through this module so the models stay
// swappable in one place, and so mock-mode fallback behavior is decided the
// same way everywhere: hasAnthropicKey() === false means "no key configured,
// stay in stub/mock mode."

import Anthropic from "@anthropic-ai/sdk";

export const INTERPRET_MODEL = "claude-sonnet-5";
export const TRANSLATE_MODEL = "claude-haiku-4-5";

export function hasAnthropicKey(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

let client: Anthropic | undefined;

// Lazily constructed so importing this module never throws in mock mode
// (Anthropic() reads ANTHROPIC_API_KEY from env at construction time).
export function getAnthropicClient(): Anthropic {
  if (!client) {
    client = new Anthropic();
  }
  return client;
}
