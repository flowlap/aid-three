import { DEEPSEEK_MODELS, type DeepSeekClient } from "../ai/deepseekClient";

/**
 * Produces a short (3-5 sentence) overview of the whole narration document —
 * topic, overall structure/flow, tone — used as shared context in
 * selectScreenTypes so each scene's screen-type/caption/keywords are chosen
 * with the document's big picture in mind, not just its immediate neighbors.
 */
export async function summarizeDocument(
  client: DeepSeekClient,
  narrationMarkdown: string,
  signal?: AbortSignal
): Promise<string> {
  const prompt = `다음은 이러닝 영상 제작을 위한 나레이션 전체 원고입니다. 이 문서의 전체 개요를 3~5문장으로 요약하세요. 다루는 주제, 전체 구성/흐름(예: 도입-배경설명-사례-정리), 톤을 포함하세요. 이 요약은 이후 각 장면(씬)의 화면 설계를 결정할 때 문서 전체 맥락을 제공하는 용도로 쓰입니다.

나레이션 전체:
"""
${narrationMarkdown}
"""

요약 텍스트만 응답하세요 (마크다운 서식 없이 평문으로, 말줄임표 없이 완결된 문장으로).`;

  return client.complete(
    [
      { role: "system", content: "당신은 교육 콘텐츠 기획 전문가입니다." },
      { role: "user", content: prompt },
    ],
    { model: DEEPSEEK_MODELS.flash, signal }
  );
}
