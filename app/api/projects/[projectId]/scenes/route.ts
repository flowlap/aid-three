import { NextRequest, NextResponse } from "next/server";
import { readProject, readProjectFile, writeProjectFile, updateProjectStep } from "@/lib/projects/store";
import { createDeepSeekClient } from "@/lib/ai/deepseekClient";
import { splitScenes, type Scene } from "@/lib/pipeline/splitScenes";
import { validateNarrationIntegrity } from "@/lib/pipeline/validateNarrationIntegrity";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const project = await readProject(projectId);
  if (!project) return NextResponse.json({ error: "프로젝트를 찾을 수 없습니다" }, { status: 404 });

  const narration = await readProjectFile(projectId, "narration.md");
  if (!narration) return NextResponse.json({ error: "나레이션 마크다운이 없습니다" }, { status: 400 });

  let scenes: Scene[];
  try {
    const client = createDeepSeekClient();
    scenes = await splitScenes(client, narration);
  } catch (err) {
    return NextResponse.json(
      { error: `AI 씬 분할에 실패했습니다: ${(err as Error).message}` },
      { status: 502 }
    );
  }

  const integrityOk = validateNarrationIntegrity(
    narration,
    scenes.map((s) => s.narrationText)
  );

  await writeProjectFile(projectId, "scenes.json", JSON.stringify({ scenes }, null, 2));
  await updateProjectStep(projectId, "scenes");

  return NextResponse.json({ scenes, integrityOk });
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const body = (await req.json()) as { scenes?: unknown };
  if (!Array.isArray(body.scenes)) {
    return NextResponse.json({ error: "scenes 필드는 배열이어야 합니다" }, { status: 400 });
  }
  for (const scene of body.scenes) {
    if (
      typeof scene !== "object" ||
      scene === null ||
      typeof (scene as Scene).id !== "string" ||
      typeof (scene as Scene).order !== "number" ||
      typeof (scene as Scene).narrationText !== "string" ||
      typeof (scene as Scene).estimatedDurationSec !== "number" ||
      typeof (scene as Scene).splitReason !== "string"
    ) {
      return NextResponse.json({ error: "scenes 항목의 형식이 올바르지 않습니다" }, { status: 400 });
    }
  }
  await writeProjectFile(projectId, "scenes.json", JSON.stringify({ scenes: body.scenes }, null, 2));
  return NextResponse.json({ ok: true });
}
