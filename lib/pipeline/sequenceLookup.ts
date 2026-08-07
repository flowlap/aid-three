import { readSequenceMasterImage, projectSequenceMasterImagePath } from "@/lib/projects/store";
import type { Sequence, SequencePlan } from "./sequenceTypes";
import type { Scene } from "./splitScenes";

/**
 * Finds the sequence (if any) that owns a given scene id, by scanning each
 * sequence's `sceneIds`. Small and self-contained so both screen-design
 * (Task 6) and any later step needing the same "which sequence owns this
 * scene" lookup (e.g. Task 8) can share it instead of re-deriving it inline.
 */
export function findSequenceForScene(plan: SequencePlan, sceneId: string): Sequence | undefined {
  return plan.sequences.find((seq) => seq.sceneIds.includes(sceneId));
}

export interface SequenceSceneGroup {
  sequenceId: string;
  scenes: Scene[];
}

/**
 * Groups scenes by their owning sequence, in the sequences' plan order, for
 * batching sequence-mode image generation one unit of work per sequence (so
 * scenes generated within a sequence can share master-image/continuity
 * context and be processed in narration order) — see Task 8's image
 * generation routes.
 *
 * Callers must have already passed validateSequenceIntegrity's
 * error-severity checks (see loadSequenceContextByScene) — a content scene
 * with no owning sequence is a validation error, not a case this function
 * needs to handle defensively.
 *
 * Scenes within a sequence are ordered to match the sequence's own
 * `sceneIds` order (not necessarily `scenes`' array order), since that's the
 * order validateSequenceIntegrity's scene-order-mismatch check treats as
 * authoritative once the plan is valid. A scene id present in the plan but no
 * longer in `scenes` (e.g. deleted after the plan was written but the plan
 * not yet updated) is silently skipped rather than crashing, and a sequence
 * left with zero remaining scenes is omitted from the result entirely.
 */
export function groupScenesBySequence(scenes: Scene[], plan: SequencePlan): SequenceSceneGroup[] {
  const sceneById = new Map(scenes.map((s) => [s.id, s]));
  return plan.sequences
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((seq) => ({
      sequenceId: seq.id,
      scenes: seq.sceneIds.map((id) => sceneById.get(id)).filter((s): s is Scene => s !== undefined),
    }))
    .filter((group) => group.scenes.length > 0);
}

export interface SequenceMasterAsset {
  buffer?: Buffer;
  path?: string;
}

/**
 * Loads a sequence's master reference image, for both routes that generate
 * scene images in sequence mode (the batch route and the single-scene
 * regenerate route — see Task 8). Returns an empty object (no buffer/path)
 * when there's no readable master image, which callers treat as "fall back
 * to the textual continuity instruction in buildImagePrompt."
 *
 * A "stale" master (see staleIfGenerated in sequenceEditorOps.ts) is still a
 * real, on-disk image — editing the plan's continuity text doesn't delete
 * the file, it only flags the sequence as needing eventual regeneration
 * (surfaced to the user as "재생성 필요 (변경됨)" in SequencePlanEditor.tsx).
 * Treating "stale" the same as "not-generated" here would silently discard a
 * perfectly readable continuity plate, so both "generated" and "stale" are
 * accepted so long as `assetId` is set and the file is actually readable.
 */
export async function loadSequenceMasterAsset(
  projectId: string,
  sequence: Sequence | undefined
): Promise<SequenceMasterAsset> {
  const { status, assetId } = sequence?.masterVisual ?? {};
  if (!sequence || (status !== "generated" && status !== "stale") || !assetId) return {};
  const buffer = await readSequenceMasterImage(projectId, sequence.id, assetId);
  if (!buffer) return {};
  return { buffer, path: projectSequenceMasterImagePath(projectId, sequence.id, assetId) };
}
