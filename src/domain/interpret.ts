// Intent interpreter. Given free-text intent (in any language) plus the
// user's locale, this returns a plan: which mission template applies, the
// mission-specific fields, the callGoal instruction, and the disclosure line
// -- everything the plan-review screen (design.md section 1b) needs to show
// before a call is placed.
//
// Real path: an LLM call (see src/domain/llm.ts) that classifies the intent
// into one of the registry's known kinds (falling back to "generic"),
// extracts structured fields per template, and writes callGoal/disclosureLine
// in userLocale so the review screen reads naturally. Falls back to a keyword
// classifier when no ANTHROPIC_API_KEY is configured, or if the LLM call
// fails for any reason, so the endpoint never hard-fails.

import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { getAnthropicClient, hasAnthropicKey, INTERPRET_MODEL } from "./llm.js";
import { templates } from "./registry.js";

export type InterpretedPlan = {
  kind: string;
  fields: Record<string, unknown>;
  callGoal: string;
  disclosureLine: string;
  venueHint?: string;
};

const knownKinds = Object.keys(templates) as [string, ...string[]];

const planSchema = z.object({
  kind: z.enum(knownKinds),
  fields: z.record(z.string(), z.unknown()),
  callGoal: z.string().trim().min(1).max(400),
  disclosureLine: z.string().trim().min(1).max(300),
  venueHint: z.string().trim().max(120).optional()
});

const SYSTEM_PROMPT = `You turn a person's free-text request (in any language) into a structured phone-call plan for an approval-gated AI calling agent. Pick the closest mission kind; extract its fields; write callGoal as a single clear instruction the agent will follow on the call; write disclosureLine as the spoken "I am an AI calling on someone's behalf" line.

Known mission kinds and their expected fields:
- lost_and_found: itemType, safeDescription, privateProof, lostWindow, lastSeen. Never put serial numbers, passcodes, account numbers, or other private ownership proof in safeDescription -- that belongs in privateProof only, and it must never be spoken on the call.
- appointment_scout: service, earliestAcceptable, latestAcceptable, partySize (optional number), notes (optional).
- reachability: mode ("open_now" | "price" | "stock" | "general"), subject, question.
- generic: callGoal. Use this kind for anything that does not clearly fit the others.

Write callGoal, disclosureLine, and every extracted field value in the language given as userLocale, since that is the language of the plan-review screen the person will read, even if the original request was written in a different language. Keep callGoal to one clear instruction. The call itself must never book, pay, or make any commitment -- phrase callGoal accordingly whenever relevant. If a business or venue name is mentioned, put it in venueHint.`;

const APPOINTMENT_KEYWORDS = ["appointment", "appt", "cita", "book", "schedule", "reservation"];
const REACHABILITY_KEYWORDS = ["open", "hours", "stock", "price", "inventory", "cost", "available"];
const LOST_AND_FOUND_KEYWORDS = ["lost", "perdi", "perdí", "found", "missing", "left behind"];

function containsAny(haystack: string, needles: string[]): boolean {
  const lower = haystack.toLowerCase();
  return needles.some((needle) => lower.includes(needle));
}

function interpretIntentMock(text: string, _userLocale: string): InterpretedPlan {
  const trimmed = text.trim();

  if (containsAny(trimmed, APPOINTMENT_KEYWORDS)) {
    return {
      kind: "appointment_scout",
      fields: {
        service: trimmed,
        earliestAcceptable: "as soon as possible",
        latestAcceptable: "within two weeks"
      },
      callGoal: `Ask for the earliest available appointment related to: "${trimmed}". Do not book or hold anything, only report what is offered.`,
      disclosureLine: "Hi, I'm an AI assistant calling on someone's behalf to ask about appointment availability."
    };
  }

  if (containsAny(trimmed, REACHABILITY_KEYWORDS)) {
    return {
      kind: "reachability",
      fields: {
        mode: "general",
        subject: trimmed,
        question: trimmed
      },
      callGoal: `Ask this question and capture the answer verbatim: "${trimmed}". Do not negotiate or commit to anything.`,
      disclosureLine: "Hi, I'm an AI assistant calling on someone's behalf to ask a quick question."
    };
  }

  if (containsAny(trimmed, LOST_AND_FOUND_KEYWORDS)) {
    return {
      kind: "lost_and_found",
      fields: {
        itemType: "item",
        safeDescription: trimmed,
        privateProof: "",
        lostWindow: "recently",
        lastSeen: "at the venue"
      },
      callGoal: `Ask whether a lost item matching this description was reported: "${trimmed}". Do not claim the item or arrange pickup.`,
      disclosureLine: "Hi, I'm an AI assistant calling on someone's behalf about a possibly lost item."
    };
  }

  return {
    kind: "generic",
    fields: {
      callGoal: trimmed
    },
    callGoal: trimmed,
    disclosureLine: "Hi, I'm an AI assistant calling on someone's behalf."
  };
}

async function interpretIntentLLM(text: string, userLocale: string): Promise<InterpretedPlan> {
  const client = getAnthropicClient();
  const response = await client.messages.parse({
    model: INTERPRET_MODEL,
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `Request text: ${JSON.stringify(text)}\nuserLocale: ${userLocale}`
      }
    ],
    output_config: { format: zodOutputFormat(planSchema) }
  });

  const parsed = response.parsed_output;
  if (!parsed) {
    throw new Error("interpretIntent: Anthropic response had no parsed_output");
  }
  return parsed;
}

export async function interpretIntent(text: string, userLocale: string): Promise<InterpretedPlan> {
  if (!hasAnthropicKey()) {
    return interpretIntentMock(text, userLocale);
  }

  try {
    return await interpretIntentLLM(text, userLocale);
  } catch (error) {
    console.error("interpretIntent: LLM call failed, falling back to keyword classifier", error);
    return interpretIntentMock(text, userLocale);
  }
}
