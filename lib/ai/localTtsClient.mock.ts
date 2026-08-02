import type { TtsClient, TtsBatchItem, TtsOptions, TtsSceneResult } from "./localTtsClient";

// A minimal valid (silent, 1-sample) WAV file, so tests exercise real Buffer plumbing without invoking Python.
const FAKE_WAV = Buffer.from(
  "UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=",
  "base64"
);

export class MockLocalTtsClient implements TtsClient {
  public calls: Array<{ items: TtsBatchItem[]; options?: TtsOptions }> = [];

  constructor(private readonly audioBuffer: Buffer = FAKE_WAV) {}

  async synthesizeBatch(
    items: TtsBatchItem[],
    options: TtsOptions & { onScene?: (result: TtsSceneResult) => void | Promise<void> }
  ): Promise<void> {
    this.calls.push({ items, options });
    for (const item of items) {
      if (options.signal?.aborted) throw new DOMException("Aborted", "AbortError");
      await options.onScene?.({ sceneId: item.sceneId, audio: this.audioBuffer });
    }
  }
}
