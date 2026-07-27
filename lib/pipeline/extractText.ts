import { promises as fs } from "fs";
import { PDFParse } from "pdf-parse";

export async function extractText(filePath: string, mimeType: "pdf" | "txt"): Promise<string> {
  if (mimeType === "txt") {
    return fs.readFile(filePath, "utf-8");
  }
  const buffer = await fs.readFile(filePath);
  const pdfParser = new PDFParse({ data: buffer });
  const textResult = await pdfParser.getText();
  await pdfParser.destroy();
  return textResult.text;
}
