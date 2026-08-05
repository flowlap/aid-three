import { readProjectFile, readProjectImage } from "@/lib/projects/store";
import type { Scene } from "./splitScenes";

export interface ImageAspectRatio {
  width: number;
  height: number;
}

/** Matches OpenAI's current default output size (1536x1024) — kept as the fallback so projects with no generated image yet render exactly as before this feature existed. */
const DEFAULT_ASPECT_RATIO: ImageAspectRatio = { width: 3, height: 2 };

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Reads width/height out of a PNG's IHDR chunk. Returns null for anything that isn't a valid PNG (e.g. an unexpectedly different format) rather than throwing — callers fall back to a default. */
export function getPngDimensions(buffer: Buffer): ImageAspectRatio | null {
  if (buffer.length < 24 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  if (width <= 0 || height <= 0) return null;
  return { width, height };
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
    const dimensions = getPngDimensions(buffer);
    if (dimensions) return dimensions;
  }

  return DEFAULT_ASPECT_RATIO;
}
