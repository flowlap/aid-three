export type ScriptType = "script" | "narration";

export type PipelineStep =
  | "upload"
  | "markdown"
  | "scenes"
  | "screen-types"
  | "visual-design"
  | "review"
  | "storyboard";

export interface ProjectMeta {
  id: string;
  title: string;
  createdAt: string;
  scriptType: ScriptType;
  currentStep: PipelineStep;
}
