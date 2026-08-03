import type { ChatMessage, LlmClient, LlmCompleteOptions, LlmTier } from "./types";
import { DEFAULT_MAX_TOKENS, TRUNCATION_ERROR_MESSAGE } from "./types";
import { getHChatBaseUrl, getHChatHeaders } from "../hchatShared";

const DEFAULT_MODELS = {
  accurate: "gemini-3.6-flash",
  fast: "gemini-3.5-flash-lite",
} as const;

function toGeminiContents(messages: ChatMessage[]): Array<{ role: "user" | "model"; parts: Array<{ text: string }> }> {
  return messages
    .filter((m) => m.role !== "system")
    .map((m) => ({ role: m.role === "assistant" ? ("model" as const) : ("user" as const), parts: [{ text: m.content }] }));
}

function extractSystemInstruction(messages: ChatMessage[]): string | undefined {
  const systemParts = messages.filter((m) => m.role === "system").map((m) => m.content);
  return systemParts.length > 0 ? systemParts.join("\n\n") : undefined;
}

function logStart(label: string, model: string, messages: ChatMessage[]): number {
  const inputChars = messages.reduce((sum, m) => sum + m.content.length, 0);
  console.log(`[H-Chat Gemini] ${label} 시작 model=${model} inputChars=${inputChars}`);
  return Date.now();
}

function logDone(label: string, model: string, startedAt: number, outputChars: number, finishReason?: string | null): void {
  console.log(`[H-Chat Gemini] ${label} 완료 model=${model} elapsedMs=${Date.now() - startedAt} outputChars=${outputChars} finishReason=${finishReason ?? "unknown"}`);
}

function logError(label: string, model: string, startedAt: number, err: unknown): void {
  console.error(`[H-Chat Gemini] ${label} 실패 model=${model} elapsedMs=${Date.now() - startedAt}`, err);
}

interface GeminiResult {
  text: string;
  truncated: boolean;
}

export class RealHChatGeminiClient implements LlmClient {
  constructor(private readonly models: { accurate: string; fast: string } = DEFAULT_MODELS) {}

  private modelFor(tier?: LlmTier): string {
    return tier === "fast" ? this.models.fast : this.models.accurate;
  }

  private async fetchGenerateContent(messages: ChatMessage[], options?: LlmCompleteOptions): Promise<GeminiResult> {
    const model = this.modelFor(options?.tier);
    const startedAt = logStart("generateContent()", model, messages);
    const contents = toGeminiContents(messages);
    const systemInstruction = extractSystemInstruction(messages);
    const generationConfig: Record<string, unknown> = { maxOutputTokens: options?.maxTokens ?? DEFAULT_MAX_TOKENS };
    if (options?.jsonMode) generationConfig.responseMimeType = "application/json";

    let response: Response;
    try {
      response = await fetch(`${getHChatBaseUrl()}/models/${model}:generateContent`, {
        method: "POST",
        headers: getHChatHeaders(),
        body: JSON.stringify({
          contents,
          generationConfig,
          ...(systemInstruction ? { systemInstruction: { parts: [{ text: systemInstruction }] } } : {}),
        }),
        signal: options?.signal,
      });
    } catch (err) {
      logError("generateContent()", model, startedAt, err);
      throw err;
    }

    if (!response.ok) {
      const body = await response.text();
      const err = new Error(`H-Chat 오류 (${response.status}): ${body}`);
      logError("generateContent()", model, startedAt, err);
      throw err;
    }

    const data = (await response.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string | null }>;
    };
    const candidate = data.candidates?.[0];
    const text = candidate?.content?.parts?.[0]?.text ?? "";
    const truncated = candidate?.finishReason === "MAX_TOKENS";
    logDone("generateContent()", model, startedAt, text.length, candidate?.finishReason);
    return { text, truncated };
  }

  async complete(messages: ChatMessage[], options?: LlmCompleteOptions): Promise<string> {
    const { text, truncated } = await this.fetchGenerateContent(messages, options);
    if (truncated) throw new Error(TRUNCATION_ERROR_MESSAGE);
    return text;
  }

  /**
   * H-Chat의 Gemini streamGenerateContent 엔드포인트는 SSE가 아니라 청크
   * 단위로 전송되는 JSON 배열 텍스트를 반환해 부분 파싱이 불안정하다. 대신
   * 비스트리밍 generateContent를 호출해 전체 응답을 한 번에 받은 뒤 단일
   * 청크로 방출한다 — Claude/ChatGPT처럼 토큰 단위 실시간 스트리밍은 아니지만,
   * completeStream()의 계약(잘림 시에도 이미 받은 텍스트를 먼저 내보내고
   * 에러를 던짐)은 동일하게 지킨다.
   */
  async completeStream(messages: ChatMessage[], options?: LlmCompleteOptions): Promise<AsyncIterable<string>> {
    const { text, truncated } = await this.fetchGenerateContent(messages, options);
    return (async function* () {
      if (text) yield text;
      if (truncated) throw new Error(TRUNCATION_ERROR_MESSAGE);
    })();
  }
}

export function createHChatGeminiClient(): LlmClient {
  getHChatHeaders();
  const models = {
    accurate: process.env.HCHAT_GEMINI_MODEL_ACCURATE || DEFAULT_MODELS.accurate,
    fast: process.env.HCHAT_GEMINI_MODEL_FAST || DEFAULT_MODELS.fast,
  };
  return new RealHChatGeminiClient(models);
}
