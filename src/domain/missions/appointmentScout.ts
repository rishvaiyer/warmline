import { z } from "zod";
import { baseCallPreamble, type BaseMission, type CallResult, type TargetInput } from "../base.js";
import type { MissionTemplate } from "../template.js";

export const outcomeValues = [
  "slots_offered",
  "none_available",
  "callback_required",
  "voicemail",
  "refused",
  "unknown"
] as const;

const intakeSchema = z.object({
  service: z.string().trim().min(2).max(120),
  earliestAcceptable: z.string().trim().min(1).max(40),
  latestAcceptable: z.string().trim().min(1).max(40),
  partySize: z.number().int().min(1).max(50).optional(),
  notes: z.string().trim().max(300).optional()
});

type Intake = z.infer<typeof intakeSchema>;
type Data = { earliest: string; slots: string[] };

const resultSchema = {
  type: "object",
  additionalProperties: false,
  required: ["outcome", "earliest_slot", "slots", "notes"],
  properties: {
    outcome: { type: "string", enum: [...outcomeValues] },
    earliest_slot: { type: "string" },
    slots: { type: "array", items: { type: "string" }, maxItems: 5 },
    notes: { type: "string" }
  }
} as const;

function buildCallTask(mission: Intake & BaseMission, target: TargetInput): string {
  return [
    ...baseCallPreamble(mission, target),
    `Ask for the earliest available appointment for ${mission.service}, between ${mission.earliestAcceptable} and ${mission.latestAcceptable}.`,
    mission.partySize ? `The appointment is for ${mission.partySize} people.` : "",
    mission.notes ? `Additional context: ${mission.notes}.` : "",
    "Do not book, hold, or confirm any appointment. Only report what is offered so the caller can book it themselves.",
    "List up to five available slots if offered, and note which one is earliest."
  ]
    .filter(Boolean)
    .join(" ");
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
    followUpRequired: outcome === "callback_required" || outcome === "voicemail",
    followUpInstructions: String(structured.notes ?? ""),
    completedAt: new Date().toISOString(),
    data: {
      earliest: String(structured.earliest_slot ?? ""),
      slots: Array.isArray(structured.slots) ? structured.slots.map(String).slice(0, 5) : []
    }
  };
}

function parseSlotDate(value: string): number {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? Number.POSITIVE_INFINITY : parsed;
}

function rank(results: CallResult<Data>[]): CallResult<Data>[] {
  return [...results].sort((a, b) => {
    if (a.outcome === "slots_offered" && b.outcome !== "slots_offered") return -1;
    if (b.outcome === "slots_offered" && a.outcome !== "slots_offered") return 1;
    return parseSlotDate(a.data.earliest) - parseSlotDate(b.data.earliest);
  });
}

function mockResult(mission: Intake & BaseMission, targetIndex: number): CallResult<Data> {
  const target = mission.targets[targetIndex];
  const baseDay = new Date();
  baseDay.setDate(baseDay.getDate() + targetIndex + 1);
  const earliest = baseDay.toISOString().slice(0, 16).replace("T", " ") + " AM";
  const slots = [earliest, `${baseDay.toISOString().slice(0, 10)} 2:30 PM`];

  return {
    targetId: target.id,
    venueName: target.venueName,
    status: "completed",
    outcome: "slots_offered",
    confidence: "high",
    evidence: [`Front desk offered ${slots.length} openings for ${mission.service}.`],
    followUpRequired: false,
    followUpInstructions: "Call back to confirm and book the slot that works for you.",
    completedAt: new Date(Date.now() + targetIndex * 1000).toISOString(),
    data: { earliest, slots }
  };
}

export const appointmentScout: MissionTemplate<Intake, Data> = {
  kind: "appointment_scout",
  label: "Appointment Scout",
  blurb: "Ask for the earliest appointment, without booking anything.",
  intakeSchema,
  resultSchema,
  outcomes: outcomeValues,
  buildCallTask,
  normalizeResult,
  rank,
  resultColumns: [
    { key: "earliest", label: "Earliest slot" },
    { key: "slots", label: "All slots offered" }
  ],
  mockResult
};
