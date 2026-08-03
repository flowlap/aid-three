export interface ImageGenerateOptions {
  quality?: "low" | "medium" | "high";
  size?: string;
  signal?: AbortSignal;
  /**
   * Reference images (e.g. a fixed background and/or presenter photo) to
   * condition generation on. When non-empty, generateImage should produce
   * the new image *from* these references rather than from the prompt alone.
   */
  referenceImages?: Buffer[];
}

/** Thrown for a non-ok image API response, with the HTTP status attached so callers can tell a rate limit (429) apart from other failures without parsing the message text. */
export class ImageApiError extends Error {
  constructor(
    public readonly status: number,
    body: string
  ) {
    super(`이미지 생성 API 오류 (${status}): ${body}`);
    this.name = "ImageApiError";
  }
}

export interface ImageClient {
  generateImage(prompt: string, options?: ImageGenerateOptions): Promise<Buffer>;
}
