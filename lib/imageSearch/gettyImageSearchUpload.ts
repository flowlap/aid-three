const UPLOAD_URL = "https://mbdrive.gettyimageskorea.com/search/searchByImage";
const RESULT_HOST = "https://mbdrive.gettyimageskorea.com";

interface UploadResponse {
  code: number;
  upload?: string;
}

/**
 * Proxies a cropped screenshot to Getty Images Korea's (unofficial) reverse-image-search
 * endpoint and returns the URL of the resulting search page. The field names/values below
 * were reverse-engineered from the site's own upload JS (F_FileMultiUpload_Send) — see
 * docs/superpowers/specs/2026-08-05-getty-image-search-design.md.
 */
export async function uploadToGettyImageSearch(image: Blob): Promise<{ resultUrl: string }> {
  const form = new FormData();
  form.append("file", image, "screenshot.png");
  form.append("mode", "move");
  form.append("searchTo", "");
  form.append("site", "creative");
  form.append("watch", "rf");

  const res = await fetch(UPLOAD_URL, { method: "POST", body: form });
  if (!res.ok) {
    throw new Error(`게티이미지코리아 업로드 요청이 실패했습니다 (HTTP ${res.status})`);
  }

  const data = (await res.json()) as UploadResponse;
  if (data.code !== 1000 || !data.upload) {
    throw new Error(`게티이미지코리아 업로드가 거부되었습니다 (code: ${data.code})`);
  }

  const resultUrl = `${RESULT_HOST}/creative/?cs=on&lct=rm%2Crf&s3=${encodeURIComponent(data.upload)}&searchByImage=Y&mode=&searchFileType=img`;
  return { resultUrl };
}
