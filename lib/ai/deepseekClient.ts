export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface DeepSeekCompleteOptions {
  model?: string;
  jsonMode?: boolean;
}

export interface DeepSeekClient {
  complete(messages: ChatMessage[], options?: DeepSeekCompleteOptions): Promise<string>;
}

const DEFAULT_MODEL = "deepseek-v4-pro";
const BASE_URL = "https://api.deepseek.com";

export class RealDeepSeekClient implements DeepSeekClient {
  constructor(private readonly apiKey: string) {}

  async complete(messages: ChatMessage[], options?: DeepSeekCompleteOptions): Promise<string> {
    const response = await fetch(`${BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: options?.model ?? DEFAULT_MODEL,
        messages,
        response_format: options?.jsonMode ? { type: "json_object" } : undefined,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`DeepSeek API error (${response.status}): ${body}`);
    }

    const data = (await response.json()) as {
      choices: Array<{ message: { content: string } }>;
    };
    return data.choices[0].message.content;
  }
}

export function createDeepSeekClient(): DeepSeekClient {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    throw new Error("DEEPSEEK_API_KEY 환경변수가 설정되지 않았습니다");
  }
  return new RealDeepSeekClient(apiKey);
}
