import type { PipelineStep, ProductionMode } from "./types";

/**
 * "upload" is pre-pipeline (happens before a project exists in the AppShell
 * step bar — see app/projects/new/page.tsx) and is never one of the steps
 * returned here, so it's excluded from the key type too. This lets
 * AppShell.tsx's StepCompletion stay a plain (non-partial) record over the
 * step-bar keys without needing an unused "upload" entry.
 */
export type PipelineBarStep = Exclude<PipelineStep, "upload">;

export interface PipelineStepDef {
  key: PipelineBarStep;
  label: string;
}

/**
 * The AppShell step bar starts at "markdown" — "upload" happens before a
 * project exists in the pipeline UI (see app/projects/new/page.tsx) and was
 * never part of this list, so it's intentionally excluded here too.
 */
const SCENE_MODE_STEPS: readonly PipelineStepDef[] = [
  { key: "markdown", label: "원고 변환" },
  { key: "scenes", label: "씬 분할" },
  { key: "screen-design", label: "화면 설계" },
  { key: "review", label: "일관성 검수" },
  { key: "images", label: "이미지/목업 생성" },
  { key: "storyboard", label: "최종 뷰" },
];

/**
 * "screen-design" is intentionally absent here — sequence mode's sequence-
 * design step absorbs screen design inline (see SequencePlanEditor.tsx and
 * the screen-design-merge plan doc). screen-design.json is still written and
 * consumed by review/images downstream; it's just not a separate step-bar
 * entry for this mode.
 */
const SEQUENCE_MODE_STEPS: readonly PipelineStepDef[] = [
  { key: "markdown", label: "원고 변환" },
  { key: "scenes", label: "씬 분할" },
  { key: "sequences", label: "시퀀스 설계" },
  { key: "review", label: "일관성 검수" },
  { key: "images", label: "이미지/목업 생성" },
  { key: "storyboard", label: "최종 뷰" },
];

/** Returns a fresh copy each call so callers can't accidentally mutate the shared list. */
export function getPipelineSteps(mode: ProductionMode): PipelineStepDef[] {
  return [...(mode === "sequence" ? SEQUENCE_MODE_STEPS : SCENE_MODE_STEPS)];
}
