import { describe, it, expect } from "vitest";
import { getImageDimensions } from "./imageAspectRatio";

/** Minimal valid PNG signature + IHDR chunk carrying the given width/height — enough for getImageDimensions, not a real decodable image. */
function buildPngHeader(width: number, height: number): Buffer {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(25);
  ihdr.writeUInt32BE(13, 0); // chunk length
  ihdr.write("IHDR", 4);
  ihdr.writeUInt32BE(width, 8);
  ihdr.writeUInt32BE(height, 12);
  return Buffer.concat([signature, ihdr]);
}

/** Minimal JPEG: SOI, one APP0 segment, then a bare SOF0 segment carrying height/width (JPEG stores height first). */
function buildJpegHeader(width: number, height: number): Buffer {
  const soi = Buffer.from([0xff, 0xd8]);
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x04, 0x00, 0x00]); // length=4 (2 length bytes + 2 payload bytes)
  const sof0 = Buffer.alloc(2 + 2 + 1 + 2 + 2 + 1);
  sof0.writeUInt8(0xff, 0);
  sof0.writeUInt8(0xc0, 1);
  sof0.writeUInt16BE(sof0.length - 2, 2); // segment length excludes the 0xFF marker byte pair
  sof0.writeUInt8(8, 4); // precision
  sof0.writeUInt16BE(height, 5);
  sof0.writeUInt16BE(width, 7);
  sof0.writeUInt8(3, 9); // component count
  return Buffer.concat([soi, app0, sof0]);
}

describe("getImageDimensions", () => {
  it("reads width/height from a PNG IHDR chunk", () => {
    expect(getImageDimensions(buildPngHeader(1920, 1080))).toEqual({ width: 1920, height: 1080 });
  });

  it("reads width/height from a JPEG SOF0 segment, even though this project names JPEG bytes *.png", () => {
    expect(getImageDimensions(buildJpegHeader(1408, 768))).toEqual({ width: 1408, height: 768 });
  });

  it("skips past non-SOF marker segments (e.g. APP0/JFIF) to find the SOF marker", () => {
    // buildJpegHeader already includes an APP0 segment before SOF0 — this
    // case would return null if the scanner didn't advance past it correctly.
    const buf = buildJpegHeader(640, 480);
    expect(getImageDimensions(buf)).toEqual({ width: 640, height: 480 });
  });

  it("returns null for a buffer that is neither a PNG nor a JPEG", () => {
    expect(getImageDimensions(Buffer.from("not an image"))).toBeNull();
  });

  it("returns null for a truncated JPEG with no SOF segment", () => {
    expect(getImageDimensions(Buffer.from([0xff, 0xd8, 0xff, 0xd9]))).toBeNull();
  });

  it("returns null for a PNG with a zero width or height", () => {
    expect(getImageDimensions(buildPngHeader(0, 100))).toBeNull();
  });
});
