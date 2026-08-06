import { lostAndFound } from "./missions/lostAndFound.js";
import { appointmentScout } from "./missions/appointmentScout.js";
import { reachability } from "./missions/reachability.js";
import { generic } from "./missions/generic.js";

export const templates = {
  [lostAndFound.kind]: lostAndFound,
  [appointmentScout.kind]: appointmentScout,
  [reachability.kind]: reachability,
  [generic.kind]: generic
} as const;

export function getTemplate(kind: string) {
  const t = templates[kind as keyof typeof templates];
  if (!t) throw new Error(`Unknown mission kind: ${kind}`);
  return t;
}
