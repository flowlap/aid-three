import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { createProject, projectSourceDir, writeProjectFile } from "@/lib/projects/store";
import { extractText } from "@/lib/pipeline/extractText";
import type { ScriptType } from "@/lib/projects/types";

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  const rawTitle = formData.get("title") as string | null;
  const title = rawTitle?.trim() ?? "";
  const scriptType = formData.get("scriptType") as ScriptType | null;

  if (!file || !title || !scriptType) {
    return NextResponse.json({ error: "file, title, scriptType는 필수입니다" }, { status: 400 });
  }

  if (scriptType !== "script" && scriptType !== "narration") {
    return NextResponse.json({ error: "scriptType은 script 또는 narration이어야 합니다" }, { status: 400 });
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

  const project = await createProject(title, scriptType);
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

  return NextResponse.json({ project });
}
