export type ScriptType = "script" | "narration" | "narration_pre_edited";

export type PipelineStep =
  | "upload"
  | "markdown"
  | "scenes"
  | "screen-design"
  | "review"
  | "images"
  | "storyboard";

export interface ProjectMeta {
  id: string;
  title: string;
  createdAt: string;
  scriptType: ScriptType;
  currentStep: PipelineStep;
}
