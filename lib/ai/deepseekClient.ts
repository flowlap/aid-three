export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface DeepSeekCompleteOptions {
  model?: string;
  jsonMode?: boolean;
  signal?: AbortSignal;
}

export interface DeepSeekClient {
  complete(messages: ChatMessage[], options?: DeepSeekCompleteOptions): Promise<string>;
  /**
   * Resolves once the connection to DeepSeek is established and the request
   * was accepted (so callers can surface connection/auth errors immediately),
   * yielding response text chunks as they stream in.
   */
  completeStream(
    messages: ChatMessage[],
    options?: DeepSeekCompleteOptions
  ): Promise<AsyncIterable<string>>;
}

export const DEEPSEEK_MODELS = {
  pro: "deepseek-v4-pro",
  flash: "deepseek-v4-flash",
} as const;

const DEFAULT_MODEL: string = DEEPSEEK_MODELS.pro;
const BASE_URL = "https://api.deepseek.com";

async function* parseSSEStream(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const data = trimmed.slice("data:".length).trim();
      if (data === "[DONE]") return;

      const parsed = JSON.parse(data) as {
        choices: Array<{ delta?: { content?: string } }>;
      };
      const delta = parsed.choices[0]?.delta?.content;
      if (delta) yield delta;
    }
  }
}

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
      signal: options?.signal,
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

  async completeStream(
    messages: ChatMessage[],
    options?: DeepSeekCompleteOptions
  ): Promise<AsyncIterable<string>> {
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
        stream: true,
      }),
      signal: options?.signal,
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`DeepSeek API error (${response.status}): ${body}`);
    }

    return parseSSEStream(response.body!);
  }
}

export function createDeepSeekClient(): DeepSeekClient {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    throw new Error("DEEPSEEK_API_KEY 환경변수가 설정되지 않았습니다");
  }
  return new RealDeepSeekClient(apiKey);
}
