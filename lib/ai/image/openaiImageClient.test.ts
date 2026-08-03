import { describe, it, expect, vi, afterEach } from "vitest";
import { RealOpenAiImageClient } from "./openaiImageClient";
import { ImageApiError } from "./types";

describe("RealOpenAiImageClient", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts to /images/generations with the prompt when there are no reference images", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ b64_json: Buffer.from([1, 2, 3]).toString("base64") }] }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const client = new RealOpenAiImageClient("test-key");

    const buffer = await client.generateImage("a prompt");

    expect(buffer).toEqual(Buffer.from([1, 2, 3]));
    expect(fetchMock.mock.calls[0][0]).toContain("/images/generations");
    const requestBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(requestBody.prompt).toBe("a prompt");
    expect(requestBody.model).toBe("gpt-image-2");
  });

  it("posts to /images/edits with multipart form data when reference images are given", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ b64_json: Buffer.from([4, 5, 6]).toString("base64") }] }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const client = new RealOpenAiImageClient("test-key");

    const buffer = await client.generateImage("a prompt", { referenceImages: [Buffer.from("bg")] });

    expect(buffer).toEqual(Buffer.from([4, 5, 6]));
    expect(fetchMock.mock.calls[0][0]).toContain("/images/edits");
    expect(fetchMock.mock.calls[0][1].body).toBeInstanceOf(FormData);
  });

  it("downloads the image when the response has a url instead of b64_json", async () => {
    const imageBytes = Buffer.from([7, 8, 9]);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [{ url: "https://example.test/img.png" }] }) })
      .mockResolvedValueOnce({ ok: true, arrayBuffer: async () => imageBytes.buffer.slice(imageBytes.byteOffset, imageBytes.byteOffset + imageBytes.byteLength) });
    vi.stubGlobal("fetch", fetchMock);
    const client = new RealOpenAiImageClient("test-key");

    const buffer = await client.generateImage("a prompt");

    expect(buffer).toEqual(imageBytes);
  });

  it("throws an ImageApiError with the HTTP status on a non-ok response", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 429, text: async () => "rate limited" });
    vi.stubGlobal("fetch", fetchMock);
    const client = new RealOpenAiImageClient("test-key");

    const err = await client.generateImage("a prompt").catch((e) => e);

    expect(err).toBeInstanceOf(ImageApiError);
    expect((err as ImageApiError).status).toBe(429);
  });

  it("forwards the abort signal into fetch() when generating from scratch", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ b64_json: Buffer.from([1, 2, 3]).toString("base64") }] }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const client = new RealOpenAiImageClient("test-key");
    const controller = new AbortController();

    await client.generateImage("a prompt", { signal: controller.signal });

    expect(fetchMock.mock.calls[0][1]).toMatchObject({ signal: controller.signal });
  });

  it("forwards the abort signal into fetch() when editing with reference images", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ b64_json: Buffer.from([4, 5, 6]).toString("base64") }] }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const client = new RealOpenAiImageClient("test-key");
    const controller = new AbortController();

    await client.generateImage("a prompt", { referenceImages: [Buffer.from("bg")], signal: controller.signal });

    expect(fetchMock.mock.calls[0][1]).toMatchObject({ signal: controller.signal });
  });
});
