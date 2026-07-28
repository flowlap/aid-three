import type { DeepSeekClient } from "../ai/deepseekClient";

export interface Scene {
  id: string;
  order: number;
  narrationText: string;
  estimatedDurationSec: number;
  splitReason: string;
}

const SCENE_LENGTH_GUIDE =
  "- 일반 화면: 8~20초\n- 강조 화면: 4~10초\n- 표/그래프 설명: 15~30초\n- 절차 애니메이션: 15~40초";

const SPLIT_CRITERIA =
  "문장종결, 주제전환, 설명 대상 변경, 화면 유형 변경, 열거 시작과 종료, 사례 또는 질문, 표/그래프 등장, 예상 재생시간";

export async function splitScenes(client: DeepSeekClient, narrationMarkdown: string): Promise<Scene[]> {
  const prompt = `다음 나레이션을 씬으로 분할하세요. 나레이션 문구는 절대 수정하지 말고 분절만 하세요.

씬 길이 기준:
${SCENE_LENGTH_GUIDE}

분할 기준: ${SPLIT_CRITERIA}

중요: 각 씬의 narrationText는 실제 사람이 읽는 순수한 나레이션 문장만 담아야 합니다. 원문에 포함된 마크다운 문법(#, ##과 같은 제목 기호, -, *, 숫자. 같은 목록 기호, **, _, \` 같은 강조/코드 기호 등)은 narrationText에 포함하지 말고 제거한 뒤 문장만 옮기세요. 제목/목록 서식은 나레이션 문서(narration.md)의 가독성을 위한 것이며, 씬 나레이션 텍스트 자체는 서식 없는 평문(plain prose)이어야 합니다. 단, 문장의 실제 단어나 표현은 임의로 바꾸지 마세요.

나레이션:
"""
${narrationMarkdown}
"""

JSON으로만 응답하세요: {"scenes": [{"order": number, "narrationText": string, "estimatedDurationSec": number, "splitReason": string}]}`;

  const raw = await client.complete(
    [
      { role: "system", content: "당신은 이러닝 스토리보드 제작을 돕는 씬 분할 전문가입니다." },
      { role: "user", content: prompt },
    ],
    { jsonMode: true }
  );

  const parsed = JSON.parse(raw) as { scenes: Array<Omit<Scene, "id">> };
  if (!parsed || !Array.isArray(parsed.scenes)) {
    throw new Error("AI 응답 형식이 올바르지 않습니다 (scenes 배열 없음)");
  }
  return parsed.scenes.map((scene, index) => ({
    id: `scene-${String(index + 1).padStart(3, "0")}`,
    ...scene,
  }));
}
