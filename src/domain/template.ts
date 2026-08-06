import type { z } from "zod";
import type { TargetInput, BaseMission, CallResult } from "./base.js";

export interface MissionTemplate<TInput, TData> {
  kind: string; // "lost_and_found" | "appointment_scout" | "reachability" | "generic"
  label: string; // picker title
  blurb: string; // one-line pitch in the picker
  intakeSchema: z.ZodType<TInput>; // mission-only fields (base fields added by engine)
  resultSchema: Record<string, unknown>; // JSON schema CALL-E extracts into
  outcomes: readonly string[]; // allowed outcome enum for this mission

  buildCallTask(mission: TInput & BaseMission, target: TargetInput): string;
  normalizeResult(target: TargetInput, provider: Record<string, unknown>): CallResult<TData>;
  rank(results: CallResult<TData>[]): CallResult<TData>[]; // ordering for the "best answer" view
  resultColumns: { key: string; label: string }[]; // how the unified table renders TData
  guards?(mission: TInput & BaseMission): void; // extra validation; throws on violation
  mockResult(mission: TInput & BaseMission, targetIndex: number): CallResult<TData>;
}
