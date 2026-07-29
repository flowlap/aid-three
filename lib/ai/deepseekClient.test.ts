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
});
