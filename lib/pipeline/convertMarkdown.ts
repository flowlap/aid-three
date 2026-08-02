import { DEEPSEEK_MODELS, LARGE_OUTPUT_MAX_TOKENS, type ChatMessage, type DeepSeekClient } from "../ai/deepseekClient";
import type { ScriptType } from "../projects/types";

function buildMarkdownMessages(rawText: string, scriptType: ScriptType): ChatMessage[] {
  if (scriptType !== "script") {
    const prompt = `다음 나레이션 텍스트의 내용은 절대 수정하지 말고, 형태만 읽기 좋은 마크다운 문서로 정리하세요. 문단 구분과 제목만 추가하세요.

제목은 실제 문서 구조(장/절/소절)를 #, ##, ###로 일관되게 표현하세요. 예: 장 제목은 #, 그 아래 절 제목은 ##, 그 아래 소절 제목은 ###. 문서 전체의 위계가 헤더 깊이에 정확히 반영되어야 합니다. 이 헤더는 이후 단계에서 씬을 장/절 단위로 그룹핑하는 데 그대로 쓰이므로, 임의로 생략하거나 깊이를 뒤섞지 마세요.

텍스트:
"""
${rawText}
"""

마크다운 결과만 응답하세요.`;
    return [
      { role: "system", content: "당신은 문서 포맷팅 전문가입니다." },
      { role: "user", content: prompt },
    ];
  }

  const prompt = `다음 원고를 이러닝 영상 나레이션체로 변환하고, 읽기 좋은 마크다운 문서로 작성하세요.

제목은 실제 문서 구조(장/절/소절)를 #, ##, ###로 일관되게 표현하세요. 예: 장 제목은 #, 그 아래 절 제목은 ##, 그 아래 소절 제목은 ###. 문서 전체의 위계가 헤더 깊이에 정확히 반영되어야 합니다. 이 헤더는 이후 단계에서 씬을 장/절 단위로 그룹핑하는 데 그대로 쓰이므로, 임의로 생략하거나 깊이를 뒤섞지 마세요.

원고:
"""
${rawText}
"""

마크다운 결과만 응답하세요.`;
  return [
    { role: "system", content: "당신은 이러닝 나레이션 작성 전문가입니다." },
    { role: "user", content: prompt },
  ];
}

export async function convertToMarkdown(
  client: DeepSeekClient,
  rawText: string,
  scriptType: ScriptType,
  signal?: AbortSignal
): Promise<string> {
  return client.complete(buildMarkdownMessages(rawText, scriptType), {
    model: DEEPSEEK_MODELS.pro,
    maxTokens: LARGE_OUTPUT_MAX_TOKENS,
    signal,
  });
}

export async function convertToMarkdownStream(
  client: DeepSeekClient,
  rawText: string,
  scriptType: ScriptType,
  signal?: AbortSignal
): Promise<AsyncIterable<string>> {
  return client.completeStream(buildMarkdownMessages(rawText, scriptType), {
    model: DEEPSEEK_MODELS.pro,
    maxTokens: LARGE_OUTPUT_MAX_TOKENS,
    signal,
  });
}
