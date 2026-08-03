# H-CHAT Provider Abstraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace direct DeepSeek (LLM) / OpenAI (image) calls with a provider-agnostic interface, so LLM and image generation can each independently select between the existing providers and a new internal "H-CHAT" gateway (Claude / ChatGPT / Gemini for LLM, Gemini for images), configured entirely through env vars.

**Architecture:** `LlmClient`/`ImageClient` interfaces live in `lib/ai/llm/types.ts` / `lib/ai/image/types.ts`. Each provider (DeepSeek, H-Chat Claude, H-Chat ChatGPT, H-Chat Gemini, OpenAI image, H-Chat Gemini image) is one self-contained file implementing the interface plus a `create*Client()` factory that reads its own env vars. A top-level `createLlmClient()` / `createImageClient()` factory reads `LLM_PROVIDER` / `IMAGE_PROVIDER` and dispatches to the right provider factory. Pipeline steps stop hard-coding vendor model names and instead pass an abstract `tier: "accurate" | "fast"`; each provider maps that to its own model name.

**Tech Stack:** TypeScript, Next.js API routes, Vitest, raw `fetch` (no HTTP/SDK dependency, matching the existing DeepSeek/OpenAI clients).

**Spec:** `docs/superpowers/specs/2026-08-03-hchat-provider-abstraction-design.md`

---

## Task 1: LLM interface + generic mock client

**Files:**
- Create: `lib/ai/llm/types.ts`
- Create: `lib/ai/llm/mockLlmClient.ts`
- Test: `lib/ai/llm/mockLlmClient.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// lib/ai/llm/mockLlmClient.test.ts
import { describe, it, expect } from "vitest";
import { MockLlmClient } from "./mockLlmClient";

describe("MockLlmClient", () => {
  it("returns queued responses in order", async () => {
    const client = new MockLlmClient(["첫 응답", "두번째 응답"]);

    const first = await client.complete([{ role: "user", content: "a" }]);
    const second = await client.complete([{ role: "user", content: "b" }]);

    expect(first).toBe("첫 응답");
    expect(second).toBe("두번째 응답");
  });

  it("repeats the last response once queue is exhausted", async () => {
    const client = new MockLlmClient(["유일한 응답"]);

    await client.complete([{ role: "user", content: "a" }]);
    const second = await client.complete([{ role: "user", content: "b" }]);

    expect(second).toBe("유일한 응답");
  });

  it("records call messages and options for assertions", async () => {
    const client = new MockLlmClient(["응답"]);

    await client.complete([{ role: "user", content: "질문" }], { jsonMode: true, tier: "fast" });

    expect(client.calls).toHaveLength(1);
    expect(client.calls[0].messages[0].content).toBe("질문");
    expect(client.calls[0].options?.jsonMode).toBe(true);
    expect(client.calls[0].options?.tier).toBe("fast");
  });

  it("rejects complete() when the signal is already aborted", async () => {
    const client = new MockLlmClient(["응답"]);
    const controller = new AbortController();
    controller.abort();

    await expect(
      client.complete([{ role: "user", content: "a" }], { signal: controller.signal })
    ).rejects.toThrow();
  });

  it("rejects completeStream() when the signal is already aborted", async () => {
    const client = new MockLlmClient(["응답"]);
    const controller = new AbortController();
    controller.abort();

    await expect(
      client.completeStream([{ role: "user", content: "a" }], { signal: controller.signal })
    ).rejects.toThrow();
  });

  it("yields the queued response in chunks via completeStream", async () => {
    const client = new MockLlmClient(["안녕하세요"]);

    const iterable = await client.completeStream([{ role: "user", content: "a" }]);
    const chunks: string[] = [];
    for await (const chunk of iterable) chunks.push(chunk);

    expect(chunks.join("")).toBe("안녕하세요");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/ai/llm/mockLlmClient.test.ts`
Expected: FAIL with "Cannot find module './mockLlmClient'" (or similar — `types.ts` and `mockLlmClient.ts` don't exist yet)

- [ ] **Step 3: Create the interface file**

```ts
// lib/ai/llm/types.ts
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
```

- [ ] **Step 4: Create the mock client**

```ts
// lib/ai/llm/mockLlmClient.ts
import type { ChatMessage, LlmClient, LlmCompleteOptions } from "./types";

export class MockLlmClient implements LlmClient {
  public calls: Array<{ messages: ChatMessage[]; options?: LlmCompleteOptions }> = [];
  private callIndex = 0;

  constructor(private readonly responses: string[]) {}

  async complete(messages: ChatMessage[], options?: LlmCompleteOptions): Promise<string> {
    this.calls.push({ messages, options });
    if (options?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const response = this.responses[this.callIndex] ?? this.responses[this.responses.length - 1];
    this.callIndex += 1;
    return response;
  }

  async completeStream(
    messages: ChatMessage[],
    options?: LlmCompleteOptions
  ): Promise<AsyncIterable<string>> {
    this.calls.push({ messages, options });
    if (options?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const response = this.responses[this.callIndex] ?? this.responses[this.responses.length - 1];
    this.callIndex += 1;
    return (async function* () {
      const chunkSize = 5;
      for (let i = 0; i < response.length; i += chunkSize) {
        yield response.slice(i, i + chunkSize);
      }
    })();
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run lib/ai/llm/mockLlmClient.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 6: Commit**

```bash
git add lib/ai/llm/types.ts lib/ai/llm/mockLlmClient.ts lib/ai/llm/mockLlmClient.test.ts
git commit -m "Add generic LlmClient interface and mock"
```

---

## Task 2: Image interface + generic mock client

**Files:**
- Create: `lib/ai/image/types.ts`
- Create: `lib/ai/image/mockImageClient.ts`
- Test: `lib/ai/image/mockImageClient.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// lib/ai/image/mockImageClient.test.ts
import { describe, it, expect } from "vitest";
import { MockImageClient } from "./mockImageClient";

describe("MockImageClient", () => {
  it("returns a non-empty image buffer and records the call", async () => {
    const client = new MockImageClient();

    const buffer = await client.generateImage("a prompt");

    expect(buffer.length).toBeGreaterThan(0);
    expect(client.calls).toHaveLength(1);
    expect(client.calls[0].prompt).toBe("a prompt");
  });

  it("returns a custom buffer when one is provided", async () => {
    const custom = Buffer.from([1, 2, 3]);
    const client = new MockImageClient(custom);

    const buffer = await client.generateImage("a prompt");

    expect(buffer).toBe(custom);
  });

  it("rejects when the signal is already aborted", async () => {
    const client = new MockImageClient();
    const controller = new AbortController();
    controller.abort();

    await expect(client.generateImage("a prompt", { signal: controller.signal })).rejects.toThrow();
  });

  it("records referenceImages passed in options", async () => {
    const client = new MockImageClient();
    const bg = Buffer.from("bg");

    await client.generateImage("a prompt", { referenceImages: [bg] });

    expect(client.calls[0].options?.referenceImages).toEqual([bg]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/ai/image/mockImageClient.test.ts`
Expected: FAIL with "Cannot find module './mockImageClient'"

- [ ] **Step 3: Create the interface file**

```ts
// lib/ai/image/types.ts
export interface ImageGenerateOptions {
  quality?: "low" | "medium" | "high";
  size?: string;
  signal?: AbortSignal;
  /**
   * Reference images (e.g. a fixed background and/or presenter photo) to
   * condition generation on. When non-empty, generateImage should produce
   * the new image *from* these references rather than from the prompt alone.
   */
  referenceImages?: Buffer[];
}

/** Thrown for a non-ok image API response, with the HTTP status attached so callers can tell a rate limit (429) apart from other failures without parsing the message text. */
export class ImageApiError extends Error {
  constructor(
    public readonly status: number,
    body: string
  ) {
    super(`이미지 생성 API 오류 (${status}): ${body}`);
    this.name = "ImageApiError";
  }
}

export interface ImageClient {
  generateImage(prompt: string, options?: ImageGenerateOptions): Promise<Buffer>;
}
```

- [ ] **Step 4: Create the mock client**

```ts
// lib/ai/image/mockImageClient.ts
import type { ImageClient, ImageGenerateOptions } from "./types";

// A minimal valid 1x1 PNG, so tests exercise real Buffer plumbing without a network call.
const FAKE_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
);

export class MockImageClient implements ImageClient {
  public calls: Array<{ prompt: string; options?: ImageGenerateOptions }> = [];

  constructor(private readonly imageBuffer: Buffer = FAKE_PNG) {}

  async generateImage(prompt: string, options?: ImageGenerateOptions): Promise<Buffer> {
    this.calls.push({ prompt, options });
    if (options?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    return this.imageBuffer;
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run lib/ai/image/mockImageClient.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 6: Commit**

```bash
git add lib/ai/image/types.ts lib/ai/image/mockImageClient.ts lib/ai/image/mockImageClient.test.ts
git commit -m "Add generic ImageClient interface and mock"
```

---

## Task 3: Migrate DeepSeek client to the tier-based LlmClient interface

**Files:**
- Create: `lib/ai/llm/deepseekClient.ts`
- Create: `lib/ai/llm/deepseekClient.test.ts`
- Delete: `lib/ai/deepseekClient.ts`, `lib/ai/deepseekClient.mock.ts`, `lib/ai/deepseekClient.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// lib/ai/llm/deepseekClient.test.ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { RealDeepSeekClient } from "./deepseekClient";

describe("RealDeepSeekClient", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function mockFetchOk(body: unknown) {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => body,
      text: async () => JSON.stringify(body),
      body: new ReadableStream({
        start(controller) {
          controller.close();
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("forwards the abort signal into fetch() for complete()", async () => {
    const fetchMock = mockFetchOk({ choices: [{ message: { content: "응답" } }] });
    const client = new RealDeepSeekClient("test-key");
    const controller = new AbortController();

    await client.complete([{ role: "user", content: "a" }], { signal: controller.signal });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ signal: controller.signal });
  });

  it("uses the accurate tier's model by default", async () => {
    const fetchMock = mockFetchOk({ choices: [{ message: { content: "응답" } }] });
    const client = new RealDeepSeekClient("test-key");

    await client.complete([{ role: "user", content: "a" }]);

    const requestBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(requestBody.model).toBe("deepseek-v4-pro");
  });

  it("forwards the fast tier's model name into fetch()", async () => {
    const fetchMock = mockFetchOk({ choices: [{ message: { content: "응답" } }] });
    const client = new RealDeepSeekClient("test-key");

    await client.complete([{ role: "user", content: "a" }], { tier: "fast" });

    const requestBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(requestBody.model).toBe("deepseek-v4-flash");
  });

  it("uses custom model names when provided by the factory", async () => {
    const fetchMock = mockFetchOk({ choices: [{ message: { content: "응답" } }] });
    const client = new RealDeepSeekClient("test-key", { accurate: "custom-pro", fast: "custom-flash" });

    await client.complete([{ role: "user", content: "a" }], { tier: "fast" });

    const requestBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(requestBody.model).toBe("custom-flash");
  });

  it("sends a generous default max_tokens when none is given", async () => {
    const fetchMock = mockFetchOk({ choices: [{ message: { content: "응답" } }] });
    const client = new RealDeepSeekClient("test-key");

    await client.complete([{ role: "user", content: "a" }]);

    const requestBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(requestBody.max_tokens).toBeGreaterThanOrEqual(16000);
  });

  it("forwards an explicit maxTokens override into fetch()", async () => {
    const fetchMock = mockFetchOk({ choices: [{ message: { content: "응답" } }] });
    const client = new RealDeepSeekClient("test-key");

    await client.complete([{ role: "user", content: "a" }], { maxTokens: 65536 });

    const requestBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(requestBody.max_tokens).toBe(65536);
  });

  it("throws a clear truncation error when complete() hits finish_reason=length", async () => {
    mockFetchOk({ choices: [{ message: { content: "잘린 응답" }, finish_reason: "length" }] });
    const client = new RealDeepSeekClient("test-key");

    await expect(client.complete([{ role: "user", content: "a" }])).rejects.toThrow(/최대 길이 제한/);
  });

  it("throws a clear truncation error when completeStream() hits finish_reason=length", async () => {
    const sseBody =
      `data: ${JSON.stringify({ choices: [{ delta: { content: "일부 " }, finish_reason: null }] })}\n\n` +
      `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "length" }] })}\n\n`;
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(sseBody));
          controller.close();
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const client = new RealDeepSeekClient("test-key");

    const iterable = await client.completeStream([{ role: "user", content: "a" }]);

    async function drain() {
      const chunks: string[] = [];
      for await (const chunk of iterable) chunks.push(chunk);
      return chunks;
    }

    await expect(drain()).rejects.toThrow(/최대 길이 제한/);
  });

  it("yields chunks before throwing on a truncated stream, so partial text isn't lost", async () => {
    const sseBody =
      `data: ${JSON.stringify({ choices: [{ delta: { content: "받은 " }, finish_reason: null }] })}\n\n` +
      `data: ${JSON.stringify({ choices: [{ delta: { content: "부분" }, finish_reason: "length" }] })}\n\n`;
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(sseBody));
          controller.close();
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const client = new RealDeepSeekClient("test-key");

    const iterable = await client.completeStream([{ role: "user", content: "a" }]);
    const received: string[] = [];
    await expect(
      (async () => {
        for await (const chunk of iterable) received.push(chunk);
      })()
    ).rejects.toThrow();

    expect(received.join("")).toBe("받은 부분");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/ai/llm/deepseekClient.test.ts`
Expected: FAIL with "Cannot find module './deepseekClient'"

- [ ] **Step 3: Create the migrated client**

```ts
// lib/ai/llm/deepseekClient.ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/ai/llm/deepseekClient.test.ts`
Expected: PASS (9 tests)

- [ ] **Step 5: Delete the old files**

```bash
git rm lib/ai/deepseekClient.ts lib/ai/deepseekClient.mock.ts lib/ai/deepseekClient.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add lib/ai/llm/deepseekClient.ts lib/ai/llm/deepseekClient.test.ts
git commit -m "Migrate DeepSeek client to the tier-based LlmClient interface"
```

---

## Task 4: Migrate OpenAI image client to the generic ImageClient interface

**Files:**
- Create: `lib/ai/image/openaiImageClient.ts`
- Create: `lib/ai/image/openaiImageClient.test.ts`
- Delete: `lib/ai/openaiImageClient.ts`, `lib/ai/openaiImageClient.mock.ts`

- [ ] **Step 1: Write the failing test**

```ts
// lib/ai/image/openaiImageClient.test.ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { RealOpenAiImageClient } from "./openaiImageClient";
import { ImageApiError } from "./types";

describe("RealOpenAiImageClient", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts to /images/generations with the prompt when there are no reference images", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ b64_json: Buffer.from([1, 2, 3]).toString("base64") }] }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const client = new RealOpenAiImageClient("test-key");

    const buffer = await client.generateImage("a prompt");

    expect(buffer).toEqual(Buffer.from([1, 2, 3]));
    expect(fetchMock.mock.calls[0][0]).toContain("/images/generations");
    const requestBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(requestBody.prompt).toBe("a prompt");
    expect(requestBody.model).toBe("gpt-image-2");
  });

  it("posts to /images/edits with multipart form data when reference images are given", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ b64_json: Buffer.from([4, 5, 6]).toString("base64") }] }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const client = new RealOpenAiImageClient("test-key");

    const buffer = await client.generateImage("a prompt", { referenceImages: [Buffer.from("bg")] });

    expect(buffer).toEqual(Buffer.from([4, 5, 6]));
    expect(fetchMock.mock.calls[0][0]).toContain("/images/edits");
    expect(fetchMock.mock.calls[0][1].body).toBeInstanceOf(FormData);
  });

  it("downloads the image when the response has a url instead of b64_json", async () => {
    const imageBytes = Buffer.from([7, 8, 9]);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [{ url: "https://example.test/img.png" }] }) })
      .mockResolvedValueOnce({ ok: true, arrayBuffer: async () => imageBytes.buffer.slice(imageBytes.byteOffset, imageBytes.byteOffset + imageBytes.byteLength) });
    vi.stubGlobal("fetch", fetchMock);
    const client = new RealOpenAiImageClient("test-key");

    const buffer = await client.generateImage("a prompt");

    expect(buffer).toEqual(imageBytes);
  });

  it("throws an ImageApiError with the HTTP status on a non-ok response", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 429, text: async () => "rate limited" });
    vi.stubGlobal("fetch", fetchMock);
    const client = new RealOpenAiImageClient("test-key");

    const err = await client.generateImage("a prompt").catch((e) => e);

    expect(err).toBeInstanceOf(ImageApiError);
    expect((err as ImageApiError).status).toBe(429);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/ai/image/openaiImageClient.test.ts`
Expected: FAIL with "Cannot find module './openaiImageClient'"

- [ ] **Step 3: Create the migrated client**

```ts
// lib/ai/image/openaiImageClient.ts
import { ImageApiError, type ImageClient, type ImageGenerateOptions } from "./types";

// ⚠️ Unverified model name (user-confirmed as "GPT Image 2 Low" without checking it exists in
// the OpenAI catalog). Kept as the single place to fix if the API rejects it.
export const OPENAI_IMAGE_MODELS = {
  default: "gpt-image-2",
} as const;

const DEFAULT_QUALITY = "low";
const DEFAULT_SIZE = "1536x1024";
const BASE_URL = "https://api.openai.com/v1";

export class RealOpenAiImageClient implements ImageClient {
  constructor(private readonly apiKey: string) {}

  async generateImage(prompt: string, options?: ImageGenerateOptions): Promise<Buffer> {
    const referenceImages = options?.referenceImages?.filter((img) => img.length > 0) ?? [];
    return referenceImages.length > 0
      ? this.editImage(prompt, referenceImages, options)
      : this.generateFromScratch(prompt, options);
  }

  private async generateFromScratch(prompt: string, options?: ImageGenerateOptions): Promise<Buffer> {
    const startedAt = Date.now();
    const quality = options?.quality ?? DEFAULT_QUALITY;
    const size = options?.size ?? DEFAULT_SIZE;
    console.log(`[OpenAI Image] 생성 시작 model=${OPENAI_IMAGE_MODELS.default} quality=${quality} size=${size} promptChars=${prompt.length}`);

    let response: Response;
    try {
      response = await fetch(`${BASE_URL}/images/generations`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: OPENAI_IMAGE_MODELS.default,
          prompt,
          quality,
          size,
          n: 1,
        }),
        signal: options?.signal,
      });
    } catch (err) {
      console.error(`[OpenAI Image] 생성 실패 elapsedMs=${Date.now() - startedAt}`, err);
      throw err;
    }

    return this.parseImageResponse(response, startedAt);
  }

  private async editImage(prompt: string, referenceImages: Buffer[], options?: ImageGenerateOptions): Promise<Buffer> {
    const startedAt = Date.now();
    const quality = options?.quality ?? DEFAULT_QUALITY;
    const size = options?.size ?? DEFAULT_SIZE;
    console.log(
      `[OpenAI Image] 참조 이미지 기반 생성 시작 model=${OPENAI_IMAGE_MODELS.default} quality=${quality} size=${size} promptChars=${prompt.length} refImages=${referenceImages.length}`
    );

    const form = new FormData();
    form.set("model", OPENAI_IMAGE_MODELS.default);
    form.set("prompt", prompt);
    form.set("quality", quality);
    form.set("size", size);
    form.set("n", "1");
    referenceImages.forEach((buffer, i) => {
      form.append("image[]", new Blob([new Uint8Array(buffer)], { type: "image/png" }), `reference-${i}.png`);
    });

    let response: Response;
    try {
      response = await fetch(`${BASE_URL}/images/edits`, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.apiKey}` },
        body: form,
        signal: options?.signal,
      });
    } catch (err) {
      console.error(`[OpenAI Image] 참조 이미지 기반 생성 실패 elapsedMs=${Date.now() - startedAt}`, err);
      throw err;
    }

    return this.parseImageResponse(response, startedAt);
  }

  private async parseImageResponse(response: Response, startedAt: number): Promise<Buffer> {
    if (!response.ok) {
      const body = await response.text();
      const err = new ImageApiError(response.status, body);
      console.error(`[OpenAI Image] 생성 실패 elapsedMs=${Date.now() - startedAt}`, err);
      throw err;
    }

    const data = (await response.json()) as { data: Array<{ b64_json?: string; url?: string }> };
    const first = data.data[0];
    if (first?.b64_json) {
      const buffer = Buffer.from(first.b64_json, "base64");
      console.log(`[OpenAI Image] 생성 완료 elapsedMs=${Date.now() - startedAt} bytes=${buffer.length}`);
      return buffer;
    }
    if (first?.url) {
      const imageRes = await fetch(first.url);
      if (!imageRes.ok) throw new Error(`이미지 다운로드 실패 (${imageRes.status})`);
      const buffer = Buffer.from(await imageRes.arrayBuffer());
      console.log(`[OpenAI Image] 생성 완료(URL 다운로드) elapsedMs=${Date.now() - startedAt} bytes=${buffer.length}`);
      return buffer;
    }
    const err = new Error("OpenAI Image API 응답에 이미지 데이터가 없습니다");
    console.error(`[OpenAI Image] 생성 실패 elapsedMs=${Date.now() - startedAt}`, err);
    throw err;
  }
}

export function createOpenAiImageClient(): ImageClient {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY 환경변수가 설정되지 않았습니다");
  }
  return new RealOpenAiImageClient(apiKey);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/ai/image/openaiImageClient.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Delete the old files**

```bash
git rm lib/ai/openaiImageClient.ts lib/ai/openaiImageClient.mock.ts
```

- [ ] **Step 6: Commit**

```bash
git add lib/ai/image/openaiImageClient.ts lib/ai/image/openaiImageClient.test.ts
git commit -m "Migrate OpenAI image client to the generic ImageClient interface"
```

---

## Task 5: H-CHAT shared gateway helpers

**Files:**
- Create: `lib/ai/hchatShared.ts`
- Test: `lib/ai/hchatShared.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// lib/ai/hchatShared.test.ts
import { describe, it, expect, afterEach, vi } from "vitest";
import { getHChatBaseUrl, getHChatHeaders } from "./hchatShared";

describe("getHChatBaseUrl", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns the default internal gateway URL when HCHAT_BASE_URL is unset", () => {
    expect(getHChatBaseUrl()).toBe("https://internal-apigw-kr.hmg-corp.io/hchat-in/api/v3");
  });

  it("returns the override URL when HCHAT_BASE_URL is set", () => {
    vi.stubEnv("HCHAT_BASE_URL", "https://example.test/hchat");
    expect(getHChatBaseUrl()).toBe("https://example.test/hchat");
  });
});

describe("getHChatHeaders", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("throws when HCHAT_KEY is not set", () => {
    expect(() => getHChatHeaders()).toThrow(/HCHAT_KEY/);
  });

  it("returns the Authorization header set to the raw key (no Bearer prefix)", () => {
    vi.stubEnv("HCHAT_KEY", "test-hchat-key");
    expect(getHChatHeaders()).toEqual({
      "Content-Type": "application/json",
      Authorization: "test-hchat-key",
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/ai/hchatShared.test.ts`
Expected: FAIL with "Cannot find module './hchatShared'"

- [ ] **Step 3: Create the shared helpers**

```ts
// lib/ai/hchatShared.ts
const DEFAULT_BASE_URL = "https://internal-apigw-kr.hmg-corp.io/hchat-in/api/v3";

export function getHChatBaseUrl(): string {
  return process.env.HCHAT_BASE_URL || DEFAULT_BASE_URL;
}

export function getHChatHeaders(): Record<string, string> {
  const key = process.env.HCHAT_KEY;
  if (!key) {
    throw new Error("HCHAT_KEY 환경변수가 설정되지 않았습니다");
  }
  return { "Content-Type": "application/json", Authorization: key };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/ai/hchatShared.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/ai/hchatShared.ts lib/ai/hchatShared.test.ts
git commit -m "Add H-CHAT gateway URL/header helpers"
```

---

## Task 6: H-CHAT Claude LLM client

**Files:**
- Create: `lib/ai/llm/hchatClaudeClient.ts`
- Test: `lib/ai/llm/hchatClaudeClient.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// lib/ai/llm/hchatClaudeClient.test.ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { RealHChatClaudeClient } from "./hchatClaudeClient";

describe("RealHChatClaudeClient", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  function mockFetchOk(body: unknown) {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => body,
      text: async () => JSON.stringify(body),
      body: new ReadableStream({ start(controller) { controller.close(); } }),
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("posts to the claude/messages endpoint with the accurate tier's model by default", async () => {
    vi.stubEnv("HCHAT_KEY", "test-hchat-key");
    const fetchMock = mockFetchOk({ content: [{ text: "응답" }] });
    const client = new RealHChatClaudeClient();

    await client.complete([
      { role: "system", content: "시스템 지침" },
      { role: "user", content: "질문" },
    ]);

    expect(fetchMock.mock.calls[0][0]).toContain("/claude/messages");
    expect(fetchMock.mock.calls[0][1].headers).toMatchObject({ Authorization: "test-hchat-key" });
    const requestBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(requestBody.model).toBe("claude-sonnet-5");
    expect(requestBody.system).toBe("시스템 지침");
    expect(requestBody.messages).toEqual([{ role: "user", content: "질문" }]);
  });

  it("uses the fast tier's model when requested", async () => {
    vi.stubEnv("HCHAT_KEY", "test-hchat-key");
    const fetchMock = mockFetchOk({ content: [{ text: "응답" }] });
    const client = new RealHChatClaudeClient();

    await client.complete([{ role: "user", content: "질문" }], { tier: "fast" });

    const requestBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(requestBody.model).toBe("claude-haiku-4-5");
  });

  it("appends a JSON-mode instruction to the system prompt when jsonMode is set", async () => {
    vi.stubEnv("HCHAT_KEY", "test-hchat-key");
    const fetchMock = mockFetchOk({ content: [{ text: "{}" }] });
    const client = new RealHChatClaudeClient();

    await client.complete([{ role: "user", content: "질문" }], { jsonMode: true });

    const requestBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(requestBody.system).toContain("JSON");
  });

  it("throws a clear truncation error when stop_reason is max_tokens", async () => {
    vi.stubEnv("HCHAT_KEY", "test-hchat-key");
    mockFetchOk({ content: [{ text: "잘린 응답" }], stop_reason: "max_tokens" });
    const client = new RealHChatClaudeClient();

    await expect(client.complete([{ role: "user", content: "질문" }])).rejects.toThrow(/최대 길이 제한/);
  });

  it("throws a formatted H-Chat error on a non-ok response", async () => {
    vi.stubEnv("HCHAT_KEY", "test-hchat-key");
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => "internal error" });
    vi.stubGlobal("fetch", fetchMock);
    const client = new RealHChatClaudeClient();

    await expect(client.complete([{ role: "user", content: "질문" }])).rejects.toThrow(/H-Chat 오류 \(500\)/);
  });

  it("streams text_delta chunks and stops at message_stop", async () => {
    vi.stubEnv("HCHAT_KEY", "test-hchat-key");
    const sseBody =
      `data: ${JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text: "안녕" } })}\n\n` +
      `data: ${JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text: "하세요" } })}\n\n` +
      `data: ${JSON.stringify({ type: "message_stop" })}\n\n`;
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(sseBody));
          controller.close();
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const client = new RealHChatClaudeClient();

    const iterable = await client.completeStream([{ role: "user", content: "질문" }]);
    const chunks: string[] = [];
    for await (const chunk of iterable) chunks.push(chunk);

    expect(chunks.join("")).toBe("안녕하세요");
  });

  it("yields chunks before throwing when message_delta reports max_tokens mid-stream", async () => {
    vi.stubEnv("HCHAT_KEY", "test-hchat-key");
    const sseBody =
      `data: ${JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text: "받은 부분" } })}\n\n` +
      `data: ${JSON.stringify({ type: "message_delta", delta: { stop_reason: "max_tokens" } })}\n\n`;
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(sseBody));
          controller.close();
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const client = new RealHChatClaudeClient();

    const iterable = await client.completeStream([{ role: "user", content: "질문" }]);
    const received: string[] = [];
    await expect(
      (async () => {
        for await (const chunk of iterable) received.push(chunk);
      })()
    ).rejects.toThrow(/최대 길이 제한/);
    expect(received.join("")).toBe("받은 부분");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/ai/llm/hchatClaudeClient.test.ts`
Expected: FAIL with "Cannot find module './hchatClaudeClient'"

- [ ] **Step 3: Create the client**

```ts
// lib/ai/llm/hchatClaudeClient.ts
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
}

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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/ai/llm/hchatClaudeClient.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/ai/llm/hchatClaudeClient.ts lib/ai/llm/hchatClaudeClient.test.ts
git commit -m "Add H-CHAT Claude LLM client"
```

---

## Task 7: H-CHAT ChatGPT LLM client

**Files:**
- Create: `lib/ai/llm/hchatChatGptClient.ts`
- Test: `lib/ai/llm/hchatChatGptClient.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// lib/ai/llm/hchatChatGptClient.test.ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { RealHChatChatGptClient } from "./hchatChatGptClient";

describe("RealHChatChatGptClient", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  function mockFetchOk(body: unknown) {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => body,
      text: async () => JSON.stringify(body),
      body: new ReadableStream({ start(controller) { controller.close(); } }),
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("posts to the deployment path for the accurate tier's model by default", async () => {
    vi.stubEnv("HCHAT_KEY", "test-hchat-key");
    const fetchMock = mockFetchOk({ choices: [{ message: { content: "응답" } }] });
    const client = new RealHChatChatGptClient();

    await client.complete([{ role: "user", content: "질문" }]);

    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://internal-apigw-kr.hmg-corp.io/hchat-in/api/v3/openai/deployments/gpt-5.6-terra/chat/completions"
    );
    expect(fetchMock.mock.calls[0][1].headers).toMatchObject({ Authorization: "test-hchat-key" });
  });

  it("uses the fast tier's model in the deployment path", async () => {
    vi.stubEnv("HCHAT_KEY", "test-hchat-key");
    const fetchMock = mockFetchOk({ choices: [{ message: { content: "응답" } }] });
    const client = new RealHChatChatGptClient();

    await client.complete([{ role: "user", content: "질문" }], { tier: "fast" });

    expect(fetchMock.mock.calls[0][0]).toContain("/deployments/gpt-5.6-luna/");
  });

  it("requests JSON mode via response_format", async () => {
    vi.stubEnv("HCHAT_KEY", "test-hchat-key");
    const fetchMock = mockFetchOk({ choices: [{ message: { content: "{}" } }] });
    const client = new RealHChatChatGptClient();

    await client.complete([{ role: "user", content: "질문" }], { jsonMode: true });

    const requestBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(requestBody.response_format).toEqual({ type: "json_object" });
  });

  it("throws a clear truncation error when finish_reason is length", async () => {
    vi.stubEnv("HCHAT_KEY", "test-hchat-key");
    mockFetchOk({ choices: [{ message: { content: "잘린 응답" }, finish_reason: "length" }] });
    const client = new RealHChatChatGptClient();

    await expect(client.complete([{ role: "user", content: "질문" }])).rejects.toThrow(/최대 길이 제한/);
  });

  it("throws a formatted H-Chat error on a non-ok response", async () => {
    vi.stubEnv("HCHAT_KEY", "test-hchat-key");
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => "unauthorized" });
    vi.stubGlobal("fetch", fetchMock);
    const client = new RealHChatChatGptClient();

    await expect(client.complete([{ role: "user", content: "질문" }])).rejects.toThrow(/H-Chat 오류 \(401\)/);
  });

  it("streams delta content and stops at [DONE]", async () => {
    vi.stubEnv("HCHAT_KEY", "test-hchat-key");
    const sseBody =
      `data: ${JSON.stringify({ choices: [{ delta: { content: "안녕" }, finish_reason: null }] })}\n\n` +
      `data: ${JSON.stringify({ choices: [{ delta: { content: "하세요" }, finish_reason: null }] })}\n\n` +
      `data: [DONE]\n\n`;
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(sseBody));
          controller.close();
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const client = new RealHChatChatGptClient();

    const iterable = await client.completeStream([{ role: "user", content: "질문" }]);
    const chunks: string[] = [];
    for await (const chunk of iterable) chunks.push(chunk);

    expect(chunks.join("")).toBe("안녕하세요");
  });

  it("throws a truncation error mid-stream when finish_reason is length, without losing prior chunks", async () => {
    vi.stubEnv("HCHAT_KEY", "test-hchat-key");
    const sseBody =
      `data: ${JSON.stringify({ choices: [{ delta: { content: "받은 부분" }, finish_reason: null }] })}\n\n` +
      `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "length" }] })}\n\n`;
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(sseBody));
          controller.close();
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const client = new RealHChatChatGptClient();

    const iterable = await client.completeStream([{ role: "user", content: "질문" }]);
    const received: string[] = [];
    await expect(
      (async () => {
        for await (const chunk of iterable) received.push(chunk);
      })()
    ).rejects.toThrow(/최대 길이 제한/);
    expect(received.join("")).toBe("받은 부분");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/ai/llm/hchatChatGptClient.test.ts`
Expected: FAIL with "Cannot find module './hchatChatGptClient'"

- [ ] **Step 3: Create the client**

```ts
// lib/ai/llm/hchatChatGptClient.ts
import type { ChatMessage, LlmClient, LlmCompleteOptions, LlmTier } from "./types";
import { DEFAULT_MAX_TOKENS, TRUNCATION_ERROR_MESSAGE } from "./types";
import { getHChatBaseUrl, getHChatHeaders } from "../hchatShared";

const DEFAULT_MODELS = {
  accurate: "gpt-5.6-terra",
  fast: "gpt-5.6-luna",
} as const;

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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/ai/llm/hchatChatGptClient.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/ai/llm/hchatChatGptClient.ts lib/ai/llm/hchatChatGptClient.test.ts
git commit -m "Add H-CHAT ChatGPT LLM client"
```

---

## Task 8: H-CHAT Gemini LLM client

**Files:**
- Create: `lib/ai/llm/hchatGeminiClient.ts`
- Test: `lib/ai/llm/hchatGeminiClient.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// lib/ai/llm/hchatGeminiClient.test.ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { RealHChatGeminiClient } from "./hchatGeminiClient";

describe("RealHChatGeminiClient", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  function mockFetchOk(body: unknown) {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => body, text: async () => JSON.stringify(body) });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("posts to the generateContent endpoint for the accurate tier's model by default", async () => {
    vi.stubEnv("HCHAT_KEY", "test-hchat-key");
    const fetchMock = mockFetchOk({ candidates: [{ content: { parts: [{ text: "응답" }] }, finishReason: "STOP" }] });
    const client = new RealHChatGeminiClient();

    const result = await client.complete([
      { role: "system", content: "시스템 지침" },
      { role: "user", content: "질문" },
    ]);

    expect(result).toBe("응답");
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://internal-apigw-kr.hmg-corp.io/hchat-in/api/v3/models/gemini-3.6-flash:generateContent"
    );
    const requestBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(requestBody.systemInstruction).toEqual({ parts: [{ text: "시스템 지침" }] });
    expect(requestBody.contents).toEqual([{ role: "user", parts: [{ text: "질문" }] }]);
  });

  it("uses the fast tier's model", async () => {
    vi.stubEnv("HCHAT_KEY", "test-hchat-key");
    const fetchMock = mockFetchOk({ candidates: [{ content: { parts: [{ text: "응답" }] } }] });
    const client = new RealHChatGeminiClient();

    await client.complete([{ role: "user", content: "질문" }], { tier: "fast" });

    expect(fetchMock.mock.calls[0][0]).toContain("/models/gemini-3.5-flash-lite:generateContent");
  });

  it("sets responseMimeType to application/json when jsonMode is set", async () => {
    vi.stubEnv("HCHAT_KEY", "test-hchat-key");
    const fetchMock = mockFetchOk({ candidates: [{ content: { parts: [{ text: "{}" }] } }] });
    const client = new RealHChatGeminiClient();

    await client.complete([{ role: "user", content: "질문" }], { jsonMode: true });

    const requestBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(requestBody.generationConfig.responseMimeType).toBe("application/json");
  });

  it("maps the assistant role to Gemini's model role", async () => {
    vi.stubEnv("HCHAT_KEY", "test-hchat-key");
    const fetchMock = mockFetchOk({ candidates: [{ content: { parts: [{ text: "응답" }] } }] });
    const client = new RealHChatGeminiClient();

    await client.complete([
      { role: "user", content: "질문" },
      { role: "assistant", content: "이전 답변" },
    ]);

    const requestBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(requestBody.contents[1]).toEqual({ role: "model", parts: [{ text: "이전 답변" }] });
  });

  it("throws a clear truncation error when finishReason is MAX_TOKENS", async () => {
    vi.stubEnv("HCHAT_KEY", "test-hchat-key");
    mockFetchOk({ candidates: [{ content: { parts: [{ text: "잘린 응답" }] }, finishReason: "MAX_TOKENS" }] });
    const client = new RealHChatGeminiClient();

    await expect(client.complete([{ role: "user", content: "질문" }])).rejects.toThrow(/최대 길이 제한/);
  });

  it("throws a formatted H-Chat error on a non-ok response", async () => {
    vi.stubEnv("HCHAT_KEY", "test-hchat-key");
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 503, text: async () => "unavailable" });
    vi.stubGlobal("fetch", fetchMock);
    const client = new RealHChatGeminiClient();

    await expect(client.complete([{ role: "user", content: "질문" }])).rejects.toThrow(/H-Chat 오류 \(503\)/);
  });

  it("completeStream emits the full response as a single chunk", async () => {
    vi.stubEnv("HCHAT_KEY", "test-hchat-key");
    mockFetchOk({ candidates: [{ content: { parts: [{ text: "한 번에 온 응답" }] }, finishReason: "STOP" }] });
    const client = new RealHChatGeminiClient();

    const iterable = await client.completeStream([{ role: "user", content: "질문" }]);
    const chunks: string[] = [];
    for await (const chunk of iterable) chunks.push(chunk);

    expect(chunks).toEqual(["한 번에 온 응답"]);
  });

  it("completeStream yields the partial text before throwing when truncated", async () => {
    vi.stubEnv("HCHAT_KEY", "test-hchat-key");
    mockFetchOk({ candidates: [{ content: { parts: [{ text: "받은 부분" }] }, finishReason: "MAX_TOKENS" }] });
    const client = new RealHChatGeminiClient();

    const iterable = await client.completeStream([{ role: "user", content: "질문" }]);
    const received: string[] = [];
    await expect(
      (async () => {
        for await (const chunk of iterable) received.push(chunk);
      })()
    ).rejects.toThrow(/최대 길이 제한/);
    expect(received).toEqual(["받은 부분"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/ai/llm/hchatGeminiClient.test.ts`
Expected: FAIL with "Cannot find module './hchatGeminiClient'"

- [ ] **Step 3: Create the client**

```ts
// lib/ai/llm/hchatGeminiClient.ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/ai/llm/hchatGeminiClient.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/ai/llm/hchatGeminiClient.ts lib/ai/llm/hchatGeminiClient.test.ts
git commit -m "Add H-CHAT Gemini LLM client"
```

---

## Task 9: LLM provider factory

**Files:**
- Create: `lib/ai/llm/factory.ts`
- Test: `lib/ai/llm/factory.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// lib/ai/llm/factory.test.ts
import { describe, it, expect, afterEach, vi } from "vitest";
import { createLlmClient } from "./factory";
import { RealDeepSeekClient } from "./deepseekClient";
import { RealHChatClaudeClient } from "./hchatClaudeClient";
import { RealHChatChatGptClient } from "./hchatChatGptClient";
import { RealHChatGeminiClient } from "./hchatGeminiClient";

describe("createLlmClient", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("defaults to deepseek when LLM_PROVIDER is unset", () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "test-key");

    expect(createLlmClient()).toBeInstanceOf(RealDeepSeekClient);
  });

  it("returns a Claude client for hchat-claude", () => {
    vi.stubEnv("LLM_PROVIDER", "hchat-claude");
    vi.stubEnv("HCHAT_KEY", "test-key");

    expect(createLlmClient()).toBeInstanceOf(RealHChatClaudeClient);
  });

  it("returns a ChatGPT client for hchat-chatgpt", () => {
    vi.stubEnv("LLM_PROVIDER", "hchat-chatgpt");
    vi.stubEnv("HCHAT_KEY", "test-key");

    expect(createLlmClient()).toBeInstanceOf(RealHChatChatGptClient);
  });

  it("returns a Gemini client for hchat-gemini", () => {
    vi.stubEnv("LLM_PROVIDER", "hchat-gemini");
    vi.stubEnv("HCHAT_KEY", "test-key");

    expect(createLlmClient()).toBeInstanceOf(RealHChatGeminiClient);
  });

  it("throws for an unknown provider", () => {
    vi.stubEnv("LLM_PROVIDER", "unknown-provider");

    expect(() => createLlmClient()).toThrow(/알 수 없는 LLM_PROVIDER/);
  });

  it("throws when deepseek is selected but DEEPSEEK_API_KEY is missing", () => {
    vi.stubEnv("LLM_PROVIDER", "deepseek");

    expect(() => createLlmClient()).toThrow(/DEEPSEEK_API_KEY/);
  });

  it("throws when an hchat provider is selected but HCHAT_KEY is missing", () => {
    vi.stubEnv("LLM_PROVIDER", "hchat-claude");

    expect(() => createLlmClient()).toThrow(/HCHAT_KEY/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/ai/llm/factory.test.ts`
Expected: FAIL with "Cannot find module './factory'"

- [ ] **Step 3: Create the factory**

```ts
// lib/ai/llm/factory.ts
import type { LlmClient } from "./types";
import { createDeepSeekClient } from "./deepseekClient";
import { createHChatClaudeClient } from "./hchatClaudeClient";
import { createHChatChatGptClient } from "./hchatChatGptClient";
import { createHChatGeminiClient } from "./hchatGeminiClient";

export type LlmProviderType = "deepseek" | "hchat-claude" | "hchat-chatgpt" | "hchat-gemini";

export function createLlmClient(): LlmClient {
  const provider = (process.env.LLM_PROVIDER || "deepseek") as LlmProviderType;
  switch (provider) {
    case "deepseek":
      return createDeepSeekClient();
    case "hchat-claude":
      return createHChatClaudeClient();
    case "hchat-chatgpt":
      return createHChatChatGptClient();
    case "hchat-gemini":
      return createHChatGeminiClient();
    default:
      throw new Error(`알 수 없는 LLM_PROVIDER 값입니다: ${provider}`);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/ai/llm/factory.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/ai/llm/factory.ts lib/ai/llm/factory.test.ts
git commit -m "Add createLlmClient() provider factory"
```

---

## Task 10: H-CHAT Gemini image client

**Files:**
- Create: `lib/ai/image/hchatGeminiImageClient.ts`
- Test: `lib/ai/image/hchatGeminiImageClient.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// lib/ai/image/hchatGeminiImageClient.test.ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { RealHChatGeminiImageClient } from "./hchatGeminiImageClient";
import { ImageApiError } from "./types";

describe("RealHChatGeminiImageClient", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  function geminiImageRawText(base64: string): string {
    return `[${JSON.stringify({
      candidates: [{ content: { parts: [{ inlineData: { data: base64, mimeType: "image/png" } }] } }],
    })}]`;
  }

  it("posts to the streamGenerateContent endpoint with the prompt and returns decoded image bytes", async () => {
    vi.stubEnv("HCHAT_KEY", "test-hchat-key");
    const imageBytes = Buffer.from([1, 2, 3]);
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => geminiImageRawText(imageBytes.toString("base64")) });
    vi.stubGlobal("fetch", fetchMock);
    const client = new RealHChatGeminiImageClient();

    const buffer = await client.generateImage("a prompt");

    expect(buffer).toEqual(imageBytes);
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://internal-apigw-kr.hmg-corp.io/hchat-in/api/v3/models/gemini-3.1-flash-image:streamGenerateContent"
    );
    expect(fetchMock.mock.calls[0][1].headers).toMatchObject({ Authorization: "test-hchat-key" });
    const requestBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(requestBody.contents[0].parts.at(-1)).toEqual({ text: "a prompt" });
  });

  it("includes reference images as inline_data parts before the prompt", async () => {
    vi.stubEnv("HCHAT_KEY", "test-hchat-key");
    const imageBytes = Buffer.from([4, 5, 6]);
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => geminiImageRawText(imageBytes.toString("base64")) });
    vi.stubGlobal("fetch", fetchMock);
    const client = new RealHChatGeminiImageClient();

    await client.generateImage("a prompt", { referenceImages: [Buffer.from("bg")] });

    const requestBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(requestBody.contents[0].parts[0].inline_data.mime_type).toBe("image/png");
    expect(requestBody.contents[0].parts).toHaveLength(2);
  });

  it("throws an ImageApiError with the HTTP status on a non-ok response", async () => {
    vi.stubEnv("HCHAT_KEY", "test-hchat-key");
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 429, text: async () => "rate limited" });
    vi.stubGlobal("fetch", fetchMock);
    const client = new RealHChatGeminiImageClient();

    const err = await client.generateImage("a prompt").catch((e) => e);

    expect(err).toBeInstanceOf(ImageApiError);
    expect((err as ImageApiError).status).toBe(429);
  });

  it("throws a clear error when the response has no image data", async () => {
    vi.stubEnv("HCHAT_KEY", "test-hchat-key");
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => "[]" });
    vi.stubGlobal("fetch", fetchMock);
    const client = new RealHChatGeminiImageClient();

    await expect(client.generateImage("a prompt")).rejects.toThrow(/이미지 데이터를 찾을 수 없습니다/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/ai/image/hchatGeminiImageClient.test.ts`
Expected: FAIL with "Cannot find module './hchatGeminiImageClient'"

- [ ] **Step 3: Create the client**

```ts
// lib/ai/image/hchatGeminiImageClient.ts
import { ImageApiError, type ImageClient, type ImageGenerateOptions } from "./types";
import { getHChatBaseUrl, getHChatHeaders } from "../hchatShared";

const DEFAULT_MODEL = "gemini-3.1-flash-image";

interface GeminiImagePart {
  inlineData?: { data: string; mimeType: string };
  inline_data?: { data: string; mimeType: string };
  thought?: boolean;
}

interface GeminiChunk {
  candidates?: Array<{ content?: { parts?: GeminiImagePart[] } }>;
}

function extractInlineImageBase64(raw: string): string {
  const lines = raw.split("\n").filter((l) => l.trim());
  let b64Data = "";

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === "[" || trimmed === "]") continue;
    const json = trimmed.startsWith(",") ? trimmed.slice(1) : trimmed;
    let parsed: GeminiChunk | GeminiChunk[];
    try {
      parsed = JSON.parse(json);
    } catch {
      continue;
    }
    const chunks = Array.isArray(parsed) ? parsed : [parsed];
    for (const chunk of chunks) {
      for (const candidate of chunk.candidates ?? []) {
        for (const part of candidate.content?.parts ?? []) {
          if (part.thought) continue;
          const inline = part.inlineData ?? part.inline_data;
          if (inline?.data) b64Data = inline.data;
        }
      }
    }
  }

  if (!b64Data) {
    throw new Error(`이미지 데이터를 찾을 수 없습니다\n\n[raw 응답 앞 500자]\n${raw.slice(0, 500)}`);
  }
  return b64Data;
}

export class RealHChatGeminiImageClient implements ImageClient {
  constructor(private readonly model: string = DEFAULT_MODEL) {}

  async generateImage(prompt: string, options?: ImageGenerateOptions): Promise<Buffer> {
    const startedAt = Date.now();
    const referenceImages = options?.referenceImages?.filter((img) => img.length > 0) ?? [];
    console.log(`[H-Chat Gemini Image] 생성 시작 model=${this.model} promptChars=${prompt.length} refImages=${referenceImages.length}`);

    const imageParts = referenceImages.map((buf) => ({
      inline_data: { mime_type: "image/png", data: buf.toString("base64") },
    }));

    let response: Response;
    try {
      response = await fetch(`${getHChatBaseUrl()}/models/${this.model}:streamGenerateContent`, {
        method: "POST",
        headers: getHChatHeaders(),
        body: JSON.stringify({
          contents: [{ role: "user", parts: [...imageParts, { text: prompt }] }],
          generationConfig: { responseModalities: ["IMAGE", "TEXT"], thinkingConfig: { thinkingBudget: 0 } },
        }),
        signal: options?.signal,
      });
    } catch (err) {
      console.error(`[H-Chat Gemini Image] 생성 실패 elapsedMs=${Date.now() - startedAt}`, err);
      throw err;
    }

    const rawText = await response.text().catch(() => "");
    if (!response.ok) {
      const err = new ImageApiError(response.status, rawText);
      console.error(`[H-Chat Gemini Image] 생성 실패 elapsedMs=${Date.now() - startedAt}`, err);
      throw err;
    }

    const b64Data = extractInlineImageBase64(rawText);
    const buffer = Buffer.from(b64Data, "base64");
    console.log(`[H-Chat Gemini Image] 생성 완료 elapsedMs=${Date.now() - startedAt} bytes=${buffer.length}`);
    return buffer;
  }
}

export function createHChatGeminiImageClient(): ImageClient {
  getHChatHeaders();
  const model = process.env.HCHAT_GEMINI_IMAGE_MODEL || DEFAULT_MODEL;
  return new RealHChatGeminiImageClient(model);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/ai/image/hchatGeminiImageClient.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/ai/image/hchatGeminiImageClient.ts lib/ai/image/hchatGeminiImageClient.test.ts
git commit -m "Add H-CHAT Gemini image client"
```

---

## Task 11: Image provider factory

**Files:**
- Create: `lib/ai/image/factory.ts`
- Test: `lib/ai/image/factory.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// lib/ai/image/factory.test.ts
import { describe, it, expect, afterEach, vi } from "vitest";
import { createImageClient } from "./factory";
import { RealOpenAiImageClient } from "./openaiImageClient";
import { RealHChatGeminiImageClient } from "./hchatGeminiImageClient";

describe("createImageClient", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("defaults to openai when IMAGE_PROVIDER is unset", () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");

    expect(createImageClient()).toBeInstanceOf(RealOpenAiImageClient);
  });

  it("returns a Gemini image client for hchat-gemini", () => {
    vi.stubEnv("IMAGE_PROVIDER", "hchat-gemini");
    vi.stubEnv("HCHAT_KEY", "test-key");

    expect(createImageClient()).toBeInstanceOf(RealHChatGeminiImageClient);
  });

  it("throws for an unknown provider", () => {
    vi.stubEnv("IMAGE_PROVIDER", "unknown-provider");

    expect(() => createImageClient()).toThrow(/알 수 없는 IMAGE_PROVIDER/);
  });

  it("throws when openai is selected but OPENAI_API_KEY is missing", () => {
    vi.stubEnv("IMAGE_PROVIDER", "openai");

    expect(() => createImageClient()).toThrow(/OPENAI_API_KEY/);
  });

  it("throws when hchat-gemini is selected but HCHAT_KEY is missing", () => {
    vi.stubEnv("IMAGE_PROVIDER", "hchat-gemini");

    expect(() => createImageClient()).toThrow(/HCHAT_KEY/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/ai/image/factory.test.ts`
Expected: FAIL with "Cannot find module './factory'"

- [ ] **Step 3: Create the factory**

```ts
// lib/ai/image/factory.ts
import type { ImageClient } from "./types";
import { createOpenAiImageClient } from "./openaiImageClient";
import { createHChatGeminiImageClient } from "./hchatGeminiImageClient";

export type ImageProviderType = "openai" | "hchat-gemini";

export function createImageClient(): ImageClient {
  const provider = (process.env.IMAGE_PROVIDER || "openai") as ImageProviderType;
  switch (provider) {
    case "openai":
      return createOpenAiImageClient();
    case "hchat-gemini":
      return createHChatGeminiImageClient();
    default:
      throw new Error(`알 수 없는 IMAGE_PROVIDER 값입니다: ${provider}`);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/ai/image/factory.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/ai/image/factory.ts lib/ai/image/factory.test.ts
git commit -m "Add createImageClient() provider factory"
```

---

## Task 12: Update pipeline LLM steps to the tier-based interface

**Files:**
- Modify: `lib/pipeline/convertMarkdown.ts`, `lib/pipeline/convertMarkdown.test.ts`
- Modify: `lib/pipeline/splitScenes.ts`, `lib/pipeline/splitScenes.test.ts`
- Modify: `lib/pipeline/analyzeSceneRelations.ts`, `lib/pipeline/analyzeSceneRelations.test.ts`
- Modify: `lib/pipeline/selectScreenTypes.ts`, `lib/pipeline/selectScreenTypes.test.ts`
- Modify: `lib/pipeline/reviewConsistency.ts`, `lib/pipeline/reviewConsistency.test.ts`
- Modify: `lib/pipeline/summarizeDocument.ts`, `lib/pipeline/summarizeDocument.test.ts`

This task updates all 6 pipeline steps and their tests together because they share the same mechanical change (swap `DeepSeekClient`/`DEEPSEEK_MODELS` for `LlmClient`/`tier`) and the test suite must stay green throughout — leaving one file on the old interface would break the shared `lib/ai/deepseekClient` import that Task 3 already deleted.

- [ ] **Step 1: Update the test files first (they will fail until Step 2 lands)**

In `lib/pipeline/convertMarkdown.test.ts`, replace the import and the model assertion:

```ts
// Before:
import { MockDeepSeekClient } from "../ai/deepseekClient.mock";
// After:
import { MockLlmClient } from "../ai/llm/mockLlmClient";
```

Replace every `new MockDeepSeekClient(` with `new MockLlmClient(`, and replace:

```ts
  it("requests the pro model", async () => {
    const client = new MockLlmClient(["결과"]);

    await convertToMarkdown(client, "원고", "narration");

    expect(client.calls[0].options?.tier).toBe("accurate");
  });
```

In `lib/pipeline/splitScenes.test.ts`: same import swap, and:

```ts
  it("requests the accurate tier", async () => {
    const client = new MockLlmClient([SAMPLE_RESPONSE]);

    await splitScenes(client, "나레이션");

    expect(client.calls[0].options?.tier).toBe("accurate");
  });
```

In `lib/pipeline/analyzeSceneRelations.test.ts`: same import swap, and:

```ts
  it("requests the accurate tier in json mode", async () => {
    const client = new MockLlmClient([analysisResponse([])]);

    await analyzeSceneRelations(client, scenes);

    expect(client.calls[0].options?.tier).toBe("accurate");
    expect(client.calls[0].options?.jsonMode).toBe(true);
  });
```

In `lib/pipeline/selectScreenTypes.test.ts`: same import swap, and change both:

```ts
    expect(client.calls[0].options?.model).toBe("deepseek-v4-flash");
```

occurrences (in "sends every pending content scene..." and "requests the flash model with a large output budget...") to:

```ts
    expect(client.calls[0].options?.tier).toBe("fast");
```

(rename the second test's description to `"requests the fast tier with a large output budget for group calls"`).

In `lib/pipeline/reviewConsistency.test.ts`: same import swap, and:

```ts
  it("requests the fast tier", async () => {
    const client = new MockLlmClient([JSON.stringify({ issues: [] })]);
    const scenes = [makeScene("scene-001", 1)];

    await reviewSemanticConsistency(client, scenes, {});

    expect(client.calls[0].options?.tier).toBe("fast");
  });
```

In `lib/pipeline/summarizeDocument.test.ts`: same import swap, and:

```ts
  it("requests the fast tier", async () => {
    const client = new MockLlmClient(["요약"]);

    await summarizeDocument(client, "본문");

    expect(client.calls[0].options?.tier).toBe("fast");
  });
```

- [ ] **Step 2: Run the pipeline tests to verify they fail**

Run: `npx vitest run lib/pipeline/convertMarkdown.test.ts lib/pipeline/splitScenes.test.ts lib/pipeline/analyzeSceneRelations.test.ts lib/pipeline/selectScreenTypes.test.ts lib/pipeline/reviewConsistency.test.ts lib/pipeline/summarizeDocument.test.ts`
Expected: FAIL — `Cannot find module '../ai/llm/mockLlmClient'` is already resolved (Task 1 created it), so failures should instead be `Cannot find module '../ai/deepseekClient.mock'` no longer applies; the real failures will be `client.calls[0].options?.tier` being `undefined` since the pipeline source still sends `model`.

- [ ] **Step 3: Update the pipeline source files**

`lib/pipeline/convertMarkdown.ts` — change the import line and both `client.complete`/`completeStream` option objects:

```ts
import { LARGE_OUTPUT_MAX_TOKENS, type ChatMessage, type LlmClient } from "../ai/llm/types";
import type { ScriptType } from "../projects/types";
```

```ts
export async function convertToMarkdown(
  client: LlmClient,
  rawText: string,
  scriptType: ScriptType,
  signal?: AbortSignal
): Promise<string> {
  return client.complete(buildMarkdownMessages(rawText, scriptType), {
    tier: "accurate",
    maxTokens: LARGE_OUTPUT_MAX_TOKENS,
    signal,
  });
}

export async function convertToMarkdownStream(
  client: LlmClient,
  rawText: string,
  scriptType: ScriptType,
  signal?: AbortSignal
): Promise<AsyncIterable<string>> {
  return client.completeStream(buildMarkdownMessages(rawText, scriptType), {
    tier: "accurate",
    maxTokens: LARGE_OUTPUT_MAX_TOKENS,
    signal,
  });
}
```

`lib/pipeline/splitScenes.ts` — change the import and both call sites:

```ts
import { LARGE_OUTPUT_MAX_TOKENS, type ChatMessage, type LlmClient } from "../ai/llm/types";
```

```ts
export async function splitScenes(client: LlmClient, narrationMarkdown: string): Promise<Scene[]> {
  const raw = await client.complete(buildSplitScenesMessages(narrationMarkdown), {
    jsonMode: true,
    tier: "accurate",
    maxTokens: LARGE_OUTPUT_MAX_TOKENS,
  });
  return parseScenesResponse(raw);
}

export async function splitScenesStream(
  client: LlmClient,
  narrationMarkdown: string,
  signal?: AbortSignal
): Promise<AsyncIterable<string>> {
  return client.completeStream(buildSplitScenesMessages(narrationMarkdown), {
    jsonMode: true,
    tier: "accurate",
    maxTokens: LARGE_OUTPUT_MAX_TOKENS,
    signal,
  });
}
```

`lib/pipeline/analyzeSceneRelations.ts` — change the import and call site:

```ts
import type { LlmClient } from "../ai/llm/types";
import type { Scene } from "./splitScenes";
```

```ts
export async function analyzeSceneRelations(
  client: LlmClient,
  scenes: Scene[],
  signal?: AbortSignal
): Promise<Record<string, SceneRelationAnalysis>> {
  if (scenes.length === 0) return {};

  const sceneList = scenes.map((s) => `${s.order}. ${s.narrationText}`).join("\n");
  const raw = await client.complete(buildAnalyzeMessages(sceneList), {
    jsonMode: true,
    tier: "accurate",
    signal,
  });
  // ... rest unchanged
```

`lib/pipeline/selectScreenTypes.ts` — change the import and the `designSceneGroup` call site:

```ts
import { LARGE_OUTPUT_MAX_TOKENS, type ChatMessage, type LlmClient } from "../ai/llm/types";
```

```ts
async function designSceneGroup(
  client: LlmClient,
  groupScenes: Scene[],
  context: {
    documentContext: string;
    commonPromptContext: string;
    sceneById: Map<string, Scene>;
    result: Record<string, ScreenTypeAssignment>;
    signal: AbortSignal;
  }
): Promise<Map<number, ScreenTypeAssignment>> {
  const relatedContextByOrder = new Map(
    groupScenes.map((scene) => [scene.order, buildRelatedSceneContext(scene, context.sceneById, context.result)])
  );

  const raw = await client.complete(
    buildDesignGroupMessages(groupScenes, context.documentContext, context.commonPromptContext, relatedContextByOrder),
    { jsonMode: true, tier: "fast", maxTokens: LARGE_OUTPUT_MAX_TOKENS, signal: context.signal }
  );
  // ... rest unchanged
```

And update the `selectScreenTypes` exported function's `client: DeepSeekClient` parameter type to `client: LlmClient`.

`lib/pipeline/reviewConsistency.ts` — change the import and both call sites:

```ts
import type { ChatMessage, LlmClient } from "../ai/llm/types";
import type { Scene } from "./splitScenes";
```

```ts
export async function reviewSemanticConsistency(
  client: LlmClient,
  scenes: Scene[],
  visualDesigns: Record<string, VisualDesign>
): Promise<ReviewIssue[]> {
  const raw = await client.complete(buildSemanticReviewMessages(scenes, visualDesigns), {
    jsonMode: true,
    tier: "fast",
  });
  return parseSemanticReviewResponse(raw);
}

export async function reviewSemanticConsistencyStream(
  client: LlmClient,
  scenes: Scene[],
  visualDesigns: Record<string, VisualDesign>,
  signal?: AbortSignal
): Promise<AsyncIterable<string>> {
  return client.completeStream(buildSemanticReviewMessages(scenes, visualDesigns), {
    jsonMode: true,
    tier: "fast",
    signal,
  });
}
```

`lib/pipeline/summarizeDocument.ts` — change the import and call site:

```ts
import type { LlmClient } from "../ai/llm/types";

export async function summarizeDocument(
  client: LlmClient,
  narrationMarkdown: string,
  signal?: AbortSignal
): Promise<string> {
  const prompt = `...`; // unchanged

  return client.complete(
    [
      { role: "system", content: "당신은 교육 콘텐츠 기획 전문가입니다." },
      { role: "user", content: prompt },
    ],
    { tier: "fast", signal }
  );
}
```

- [ ] **Step 4: Run the pipeline tests to verify they pass**

Run: `npx vitest run lib/pipeline/convertMarkdown.test.ts lib/pipeline/splitScenes.test.ts lib/pipeline/analyzeSceneRelations.test.ts lib/pipeline/selectScreenTypes.test.ts lib/pipeline/reviewConsistency.test.ts lib/pipeline/summarizeDocument.test.ts`
Expected: PASS (all tests across all six files)

- [ ] **Step 5: Commit**

```bash
git add lib/pipeline/convertMarkdown.ts lib/pipeline/convertMarkdown.test.ts \
        lib/pipeline/splitScenes.ts lib/pipeline/splitScenes.test.ts \
        lib/pipeline/analyzeSceneRelations.ts lib/pipeline/analyzeSceneRelations.test.ts \
        lib/pipeline/selectScreenTypes.ts lib/pipeline/selectScreenTypes.test.ts \
        lib/pipeline/reviewConsistency.ts lib/pipeline/reviewConsistency.test.ts \
        lib/pipeline/summarizeDocument.ts lib/pipeline/summarizeDocument.test.ts
git commit -m "Switch pipeline LLM steps from DeepSeekClient/model to LlmClient/tier"
```

---

## Task 13: Update generateSceneImage to the generic ImageClient interface

**Files:**
- Modify: `lib/pipeline/generateSceneImage.ts`
- Modify: `lib/pipeline/generateSceneImage.test.ts`

- [ ] **Step 1: Update the test file first**

In `lib/pipeline/generateSceneImage.test.ts`, replace the imports:

```ts
// Before:
import { MockOpenAiImageClient } from "../ai/openaiImageClient.mock";
import { OpenAiImageApiError, type OpenAiImageClient, type OpenAiImageOptions } from "../ai/openaiImageClient";
// After:
import { MockImageClient } from "../ai/image/mockImageClient";
import { ImageApiError, type ImageClient, type ImageGenerateOptions } from "../ai/image/types";
```

Replace every `MockOpenAiImageClient` with `MockImageClient`, `OpenAiImageApiError` with `ImageApiError`, `OpenAiImageClient` with `ImageClient`, and `OpenAiImageOptions` with `ImageGenerateOptions` throughout the file (the `ScriptedImageClient implements OpenAiImageClient` class declaration and every `new OpenAiImageApiError(...)` call).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/pipeline/generateSceneImage.test.ts`
Expected: FAIL with "Cannot find module '../ai/openaiImageClient.mock'" (deleted in Task 4) / "Cannot find module '../ai/openaiImageClient'"

- [ ] **Step 3: Update the source file**

In `lib/pipeline/generateSceneImage.ts`, change the import line:

```ts
// Before:
import { OpenAiImageApiError, type OpenAiImageClient, type OpenAiImageOptions } from "../ai/openaiImageClient";
// After:
import { ImageApiError, type ImageClient, type ImageGenerateOptions } from "../ai/image/types";
```

Then replace every occurrence of `OpenAiImageClient` with `ImageClient`, `OpenAiImageOptions` with `ImageGenerateOptions`, and `OpenAiImageApiError` with `ImageApiError` in the rest of the file — specifically:
- `generateSceneImage(client: OpenAiImageClient, ...)` → `generateSceneImage(client: ImageClient, ...)`
- `clientOptions?: OpenAiImageOptions` → `clientOptions?: ImageGenerateOptions`
- `generateSceneImageWithRetry(client: OpenAiImageClient, ...)` → `generateSceneImageWithRetry(client: ImageClient, ...)`
- `export function isRateLimitError(err: unknown): boolean { return err instanceof OpenAiImageApiError && err.status === 429; }` → `return err instanceof ImageApiError && err.status === 429;`

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/pipeline/generateSceneImage.test.ts`
Expected: PASS (all tests)

- [ ] **Step 5: Commit**

```bash
git add lib/pipeline/generateSceneImage.ts lib/pipeline/generateSceneImage.test.ts
git commit -m "Switch generateSceneImage to the generic ImageClient interface"
```

---

## Task 14: Wire API routes to the new factories

**Files:**
- Modify: `app/api/projects/[projectId]/scenes/route.ts`
- Modify: `app/api/projects/[projectId]/scenes/analyze/route.ts`
- Modify: `app/api/projects/[projectId]/screen-design/route.ts`
- Modify: `app/api/projects/[projectId]/screen-design/[sceneId]/route.ts`
- Modify: `app/api/projects/[projectId]/markdown/route.ts`
- Modify: `app/api/projects/[projectId]/review/route.ts`
- Modify: `app/api/projects/[projectId]/images/route.ts`
- Modify: `app/api/projects/[projectId]/images/presenter-reference/generate/route.ts`
- Modify: `app/api/projects/[projectId]/images/background-reference/generate/route.ts`
- Modify: `app/api/projects/[projectId]/images/[sceneId]/route.ts`

No new test file — these routes have no dedicated unit tests today (verified by `grep -rl "createDeepSeekClient\|createOpenAiImageClient" app/`), and this is a pure call-site swap with an identical interface shape, so the existing pipeline-level tests (Tasks 12–13) already cover the logic these routes delegate to. Correctness here is verified by `npm run build` (Step 3) catching any type mismatch.

- [ ] **Step 1: Update the 6 LLM-consuming routes**

In each of `scenes/route.ts`, `scenes/analyze/route.ts`, `screen-design/route.ts`, `screen-design/[sceneId]/route.ts`, `review/route.ts`, replace:

```ts
import { createDeepSeekClient } from "@/lib/ai/deepseekClient";
```

with:

```ts
import { createLlmClient } from "@/lib/ai/llm/factory";
```

and replace every `createDeepSeekClient()` call with `createLlmClient()`.

In `markdown/route.ts`, which also imports the type name, replace:

```ts
import { createDeepSeekClient, type DeepSeekClient } from "@/lib/ai/deepseekClient";
```

with:

```ts
import { createLlmClient } from "@/lib/ai/llm/factory";
import type { LlmClient } from "@/lib/ai/llm/types";
```

and update the local variable declaration `let client: DeepSeekClient;` to `let client: LlmClient;`, and `client = createDeepSeekClient();` to `client = createLlmClient();`.

- [ ] **Step 2: Update the 4 image-consuming routes**

In each of `images/route.ts`, `images/presenter-reference/generate/route.ts`, `images/background-reference/generate/route.ts`, `images/[sceneId]/route.ts`, replace:

```ts
import { createOpenAiImageClient } from "@/lib/ai/openaiImageClient";
```

with:

```ts
import { createImageClient } from "@/lib/ai/image/factory";
```

and replace every `createOpenAiImageClient()` call with `createImageClient()`.

- [ ] **Step 3: Verify the whole project still type-checks and builds**

Run: `npm run build`
Expected: build succeeds with no TypeScript errors (this is the primary correctness check for this task, since the routes have no dedicated tests)

- [ ] **Step 4: Run the full test suite as a regression check**

Run: `npm test`
Expected: PASS — every test file in the repo passes

- [ ] **Step 5: Commit**

```bash
git add app/api/projects/\[projectId\]/scenes/route.ts \
        app/api/projects/\[projectId\]/scenes/analyze/route.ts \
        app/api/projects/\[projectId\]/screen-design/route.ts \
        "app/api/projects/[projectId]/screen-design/[sceneId]/route.ts" \
        app/api/projects/\[projectId\]/markdown/route.ts \
        app/api/projects/\[projectId\]/review/route.ts \
        app/api/projects/\[projectId\]/images/route.ts \
        "app/api/projects/[projectId]/images/presenter-reference/generate/route.ts" \
        "app/api/projects/[projectId]/images/background-reference/generate/route.ts" \
        "app/api/projects/[projectId]/images/[sceneId]/route.ts"
git commit -m "Wire API routes to createLlmClient()/createImageClient() factories"
```

---

## Task 15: Update .env.example and run final verification

**Files:**
- Modify: `.env.example`

- [ ] **Step 1: Rewrite `.env.example`**

```bash
# LLM
LLM_PROVIDER=deepseek        # deepseek | hchat-claude | hchat-chatgpt | hchat-gemini
DEEPSEEK_API_KEY=
DEEPSEEK_MODEL_ACCURATE=     # optional override, default deepseek-v4-pro
DEEPSEEK_MODEL_FAST=         # optional override, default deepseek-v4-flash

# Image
IMAGE_PROVIDER=openai        # openai | hchat-gemini
OPENAI_API_KEY=
OPENAI_IMAGE_MODEL=          # currently unused by the client (model is a fixed constant); reserved for a future override

# H-CHAT (internal gateway — shared by all hchat-* LLM and image providers)
HCHAT_KEY=
HCHAT_BASE_URL=                  # optional override, default https://internal-apigw-kr.hmg-corp.io/hchat-in/api/v3
HCHAT_CLAUDE_MODEL_ACCURATE=     # optional override, default claude-sonnet-5
HCHAT_CLAUDE_MODEL_FAST=         # optional override, default claude-haiku-4-5
HCHAT_CHATGPT_MODEL_ACCURATE=    # optional override, default gpt-5.6-terra
HCHAT_CHATGPT_MODEL_FAST=        # optional override, default gpt-5.6-luna
HCHAT_GEMINI_MODEL_ACCURATE=     # optional override, default gemini-3.6-flash
HCHAT_GEMINI_MODEL_FAST=         # optional override, default gemini-3.5-flash-lite
HCHAT_GEMINI_IMAGE_MODEL=        # optional override, default gemini-3.1-flash-image
```

Note: `OPENAI_IMAGE_MODEL` is listed for symmetry with the H-CHAT model override vars, but `lib/ai/image/openaiImageClient.ts` still uses the fixed `OPENAI_IMAGE_MODELS.default` constant (this was true before this refactor too — out of scope to change here). Leave the line as a documented no-op rather than silently dropping it, so a future task wiring it up has an obvious place to start.

- [ ] **Step 2: Run the full test suite**

Run: `npm test`
Expected: PASS — every test file passes (this exercises every new/changed file in Tasks 1–13)

- [ ] **Step 3: Run the linter**

Run: `npm run lint`
Expected: no errors

- [ ] **Step 4: Run the production build**

Run: `npm run build`
Expected: build succeeds (this catches any remaining reference to the deleted `lib/ai/deepseekClient.ts` / `lib/ai/openaiImageClient.ts` modules)

- [ ] **Step 5: Grep-verify no stray references to the deleted modules remain**

Run: `grep -rn "ai/deepseekClient\|ai/openaiImageClient" --include="*.ts" --include="*.tsx" app lib`
Expected: no output (empty)

- [ ] **Step 6: Commit**

```bash
git add .env.example
git commit -m "Document H-CHAT provider env vars in .env.example"
```
