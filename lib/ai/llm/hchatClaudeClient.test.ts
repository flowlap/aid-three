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

  it("forwards the abort signal into fetch() for complete()", async () => {
    vi.stubEnv("HCHAT_KEY", "test-hchat-key");
    const fetchMock = mockFetchOk({ content: [{ text: "응답" }] });
    const client = new RealHChatClaudeClient();
    const controller = new AbortController();

    await client.complete([{ role: "user", content: "질문" }], { signal: controller.signal });

    expect(fetchMock.mock.calls[0][1]).toMatchObject({ signal: controller.signal });
  });

  it("forwards the abort signal into fetch() for completeStream()", async () => {
    vi.stubEnv("HCHAT_KEY", "test-hchat-key");
    const fetchMock = mockFetchOk({});
    const client = new RealHChatClaudeClient();
    const controller = new AbortController();

    await client.completeStream([{ role: "user", content: "질문" }], { signal: controller.signal });

    expect(fetchMock.mock.calls[0][1]).toMatchObject({ signal: controller.signal });
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

  it("sends tools/tool_choice and skips the JSON-mode instruction when jsonSchema is set", async () => {
    vi.stubEnv("HCHAT_KEY", "test-hchat-key");
    const fetchMock = mockFetchOk({ content: [{ type: "tool_use", id: "toolu_1", name: "emit_plan", input: { ok: true } }] });
    const client = new RealHChatClaudeClient();

    await client.complete([{ role: "user", content: "질문" }], {
      jsonMode: true,
      jsonSchema: { name: "emit_plan", description: "설명", schema: { type: "object" } },
    });

    const requestBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(requestBody.tools).toEqual([{ name: "emit_plan", description: "설명", input_schema: { type: "object" } }]);
    expect(requestBody.tool_choice).toEqual({ type: "tool", name: "emit_plan" });
    expect(requestBody.system).toBeUndefined();
  });

  it("returns the tool_use block's input as a JSON string from complete()", async () => {
    vi.stubEnv("HCHAT_KEY", "test-hchat-key");
    mockFetchOk({ content: [{ type: "tool_use", id: "toolu_1", name: "emit_plan", input: { sequences: [] } }] });
    const client = new RealHChatClaudeClient();

    const result = await client.complete([{ role: "user", content: "질문" }], {
      jsonSchema: { name: "emit_plan", schema: { type: "object" } },
    });

    expect(JSON.parse(result)).toEqual({ sequences: [] });
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

  it("streams input_json_delta chunks (tool-use) and concatenates them into valid JSON", async () => {
    vi.stubEnv("HCHAT_KEY", "test-hchat-key");
    const sseBody =
      `data: ${JSON.stringify({ type: "content_block_start", content_block: { type: "tool_use", id: "toolu_1", name: "emit_plan" } })}\n\n` +
      `data: ${JSON.stringify({ type: "content_block_delta", delta: { type: "input_json_delta", partial_json: '{"sequences"' } })}\n\n` +
      `data: ${JSON.stringify({ type: "content_block_delta", delta: { type: "input_json_delta", partial_json: ":[]}" } })}\n\n` +
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

    const iterable = await client.completeStream([{ role: "user", content: "질문" }], {
      jsonSchema: { name: "emit_plan", schema: { type: "object" } },
    });
    const chunks: string[] = [];
    for await (const chunk of iterable) chunks.push(chunk);

    expect(JSON.parse(chunks.join(""))).toEqual({ sequences: [] });
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

  it("throws when the stream emits an Anthropic error event", async () => {
    vi.stubEnv("HCHAT_KEY", "test-hchat-key");
    const sseBody = `data: ${JSON.stringify({ type: "error", error: { type: "overloaded_error", message: "Overloaded" } })}\n\n`;
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
    await expect(
      (async () => {
        for await (const _chunk of iterable) {
          /* drain */
        }
      })()
    ).rejects.toThrow(/Overloaded/);
  });
});
