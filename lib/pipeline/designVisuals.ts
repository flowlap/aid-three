import { DEEPSEEK_MODELS, type DeepSeekClient } from "../ai/deepseekClient";
import type { Scene } from "./splitScenes";
import type { ScreenTypeAssignment } from "./selectScreenTypes";

export interface VisualDesign {
  caption: string;
  keywords: string[];
  imageOrDiagramDescription: string;
  objectPlacement: string;
  appearanceOrder: string[];
  productionNotes: string;
}

export interface DesignGuide {
  toneAndManner: string;
  colorPalette: string;
}

const DEFAULT_DESIGN_GUIDE: DesignGuide = {
  toneAndManner: "차분하고 신뢰감 있는 톤",
  colorPalette: "네이비/화이트 기본, 포인트 컬러 블루",
};

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isVisualDesign(value: unknown): value is VisualDesign {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as VisualDesign).caption === "string" &&
    isStringArray((value as VisualDesign).keywords) &&
    typeof (value as VisualDesign).imageOrDiagramDescription === "string" &&
    typeof (value as VisualDesign).objectPlacement === "string" &&
    isStringArray((value as VisualDesign).appearanceOrder) &&
    typeof (value as VisualDesign).productionNotes === "string"
  );
}

export type VisualDesignProgress = (
  sceneId: string,
  index: number,
  total: number,
  design: VisualDesign
) => void | Promise<void>;

export interface DesignVisualsOptions {
  designGuide?: DesignGuide;
  onProgress?: VisualDesignProgress;
  signal?: AbortSignal;
}

export async function designVisuals(
  client: DeepSeekClient,
  scenes: Scene[],
  screenTypes: Record<string, ScreenTypeAssignment>,
  options: DesignVisualsOptions = {}
): Promise<Record<string, VisualDesign>> {
  const { designGuide = DEFAULT_DESIGN_GUIDE, onProgress, signal } = options;
  const result: Record<string, VisualDesign> = {};

  for (let i = 0; i < scenes.length; i++) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

    const scene = scenes[i];
    const screenType = screenTypes[scene.id];
    const prompt = `다음 씬의 비주얼을 설계하세요.

나레이션: ${scene.narrationText}
화면 유형: ${screenType?.screenType ?? "미지정"}
레이아웃: ${screenType?.recommendedLayout ?? "미지정"}
디자인 가이드: 톤앤매너 - ${designGuide.toneAndManner}, 컬러 - ${designGuide.colorPalette}

JSON으로만 응답하세요: {"caption": string, "keywords": string[], "imageOrDiagramDescription": string, "objectPlacement": string, "appearanceOrder": string[], "productionNotes": string}`;

    const raw = await client.complete(
      [
        { role: "system", content: "당신은 이러닝 스토리보드 비주얼 디자이너입니다." },
        { role: "user", content: prompt },
      ],
      { jsonMode: true, model: DEEPSEEK_MODELS.flash, signal }
    );

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(`AI 응답이 유효한 JSON이 아닙니다 (scene: ${scene.id})`);
    }

    if (!isVisualDesign(parsed)) {
      throw new Error(
        `AI 응답 형식이 올바르지 않습니다 (scene: ${scene.id}, caption/keywords/imageOrDiagramDescription/objectPlacement/appearanceOrder/productionNotes 필드 필요)`
      );
    }

    result[scene.id] = parsed;
    await onProgress?.(scene.id, i, scenes.length, parsed);
  }

  return result;
}
