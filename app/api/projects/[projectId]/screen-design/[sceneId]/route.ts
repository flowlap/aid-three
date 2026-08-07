import { NextRequest, NextResponse } from "next/server";
import { readProject, readProjectFile, mergeProjectJsonMap, readSequencePlan } from "@/lib/projects/store";
import { getProductionMode } from "@/lib/projects/types";
import { createLlmClient } from "@/lib/ai/llm/factory";
import { selectScreenTypes, buildSequenceContextByScene, type SceneSequenceContext } from "@/lib/pipeline/selectScreenTypes";
import { computeVisualDesign } from "@/lib/visual-templates";
import { validateSequenceIntegrity } from "@/lib/pipeline/validateSequenceIntegrity";
import { DEFAULT_SCREEN_DESIGN_COMMON_PROMPT } from "@/lib/pipeline/commonPromptDefaults";
import type { Scene } from "@/lib/pipeline/splitScenes";

const FILENAME = "screen-design.json";

/** Regenerates a single scene's screen type + visual design without touching the rest. */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ projectId: string; sceneId: string }> }
) {
  const { projectId, sceneId } = await params;
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

  const scene = scenes.find((s) => s.id === sceneId);
  if (!scene) return NextResponse.json({ error: "씬을 찾을 수 없습니다" }, { status: 404 });

  const productionMode = getProductionMode(project);
  let sequenceContextByScene: Record<string, SceneSequenceContext> | undefined;
  if (productionMode === "sequence") {
    const sequencePlan = await readSequencePlan(projectId);
    if (!sequencePlan) {
      return NextResponse.json({ error: "시퀀스 계획이 없습니다. 먼저 시퀀스 단계를 완료해주세요." }, { status: 400 });
    }
    const issues = validateSequenceIntegrity(scenes, sequencePlan);
    if (issues.some((issue) => issue.severity === "error")) {
      return NextResponse.json({ error: "시퀀스 계획에 오류가 있습니다. 시퀀스 단계에서 먼저 수정해주세요." }, { status: 400 });
    }
    sequenceContextByScene = buildSequenceContextByScene(sequencePlan, scenes);
  }

  const documentSummary = (await readProjectFile(projectId, "document-summary.txt"))?.trim() || undefined;
  const commonPrompt =
    (await readProjectFile(projectId, "screen-design-common-prompt.txt"))?.trim() || DEFAULT_SCREEN_DESIGN_COMMON_PROMPT;

  let client;
  try {
    client = createLlmClient();
  } catch (err) {
    console.error("씬 재생성 실패:", err);
    return NextResponse.json({ error: "AI 화면 설계에 실패했습니다" }, { status: 502 });
  }

  let screenTypes;
  try {
    screenTypes = await selectScreenTypes(client, [scene], {
      documentSummary,
      commonPrompt,
      allScenesForContext: scenes,
      sequenceContextByScene,
    });
  } catch (err) {
    console.error("씬 재생성 실패:", err);
    return NextResponse.json({ error: "AI 화면 설계에 실패했습니다. 잠시 후 다시 시도해주세요." }, { status: 502 });
  }

  const screenType = screenTypes[scene.id];
  const visualDesign = computeVisualDesign(scene, screenType);

  await mergeProjectJsonMap(projectId, FILENAME, "screenTypes", sceneId, screenType);
  await mergeProjectJsonMap(projectId, FILENAME, "visualDesigns", sceneId, visualDesign);

  return NextResponse.json({ screenType, visualDesign });
}
