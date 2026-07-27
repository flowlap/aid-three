import { NextRequest, NextResponse } from "next/server";
import { readProject, readProjectFile, writeProjectFile, updateProjectStep } from "@/lib/projects/store";
import { createDeepSeekClient } from "@/lib/ai/deepseekClient";
import { selectScreenTypes, type ScreenTypeAssignment } from "@/lib/pipeline/selectScreenTypes";
import type { Scene } from "@/lib/pipeline/splitScenes";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const project = await readProject(projectId);
  if (!project) return NextResponse.json({ error: "프로젝트를 찾을 수 없습니다" }, { status: 404 });

  const raw = await readProjectFile(projectId, "scenes.json");
  if (!raw) return NextResponse.json({ error: "씬 데이터가 없습니다" }, { status: 400 });

  let scenes: Scene[];
  try {
    scenes = JSON.parse(raw).scenes;
  } catch (err) {
    console.error("씬 데이터 파싱 실패:", err);
    return NextResponse.json({ error: "씬 데이터 형식이 올바르지 않습니다" }, { status: 400 });
  }
  if (!Array.isArray(scenes)) {
    return NextResponse.json({ error: "씬 데이터 형식이 올바르지 않습니다" }, { status: 400 });
  }

  let screenTypes: Record<string, ScreenTypeAssignment>;
  try {
    const client = createDeepSeekClient();
    screenTypes = await selectScreenTypes(client, scenes);
  } catch (err) {
    console.error("화면 유형 선정 실패:", err);
    return NextResponse.json(
      { error: "AI 화면 유형 선정에 실패했습니다. 잠시 후 다시 시도해주세요." },
      { status: 502 }
    );
  }

  await writeProjectFile(projectId, "screen-types.json", JSON.stringify({ screenTypes }, null, 2));
  await updateProjectStep(projectId, "screen-types");

  return NextResponse.json({ screenTypes });
}

function isValidScreenTypesMap(value: unknown): value is Record<string, ScreenTypeAssignment> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  return Object.values(value).every(
    (entry) =>
      typeof entry === "object" &&
      entry !== null &&
      typeof (entry as ScreenTypeAssignment).screenType === "string" &&
      typeof (entry as ScreenTypeAssignment).recommendedLayout === "string" &&
      typeof (entry as ScreenTypeAssignment).rationale === "string"
  );
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;

  let body: { screenTypes?: unknown };
  try {
    body = await req.json();
  } catch (err) {
    console.error("요청 본문 파싱 실패:", err);
    return NextResponse.json({ error: "요청 본문이 올바른 JSON이 아닙니다" }, { status: 400 });
  }

  if (!isValidScreenTypesMap(body.screenTypes)) {
    return NextResponse.json({ error: "screenTypes 필드의 형식이 올바르지 않습니다" }, { status: 400 });
  }

  await writeProjectFile(projectId, "screen-types.json", JSON.stringify({ screenTypes: body.screenTypes }, null, 2));
  return NextResponse.json({ ok: true });
}
