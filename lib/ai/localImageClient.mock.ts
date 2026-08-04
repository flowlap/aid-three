import type { LocalImageClient, LocalImageBatchItem, LocalImageOptions, LocalImageSceneResult } from "./localImageClient";

// A minimal valid (1x1 transparent) PNG, so tests exercise real Buffer plumbing without invoking Python.
const FAKE_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64"
);

export class MockLocalImageClient implements LocalImageClient {
  public calls: Array<{ items: LocalImageBatchItem[]; options: LocalImageOptions }> = [];

  constructor(private readonly imageBuffer: Buffer = FAKE_PNG) {}

  async generateBatch(
    items: LocalImageBatchItem[],
    options: LocalImageOptions & { onScene?: (result: LocalImageSceneResult) => void | Promise<void> }
  ): Promise<void> {
    this.calls.push({ items, options });
    for (const item of items) {
      if (options.signal?.aborted) throw new DOMException("Aborted", "AbortError");
      await options.onScene?.({ sceneId: item.sceneId, image: this.imageBuffer });
    }
  }
}
