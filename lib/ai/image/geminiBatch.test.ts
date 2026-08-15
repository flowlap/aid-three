import { describe, it, expect } from "vitest";
import { buildBatchRequestLine, buildBatchRequestJsonl, parseBatchResultsJsonl, resolveBatchResultsJsonl } from "./geminiBatch";

describe("buildBatchRequestLine", () => {
  it("includes the key and prompt text with no reference images", () => {
    const line = buildBatchRequestLine({ key: "scene-001", prompt: "그림을 그려주세요" });
    const parsed = JSON.parse(line);
    expect(parsed.key).toBe("scene-001");
    expect(parsed.request.contents[0].parts).toEqual([{ text: "그림을 그려주세요" }]);
    expect(parsed.request.generation_config.responseModalities).toEqual(["TEXT", "IMAGE"]);
  });

  it("puts reference images before the prompt text, base64-encoded", () => {
    const ref = Buffer.from("fake-png-bytes");
    const line = buildBatchRequestLine({ key: "scene-002", prompt: "설명", referenceImages: [ref] });
    const parsed = JSON.parse(line);
    expect(parsed.request.contents[0].parts).toEqual([
      { inline_data: { mime_type: "image/png", data: ref.toString("base64") } },
      { text: "설명" },
    ]);
  });

  it("drops empty-buffer reference images", () => {
    const line = buildBatchRequestLine({ key: "scene-003", prompt: "설명", referenceImages: [Buffer.alloc(0)] });
    const parsed = JSON.parse(line);
    expect(parsed.request.contents[0].parts).toEqual([{ text: "설명" }]);
  });
});

describe("buildBatchRequestJsonl", () => {
  it("joins one line per item with newlines, each independently parseable", () => {
    const jsonl = buildBatchRequestJsonl([
      { key: "scene-001", prompt: "첫번째" },
      { key: "scene-002", prompt: "두번째" },
    ]);
    const lines = jsonl.split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).key).toBe("scene-001");
    expect(JSON.parse(lines[1]).key).toBe("scene-002");
  });

  it("returns an empty string for no items", () => {
    expect(buildBatchRequestJsonl([])).toBe("");
  });
});

describe("parseBatchResultsJsonl", () => {
  it("extracts an image buffer per key from a successful result line", () => {
    const b64 = Buffer.from("image-bytes").toString("base64");
    const jsonl = JSON.stringify({
      key: "scene-001",
      response: { candidates: [{ content: { parts: [{ inlineData: { data: b64 } }] } }] },
    });
    const results = parseBatchResultsJsonl(jsonl);
    const entry = results.get("scene-001");
    expect(entry?.ok).toBe(true);
    expect(entry && entry.ok && entry.buffer.toString()).toBe("image-bytes");
  });

  it("also accepts the key nested under metadata.key", () => {
    const b64 = Buffer.from("image-bytes").toString("base64");
    const jsonl = JSON.stringify({
      metadata: { key: "scene-002" },
      response: { candidates: [{ content: { parts: [{ inline_data: { data: b64 } }] } }] },
    });
    const results = parseBatchResultsJsonl(jsonl);
    expect(results.get("scene-002")?.ok).toBe(true);
  });

  it("records a per-key error for a line with an error field", () => {
    const jsonl = JSON.stringify({ key: "scene-003", error: { message: "quota exceeded", code: 429 } });
    const results = parseBatchResultsJsonl(jsonl);
    const entry = results.get("scene-003");
    expect(entry).toEqual({ key: "scene-003", ok: false, message: "quota exceeded" });
  });

  it("records an error when a successful-looking line has no image data", () => {
    const jsonl = JSON.stringify({ key: "scene-004", response: { candidates: [{ content: { parts: [] } }] } });
    const results = parseBatchResultsJsonl(jsonl);
    expect(results.get("scene-004")).toEqual({ key: "scene-004", ok: false, message: "배치 응답에 이미지 데이터가 없습니다" });
  });

  it("parses multiple lines and skips blank/malformed ones", () => {
    const b64 = Buffer.from("x").toString("base64");
    const good = JSON.stringify({ key: "scene-005", response: { candidates: [{ content: { parts: [{ inlineData: { data: b64 } }] } }] } });
    const jsonl = ["", good, "not json", "  "].join("\n");
    const results = parseBatchResultsJsonl(jsonl);
    expect(results.size).toBe(1);
    expect(results.get("scene-005")?.ok).toBe(true);
  });

  it("skips a line with no key at all", () => {
    const jsonl = JSON.stringify({ response: {} });
    const results = parseBatchResultsJsonl(jsonl);
    expect(results.size).toBe(0);
  });
});

describe("resolveBatchResultsJsonl", () => {
  it("returns the inlined string as-is when there's no responsesFileName", async () => {
    const jsonl = await resolveBatchResultsJsonl({ state: "JOB_STATE_SUCCEEDED", inlinedResponsesRaw: "hello" }, "fake-key");
    expect(jsonl).toBe("hello");
  });

  it("throws when neither responsesFileName nor a string inlinedResponsesRaw is present", async () => {
    await expect(resolveBatchResultsJsonl({ state: "JOB_STATE_SUCCEEDED" }, "fake-key")).rejects.toThrow(
      /지원하지 않습니다/
    );
  });

  it("throws when inlinedResponsesRaw is present but not a string", async () => {
    await expect(
      resolveBatchResultsJsonl({ state: "JOB_STATE_SUCCEEDED", inlinedResponsesRaw: { not: "a string" } }, "fake-key")
    ).rejects.toThrow(/지원하지 않습니다/);
  });
});
