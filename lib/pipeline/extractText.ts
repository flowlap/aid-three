import { promises as fs } from "fs";
import { PDFParse } from "pdf-parse";

export async function extractText(filePath: string, mimeType: "pdf" | "txt"): Promise<string> {
  if (mimeType === "txt") {
    return fs.readFile(filePath, "utf-8");
  }
  const buffer = await fs.readFile(filePath);
  const pdfParser = new PDFParse({ data: buffer });
  // pdf-parse defaults to inserting a "-- N of M --" page-boundary marker
  // between every page; disable it so extracted text stays clean.
  const textResult = await pdfParser.getText({ pageJoiner: "" });
  await pdfParser.destroy();
  return textResult.text;
}
