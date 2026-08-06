import type { Scene } from "./splitScenes";
import type { SequenceIntegrityIssue, SequencePlan } from "./sequenceTypes";

/**
 * Tolerance for comparing a sequence's stored `estimatedDurationSec` (an
 * AI/user estimate) against the value independently derived by summing the
 * referenced scenes' own `estimatedDurationSec`. Estimates are rarely exact
 * matches of their own inputs (rounding, later per-scene edits, etc.), so a
 * small gap is expected and not worth flagging. We tolerate whichever is
 * larger of a flat 1 second or 5% of the derived total, and flag anything
 * beyond that as a `duration-mismatch` (severity "warning" — it signals a
 * possibly-stale plan, but never blocks saving on its own).
 */
const DURATION_TOLERANCE_RATIO = 0.05;
const DURATION_TOLERANCE_FLOOR_SEC = 1;

type DraftIssue = Omit<SequenceIntegrityIssue, "id">;

function isContentScene(scene: Scene): boolean {
  return (scene.sceneType ?? "content") === "content";
}

/**
 * Pure structural/referential integrity check for a SequencePlan against the
 * current scenes.json contents. Returns a list of structured issues instead
 * of throwing, so callers (API routes, editor UI) can surface all problems
 * at once for normal invalid user/AI input. A plan referencing scene IDs
 * that no longer exist (e.g. after a split/merge changed scene.json's IDs)
 * is reported as `unknown-scene-reference` / `missing-scene-reference`
 * issues here, not a crash.
 */
export function validateSequenceIntegrity(scenes: Scene[], plan: SequencePlan): SequenceIntegrityIssue[] {
  const issues: DraftIssue[] = [];

  const sceneById = new Map(scenes.map((scene) => [scene.id, scene]));
  const contentSceneIds = scenes.filter(isContentScene).map((scene) => scene.id);
  const contentSceneIndex = new Map(contentSceneIds.map((id, index) => [id, index]));

  // --- Sequence-level structural checks: id presence/uniqueness, non-empty, duration shape ---
  const seenSequenceIds = new Set<string>();
  plan.sequences.forEach((seq, seqPos) => {
    const label = seq.id || `#${seqPos + 1}`;

    if (!seq.id || seq.id.trim() === "") {
      issues.push({
        type: "missing-sequence-id",
        severity: "error",
        sequenceId: seq.id,
        sceneIds: [],
        message: `시퀀스 ID가 비어 있습니다 (${seqPos + 1}번째 시퀀스)`,
      });
    } else if (seenSequenceIds.has(seq.id)) {
      issues.push({
        type: "duplicate-sequence-id",
        severity: "error",
        sequenceId: seq.id,
        sceneIds: [],
        message: `시퀀스 ID가 중복되었습니다: ${seq.id}`,
      });
    } else {
      seenSequenceIds.add(seq.id);
    }

    if (seq.sceneIds.length === 0) {
      issues.push({
        type: "empty-sequence",
        severity: "error",
        sequenceId: seq.id,
        sceneIds: [],
        message: `시퀀스에 씬이 하나도 없습니다: ${label}`,
      });
    }

    if (!Number.isFinite(seq.estimatedDurationSec) || seq.estimatedDurationSec < 0) {
      issues.push({
        type: "invalid-duration",
        severity: "error",
        sequenceId: seq.id,
        sceneIds: [],
        message: `시퀀스의 예상 재생시간이 올바르지 않습니다: ${label} (${seq.estimatedDurationSec})`,
      });
    }
  });

  // --- Scene reference checks: existence, title policy, exactly-once inclusion ---
  // sceneId -> ids of sequences that reference it (known, non-title scenes only;
  // unknown/title references are reported individually above/below instead).
  const occurrences = new Map<string, string[]>();

  for (const seq of plan.sequences) {
    for (const sceneId of seq.sceneIds) {
      const scene = sceneById.get(sceneId);
      if (!scene) {
        issues.push({
          type: "unknown-scene-reference",
          severity: "error",
          sequenceId: seq.id,
          sceneIds: [sceneId],
          message: `존재하지 않는 씬을 참조합니다: ${sceneId} (시퀀스: ${seq.id || "?"})`,
        });
        continue;
      }
      if (scene.sceneType === "title") {
        issues.push({
          type: "title-scene-included",
          severity: "error",
          sequenceId: seq.id,
          sceneIds: [sceneId],
          message: `타이틀 씬은 시퀀스에 포함할 수 없습니다: ${sceneId} (시퀀스: ${seq.id || "?"})`,
        });
        continue;
      }
      const list = occurrences.get(sceneId) ?? [];
      list.push(seq.id);
      occurrences.set(sceneId, list);
    }
  }

  for (const [sceneId, seqIds] of occurrences) {
    if (seqIds.length > 1) {
      issues.push({
        type: "duplicate-scene-reference",
        severity: "error",
        sceneIds: [sceneId],
        message: `씬이 두 번 이상 참조되었습니다: ${sceneId} (시퀀스: ${seqIds.join(", ")})`,
      });
    }
  }

  for (const sceneId of contentSceneIds) {
    if (!occurrences.has(sceneId)) {
      issues.push({
        type: "missing-scene-reference",
        severity: "error",
        sceneIds: [sceneId],
        message: `씬이 어떤 시퀀스에도 포함되지 않았습니다: ${sceneId}`,
      });
    }
  }

  // --- Order check: the flattened scene order across the whole plan (sequences
  // sorted by `order`, scenes within each in sceneIds array order) must match
  // scenes.json's content-scene order. Catches both sequences placed out of
  // order relative to each other and scenes out of order within one sequence.
  // Unknown/title references are skipped here since they're already reported above.
  const orderedSequences = [...plan.sequences]
    .map((seq, position) => ({ seq, position }))
    .sort((a, b) => (a.seq.order !== b.seq.order ? a.seq.order - b.seq.order : a.position - b.position));

  let previousIndex = -1;
  let previousSceneId: string | null = null;
  for (const { seq } of orderedSequences) {
    for (const sceneId of seq.sceneIds) {
      const index = contentSceneIndex.get(sceneId);
      if (index === undefined) continue;
      if (index <= previousIndex) {
        issues.push({
          type: "scene-order-mismatch",
          severity: "error",
          sequenceId: seq.id,
          sceneIds: previousSceneId ? [previousSceneId, sceneId] : [sceneId],
          message: previousSceneId
            ? `씬 순서가 scenes.json 순서와 일치하지 않습니다: ${previousSceneId} 다음에 ${sceneId}가 올 수 없습니다`
            : `씬 순서가 scenes.json 순서와 일치하지 않습니다: ${sceneId}`,
        });
      }
      previousIndex = Math.max(previousIndex, index);
      previousSceneId = sceneId;
    }
  }

  // --- Duration derivation: compare each sequence's stored estimate against the
  // sum of its referenced (known) scenes' own estimatedDurationSec. ---
  for (const seq of plan.sequences) {
    if (!Number.isFinite(seq.estimatedDurationSec)) continue; // already flagged as invalid-duration
    const derived = seq.sceneIds.reduce((total, sceneId) => {
      const scene = sceneById.get(sceneId);
      return scene ? total + scene.estimatedDurationSec : total;
    }, 0);
    const tolerance = Math.max(DURATION_TOLERANCE_FLOOR_SEC, derived * DURATION_TOLERANCE_RATIO);
    if (Math.abs(derived - seq.estimatedDurationSec) > tolerance) {
      issues.push({
        type: "duration-mismatch",
        severity: "warning",
        sequenceId: seq.id,
        sceneIds: [...seq.sceneIds],
        message: `시퀀스 예상 재생시간(${seq.estimatedDurationSec}초)이 씬 기준 합계(${derived}초)와 차이가 큽니다: ${seq.id}`,
      });
    }
  }

  // --- Camera plan / overlay entries must reference a scene within their own sequence ---
  for (const seq of plan.sequences) {
    const sceneIdSet = new Set(seq.sceneIds);
    for (const cam of seq.cameraPlan) {
      if (!sceneIdSet.has(cam.sceneId)) {
        issues.push({
          type: "camera-plan-scene-mismatch",
          severity: "error",
          sequenceId: seq.id,
          sceneIds: [cam.sceneId],
          message: `카메라 계획이 시퀀스에 포함되지 않은 씬을 참조합니다: ${cam.sceneId} (시퀀스: ${seq.id || "?"})`,
        });
      }
    }
    for (const overlay of seq.overlays) {
      if (!sceneIdSet.has(overlay.sceneId)) {
        issues.push({
          type: "overlay-scene-mismatch",
          severity: "error",
          sequenceId: seq.id,
          sceneIds: [overlay.sceneId],
          message: `오버레이가 시퀀스에 포함되지 않은 씬을 참조합니다: ${overlay.sceneId} (시퀀스: ${seq.id || "?"})`,
        });
      }
    }
  }

  return issues.map((issue, index) => ({ id: `${issue.type}-${index + 1}`, ...issue }));
}
