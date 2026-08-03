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
