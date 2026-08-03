export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/**
 * "accurate" = pick the provider's highest-quality model (used where output
 * correctness matters most: markdown conversion, scene splitting).
 * "fast" = pick the provider's cheaper/quicker model (summaries, review,
 * screen-type selection). Providers map this to their own model names —
 * callers never see a concrete model name.
 */
export type LlmTier = "accurate" | "fast";

export interface LlmCompleteOptions {
  tier?: LlmTier;
  jsonMode?: boolean;
  /**
   * Upper bound on the model's output length. Provider defaults are
   * conservative, which isn't enough for a large structured JSON response
   * (e.g. splitting a long narration into 100+ scenes) — the response gets
   * cut off mid-JSON and fails to parse. Every call site sets an explicit,
   * generous value; see DEFAULT_MAX_TOKENS / LARGE_OUTPUT_MAX_TOKENS below.
   */
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface LlmClient {
  complete(messages: ChatMessage[], options?: LlmCompleteOptions): Promise<string>;
  /**
   * Resolves once the connection is established and the request was
   * accepted (so callers can surface connection/auth errors immediately),
   * yielding response text chunks as they stream in.
   */
  completeStream(
    messages: ChatMessage[],
    options?: LlmCompleteOptions
  ): Promise<AsyncIterable<string>>;
}

/**
 * Generous default max_tokens for calls with no explicit override (e.g.
 * single-scene JSON responses in selectScreenTypes/reviewConsistency).
 */
export const DEFAULT_MAX_TOKENS = 16000;
/** For calls whose output scales with document size (markdown conversion, scene splitting). */
export const LARGE_OUTPUT_MAX_TOKENS = 65536;

export const TRUNCATION_ERROR_MESSAGE =
  "AI 응답이 최대 길이 제한(max_tokens)으로 중간에 잘렸습니다. 원고가 너무 길 수 있습니다.";
