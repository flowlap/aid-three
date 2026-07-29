import type { ChatMessage, DeepSeekClient, DeepSeekCompleteOptions } from "./deepseekClient";

export class MockDeepSeekClient implements DeepSeekClient {
  public calls: Array<{ messages: ChatMessage[]; options?: DeepSeekCompleteOptions }> = [];
  private callIndex = 0;

  constructor(private readonly responses: string[]) {}

  async complete(messages: ChatMessage[], options?: DeepSeekCompleteOptions): Promise<string> {
    this.calls.push({ messages, options });
    if (options?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const response = this.responses[this.callIndex] ?? this.responses[this.responses.length - 1];
    this.callIndex += 1;
    return response;
  }

  async completeStream(
    messages: ChatMessage[],
    options?: DeepSeekCompleteOptions
  ): Promise<AsyncIterable<string>> {
    this.calls.push({ messages, options });
    if (options?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const response = this.responses[this.callIndex] ?? this.responses[this.responses.length - 1];
    this.callIndex += 1;
    return (async function* () {
      const chunkSize = 5;
      for (let i = 0; i < response.length; i += chunkSize) {
        yield response.slice(i, i + chunkSize);
      }
    })();
  }
}
