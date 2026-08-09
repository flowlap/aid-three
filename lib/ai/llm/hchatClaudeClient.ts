import type { ChatMessage, LlmClient, LlmCompleteOptions, LlmTier } from "./types";
import { DEFAULT_MAX_TOKENS, TRUNCATION_ERROR_MESSAGE } from "./types";
import { getHChatBaseUrl, getHChatHeaders } from "../hchatShared";

const DEFAULT_MODELS = {
  accurate: "claude-sonnet-5",
  fast: "claude-haiku-4-5",
} as const;

/**
 * Anthropic's API has no OpenAI/Gemini-style enforced JSON response mode
 * (see deepseekClient.ts's response_format/hchatGeminiClient.ts's
 * responseMimeType) — jsonMode here is a system-prompt request only, which
 * Claude does not always follow, most often by forgetting to escape a
 * double quote inside a string value (breaking JSON.parse mid-object even
 * though the model's own stop_reason is a normal "end_turn"). The standard
 * mitigation — prefilling the assistant turn with "{" — is NOT available
 * here: this gateway's Claude models are Vertex-hosted and reject it
 * outright ("This model does not support assistant message prefill. The
 * conversation must end with a user message.", 400 invalid_request_error).
 *
 * The actual fix is options.jsonSchema (see toAnthropicPayload below), which
 * forces the response through Anthropic tool-use (tools + tool_choice)
 * instead — constrained decoding guarantees syntactically valid JSON at the
 * API level, unlike this instruction. jsonMode without jsonSchema still only
 * gets this soft instruction, so it reduces but does not eliminate the
 * failure; planSequences.ts (the one call site that hit this in production)
 * has since moved to jsonSchema. Other jsonMode call sites on this client
 * remain instruction-only and additionally rely on their own retry-on-
 * invalid-JSON logic rather than assuming the instruction is enough.
 */
const JSON_MODE_INSTRUCTION =
  "반드시 유효한 JSON 객체로만 응답하세요. JSON 앞뒤로 다른 텍스트를 포함하지 마세요. 문자열 값 안에 큰따옴표(\")가 포함되어야 한다면 반드시 \\\" 로 이스케이프하세요. 문자열 값 안에서 줄바꿈이 필요하면 실제 줄바꿈 대신 \\n을 사용하세요.";

interface AnthropicPayload {
  system?: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  tools?: Array<{ name: string; description?: string; input_schema: Record<string, unknown> }>;
  tool_choice?: { type: "tool"; name: string };
}

/**
 * When options.jsonSchema is set, forces the response through Anthropic
 * tool-use (tools + tool_choice) instead of the prompt-instruction-based
 * jsonMode — see the module doc comment above JSON_MODE_INSTRUCTION. Tool-use
 * input is constrained decoding on Anthropic's side, so it structurally
 * cannot produce syntactically invalid JSON the way jsonMode's soft
 * instruction can.
 */
function toAnthropicPayload(messages: ChatMessage[], options: LlmCompleteOptions | undefined): AnthropicPayload {
  const systemParts = messages.filter((m) => m.role === "system").map((m) => m.content);
  if (options?.jsonMode && !options?.jsonSchema) systemParts.push(JSON_MODE_INSTRUCTION);
  const rest = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

  const payload: AnthropicPayload = {
    system: systemParts.length > 0 ? systemParts.join("\n\n") : undefined,
    messages: rest,
  };

  if (options?.jsonSchema) {
    payload.tools = [
      {
        name: options.jsonSchema.name,
        description: options.jsonSchema.description,
        input_schema: options.jsonSchema.schema,
      },
    ];
    payload.tool_choice = { type: "tool", name: options.jsonSchema.name };
  }

  return payload;
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
  delta?: { type?: string; text?: string; partial_json?: string; stop_reason?: string | null };
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

      const deltaText =
        event.type === "content_block_delta"
          ? event.delta?.type === "text_delta"
            ? event.delta.text
            : event.delta?.type === "input_json_delta"
              ? event.delta.partial_json
              : undefined
          : undefined;

      if (deltaText) {
        totalChars += deltaText.length;
        yield deltaText;

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
    const { system, messages: anthropicMessages, tools, tool_choice } = toAnthropicPayload(messages, options);

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
          ...(tools ? { tools, tool_choice } : {}),
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
      content?: Array<{ type?: string; text?: string; input?: unknown }>;
      stop_reason?: string | null;
    };

    if (data.stop_reason === "max_tokens") {
      const err = new Error(TRUNCATION_ERROR_MESSAGE);
      logError("complete()", model, startedAt, err);
      throw err;
    }

    const toolUseBlock = data.content?.find((block) => block.type === "tool_use");
    const text = toolUseBlock ? JSON.stringify(toolUseBlock.input) : (data.content?.[0]?.text ?? "");
    logDone("complete()", model, startedAt, text.length, data.stop_reason);
    return text;
  }

  async completeStream(messages: ChatMessage[], options?: LlmCompleteOptions): Promise<AsyncIterable<string>> {
    const model = this.modelFor(options?.tier);
    const startedAt = logStart("completeStream()", model, messages);
    const { system, messages: anthropicMessages, tools, tool_choice } = toAnthropicPayload(messages, options);

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
          ...(tools ? { tools, tool_choice } : {}),
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
