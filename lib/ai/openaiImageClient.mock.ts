import type { OpenAiImageClient, OpenAiImageOptions } from "./openaiImageClient";

// A minimal valid 1x1 PNG, so tests exercise real Buffer plumbing without a network call.
const FAKE_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
);

export class MockOpenAiImageClient implements OpenAiImageClient {
  public calls: Array<{ prompt: string; options?: OpenAiImageOptions }> = [];

  constructor(private readonly imageBuffer: Buffer = FAKE_PNG) {}

  async generateImage(prompt: string, options?: OpenAiImageOptions): Promise<Buffer> {
    this.calls.push({ prompt, options });
    if (options?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    return this.imageBuffer;
  }
}
