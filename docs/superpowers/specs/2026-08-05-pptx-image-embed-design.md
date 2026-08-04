# PPTX 내보내기에 생성 이미지/목업 삽입 — 설계

## 배경 및 목표

현재 pptx 내보내기(`lib/pptx/exportPptx.ts`, `app/api/projects/[projectId]/storyboard/pptx/route.ts`)는 씬 텍스트(과정명/자막/설명/배치/키워드/나레이션 등)만 `{{placeholder}}` 치환으로 채우고, 화면 이미지 자리는 "화면 (스크린샷을 붙여넣으세요)"라는 빈 점선 박스로 남겨 사용자가 수동으로 붙여넣어야 했다.

이 작업은 씬별로:
- AI로 생성된 이미지가 있으면 그 이미지를,
- 없으면(아직 생성 전, 또는 제목 씬처럼 생성 대상이 아닌 씬) 화면 설계 데이터를 반영한 목업 이미지를

각 슬라이드의 화면 박스 자리에 실제로 삽입하도록 만든다. 사용자가 별도로 켜고 끄는 옵션 없이 항상 적용된다(YAGNI — 토글은 추가하지 않음).

## 아키텍처 / 데이터 흐름

### 1. 새 모듈: `lib/pptx/renderMockupImage.ts`

`next/og`의 `ImageResponse`(Satori)를 사용해 씬의 `VisualDesign`과 `screenType`으로부터 PNG 버퍼를 만드는 서버 전용 함수.

- `ScreenMockup.tsx`의 `LayoutElementsMockup`(3x3 그리드에 `layoutElements`를 배치하고 하단에 `caption` 표시)을 인라인 스타일만으로 재현한다. Satori는 Tailwind 클래스나 CSS 커스텀 프로퍼티를 지원하지 않으므로 `ScreenMockup.tsx`를 직접 재사용할 수 없다 — `lib/video/renderSceneFrame.tsx`가 이미 같은 이유로 별도 레이아웃을 두고 있는 것과 동일한 제약.
- `design.layoutElements`가 없거나 비어 있으면(구버전 데이터) 자막(`caption`)과 화면유형 이름만 중앙에 크게 표시하는 단순 카드로 대체한다. 14개 화면유형별 전용 목업(간지/타이틀형, 표/그래프형 등)은 이번 범위에 포함하지 않는다.
- `renderSceneFrameToPng.ts`와 동일한 방식으로 `assets/fonts`의 Pretendard 폰트를 로드한다(같은 캐시 패턴 재사용).
- 호출부(아래 pptx route)가 대상 박스의 실제 EMU 크기로부터 계산한 가로세로 비율을 그대로 렌더 해상도로 넘겨준다 — 그 결과 이 함수가 만든 PNG는 삽입될 박스와 정확히 같은 비율이 되어, `buildScenePptx` 쪽 크롭 로직이 사실상 no-op이 된다.

### 2. `lib/pptx/exportPptx.ts`의 `buildScenePptx` 확장

새 선택적 파라미터로 `perSlideImages: (Buffer | undefined)[]`(씬 순서대로 `perSlideData`와 병렬)를 받는다.

슬라이드를 복제/치환하는 기존 루프 안에서, 슬라이드마다:

1. 템플릿 슬라이드 XML에서 `<p:cNvPr ... name="화면 영역" .../>`을 가진 도형(`<p:sp>`)을 찾는다. 이 이름은 `lib/pptx/defaultTemplate.ts`의 `screenBoxXml`이 이미 사용하는 값과 동일 — 기본/노트북LM 템플릿은 별도 수정 없이 바로 이 규칙을 탄다. 사용자가 업로드한 커스텀 템플릿도 도형 이름이 일치하면 동일하게 적용되고, 없으면 지금처럼 텍스트만 채워진다(하위 호환).
2. 도형을 찾았고 해당 씬의 이미지 버퍼가 있으면:
   - 그 도형의 `<a:off>`/`<a:ext>`(위치/크기)를 읽는다.
   - 도형 `<p:sp>`를 슬라이드 XML에서 제거하고, 같은 위치/크기의 `<p:pic>`으로 대체한다.
   - 이미지 바이트를 `ppt/media/pptxImageN.png`로 zip에 추가한다(N은 전체 zip 기준 증가하는 카운터 — 기존 `nextSlideNum`/`nextRidNum` 계산 패턴과 동일하게 충돌 방지).
   - 이 슬라이드의 관계 파일(`_rels/slideN.xml.rels`)에 새 이미지 관계(rId)를 추가한다. 지금은 템플릿의 rels를 그대로 복제하지만, 이미지가 있는 슬라이드는 슬라이드마다 관계가 달라지므로 슬라이드별로 새로 만든다.
   - `[Content_Types].xml`에 `<Default Extension="png" .../>`가 없으면 1회 추가한다(개별 이미지마다 Override는 필요 없음).
   - PNG 버퍼의 IHDR 청크에서 실제 픽셀 가로/세로를 읽는 작은 헬퍼로 원본 비율과 박스 비율을 비교해 `<a:srcRect>` crop을 계산한다(= 미리보기/영상 프레임과 동일한 "cover" 방식 — 잘라내되 늘리지 않음). 두 비율이 같으면(목업 케이스) crop은 0이 된다.
3. 도형이 없거나 해당 씬 이미지가 없으면 지금과 완전히 동일하게 텍스트만 치환된 슬라이드가 나온다.

### 3. `app/api/projects/[projectId]/storyboard/pptx/route.ts`

씬마다:
- `readProjectImage(projectId, scene.id)`로 저장된 생성 이미지를 먼저 조회(이미 서버 쪽 파일 시스템에 있으므로 HTTP 왕복 없이 직접 읽음).
- 없으면 `renderMockupImage`로 목업 PNG를 생성.
- 두 경우 모두 실패하면(아래 에러 처리 참고) `undefined`로 두어 해당 슬라이드는 이미지 없이 나가게 한다.

결과 배열을 기존 `perSlideData`와 함께 `buildScenePptx`에 전달한다.

## 에러 처리

씬 단위로 독립 처리하여 한 씬의 문제가 전체 export를 실패시키지 않는다:

- `readProjectImage` 실패/파일 없음 → 목업 렌더링으로 폴백(정상 흐름, 에러 아님).
- 목업 렌더링(Satori) 실패 → 해당 슬라이드는 기존처럼 빈 "화면 영역" placeholder 그대로 두고 `console.error`로 로그만 남긴다. 전체 요청은 계속 진행된다.
- 템플릿에 `"화면 영역"` 이름의 도형이 없음 → 조용히 텍스트 전용 모드로 동작(에러 아님, 기존 커스텀 템플릿과의 하위 호환).
- 전달된 PNG 버퍼가 손상되어 있거나 IHDR을 읽을 수 없는 경우 → crop 없이 원본을 그대로 스트레치 삽입한다(최악의 경우 비율이 살짝 안 맞을 뿐, export 자체는 실패하지 않음).
- 제목(title) 씬처럼 애초에 이미지 생성 대상이 아닌 씬은 `readProjectImage`가 자연히 빈 값을 반환하므로 별도 분기 없이 목업 경로를 탄다.

## 테스트

- `lib/pptx/exportPptx.test.ts`에 케이스 추가:
  - `perSlideImages` 전달 시 슬라이드 XML에 `<p:pic>`이 생기고 `"화면 영역"` 도형은 사라지는지.
  - `ppt/media/*.png` 파트가 추가되고 슬라이드 rels의 rId로 올바르게 연결되는지.
  - `[Content_Types].xml`에 png `Default`가 중복 없이 추가되는지.
  - 특정 씬에 이미지가 없으면 그 슬라이드만 텍스트 전용으로 남는지.
  - 템플릿에 `"화면 영역"` 도형이 아예 없으면 `perSlideImages`를 넘겨도 기존 결과와 동일한지(회귀 방지).
- 새 `lib/pptx/renderMockupImage.test.ts`:
  - `layoutElements`가 있는 씬 → 유효한 PNG(매직 바이트 확인) + 요청한 가로세로 비율로 렌더되는지.
  - `layoutElements`가 없는 씬 → 자막/화면유형만 있는 카드로 폴백해도 유효한 PNG가 나오는지.
- 라우트 레벨 자동 테스트는 추가하지 않는다(기존 pptx route도 테스트가 없고, 파이프라인은 lib 단위 테스트로 커버하는 기존 패턴 유지). 대신 구현 완료 후 실제 프로젝트로 다운로드해 PowerPoint/Keynote/LibreOffice로 열어 육안 확인한다.

## 범위 밖

- 사용자가 이미지/목업 삽입 여부를 끄는 UI 토글.
- 화면유형별(14종) 전용 목업 디자인 — 이번엔 `layoutElements` 그리드 하나로 통일.
- 커스텀 업로드 템플릿에 "화면 영역" 도형이 자동으로 생기게 만드는 기능(사용자가 PowerPoint에서 직접 도형 이름을 바꿔야 적용됨 — 문서화는 후속 과제로 남김).
