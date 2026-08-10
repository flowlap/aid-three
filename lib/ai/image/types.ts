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

/**
 * Thrown when a provider responds 200 OK but the body has no usable image
 * data (e.g. Vertex/Gemini returning an empty candidate with
 * finishReason: "STOP" instead of a proper 429 — observed in
 * hchatGeminiImageClient.ts when several image calls burst at once and the
 * per-minute quota is hit; retrying later succeeds). A distinct type from a
 * plain Error so callers (see generateSceneImage.ts's isRateLimitError) can
 * apply the more lenient rate-limit retry policy to it instead of the
 * generic one, even though no HTTP status code signaled the throttle.
 */
export class NoImageDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NoImageDataError";
  }
}

export interface ImageClient {
  generateImage(prompt: string, options?: ImageGenerateOptions): Promise<Buffer>;
}
