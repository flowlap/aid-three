import type { Scene } from "./splitScenes";

const MIN_BLANK_LINES = 1;
/** Rough Korean narration reading pace, used only as a starting estimate the user can adjust. */
const CHARS_PER_SECOND = 4.5;
const HEADING_PATTERN = /^(#{1,6})\s+(.+)$/;

function estimateDurationSec(text: string): number {
  return Math.max(2, Math.round(text.length / CHARS_PER_SECOND));
}

interface Chunk {
  sceneType: "title" | "content";
  narrationText: string;
  depth?: number;
}

/**
 * Deterministic, AI-free scene split for "나레이션(가편집)" projects: the
 * narration is assumed already finalized by a human editor, so instead of
 * asking an AI to find sentence/topic boundaries, any blank line (a
 * paragraph break the writer already placed) is treated as an explicit
 * scene break. Each line's leading/trailing whitespace is trimmed; lines
 * within a scene are joined into a single flowing narration string.
 */
export function splitScenesByBlankLines(rawText: string): Scene[] {
  const lines = rawText.split(/\r\n|\r|\n/).map((line) => line.trim());

  const chunks: Chunk[] = [];
  let current: string[] = [];
  let blankRun = 0;

  function flush() {
    if (current.length === 0) return;

    const headingMatch = current[0].match(HEADING_PATTERN);
    let rest = current;
    if (headingMatch) {
      chunks.push({ sceneType: "title", narrationText: headingMatch[2].trim(), depth: headingMatch[1].length });
      rest = current.slice(1);
    }

    const text = rest.join(" ").replace(/\s+/g, " ").trim();
    if (text) chunks.push({ sceneType: "content", narrationText: text });

    current = [];
  }

  for (const line of lines) {
    if (line === "") {
      blankRun += 1;
      if (blankRun >= MIN_BLANK_LINES) flush();
      continue;
    }
    blankRun = 0;
    current.push(line);
  }
  flush();

  return chunks.map((chunk, index) => ({
    id: `scene-${String(index + 1).padStart(3, "0")}`,
    order: index + 1,
    narrationText: chunk.narrationText,
    estimatedDurationSec: estimateDurationSec(chunk.narrationText),
    splitReason:
      chunk.sceneType === "title" ? "마크다운 헤더 (가편집 원고 자동 분리)" : "빈 줄로 구분된 문단 (가편집 원고 자동 분리)",
    sceneType: chunk.sceneType,
    ...(chunk.sceneType === "title" ? { depth: chunk.depth } : {}),
  }));
}

/** Trims each line's leading/trailing whitespace while preserving line/paragraph structure, for narration.md. */
export function trimLines(rawText: string): string {
  return rawText
    .split(/\r\n|\r|\n/)
    .map((line) => line.trim())
    .join("\n");
}
