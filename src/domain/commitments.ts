// Did this call commit the caller to money?
//
// Warmline's money rule lives in the call task, which makes it an instruction
// to a language model, not a gate. Nothing here can PREVENT a voice agent from
// going off script and agreeing to a deposit. What this module does is make it
// impossible for that to pass silently: the caller was not on the call, so if
// something was agreed to in their name, they have to be told.
//
// Two independent signals, because either alone is weak:
//
//   1. Self-report. The result schema is extended so the agent must declare
//      whether it agreed to a charge or read out any account details. Cheap and
//      precise, but it is the same model reporting on its own behavior.
//   2. Transcript scan. CALL-E returns the actual turns, so we read them
//      ourselves and look for money changing hands. Independent of what the
//      agent claims, and the only check that survives the agent being wrong.
//
// Either one firing raises the warning. This is deliberately biased toward
// false positives: "check this call" costs the caller a glance, while a missed
// charge costs them money they never agreed to spend.

export type CommitmentWarning = {
  /** The agent reported agreeing to a payment, deposit, or fee. */
  moneyCommitted: boolean;
  /** The agent reported giving out card, bank, or account details. */
  detailsShared: boolean;
  /** Our own reading of the transcript disagrees with "nothing happened". */
  transcriptFlagged: boolean;
  /** Verbatim quotes, in the language the call happened in, as evidence. */
  quotes: string[];
};

export function commitmentWarningLogFields(warning: CommitmentWarning) {
  return {
    moneyCommitted: warning.moneyCommitted,
    detailsShared: warning.detailsShared,
    transcriptFlagged: warning.transcriptFlagged,
    quoteCount: warning.quotes.length
  };
}

// Injected into every mission's result schema, so the agent has to answer these
// rather than leaving silence to be read as "no".
const COMMITMENT_PROPERTIES = {
  payment_committed: {
    type: "boolean",
    description:
      "True if you agreed to ANY charge on the caller's behalf: a payment, deposit, prepayment, cancellation fee, or other cost. False otherwise."
  },
  payment_details_shared: {
    type: "boolean",
    description:
      "True if you read out or confirmed any card, bank, or account details. False otherwise."
  },
  payment_note: {
    type: "string",
    description:
      "If any money was discussed, state briefly what was asked for and what you said. Empty string if money never came up."
  }
} as const;

const COMMITMENT_KEYS = Object.keys(COMMITMENT_PROPERTIES);

type JsonSchemaObject = {
  type?: unknown;
  properties?: Record<string, unknown>;
  required?: unknown;
  [key: string]: unknown;
};

// Merge the commitment fields into a template's result schema. CALL-E treats
// object schemas as strict, so the fields must land in BOTH properties and
// required or the call rejects them.
export function withCommitmentFields<T extends JsonSchemaObject>(schema: T): JsonSchemaObject {
  if (!schema || schema.type !== "object") return schema;
  const existingRequired = Array.isArray(schema.required) ? schema.required.map(String) : [];
  return {
    ...schema,
    properties: { ...(schema.properties ?? {}), ...COMMITMENT_PROPERTIES },
    required: [...existingRequired, ...COMMITMENT_KEYS.filter((k) => !existingRequired.includes(k))]
  };
}

// A run of 12+ digits, allowing the spaces and dashes a card number is usually
// spoken or written with. Deliberately loose: a long number read aloud during a
// payment conversation is worth a look even if it turns out to be a phone
// number or a booking reference.
const LONG_NUMBER = /(?:\d[ \-.]?){12,}/;

// Explicitly naming a payment instrument. These are near-certain signals.
const PAYMENT_INSTRUMENT =
  /\b(credit card|debit card|card number|cvv|security code|expiry date|expiration date|routing number|account number|sort code|iban|bank details)\b/i;

// Agreeing to a cost. Requires BOTH an assent and a money word nearby, so
// "there is a fifty dollar fee" alone does not fire but "yes, that fee is fine"
// does.
const ASSENT_TO_COST =
  /\b(yes|yeah|sure|okay|ok|fine|agreed|go ahead|that works|sounds good|please do|confirm)\b[^.!?]{0,60}\b(charge|deposit|fee|payment|pay|prepay|prepayment|non-refundable|card)\b/i;

const COST_THEN_ASSENT =
  /\b(charge|deposit|fee|payment|prepay|prepayment|non-refundable)\b[^.!?]{0,60}\b(yes|yeah|sure|okay|ok|fine|agreed|go ahead|that works|sounds good|please do|confirm)\b/i;

// The agent volunteering to pay.
const OFFER_TO_PAY =
  /\b(i(?:'| wi)ll pay|we(?:'| wi)ll pay|put it on the card|charge (?:the|my|her|his|their) card|you can charge|bill (?:it|me|them) to)\b/i;

const MONEY_PATTERNS = [
  PAYMENT_INSTRUMENT,
  ASSENT_TO_COST,
  COST_THEN_ASSENT,
  OFFER_TO_PAY
] as const;

export type TranscriptTurn = { speaker?: unknown; text?: unknown };

// Pull every spoken turn out of a CALL-E result, across all recipients and all
// dial attempts. Shape-tolerant on purpose: a provider response that does not
// carry transcripts must degrade to "no transcript evidence", never throw.
export function extractTranscriptTurns(providerResult: Record<string, unknown>): TranscriptTurn[] {
  const recipients = Array.isArray(providerResult.recipients) ? providerResult.recipients : [];
  const turns: TranscriptTurn[] = [];

  for (const recipient of recipients) {
    const attempts =
      recipient && typeof recipient === "object" && Array.isArray((recipient as never)["attempts"])
        ? ((recipient as Record<string, unknown>).attempts as unknown[])
        : [];
    for (const attempt of attempts) {
      const attemptTurns =
        attempt && typeof attempt === "object" && Array.isArray((attempt as never)["transcriptTurns"])
          ? ((attempt as Record<string, unknown>).transcriptTurns as unknown[])
          : [];
      for (const turn of attemptTurns) {
        if (turn && typeof turn === "object") turns.push(turn as TranscriptTurn);
      }
    }
  }
  return turns;
}

// Read the transcript ourselves. Both sides are scanned: the agent agreeing to
// a charge and the business saying it already charged the card are both things
// the caller needs to know about.
export function scanTranscriptForMoney(turns: TranscriptTurn[]): string[] {
  const quotes: string[] = [];

  for (const turn of turns) {
    const text = typeof turn.text === "string" ? turn.text.trim() : "";
    if (!text) continue;

    const hit =
      MONEY_PATTERNS.some((pattern) => pattern.test(text)) ||
      // A long number only counts alongside payment talk, so booking references
      // and phone numbers do not trip the warning on their own.
      (LONG_NUMBER.test(text) && /\b(card|pay|charge|account|bank)\b/i.test(text));

    if (hit) {
      quotes.push(text.length > 240 ? `${text.slice(0, 240)}…` : text);
      if (quotes.length >= 4) break;
    }
  }
  return quotes;
}

// Combine self-report and transcript scan into the warning the caller sees.
// Returns undefined when both signals are clean, so a normal call carries no
// extra weight and the UI shows nothing.
export function buildCommitmentWarning(
  structuredResult: Record<string, unknown>,
  turns: TranscriptTurn[]
): CommitmentWarning | undefined {
  const moneyCommitted = structuredResult.payment_committed === true;
  const detailsShared = structuredResult.payment_details_shared === true;

  const quotes = scanTranscriptForMoney(turns);
  const note = typeof structuredResult.payment_note === "string" ? structuredResult.payment_note.trim() : "";
  if (note) quotes.unshift(note);

  const transcriptFlagged = quotes.length > 0 && !moneyCommitted && !detailsShared;

  if (!moneyCommitted && !detailsShared && !transcriptFlagged) return undefined;

  return {
    moneyCommitted,
    detailsShared,
    transcriptFlagged,
    quotes: quotes.slice(0, 4)
  };
}
