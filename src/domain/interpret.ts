// MOCK intent interpreter. Given free-text intent (in any userLocale) plus the
// user's locale, this returns a plan: which mission template applies, the
// mission-specific fields, the callGoal instruction, and the disclosure line.
//
// TODO: replace this keyword classifier with a real LLM call that (a) detects
// the language of `text`, (b) classifies intent into one of the known kinds
// (falling back to "generic"), and (c) extracts structured fields per
// template, all while translating callGoal/disclosureLine into callLocale.

export type InterpretedPlan = {
  kind: string;
  fields: Record<string, unknown>;
  callGoal: string;
  disclosureLine: string;
  venueHint?: string;
};

const APPOINTMENT_KEYWORDS = ["appointment", "appt", "cita", "book", "schedule", "reservation"];
const REACHABILITY_KEYWORDS = ["open", "hours", "stock", "price", "inventory", "cost", "available"];
const LOST_AND_FOUND_KEYWORDS = ["lost", "perdi", "perdí", "found", "missing", "left behind"];

function containsAny(haystack: string, needles: string[]): boolean {
  const lower = haystack.toLowerCase();
  return needles.some((needle) => lower.includes(needle));
}

export function interpretIntent(text: string, userLocale: string): InterpretedPlan {
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
