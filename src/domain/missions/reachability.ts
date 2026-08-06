import { z } from "zod";
import { baseCallPreamble, type BaseMission, type CallResult, type TargetInput } from "../base.js";
import type { MissionTemplate } from "../template.js";

export const outcomeValues = [
  "answered",
  "unknown_to_staff",
  "voicemail",
  "refused",
  "closed",
  "unknown"
] as const;

const modeValues = ["open_now", "price", "stock", "general"] as const;

const intakeSchema = z.object({
  mode: z.enum(modeValues),
  subject: z.string().trim().min(1).max(120),
  question: z.string().trim().min(3).max(300)
});

type Intake = z.infer<typeof intakeSchema>;
type Data = { answer: string; price?: string; openNow?: string; inStock?: string };

const resultSchema = {
  type: "object",
  additionalProperties: false,
  required: ["outcome", "answer", "price", "open_now", "in_stock"],
  properties: {
    outcome: { type: "string", enum: [...outcomeValues] },
    answer: { type: "string" },
    price: { type: "string" },
    open_now: { type: "string" },
    in_stock: { type: "string" }
  }
} as const;

function buildCallTask(mission: Intake & BaseMission, target: TargetInput): string {
  return [
    ...baseCallPreamble(mission, target),
    `Ask this single question about ${mission.subject}: ${mission.question}.`,
    "Capture the answer as close to verbatim as possible. Do not negotiate, haggle, or commit to anything."
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
    followUpRequired: outcome === "voicemail" || outcome === "unknown_to_staff",
    followUpInstructions: outcome === "voicemail" ? "Try again during business hours." : "",
    completedAt: new Date().toISOString(),
    data: {
      answer: String(structured.answer ?? ""),
      price: structured.price ? String(structured.price) : undefined,
      openNow: structured.open_now ? String(structured.open_now) : undefined,
      inStock: structured.in_stock ? String(structured.in_stock) : undefined
    }
  };
}

function parsePrice(value: string | undefined): number {
  if (!value) return Number.POSITIVE_INFINITY;
  const match = value.match(/[\d.]+/);
  return match ? Number(match[0]) : Number.POSITIVE_INFINITY;
}

function rank(results: CallResult<Data>[]): CallResult<Data>[] {
  return [...results].sort((a, b) => {
    if (a.outcome === "answered" && b.outcome !== "answered") return -1;
    if (b.outcome === "answered" && a.outcome !== "answered") return 1;
    return parsePrice(a.data.price) - parsePrice(b.data.price);
  });
}

function mockResult(mission: Intake & BaseMission, targetIndex: number): CallResult<Data> {
  const target = mission.targets[targetIndex];
  const data: Data =
    mission.mode === "price"
      ? { answer: `Priced at $${(4 + targetIndex).toFixed(2)}.`, price: `$${(4 + targetIndex).toFixed(2)}` }
      : mission.mode === "stock"
        ? { answer: targetIndex % 2 === 0 ? "In stock." : "Out of stock.", inStock: targetIndex % 2 === 0 ? "yes" : "no" }
        : mission.mode === "open_now"
          ? { answer: "Open now until 9 PM.", openNow: "yes" }
          : { answer: `Staff answered: ${mission.question}` };

  return {
    targetId: target.id,
    venueName: target.venueName,
    status: "completed",
    outcome: "answered",
    confidence: "high",
    evidence: [`Staff answered directly about ${mission.subject}.`],
    followUpRequired: false,
    followUpInstructions: "",
    completedAt: new Date(Date.now() + targetIndex * 1000).toISOString(),
    data
  };
}

export const reachability: MissionTemplate<Intake, Data> = {
  kind: "reachability",
  label: "Reachability Check",
  blurb: "Ask one question: hours, price, or stock.",
  intakeSchema,
  resultSchema,
  outcomes: outcomeValues,
  buildCallTask,
  normalizeResult,
  rank,
  resultColumns: [
    { key: "answer", label: "Answer" },
    { key: "price", label: "Price" }
  ],
  mockResult
};
