import { describe, it, expect } from "vitest";
import { promises as fs } from "fs";
import path from "path";
import os from "os";
import { extractText } from "./extractText";

describe("extractText", () => {
  it("reads plain text files as-is", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "extract-text-"));
    const filePath = path.join(dir, "sample.txt");
    await fs.writeFile(filePath, "안녕하세요 원고 내용입니다.", "utf-8");

    const result = await extractText(filePath, "txt");

    expect(result).toBe("안녕하세요 원고 내용입니다.");
  });

  it("throws a clear error for invalid pdf content", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "extract-text-"));
    const filePath = path.join(dir, "broken.pdf");
    await fs.writeFile(filePath, "이건 진짜 pdf가 아닙니다");

    await expect(extractText(filePath, "pdf")).rejects.toThrow();
  });
});
