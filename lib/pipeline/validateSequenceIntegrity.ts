import type { Scene } from "./splitScenes";
import type { Sequence, SequenceIntegrityIssue, SequencePlan } from "./sequenceTypes";

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
 * Sequence-level structural checks: sequence id presence/uniqueness, a
 * non-empty scene list, and a well-formed duration value. These don't need
 * to know anything about scenes.json.
 */
function checkSequenceStructure(sequences: Sequence[]): DraftIssue[] {
  const issues: DraftIssue[] = [];
  const seenSequenceIds = new Set<string>();

  sequences.forEach((seq, seqPos) => {
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

  return issues;
}

/**
 * Checks every referenced scene id against scenes.json: flags references to
 * scenes that no longer exist (e.g. after a split/merge) and title-scene
 * inclusions (policy violation — see Sequence.sceneIds doc comment). Returns
 * a map of every known, non-title scene id to the sequence ids that
 * reference it, which checkExactlyOnceInclusion uses next — passed as a
 * return value/parameter rather than a shared closure so each check stays
 * independently readable and testable.
 */
function checkSceneExistenceAndTitlePolicy(
  sequences: Sequence[],
  sceneById: Map<string, Scene>
): { issues: DraftIssue[]; occurrences: Map<string, string[]> } {
  const issues: DraftIssue[] = [];
  const occurrences = new Map<string, string[]>();

  for (const seq of sequences) {
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

  return { issues, occurrences };
}

/**
 * Every content scene must appear in exactly one sequence: flags a scene
 * referenced by more than one sequence (or twice within one) and content
 * scenes referenced by none. Takes the occurrences map produced by
 * checkSceneExistenceAndTitlePolicy as a parameter rather than recomputing
 * or closing over it.
 */
function checkExactlyOnceInclusion(occurrences: Map<string, string[]>, contentSceneIds: string[]): DraftIssue[] {
  const issues: DraftIssue[] = [];

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

  return issues;
}

/**
 * The flattened scene order across the whole plan (sequences sorted by
 * `order`, scenes within each in sceneIds array order) must match
 * scenes.json's content-scene order. Catches both sequences placed out of
 * order relative to each other and scenes out of order within one sequence.
 * Unknown/title references are skipped here since they're already reported
 * by checkSceneExistenceAndTitlePolicy.
 */
function checkSceneOrder(sequences: Sequence[], contentSceneIndex: Map<string, number>): DraftIssue[] {
  const issues: DraftIssue[] = [];

  const orderedSequences = [...sequences]
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

  return issues;
}

/**
 * Compares each sequence's stored estimatedDurationSec against the sum of
 * its referenced (known) scenes' own estimatedDurationSec, rather than
 * trusting the stored estimate at face value. See DURATION_TOLERANCE_* above.
 */
function checkDurations(sequences: Sequence[], sceneById: Map<string, Scene>): DraftIssue[] {
  const issues: DraftIssue[] = [];

  for (const seq of sequences) {
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

  return issues;
}

/** Camera plan / overlay entries must reference a scene within their own sequence. */
function checkCameraAndOverlayReferences(sequences: Sequence[]): DraftIssue[] {
  const issues: DraftIssue[] = [];

  for (const seq of sequences) {
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

  return issues;
}

/** Assigns a stable id to each issue, numbered per-type so `${type}-1`, `${type}-2`, … reads as advertised. */
function assignIssueIds(issues: DraftIssue[]): SequenceIntegrityIssue[] {
  const counters = new Map<string, number>();
  return issues.map((issue) => {
    const next = (counters.get(issue.type) ?? 0) + 1;
    counters.set(issue.type, next);
    return { id: `${issue.type}-${next}`, ...issue };
  });
}

/**
 * Pure structural/referential integrity check for a SequencePlan against the
 * current scenes.json contents. Returns a list of structured issues instead
 * of throwing, so callers (API routes, editor UI) can surface all problems
 * at once for normal invalid user/AI input. A plan referencing scene IDs
 * that no longer exist (e.g. after a split/merge changed scene.json's IDs)
 * is reported as `unknown-scene-reference` / `missing-scene-reference`
 * issues here, not a crash. Empty inputs (`scenes: []` and/or
 * `plan.sequences: []`) are valid and simply produce no issues to report
 * (with an empty plan, there are no content scenes left unreferenced).
 *
 * This is the orchestrator: it builds the shared scene lookup maps once and
 * runs each independent check against them, concatenating their results
 * (mirrors lib/pipeline/reviewConsistency.ts's checkDuplicateLayouts /
 * checkOverlongNarration / checkSceneNumbering split).
 */
export function validateSequenceIntegrity(scenes: Scene[], plan: SequencePlan): SequenceIntegrityIssue[] {
  const sceneById = new Map(scenes.map((scene) => [scene.id, scene]));
  const contentSceneIds = scenes.filter(isContentScene).map((scene) => scene.id);
  const contentSceneIndex = new Map(contentSceneIds.map((id, index) => [id, index]));

  const { issues: referenceIssues, occurrences } = checkSceneExistenceAndTitlePolicy(plan.sequences, sceneById);

  const issues: DraftIssue[] = [
    ...checkSequenceStructure(plan.sequences),
    ...referenceIssues,
    ...checkExactlyOnceInclusion(occurrences, contentSceneIds),
    ...checkSceneOrder(plan.sequences, contentSceneIndex),
    ...checkDurations(plan.sequences, sceneById),
    ...checkCameraAndOverlayReferences(plan.sequences),
  ];

  return assignIssueIds(issues);
}
