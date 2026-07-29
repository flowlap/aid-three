import type { OpenAiImageClient, OpenAiImageOptions } from "../ai/openaiImageClient";
import type { Scene } from "./splitScenes";
import type { VisualDesign } from "./designVisuals";

export function buildImagePrompt(scene: Scene, design: VisualDesign): string {
  return `이러닝 교육용 스토리보드 화면 이미지를 생성하세요. 실제 사람 얼굴이나 텍스트 렌더링 없이, 설명하는 개념을 시각적으로 표현하는 삽화/다이어그램 스타일로 그려주세요.

화면 설명: ${design.imageOrDiagramDescription}
객체 배치: ${design.objectPlacement}
관련 나레이션: ${scene.narrationText}`;
}

export async function generateSceneImage(
  client: OpenAiImageClient,
  scene: Scene,
  design: VisualDesign,
  options?: OpenAiImageOptions
): Promise<Buffer> {
  return client.generateImage(buildImagePrompt(scene, design), options);
}
