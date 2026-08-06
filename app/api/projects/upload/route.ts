import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { createProject, projectSourceDir, writeProjectFile, updateProjectStep } from "@/lib/projects/store";
import { extractText } from "@/lib/pipeline/extractText";
import { splitScenesByBlankLines, trimLines } from "@/lib/pipeline/splitScenesByBlankLines";
import type { ScriptType, ProductionMode } from "@/lib/projects/types";

const VALID_SCRIPT_TYPES: ScriptType[] = ["script", "narration", "narration_pre_edited"];
const VALID_PRODUCTION_MODES: ProductionMode[] = ["scene", "sequence"];

/**
 * "나레이션(가편집)" skips both AI steps that a normal upload still needs:
 * the text is already finalized narration, so it becomes narration.md
 * verbatim (line-trimmed only), and scenes are split deterministically on
 * blank-line runs instead of asking an AI to find boundaries. The project
 * lands past both steps, ready for screen design.
 */
async function finalizePreEditedNarration(projectId: string, rawText: string): Promise<void> {
  await writeProjectFile(projectId, "narration.md", trimLines(rawText));
  const scenes = splitScenesByBlankLines(rawText);
  await writeProjectFile(projectId, "scenes.json", JSON.stringify({ scenes }, null, 2));
  await updateProjectStep(projectId, "scenes");
}

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  const pastedText = formData.get("text") as string | null;
  const text = pastedText?.trim() ?? "";
  const rawTitle = formData.get("title") as string | null;
  const title = rawTitle?.trim() ?? "";
  const scriptType = formData.get("scriptType") as ScriptType | null;
  const rawProductionMode = formData.get("productionMode") as string | null;
  const productionMode = (rawProductionMode ?? "scene") as ProductionMode;

  if ((!file && !text) || !title || !scriptType) {
    return NextResponse.json({ error: "file 또는 text, title, scriptType는 필수입니다" }, { status: 400 });
  }

  if (!scriptType || !VALID_SCRIPT_TYPES.includes(scriptType)) {
    return NextResponse.json(
      { error: "scriptType은 script, narration, narration_pre_edited 중 하나여야 합니다" },
      { status: 400 }
    );
  }

  if (!VALID_PRODUCTION_MODES.includes(productionMode)) {
    return NextResponse.json({ error: "productionMode는 scene, sequence 중 하나여야 합니다" }, { status: 400 });
  }

  if (!file) {
    const project = await createProject(title, scriptType, productionMode);
    await writeProjectFile(project.id, "extracted.txt", text);
    if (scriptType === "narration_pre_edited") await finalizePreEditedNarration(project.id, text);
    return NextResponse.json({ project });
  }

  // file.name is client-supplied and untrusted; strip any directory
  // components so the write can never escape projectSourceDir(id).
  const safeName = path.basename(file.name);
  const lowerName = safeName.toLowerCase();
  const isPdf = lowerName.endsWith(".pdf");
  const isTxt = lowerName.endsWith(".txt");
  if (!isPdf && !isTxt) {
    return NextResponse.json({ error: "pdf 또는 txt 파일만 업로드 가능합니다" }, { status: 400 });
  }

  const project = await createProject(title, scriptType, productionMode);
  const sourcePath = path.join(projectSourceDir(project.id), safeName);
  const buffer = Buffer.from(await file.arrayBuffer());
  await fs.writeFile(sourcePath, buffer);

  let rawText: string;
  try {
    rawText = await extractText(sourcePath, isPdf ? "pdf" : "txt");
  } catch (err) {
    console.error("파일 파싱 실패:", err);
    return NextResponse.json(
      { error: "파일 파싱에 실패했습니다. 파일 형식을 확인해주세요." },
      { status: 422 }
    );
  }
  await writeProjectFile(project.id, "extracted.txt", rawText);
  if (scriptType === "narration_pre_edited") await finalizePreEditedNarration(project.id, rawText);

  return NextResponse.json({ project });
}
