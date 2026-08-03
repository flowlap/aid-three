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
