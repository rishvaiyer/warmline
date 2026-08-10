import { z } from "zod";
import { baseCallPreamble, type BaseMission, type CallResult, type TargetInput } from "../base.js";
import type { MissionTemplate } from "../template.js";

export const outcomeValues = [
  "booked",
  "slots_offered",
  "payment_required",
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
type Data = {
  booked: string;
  confirmation: string;
  cancellationPolicy: string;
  earliest: string;
  slots: string[];
};

const resultSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "outcome",
    "booked_slot",
    "confirmation_reference",
    "cancellation_policy",
    "earliest_slot",
    "slots",
    "notes"
  ],
  properties: {
    outcome: { type: "string", enum: [...outcomeValues] },
    // What was actually committed to, empty unless outcome is "booked".
    booked_slot: { type: "string" },
    confirmation_reference: { type: "string" },
    // Captured verbatim where given: the caller is bound by it and never heard it.
    cancellation_policy: { type: "string" },
    earliest_slot: { type: "string" },
    slots: { type: "array", items: { type: "string" }, maxItems: 5 },
    notes: { type: "string" }
  }
} as const;

function buildCallTask(mission: Intake & BaseMission, target: TargetInput): string {
  // Booking requires explicit consent AND a name to book under. Missing either
  // falls back to the older, strictly read-only behavior rather than
  // improvising: an appointment held under nobody is worse than no
  // appointment, and a name alone is not permission.
  const canBook = Boolean(mission.bookingConsent && mission.callerName);

  const bookingInstructions = canBook
    ? [
        `Book the earliest appointment that falls between ${mission.earliestAcceptable} and ${mission.latestAcceptable}. You are authorized to hold and confirm exactly one appointment in that range, and nothing outside it.`,
        "If the only times offered fall outside that range, do not book. Report what was offered instead.",
        "Once it is booked, read the date, time, and name back to the receptionist to confirm you have them right.",
        "Ask for a confirmation number or reference if there is one, and ask what the cancellation policy is. Record both.",
        "Book one appointment only. Never hold multiple slots as a backup."
      ]
    : [
        "Do not book, hold, or confirm anything: the caller has not authorized a booking. Only report what is offered so the caller can book it themselves.",
        "List up to five available slots if offered, and note which one is earliest."
      ];

  return [
    ...baseCallPreamble(mission, target),
    `The caller wants an appointment for ${mission.service}, between ${mission.earliestAcceptable} and ${mission.latestAcceptable}.`,
    mission.partySize ? `The appointment is for ${mission.partySize} people.` : "",
    mission.notes ? `Additional context: ${mission.notes}.` : "",
    ...bookingInstructions
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
    // Anything short of a confirmed booking leaves work with the caller, so it
    // is flagged for follow-up -- including slots_offered, which used to be the
    // success case and is now the "you still have to book this" case.
    followUpRequired:
      outcome === "callback_required" ||
      outcome === "voicemail" ||
      outcome === "payment_required" ||
      outcome === "slots_offered",
    followUpInstructions: String(structured.notes ?? ""),
    completedAt: new Date().toISOString(),
    data: {
      booked: String(structured.booked_slot ?? ""),
      confirmation: String(structured.confirmation_reference ?? ""),
      cancellationPolicy: String(structured.cancellation_policy ?? ""),
      earliest: String(structured.earliest_slot ?? ""),
      slots: Array.isArray(structured.slots) ? structured.slots.map(String).slice(0, 5) : []
    }
  };
}

function parseSlotDate(value: string): number {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? Number.POSITIVE_INFINITY : parsed;
}

// A confirmed booking beats an offer of times, which beats everything else.
const OUTCOME_PRIORITY: Record<string, number> = { booked: 0, slots_offered: 1 };

function rank(results: CallResult<Data>[]): CallResult<Data>[] {
  return [...results].sort((a, b) => {
    const priority = (OUTCOME_PRIORITY[a.outcome] ?? 2) - (OUTCOME_PRIORITY[b.outcome] ?? 2);
    if (priority !== 0) return priority;
    return (
      parseSlotDate(a.data.booked || a.data.earliest) -
      parseSlotDate(b.data.booked || b.data.earliest)
    );
  });
}

function mockResult(mission: Intake & BaseMission, targetIndex: number): CallResult<Data> {
  const target = mission.targets[targetIndex];
  const baseDay = new Date();
  baseDay.setDate(baseDay.getDate() + targetIndex + 1);
  const earliest = baseDay.toISOString().slice(0, 16).replace("T", " ") + " AM";
  const slots = [earliest, `${baseDay.toISOString().slice(0, 10)} 2:30 PM`];

  // Mirror the real branch: consent plus a name books, anything less reports.
  const booked = Boolean(mission.bookingConsent && mission.callerName);

  return {
    targetId: target.id,
    venueName: target.venueName,
    status: "completed",
    outcome: booked ? "booked" : "slots_offered",
    confidence: "high",
    evidence: [
      booked
        ? `Front desk confirmed ${earliest} for ${mission.service} under ${mission.callerName}.`
        : `Front desk offered ${slots.length} openings for ${mission.service}.`
    ],
    followUpRequired: !booked,
    followUpInstructions: booked
      ? ""
      : "Call back to confirm and book the slot that works for you.",
    completedAt: new Date(Date.now() + targetIndex * 1000).toISOString(),
    data: {
      booked: booked ? earliest : "",
      confirmation: booked ? "MOCK-4821" : "",
      cancellationPolicy: booked ? "Free to cancel up to 24 hours before." : "",
      earliest,
      slots
    }
  };
}

export const appointmentScout: MissionTemplate<Intake, Data> = {
  // `kind` is the wire value the interpreter classifies into and the client
  // sends back, so it stays put even though the template now books.
  kind: "appointment_scout",
  label: "Appointment",
  blurb: "Book the earliest appointment in a time range you approve.",
  intakeSchema,
  resultSchema,
  outcomes: outcomeValues,
  buildCallTask,
  normalizeResult,
  rank,
  resultColumns: [
    { key: "booked", label: "Booked for" },
    { key: "confirmation", label: "Confirmation" },
    { key: "cancellationPolicy", label: "Cancellation policy" },
    { key: "earliest", label: "Earliest slot" },
    { key: "slots", label: "All slots offered" }
  ],
  mockResult
};
