export type ScriptType = "script" | "narration";

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
