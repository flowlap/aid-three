import { describe, it, expect, vi, afterEach } from "vitest";
import { MockDeepSeekClient } from "./deepseekClient.mock";
import { RealDeepSeekClient } from "./deepseekClient";

describe("MockDeepSeekClient", () => {
  it("returns queued responses in order", async () => {
    const client = new MockDeepSeekClient(["첫 응답", "두번째 응답"]);

    const first = await client.complete([{ role: "user", content: "a" }]);
    const second = await client.complete([{ role: "user", content: "b" }]);

    expect(first).toBe("첫 응답");
    expect(second).toBe("두번째 응답");
  });

  it("repeats the last response once queue is exhausted", async () => {
    const client = new MockDeepSeekClient(["유일한 응답"]);

    await client.complete([{ role: "user", content: "a" }]);
    const second = await client.complete([{ role: "user", content: "b" }]);

    expect(second).toBe("유일한 응답");
  });

  it("records call messages and options for assertions", async () => {
    const client = new MockDeepSeekClient(["응답"]);

    await client.complete([{ role: "user", content: "질문" }], { jsonMode: true });

    expect(client.calls).toHaveLength(1);
    expect(client.calls[0].messages[0].content).toBe("질문");
    expect(client.calls[0].options?.jsonMode).toBe(true);
  });

  it("rejects complete() when the signal is already aborted", async () => {
    const client = new MockDeepSeekClient(["응답"]);
    const controller = new AbortController();
    controller.abort();

    await expect(
      client.complete([{ role: "user", content: "a" }], { signal: controller.signal })
    ).rejects.toThrow();
  });

  it("rejects completeStream() when the signal is already aborted", async () => {
    const client = new MockDeepSeekClient(["응답"]);
    const controller = new AbortController();
    controller.abort();

    await expect(
      client.completeStream([{ role: "user", content: "a" }], { signal: controller.signal })
    ).rejects.toThrow();
  });
});

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

  it("forwards the abort signal into fetch() for completeStream()", async () => {
    const fetchMock = mockFetchOk({});
    const client = new RealDeepSeekClient("test-key");
    const controller = new AbortController();

    await client.completeStream([{ role: "user", content: "a" }], { signal: controller.signal });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ signal: controller.signal });
  });

  it("forwards the requested model into fetch()", async () => {
    const fetchMock = mockFetchOk({ choices: [{ message: { content: "응답" } }] });
    const client = new RealDeepSeekClient("test-key");

    await client.complete([{ role: "user", content: "a" }], { model: "deepseek-v4-flash" });

    const requestBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(requestBody.model).toBe("deepseek-v4-flash");
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
