import type { LlmClient } from "../ai/llm/types";
import { stripCodeFence } from "../ai/llm/stripCodeFence";
import type { Scene } from "./splitScenes";

export interface SceneRelationAnalysis {
  splitReason: string;
  relatedSceneIds?: string[];
}

interface RawAnalysis {
  order: number;
  splitReason: string;
  relatedOrders?: number[];
}

function buildAnalyzeMessages(sceneList: string) {
  const prompt = `다음은 이미 완성된 나레이션을 빈 줄 기준으로 자동 분할한 씬 목록입니다. 씬 경계와 나레이션 문구는 이미 확정되어 있으니 절대 수정하지 말고, 각 씬에 대해 아래 두 가지만 분석하세요.

각 줄 형식: {order}. {narrationText}

${sceneList}

splitReason: 왜 이 지점에서 화면이 나뉘는 게 자연스러운지 씬 내용을 바탕으로 구체적으로 설명하세요 ("새로운 개념 도입", "질문 제기 후 답변 전환", "사례 나열 시작", "이전 두 내용을 하나로 연결" 등 실제 내용/화면 전환 근거). "빈 줄로 구분되어서"처럼 형식적인 이유는 쓰지 마세요.

relatedOrders: 이 씬이 다른 씬들과 하나의 이야기 흐름으로 묶인다면(예: 여러 씬에서 각각 다룬 내용을 하나로 잇거나 종합·비교하는 씬이라면) 관련된 씬들의 order 번호를 배열로 쓰세요. 독립적인 씬이면 빈 배열로 두세요.

JSON으로만 응답하세요: {"analyses": [{"order": number, "splitReason": string, "relatedOrders": number[]}]}`;

  return [
    { role: "system" as const, content: "당신은 이러닝 스토리보드 제작을 돕는 씬 분할 전문가입니다." },
    { role: "user" as const, content: prompt },
  ];
}

/**
 * Fills in `splitReason`/`relatedSceneIds` for scenes whose boundaries were
 * decided deterministically (see splitScenesByBlankLines.ts, used for
 * "나레이션(가편집)" projects) rather than by the AI — those scenes only get a
 * generic fixed splitReason and never get relatedSceneIds. This analyzes
 * the existing scene list in one call (scene text/order/id are never
 * changed) and returns the same kind of metadata `splitScenes` produces,
 * keyed by the *existing* scene id so callers can merge it in without
 * touching anything else about the scene.
 */
export async function analyzeSceneRelations(
  client: LlmClient,
  scenes: Scene[],
  signal?: AbortSignal
): Promise<Record<string, SceneRelationAnalysis>> {
  if (scenes.length === 0) return {};

  const sceneList = scenes.map((s) => `${s.order}. ${s.narrationText}`).join("\n");
  const raw = await client.complete(buildAnalyzeMessages(sceneList), {
    jsonMode: true,
    tier: "accurate",
    signal,
  });

  const parsed = JSON.parse(stripCodeFence(raw)) as { analyses?: RawAnalysis[] };
  if (!parsed || !Array.isArray(parsed.analyses)) {
    throw new Error("AI 응답 형식이 올바르지 않습니다 (analyses 배열 없음)");
  }

  const idByOrder = new Map(scenes.map((s) => [s.order, s.id]));
  const result: Record<string, SceneRelationAnalysis> = {};

  for (const entry of parsed.analyses) {
    if (typeof entry.order !== "number" || typeof entry.splitReason !== "string") continue;
    const sceneId = idByOrder.get(entry.order);
    if (!sceneId) continue;

    const relatedSceneIds = (entry.relatedOrders ?? [])
      .filter((order): order is number => typeof order === "number")
      .map((order) => idByOrder.get(order))
      .filter((relatedId): relatedId is string => Boolean(relatedId) && relatedId !== sceneId);

    result[sceneId] = {
      splitReason: entry.splitReason,
      ...(relatedSceneIds.length > 0 ? { relatedSceneIds } : {}),
    };
  }

  return result;
}
