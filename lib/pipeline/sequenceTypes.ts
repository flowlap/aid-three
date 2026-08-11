/**
 * Data model for the sequence-based production mode (see
 * docs/superpowers/plans/2026-08-07-dual-production-mode-sequence-plan.md).
 *
 * `sequences.json` is written only for sequence-mode projects. It references
 * scene IDs from scenes.json in order and owns continuity, master visual,
 * camera, and overlay metadata — it never duplicates narration text.
 */

export type ShotType = "wide" | "medium" | "detail" | "close-up";

export type CameraMotion =
  | "static"
  | "slow-push-in"
  | "slow-pull-out"
  | "pan-left"
  | "pan-right"
  | "follow-flow";

export type OverlayType = "label" | "arrow-flow" | "highlight" | "diagram" | "chart";

/** A normalized rectangle over the master visual, used only for deterministic emphasis. */
export interface SequenceOverlayTarget {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Structured educational content that the sequence renderer can draw without
 * guessing from prose. `description` remains the backwards-compatible
 * fallback for plans created before this contract existed.
 */
export type SequenceOverlayContent =
  | { kind: "label"; title: string; body?: string }
  | { kind: "flow"; steps: string[] }
  | { kind: "diagram"; layout: "flow" | "radial" | "hierarchy"; nodes: string[] }
  | { kind: "chart"; chartType: "bar" | "line"; labels: string[]; values: number[]; unit?: string }
  | { kind: "highlight"; label?: string; target?: SequenceOverlayTarget };

export interface SequenceContinuity {
  location: string;
  timeOfDay?: string;
  visualStyle: string;
  fixedElements: string[];
  doNotChange: string[];
}

export interface SequenceMasterVisual {
  description: string;
  prompt?: string;
  status: "not-generated" | "generated" | "stale";
  assetId?: string;
}

export interface SequenceCameraPlanEntry {
  sceneId: string;
  shot: ShotType;
  motion: CameraMotion;
}

export interface SequenceOverlayEntry {
  sceneId: string;
  type: OverlayType;
  description: string;
  /** Optional structured payload for the code renderer; absent on legacy plans. */
  content?: SequenceOverlayContent;
}

export interface Sequence {
  /** sequence-001, sequence-002 … — see assertSafeSequenceId in lib/projects/store.ts for the accepted shape. */
  id: string;
  order: number;
  title: string;
  /**
   * Reference-only, ordered list of content-scene IDs (from scenes.json)
   * that belong to this sequence. Narration text is NEVER copied here —
   * always look it up from scenes.json by ID.
   *
   * Title policy (recommended; enforced by validateSequenceIntegrity):
   * scene IDs whose `sceneType === "title"` must NEVER appear in this list.
   * The existing storyboard/video renderer already produces title cards
   * directly from scenes.json without going through sequence image
   * generation, so title scenes have no visual continuity to contribute and
   * are intentionally excluded — including one here is a validation error,
   * not a silent no-op.
   */
  sceneIds: string[];
  /**
   * AI/user-estimated total duration for this sequence, produced when the
   * plan is authored or edited. This is an ESTIMATE, not trusted truth:
   * validateSequenceIntegrity independently derives the real total by
   * summing the referenced scenes' own `estimatedDurationSec` and flags a
   * large discrepancy as a `duration-mismatch` issue instead of trusting
   * this field at face value.
   */
  estimatedDurationSec: number;
  purpose: string;
  continuity: SequenceContinuity;
  masterVisual: SequenceMasterVisual;
  cameraPlan: SequenceCameraPlanEntry[];
  overlays: SequenceOverlayEntry[];
  needsReview?: boolean;
}

export interface SequencePlan {
  version: 1;
  sequences: Sequence[];
}

export type SequenceIntegrityIssueType =
  | "missing-sequence-id"
  | "duplicate-sequence-id"
  | "empty-sequence"
  | "unknown-scene-reference"
  | "title-scene-included"
  | "duplicate-scene-reference"
  | "missing-scene-reference"
  | "scene-order-mismatch"
  | "invalid-duration"
  | "duration-mismatch"
  | "camera-plan-scene-mismatch"
  | "overlay-scene-mismatch";

/**
 * Structured validation issue returned by validateSequenceIntegrity, mirrored
 * on ReviewIssue (lib/pipeline/reviewConsistency.ts) but adapted for
 * sequences: some issues are plan-level (e.g. a scene referenced by no
 * sequence, or the same scene referenced by two different sequences) and
 * have no single owning sequence, so `sequenceId` is optional while
 * `sceneIds` still pinpoints the scene(s) involved.
 */
export interface SequenceIntegrityIssue {
  id: string;
  type: SequenceIntegrityIssueType;
  severity: "info" | "warning" | "error";
  /** Owning sequence, when the issue belongs to one specific sequence. */
  sequenceId?: string;
  sceneIds: string[];
  message: string;
}
