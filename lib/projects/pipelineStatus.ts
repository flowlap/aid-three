import type { PipelineStep } from "./types";

export type ProjectStatus = "not-started" | "in-progress" | "done";

const STATUS_BY_STEP: Record<PipelineStep, ProjectStatus> = {
  upload: "not-started",
  markdown: "in-progress",
  scenes: "in-progress",
  "screen-design": "in-progress",
  review: "in-progress",
  images: "in-progress",
  storyboard: "done",
};

export function getProjectStatus(step: PipelineStep): ProjectStatus {
  // `step` is read from disk (project.json) and only cast to PipelineStep, not
  // validated — a project created before a pipeline restructuring (e.g. the
  // Phase 5 screen-types/visual-design -> screen-design merge) can still have
  // an old step value on disk that's no longer in this union. Fall back
  // instead of rendering an empty status dot/label for it.
  return STATUS_BY_STEP[step] ?? "not-started";
}

export const PROJECT_STATUS_LABEL: Record<ProjectStatus, string> = {
  "not-started": "미시작",
  "in-progress": "진행중",
  done: "완료",
};

export const PROJECT_STATUS_BADGE_CLASS: Record<ProjectStatus, string> = {
  "not-started": "bg-muted text-muted-foreground",
  "in-progress": "bg-warning/15 text-warning",
  done: "bg-success/15 text-success",
};
