import type { Scene } from "./splitScenes";
import type { Sequence, SequenceContinuity, SequencePlan } from "./sequenceTypes";

/**
 * Pure, UI-independent editing operations for the sequence-plan editor
 * (Task 5, app/projects/[projectId]/(pipeline)/sequences/SequencePlanEditor.tsx).
 * Kept out of the component so this logic can be unit tested without a
 * component-rendering test setup (this repo has none — see
 * sequenceEditorOps.test.ts and vitest.config.ts's `lib/**` -only include).
 *
 * Idiom: every op returns `{ plan }` on success or `{ error }` on normal
 * invalid input (unknown id, non-adjacent target, would-empty result) —
 * mirrors readScenesOrError in app/api/projects/[projectId]/sequences/route.ts
 * and validateSequenceIntegrity's "structured issues, not throw" convention.
 * These ops do their own lightweight structural checks for immediate UI
 * feedback only; the PUT /api/projects/[projectId]/sequences endpoint's
 * server-side validateSequenceIntegrity call remains the sole authority
 * before anything is actually persisted (see this module's callers).
 */

export type SequenceOpResult = { plan: SequencePlan } | { error: string };

function buildSceneMap(scenes: Scene[]): Map<string, Scene> {
  return new Map(scenes.map((scene) => [scene.id, scene]));
}

/**
 * Sums the referenced scenes' own estimatedDurationSec — mirrors
 * validateSequenceIntegrity.ts's checkDurations derivation exactly (an
 * unknown/removed scene id contributes 0), so this module never diverges
 * from what the integrity checker considers "the real duration."
 */
function sceneDurationSum(sceneIds: string[], sceneById: Map<string, Scene>): number {
  return sceneIds.reduce((total, id) => {
    const scene = sceneById.get(id);
    return scene ? total + scene.estimatedDurationSec : total;
  }, 0);
}

/** Sequences in plan order — every op reads/writes through this so array position always matches `order`. */
export function sortedSequences(plan: SequencePlan): Sequence[] {
  return [...plan.sequences].sort((a, b) => a.order - b.order);
}

/** Reassigns `order` 1..n from array position. Called after every structural op so `order` never drifts from actual position. */
function renumberOrders(sequences: Sequence[]): Sequence[] {
  return sequences.map((seq, index) => ({ ...seq, order: index + 1 }));
}

/** Derived (non-stale) total duration for a sequence, for display alongside the possibly-stale stored estimate. */
export function deriveSequenceDurationSec(sceneIds: string[], scenes: Scene[]): number {
  return sceneDurationSum(sceneIds, buildSceneMap(scenes));
}

/**
 * A master visual generated against the old description/continuity no longer
 * matches once either changes — mark it stale so the editor can surface a
 * warning (Task 5) ahead of Task 7's actual regeneration action. A
 * "not-generated" master has nothing to go stale, so it's left alone.
 */
function staleIfGenerated(masterVisual: Sequence["masterVisual"]): Sequence["masterVisual"] {
  return masterVisual.status === "generated" ? { ...masterVisual, status: "stale" } : masterVisual;
}

function findSequenceIndex(plan: SequencePlan, sequenceId: string): number {
  return plan.sequences.findIndex((seq) => seq.id === sequenceId);
}

export function renameSequence(plan: SequencePlan, sequenceId: string, newTitle: string): SequenceOpResult {
  const idx = findSequenceIndex(plan, sequenceId);
  if (idx === -1) return { error: `시퀀스를 찾을 수 없습니다: ${sequenceId}` };

  const title = newTitle.trim();
  if (!title) return { error: "시퀀스 제목을 입력해주세요" };

  const sequences = plan.sequences.map((seq, i) => (i === idx ? { ...seq, title } : seq));
  return { plan: { ...plan, sequences } };
}

export function updateContinuity(
  plan: SequencePlan,
  sequenceId: string,
  patch: Partial<SequenceContinuity>
): SequenceOpResult {
  const idx = findSequenceIndex(plan, sequenceId);
  if (idx === -1) return { error: `시퀀스를 찾을 수 없습니다: ${sequenceId}` };

  const sequences = plan.sequences.map((seq, i) => {
    if (i !== idx) return seq;
    return {
      ...seq,
      continuity: { ...seq.continuity, ...patch },
      masterVisual: staleIfGenerated(seq.masterVisual),
    };
  });
  return { plan: { ...plan, sequences } };
}

export function updateMasterVisualDescription(
  plan: SequencePlan,
  sequenceId: string,
  description: string
): SequenceOpResult {
  const idx = findSequenceIndex(plan, sequenceId);
  if (idx === -1) return { error: `시퀀스를 찾을 수 없습니다: ${sequenceId}` };

  const sequences = plan.sequences.map((seq, i) => {
    if (i !== idx) return seq;
    return { ...seq, masterVisual: staleIfGenerated({ ...seq.masterVisual, description }) };
  });
  return { plan: { ...plan, sequences } };
}

/**
 * Moves one scene to the previous/next sequence in plan order. Only a
 * boundary scene may move — the first scene of a sequence toward "prev", or
 * the last scene toward "next" — because moving an interior scene would
 * reorder it relative to its own neighbors and violate the flattened
 * scene-order invariant validateSequenceIntegrity enforces (checkSceneOrder).
 * Moving a boundary scene instead always lands it adjacent to the same
 * neighbor it started next to, so order is preserved by construction.
 *
 * Carries that scene's own cameraPlan/overlay entries along to the target
 * sequence (they describe the scene, not the sequence), and recomputes both
 * affected sequences' estimatedDurationSec by re-summing referenced scenes'
 * own durations — never trusting the old stored estimate.
 */
export function moveSceneToAdjacentSequence(
  plan: SequencePlan,
  scenes: Scene[],
  sceneId: string,
  direction: "prev" | "next"
): SequenceOpResult {
  const sorted = sortedSequences(plan);
  const srcIdx = sorted.findIndex((seq) => seq.sceneIds.includes(sceneId));
  if (srcIdx === -1) return { error: `씬을 찾을 수 없습니다: ${sceneId}` };

  const targetIdx = direction === "prev" ? srcIdx - 1 : srcIdx + 1;
  if (targetIdx < 0 || targetIdx >= sorted.length) {
    return { error: "이동할 인접 시퀀스가 없습니다" };
  }

  const src = sorted[srcIdx];
  if (src.sceneIds.length <= 1) {
    return { error: "시퀀스에 남은 씬이 하나뿐이라 이동하면 빈 시퀀스가 됩니다" };
  }

  const isBoundaryScene =
    direction === "prev" ? src.sceneIds[0] === sceneId : src.sceneIds[src.sceneIds.length - 1] === sceneId;
  if (!isBoundaryScene) {
    return { error: "인접 시퀀스로는 시퀀스의 맨 앞/뒤 씬만 이동할 수 있습니다" };
  }

  const target = sorted[targetIdx];
  const sceneById = buildSceneMap(scenes);

  const newSrcSceneIds = src.sceneIds.filter((id) => id !== sceneId);
  const movedCameraPlan = src.cameraPlan.filter((entry) => entry.sceneId === sceneId);
  const movedOverlays = src.overlays.filter((entry) => entry.sceneId === sceneId);

  const newTargetSceneIds = direction === "prev" ? [...target.sceneIds, sceneId] : [sceneId, ...target.sceneIds];
  const newTargetCameraPlan =
    direction === "prev" ? [...target.cameraPlan, ...movedCameraPlan] : [...movedCameraPlan, ...target.cameraPlan];
  const newTargetOverlays =
    direction === "prev" ? [...target.overlays, ...movedOverlays] : [...movedOverlays, ...target.overlays];

  const updatedSrc: Sequence = {
    ...src,
    sceneIds: newSrcSceneIds,
    cameraPlan: src.cameraPlan.filter((entry) => entry.sceneId !== sceneId),
    overlays: src.overlays.filter((entry) => entry.sceneId !== sceneId),
    estimatedDurationSec: sceneDurationSum(newSrcSceneIds, sceneById),
  };
  const updatedTarget: Sequence = {
    ...target,
    sceneIds: newTargetSceneIds,
    cameraPlan: newTargetCameraPlan,
    overlays: newTargetOverlays,
    estimatedDurationSec: sceneDurationSum(newTargetSceneIds, sceneById),
  };

  const nextSequences = sorted.map((seq) => {
    if (seq.id === updatedSrc.id) return updatedSrc;
    if (seq.id === updatedTarget.id) return updatedTarget;
    return seq;
  });

  return { plan: { ...plan, sequences: renumberOrders(nextSequences) } };
}

/**
 * Merges two adjacent (by plan order) sequences into one: `secondSequenceId`
 * must be the sequence immediately after `firstSequenceId`. The merged
 * sequence keeps `firstSequenceId`'s id/title (the user can rename
 * afterward); sceneIds/cameraPlan/overlays are concatenated in order so
 * scene order and per-scene metadata are both preserved exactly.
 */
export function mergeAdjacentSequences(
  plan: SequencePlan,
  scenes: Scene[],
  firstSequenceId: string,
  secondSequenceId: string
): SequenceOpResult {
  const sorted = sortedSequences(plan);
  const firstIdx = sorted.findIndex((seq) => seq.id === firstSequenceId);
  const secondIdx = sorted.findIndex((seq) => seq.id === secondSequenceId);

  if (firstIdx === -1 || secondIdx === -1) {
    return { error: "병합할 시퀀스를 찾을 수 없습니다" };
  }
  if (secondIdx !== firstIdx + 1) {
    return { error: "서로 인접한 시퀀스만 병합할 수 있습니다" };
  }

  const first = sorted[firstIdx];
  const second = sorted[secondIdx];
  const sceneById = buildSceneMap(scenes);
  const mergedSceneIds = [...first.sceneIds, ...second.sceneIds];

  const merged: Sequence = {
    ...first,
    sceneIds: mergedSceneIds,
    cameraPlan: [...first.cameraPlan, ...second.cameraPlan],
    overlays: [...first.overlays, ...second.overlays],
    estimatedDurationSec: sceneDurationSum(mergedSceneIds, sceneById),
  };
  if (first.needsReview || second.needsReview) {
    merged.needsReview = true;
  } else {
    delete merged.needsReview;
  }

  const nextSequences = [...sorted.slice(0, firstIdx), merged, ...sorted.slice(secondIdx + 1)];
  return { plan: { ...plan, sequences: renumberOrders(nextSequences) } };
}

/** Finds a filename-safe id for the new sequence created by a split, avoiding collisions with existing ids — mirrors SceneListEditor.tsx's nextSplitId. */
function nextSequenceId(existingIds: string[], baseId: string): string {
  const idSet = new Set(existingIds);
  if (!idSet.has(`${baseId}-b`)) return `${baseId}-b`;
  let n = 2;
  while (idSet.has(`${baseId}-${n}`)) n += 1;
  return `${baseId}-${n}`;
}

/**
 * Splits one sequence into two at a scene boundary: `splitAfterSceneId` and
 * everything before it stay in the first half; everything after moves to a
 * newly created second half. Rejects if `splitAfterSceneId` isn't in this
 * sequence, or if it's the sequence's last scene (the second half would be
 * empty). Subsequent sequences' `order` is renumbered to make room.
 */
export function splitSequence(
  plan: SequencePlan,
  scenes: Scene[],
  sequenceId: string,
  splitAfterSceneId: string
): SequenceOpResult {
  const sorted = sortedSequences(plan);
  const idx = sorted.findIndex((seq) => seq.id === sequenceId);
  if (idx === -1) return { error: `시퀀스를 찾을 수 없습니다: ${sequenceId}` };

  const seq = sorted[idx];
  const splitPos = seq.sceneIds.indexOf(splitAfterSceneId);
  if (splitPos === -1) {
    return { error: `분할 기준 씬이 해당 시퀀스에 없습니다: ${splitAfterSceneId}` };
  }
  if (splitPos === seq.sceneIds.length - 1) {
    return { error: "분할 기준 씬 뒤에 남는 씬이 없어 분할할 수 없습니다" };
  }

  const firstSceneIds = seq.sceneIds.slice(0, splitPos + 1);
  const secondSceneIds = seq.sceneIds.slice(splitPos + 1);
  const firstSet = new Set(firstSceneIds);
  const sceneById = buildSceneMap(scenes);

  const firstSeq: Sequence = {
    ...seq,
    sceneIds: firstSceneIds,
    cameraPlan: seq.cameraPlan.filter((entry) => firstSet.has(entry.sceneId)),
    overlays: seq.overlays.filter((entry) => firstSet.has(entry.sceneId)),
    estimatedDurationSec: sceneDurationSum(firstSceneIds, sceneById),
  };
  const secondSeq: Sequence = {
    ...seq,
    id: nextSequenceId(sorted.map((s) => s.id), seq.id),
    title: `${seq.title} (2)`,
    sceneIds: secondSceneIds,
    cameraPlan: seq.cameraPlan.filter((entry) => !firstSet.has(entry.sceneId)),
    overlays: seq.overlays.filter((entry) => !firstSet.has(entry.sceneId)),
    estimatedDurationSec: sceneDurationSum(secondSceneIds, sceneById),
  };

  const nextSequences = [...sorted.slice(0, idx), firstSeq, secondSeq, ...sorted.slice(idx + 1)];
  return { plan: { ...plan, sequences: renumberOrders(nextSequences) } };
}
