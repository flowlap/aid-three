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

const DEFAULT_STREAM_IDLE_TIMEOUT_MS = 120_000;

/**
 * Max time we'll wait for the *next raw byte* from the streaming response
 * before treating the connection as dead and aborting. This is deliberately
 * an idle (gap-between-reads) timeout, not a total-duration one:
 *
 * - Measured against this project's real workload, deepseek-v4-pro (the
 *   "accurate" reasoning model) can spend ~3 minutes "thinking" before the
 *   first *content* token — but it streams `reasoning_content` bytes the whole
 *   time, so the raw socket is never silent for more than ~0.5s in a healthy
 *   run (observed max gap 482ms, p99 69ms across full runs).
 * - Total wall time swings widely (~90s to ~265s for the same prompt), so a
 *   total timeout would either be uselessly long or kill legitimate runs.
 *
 * 120s is ~250x the observed worst-case idle gap — effectively zero false
 * positives — while still auto-failing a genuinely hung request (the bug this
 * fixes: a stalled stream left the job "running" forever, blocking retries)
 * within two minutes instead of never. Override via env for tuning.
 */
function resolveIdleTimeoutMs(): number {
  const raw = Number(process.env.DEEPSEEK_STREAM_IDLE_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_STREAM_IDLE_TIMEOUT_MS;
}

export class StreamIdleTimeoutError extends Error {
  constructor(idleMs: number) {
    super(`스트리밍 응답이 ${Math.round(idleMs / 1000)}초 동안 데이터 없이 멈춰 요청을 중단했습니다`);
    this.name = "StreamIdleTimeoutError";
  }
}

/**
 * `reader.read()` raced against an idle timer. A fresh timer per call means
 * the deadline resets on every byte received, so this only fires when the
 * connection has been genuinely silent for `idleTimeoutMs`. On win by read the
 * timer is always cleared in `finally`; on timeout the pending read is left to
 * the caller to release via `reader.cancel()`.
 */
async function readWithIdleTimeout<T>(
  reader: ReadableStreamDefaultReader<T>,
  idleTimeoutMs: number
): Promise<ReadableStreamReadResult<T>> {
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      reader.read(),
      new Promise<never>((_, reject) => {
        idleTimer = setTimeout(() => reject(new StreamIdleTimeoutError(idleTimeoutMs)), idleTimeoutMs);
      }),
    ]);
  } finally {
    if (idleTimer) clearTimeout(idleTimer);
  }
}

async function* parseSSEStream(
  body: ReadableStream<Uint8Array>,
  label: string,
  model: string,
  startedAt: number,
  idleTimeoutMs: number
): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let totalChars = 0;
  let lastHeartbeat = startedAt;

  while (true) {
    let result: ReadableStreamReadResult<Uint8Array>;
    try {
      result = await readWithIdleTimeout(reader, idleTimeoutMs);
    } catch (err) {
      // Idle timeout (or a low-level read rejection): cancel the reader so the
      // hung upstream connection is actually released, then surface the error
      // — it propagates out of the async generator to the API route, which
      // marks the job "error" instead of leaving it stuck "running".
      await reader.cancel().catch(() => {});
      logError(label, model, startedAt, err);
      throw err;
    }
    const { done, value } = result;
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
    private readonly models: { accurate: string; fast: string } = DEFAULT_MODELS,
    private readonly idleTimeoutMs: number = resolveIdleTimeoutMs()
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

    return parseSSEStream(response.body!, "completeStream()", model, startedAt, this.idleTimeoutMs);
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
