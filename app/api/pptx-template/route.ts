import { buildDefaultPptxTemplate } from "@/lib/pptx/defaultTemplate";

/** Serves the ready-to-customize default template for the "pptx 템플릿으로 내보내기" upload flow. */
export async function GET() {
  const output = await buildDefaultPptxTemplate();
  const filename = encodeURIComponent("스토리보드-기본템플릿.pptx");
  return new Response(new Uint8Array(output), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "Content-Disposition": `attachment; filename*=UTF-8''${filename}`,
    },
  });
}
