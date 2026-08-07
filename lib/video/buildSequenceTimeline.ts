import type { Scene } from "@/lib/pipeline/splitScenes";
import type { CameraMotion, SequenceOverlayEntry, SequencePlan } from "@/lib/pipeline/sequenceTypes";
import { findSequenceForScene } from "@/lib/pipeline/sequenceLookup";
import { SCENE_BREAK_HOLD_SEC } from "./buildVideoClip";

export interface SequenceTimelineEntry {
  sceneId: string;
  /** 0-based position in the render order (mirrors `scenes`' array order, not `Scene.order`). */
  order: number;
  /** Cumulative start time, including SCENE_BREAK_HOLD_SEC holds of all prior scenes. */
  startSec: number;
  /** Real narration WAV duration for this scene. */
  narrationDurationSec: number;
  /** narrationDurationSec + SCENE_BREAK_HOLD_SEC. */
  clipDurationSec: number;
  /** null for title scenes / scenes with no owning sequence. */
  sequenceId: string | null;
  /** True when this is the first scene of a new sequence (or the first scene overall). */
  isSequenceBoundaryStart: boolean;
  /** True when this is the last scene of its sequence (or the last scene overall). */
  isSequenceBoundaryEnd: boolean;
  /** "static" for title scenes / scenes with no camera plan entry. */
  motion: CameraMotion;
  /** This scene's overlays, [] if none. */
  overlays: SequenceOverlayEntry[];
}

export interface SequenceTimeline {
  entries: SequenceTimelineEntry[];
  totalDurationSec: number;
}

/**
 * Compiles validated scenes + a SequencePlan + real per-scene narration
 * durations into an ordered, render-ready timeline. Purely derived (not
 * persisted as source of truth) -- a pure function, no I/O. `scenes` is
 * assumed to already be in final render order; this never resorts it.
 */
export function buildSequenceTimeline(
  scenes: Scene[],
  plan: SequencePlan,
  durationsBySceneId: Record<string, number>
): SequenceTimeline {
  // Looked up once per scene and reused below for both the sequence object
  // (camera plan / overlays) and its id, instead of calling
  // findSequenceForScene twice with identical arguments.
  const owningSequenceByScene = scenes.map((scene) => findSequenceForScene(plan, scene.id));
  const sequenceIdByScene = owningSequenceByScene.map((sequence) => sequence?.id ?? null);

  let cumulativeStartSec = 0;
  const entries: SequenceTimelineEntry[] = scenes.map((scene, index) => {
    const sequence = owningSequenceByScene[index];
    const sequenceId = sequenceIdByScene[index];

    const narrationDurationSec = durationsBySceneId[scene.id] ?? 0;
    const clipDurationSec = narrationDurationSec + SCENE_BREAK_HOLD_SEC;
    const startSec = cumulativeStartSec;
    cumulativeStartSec += clipDurationSec;

    const motion: CameraMotion = sequence
      ? sequence.cameraPlan.find((entry) => entry.sceneId === scene.id)?.motion ?? "static"
      : "static";

    const overlays: SequenceOverlayEntry[] = sequence
      ? sequence.overlays.filter((overlay) => overlay.sceneId === scene.id)
      : [];

    const previousSequenceId = index === 0 ? undefined : sequenceIdByScene[index - 1];
    const nextSequenceId = index === scenes.length - 1 ? undefined : sequenceIdByScene[index + 1];

    const isSequenceBoundaryStart = index === 0 || previousSequenceId !== sequenceId;
    const isSequenceBoundaryEnd = index === scenes.length - 1 || nextSequenceId !== sequenceId;

    return {
      sceneId: scene.id,
      order: index,
      startSec,
      narrationDurationSec,
      clipDurationSec,
      sequenceId,
      isSequenceBoundaryStart,
      isSequenceBoundaryEnd,
      motion,
      overlays,
    };
  });

  return { entries, totalDurationSec: cumulativeStartSec };
}
