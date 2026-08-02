/**
 * Border-color classes cycling through the app's categorical chart palette
 * (globals.css --chart-1..5, already tuned as a set for both light/dark
 * themes) so each heading depth gets a visually distinct stripe instead of
 * every title scene sharing the same primary color regardless of depth.
 */
const DEPTH_BORDER_CLASSES = ["border-l-chart-1", "border-l-chart-2", "border-l-chart-3", "border-l-chart-4", "border-l-chart-5"];

/** depth is 1-based (# = 1, ## = 2, ...); cycles through the palette if depth exceeds it. */
export function getDepthBorderClass(depth: number): string {
  const index = Math.max(0, depth - 1) % DEPTH_BORDER_CLASSES.length;
  return DEPTH_BORDER_CLASSES[index];
}
