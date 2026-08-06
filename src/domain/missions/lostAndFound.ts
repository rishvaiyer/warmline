import { z } from "zod";
import {
  assertSafeDescription,
  baseCallPreamble,
  type BaseMission,
  type CallResult,
  type TargetInput
} from "../base.js";
import type { MissionTemplate } from "../template.js";

export const outcomeValues = [
  "found",
  "possible_match",
  "not_found",
  "closed",
  "voicemail",
  "refused",
  "follow_up_required",
  "unknown"
] as const;

const intakeSchema = z.object({
  itemType: z.string().trim().min(2).max(80),
  safeDescription: z.string().trim().min(8).max(500),
  privateProof: z.string().trim().max(500),
  lostWindow: z.string().trim().min(3).max(160),
  lastSeen: z.string().trim().min(2).max(160)
});

type Intake = z.infer<typeof intakeSchema>;
type Data = { claimReference: string; departmentReached: string };

const resultSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "outcome",
    "department_reached",
    "claim_reference",
    "follow_up_instructions",
    "follow_up_required"
  ],
  properties: {
    outcome: { type: "string", enum: [...outcomeValues] },
    department_reached: { type: "string" },
    claim_reference: { type: "string" },
    follow_up_instructions: { type: "string" },
    follow_up_required: { type: "boolean" }
  }
} as const;

function buildCallTask(mission: Intake & BaseMission, target: TargetInput): string {
  return [
    ...baseCallPreamble(mission, target),
    `Ask for ${target.department || "Lost and Found"}.`,
    `Ask whether a ${mission.itemType} matching this privacy-safe description was reported: ${mission.safeDescription}.`,
    `The item may have been lost ${mission.lostWindow}; it was last seen at ${mission.lastSeen}.`,
    "Do not claim to be the owner. Do not claim the item, arrange payment, shipping, pickup, or property transfer.",
    "Do not request or disclose serial numbers, passcodes, account details, exact contents, or other private ownership proof.",
    "If there may be a match, request a claim reference and instructions for the owner to follow up personally."
  ].join(" ");
}

function normalizeResult(target: TargetInput, provider: Record<string, unknown>): CallResult<Data> {
  const structured =
    provider.structuredResult && typeof provider.structuredResult === "object"
      ? (provider.structuredResult as Record<string, unknown>)
      : {};

  const rawOutcome = String(structured.outcome ?? "unknown");
  const outcome = (outcomeValues as readonly string[]).includes(rawOutcome) ? rawOutcome : "unknown";

  const confidenceValue = provider.completionConfidence;
  const confidenceLabel =
    confidenceValue && typeof confidenceValue === "object"
      ? String((confidenceValue as Record<string, unknown>).label ?? "low")
      : "low";

  return {
    targetId: target.id,
    venueName: target.venueName,
    status: provider.status === "failed" ? "failed" : "completed",
    outcome,
    confidence: confidenceLabel === "high" || confidenceLabel === "medium" ? confidenceLabel : "low",
    evidence: Array.isArray(provider.evidence) ? provider.evidence.map(String).slice(0, 5) : [],
    followUpRequired: Boolean(structured.follow_up_required),
    followUpInstructions: String(structured.follow_up_instructions ?? ""),
    completedAt: new Date().toISOString(),
    data: {
      claimReference: String(structured.claim_reference ?? ""),
      departmentReached: String(structured.department_reached ?? "")
    }
  };
}

function rank(results: CallResult<Data>[]): CallResult<Data>[] {
  const weight = (r: CallResult<Data>) => {
    if (r.outcome === "found") return 0;
    if (r.outcome === "possible_match") return 1;
    return 2;
  };
  const confidenceWeight = { high: 0, medium: 1, low: 2 } as const;
  return [...results].sort((a, b) => {
    const w = weight(a) - weight(b);
    if (w !== 0) return w;
    return confidenceWeight[a.confidence] - confidenceWeight[b.confidence];
  });
}

function mockResult(mission: Intake & BaseMission, targetIndex: number): CallResult<Data> {
  const outcomes = ["not_found", "possible_match", "follow_up_required", "voicemail"] as const;
  const outcome = outcomes[targetIndex % outcomes.length];
  const target = mission.targets[targetIndex];
  const possible = outcome === "possible_match";

  return {
    targetId: target.id,
    venueName: target.venueName,
    status: "completed",
    outcome,
    confidence: possible ? "medium" : "high",
    evidence: possible
      ? [`Staff reported a similar ${mission.itemType} in the secure property area.`]
      : ["The staff member checked the current lost-property log."],
    followUpRequired: possible || outcome === "follow_up_required" || outcome === "voicemail",
    followUpInstructions: possible
      ? "The owner should call the security desk before 8 PM and provide private proof directly."
      : outcome === "follow_up_required"
        ? "Call again tomorrow after the closing team checks the property log."
        : outcome === "voicemail"
          ? "No person answered. Try again during business hours."
          : "No matching item was logged at the time of the call.",
    completedAt: new Date(Date.now() + targetIndex * 1000).toISOString(),
    data: {
      claimReference: possible ? `WL-${mission.id.slice(-4).toUpperCase()}-${targetIndex + 1}` : "",
      departmentReached: possible ? "Security desk" : "Front desk"
    }
  };
}

export const lostAndFound: MissionTemplate<Intake, Data> = {
  kind: "lost_and_found",
  label: "Lost & Found",
  blurb: "Ask a venue whether they have your lost item.",
  intakeSchema,
  resultSchema,
  outcomes: outcomeValues,
  buildCallTask,
  normalizeResult,
  rank,
  resultColumns: [
    { key: "departmentReached", label: "Department" },
    { key: "claimReference", label: "Claim reference" }
  ],
  guards(mission) {
    assertSafeDescription(mission.safeDescription);
  },
  mockResult
};
