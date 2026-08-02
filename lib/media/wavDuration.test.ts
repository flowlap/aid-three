import { describe, it, expect } from "vitest";
import { getWavDurationSec } from "./wavDuration";

function buildWav({
  sampleRate,
  numChannels = 1,
  bitsPerSample = 16,
  numSamples,
  extraChunk,
}: {
  sampleRate: number;
  numChannels?: number;
  bitsPerSample?: number;
  numSamples: number;
  extraChunk?: boolean;
}): Buffer {
  const blockAlign = numChannels * (bitsPerSample / 8);
  const byteRate = sampleRate * blockAlign;
  const dataSize = numSamples * blockAlign;

  const fmtChunk = Buffer.alloc(8 + 16);
  fmtChunk.write("fmt ", 0, "ascii");
  fmtChunk.writeUInt32LE(16, 4);
  fmtChunk.writeUInt16LE(1, 8); // PCM
  fmtChunk.writeUInt16LE(numChannels, 10);
  fmtChunk.writeUInt32LE(sampleRate, 12);
  fmtChunk.writeUInt32LE(byteRate, 16);
  fmtChunk.writeUInt16LE(blockAlign, 20);
  fmtChunk.writeUInt16LE(bitsPerSample, 22);

  const junkChunk = extraChunk ? Buffer.concat([Buffer.from("JUNK", "ascii"), Buffer.alloc(4)]) : Buffer.alloc(0);
  if (extraChunk) junkChunk.writeUInt32LE(0, 4);

  const dataChunk = Buffer.alloc(8 + dataSize);
  dataChunk.write("data", 0, "ascii");
  dataChunk.writeUInt32LE(dataSize, 4);

  const body = Buffer.concat([Buffer.from("WAVE", "ascii"), fmtChunk, junkChunk, dataChunk]);
  const header = Buffer.alloc(8);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(body.length, 4);

  return Buffer.concat([header, body]);
}

describe("getWavDurationSec", () => {
  it("computes duration from sample rate and data size", () => {
    const wav = buildWav({ sampleRate: 24000, numSamples: 24000 * 3 });
    expect(getWavDurationSec(wav)).toBeCloseTo(3, 5);
  });

  it("handles stereo/16-bit correctly (duration independent of channel count)", () => {
    const wav = buildWav({ sampleRate: 16000, numChannels: 2, numSamples: 16000 * 2 });
    expect(getWavDurationSec(wav)).toBeCloseTo(2, 5);
  });

  it("skips unrelated chunks between fmt and data", () => {
    const wav = buildWav({ sampleRate: 22050, numSamples: 22050, extraChunk: true });
    expect(getWavDurationSec(wav)).toBeCloseTo(1, 5);
  });

  it("throws for a non-WAV buffer", () => {
    expect(() => getWavDurationSec(Buffer.from("not a wav file at all"))).toThrow();
  });
});
