export const PIPELINE_JOB_STEPS = [
  "markdown",
  "scenes",
  "sequences",
  "screen-design",
  "review",
  "images",
  "tts",
  "video",
] as const;
export type PipelineJobStep = (typeof PIPELINE_JOB_STEPS)[number];

export function isPipelineJobStep(value: string): value is PipelineJobStep {
  return (PIPELINE_JOB_STEPS as readonly string[]).includes(value);
}

export type JobStatus = "running" | "done" | "error" | "cancelled";

export interface AiJob {
  projectId: string;
  step: PipelineJobStep;
  status: JobStatus;
  controller: AbortController;
  startedAt: string;
  finishedAt?: string;
  progress: { index: number; total: number } | null;
  partialRaw: string;
  errorMessage?: string;
}

export class JobAlreadyRunningError extends Error {
  constructor(projectId: string, step: PipelineJobStep) {
    super(`이미 실행 중인 작업이 있습니다: ${projectId}:${step}`);
    this.name = "JobAlreadyRunningError";
  }
}

function key(projectId: string, step: PipelineJobStep): string {
  return `${projectId}:${step}`;
}

// Stashed on globalThis so the map survives Next.js/Turbopack re-evaluating
// this module's scope on unrelated file edits during dev (same pattern as
// the standard Prisma-client-singleton trick).
const g = globalThis as unknown as { __aiJobRegistry?: Map<string, AiJob> };
const registry: Map<string, AiJob> = g.__aiJobRegistry ?? (g.__aiJobRegistry = new Map());

export function startJob(projectId: string, step: PipelineJobStep): AiJob {
  const existing = registry.get(key(projectId, step));
  if (existing && existing.status === "running") {
    console.warn(`[Job] ${key(projectId, step)} 이미 실행 중인 작업에 대한 시작 요청 거부`);
    throw new JobAlreadyRunningError(projectId, step);
  }

  const job: AiJob = {
    projectId,
    step,
    status: "running",
    controller: new AbortController(),
    startedAt: new Date().toISOString(),
    progress: null,
    partialRaw: "",
  };
  registry.set(key(projectId, step), job);
  console.log(`[Job] ${key(projectId, step)} 시작`);
  return job;
}

export function getJob(projectId: string, step: PipelineJobStep): AiJob | undefined {
  return registry.get(key(projectId, step));
}

export function finishJob(
  projectId: string,
  step: PipelineJobStep,
  status: Exclude<JobStatus, "running">,
  errorMessage?: string
): void {
  const job = registry.get(key(projectId, step));
  if (!job) return;
  job.status = status;
  job.finishedAt = new Date().toISOString();
  if (errorMessage) job.errorMessage = errorMessage;
  const elapsedMs = new Date(job.finishedAt).getTime() - new Date(job.startedAt).getTime();
  console.log(`[Job] ${key(projectId, step)} 종료 status=${status} elapsedMs=${elapsedMs}${errorMessage ? ` error="${errorMessage}"` : ""}`);
}

export function cancelJob(projectId: string, step: PipelineJobStep): boolean {
  const job = registry.get(key(projectId, step));
  if (!job || job.status !== "running") return false;
  job.controller.abort();
  console.log(`[Job] ${key(projectId, step)} 취소 요청`);
  return true;
}

export function recordChunk(projectId: string, step: PipelineJobStep, text: string): void {
  const job = registry.get(key(projectId, step));
  if (!job) return;
  job.partialRaw += text;
}

export function recordProgress(projectId: string, step: PipelineJobStep, index: number, total: number): void {
  const job = registry.get(key(projectId, step));
  if (!job) return;
  job.progress = { index, total };
  console.log(`[Job] ${key(projectId, step)} 진행 ${index + 1}/${total}`);
}
