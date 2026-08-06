import { z } from "zod";
import { baseCallPreamble, type BaseMission, type CallResult, type TargetInput } from "../base.js";
import type { MissionTemplate } from "../template.js";

export const outcomeValues = ["answered", "partial", "refused", "voicemail", "closed", "unknown"] as const;

// The generic template is the fallback for any intent that does not match a
// sharper template. The interpreter supplies callGoal directly; there is no
// mission-specific intake beyond that.
const intakeSchema = z.object({
  callGoal: z.string().trim().min(3).max(400)
});

type Intake = z.infer<typeof intakeSchema>;
type Data = { summary: string; details: string };

const resultSchema = {
  type: "object",
  additionalProperties: false,
  required: ["outcome", "summary", "details", "follow_up"],
  properties: {
    outcome: { type: "string", enum: [...outcomeValues] },
    summary: { type: "string" },
    details: { type: "string" },
    follow_up: { type: "string" }
  }
} as const;

function buildCallTask(mission: Intake & BaseMission, target: TargetInput): string {
  return [...baseCallPreamble(mission, target), mission.callGoal].join(" ");
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
    followUpRequired: Boolean(structured.follow_up),
    followUpInstructions: String(structured.follow_up ?? ""),
    completedAt: new Date().toISOString(),
    data: {
      summary: String(structured.summary ?? ""),
      details: String(structured.details ?? "")
    }
  };
}

function rank(results: CallResult<Data>[]): CallResult<Data>[] {
  return [...results].sort((a, b) => {
    if (a.outcome === "answered" && b.outcome !== "answered") return -1;
    if (b.outcome === "answered" && a.outcome !== "answered") return 1;
    return 0;
  });
}

function mockResult(mission: Intake & BaseMission, targetIndex: number): CallResult<Data> {
  const target = mission.targets[targetIndex];
  return {
    targetId: target.id,
    venueName: target.venueName,
    status: "completed",
    outcome: "answered",
    confidence: "medium",
    evidence: [`Staff at ${target.venueName} addressed the request.`],
    followUpRequired: false,
    followUpInstructions: "",
    completedAt: new Date(Date.now() + targetIndex * 1000).toISOString(),
    data: {
      summary: "Staff confirmed the request and provided an answer.",
      details: mission.callGoal
    }
  };
}

export const generic: MissionTemplate<Intake, Data> = {
  kind: "generic",
  label: "General request",
  blurb: "Anything else: ask a question and get a straight answer.",
  intakeSchema,
  resultSchema,
  outcomes: outcomeValues,
  buildCallTask,
  normalizeResult,
  rank,
  resultColumns: [
    { key: "summary", label: "Summary" },
    { key: "details", label: "Details" }
  ],
  mockResult
};
