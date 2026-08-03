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

  it("forwards the abort signal into fetch()", async () => {
    vi.stubEnv("HCHAT_KEY", "test-hchat-key");
    const imageBytes = Buffer.from([1, 2, 3]);
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => geminiImageRawText(imageBytes.toString("base64")) });
    vi.stubGlobal("fetch", fetchMock);
    const client = new RealHChatGeminiImageClient();
    const controller = new AbortController();

    await client.generateImage("a prompt", { signal: controller.signal });

    expect(fetchMock.mock.calls[0][1]).toMatchObject({ signal: controller.signal });
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
