import { NextResponse } from "next/server";
import { readSequencePlan } from "@/lib/projects/store";
import { validateSequenceIntegrity } from "./validateSequenceIntegrity";
import { buildSequenceContextByScene, type SceneSequenceContext } from "./selectScreenTypes";
import type { Scene } from "./splitScenes";

/**
 * Shared by both screen-design routes (route.ts and [sceneId]/route.ts):
 * the sequence-mode prerequisite gate — read sequences.json, fail with a
 * user-facing prerequisite error if it's missing or integrity-broken, then
 * build the per-scene context map. This was previously copy-pasted
 * (including the literal error strings) across both routes; kept here
 * rather than in selectScreenTypes.ts so that module can stay a plain
 * pipeline function without a next/server dependency.
 *
 * Callers should only invoke this when `getProductionMode(project) ===
 * "sequence"`, and should run it before starting a job / creating an LLM
 * client, exactly as both routes already do.
 */
export async function loadSequenceContextByScene(
  projectId: string,
  scenes: Scene[]
): Promise<{ sequenceContextByScene: Record<string, SceneSequenceContext> } | { errorResponse: NextResponse }> {
  const plan = await readSequencePlan(projectId);
  if (!plan) {
    return {
      errorResponse: NextResponse.json(
        { error: "시퀀스 계획이 없습니다. 먼저 시퀀스 단계를 완료해주세요." },
        { status: 400 }
      ),
    };
  }

  const issues = validateSequenceIntegrity(scenes, plan);
  if (issues.some((issue) => issue.severity === "error")) {
    return {
      errorResponse: NextResponse.json(
        { error: "시퀀스 계획에 오류가 있습니다. 시퀀스 단계에서 먼저 수정해주세요." },
        { status: 400 }
      ),
    };
  }

  return { sequenceContextByScene: buildSequenceContextByScene(plan, scenes) };
}
