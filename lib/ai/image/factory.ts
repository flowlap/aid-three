import type { ImageClient } from "./types";
import { createOpenAiImageClient } from "./openaiImageClient";
import { createHChatGeminiImageClient } from "./hchatGeminiImageClient";

export type ImageProviderType = "openai" | "hchat-gemini";

export function createImageClient(): ImageClient {
  const provider = (process.env.IMAGE_PROVIDER || "openai") as ImageProviderType;
  switch (provider) {
    case "openai":
      return createOpenAiImageClient();
    case "hchat-gemini":
      return createHChatGeminiImageClient();
    default:
      throw new Error(`알 수 없는 IMAGE_PROVIDER 값입니다: ${provider}`);
  }
}
