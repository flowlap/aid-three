import { readProject, readProjectFile, readProjectReferenceImage, listProjectImageIds } from "@/lib/projects/store";
import { getProductionMode } from "@/lib/projects/types";
import { getProjectImageAspectRatio } from "@/lib/pipeline/imageAspectRatio";
import { ImagesEditor } from "./ImagesEditor";
import type { ImageEngine, LocalModelSize, HChatGeminiModel } from "@/components/ImageEngineSelector";
import { getImageProviderType } from "@/lib/ai/image/factory";
import {
  DEFAULT_IMAGE_COMMON_PROMPT,
  DEFAULT_BACKGROUND_IMAGE_PROMPT,
  DEFAULT_PRESENTER_IMAGE_PROMPT,
  DEFAULT_STYLE_IMAGE_PROMPT,
} from "@/lib/pipeline/commonPromptDefaults";
import type { Scene } from "@/lib/pipeline/splitScenes";
import type { ScreenTypeAssignment } from "@/lib/pipeline/selectScreenTypes";
import type { VisualDesign } from "@/lib/pipeline/designVisuals";

export default async function ImagesPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const scenesRaw = await readProjectFile(projectId, "scenes.json");
  const scenes: Scene[] = scenesRaw ? JSON.parse(scenesRaw).scenes : [];

  const screenDesignRaw = await readProjectFile(projectId, "screen-design.json");
  const screenDesign = screenDesignRaw ? JSON.parse(screenDesignRaw) : {};
  const screenTypes: Record<string, ScreenTypeAssignment> = screenDesign.screenTypes ?? {};
  const visualDesigns: Record<string, VisualDesign> = screenDesign.visualDesigns ?? {};

  const initialImageIds = await listProjectImageIds(projectId);
  const initialCommonPrompt =
    (await readProjectFile(projectId, "image-common-prompt.txt"))?.trim() || DEFAULT_IMAGE_COMMON_PROMPT;
  const initialPresenterEnabled = (await readProjectFile(projectId, "image-presenter-enabled.txt"))?.trim() === "true";
  const initialBackgroundFixed = (await readProjectFile(projectId, "background-fixed-enabled.txt"))?.trim() === "true";
  const initialBackgroundPrompt =
    (await readProjectFile(projectId, "background-image-prompt.txt"))?.trim() || DEFAULT_BACKGROUND_IMAGE_PROMPT;
  const initialPresenterPrompt =
    (await readProjectFile(projectId, "presenter-image-prompt.txt"))?.trim() || DEFAULT_PRESENTER_IMAGE_PROMPT;
  const genderRaw = (await readProjectFile(projectId, "presenter-gender.txt"))?.trim();
  const initialPresenterGender = genderRaw === "male" ? "male" : "female";
  const initialHasBackgroundImage = (await readProjectReferenceImage(projectId, "background")) !== null;
  const initialHasPresenterImage = (await readProjectReferenceImage(projectId, "presenter")) !== null;
  const initialStylePrompt =
    (await readProjectFile(projectId, "style-image-prompt.txt"))?.trim() || DEFAULT_STYLE_IMAGE_PROMPT;
  const initialHasStyleImage = (await readProjectReferenceImage(projectId, "style")) !== null;
  const engineRaw = (await readProjectFile(projectId, "image-engine.txt"))?.trim();
  const initialEngine: ImageEngine = engineRaw === "local" ? "local" : "openai";
  const modelSizeRaw = (await readProjectFile(projectId, "image-local-model-size.txt"))?.trim();
  const initialModelSize: LocalModelSize = modelSizeRaw === "9b" ? "9b" : "4b";
  const imageProviderType = getImageProviderType();
  const hchatGeminiModelRaw = (await readProjectFile(projectId, "image-hchat-gemini-model.txt"))?.trim();
  const initialHchatGeminiModel: HChatGeminiModel =
    hchatGeminiModelRaw === "gemini-3-pro-image" ? "gemini-3-pro-image" : "gemini-3.1-flash-image";
  const imageAspectRatio = await getProjectImageAspectRatio(projectId);
  const project = await readProject(projectId);
  const productionMode = project ? getProductionMode(project) : "scene";
  const isSequence = productionMode === "sequence";

  return (
    <>
      <h1 className="mb-1 text-3xl font-semibold tracking-tight">이미지/목업 생성</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        {isSequence
          ? "각 씬을 시퀀스 마스터 비주얼(카메라 시작 프레임) + 오버레이 레이어로 합성합니다. 이미지 모델을 씬마다 호출하지 않으며(비용 없음), 마스터 비주얼은 ‘시퀀스 설계’ 단계에서 먼저 생성하세요."
          : "선택 사항입니다. 이미지 없이 다음 단계로 넘어가도 됩니다 — 외부 API(OpenAI, Gemini) 호출은 비용이 발생합니다."}
      </p>
      <ImagesEditor
        projectId={projectId}
        productionMode={productionMode}
        scenes={scenes}
        screenTypes={screenTypes}
        visualDesigns={visualDesigns}
        initialImageIds={initialImageIds}
        initialCommonPrompt={initialCommonPrompt}
        initialPresenterEnabled={initialPresenterEnabled}
        initialBackgroundFixed={initialBackgroundFixed}
        initialBackgroundPrompt={initialBackgroundPrompt}
        initialPresenterPrompt={initialPresenterPrompt}
        initialPresenterGender={initialPresenterGender}
        initialHasBackgroundImage={initialHasBackgroundImage}
        initialHasPresenterImage={initialHasPresenterImage}
        initialStylePrompt={initialStylePrompt}
        initialHasStyleImage={initialHasStyleImage}
        initialEngine={initialEngine}
        initialModelSize={initialModelSize}
        imageProviderType={imageProviderType}
        initialHchatGeminiModel={initialHchatGeminiModel}
        imageAspectRatio={imageAspectRatio}
      />
    </>
  );
}
