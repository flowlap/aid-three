/**
 * Rough, deliberately conservative time estimates shown to the user before/while
 * an AI step runs — set expectations for large documents ("this could take a
 * while") rather than promise precision. Actual duration depends on the AI
 * provider's load and isn't something we can predict exactly.
 */

/** For steps whose single AI call's output scales with document length (markdown conversion, scene splitting). */
export function estimateSecondsForChars(charCount: number): number {
  const CHARS_PER_SECOND = 40;
  return Math.min(600, Math.max(10, Math.round(charCount / CHARS_PER_SECOND)));
}

/**
 * For steps that make one AI call per scene. Pass `concurrency` (default 1,
 * i.e. sequential) for steps that run several scenes at once, so the
 * estimate reflects real wall-clock time instead of the serial sum.
 */
export function estimateSecondsForScenes(sceneCount: number, secondsPerScene: number, concurrency = 1): number {
  return Math.min(900, Math.max(5, Math.round((sceneCount * secondsPerScene) / concurrency)));
}
