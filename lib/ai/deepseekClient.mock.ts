import type { ChatMessage, DeepSeekClient, DeepSeekCompleteOptions } from "./deepseekClient";

export class MockDeepSeekClient implements DeepSeekClient {
  public calls: Array<{ messages: ChatMessage[]; options?: DeepSeekCompleteOptions }> = [];
  private callIndex = 0;

  constructor(private readonly responses: string[]) {}

  async complete(messages: ChatMessage[], options?: DeepSeekCompleteOptions): Promise<string> {
    this.calls.push({ messages, options });
    const response = this.responses[this.callIndex] ?? this.responses[this.responses.length - 1];
    this.callIndex += 1;
    return response;
  }
}
