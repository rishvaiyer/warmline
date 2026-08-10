import { z } from "zod";
import type { CommitmentWarning } from "./commitments.js";

// Shared target + mission shape. Per-mission fields live in each template's
// intakeSchema (src/domain/template.ts), not here.

export const targetSchema = z.object({
  id: z.string().min(1),
  venueName: z.string().trim().min(2).max(100),
  phoneE164: z.string().regex(/^\+[1-9]\d{7,14}$/, "Use E.164 format, such as +12025550123"),
  department: z.string().trim().max(80).optional(),
  approved: z.literal(true)
});

export const baseMissionSchema = z.object({
  id: z.string().min(1),
  kind: z.string(),
  userLocale: z.string().default("en-US"),
  callLocale: z.string().optional(),
  disclosureAccepted: z.literal(true),
  // Booking is opt-in and requires BOTH of the next two. bookingConsent is the
  // person ticking "yes, book for me"; callerName is who it gets booked under.
  // Either one missing means the agent is told to ask and report, never commit.
  // Two separate signals on purpose: a name typed for some other reason must
  // never by itself amount to permission to bind someone to an appointment.
  bookingConsent: z.boolean().optional(),
  callerName: z.string().trim().min(2).max(80).optional(),
  // Optional number for the venue to confirm to. Never used to call the caller.
  callbackNumber: z
    .string()
    .regex(/^\+[1-9]\d{7,14}$/, "Use E.164 format, such as +12025550123")
    .optional(),
  targets: z.array(targetSchema).min(1).max(5)
});

export type BaseMission = z.infer<typeof baseMissionSchema>;
export type TargetInput = z.infer<typeof targetSchema>;

export type CallResult<TData = unknown> = {
  targetId: string;
  venueName: string;
  status: "completed" | "failed";
  outcome: string;
  confidence: "high" | "medium" | "low";
  evidence: string[];
  followUpRequired: boolean;
  followUpInstructions: string;
  completedAt: string;
  data: TData;
  // Present only when a call may have committed the caller to money. Filled
  // centrally in server/index.ts from the agent's own declaration plus an
  // independent read of the transcript -- see src/domain/commitments.ts.
  // Absent on a normal call, so the results screen stays quiet.
  commitmentWarning?: CommitmentWarning;
};

// The safety preamble every mission's call task must start with.
//
// Money is the hard line, and it is a different thing from time. Holding a slot
// commits the caller's calendar, which they authorize explicitly on the review
// screen before the call is placed. Spending their money is never authorized,
// and the agent is given no payment details with which to spend it -- so if a
// booking cannot proceed without a card or a deposit, the correct move is to
// stop and report, not to improvise.
export function baseCallPreamble(mission: BaseMission, target: TargetInput): string[] {
  return [
    `Call ${target.venueName} at ${target.phoneE164}.`,
    "At the start, clearly say you are an AI assistant calling on someone's behalf.",
    "Do not impersonate the caller: you are their assistant, not them.",
    mission.callerName ? `You are calling on behalf of ${mission.callerName}.` : "",
    mission.callbackNumber
      ? `If a contact number is needed, give ${mission.callbackNumber}.`
      : "",
    "Never pay, offer to pay, or read out card, bank, or account details -- you have none. Never agree to a deposit, prepayment, cancellation fee, or any other charge.",
    "If money is required to go ahead, stop there, commit to nothing, and report exactly what is required so the caller can decide for themselves.",
    "If the venue asks not to receive automated calls, apologize, end the call, and record the refusal."
  ].filter(Boolean);
}

export function parseAllowedPhoneNumbers(value: string | undefined): Set<string> {
  return new Set(
    (value ?? "")
      .split(",")
      .map((phone) => phone.trim())
      .filter((phone) => /^\+[1-9]\d{7,14}$/.test(phone))
  );
}

export function makeIdempotencyKey(kind: string, missionId: string, targetId: string): string {
  return `${kind}_${missionId}_${targetId}`.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 120);
}

// Lost & Found guard only (see registry note in missions/lostAndFound.ts): keeps
// private ownership proof (serials, passcodes, account numbers, etc.) out of the
// call task text.
const forbiddenDisclosurePatterns = [
  /\bserial\s*(number|no\.?|#)\b/i,
  /\bpasscode\b/i,
  /\bpassword\b/i,
  /\baccount\s*(number|no\.?|#)\b/i,
  /\bsocial security\b/i,
  /\bcredit card\b/i,
  /\bdriver'?s license\b/i
];

export function assertSafeDescription(description: string): void {
  const match = forbiddenDisclosurePatterns.find((pattern) => pattern.test(description));
  if (match) {
    throw new Error(
      "Safe description appears to contain private ownership proof. Move serial numbers, passcodes, account details, and hidden identifiers into the private proof field."
    );
  }
}
