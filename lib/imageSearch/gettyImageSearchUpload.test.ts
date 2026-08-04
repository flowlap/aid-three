import { describe, it, expect, vi, afterEach } from "vitest";
import { uploadToGettyImageSearch } from "./gettyImageSearchUpload";

describe("uploadToGettyImageSearch", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function mockFetchOk(body: unknown) {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => body,
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("builds the result URL from a successful upload response", async () => {
    mockFetchOk({ code: 1000, upload: "jv_abc123.png", rcode: "" });
    const blob = new Blob(["fake-image-bytes"], { type: "image/png" });

    const { resultUrl } = await uploadToGettyImageSearch(blob);

    expect(resultUrl).toBe(
      "https://mbdrive.gettyimageskorea.com/creative/?cs=on&lct=rm%2Crf&s3=jv_abc123.png&searchByImage=Y&mode=&searchFileType=img"
    );
  });

  it("posts the exact field contract the upstream endpoint expects", async () => {
    const fetchMock = mockFetchOk({ code: 1000, upload: "jv_x.png" });
    const blob = new Blob(["bytes"], { type: "image/png" });

    await uploadToGettyImageSearch(blob);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://mbdrive.gettyimageskorea.com/search/searchByImage");
    expect(init.method).toBe("POST");
    const form = init.body as FormData;
    expect(form.get("mode")).toBe("move");
    expect(form.get("searchTo")).toBe("");
    expect(form.get("site")).toBe("creative");
    expect(form.get("watch")).toBe("rf");
    expect(form.get("file")).toBeInstanceOf(Blob);
  });

  it("throws when the upstream responds with a non-1000 code", async () => {
    mockFetchOk({ code: 1001, rcode: "" });
    const blob = new Blob(["bytes"], { type: "image/png" });

    await expect(uploadToGettyImageSearch(blob)).rejects.toThrow(/code: 1001/);
  });

  it("throws when the upstream HTTP request itself fails", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 502, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);
    const blob = new Blob(["bytes"], { type: "image/png" });

    await expect(uploadToGettyImageSearch(blob)).rejects.toThrow(/HTTP 502/);
  });
});
