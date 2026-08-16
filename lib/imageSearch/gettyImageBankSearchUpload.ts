const UPLOAD_URL = "https://www.gettyimagesbank.com/search/search2017/getSearchByImage";
const RESULT_HOST = "https://www.gettyimagesbank.com";

interface UploadResponse {
  code: number;
  upload?: string;
  regdate?: string;
}

/**
 * Proxies a cropped screenshot to Getty Images Bank's (unofficial) reverse-image-search
 * endpoint and returns the URL of the resulting search page. Field names/values and the
 * result URL shape were reverse-engineered the same way as gettyImageSearchUpload.ts's
 * Getty Korea integration — from the site's own inline upload script
 * (`F_FileMultiUpload`, in an inline <script> on the homepage, not an external file),
 * by uploading a real file and inspecting both the multipart request and the
 * `location.href` it builds on success. Verified against the live endpoint: a plain
 * server-side POST with no cookies/session/referer returns `{code: 1000, upload, regdate}`.
 */
export async function uploadToGettyImageBankSearch(image: Blob): Promise<{ resultUrl: string }> {
  const form = new FormData();
  form.append("file", image, "screenshot.png");
  form.append("mode", "move");
  form.append("upload_file_type", "image");
  form.append("site", "gib");
  form.append("lv", "");
  form.append("st", "union");

  const res = await fetch(UPLOAD_URL, { method: "POST", body: form, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) {
    throw new Error(`게티이미지뱅크 업로드 요청이 실패했습니다 (HTTP ${res.status})`);
  }

  const data = (await res.json()) as UploadResponse;
  if (data.code !== 1000 || !data.upload) {
    throw new Error(`게티이미지뱅크 업로드가 거부되었습니다 (code: ${data.code})`);
  }

  const resultUrl = `${RESULT_HOST}/s/?lv=&st=union&mi=2&q=&ssi=go&s3=${encodeURIComponent(data.upload)}&regdate=${encodeURIComponent(data.regdate ?? "")}&mode=byimage`;
  return { resultUrl };
}
