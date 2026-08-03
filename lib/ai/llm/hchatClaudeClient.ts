import type { ChatMessage, LlmClient, LlmCompleteOptions, LlmTier } from "./types";
import { DEFAULT_MAX_TOKENS, TRUNCATION_ERROR_MESSAGE } from "./types";
import { getHChatBaseUrl, getHChatHeaders } from "../hchatShared";

const DEFAULT_MODELS = {
  accurate: "claude-sonnet-5",
  fast: "claude-haiku-4-5",
} as const;

const JSON_MODE_INSTRUCTION = "반드시 유효한 JSON 객체로만 응답하세요. JSON 앞뒤로 다른 텍스트를 포함하지 마세요.";

interface AnthropicPayload {
  system?: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
}

function toAnthropicPayload(messages: ChatMessage[], jsonMode: boolean | undefined): AnthropicPayload {
  const systemParts = messages.filter((m) => m.role === "system").map((m) => m.content);
  if (jsonMode) systemParts.push(JSON_MODE_INSTRUCTION);
  const rest = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
  return { system: systemParts.length > 0 ? systemParts.join("\n\n") : undefined, messages: rest };
}

function logStart(label: string, model: string, messages: ChatMessage[]): number {
  const inputChars = messages.reduce((sum, m) => sum + m.content.length, 0);
  console.log(`[H-Chat Claude] ${label} 시작 model=${model} inputChars=${inputChars}`);
  return Date.now();
}

function logDone(label: string, model: string, startedAt: number, outputChars: number, stopReason?: string | null): void {
  console.log(`[H-Chat Claude] ${label} 완료 model=${model} elapsedMs=${Date.now() - startedAt} outputChars=${outputChars} stopReason=${stopReason ?? "unknown"}`);
}

function logError(label: string, model: string, startedAt: number, err: unknown): void {
  console.error(`[H-Chat Claude] ${label} 실패 model=${model} elapsedMs=${Date.now() - startedAt}`, err);
}

interface ClaudeStreamEvent {
  type?: string;
  delta?: { type?: string; text?: string; stop_reason?: string | null };
  error?: { type?: string; message?: string };
}

const HEARTBEAT_INTERVAL_MS = 2000;

async function* parseClaudeSSEStream(
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
      if (!data) continue;

      let event: ClaudeStreamEvent;
      try {
        event = JSON.parse(data);
      } catch {
        continue;
      }

      if (event.type === "content_block_delta" && event.delta?.type === "text_delta" && event.delta.text) {
        totalChars += event.delta.text.length;
        yield event.delta.text;

        const now = Date.now();
        if (now - lastHeartbeat >= HEARTBEAT_INTERVAL_MS) {
          lastHeartbeat = now;
          console.log(`[H-Chat Claude] ${label} 진행 중... model=${model} elapsedMs=${now - startedAt} outputChars=${totalChars}`);
        }
      }

      if (event.type === "error") {
        const message = event.error?.message ?? "알 수 없는 오류";
        const err = new Error(`H-Chat 오류: ${message}`);
        logError(label, model, startedAt, err);
        throw err;
      }

      if (event.type === "message_delta" && event.delta?.stop_reason === "max_tokens") {
        logError(label, model, startedAt, new Error(TRUNCATION_ERROR_MESSAGE));
        throw new Error(TRUNCATION_ERROR_MESSAGE);
      }

      if (event.type === "message_stop") {
        logDone(label, model, startedAt, totalChars, "end_turn");
        return;
      }
    }
  }
  logDone(label, model, startedAt, totalChars, "stop (연결 종료)");
}

export class RealHChatClaudeClient implements LlmClient {
  constructor(private readonly models: { accurate: string; fast: string } = DEFAULT_MODELS) {}

  private modelFor(tier?: LlmTier): string {
    return tier === "fast" ? this.models.fast : this.models.accurate;
  }

  async complete(messages: ChatMessage[], options?: LlmCompleteOptions): Promise<string> {
    const model = this.modelFor(options?.tier);
    const startedAt = logStart("complete()", model, messages);
    const { system, messages: anthropicMessages } = toAnthropicPayload(messages, options?.jsonMode);

    let response: Response;
    try {
      response = await fetch(`${getHChatBaseUrl()}/claude/messages`, {
        method: "POST",
        headers: getHChatHeaders(),
        body: JSON.stringify({
          model,
          max_tokens: options?.maxTokens ?? DEFAULT_MAX_TOKENS,
          stream: false,
          ...(system ? { system } : {}),
          messages: anthropicMessages,
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
      content?: Array<{ text?: string }>;
      stop_reason?: string | null;
    };

    if (data.stop_reason === "max_tokens") {
      const err = new Error(TRUNCATION_ERROR_MESSAGE);
      logError("complete()", model, startedAt, err);
      throw err;
    }

    const text = data.content?.[0]?.text ?? "";
    logDone("complete()", model, startedAt, text.length, data.stop_reason);
    return text;
  }

  async completeStream(messages: ChatMessage[], options?: LlmCompleteOptions): Promise<AsyncIterable<string>> {
    const model = this.modelFor(options?.tier);
    const startedAt = logStart("completeStream()", model, messages);
    const { system, messages: anthropicMessages } = toAnthropicPayload(messages, options?.jsonMode);

    let response: Response;
    try {
      response = await fetch(`${getHChatBaseUrl()}/claude/messages`, {
        method: "POST",
        headers: getHChatHeaders(),
        body: JSON.stringify({
          model,
          max_tokens: options?.maxTokens ?? DEFAULT_MAX_TOKENS,
          stream: true,
          ...(system ? { system } : {}),
          messages: anthropicMessages,
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

    return parseClaudeSSEStream(response.body!, "completeStream()", model, startedAt);
  }
}

export function createHChatClaudeClient(): LlmClient {
  getHChatHeaders(); // throws immediately if HCHAT_KEY is missing
  const models = {
    accurate: process.env.HCHAT_CLAUDE_MODEL_ACCURATE || DEFAULT_MODELS.accurate,
    fast: process.env.HCHAT_CLAUDE_MODEL_FAST || DEFAULT_MODELS.fast,
  };
  return new RealHChatClaudeClient(models);
}
