# 게티이미지코리아 자동 업로드 이미지 검색 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 미리보기 화면의 "스크린샷 검색" 버튼이 크롭한 이미지를 자동으로 게티이미지코리아에 업로드하고 검색 결과 페이지를 바로 열도록 만든다 — 지금처럼 클립보드에 복사해두고 사용자가 직접 붙여넣는 수동 단계를 없앤다.

**Architecture:** 클라이언트(`RelatedImageSearch.tsx`)가 크롭한 blob을 새 Next.js API 라우트(`/api/imageSearch/gettyimageskorea`)로 전송하면, 그 라우트가 순수 함수(`lib/imageSearch/gettyImageSearchUpload.ts`)를 통해 게티이미지코리아의 비공식 업로드 엔드포인트를 서버에서 프록시 호출하고, 결과 페이지 URL을 조립해 반환한다. 실패하면 클라이언트는 기존의 수동(클립보드+다운로드+새 탭) 폴백으로 전환한다.

**Tech Stack:** Next.js App Router API route, Vitest(+`vi.stubGlobal("fetch", ...)`), React(기존 컴포넌트에 상태 추가).

## Global Constraints

- 업로드 엔드포인트: `POST https://mbdrive.gettyimageskorea.com/search/searchByImage` (multipart/form-data)
- 필드(정확히 이 이름/값): `file=<이미지 blob>`, `mode=move`, `searchTo=`(빈 문자열), `site=creative`, `watch=rf`
- 성공 응답: `{"code":1000,"upload":"jv_xxxx.png"}` — `code !== 1000`이거나 `upload`가 없으면 실패로 처리
- 결과 URL 템플릿: `https://mbdrive.gettyimageskorea.com/creative/?cs=on&lct=rm%2Crf&s3=<upload 값>&searchByImage=Y&mode=&searchFileType=img`
- 이미지 리사이즈는 하지 않는다(새 의존성 추가 금지, YAGNI)
- 실패 원인(네트워크 오류/비1000 코드/타임아웃)은 세분화하지 않고 전부 동일하게 "자동 업로드 실패 → 수동 폴백"으로 처리한다
- 참고 스펙: `docs/superpowers/specs/2026-08-05-getty-image-search-design.md`

---

## Task 1: 업로드 프록시 함수 (`lib/imageSearch/gettyImageSearchUpload.ts`)

**Files:**
- Create: `lib/imageSearch/gettyImageSearchUpload.ts`
- Test: `lib/imageSearch/gettyImageSearchUpload.test.ts`

**Interfaces:**
- Produces: `uploadToGettyImageSearch(image: Blob): Promise<{ resultUrl: string }>` — 성공 시 결과 URL을 반환하고, 실패 시(HTTP 오류 또는 `code !== 1000`) `Error`를 throw한다. Task 2가 이 함수를 소비한다.

- [ ] **Step 1: 실패하는 테스트 작성**

`lib/imageSearch/gettyImageSearchUpload.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { uploadToGettyImageSearch } from "./gettyImageSearchUpload";

describe("uploadToGettyImageSearch", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function mockFetchOk(body: unknown) {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => body,
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("builds the result URL from a successful upload response", async () => {
    mockFetchOk({ code: 1000, upload: "jv_abc123.png", rcode: "" });
    const blob = new Blob(["fake-image-bytes"], { type: "image/png" });

    const { resultUrl } = await uploadToGettyImageSearch(blob);

    expect(resultUrl).toBe(
      "https://mbdrive.gettyimageskorea.com/creative/?cs=on&lct=rm%2Crf&s3=jv_abc123.png&searchByImage=Y&mode=&searchFileType=img"
    );
  });

  it("posts the exact field contract the upstream endpoint expects", async () => {
    const fetchMock = mockFetchOk({ code: 1000, upload: "jv_x.png" });
    const blob = new Blob(["bytes"], { type: "image/png" });

    await uploadToGettyImageSearch(blob);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://mbdrive.gettyimageskorea.com/search/searchByImage");
    expect(init.method).toBe("POST");
    const form = init.body as FormData;
    expect(form.get("mode")).toBe("move");
    expect(form.get("searchTo")).toBe("");
    expect(form.get("site")).toBe("creative");
    expect(form.get("watch")).toBe("rf");
    expect(form.get("file")).toBeInstanceOf(Blob);
  });

  it("throws when the upstream responds with a non-1000 code", async () => {
    mockFetchOk({ code: 1001, rcode: "" });
    const blob = new Blob(["bytes"], { type: "image/png" });

    await expect(uploadToGettyImageSearch(blob)).rejects.toThrow(/code: 1001/);
  });

  it("throws when the upstream HTTP request itself fails", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 502, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);
    const blob = new Blob(["bytes"], { type: "image/png" });

    await expect(uploadToGettyImageSearch(blob)).rejects.toThrow(/HTTP 502/);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run lib/imageSearch/gettyImageSearchUpload.test.ts`
Expected: FAIL — `Cannot find module './gettyImageSearchUpload'` (파일이 아직 없음)

- [ ] **Step 3: 구현 작성**

`lib/imageSearch/gettyImageSearchUpload.ts`:

```ts
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
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run lib/imageSearch/gettyImageSearchUpload.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: 커밋**

```bash
git add lib/imageSearch/gettyImageSearchUpload.ts lib/imageSearch/gettyImageSearchUpload.test.ts
git commit -m "$(cat <<'EOF'
Add Getty Images Korea reverse-image-search upload proxy function

Reverse-engineered field contract from the site's own upload JS
(F_FileMultiUpload_Send); see the design spec for the raw curl verification.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: API 라우트 (`/api/imageSearch/gettyimageskorea`)

**Files:**
- Create: `app/api/imageSearch/gettyimageskorea/route.ts`

**Interfaces:**
- Consumes: `uploadToGettyImageSearch(image: Blob): Promise<{ resultUrl: string }>` from Task 1 (`@/lib/imageSearch/gettyImageSearchUpload`)
- Produces: `POST /api/imageSearch/gettyimageskorea` accepting `multipart/form-data` with a `image` file field. Returns `200 { resultUrl: string }` on success, or `400`/`502 { error: string }` on failure. Task 4 consumes this HTTP contract.

이 라우트는 기존 `app/api/projects/[projectId]/images/presenter-reference/route.ts`의 `formData()` 처리 패턴을 그대로 따른다. 이 프로젝트에는 API 라우트 자체를 도는 단위 테스트가 없으므로(로직은 항상 lib로 위임), 이 태스크는 별도 자동화 테스트 없이 타입체크/린트로 검증한다.

- [ ] **Step 1: 라우트 구현**

`app/api/imageSearch/gettyimageskorea/route.ts`:

```ts
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
```

- [ ] **Step 2: 린트 확인**

Run: `npm run lint`
Expected: 새 파일에서 에러 없음

- [ ] **Step 3: 개발 서버로 실제 호출 검증**

Run: `npm run dev` (백그라운드로 띄운 뒤, 별도 터미널에서)

```bash
curl -s -X POST http://localhost:9625/api/imageSearch/gettyimageskorea \
  -F "image=@/private/tmp/claude-501/-Users-kkoon-Projects-aid-three/68a55da1-aebb-42a4-a5de-0f3718687f0d/scratchpad/getty-search-sample.png;type=image/png"
```

Expected: `{"resultUrl":"https://mbdrive.gettyimageskorea.com/creative/?cs=on&lct=rm%2Crf&s3=jv_....png&searchByImage=Y&mode=&searchFileType=img"}` — 실제 업스트림을 타므로 매번 새 `s3` 값이 나온다. dev 서버는 확인 후 종료한다.

- [ ] **Step 4: 커밋**

```bash
git add app/api/imageSearch/gettyimageskorea/route.ts
git commit -m "$(cat <<'EOF'
Add API route proxying Getty Images Korea's upload search endpoint

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: `gettyimageskorea-pro` 사이트 항목을 mbdrive 도메인으로 전환

**Files:**
- Modify: `lib/imageSearchSites.ts`

**Interfaces:**
- Consumes: 없음
- Produces: `IMAGE_SEARCH_SITES`의 `id: "gettyimageskorea-pro"` 항목이 이제 `mbdrive.gettyimageskorea.com` 기준 URL을 반환한다. Task 4의 폴백 경로(`site.imageSearchUrl()`)와 배지 키워드 검색이 이 값을 사용한다.

- [ ] **Step 1: 파일 상단 주석과 `gettyimageskorea-pro` 항목 수정**

`lib/imageSearchSites.ts` 전체를 아래로 교체:

```ts
/**
 * Stock/reverse-image search sites usable from the preview page's "연관 이미지
 * 찾기" feature. For most sites, no automatic hand-off is possible — browsers
 * block injecting a file into another origin's upload widget, and this app has
 * no public URL for services like Google Lens's uploadbyurl to fetch from. Every
 * `imageSearchUrl` just opens the site's own image-search entry point in a new
 * tab; the caller is expected to have already copied the image to the clipboard
 * (and offered a draggable fallback) so the user can paste/drag it in there
 * themselves.
 *
 * "gettyimageskorea-pro" is the one exception: its upload endpoint is proxied
 * server-side (see lib/imageSearch/gettyImageSearchUpload.ts), so
 * RelatedImageSearch.tsx uploads automatically instead of using this site's
 * `imageSearchUrl` for that flow — `imageSearchUrl` here is only the fallback
 * destination when the automatic upload fails.
 *
 * To add a site, add one entry here — nothing else needs to change.
 */
export type ImageSearchSiteId = "getty" | "google" | "gettyimagesbank" | "gettyimageskorea-pro";

export interface ImageSearchSite {
  id: ImageSearchSiteId;
  label: string;
  keywordSearchUrl(keyword: string): string;
  imageSearchUrl(): string;
}

export const IMAGE_SEARCH_SITES: readonly ImageSearchSite[] = [
  {
    id: "getty",
    label: "게티 이미지",
    // /photos/{slug} only resolves for existing Getty tag pages (410s on an arbitrary phrase) —
    // /search/2/image-film?phrase= is the actual live full-text search, confirmed by using the
    // real search box on gettyimages.com.
    keywordSearchUrl: (keyword) => `https://www.gettyimages.com/search/2/image-film?family=creative&phrase=${encodeURIComponent(keyword)}`,
    imageSearchUrl: () => "https://www.gettyimages.com/",
  },
  {
    id: "google",
    label: "구글 이미지",
    keywordSearchUrl: (keyword) => `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(keyword)}`,
    imageSearchUrl: () => "https://images.google.com/",
  },
  {
    id: "gettyimagesbank",
    label: "게티이미지뱅크",
    keywordSearchUrl: (keyword) => `https://www.gettyimagesbank.com/s/?q=${encodeURIComponent(keyword)}`,
    imageSearchUrl: () => "https://www.gettyimagesbank.com/",
  },
  {
    id: "gettyimageskorea-pro",
    label: "게티이미지코리아",
    // rfpro.gettyimageskorea.com(유료 PRO 카탈로그)에는 이미지 업로드 검색 기능이 없어서,
    // 업로드 검색이 되는 mbdrive.gettyimageskorea.com(무료 카탈로그, 로그인 불필요)으로 통일했다.
    // 상세 조사 내용은 docs/superpowers/specs/2026-08-05-getty-image-search-design.md 참고.
    keywordSearchUrl: (keyword) =>
      `https://mbdrive.gettyimageskorea.com/creative/?q=${encodeURIComponent(keyword)}&cs=on&lct=rm%2Crf`,
    imageSearchUrl: () => "https://mbdrive.gettyimageskorea.com/",
  },
] as const;

export const DEFAULT_IMAGE_SEARCH_SITE: ImageSearchSiteId = "gettyimageskorea-pro";

export const IMAGE_SEARCH_SITE_STORAGE_KEY = "imageSearchSite";

export function getImageSearchSite(id: ImageSearchSiteId): ImageSearchSite {
  const site = IMAGE_SEARCH_SITES.find((s) => s.id === id);
  if (!site) throw new Error(`알 수 없는 이미지 검색 사이트입니다: ${id}`);
  return site;
}
```

- [ ] **Step 2: 타입체크/린트 확인**

Run: `npm run lint`
Expected: 에러 없음(순수 문자열/주석 변경이라 타입 영향 없음)

- [ ] **Step 3: 커밋**

```bash
git add lib/imageSearchSites.ts
git commit -m "$(cat <<'EOF'
Point Getty Images Korea site entry at the upload-capable mbdrive domain

rfpro (PRO catalog) has no image-upload search at all; mbdrive (free
catalog, no login) is what the new automated upload flow talks to.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: `RelatedImageSearch.tsx`에 자동 업로드 연결

**Files:**
- Modify: `components/RelatedImageSearch.tsx`

**Interfaces:**
- Consumes: `POST /api/imageSearch/gettyimageskorea` (Task 2) — `FormData` with `image` field, response `{ resultUrl: string }` or `{ error: string }`. `getImageSearchSite("gettyimageskorea-pro").imageSearchUrl()` (Task 3) as the fallback destination.
- Produces: 없음(리프 컴포넌트)

- [ ] **Step 1: `uploading` 상태 추가**

`components/RelatedImageSearch.tsx`의 상태 선언부(현재 8번째 `useState`, `const [error, setError] = useState<string | null>(null);` 바로 아래)에 추가:

```ts
const [uploading, setUploading] = useState(false);
```

- [ ] **Step 2: 자동 업로드 함수 추가**

`handleImageForSearch` 함수 정의 바로 아래에 새 함수를 추가:

```ts
async function handleGettyKoreaAutoSearch(blob: Blob) {
  setError(null);
  setUploading(true);
  try {
    const form = new FormData();
    form.append("image", blob, "screenshot.png");
    const res = await fetch("/api/imageSearch/gettyimageskorea", { method: "POST", body: form });
    const data = await res.json();
    if (!res.ok || !data.resultUrl) throw new Error(data.error ?? "업로드에 실패했습니다");
    window.open(data.resultUrl, "_blank", "noopener,noreferrer");
  } catch {
    setError("자동 업로드에 실패해 수동 방식으로 전환했습니다");
    await handleImageForSearch(blob, { autoDownload: true });
  } finally {
    setUploading(false);
  }
}
```

- [ ] **Step 3: `handleMouseUp`의 크롭 완료 분기 수정**

기존:

```ts
    canvas.toBlob((blob) => {
      if (blob) void handleImageForSearch(blob, { autoDownload: intent === "koreaSearch" });
      else setError("영역 캡처에 실패했습니다");
    }, "image/png");
```

다음으로 교체:

```ts
    canvas.toBlob((blob) => {
      if (!blob) {
        setError("영역 캡처에 실패했습니다");
        return;
      }
      if (intent === "koreaSearch") void handleGettyKoreaAutoSearch(blob);
      else void handleImageForSearch(blob);
    }, "image/png");
```

- [ ] **Step 4: `handleImageForSearch`의 `autoDownload` 주석을 폴백 전용으로 갱신**

기존:

```ts
    if (opts?.autoDownload) {
      // 게티이미지코리아는 클립보드 붙여넣기가 아니라 실제 파일 업로드(카메라 아이콘)로 이미지 검색을
      // 하므로, 새 탭을 열기 전에 파일을 미리 다운로드해 사용자가 바로 업로드할 수 있게 한다.
      downloadBlob(blob, `screenshot-${Date.now()}.png`);
    }
```

다음으로 교체:

```ts
    if (opts?.autoDownload) {
      // 게티이미지코리아 자동 업로드(handleGettyKoreaAutoSearch)가 실패했을 때만 여기로 온다 —
      // 클립보드 붙여넣기가 안 통하는 사이트이므로, 새 탭을 열기 전에 파일을 미리 다운로드해
      // 사용자가 수동으로 업로드할 수 있게 한다.
      downloadBlob(blob, `screenshot-${Date.now()}.png`);
    }
```

- [ ] **Step 5: 컴포넌트 상단 docstring 갱신**

기존:

```ts
/**
 * Per-scene "연관 이미지 찾기" controls for the preview page: click a keyword
 * to open a text search on the chosen site, or crop a region of the scene's
 * generated image (or paste an OS screenshot) to search visually.
 *
 * No supported site can be linked to automatically with a locally captured
 * image (see lib/imageSearchSites.ts) — every image-based search copies the
 * image to the clipboard, opens the site in a new tab, and also offers a
 * draggable thumbnail fallback for sites whose upload widget doesn't accept
 * paste. The user finishes the hand-off themselves (Cmd+V or drag).
 */
```

다음으로 교체:

```ts
/**
 * Per-scene "연관 이미지 찾기" controls for the preview page: click a keyword
 * to open a text search on the chosen site, or crop a region of the scene's
 * generated image (or paste an OS screenshot) to search visually.
 *
 * Most sites can't be linked to automatically with a locally captured image
 * (see lib/imageSearchSites.ts) — those image-based searches copy the image
 * to the clipboard, open the site in a new tab, and also offer a draggable
 * thumbnail fallback for sites whose upload widget doesn't accept paste. The
 * user finishes the hand-off themselves (Cmd+V or drag).
 *
 * Getty Images Korea ("스크린샷 검색" button, isGettyKorea) is the exception:
 * the crop is uploaded automatically via handleGettyKoreaAutoSearch (proxied
 * server-side, see lib/imageSearch/gettyImageSearchUpload.ts) and the results
 * page opens directly. If that upload fails, it falls back to the same manual
 * clipboard/download flow as every other site.
 */
```

- [ ] **Step 6: 버튼에 업로드 중 상태 표시**

기존 "스크린샷 검색" 버튼:

```tsx
          {isGettyKorea && (
            <Button type="button" variant="outline" size="sm" onClick={() => startCrop("koreaSearch")} title="영역을 선택하면 자동으로 저장하고 게티이미지코리아를 엽니다">
              <Camera className="size-3.5" />
              {cropMode && cropIntent === "koreaSearch" ? "영역 선택 취소" : "스크린샷 검색"}
            </Button>
          )}
```

다음으로 교체:

```tsx
          {isGettyKorea && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => startCrop("koreaSearch")}
              disabled={uploading}
              title="영역을 선택하면 자동으로 업로드하고 게티이미지코리아 검색 결과를 엽니다"
            >
              <Camera className="size-3.5" />
              {uploading ? "업로드 중..." : cropMode && cropIntent === "koreaSearch" ? "영역 선택 취소" : "스크린샷 검색"}
            </Button>
          )}
```

- [ ] **Step 7: 린트 확인**

Run: `npm run lint`
Expected: 에러 없음

- [ ] **Step 8: 개발 서버에서 수동 확인**

Run: `npm run dev`, 브라우저로 아무 프로젝트의 `/projects/{id}/preview` 접속(씬 이미지가 생성되어 있어야 함):

1. 이미지 검색 사이트 드롭다운이 "게티이미지코리아"인지 확인(기본값)
2. 씬 카드에서 "스크린샷 검색" 버튼 클릭 → "이미지에서 영역 선택" 크롭 UI가 뜨는지 확인
3. 이미지 위에서 드래그로 영역 선택 → 버튼이 "업로드 중..."으로 바뀌는지 확인
4. 1~2초 후 새 탭이 열리고 `mbdrive.gettyimageskorea.com/creative/?...&s3=jv_...&searchByImage=Y...`로 이동해 검색 결과(업로드한 영역과 유사한 이미지들)가 보이는지 확인
5. (선택) 네트워크를 잠깐 끊거나 개발자도구에서 `/api/imageSearch/gettyimageskorea` 요청을 실패시켜, 폴백 경로("자동 업로드에 실패해 수동 방식으로 전환했습니다" 메시지 + 클립보드 복사 안내 + mbdrive 홈 새 탭)가 그대로 동작하는지 확인

Expected: 3~4단계가 자동으로 이어져서 별도 붙여넣기 없이 검색 결과가 바로 열림

- [ ] **Step 9: 전체 테스트 스위트 및 커밋**

Run: `npx vitest run`
Expected: 전체 PASS (Task 1의 새 테스트 포함, 기존 테스트 회귀 없음)

```bash
git add components/RelatedImageSearch.tsx
git commit -m "$(cat <<'EOF'
Auto-upload Getty Images Korea screenshot search instead of manual paste

The "스크린샷 검색" crop now POSTs straight to the new upload-proxy route
and opens the results page directly; any failure falls back to the
existing clipboard/download hand-off.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review Notes

- **스펙 커버리지**: 아키텍처(Task 1+2), 클라이언트 변경(Task 3+4), 에러 처리(Task 4 Step 2/8), 테스트(Task 1)까지 스펙의 모든 섹션에 대응하는 태스크가 있다.
- **플레이스홀더 없음**: 모든 스텝에 실제 코드/명령을 포함시켰다.
- **타입 일관성**: `uploadToGettyImageSearch(image: Blob): Promise<{ resultUrl: string }>` 시그니처를 Task 1(정의)·Task 2(호출)에서 동일하게 사용했고, API 응답 필드명(`resultUrl`/`error`)도 Task 2(생성)·Task 4(소비)에서 일치한다.
