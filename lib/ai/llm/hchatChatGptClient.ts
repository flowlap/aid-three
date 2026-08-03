import type { ChatMessage, LlmClient, LlmCompleteOptions, LlmTier } from "./types";
import { DEFAULT_MAX_TOKENS, TRUNCATION_ERROR_MESSAGE } from "./types";
import { getHChatBaseUrl, getHChatHeaders } from "../hchatShared";

const DEFAULT_MODELS = {
  accurate: "gpt-5.6-terra",
  fast: "gpt-5.6-luna",
} as const;

const HEARTBEAT_INTERVAL_MS = 2000;

function logStart(label: string, model: string, messages: ChatMessage[]): number {
  const inputChars = messages.reduce((sum, m) => sum + m.content.length, 0);
  console.log(`[H-Chat ChatGPT] ${label} 시작 model=${model} inputChars=${inputChars}`);
  return Date.now();
}

function logDone(label: string, model: string, startedAt: number, outputChars: number, finishReason?: string | null): void {
  console.log(`[H-Chat ChatGPT] ${label} 완료 model=${model} elapsedMs=${Date.now() - startedAt} outputChars=${outputChars} finishReason=${finishReason ?? "unknown"}`);
}

function logError(label: string, model: string, startedAt: number, err: unknown): void {
  console.error(`[H-Chat ChatGPT] ${label} 실패 model=${model} elapsedMs=${Date.now() - startedAt}`, err);
}

async function* parseChatGptSSEStream(
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

      let parsed: { choices: Array<{ delta?: { content?: string }; finish_reason?: string | null }> };
      try {
        parsed = JSON.parse(data);
      } catch {
        continue;
      }
      const choice = parsed.choices[0];
      const delta = choice?.delta?.content;
      if (delta) {
        totalChars += delta.length;
        yield delta;

        const now = Date.now();
        if (now - lastHeartbeat >= HEARTBEAT_INTERVAL_MS) {
          lastHeartbeat = now;
          console.log(`[H-Chat ChatGPT] ${label} 진행 중... model=${model} elapsedMs=${now - startedAt} outputChars=${totalChars}`);
        }
      }

      if (choice?.finish_reason === "length") {
        logError(label, model, startedAt, new Error(TRUNCATION_ERROR_MESSAGE));
        throw new Error(TRUNCATION_ERROR_MESSAGE);
      }
    }
  }
  logDone(label, model, startedAt, totalChars, "stop (연결 종료)");
}

export class RealHChatChatGptClient implements LlmClient {
  constructor(private readonly models: { accurate: string; fast: string } = DEFAULT_MODELS) {}

  private modelFor(tier?: LlmTier): string {
    return tier === "fast" ? this.models.fast : this.models.accurate;
  }

  private endpointFor(model: string): string {
    return `${getHChatBaseUrl()}/openai/deployments/${model}/chat/completions`;
  }

  async complete(messages: ChatMessage[], options?: LlmCompleteOptions): Promise<string> {
    const model = this.modelFor(options?.tier);
    const startedAt = logStart("complete()", model, messages);

    let response: Response;
    try {
      response = await fetch(this.endpointFor(model), {
        method: "POST",
        headers: getHChatHeaders(),
        body: JSON.stringify({
          messages,
          max_completion_tokens: options?.maxTokens ?? DEFAULT_MAX_TOKENS,
          response_format: options?.jsonMode ? { type: "json_object" } : undefined,
          stream: false,
        }),
        signal: options?.signal,
      });
    } catch (err) {
      logError("complete()", model, startedAt, err);
      throw err;
    }

    if (!response.ok) {
      const body = await response.text();
      const err = new Error(`H-Chat 오류 (${response.status}): ${body}`);
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

  async completeStream(messages: ChatMessage[], options?: LlmCompleteOptions): Promise<AsyncIterable<string>> {
    const model = this.modelFor(options?.tier);
    const startedAt = logStart("completeStream()", model, messages);

    let response: Response;
    try {
      response = await fetch(this.endpointFor(model), {
        method: "POST",
        headers: getHChatHeaders(),
        body: JSON.stringify({
          messages,
          max_completion_tokens: options?.maxTokens ?? DEFAULT_MAX_TOKENS,
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
      const err = new Error(`H-Chat 오류 (${response.status}): ${body}`);
      logError("completeStream()", model, startedAt, err);
      throw err;
    }

    return parseChatGptSSEStream(response.body!, "completeStream()", model, startedAt);
  }
}

export function createHChatChatGptClient(): LlmClient {
  getHChatHeaders();
  const models = {
    accurate: process.env.HCHAT_CHATGPT_MODEL_ACCURATE || DEFAULT_MODELS.accurate,
    fast: process.env.HCHAT_CHATGPT_MODEL_FAST || DEFAULT_MODELS.fast,
  };
  return new RealHChatChatGptClient(models);
}
