# 게티이미지코리아 자동 업로드 이미지 검색 — 설계

- 작성일: 2026-08-05
- 배경: 미리보기(`/projects/{id}/preview`) 화면의 `RelatedImageSearch` 컴포넌트에는 이미 씬 이미지에서 영역을 크롭해 게티이미지코리아로 넘기는 "스크린샷 검색" 버튼이 있다. 다만 브라우저가 다른 origin의 파일 업로드 위젯에 프로그래밍적으로 파일을 넣을 수 없다는 제약 때문에, 지금은 크롭 이미지를 클립보드에 복사하고 사이트를 새 탭으로 연 뒤 사용자가 직접 Cmd+V로 붙여넣거나 드래그해야 완료된다. 이 스펙은 그 마지막 수동 단계를 서버 프록시로 자동화하는 것을 다룬다.

## 조사 결과 (검증됨)

- 코드가 원래 가리키던 `rfpro.gettyimageskorea.com`(유료 PRO)에는 이미지 업로드 검색 기능 자체가 없다. 실제 업로드 검색이 되는 곳은 `www.gettyimageskorea.com`(→ `mbdrive.gettyimageskorea.com`, 무료/일반 카탈로그, 로그인 불필요)이다.
- 업로드 API는 사이트의 인라인 JS(`F_FileMultiUpload_Send`)에서 발견했고 curl로 직접 검증했다. 세션/쿠키 없이 stateless로 동작한다.

  ```
  POST https://mbdrive.gettyimageskorea.com/search/searchByImage
  Content-Type: multipart/form-data

  file=<이미지 blob>       # 필드명이 "file"이다. 페이지의 <input id="searchByImgFile">는
                            # 브라우저용 file input일 뿐, 실제 전송 필드명과 다르다.
  mode=move
  searchTo=                # 보통 빈 문자열
  site=creative
  watch=rf
  ```

  응답: `{"upload":"jv_<hash>.png","rcode":"","code":1000}` (성공) / `code`가 1000이 아니면 실패.

  성공 시 결과 페이지 URL:
  ```
  https://mbdrive.gettyimageskorea.com/creative/?cs=on&lct=rm%2Crf&s3=<upload 값>&searchByImage=Y&mode=&searchFileType=img
  ```

- 이 엔드포인트는 `Access-Control-Allow-Origin: *`를 응답하지만, 비공식 API이므로 서버(Next.js API 라우트)에서 프록시 호출하는 방식을 택한다 — 계약 세부사항(고정 필드값 등)을 클라이언트 번들에 노출하지 않고, 실패 시 폴백 로직을 한곳에 모으기 위함.
- 제약: JPG/PNG만 허용, 최대 20MB. 사이트 자체 JS는 업로드 전 1000px로 리사이즈하지만, API 자체는 리사이즈 없이도 정상 동작함을 확인했다 — 화면 크롭 이미지는 크지 않으므로 리사이즈 단계는 넣지 않는다(새 의존성 불필요).

## 아키텍처

```
[RelatedImageSearch.tsx]
   크롭 완료 (cropIntent === "koreaSearch")
        │  blob (image/png)
        ▼
[POST /api/imageSearch/gettyimageskorea]  (Next.js route handler, 얇은 래퍼)
        │  multipart/form-data { image: blob }
        ▼
[lib/imageSearch/gettyImageSearchUpload.ts]
   uploadToGettyImageSearch(blob) → { resultUrl }
        │  프록시 POST (file/mode/searchTo/site/watch)
        ▼
[https://mbdrive.gettyimageskorea.com/search/searchByImage]
        │  { code: 1000, upload: "jv_xxx.png" }
        ▼
   resultUrl 조립 후 클라이언트에 반환
        │
        ▼
[클라이언트] window.open(resultUrl, "_blank")
```

- `lib/imageSearch/gettyImageSearchUpload.ts`: 순수 함수. 업스트림 호출과 응답 파싱만 담당하고, 실패 시(네트워크 오류 또는 `code !== 1000`) 에러를 throw한다. `lib/media/ffmpeg.ts`와 같은 기존 패턴처럼 콜로케이트 테스트(`gettyImageSearchUpload.test.ts`)에서 `fetch`를 모킹해 성공/실패 케이스를 검증한다.
- `app/api/imageSearch/gettyimageskorea/route.ts`: `request.formData()`로 이미지를 받아 위 함수를 호출하고 `{ resultUrl }` 또는 에러 JSON을 반환하는 얇은 래퍼. 별도 단위 테스트는 두지 않는다(이 프로젝트의 다른 API 라우트도 로직을 lib로 위임하고 라우트 자체는 테스트하지 않는 패턴을 따름).

## 클라이언트 변경

**`lib/imageSearchSites.ts`**: `gettyimageskorea-pro` 항목의 `keywordSearchUrl`/`imageSearchUrl`을 `mbdrive.gettyimageskorea.com` 기준으로 교체한다(id/라벨은 유지 — 라벨이 이미 "게티이미지코리아"이고, id를 바꾸면 `localStorage`에 저장된 사용자 선택이 리셋된다).

```ts
keywordSearchUrl: (keyword) =>
  `https://mbdrive.gettyimageskorea.com/creative/?q=${encodeURIComponent(keyword)}&cs=on&lct=rm%2Crf`,
imageSearchUrl: () => "https://mbdrive.gettyimageskorea.com/",
```

**`components/RelatedImageSearch.tsx`**: `cropIntent === "koreaSearch"`일 때만 동작을 분기한다.

- 기존 `"select"` 의도(범용 크롭, 다른 사이트 포함)는 지금처럼 클립보드 복사 + 사이트 홈 새 탭 그대로 유지한다.
- `"koreaSearch"` 의도는 새 함수 `handleGettyKoreaAutoSearch(blob)`으로 처리한다:
  1. 버튼에 업로드 중 상태를 표시한다("업로드 중...").
  2. blob을 `FormData`로 `/api/imageSearch/gettyimageskorea`에 POST한다.
  3. 성공하면 응답의 `resultUrl`을 `window.open(..., "_blank", "noopener,noreferrer")`으로 연다. 클립보드 복사·다운로드 단계는 생략한다.
  4. 실패(네트워크 오류, 응답 에러, 타임아웃 — 세분화하지 않고 단일 경로로 처리)하면 기존 `handleImageForSearch(blob, { autoDownload: true })` 수동 폴백으로 전환하고, "자동 업로드에 실패해 수동 방식으로 전환했습니다" 안내 문구를 보여준다. 기존 `pendingThumbnail` UI(드래그/붙여넣기 안내)가 그대로 안전망 역할을 한다.

## 에러 처리

실패 원인(네트워크 오류, 업스트림 `code !== 1000`, 타임아웃)을 세분화해서 다른 메시지를 보여주지 않는다 — 전부 "자동 업로드 실패 → 수동 방식 폴백" 한 경로로 묶는다. 이 비공식 엔드포인트는 사전 공지 없이 계약이 바뀔 수 있으므로, 실패를 세밀하게 다루기보다 안정적인 수동 폴백이 항상 살아있게 하는 쪽이 중요하다.

## 테스트

- `lib/imageSearch/gettyImageSearchUpload.test.ts`: `fetch`를 모킹해 (1) 성공 응답 → `resultUrl` 조립 검증, (2) `code !== 1000` 응답 → throw, (3) 네트워크 오류 → throw.
- UI 동작(업로드 중 상태, 성공 시 새 탭, 실패 시 폴백)은 기존 프로젝트 관례상 수동 브라우저 확인으로 검증한다(이 컴포넌트의 다른 크롭/클립보드 로직도 자동화 테스트가 없다).
