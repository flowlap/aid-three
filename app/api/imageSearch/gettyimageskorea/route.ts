import { NextRequest, NextResponse } from "next/server";
import { uploadToGettyImageSearch } from "@/lib/imageSearch/gettyImageSearchUpload";

/** Proxies a cropped screenshot to Getty Images Korea's reverse-image-search endpoint and returns the results page URL. */
export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const image = formData.get("image") as File | null;
  if (!image) return NextResponse.json({ error: "이미지 파일이 없습니다" }, { status: 400 });

  try {
    const { resultUrl } = await uploadToGettyImageSearch(image);
    return NextResponse.json({ resultUrl });
  } catch (err) {
    const message = err instanceof Error ? err.message : "게티이미지코리아 업로드 중 오류가 발생했습니다";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
