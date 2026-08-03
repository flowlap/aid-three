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

  it("forwards the abort signal into fetch() for complete()", async () => {
    vi.stubEnv("HCHAT_KEY", "test-hchat-key");
    const fetchMock = mockFetchOk({ choices: [{ message: { content: "응답" } }] });
    const client = new RealHChatChatGptClient();
    const controller = new AbortController();

    await client.complete([{ role: "user", content: "질문" }], { signal: controller.signal });

    expect(fetchMock.mock.calls[0][1]).toMatchObject({ signal: controller.signal });
  });

  it("forwards the abort signal into fetch() for completeStream()", async () => {
    vi.stubEnv("HCHAT_KEY", "test-hchat-key");
    const fetchMock = mockFetchOk({});
    const client = new RealHChatChatGptClient();
    const controller = new AbortController();

    await client.completeStream([{ role: "user", content: "질문" }], { signal: controller.signal });

    expect(fetchMock.mock.calls[0][1]).toMatchObject({ signal: controller.signal });
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
