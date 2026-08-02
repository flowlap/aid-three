import { buildNotebookLmPptxTemplate } from "@/lib/pptx/defaultTemplate";

/** Serves the NotebookLM-themed variant of the default pptx template. */
export async function GET() {
  const output = await buildNotebookLmPptxTemplate();
  const filename = encodeURIComponent("스토리보드-노트북LM템플릿.pptx");
  return new Response(new Uint8Array(output), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "Content-Disposition": `attachment; filename*=UTF-8''${filename}`,
    },
  });
}
