import { DEEPSEEK_MODELS, type DeepSeekClient } from "../ai/deepseekClient";
import { SCREEN_TYPE_OPTIONS } from "../visual-templates";
import type { Scene } from "./splitScenes";

export interface ScreenTypeAssignment {
  screenType: string;
  recommendedLayout: string;
  rationale: string;
  /**
   * Short on-screen caption/subtitle for this scene, written by the AI as a
   * fresh summary — never a truncated substring of the narration, so it
   * never needs an ellipsis. See computeVisualDesign, which copies this
   * straight into VisualDesign.caption.
   */
  caption: string;
}

function isScreenTypeAssignment(value: unknown): value is ScreenTypeAssignment {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as ScreenTypeAssignment).screenType === "string" &&
    typeof (value as ScreenTypeAssignment).recommendedLayout === "string" &&
    typeof (value as ScreenTypeAssignment).rationale === "string" &&
    typeof (value as ScreenTypeAssignment).caption === "string"
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

    const prevType = i > 0 ? result[scenes[i - 1].id]?.screenType : undefined;
    const prevPrevType = i > 1 ? result[scenes[i - 2].id]?.screenType : undefined;
    let diversityNote = "";
    if (prevType && prevType === prevPrevType) {
      diversityNote = `\n제약: 최근 두 씬이 연속으로 "${prevType}" 유형이었습니다. 이 씬에 명백히 더 적합한 이유가 없는 한 "${prevType}"은 선택하지 말고 다른 유형을 선택하세요.`;
    } else if (prevType) {
      diversityNote = `\n참고: 바로 이전 씬은 "${prevType}" 유형이었습니다. 내용상 반드시 같은 유형이어야 하는 경우가 아니라면, 다양성을 위해 다른 유형을 우선 고려하세요.`;
    }

    const prompt = `다음 씬에 어울리는 화면 유형을 선택하세요.

사용 가능한 화면 유형(반드시 이 중 하나를 정확히 그대로 선택): ${SCREEN_TYPE_OPTIONS.join(", ")}
${diversityNote}
이전 씬: ${prevScene?.narrationText ?? "(없음)"}
현재 씬: ${scene.narrationText}
다음 씬: ${nextScene?.narrationText ?? "(없음)"}

caption: 화면 하단에 자막으로 쓸 짧은 문구를 직접 새로 요약해서 작성하세요. 나레이션 원문을 그대로 잘라내지 말고, 20자 내외의 완결된 문구로 핵심 의미를 요약하세요. 말줄임표(…)나 "..."는 사용하지 마세요.

JSON으로만 응답하세요: {"screenType": string, "recommendedLayout": string, "rationale": string, "caption": string}`;

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
