import type { LlmClient } from "./types";
import { createDeepSeekClient } from "./deepseekClient";
import { createHChatClaudeClient } from "./hchatClaudeClient";
import { createHChatChatGptClient } from "./hchatChatGptClient";
import { createHChatGeminiClient } from "./hchatGeminiClient";

export type LlmProviderType = "deepseek" | "hchat-claude" | "hchat-chatgpt" | "hchat-gemini";

export function createLlmClient(): LlmClient {
  const provider = (process.env.LLM_PROVIDER || "deepseek") as LlmProviderType;
  switch (provider) {
    case "deepseek":
      return createDeepSeekClient();
    case "hchat-claude":
      return createHChatClaudeClient();
    case "hchat-chatgpt":
      return createHChatChatGptClient();
    case "hchat-gemini":
      return createHChatGeminiClient();
    default:
      throw new Error(`알 수 없는 LLM_PROVIDER 값입니다: ${provider}`);
  }
}
