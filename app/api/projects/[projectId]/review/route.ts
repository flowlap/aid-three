import { NextRequest, NextResponse } from "next/server";
import { readProject, readProjectFile, writeProjectFile, updateProjectStep } from "@/lib/projects/store";
import { createDeepSeekClient } from "@/lib/ai/deepseekClient";
import { reviewConsistency, type ReviewIssue } from "@/lib/pipeline/reviewConsistency";
import type { Scene } from "@/lib/pipeline/splitScenes";
import type { ScreenTypeAssignment } from "@/lib/pipeline/selectScreenTypes";
import type { VisualDesign } from "@/lib/pipeline/designVisuals";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const project = await readProject(projectId);
  if (!project) return NextResponse.json({ error: "프로젝트를 찾을 수 없습니다" }, { status: 404 });

  const scenesRaw = await readProjectFile(projectId, "scenes.json");
  const screenTypesRaw = await readProjectFile(projectId, "screen-types.json");
  const visualDesignRaw = await readProjectFile(projectId, "visual-design.json");
  if (!scenesRaw || !screenTypesRaw || !visualDesignRaw) {
    return NextResponse.json({ error: "이전 단계 데이터가 모두 필요합니다" }, { status: 400 });
  }

  let scenes: Scene[];
  let screenTypes: Record<string, ScreenTypeAssignment>;
  let visualDesigns: Record<string, VisualDesign>;
  try {
    scenes = JSON.parse(scenesRaw).scenes;
    screenTypes = JSON.parse(screenTypesRaw).screenTypes;
    visualDesigns = JSON.parse(visualDesignRaw).visualDesigns;
  } catch (err) {
    console.error("이전 단계 데이터 파싱 실패:", err);
    return NextResponse.json({ error: "이전 단계 데이터 형식이 올바르지 않습니다" }, { status: 400 });
  }
  if (!Array.isArray(scenes) || typeof screenTypes !== "object" || screenTypes === null || typeof visualDesigns !== "object" || visualDesigns === null) {
    return NextResponse.json({ error: "이전 단계 데이터 형식이 올바르지 않습니다" }, { status: 400 });
  }

  let issues: ReviewIssue[];
  try {
    const client = createDeepSeekClient();
    issues = await reviewConsistency(client, scenes, screenTypes, visualDesigns);
  } catch (err) {
    console.error("일관성 검수 실패:", err);
    return NextResponse.json(
      { error: "AI 일관성 검수에 실패했습니다. 잠시 후 다시 시도해주세요." },
      { status: 502 }
    );
  }

  await writeProjectFile(projectId, "review.json", JSON.stringify({ issues }, null, 2));
  await updateProjectStep(projectId, "review");

  return NextResponse.json({ issues });
}
