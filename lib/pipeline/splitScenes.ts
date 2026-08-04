import { LARGE_OUTPUT_MAX_TOKENS, type ChatMessage, type LlmClient } from "../ai/llm/types";

const HEADING_LINE_PATTERN = /^#{1,6}\s+/;

/** Splits text into lines, keeping each line's trailing newline attached so `lines.join("")` reconstructs the input exactly. */
function splitIntoLines(text: string): string[] {
  return text.split(/(?<=\n)/);
}

/** Splits text at the start of each heading line — a "section" spans from one heading (inclusive) to just before the next. Leading content before the first heading (if any) is its own section. */
function splitIntoHeaderSections(text: string): string[] {
  const lines = splitIntoLines(text);
  const sections: string[] = [];
  let current = "";
  for (const line of lines) {
    const isHeading = HEADING_LINE_PATTERN.test(line.replace(/\n$/, ""));
    if (isHeading && current.length > 0) {
      sections.push(current);
      current = line;
    } else {
      current += line;
    }
  }
  if (current.length > 0) sections.push(current);
  return sections;
}

/** Splits text at blank-line boundaries — a "paragraph" ends right before the first non-blank line that follows one or more blank lines. Blank lines stay attached to the end of the preceding paragraph. */
function splitIntoParagraphs(text: string): string[] {
  const lines = splitIntoLines(text);
  const paragraphs: string[] = [];
  let current = "";
  let sawBlank = false;
  for (const line of lines) {
    const isBlank = line.replace(/\n$/, "").trim() === "";
    if (isBlank) {
      current += line;
      sawBlank = true;
      continue;
    }
    if (sawBlank && current.length > 0) {
      paragraphs.push(current);
      current = line;
    } else {
      current += line;
    }
    sawBlank = false;
  }
  if (current.length > 0) paragraphs.push(current);
  return paragraphs;
}

/** Greedily packs blocks (in order) into chunks no larger than `budget`, never splitting a block. A single block already over budget becomes its own chunk. */
function packByBudget(blocks: string[], budget: number): string[] {
  const chunks: string[] = [];
  let current = "";
  for (const block of blocks) {
    if (current.length > 0 && current.length + block.length > budget) {
      chunks.push(current);
      current = block;
    } else {
      current += block;
    }
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

/** Conservative starting budget: see docs/superpowers/specs/2026-08-04-scene-split-chunking-design.md for the reasoning (a 35,928-char narration already overflowed the 65536-token output ceiling). */
export const SCENE_SPLIT_CHUNK_CHAR_BUDGET = 8000;

/**
 * Splits a long narration into character-budget-sized chunks so a single AI
 * call's JSON output (original text + per-scene metadata) doesn't exceed the
 * model's max_tokens ceiling. Boundaries prefer document headers; a header
 * section that alone exceeds the budget is further split by paragraph. The
 * concatenation of the returned chunks always reconstructs the input exactly
 * (validateNarrationIntegrity depends on this).
 */
export function chunkNarration(
  narrationMarkdown: string,
  budget: number = SCENE_SPLIT_CHUNK_CHAR_BUDGET
): string[] {
  if (narrationMarkdown.length <= budget) return [narrationMarkdown];

  const sections = splitIntoHeaderSections(narrationMarkdown);
  const blocks = sections.flatMap((section) =>
    section.length > budget ? splitIntoParagraphs(section) : [section]
  );
  return packByBudget(blocks, budget);
}

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
  /** "title" = a heading line (#/##/###) read as a chapter announcement; "content" = ordinary narration. */
  sceneType?: "title" | "content";
  /** Heading depth (1=#, 2=##, 3=###). Only set when sceneType is "title". */
  depth?: number;
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

제목 줄 처리: 원문에서 #, ##, ### 등으로 시작하는 헤더 줄을 만나면, 그 줄 하나를 독립된 씬으로 만들고 sceneType을 "title", depth를 헤더 기호(#) 개수로 설정하세요(# → 1, ## → 2, ### → 3). title 씬의 narrationText는 헤더 기호만 제거한 제목 텍스트 그대로 두세요 — 단어를 바꾸거나 요약하지 마세요. title 씬은 문장 분할 대상이 아니라 그 줄 자체가 하나의 씬입니다.

내용 줄 처리: 헤더가 아닌 본문 문장은 지금까지처럼 sceneType을 "content"로 설정하고 분할하세요. content 씬의 narrationText는 실제 사람이 읽는 순수한 나레이션 문장만 담아야 합니다. 원문에 포함된 마크다운 문법(-, *, 숫자. 같은 목록 기호, **, _, \` 같은 강조/코드 기호 등)은 narrationText에 포함하지 말고 제거한 뒤 문장만 옮기세요. 서식은 나레이션 문서(narration.md)의 가독성을 위한 것이며, 씬 나레이션 텍스트 자체는 서식 없는 평문(plain prose)이어야 합니다. 단, 문장의 실제 단어나 표현은 임의로 바꾸지 마세요. content 씬에는 depth를 넣지 마세요.

splitReason: 왜 하필 이 지점에서 화면을 나눴는지 구체적으로 설명하세요. "문장이 끝나서"처럼 형식적인 이유가 아니라 "새로운 개념 도입", "질문 제기 후 답변 전환", "사례 나열 시작", "이전 두 내용을 하나로 연결" 등 실제 내용/화면 전환 근거를 쓰세요. title 씬은 "장/절 제목"처럼 간단히 써도 됩니다.

relatedOrders: 이 씬이 다른 씬과 하나의 이야기 흐름으로 묶인다면(예: 두 개념을 각각 소개한 뒤 하나로 잇거나 요약하는 씬), 관련된 씬들의 order 번호를 배열로 쓰세요. 특히 여러 씬에서 각각 다룬 내용을 종합·연결·비교하는 씬이라면 그 대상이 되는 씬들의 order를 반드시 표시하세요. 독립적인 씬이면 빈 배열로 두세요.

나레이션:
"""
${narrationMarkdown}
"""

JSON으로만 응답하세요: {"scenes": [{"order": number, "narrationText": string, "estimatedDurationSec": number, "splitReason": string, "relatedOrders": number[], "sceneType": "title" | "content", "depth": number | null}]}`;

  return [
    { role: "system", content: "당신은 이러닝 스토리보드 제작을 돕는 씬 분할 전문가입니다." },
    { role: "user", content: prompt },
  ];
}

export interface RawScene {
  order: number;
  narrationText: string;
  estimatedDurationSec: number;
  splitReason: string;
  relatedOrders?: number[];
  sceneType?: "title" | "content";
  depth?: number | null;
}

export function parseRawScenes(raw: string): RawScene[] {
  const parsed = JSON.parse(raw) as { scenes: RawScene[] };
  if (!parsed || !Array.isArray(parsed.scenes)) {
    throw new Error("AI 응답 형식이 올바르지 않습니다 (scenes 배열 없음)");
  }
  return parsed.scenes;
}

/** Assigns global sequential ids and resolves relatedOrders → relatedSceneIds. Call once on the full, order-concatenated list — see chunkNarration/splitScenesStream for how multi-chunk runs build that list before calling this. */
export function assignSceneIds(rawScenes: RawScene[]): Scene[] {
  const idByOrder = new Map(rawScenes.map((scene, index) => [scene.order, `scene-${String(index + 1).padStart(3, "0")}`]));

  return rawScenes.map((scene, index) => {
    const id = `scene-${String(index + 1).padStart(3, "0")}`;
    const relatedSceneIds = (scene.relatedOrders ?? [])
      .map((order) => idByOrder.get(order))
      .filter((relatedId): relatedId is string => Boolean(relatedId) && relatedId !== id);
    const sceneType = scene.sceneType === "title" ? "title" : "content";
    return {
      id,
      order: scene.order,
      narrationText: scene.narrationText,
      estimatedDurationSec: scene.estimatedDurationSec,
      splitReason: scene.splitReason,
      ...(relatedSceneIds.length > 0 ? { relatedSceneIds } : {}),
      sceneType,
      ...(sceneType === "title" && typeof scene.depth === "number" ? { depth: scene.depth } : {}),
    };
  });
}

export function parseScenesResponse(raw: string): Scene[] {
  return assignSceneIds(parseRawScenes(raw));
}

export async function splitScenes(client: LlmClient, narrationMarkdown: string): Promise<Scene[]> {
  const raw = await client.complete(buildSplitScenesMessages(narrationMarkdown), {
    jsonMode: true,
    tier: "accurate",
    maxTokens: LARGE_OUTPUT_MAX_TOKENS,
  });
  return parseScenesResponse(raw);
}

export async function splitScenesStream(
  client: LlmClient,
  narrationMarkdown: string,
  signal?: AbortSignal
): Promise<AsyncIterable<string>> {
  return client.completeStream(buildSplitScenesMessages(narrationMarkdown), {
    jsonMode: true,
    tier: "accurate",
    maxTokens: LARGE_OUTPUT_MAX_TOKENS,
    signal,
  });
}
