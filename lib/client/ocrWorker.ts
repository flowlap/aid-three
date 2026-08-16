import { createWorker, type Worker as TesseractWorker } from "tesseract.js";

export interface OcrWord {
  text: string;
  bbox: { x0: number; y0: number; x1: number; y1: number };
}

export interface OcrResult {
  text: string;
  words: OcrWord[];
}

/**
 * Module-level singleton — Tesseract worker init (WASM + Korean trained
 * data download, cached by the browser after the first use) takes a few
 * seconds, so every OCR trigger across every scene on the preview page
 * reuses one worker instead of paying that cost per click.
 */
let workerPromise: Promise<TesseractWorker> | null = null;

function getWorker(): Promise<TesseractWorker> {
  if (!workerPromise) workerPromise = createWorker("kor");
  return workerPromise;
}

/** Recognizes Korean text in an image (same-origin URL or any Tesseract ImageLike) and flattens the block/paragraph/line tree into a plain word list with pixel bounding boxes (in the image's native resolution). */
export async function recognizeImageText(image: string): Promise<OcrResult> {
  const worker = await getWorker();
  const { data } = await worker.recognize(image, {}, { blocks: true });
  const words: OcrWord[] = [];
  for (const block of data.blocks ?? []) {
    for (const paragraph of block.paragraphs) {
      for (const line of paragraph.lines) {
        for (const word of line.words) {
          words.push({ text: word.text, bbox: word.bbox });
        }
      }
    }
  }
  return { text: data.text, words };
}
