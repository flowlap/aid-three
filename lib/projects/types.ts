export type ScriptType = "script" | "narration" | "narration_pre_edited";

export type ProductionMode = "scene" | "sequence";

export type PipelineStep =
  | "upload"
  | "markdown"
  | "scenes"
  | "sequences"
  | "screen-design"
  | "review"
  | "images"
  | "storyboard";

export interface ProjectMeta {
  id: string;
  title: string;
  createdAt: string;
  scriptType: ScriptType;
  productionMode?: ProductionMode; // optional solely for old project.json files
  currentStep: PipelineStep;
}

/**
 * Legacy project.json files predate the productionMode field, so it may be
 * absent — treat that as "scene" (the mode all pre-existing projects were
 * implicitly built with).
 */
export function getProductionMode(project: ProjectMeta): ProductionMode {
  return project.productionMode ?? "scene";
}
