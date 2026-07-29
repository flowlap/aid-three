import { DEEPSEEK_MODELS, type DeepSeekClient } from "../ai/deepseekClient";
import type { Scene } from "./splitScenes";

export interface ScreenTypeAssignment {
  screenType: string;
  recommendedLayout: string;
  rationale: string;
}

const AVAILABLE_SCREEN_TYPES = ["텍스트 강조형", "이미지 설명형", "표/그래프형", "절차 애니메이션형", "인물 등장형"];

function isScreenTypeAssignment(value: unknown): value is ScreenTypeAssignment {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as ScreenTypeAssignment).screenType === "string" &&
    typeof (value as ScreenTypeAssignment).recommendedLayout === "string" &&
    typeof (value as ScreenTypeAssignment).rationale === "string"
  );
}

export type ScreenTypeProgress = (
  sceneId: string,
  index: number,
  total: number,
  assignment: ScreenTypeAssignment
) => void | Promise<void>;

export interface SelectScreenTypesOptions {
  onProgress?: ScreenTypeProgress;
  signal?: AbortSignal;
}

export async function selectScreenTypes(
  client: DeepSeekClient,
  scenes: Scene[],
  options: SelectScreenTypesOptions = {}
): Promise<Record<string, ScreenTypeAssignment>> {
  const { onProgress, signal } = options;
  const result: Record<string, ScreenTypeAssignment> = {};

  for (let i = 0; i < scenes.length; i++) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

    const scene = scenes[i];
    const prevScene = scenes[i - 1];
    const nextScene = scenes[i + 1];

    const prompt = `다음 씬에 어울리는 화면 유형을 선택하세요.

사용 가능한 화면 유형: ${AVAILABLE_SCREEN_TYPES.join(", ")}

이전 씬: ${prevScene?.narrationText ?? "(없음)"}
현재 씬: ${scene.narrationText}
다음 씬: ${nextScene?.narrationText ?? "(없음)"}

JSON으로만 응답하세요: {"screenType": string, "recommendedLayout": string, "rationale": string}`;

    const raw = await client.complete(
      [
        { role: "system", content: "당신은 이러닝 스토리보드 화면 설계 전문가입니다." },
        { role: "user", content: prompt },
      ],
      { jsonMode: true, model: DEEPSEEK_MODELS.flash, signal }
    );

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(`AI 응답이 유효한 JSON이 아닙니다 (scene: ${scene.id})`);
    }

    if (!isScreenTypeAssignment(parsed)) {
      throw new Error(
        `AI 응답 형식이 올바르지 않습니다 (scene: ${scene.id}, screenType/recommendedLayout/rationale 필드 필요)`
      );
    }

    result[scene.id] = parsed;
    await onProgress?.(scene.id, i, scenes.length, parsed);
  }

  return result;
}
