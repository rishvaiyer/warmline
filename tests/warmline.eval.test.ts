import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { baseMissionSchema, baseCallPreamble } from "../src/domain/base.js";
import { buildCommitmentWarning, extractTranscriptTurns, scanTranscriptForMoney, withCommitmentFields } from "../src/domain/commitments.js";
import { interpretIntent } from "../src/domain/interpret.js";
import { templates, getTemplate } from "../src/domain/registry.js";
import { translateMissionFields, translateResultStrings } from "../src/domain/translate.js";

const ENV_KEYS = [
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "OPEN_API_KEY",
  "OPENAI_KEY",
  "OPEN_AI_API_KEY"
];
const savedEnv = new Map<string, string | undefined>();

const target = {
  id: "venue-1",
  venueName: "Northstar Clinic",
  phoneE164: "+12025550123",
  department: "Front desk",
  approved: true as const
};

const base = {
  id: "mission-1",
  kind: "generic",
  userLocale: "en-US",
  disclosureAccepted: true as const,
  callerName: "Rishva Iyer",
  targets: [target]
};

beforeAll(() => {
  for (const key of ENV_KEYS) {
    savedEnv.set(key, process.env[key]);
    delete process.env[key];
  }
});

afterAll(() => {
  for (const key of ENV_KEYS) {
    const value = savedEnv.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("offline intent and mission routing", () => {
  it.each([
    ["appointment request", "Please book a dentist appointment", "appointment_scout"],
    ["open-hours question", "Are you open now?", "reachability"],
    ["price question", "What is the cost of a replacement key?", "reachability"],
    ["stock question", "Do you have this item in stock?", "reachability"],
    ["lost item request", "I lost my blue backpack yesterday", "lost_and_found"],
    ["unmatched request", "Ask whether the manager is in the office", "generic"]
  ])("routes %s without a provider call", async (_label, text, kind) => {
    const plan = await interpretIntent(text, "en-US");
    expect(plan.kind).toBe(kind);
    expect(plan.callGoal).toBeTruthy();
    expect(plan.disclosureLine).toMatch(/AI assistant/i);
    expect(plan.detectedLocale).toBe("en");
  });

  it("keeps appointment fallback explicitly read-only", async () => {
    const plan = await interpretIntent("Please book a dentist appointment", "en-US");
    expect(plan.callGoal).toMatch(/Do not book or hold anything/i);
    expect(plan.fields).toMatchObject({ service: expect.any(String) });
  });

  it("resolves every registered mission kind and rejects unknown kinds", () => {
    expect(Object.keys(templates)).toEqual(["lost_and_found", "appointment_scout", "reachability", "generic"]);
    expect(getTemplate("reachability").kind).toBe("reachability");
    expect(() => getTemplate("not-a-mission")).toThrow("Unknown mission kind");
  });
});

describe("translation boundaries and fallback preservation", () => {
  it("does not translate when locales match", async () => {
    const mission = { id: "m1", kind: "generic", callGoal: "Ask one question" };
    const result = await translateMissionFields(mission, "en-US", "en-US");
    expect(result).toBe(mission);
  });

  it("marks free-text mission fields offline and preserves protected fields", async () => {
    const mission = {
      id: "m1",
      kind: "reachability",
      userLocale: "en-US",
      callLocale: "es",
      mode: "price",
      subject: "replacement key",
      question: "How much is it?",
      partySize: 2,
      targets: [target]
    };
    const translated = await translateMissionFields(mission, "en-US", "es");
    expect(translated).toMatchObject({
      id: "m1",
      kind: "reachability",
      userLocale: "en-US",
      callLocale: "es",
      mode: "price",
      subject: "[es] replacement key",
      question: "[es] How much is it?",
      partySize: 2
    });
    expect(translated.targets[0]).toEqual(target);
  });

  it("translates result strings while preserving status, ids, and arrays", async () => {
    const result = {
      targetId: "venue-1",
      status: "completed",
      outcome: "answered",
      completedAt: "2025-01-01T00:00:00.000Z",
      followUpInstructions: "Call again tomorrow",
      data: { answer: "Open until five", slots: ["Monday 9 AM", "Tuesday 2 PM"], count: 2 }
    };
    const translated = await translateResultStrings(result, "en-US", "fr");
    expect(translated).toMatchObject({
      targetId: "venue-1",
      status: "completed",
      outcome: "answered",
      completedAt: "2025-01-01T00:00:00.000Z",
      followUpInstructions: "[fr] Call again tomorrow",
      data: { answer: "[fr] Open until five", slots: ["[fr] Monday 9 AM", "[fr] Tuesday 2 PM"], count: 2 }
    });
  });

});

describe("approval and real-call safety", () => {
  it("requires explicit approval and valid E.164 targets", () => {
    expect(baseMissionSchema.safeParse({ ...base, kind: "generic", callGoal: "Ask a question" }).success).toBe(true);
    expect(baseMissionSchema.safeParse({ ...base, targets: [{ ...target, approved: false }] }).success).toBe(false);
    expect(baseMissionSchema.safeParse({ ...base, targets: [{ ...target, phoneE164: "202-555-0123" }] }).success).toBe(false);
  });

  it("requires caller identity, disclosure, and one to five approved targets", () => {
    expect(baseMissionSchema.safeParse({ ...base, callerName: "" }).success).toBe(false);
    expect(baseMissionSchema.safeParse({ ...base, disclosureAccepted: false }).success).toBe(false);
    expect(baseMissionSchema.safeParse({ ...base, targets: [] }).success).toBe(false);
    expect(
      baseMissionSchema.safeParse({
        ...base,
        targets: Array.from({ length: 6 }, (_, index) => ({
          ...target,
          id: `venue-${index}`
        }))
      }).success
    ).toBe(false);
  });

  it("puts AI disclosure, caller identity, and no-payment instructions in every preamble", () => {
    const lines = baseCallPreamble({ ...base, kind: "generic" }, target);
    const preamble = lines.join(" ");
    expect(preamble).toMatch(/AI assistant/i);
    expect(preamble).toMatch(/on behalf of Rishva Iyer/i);
    expect(preamble).toMatch(/Never pay|Never.*card/i);
    expect(preamble).toMatch(/If money is required.*stop/i);
  });

  it("builds stable, bounded idempotency metadata through the shared helper", async () => {
    const { makeIdempotencyKey } = await import("../src/domain/base.js");
    expect(makeIdempotencyKey("appointment_scout", "mission/1", "venue/1")).toBe(
      "appointment_scout_mission_1_venue_1"
    );
    expect(makeIdempotencyKey("generic", "m".repeat(200), "v")).toHaveLength(120);
  });
});

describe("booking and monetary guardrails", () => {
  const appointment = templates.appointment_scout;
  const appointmentMission = {
    ...base,
    kind: "appointment_scout",
    service: "dentist",
    earliestAcceptable: "next week",
    latestAcceptable: "within two weeks"
  } as never;

  it("keeps appointment calls read-only without explicit booking consent", () => {
    const task = appointment.buildCallTask(appointmentMission, target);
    expect(task).toMatch(/Do not book, hold, or confirm anything/i);
    expect(task).not.toMatch(/You are authorized to hold and confirm exactly one appointment/i);
  });

  it("allows exactly one bounded booking only with consent and a caller name", () => {
    const task = appointment.buildCallTask(
      { ...appointmentMission, bookingConsent: true },
      target
    );
    expect(task).toMatch(/authorized to hold and confirm exactly one appointment/i);
    expect(task).toMatch(/nothing outside it/i);
    expect(task).toMatch(/Book one appointment only/i);
  });

  it("keeps lost-and-found private proof out of the call task", () => {
    const mission = {
      ...base,
      kind: "lost_and_found",
      itemType: "backpack",
      safeDescription: "small blue backpack with a sewn patch",
      privateProof: "serial number 123456789",
      lostWindow: "yesterday evening",
      lastSeen: "the lobby"
    } as never;
    const task = templates.lost_and_found.buildCallTask(mission, target);
    expect(task).toContain("small blue backpack with a sewn patch");
    expect(task).not.toContain("123456789");
    expect(() => templates.lost_and_found.guards?.({ ...mission, safeDescription: "serial number 123456789" })).toThrow(
      /private ownership proof/i
    );
  });

  it("adds required commitment fields to strict structured result schemas", () => {
    const schema = withCommitmentFields(templates.appointment_scout.resultSchema);
    expect(schema.properties).toMatchObject({ payment_committed: { type: "boolean" }, payment_details_shared: { type: "boolean" } });
    expect(schema.required).toEqual(expect.arrayContaining(["payment_committed", "payment_details_shared", "payment_note"]));
  });

  it.each([
    ["clean transcript", [{ text: "The appointment is free and available Tuesday." }], 0],
    ["card mention", [{ text: "Please read the credit card number." }], 1],
    ["assent to fee", [{ text: "Yes, that deposit is fine." }], 1],
    ["long number with payment talk", [{ text: "We will charge card 4111 1111 1111 1111." }], 1]
  ])("scans %s for money evidence", (_label, turns, expected) => {
    expect(scanTranscriptForMoney(turns as { text: string }[])).toHaveLength(expected);
  });

  it("surfaces either a self-report or independent transcript evidence", () => {
    expect(buildCommitmentWarning({ payment_committed: true, payment_note: "A deposit was accepted." }, [])).toMatchObject({
      moneyCommitted: true,
      transcriptFlagged: false,
      quotes: ["A deposit was accepted."]
    });
    expect(buildCommitmentWarning({ payment_committed: false }, [{ text: "Yes, go ahead with the fee." }])).toMatchObject({
      moneyCommitted: false,
      transcriptFlagged: true,
      quotes: ["Yes, go ahead with the fee."]
    });
    expect(buildCommitmentWarning({ payment_committed: false }, [])).toBeUndefined();
  });
});

describe("structured results, ranking, and failure behavior", () => {
  it("normalizes unknown generic provider output to a safe low-confidence result", () => {
    const result = templates.generic.normalizeResult(target, { status: "failed", structuredResult: {} });
    expect(result).toMatchObject({ status: "failed", outcome: "unknown", confidence: "low", followUpRequired: false });
    expect(result.data).toEqual({ summary: "", details: "" });
    expect(result.completedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("normalizes invalid reachability outcomes and preserves typed fields", () => {
    const result = templates.reachability.normalizeResult(target, {
      structuredResult: { outcome: "invented", answer: "Yes", price: "$9.00", open_now: "no" },
      completionConfidence: { label: "medium" },
      evidence: ["one", "two"]
    });
    expect(result).toMatchObject({ outcome: "unknown", confidence: "medium", followUpRequired: false, evidence: ["one", "two"] });
    expect(result.data).toEqual({ answer: "Yes", price: "$9.00", openNow: "no", inStock: undefined });
  });

  it("flags appointment offers and payment requirements for follow-up", () => {
    const offered = templates.appointment_scout.normalizeResult(target, {
      structuredResult: { outcome: "slots_offered", slots: ["Monday 9 AM"], earliest_slot: "Monday 9 AM" }
    });
    const payment = templates.appointment_scout.normalizeResult(target, {
      structuredResult: { outcome: "payment_required", notes: "Deposit required" }
    });
    expect(offered.followUpRequired).toBe(true);
    expect(offered.data.slots).toEqual(["Monday 9 AM"]);
    expect(payment.followUpRequired).toBe(true);
    expect(payment.followUpInstructions).toBe("Deposit required");
  });

  it("ranks confirmed bookings above offers and other outcomes", () => {
    const results = [
      templates.appointment_scout.normalizeResult({ ...target, id: "late" }, { structuredResult: { outcome: "slots_offered", earliest_slot: "2025-04-02" } }),
      templates.appointment_scout.normalizeResult({ ...target, id: "booked" }, { structuredResult: { outcome: "booked", booked_slot: "2025-04-03" } }),
      templates.appointment_scout.normalizeResult({ ...target, id: "none" }, { structuredResult: { outcome: "none_available" } })
    ];
    expect(templates.appointment_scout.rank(results).map((result) => result.targetId)).toEqual(["booked", "late", "none"]);
  });

  it("extracts nested transcripts and tolerates provider shape failures", () => {
    expect(extractTranscriptTurns({ recipients: [{ attempts: [{ transcriptTurns: [{ speaker: "agent", text: "hello" }, null] }] }] })).toEqual([
      { speaker: "agent", text: "hello" }
    ]);
    expect(extractTranscriptTurns({ recipients: [{ attempts: "not-an-array" }] })).toEqual([]);
    expect(extractTranscriptTurns({})).toEqual([]);
  });

  it("returns deterministic mock results for offline calls", () => {
    const result = templates.reachability.mockResult(
      { ...base, kind: "reachability", mode: "price", subject: "coffee", question: "What does it cost?" } as never,
      0
    );
    expect(result).toMatchObject({ status: "completed", outcome: "answered", confidence: "high", followUpRequired: false });
    expect(result.data.price).toBe("$4.00");
    expect(result.evidence).toHaveLength(1);
  });
});
