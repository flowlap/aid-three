import type { ChatMessage, LlmClient, LlmCompleteOptions, LlmTier } from "./types";
import { DEFAULT_MAX_TOKENS, TRUNCATION_ERROR_MESSAGE } from "./types";

const BASE_URL = "https://api.deepseek.com";

const DEFAULT_MODELS = {
  accurate: "deepseek-v4-pro",
  fast: "deepseek-v4-flash",
} as const;

function logStart(label: string, model: string, messages: ChatMessage[]): number {
  const inputChars = messages.reduce((sum, m) => sum + m.content.length, 0);
  console.log(`[DeepSeek] ${label} 시작 model=${model} inputChars=${inputChars}`);
  return Date.now();
}

function logDone(label: string, model: string, startedAt: number, outputChars: number, finishReason?: string | null): void {
  console.log(
    `[DeepSeek] ${label} 완료 model=${model} elapsedMs=${Date.now() - startedAt} outputChars=${outputChars} finishReason=${finishReason ?? "unknown"}`
  );
}

function logError(label: string, model: string, startedAt: number, err: unknown): void {
  console.error(`[DeepSeek] ${label} 실패 model=${model} elapsedMs=${Date.now() - startedAt}`, err);
}

const HEARTBEAT_INTERVAL_MS = 2000;

async function* parseSSEStream(
  body: ReadableStream<Uint8Array>,
  label: string,
  model: string,
  startedAt: number
): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let totalChars = 0;
  let lastHeartbeat = startedAt;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const data = trimmed.slice("data:".length).trim();
      if (data === "[DONE]") {
        logDone(label, model, startedAt, totalChars, "stop");
        return;
      }

      const parsed = JSON.parse(data) as {
        choices: Array<{ delta?: { content?: string }; finish_reason?: string | null }>;
      };
      const choice = parsed.choices[0];
      const delta = choice?.delta?.content;
      if (delta) {
        totalChars += delta.length;
        yield delta;
      }

      const now = Date.now();
      if (now - lastHeartbeat >= HEARTBEAT_INTERVAL_MS) {
        lastHeartbeat = now;
        console.log(`[DeepSeek] ${label} 진행 중... model=${model} elapsedMs=${now - startedAt} outputChars=${totalChars}`);
      }

      if (choice?.finish_reason === "length") {
        logError(label, model, startedAt, new Error(TRUNCATION_ERROR_MESSAGE));
        throw new Error(TRUNCATION_ERROR_MESSAGE);
      }
    }
  }
  logDone(label, model, startedAt, totalChars, "stop (연결 종료)");
}

export class RealDeepSeekClient implements LlmClient {
  constructor(
    private readonly apiKey: string,
    private readonly models: { accurate: string; fast: string } = DEFAULT_MODELS
  ) {}

  private modelFor(tier?: LlmTier): string {
    return tier === "fast" ? this.models.fast : this.models.accurate;
  }

  async complete(messages: ChatMessage[], options?: LlmCompleteOptions): Promise<string> {
    const model = this.modelFor(options?.tier);
    const startedAt = logStart("complete()", model, messages);

    let response: Response;
    try {
      response = await fetch(`${BASE_URL}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages,
          max_tokens: options?.maxTokens ?? DEFAULT_MAX_TOKENS,
          response_format: options?.jsonMode ? { type: "json_object" } : undefined,
        }),
        signal: options?.signal,
      });
    } catch (err) {
      logError("complete()", model, startedAt, err);
      throw err;
    }

    if (!response.ok) {
      const body = await response.text();
      const err = new Error(`DeepSeek API error (${response.status}): ${body}`);
      logError("complete()", model, startedAt, err);
      throw err;
    }

    const data = (await response.json()) as {
      choices: Array<{ message: { content: string }; finish_reason?: string | null }>;
    };
    const choice = data.choices[0];

    if (choice.finish_reason === "length") {
      const err = new Error(TRUNCATION_ERROR_MESSAGE);
      logError("complete()", model, startedAt, err);
      throw err;
    }

    logDone("complete()", model, startedAt, choice.message.content.length, choice.finish_reason);
    return choice.message.content;
  }

  async completeStream(
    messages: ChatMessage[],
    options?: LlmCompleteOptions
  ): Promise<AsyncIterable<string>> {
    const model = this.modelFor(options?.tier);
    const startedAt = logStart("completeStream()", model, messages);

    let response: Response;
    try {
      response = await fetch(`${BASE_URL}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages,
          max_tokens: options?.maxTokens ?? DEFAULT_MAX_TOKENS,
          response_format: options?.jsonMode ? { type: "json_object" } : undefined,
          stream: true,
        }),
        signal: options?.signal,
      });
    } catch (err) {
      logError("completeStream()", model, startedAt, err);
      throw err;
    }

    if (!response.ok) {
      const body = await response.text();
      const err = new Error(`DeepSeek API error (${response.status}): ${body}`);
      logError("completeStream()", model, startedAt, err);
      throw err;
    }

    return parseSSEStream(response.body!, "completeStream()", model, startedAt);
  }
}

export function createDeepSeekClient(): LlmClient {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    throw new Error("DEEPSEEK_API_KEY 환경변수가 설정되지 않았습니다");
  }
  const models = {
    accurate: process.env.DEEPSEEK_MODEL_ACCURATE || DEFAULT_MODELS.accurate,
    fast: process.env.DEEPSEEK_MODEL_FAST || DEFAULT_MODELS.fast,
  };
  return new RealDeepSeekClient(apiKey, models);
}
