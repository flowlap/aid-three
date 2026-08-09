import { describe, it, expect, vi, afterEach } from "vitest";
import { RealDeepSeekClient, StreamIdleTimeoutError } from "./deepseekClient";

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

  it("aborts a stream that goes silent past the idle timeout instead of hanging forever", async () => {
    let cancelled = false;
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      // A body that opens but never enqueues and never closes — this is the
      // real bug's shape: the connection is alive but no bytes ever arrive.
      body: new ReadableStream({
        start() {
          /* deliberately never enqueue, never close */
        },
        cancel() {
          cancelled = true;
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    // 20ms idle window so the test resolves quickly.
    const client = new RealDeepSeekClient("test-key", undefined, 20);

    const iterable = await client.completeStream([{ role: "user", content: "a" }]);
    await expect(
      (async () => {
        for await (const _chunk of iterable) void _chunk;
      })()
    ).rejects.toBeInstanceOf(StreamIdleTimeoutError);
    // The hung upstream connection must actually be released, not leaked.
    expect(cancelled).toBe(true);
  });

  it("does not time out while bytes keep arriving within the idle window", async () => {
    const encoder = new TextEncoder();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      body: new ReadableStream({
        async start(controller) {
          // Two chunks ~10ms apart, comfortably inside a 200ms idle window,
          // then close cleanly — must complete without a timeout.
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: "가" } }] })}\n\n`)
          );
          await new Promise((r) => setTimeout(r, 10));
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: "나" } }] })}\n\n`)
          );
          controller.close();
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const client = new RealDeepSeekClient("test-key", undefined, 200);

    const iterable = await client.completeStream([{ role: "user", content: "a" }]);
    const received: string[] = [];
    for await (const chunk of iterable) received.push(chunk);

    expect(received.join("")).toBe("가나");
  });
});
