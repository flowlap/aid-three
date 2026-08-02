import { NextRequest, NextResponse } from "next/server";
import { readProjectAudio } from "@/lib/projects/store";

/**
 * Supports HTTP Range requests: without this, Chrome's <audio> element can
 * stall indefinitely on a chunked, Content-Length-less 200 response instead
 * of loading metadata — it never errors, it just never plays.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string; sceneId: string }> }
) {
  const { projectId, sceneId } = await params;
  const buffer = await readProjectAudio(projectId, sceneId);
  if (!buffer) return NextResponse.json({ error: "음성 파일을 찾을 수 없습니다" }, { status: 404 });

  const range = req.headers.get("range");
  if (!range) {
    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "audio/wav",
        "Content-Length": String(buffer.length),
        "Accept-Ranges": "bytes",
        "Cache-Control": "no-store",
      },
    });
  }

  const match = range.match(/bytes=(\d*)-(\d*)/);
  const start = match?.[1] ? parseInt(match[1], 10) : 0;
  const end = match?.[2] ? Math.min(parseInt(match[2], 10), buffer.length - 1) : buffer.length - 1;
  const chunk = buffer.subarray(start, end + 1);

  return new Response(new Uint8Array(chunk), {
    status: 206,
    headers: {
      "Content-Type": "audio/wav",
      "Content-Range": `bytes ${start}-${end}/${buffer.length}`,
      "Content-Length": String(chunk.length),
      "Accept-Ranges": "bytes",
      "Cache-Control": "no-store",
    },
  });
}
