import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  readProject,
  readProjectFile,
  readProjectReferenceImage,
  readSequencePlan,
  writeMasterBatchJob,
  listMasterBatchJobIds,
  readMasterBatchJob,
  type MasterBatchJobRecord,
} from "@/lib/projects/store";
import { getProductionMode } from "@/lib/projects/types";
import { sortedSequences } from "@/lib/pipeline/sequenceEditorOps";
import { buildSequenceMasterImagePrompt } from "@/lib/pipeline/generateSequenceMasterImage";
import { DEFAULT_IMAGE_COMMON_PROMPT } from "@/lib/pipeline/commonPromptDefaults";
import {
  submitGeminiImageBatch,
  getGeminiBatchApiKey,
  getGeminiBatchImageModel,
  isGeminiBatchProviderEnabled,
  type GeminiBatchImageItem,
} from "@/lib/ai/image/geminiBatch";
import { describeImageError } from "@/lib/pipeline/generateSceneImage";

/**
 * Mirrors app/api/projects/[projectId]/images/batch/route.ts, but for
 * sequence master visuals instead of scene images — same submit-once,
 * poll-later Gemini Batch API job shape (see lib/ai/image/geminiBatch.ts),
 * just keyed by sequence id instead of scene id. The "통일감 있게 생성"
 * cross-sequence consistency reference (SequenceMasterVisualsSection.tsx's
 * multi-select flow) has no batch equivalent — every item in a batch
 * generates independently, same as this route's sibling "일괄 생성"/"전체
 * 재생성" buttons already do outside of that explicit flow.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const project = await readProject(projectId);
  if (!project) return NextResponse.json({ error: "프로젝트를 찾을 수 없습니다" }, { status: 404 });
  if (getProductionMode(project) !== "sequence") {
    return NextResponse.json({ error: "시퀀스 제작 모드 프로젝트가 아닙니다" }, { status: 400 });
  }
  if (!isGeminiBatchProviderEnabled()) {
    return NextResponse.json({ error: "IMAGE_BATCH_PROVIDER=gemini로 설정되어 있지 않습니다" }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const full = body?.mode === "full";

  const plan = await readSequencePlan(projectId);
  if (!plan) return NextResponse.json({ error: "시퀀스 계획이 없습니다" }, { status: 404 });

  const targets = full ? sortedSequences(plan) : sortedSequences(plan).filter((seq) => seq.masterVisual.status !== "generated");
  if (targets.length < 2) {
    return NextResponse.json({ error: "배치 생성은 2개 이상의 시퀀스가 있어야 합니다" }, { status: 400 });
  }

  const backgroundFixed = (await readProjectFile(projectId, "background-fixed-enabled.txt"))?.trim() === "true";
  const backgroundBuffer = backgroundFixed ? (await readProjectReferenceImage(projectId, "background")) ?? undefined : undefined;
  const styleBuffer = (await readProjectReferenceImage(projectId, "style")) ?? undefined;
  const commonPrompt = (await readProjectFile(projectId, "image-common-prompt.txt"))?.trim() || DEFAULT_IMAGE_COMMON_PROMPT;

  const items: GeminiBatchImageItem[] = targets.map((sequence) => ({
    key: sequence.id,
    prompt: buildSequenceMasterImagePrompt(sequence, commonPrompt, Boolean(backgroundBuffer), false),
    referenceImages: [styleBuffer, backgroundBuffer].filter((buf): buf is Buffer => buf !== undefined && buf.length > 0),
  }));

  const model = getGeminiBatchImageModel();
  let batchName: string;
  try {
    const apiKey = getGeminiBatchApiKey();
    ({ batchName } = await submitGeminiImageBatch(items, { apiKey, model }));
  } catch (err) {
    console.error("Gemini 마스터 비주얼 배치 제출 실패:", err);
    return NextResponse.json({ error: describeImageError(err) }, { status: 502 });
  }

  const record: MasterBatchJobRecord = {
    batchId: randomUUID(),
    googleBatchName: batchName,
    model,
    submittedAt: new Date().toISOString(),
    sequenceIds: items.map((item) => item.key),
    status: "submitted",
  };
  await writeMasterBatchJob(projectId, record);

  return NextResponse.json({ batchId: record.batchId, submittedCount: items.length });
}

/** Lists this project's Gemini master-visual-batch jobs — used by the status panel to resume showing an in-progress job after a page reload. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const batchIds = await listMasterBatchJobIds(projectId);
  const records = (await Promise.all(batchIds.map((batchId) => readMasterBatchJob(projectId, batchId)))).filter(
    (record): record is MasterBatchJobRecord => record !== null
  );
  records.sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
  return NextResponse.json({ jobs: records });
}
