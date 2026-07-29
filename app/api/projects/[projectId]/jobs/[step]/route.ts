import { NextRequest, NextResponse } from "next/server";
import { readProjectFile } from "@/lib/projects/store";
import { getJob, cancelJob, isPipelineJobStep } from "@/lib/jobs/registry";

const PARTIAL_DATA_FILES: Record<string, { filename: string; topLevelKey: string }> = {
  "screen-design": { filename: "screen-design.json", topLevelKey: "screenTypes" },
};

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ projectId: string; step: string }> }
) {
  const { projectId, step } = await params;
  if (!isPipelineJobStep(step)) {
    return NextResponse.json({ error: "잘못된 단계입니다" }, { status: 400 });
  }

  const job = getJob(projectId, step);
  if (!job) {
    return NextResponse.json({ running: false });
  }

  const base = {
    running: job.status === "running",
    status: job.status,
    startedAt: job.startedAt,
    progress: job.progress,
    partialRaw: job.partialRaw,
    error: job.status === "error" ? job.errorMessage : undefined,
  };

  const partialTarget = PARTIAL_DATA_FILES[step];
  if (partialTarget) {
    const raw = await readProjectFile(projectId, partialTarget.filename);
    let partialData: unknown = null;
    if (raw) {
      try {
        partialData = JSON.parse(raw);
      } catch {
        partialData = null;
      }
    }
    return NextResponse.json({ ...base, partialData });
  }

  return NextResponse.json(base);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ projectId: string; step: string }> }
) {
  const { projectId, step } = await params;
  if (!isPipelineJobStep(step)) {
    return NextResponse.json({ error: "잘못된 단계입니다" }, { status: 400 });
  }

  const cancelled = cancelJob(projectId, step);
  return NextResponse.json({ cancelled });
}
