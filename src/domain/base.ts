import { z } from "zod";

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
};

// The safety preamble every mission's call task must start with.
export function baseCallPreamble(mission: BaseMission, target: TargetInput): string[] {
  return [
    `Call ${target.venueName} at ${target.phoneE164}.`,
    "At the start, clearly say you are an AI assistant calling on someone's behalf.",
    "Do not impersonate the caller. Do not make payments, bookings, purchases, or any commitment.",
    "If the venue asks not to receive automated calls, apologize, end the call, and record the refusal."
  ];
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
