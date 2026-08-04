/**
 * jsonMode instructs the model to respond with JSON only, but every provider
 * occasionally wraps the response in a markdown code fence anyway (` ```json
 * ... ``` ` or ` ``` ... ``` `). Strip one if the entire response is exactly
 * one such fence before handing it to JSON.parse.
 */
export function stripCodeFence(raw: string): string {
  const trimmed = raw.trim();
  const match = trimmed.match(/^```(?:json)?\s*\n([\s\S]*?)\n```$/);
  return match ? match[1] : trimmed;
}
