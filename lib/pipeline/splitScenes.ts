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
  return parsed.scenes.map((scene, index) => ({
    id: `scene-${String(index + 1).padStart(3, "0")}`,
    ...scene,
  }));
}
