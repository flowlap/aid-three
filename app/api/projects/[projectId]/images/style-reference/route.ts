import { NextRequest, NextResponse } from "next/server";
import { readProject, readProjectReferenceImage, writeProjectReferenceImage, deleteProjectReferenceImage } from "@/lib/projects/store";

const KIND = "style" as const;

/** Serves the project's 톤앤매너 기준(스타일) 참고 이미지, if one was generated or uploaded. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const buffer = await readProjectReferenceImage(projectId, KIND);
  if (!buffer) return NextResponse.json({ error: "톤앤매너 기준 이미지를 찾을 수 없습니다" }, { status: 404 });

  return new Response(new Uint8Array(buffer), {
    headers: { "Content-Type": "image/png", "Cache-Control": "no-store" },
  });
}

/** Saves a directly uploaded style reference image, replacing any existing one. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const project = await readProject(projectId);
  if (!project) return NextResponse.json({ error: "프로젝트를 찾을 수 없습니다" }, { status: 404 });

  const formData = await req.formData();
  const image = formData.get("image") as File | null;
  if (!image) return NextResponse.json({ error: "이미지 파일이 없습니다" }, { status: 400 });
  if (!image.type.startsWith("image/")) {
    return NextResponse.json({ error: "이미지 파일만 업로드 가능합니다" }, { status: 400 });
  }

  await writeProjectReferenceImage(projectId, KIND, Buffer.from(await image.arrayBuffer()));
  return NextResponse.json({ ok: true });
}

/** Removes the saved style reference image. */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  await deleteProjectReferenceImage(projectId, KIND);
  return NextResponse.json({ ok: true });
}
