import { readProjectFile, readProjectImage } from "@/lib/projects/store";
import type { Scene } from "./splitScenes";

export interface ImageAspectRatio {
  width: number;
  height: number;
}

/** Matches OpenAI's current default output size (1536x1024) — kept as the fallback so projects with no generated image yet render exactly as before this feature existed. */
const DEFAULT_ASPECT_RATIO: ImageAspectRatio = { width: 3, height: 2 };

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Reads width/height out of a PNG's IHDR chunk, or null if `buffer` isn't a PNG. */
function getPngDimensions(buffer: Buffer): ImageAspectRatio | null {
  if (buffer.length < 24 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  if (width <= 0 || height <= 0) return null;
  return { width, height };
}

/**
 * Reads width/height out of a JPEG's SOF (start-of-frame) segment, or null
 * if `buffer` isn't a JPEG. Needed because every image file in this project
 * is named `{sceneId}.png` and served as `Content-Type: image/png`
 * regardless of what the AI provider actually returned — some engines
 * (fal, hchat-gemini) return JPEG-encoded bytes under that name, which
 * browsers happily render via content-sniffing but which getPngDimensions
 * alone would silently fail to measure (wrong magic bytes → null → callers
 * fall back to a default aspect ratio that doesn't match the real image,
 * causing cropping via object-cover). Scans marker segments for the first
 * SOFn marker (0xC0-0xCF, excluding DHT/JPG/DAC) per the JPEG spec; height
 * is stored before width in a SOF segment, unlike PNG's IHDR.
 */
function getJpegDimensions(buffer: Buffer): ImageAspectRatio | null {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 4 <= buffer.length) {
    if (buffer[offset] !== 0xff) return null;
    const marker = buffer[offset + 1];
    // Markers with no payload (RSTn, TEM) — just the 2 marker bytes, no length field.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    if (marker === 0xd9 /* EOI */ || marker === 0xda /* SOS — entropy-coded data follows, no more markers to scan */) {
      return null;
    }
    const segmentLength = buffer.readUInt16BE(offset + 2);
    const isSofMarker = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSofMarker) {
      if (offset + 9 > buffer.length) return null;
      const height = buffer.readUInt16BE(offset + 5);
      const width = buffer.readUInt16BE(offset + 7);
      if (width <= 0 || height <= 0) return null;
      return { width, height };
    }
    offset += 2 + segmentLength;
  }
  return null;
}

/** Reads width/height from a PNG or JPEG buffer (whichever it actually is — see getJpegDimensions for why both matter here), or null if neither parses. */
export function getImageDimensions(buffer: Buffer): ImageAspectRatio | null {
  return getPngDimensions(buffer) ?? getJpegDimensions(buffer);
}

/**
 * Determines the aspect ratio the UI (image lists, mockups, preview, video
 * frames) should render at — based on the first scene (in narration order)
 * that actually has a generated image, since providers differ (OpenAI's
 * default is 3:2, Gemini's is 16:9) and this is more robust than trusting
 * IMAGE_PROVIDER config, which could mismatch what a project was actually
 * generated with historically. Falls back to the pre-existing hardcoded 3:2
 * when no scene has an image yet, or none of them parse.
 */
export async function getProjectImageAspectRatio(projectId: string): Promise<ImageAspectRatio> {
  const scenesRaw = await readProjectFile(projectId, "scenes.json");
  if (!scenesRaw) return DEFAULT_ASPECT_RATIO;

  let scenes: Scene[];
  try {
    scenes = JSON.parse(scenesRaw).scenes ?? [];
  } catch {
    return DEFAULT_ASPECT_RATIO;
  }

  for (const scene of scenes) {
    if (scene.sceneType === "title") continue;
    const buffer = await readProjectImage(projectId, scene.id);
    if (!buffer) continue;
    const dimensions = getImageDimensions(buffer);
    if (dimensions) return dimensions;
  }

  return DEFAULT_ASPECT_RATIO;
}
