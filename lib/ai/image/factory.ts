import type { ImageClient } from "./types";
import { createOpenAiImageClient } from "./openaiImageClient";
import { createHChatGeminiImageClient } from "./hchatGeminiImageClient";

export type ImageProviderType = "openai" | "hchat-gemini";

export function getImageProviderType(): ImageProviderType {
  return (process.env.IMAGE_PROVIDER || "openai") as ImageProviderType;
}

export function createImageClient(options?: { hchatGeminiModel?: string }): ImageClient {
  const provider = getImageProviderType();
  switch (provider) {
    case "openai":
      return createOpenAiImageClient();
    case "hchat-gemini":
      return createHChatGeminiImageClient(options?.hchatGeminiModel);
    default:
      throw new Error(`알 수 없는 IMAGE_PROVIDER 값입니다: ${provider}`);
  }
}
