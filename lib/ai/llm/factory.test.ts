import { describe, it, expect, afterEach, vi } from "vitest";
import { createLlmClient } from "./factory";
import { RealDeepSeekClient } from "./deepseekClient";
import { RealHChatClaudeClient } from "./hchatClaudeClient";
import { RealHChatChatGptClient } from "./hchatChatGptClient";
import { RealHChatGeminiClient } from "./hchatGeminiClient";

describe("createLlmClient", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("defaults to deepseek when LLM_PROVIDER is unset", () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "test-key");

    expect(createLlmClient()).toBeInstanceOf(RealDeepSeekClient);
  });

  it("returns a Claude client for hchat-claude", () => {
    vi.stubEnv("LLM_PROVIDER", "hchat-claude");
    vi.stubEnv("HCHAT_KEY", "test-key");

    expect(createLlmClient()).toBeInstanceOf(RealHChatClaudeClient);
  });

  it("returns a ChatGPT client for hchat-chatgpt", () => {
    vi.stubEnv("LLM_PROVIDER", "hchat-chatgpt");
    vi.stubEnv("HCHAT_KEY", "test-key");

    expect(createLlmClient()).toBeInstanceOf(RealHChatChatGptClient);
  });

  it("returns a Gemini client for hchat-gemini", () => {
    vi.stubEnv("LLM_PROVIDER", "hchat-gemini");
    vi.stubEnv("HCHAT_KEY", "test-key");

    expect(createLlmClient()).toBeInstanceOf(RealHChatGeminiClient);
  });

  it("throws for an unknown provider", () => {
    vi.stubEnv("LLM_PROVIDER", "unknown-provider");

    expect(() => createLlmClient()).toThrow(/알 수 없는 LLM_PROVIDER/);
  });

  it("throws when deepseek is selected but DEEPSEEK_API_KEY is missing", () => {
    vi.stubEnv("LLM_PROVIDER", "deepseek");

    expect(() => createLlmClient()).toThrow(/DEEPSEEK_API_KEY/);
  });

  it("throws when an hchat provider is selected but HCHAT_KEY is missing", () => {
    vi.stubEnv("LLM_PROVIDER", "hchat-claude");

    expect(() => createLlmClient()).toThrow(/HCHAT_KEY/);
  });
});
