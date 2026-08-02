import { DEEPSEEK_MODELS, LARGE_OUTPUT_MAX_TOKENS, type ChatMessage, type DeepSeekClient } from "../ai/deepseekClient";

export interface Scene {
  id: string;
  order: number;
  narrationText: string;
  estimatedDurationSec: number;
  splitReason: string;
  /**
   * IDs of other scenes that share a narrative arc with this one (e.g. this
   * scene ties together two concepts introduced separately in earlier
   * scenes). Screen design (selectScreenTypes) reads this to design related
   * scenes cohesively instead of in isolation. Empty/absent means the scene
   * stands on its own.
   */
  relatedSceneIds?: string[];
}

const SCENE_LENGTH_GUIDE =
  "- 일반 화면: 8~20초\n- 강조 화면: 4~10초\n- 표/그래프 설명: 15~30초\n- 절차 애니메이션: 15~40초";

const SPLIT_CRITERIA =
  "문장종결, 주제전환, 설명 대상 변경, 화면 유형 변경, 열거 시작과 종료, 사례 또는 질문, 표/그래프 등장, 예상 재생시간";

function buildSplitScenesMessages(narrationMarkdown: string): ChatMessage[] {
  const prompt = `다음 나레이션을 씬으로 분할하세요. 나레이션 문구는 절대 수정하지 말고 분절만 하세요.

이 결과물은 최종적으로 나레이션 음성 + 화면 이미지를 이어붙인 "동영상"으로 제작됩니다. 씬 하나 = 화면이 실제로 전환되는 한 컷이라고 생각하고, 화면 전환이 자연스러운 지점에서 분할하세요 — 문장을 기계적으로 끊는 것이 아니라, "여기서 화면이 바뀌어야 시청자가 자연스럽다"고 판단되는 지점을 찾으세요.

씬 길이 기준(문장 수): 씬 하나는 1~2문장으로 구성하세요. 3문장 이상을 한 씬에 담지 마세요. 문장 하나가 매우 길거나 그 자체로 완결된 화면 전환 단위라면 1문장짜리 씬도 괜찮습니다.

씬 길이 기준(예상 재생시간, 참고용):
${SCENE_LENGTH_GUIDE}

분할 기준: ${SPLIT_CRITERIA}

중요: 각 씬의 narrationText는 실제 사람이 읽는 순수한 나레이션 문장만 담아야 합니다. 원문에 포함된 마크다운 문법(#, ##과 같은 제목 기호, -, *, 숫자. 같은 목록 기호, **, _, \` 같은 강조/코드 기호 등)은 narrationText에 포함하지 말고 제거한 뒤 문장만 옮기세요. 제목/목록 서식은 나레이션 문서(narration.md)의 가독성을 위한 것이며, 씬 나레이션 텍스트 자체는 서식 없는 평문(plain prose)이어야 합니다. 단, 문장의 실제 단어나 표현은 임의로 바꾸지 마세요.

splitReason: 왜 하필 이 지점에서 화면을 나눴는지 구체적으로 설명하세요. "문장이 끝나서"처럼 형식적인 이유가 아니라 "새로운 개념 도입", "질문 제기 후 답변 전환", "사례 나열 시작", "이전 두 내용을 하나로 연결" 등 실제 내용/화면 전환 근거를 쓰세요.

relatedOrders: 이 씬이 다른 씬과 하나의 이야기 흐름으로 묶인다면(예: 두 개념을 각각 소개한 뒤 하나로 잇거나 요약하는 씬), 관련된 씬들의 order 번호를 배열로 쓰세요. 특히 여러 씬에서 각각 다룬 내용을 종합·연결·비교하는 씬이라면 그 대상이 되는 씬들의 order를 반드시 표시하세요. 독립적인 씬이면 빈 배열로 두세요.

나레이션:
"""
${narrationMarkdown}
"""

JSON으로만 응답하세요: {"scenes": [{"order": number, "narrationText": string, "estimatedDurationSec": number, "splitReason": string, "relatedOrders": number[]}]}`;

  return [
    { role: "system", content: "당신은 이러닝 스토리보드 제작을 돕는 씬 분할 전문가입니다." },
    { role: "user", content: prompt },
  ];
}

interface RawScene {
  order: number;
  narrationText: string;
  estimatedDurationSec: number;
  splitReason: string;
  relatedOrders?: number[];
}

export function parseScenesResponse(raw: string): Scene[] {
  const parsed = JSON.parse(raw) as { scenes: RawScene[] };
  if (!parsed || !Array.isArray(parsed.scenes)) {
    throw new Error("AI 응답 형식이 올바르지 않습니다 (scenes 배열 없음)");
  }

  const idByOrder = new Map(parsed.scenes.map((scene, index) => [scene.order, `scene-${String(index + 1).padStart(3, "0")}`]));

  return parsed.scenes.map((scene, index) => {
    const id = `scene-${String(index + 1).padStart(3, "0")}`;
    const relatedSceneIds = (scene.relatedOrders ?? [])
      .map((order) => idByOrder.get(order))
      .filter((relatedId): relatedId is string => Boolean(relatedId) && relatedId !== id);
    return {
      id,
      order: scene.order,
      narrationText: scene.narrationText,
      estimatedDurationSec: scene.estimatedDurationSec,
      splitReason: scene.splitReason,
      ...(relatedSceneIds.length > 0 ? { relatedSceneIds } : {}),
    };
  });
}

export async function splitScenes(client: DeepSeekClient, narrationMarkdown: string): Promise<Scene[]> {
  const raw = await client.complete(buildSplitScenesMessages(narrationMarkdown), {
    jsonMode: true,
    model: DEEPSEEK_MODELS.pro,
    maxTokens: LARGE_OUTPUT_MAX_TOKENS,
  });
  return parseScenesResponse(raw);
}

export async function splitScenesStream(
  client: DeepSeekClient,
  narrationMarkdown: string,
  signal?: AbortSignal
): Promise<AsyncIterable<string>> {
  return client.completeStream(buildSplitScenesMessages(narrationMarkdown), {
    jsonMode: true,
    model: DEEPSEEK_MODELS.pro,
    maxTokens: LARGE_OUTPUT_MAX_TOKENS,
    signal,
  });
}
