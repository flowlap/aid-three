import type { Sequence, SequencePlan } from "./sequenceTypes";

/**
 * Finds the sequence (if any) that owns a given scene id, by scanning each
 * sequence's `sceneIds`. Small and self-contained so both screen-design
 * (Task 6) and any later step needing the same "which sequence owns this
 * scene" lookup (e.g. Task 8) can share it instead of re-deriving it inline.
 */
export function findSequenceForScene(plan: SequencePlan, sceneId: string): Sequence | undefined {
  return plan.sequences.find((seq) => seq.sceneIds.includes(sceneId));
}
