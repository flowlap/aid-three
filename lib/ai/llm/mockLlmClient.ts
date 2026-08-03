import type { ChatMessage, LlmClient, LlmCompleteOptions } from "./types";

export class MockLlmClient implements LlmClient {
  public calls: Array<{ messages: ChatMessage[]; options?: LlmCompleteOptions }> = [];
  private callIndex = 0;

  constructor(private readonly responses: string[]) {}

  async complete(messages: ChatMessage[], options?: LlmCompleteOptions): Promise<string> {
    this.calls.push({ messages, options });
    if (options?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const response = this.responses[this.callIndex] ?? this.responses[this.responses.length - 1];
    this.callIndex += 1;
    return response;
  }

  async completeStream(
    messages: ChatMessage[],
    options?: LlmCompleteOptions
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
