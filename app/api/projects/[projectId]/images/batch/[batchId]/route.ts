import { NextRequest, NextResponse } from "next/server";
import { readImageBatchJob, writeImageBatchJob, writeProjectImage, updateProjectStep } from "@/lib/projects/store";
import { pollGeminiBatch, resolveBatchResultsJsonl, parseBatchResultsJsonl, getGeminiBatchApiKey, isBatchSucceeded } from "@/lib/ai/image/geminiBatch";
import { describeImageError } from "@/lib/pipeline/generateSceneImage";

const STEP = "images" as const;

const TERMINAL_FAILURE_PATTERN = /FAILED|CANCELLED|EXPIRED/i;

/**
 * Checks (and, on first success, applies) one Gemini image-batch job's
 * status. Only polls Google while the persisted record still says
 * "submitted" — once a job is "applied" or "failed" the stored record is
 * the answer, so repeated status-panel polling after that point never hits
 * Google again. See lib/ai/image/geminiBatch.ts for the REST shapes and
 * lib/projects/store.ts's ImageBatchJobRecord for the persisted schema.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ projectId: string; batchId: string }> }
) {
  const { projectId, batchId } = await params;
  const record = await readImageBatchJob(projectId, batchId);
  if (!record) return NextResponse.json({ error: "배치 작업을 찾을 수 없습니다" }, { status: 404 });

  if (record.status !== "submitted") {
    return NextResponse.json({ job: record });
  }

  let apiKey: string;
  try {
    apiKey = getGeminiBatchApiKey();
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "GEMINI_API_KEY가 설정되지 않았습니다" }, { status: 500 });
  }

  let status;
  try {
    status = await pollGeminiBatch(record.googleBatchName, apiKey);
  } catch (err) {
    console.error(`Gemini 배치 상태 조회 실패 (batch: ${record.googleBatchName}):`, err);
    return NextResponse.json({ error: describeImageError(err) }, { status: 502 });
  }

  if (isBatchSucceeded(status.state)) {
    let resultsJsonl: string;
    try {
      resultsJsonl = await resolveBatchResultsJsonl(status, apiKey);
    } catch (err) {
      console.error(`Gemini 배치 결과 다운로드 실패 (batch: ${record.googleBatchName}):`, err);
      const updated = { ...record, status: "failed" as const, errorMessage: describeImageError(err) };
      await writeImageBatchJob(projectId, updated);
      return NextResponse.json({ job: updated });
    }

    const results = parseBatchResultsJsonl(resultsJsonl);
    const sceneErrors: Record<string, string> = {};
    let appliedAny = false;
    for (const sceneId of record.sceneIds) {
      const result = results.get(sceneId);
      if (!result) {
        sceneErrors[sceneId] = "배치 결과에 이 씬이 없습니다";
        continue;
      }
      if (!result.ok) {
        sceneErrors[sceneId] = result.message;
        continue;
      }
      await writeProjectImage(projectId, sceneId, result.buffer);
      appliedAny = true;
    }
    if (appliedAny) await updateProjectStep(projectId, STEP);

    const updated: typeof record = {
      ...record,
      status: "applied",
      appliedAt: new Date().toISOString(),
      sceneErrors: Object.keys(sceneErrors).length > 0 ? sceneErrors : undefined,
    };
    await writeImageBatchJob(projectId, updated);
    return NextResponse.json({ job: updated });
  }

  if (TERMINAL_FAILURE_PATTERN.test(status.state)) {
    const updated = { ...record, status: "failed" as const, errorMessage: status.errorMessage ?? `배치 작업 실패 (state: ${status.state})` };
    await writeImageBatchJob(projectId, updated);
    return NextResponse.json({ job: updated });
  }

  // Still running (JOB_STATE_RUNNING/PENDING/etc.) — nothing to persist, just report current state.
  return NextResponse.json({ job: record, googleState: status.state });
}
