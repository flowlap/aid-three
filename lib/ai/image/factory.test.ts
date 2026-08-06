import { describe, it, expect, afterEach, vi } from "vitest";
import { createImageClient, getImageProviderType } from "./factory";
import { RealOpenAiImageClient } from "./openaiImageClient";
import { RealHChatGeminiImageClient } from "./hchatGeminiImageClient";

describe("getImageProviderType", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("defaults to openai when IMAGE_PROVIDER is unset", () => {
    expect(getImageProviderType()).toBe("openai");
  });

  it("reflects the IMAGE_PROVIDER env var when set", () => {
    vi.stubEnv("IMAGE_PROVIDER", "hchat-gemini");
    expect(getImageProviderType()).toBe("hchat-gemini");
  });
});

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

  it("passes a per-project hchatGeminiModel override through to the Gemini client", () => {
    vi.stubEnv("IMAGE_PROVIDER", "hchat-gemini");
    vi.stubEnv("HCHAT_KEY", "test-key");

    const client = createImageClient({ hchatGeminiModel: "gemini-3-pro-image" });
    expect(client).toBeInstanceOf(RealHChatGeminiImageClient);
    expect((client as unknown as { model: string }).model).toBe("gemini-3-pro-image");
  });

  it("ignores the hchatGeminiModel option when the provider is openai", () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");

    expect(createImageClient({ hchatGeminiModel: "gemini-3-pro-image" })).toBeInstanceOf(RealOpenAiImageClient);
  });
});
