import type { DeepSeekClient } from "../ai/deepseekClient";
import type { ScriptType } from "../projects/types";

export async function convertToMarkdown(
  client: DeepSeekClient,
  rawText: string,
  scriptType: ScriptType
): Promise<string> {
  if (scriptType === "narration") {
    const prompt = `다음 나레이션 텍스트의 내용은 절대 수정하지 말고, 형태만 읽기 좋은 마크다운 문서로 정리하세요. 문단 구분과 제목만 추가하세요.

텍스트:
"""
${rawText}
"""

마크다운 결과만 응답하세요.`;
    return client.complete([
      { role: "system", content: "당신은 문서 포맷팅 전문가입니다." },
      { role: "user", content: prompt },
    ]);
  }

  const prompt = `다음 원고를 이러닝 영상 나레이션체로 변환하고, 읽기 좋은 마크다운 문서로 작성하세요.

원고:
"""
${rawText}
"""

마크다운 결과만 응답하세요.`;
  return client.complete([
    { role: "system", content: "당신은 이러닝 나레이션 작성 전문가입니다." },
    { role: "user", content: prompt },
  ]);
}
