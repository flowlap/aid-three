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

  it("forwards the abort signal into fetch()", async () => {
    vi.stubEnv("HCHAT_KEY", "test-hchat-key");
    const fetchMock = mockFetchOk({ candidates: [{ content: { parts: [{ text: "응답" }] } }] });
    const client = new RealHChatGeminiClient();
    const controller = new AbortController();

    await client.complete([{ role: "user", content: "질문" }], { signal: controller.signal });

    expect(fetchMock.mock.calls[0][1]).toMatchObject({ signal: controller.signal });
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

  it("completeStream forwards the abort signal into fetch()", async () => {
    vi.stubEnv("HCHAT_KEY", "test-hchat-key");
    const fetchMock = mockFetchOk({ candidates: [{ content: { parts: [{ text: "응답" }] } }] });
    const client = new RealHChatGeminiClient();
    const controller = new AbortController();

    await client.completeStream([{ role: "user", content: "질문" }], { signal: controller.signal });

    expect(fetchMock.mock.calls[0][1]).toMatchObject({ signal: controller.signal });
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
