import { describe, it, expect, vi, afterEach } from "vitest";
import { RealFalImageClient } from "./falImageClient";
import { ImageApiError } from "./types";

/** Builds a fetch mock that walks the fal queue flow: submit → status → result → image download. */
function mockFalFlow(imageBytes: number[], statusSequence: string[] = ["COMPLETED"]) {
  const fetchMock = vi.fn();
  // submit
  fetchMock.mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      status_url: "https://queue.fal.run/req/status",
      response_url: "https://queue.fal.run/req",
    }),
  });
  // one status poll per entry
  for (const status of statusSequence) {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ status }) });
  }
  // result
  fetchMock.mockResolvedValueOnce({
    ok: true,
    json: async () => ({ images: [{ url: "https://fal.media/out.png" }] }),
  });
  // image download
  fetchMock.mockResolvedValueOnce({
    ok: true,
    arrayBuffer: async () => new Uint8Array(imageBytes).buffer,
  });
  return fetchMock;
}

describe("RealFalImageClient", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("submits to the queue with Key auth + image_size, then downloads the result URL", async () => {
    const fetchMock = mockFalFlow([1, 2, 3]);
    vi.stubGlobal("fetch", fetchMock);
    const client = new RealFalImageClient("test-key");

    const buffer = await client.generateImage("a prompt", { size: "1536x1024" });

    expect(buffer).toEqual(Buffer.from([1, 2, 3]));
    // submit call
    const [submitUrl, submitInit] = fetchMock.mock.calls[0];
    expect(submitUrl).toBe("https://queue.fal.run/fal-ai/flux/schnell");
    expect(submitInit.headers.Authorization).toBe("Key test-key");
    const body = JSON.parse(submitInit.body);
    expect(body.prompt).toBe("a prompt");
    expect(body.image_size).toEqual({ width: 1536, height: 1024 });
    // last two calls are result + image download
    expect(fetchMock.mock.calls.at(-1)?.[0]).toBe("https://fal.media/out.png");
  });

  it("honors a custom model", async () => {
    const fetchMock = mockFalFlow([9]);
    vi.stubGlobal("fetch", fetchMock);
    const client = new RealFalImageClient("k", "fal-ai/flux/dev");

    await client.generateImage("p");

    expect(fetchMock.mock.calls[0][0]).toBe("https://queue.fal.run/fal-ai/flux/dev");
  });

  it("polls until COMPLETED before fetching the result", async () => {
    vi.useFakeTimers();
    const fetchMock = mockFalFlow([7], ["IN_QUEUE", "IN_PROGRESS", "COMPLETED"]);
    vi.stubGlobal("fetch", fetchMock);
    const client = new RealFalImageClient("k");

    const promise = client.generateImage("p");
    await vi.runAllTimersAsync();
    const buffer = await promise;

    expect(buffer).toEqual(Buffer.from([7]));
    // submit(1) + 3 status polls + result(1) + download(1) = 6 fetches
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });

  it("throws ImageApiError with the HTTP status when the submit fails", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: false, status: 401, text: async () => "unauthorized" });
    vi.stubGlobal("fetch", fetchMock);
    const client = new RealFalImageClient("bad-key");

    await expect(client.generateImage("p")).rejects.toBeInstanceOf(ImageApiError);
  });
});
