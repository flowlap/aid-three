import { describe, it, expect, vi, afterEach } from "vitest";
import { uploadToGettyImageBankSearch } from "./gettyImageBankSearchUpload";

describe("uploadToGettyImageBankSearch", () => {
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
    mockFetchOk({ code: 1000, upload: "jv_abc123.png", regdate: "2026-08" });
    const blob = new Blob(["fake-image-bytes"], { type: "image/png" });

    const { resultUrl } = await uploadToGettyImageBankSearch(blob);

    expect(resultUrl).toBe(
      "https://www.gettyimagesbank.com/s/?lv=&st=union&mi=2&q=&ssi=go&s3=jv_abc123.png&regdate=2026-08&mode=byimage"
    );
  });

  it("posts the exact field contract the upstream endpoint expects", async () => {
    const fetchMock = mockFetchOk({ code: 1000, upload: "jv_x.png", regdate: "2026-08" });
    const blob = new Blob(["bytes"], { type: "image/png" });

    await uploadToGettyImageBankSearch(blob);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://www.gettyimagesbank.com/search/search2017/getSearchByImage");
    expect(init.method).toBe("POST");
    const form = init.body as FormData;
    expect(form.get("mode")).toBe("move");
    expect(form.get("upload_file_type")).toBe("image");
    expect(form.get("site")).toBe("gib");
    expect(form.get("st")).toBe("union");
    expect(form.get("file")).toBeInstanceOf(Blob);
  });

  it("throws when the upstream responds with a non-1000 code", async () => {
    mockFetchOk({ code: 1001 });
    const blob = new Blob(["bytes"], { type: "image/png" });

    await expect(uploadToGettyImageBankSearch(blob)).rejects.toThrow(/code: 1001/);
  });

  it("throws when the upstream HTTP request itself fails", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 502, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);
    const blob = new Blob(["bytes"], { type: "image/png" });

    await expect(uploadToGettyImageBankSearch(blob)).rejects.toThrow(/HTTP 502/);
  });
});
