import { promises as fs } from "fs";
import pdfParse from "pdf-parse";

export async function extractText(filePath: string, mimeType: "pdf" | "txt"): Promise<string> {
  if (mimeType === "txt") {
    return fs.readFile(filePath, "utf-8");
  }
  const buffer = await fs.readFile(filePath);
  const data = await pdfParse(buffer);
  return data.text;
}
