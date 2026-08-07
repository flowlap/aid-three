import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  readProject,
  readProjectFile,
  readProjectReferenceImage,
  readSequencePlan,
  readSequenceMasterImage,
  writeSequenceMasterImage,
  updateSequenceMasterVisual,
} from "@/lib/projects/store";
import { getProductionMode } from "@/lib/projects/types";
import { createImageClient } from "@/lib/ai/image/factory";
import {
  buildSequenceMasterImagePrompt,
  generateSequenceMasterImage,
  type SequenceMasterReferenceImages,
} from "@/lib/pipeline/generateSequenceMasterImage";
import { describeImageError } from "@/lib/pipeline/generateSceneImage";
import { withInFlightLock, AlreadyInFlightError } from "@/lib/jobs/inFlightLock";
import type { Sequence, SequenceContinuity } from "@/lib/pipeline/sequenceTypes";

/**
 * Mode gate mirroring app/api/projects/[projectId]/sequences/route.ts —
 * master-visual generation only makes sense for sequence-mode projects.
 */
const NOT_SEQUENCE_MODE_ERROR = "시퀀스 제작 모드 프로젝트가 아닙니다";

/**
 * One-off overrides for a single generation call, mirroring
 * images/[sceneId]/route.ts's RegenerateSceneOverrides pattern: these apply
 * only to this generation's prompt-building and are never persisted back to
 * sequences.json. This lets the editor UI generate from unsaved in-memory
 * edits (description/continuity) instead of silently falling back to
 * possibly-stale on-disk data.
 */
interface GenerateSequenceMasterImageOverrides {
  description?: string;
  continuity?: Partial<SequenceContinuity>;
}

/**
 * Serves the sequence's current master-visual image bytes, mirroring
 * images/[sceneId]/route.ts's GET shape exactly. No mode gate — this is a
 * harmless read, and the per-scene GET route has none either.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ projectId: string; sequenceId: string }> }
) {
  const { projectId, sequenceId } = await params;

  const plan = await readSequencePlan(projectId);
  const sequence = plan?.sequences.find((seq) => seq.id === sequenceId);
  const assetId = sequence?.masterVisual.assetId;
  if (!assetId) {
    return NextResponse.json({ error: "마스터 비주얼이 아직 생성되지 않았습니다" }, { status: 404 });
  }

  const buffer = await readSequenceMasterImage(projectId, sequenceId, assetId);
  if (!buffer) return NextResponse.json({ error: "마스터 비주얼이 아직 생성되지 않았습니다" }, { status: 404 });

  return new Response(new Uint8Array(buffer), {
    headers: { "Content-Type": "image/png", "Cache-Control": "no-store" },
  });
}

/** Triggers one explicit master-visual generation for a sequence — never run automatically (see plan doc Task 7). */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string; sequenceId: string }> }
) {
  const { projectId, sequenceId } = await params;
  const overrides: GenerateSequenceMasterImageOverrides = await req.json().catch(() => ({}));

  const project = await readProject(projectId);
  if (!project) return NextResponse.json({ error: "프로젝트를 찾을 수 없습니다" }, { status: 404 });
  if (getProductionMode(project) !== "sequence") {
    return NextResponse.json({ error: NOT_SEQUENCE_MODE_ERROR }, { status: 400 });
  }

  try {
    return await withInFlightLock(`sequence-master:${projectId}`, () =>
      generateMasterVisual(projectId, sequenceId, overrides)
    );
  } catch (err) {
    if (err instanceof AlreadyInFlightError) {
      return NextResponse.json(
        { error: "이 시퀀스는 이미 마스터 비주얼을 생성 중입니다. 완료될 때까지 기다려주세요." },
        { status: 409 }
      );
    }
    throw err;
  }
}

async function generateMasterVisual(
  projectId: string,
  sequenceId: string,
  overrides: GenerateSequenceMasterImageOverrides
): Promise<NextResponse> {
  const plan = await readSequencePlan(projectId);
  if (!plan) return NextResponse.json({ error: "시퀀스 계획이 없습니다" }, { status: 404 });

  const sequence = plan.sequences.find((seq) => seq.id === sequenceId);
  if (!sequence) return NextResponse.json({ error: "시퀀스를 찾을 수 없습니다" }, { status: 404 });

  // Prompt-building only — never persisted. See GenerateSequenceMasterImageOverrides.
  const effectiveSequence: Sequence = {
    ...sequence,
    masterVisual: { ...sequence.masterVisual, description: overrides.description ?? sequence.masterVisual.description },
    continuity: { ...sequence.continuity, ...overrides.continuity },
  };

  const backgroundFixed = (await readProjectFile(projectId, "background-fixed-enabled.txt"))?.trim() === "true";
  const styleReferenceEnabled = true;
  const referenceImages: SequenceMasterReferenceImages = {
    background: backgroundFixed ? (await readProjectReferenceImage(projectId, "background")) ?? undefined : undefined,
    style: styleReferenceEnabled ? (await readProjectReferenceImage(projectId, "style")) ?? undefined : undefined,
  };

  let client;
  try {
    client = createImageClient();
  } catch (err) {
    console.error("시퀀스 마스터 비주얼 생성 실패:", err);
    return NextResponse.json({ error: "AI 이미지 생성에 실패했습니다" }, { status: 502 });
  }

  const prompt = buildSequenceMasterImagePrompt(effectiveSequence);

  let buffer: Buffer;
  try {
    buffer = await generateSequenceMasterImage(client, effectiveSequence, referenceImages);
  } catch (err) {
    console.error("시퀀스 마스터 비주얼 생성 실패:", err);
    return NextResponse.json({ error: describeImageError(err) }, { status: 502 });
  }

  const assetId = randomUUID();
  await writeSequenceMasterImage(projectId, sequenceId, assetId, buffer);
  await updateSequenceMasterVisual(projectId, sequenceId, { status: "generated", assetId, prompt });

  return NextResponse.json({ ok: true, assetId });
}
