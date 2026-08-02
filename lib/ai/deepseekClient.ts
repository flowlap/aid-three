export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface DeepSeekCompleteOptions {
  model?: string;
  jsonMode?: boolean;
  signal?: AbortSignal;
  /**
   * Upper bound on the model's output length. DeepSeek defaults to a
   * conservative value (reported around 4K) when this is omitted, which is
   * nowhere near enough for a large structured JSON response (e.g.
   * splitting a long narration into 100+ scenes) — the response gets cut
   * off mid-JSON and fails to parse. Every call site here sets an explicit,
   * generous value; see DEFAULT_MAX_TOKENS / LARGE_OUTPUT_MAX_TOKENS below.
   */
  maxTokens?: number;
}

export interface DeepSeekClient {
  complete(messages: ChatMessage[], options?: DeepSeekCompleteOptions): Promise<string>;
  /**
   * Resolves once the connection to DeepSeek is established and the request
   * was accepted (so callers can surface connection/auth errors immediately),
   * yielding response text chunks as they stream in.
   */
  completeStream(
    messages: ChatMessage[],
    options?: DeepSeekCompleteOptions
  ): Promise<AsyncIterable<string>>;
}

export const DEEPSEEK_MODELS = {
  pro: "deepseek-v4-pro",
  flash: "deepseek-v4-flash",
} as const;

const DEFAULT_MODEL: string = DEEPSEEK_MODELS.pro;
const BASE_URL = "https://api.deepseek.com";

/**
 * Generous default max_tokens for calls with no explicit override (e.g.
 * single-scene JSON responses in selectScreenTypes/reviewConsistency).
 * DeepSeek V4 supports up to 384K output tokens, so this is nowhere near a
 * real ceiling for the model — it's just meant to never be the bottleneck.
 */
export const DEFAULT_MAX_TOKENS = 16000;
/** For calls whose output scales with document size (markdown conversion, scene splitting). */
export const LARGE_OUTPUT_MAX_TOKENS = 65536;

const TRUNCATION_ERROR =
  "AI 응답이 최대 길이 제한(max_tokens)으로 중간에 잘렸습니다. 원고가 너무 길 수 있습니다.";

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
        logError(label, model, startedAt, new Error(TRUNCATION_ERROR));
        throw new Error(TRUNCATION_ERROR);
      }
    }
  }
  logDone(label, model, startedAt, totalChars, "stop (연결 종료)");
}

export class RealDeepSeekClient implements DeepSeekClient {
  constructor(private readonly apiKey: string) {}

  async complete(messages: ChatMessage[], options?: DeepSeekCompleteOptions): Promise<string> {
    const model = options?.model ?? DEFAULT_MODEL;
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
      const err = new Error(TRUNCATION_ERROR);
      logError("complete()", model, startedAt, err);
      throw err;
    }

    logDone("complete()", model, startedAt, choice.message.content.length, choice.finish_reason);
    return choice.message.content;
  }

  async completeStream(
    messages: ChatMessage[],
    options?: DeepSeekCompleteOptions
  ): Promise<AsyncIterable<string>> {
    const model = options?.model ?? DEFAULT_MODEL;
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

export function createDeepSeekClient(): DeepSeekClient {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    throw new Error("DEEPSEEK_API_KEY 환경변수가 설정되지 않았습니다");
  }
  return new RealDeepSeekClient(apiKey);
}
