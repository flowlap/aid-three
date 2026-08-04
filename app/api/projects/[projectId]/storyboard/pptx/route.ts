import { NextRequest, NextResponse } from "next/server";
import { readProject, readProjectFile, readProjectPptxTemplate, readProjectImage } from "@/lib/projects/store";
import { buildScenePptx, type PptxPlaceholderData } from "@/lib/pptx/exportPptx";
import { buildDefaultPptxTemplate, buildNotebookLmPptxTemplate } from "@/lib/pptx/defaultTemplate";
import { renderMockupImage } from "@/lib/pptx/renderMockupImage";
import type { Scene } from "@/lib/pipeline/splitScenes";
import type { ScreenTypeAssignment } from "@/lib/pipeline/selectScreenTypes";
import type { VisualDesign } from "@/lib/pipeline/designVisuals";

/**
 * Fills in the per-scene pptx template — an ad-hoc file attached to this
 * request takes priority, otherwise the project's saved custom template
 * (registered via `/pptx-template`) is used if one exists, otherwise falls
 * back to the bundled default/노트북LM template for a one-click "PPTX로 저장"
 * with no upload step. Each scene's generated image (or, if none exists
 * yet, a layout-grid mockup — see lib/pptx/renderMockupImage.ts) is
 * embedded into the template's "화면 영역" placeholder shape when present;
 * templates without that shape still get text-only slides as before.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const project = await readProject(projectId);
  if (!project) return NextResponse.json({ error: "프로젝트를 찾을 수 없습니다" }, { status: 404 });

  const formData = await req.formData();
  const template = formData.get("template") as File | null;
  const style = formData.get("style") as string | null;

  let templateBytes: Buffer;
  if (template) {
    if (!template.name.toLowerCase().endsWith(".pptx")) {
      return NextResponse.json({ error: "pptx 파일만 업로드 가능합니다" }, { status: 400 });
    }
    templateBytes = Buffer.from(await template.arrayBuffer());
  } else {
    const savedTemplate = await readProjectPptxTemplate(projectId);
    templateBytes =
      savedTemplate ?? (style === "notebooklm" ? await buildNotebookLmPptxTemplate() : await buildDefaultPptxTemplate());
  }

  const scenesRaw = await readProjectFile(projectId, "scenes.json");
  if (!scenesRaw) {
    return NextResponse.json({ error: "씬 데이터가 없습니다" }, { status: 400 });
  }
  const scenes: Scene[] = JSON.parse(scenesRaw).scenes ?? [];
  if (scenes.length === 0) {
    return NextResponse.json({ error: "씬 데이터가 없습니다" }, { status: 400 });
  }

  const screenDesignRaw = await readProjectFile(projectId, "screen-design.json");
  const screenDesign = screenDesignRaw ? JSON.parse(screenDesignRaw) : {};
  const screenTypes: Record<string, ScreenTypeAssignment> = screenDesign.screenTypes ?? {};
  const visualDesigns: Record<string, VisualDesign> = screenDesign.visualDesigns ?? {};

  const perSlideData: PptxPlaceholderData[] = scenes.map((scene, index) => {
    const screenType = screenTypes[scene.id];
    const design = visualDesigns[scene.id];
    return {
      과정명: project.title,
      번호: String(index + 1),
      나레이션: scene.narrationText,
      자막: design?.caption ?? "",
      화면유형: screenType?.screenType ?? "",
      설명: design?.imageOrDiagramDescription ?? "",
      배치: design?.objectPlacement ?? "",
      키워드: design?.keywords?.join(", ") ?? "",
      길이: `${scene.estimatedDurationSec}초`,
    };
  });

  const perSlideImages: (Buffer | undefined)[] = await Promise.all(
    scenes.map(async (scene) => {
      const generated = await readProjectImage(projectId, scene.id);
      if (generated) return generated;
      try {
        return await renderMockupImage(visualDesigns[scene.id], screenTypes[scene.id]?.screenType);
      } catch (err) {
        console.error(`목업 이미지 생성 실패 (씬 ${scene.id}):`, err);
        return undefined;
      }
    })
  );

  let output: Buffer;
  try {
    output = await buildScenePptx(templateBytes, perSlideData, perSlideImages);
  } catch (err) {
    console.error("pptx 생성 실패:", err);
    const message = err instanceof Error ? err.message : "pptx 생성에 실패했습니다";
    return NextResponse.json({ error: message }, { status: 422 });
  }

  const filename = encodeURIComponent(`${project.title}-스토리보드.pptx`);
  return new Response(new Uint8Array(output), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "Content-Disposition": `attachment; filename*=UTF-8''${filename}`,
    },
  });
}
