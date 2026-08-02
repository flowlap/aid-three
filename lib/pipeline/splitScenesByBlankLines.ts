import type { Scene } from "./splitScenes";

const MIN_BLANK_LINES = 1;
/** Rough Korean narration reading pace, used only as a starting estimate the user can adjust. */
const CHARS_PER_SECOND = 4.5;

function estimateDurationSec(text: string): number {
  return Math.max(2, Math.round(text.length / CHARS_PER_SECOND));
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

  const chunks: string[] = [];
  let current: string[] = [];
  let blankRun = 0;

  function flush() {
    const text = current.join(" ").replace(/\s+/g, " ").trim();
    if (text) chunks.push(text);
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

  return chunks.map((narrationText, index) => ({
    id: `scene-${String(index + 1).padStart(3, "0")}`,
    order: index + 1,
    narrationText,
    estimatedDurationSec: estimateDurationSec(narrationText),
    splitReason: "빈 줄로 구분된 문단 (가편집 원고 자동 분리)",
  }));
}

/** Trims each line's leading/trailing whitespace while preserving line/paragraph structure, for narration.md. */
export function trimLines(rawText: string): string {
  return rawText
    .split(/\r\n|\r|\n/)
    .map((line) => line.trim())
    .join("\n");
}
