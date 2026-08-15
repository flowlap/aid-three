import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  readMasterBatchJob,
  writeMasterBatchJob,
  readSequencePlan,
  readProjectFile,
  readProjectReferenceImage,
  writeSequenceMasterImage,
  updateSequenceMasterVisual,
} from "@/lib/projects/store";
import { pollGeminiBatch, resolveBatchResultsJsonl, parseBatchResultsJsonl, getGeminiBatchApiKey, isBatchSucceeded } from "@/lib/ai/image/geminiBatch";
import { buildSequenceMasterImagePrompt } from "@/lib/pipeline/generateSequenceMasterImage";
import { DEFAULT_IMAGE_COMMON_PROMPT } from "@/lib/pipeline/commonPromptDefaults";
import { describeImageError } from "@/lib/pipeline/generateSceneImage";
import { withInFlightLockRetrying } from "@/lib/jobs/inFlightLock";

const TERMINAL_FAILURE_PATTERN = /FAILED|CANCELLED|EXPIRED/i;

/**
 * Mirrors app/api/projects/[projectId]/images/batch/[batchId]/route.ts's GET
 * exactly, but applies results into sequences.json (via
 * updateSequenceMasterVisual) instead of writing per-scene image files. Each
 * apply is wrapped in the same `sequence-master:${projectId}` lock the
 * single-sequence master-image route uses for its own write, so a batch
 * apply can't race a concurrent single-sequence regeneration's
 * read-modify-write of sequences.json.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ projectId: string; batchId: string }> }
) {
  const { projectId, batchId } = await params;
  const record = await readMasterBatchJob(projectId, batchId);
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
    console.error(`Gemini 마스터 비주얼 배치 상태 조회 실패 (batch: ${record.googleBatchName}):`, err);
    return NextResponse.json({ error: describeImageError(err) }, { status: 502 });
  }

  if (isBatchSucceeded(status.state)) {
    let resultsJsonl: string;
    try {
      resultsJsonl = await resolveBatchResultsJsonl(status, apiKey);
    } catch (err) {
      console.error(`Gemini 마스터 비주얼 배치 결과 다운로드 실패 (batch: ${record.googleBatchName}):`, err);
      const updated = { ...record, status: "failed" as const, errorMessage: describeImageError(err) };
      await writeMasterBatchJob(projectId, updated);
      return NextResponse.json({ job: updated });
    }

    const results = parseBatchResultsJsonl(resultsJsonl);
    const plan = await readSequencePlan(projectId);
    const commonPrompt = (await readProjectFile(projectId, "image-common-prompt.txt"))?.trim() || DEFAULT_IMAGE_COMMON_PROMPT;
    // Mirrors the POST route's own reference-image reads, so the prompt text
    // persisted here matches what was actually sent for this batch item.
    const backgroundFixed = (await readProjectFile(projectId, "background-fixed-enabled.txt"))?.trim() === "true";
    const hasBackgroundReferenceImage =
      backgroundFixed && (await readProjectReferenceImage(projectId, "background")) !== null;
    const sceneErrors: Record<string, string> = {};
    for (const sequenceId of record.sequenceIds) {
      const result = results.get(sequenceId);
      const sequence = plan?.sequences.find((seq) => seq.id === sequenceId);
      if (!result) {
        sceneErrors[sequenceId] = "배치 결과에 이 시퀀스가 없습니다";
        continue;
      }
      if (!result.ok) {
        sceneErrors[sequenceId] = result.message;
        continue;
      }
      if (!sequence) {
        sceneErrors[sequenceId] = "시퀀스를 찾을 수 없습니다 (계획이 변경됨)";
        continue;
      }
      const assetId = randomUUID();
      const prompt = buildSequenceMasterImagePrompt(sequence, commonPrompt, hasBackgroundReferenceImage, false);
      await withInFlightLockRetrying(`sequence-master:${projectId}`, async () => {
        await writeSequenceMasterImage(projectId, sequenceId, assetId, result.buffer);
        await updateSequenceMasterVisual(projectId, sequenceId, { status: "generated", assetId, prompt });
      });
    }

    const updated: typeof record = {
      ...record,
      status: "applied",
      appliedAt: new Date().toISOString(),
      sceneErrors: Object.keys(sceneErrors).length > 0 ? sceneErrors : undefined,
    };
    await writeMasterBatchJob(projectId, updated);
    return NextResponse.json({ job: updated });
  }

  if (TERMINAL_FAILURE_PATTERN.test(status.state)) {
    const updated = { ...record, status: "failed" as const, errorMessage: status.errorMessage ?? `배치 작업 실패 (state: ${status.state})` };
    await writeMasterBatchJob(projectId, updated);
    return NextResponse.json({ job: updated });
  }

  return NextResponse.json({ job: record, googleState: status.state });
}
