# 파이프라인 단계별 입출력 명세 (구현 레퍼런스)

이 문서는 [설계 문서](../superpowers/specs/2026-07-27-elearning-storyboard-generator-design.md)의 파이프라인 단계를 구현 시 참고할 상세 계약(contract)으로 정리한 것이다. `lib/pipeline/*` 모듈을 작성할 때 이 입출력 형태를 기준으로 삼는다.

## 공통 원칙

- 각 단계 모듈은 `(input) => Promise<output>` 형태의 순수 함수형 인터페이스로 작성한다. 호출부는 내부 구현이 Node 함수인지, 외부 프로세스 위임인지 알 필요가 없다.
- 각 단계의 출력은 해당 단계의 JSON 파일에 그대로 저장 가능한 구조로 반환한다.
- AI 호출은 DeepSeek 클라이언트 인터페이스를 통해서만 이뤄지며, 테스트 시 목(mock)으로 대체 가능해야 한다.

## 씬 모드 vs 시퀀스 모드 (2026-08-07)

`project.json`의 `productionMode`(`getProductionMode()`, `lib/projects/types.ts`)에 따라 파이프라인 단계 구성이 갈라진다. 전체 배경은 [`docs/PROJECT_OVERVIEW.md`](../PROJECT_OVERVIEW.md)의 "씬·시퀀스 이중 제작 모드" 섹션 참고.

- 씬 모드(기본값, 레거시 프로젝트 포함): 마크다운 변환 → 씬 분할 → 화면 설계 → 일관성 검수 → 이미지 생성 → 최종 스토리보드 뷰. **`sequences` 단계 없음.**
- 시퀀스 모드(opt-in): 마크다운 변환 → 씬 분할 → **시퀀스 설계(`sequences`)** → 화면 설계 → 일관성 검수 → 이미지 생성 → 최종 스토리보드 뷰. 시퀀스 설계 단계는 씬 분할 직후, 화면 설계 이전에 위치한다 — 화면 설계(단계 3)가 시퀀스의 연속성/마스터 비주얼/카메라 지시를 프롬프트 컨텍스트로 받아 쓰기 때문(아래 단계 3의 "시퀀스 모드 확장" 참고).

## 단계 1 — 마크다운 변환

**입력**
- 원본 파일 내용 (pdf 텍스트 추출 결과 또는 txt 원문)
- 타입 플래그: `script`(원고) | `narration`(나레이션)

**출력**
- `narration.md`: 나레이션체 마크다운 문서
  - `script` 타입: 내용을 나레이션체로 변환
  - `narration` 타입: 내용 수정 없이 형태만 마크다운으로 정리
- `document-summary.txt`: 문서 전체를 3~5문장으로 요약한 개요 (`lib/pipeline/summarizeDocument.ts`, flash 모델 1회 호출). 마크다운 변환 완료 직후 생성하며, **실패해도 마크다운 단계 자체는 실패시키지 않는다**(로그만 남기고 건너뜀) — 단계 3(화면 설계)에서 씬별 AI 판단에 문서 전체 맥락을 주기 위한 보조 자료일 뿐, 필수 산출물이 아니기 때문.

## 단계 2 — 씬 분할

**입력**
- 나레이션 (`narration.md`)
- 씬 길이 기준
  - 일반 화면: 8~20초
  - 강조 화면: 4~10초
  - 표/그래프 설명: 15~30초
  - 절차 애니메이션: 15~40초

**분할 판단 기준**
- 문장종결
- 주제전환
- 설명 대상 변경
- 화면 유형 변경
- 열거 시작과 종료
- 사례 또는 질문
- 표/그래프 등장
- 예상 재생시간

**출력** (`scenes.json`)
```json
{
  "scenes": [
    {
      "id": "scene-001",
      "order": 1,
      "narrationText": "원문에서 분절된 그대로의 텍스트",
      "estimatedDurationSec": 12,
      "splitReason": "주제전환"
    }
  ]
}
```

**제약**: `narrationText`는 원문을 임의로 수정하지 않고 분절만 한다. 전체 씬의 `narrationText`를 순서대로 이어붙였을 때 원문(`narration.md`)과 일치해야 하며, 불일치 시 UI에서 경고를 띄운다(저장은 허용).

## 단계 2.5 — 시퀀스 설계 (`sequences`, 시퀀스 모드 전용)

씬 모드 프로젝트에는 이 단계 자체가 없다(파이프라인 단계 목록에 나타나지 않고, API 라우트를 호출해도 씬 모드 프로젝트에서는 서버 사이드로 화면 설계 단계로 리다이렉트된다). `getProductionMode(project) === "sequence"`인 프로젝트에서만 씬 분할과 화면 설계 사이에 위치한다.

**입력**
- `scenes.json`의 전체 씬(순서/나레이션/`sceneType`)

**출력** (`sequences.json`) — 정확한 타입 정의는 `lib/pipeline/sequenceTypes.ts`(`Sequence`, `SequencePlan`, `ShotType`, `CameraMotion`, `OverlayType`)를 정본으로 삼는다. 요지만 옮기면:

```ts
interface SequencePlan {
  version: 1;
  sequences: Sequence[]; // id, order, title, sceneIds, estimatedDurationSec,
                          // purpose, continuity, masterVisual, cameraPlan, overlays, needsReview?
}
```

- `sceneIds`는 `scenes.json`의 씬 ID를 순서대로 참조만 할 뿐 나레이션을 복제하지 않는다 — 나레이션이 필요하면 항상 `scenes.json`에서 조회한다.
- 타이틀 씬(`sceneType === "title"`)은 `sceneIds`에 포함되지 않는 것이 정책이며, 위반 시 `validateSequenceIntegrity`(`lib/pipeline/validateSequenceIntegrity.ts`)가 `title-scene-included` 오류를 낸다.
- `estimatedDurationSec`는 AI/사용자가 매긴 추정치일 뿐 신뢰된 값이 아니다 — 검증기는 참조된 씬들의 `estimatedDurationSec` 합계로 실제 총 길이를 독자적으로 계산해 큰 불일치를 `duration-mismatch`로 표시한다.
- 콘텐츠 씬은 정확히 한 번, `scenes.json`과 같은 상대 순서로 등장해야 한다(누락/중복/순서 불일치는 각각 `missing-scene-reference`/`duplicate-scene-reference`/`scene-order-mismatch`).
- 저장/조회 API: `POST /api/projects/{id}/sequences`(AI 생성, 작업 레지스트리 사용, NDJSON 스트림), `PUT /api/projects/{id}/sequences`(수동 편집 저장, 저장 전 무결성 검증).
- 마스터 비주얼 생성은 이 단계 안에서 자동으로 일어나지 않는다 — 명시적 액션(`POST /api/projects/{id}/sequences/{sequenceId}/master-image`)으로만 실행되는 별도 스텝이며, 실제 과금되는 이미지 생성 호출이다. 생성 결과는 `sequences.json`의 해당 시퀀스 `masterVisual.status`/`masterVisual.assetId`를 원자적으로 갱신한다.

**시퀀스 에셋 저장 경로**: 마스터 이미지는 씬 이미지(`images/{sceneId}.png`)와 별도로 `data/projects/{project-id}/sequence-assets/{sequenceId}/{assetId}.png`에 저장한다. `assetId`가 있어서 같은 시퀀스가 재생성 시 이전 파일을 덮어쓰지 않고 새 파일을 추가할 수 있다 — 어떤 파일이 "현재" 마스터인지는 `sequences.json`의 `masterVisual.assetId`가 가리킨다.

## 단계 3 — 화면 설계 (v2: 화면 유형 선정 + 비주얼 설계 통합)

> v1에서는 "화면 유형 선정"(3단계)과 "비주얼 설계"(4단계)가 분리되어 있었고 둘 다 AI 호출이었다. v2(Phase 5)에서 하나의 단계로 통합하면서, 비주얼 설계 쪽은 AI 호출을 제거하고 `lib/visual-templates`의 코드 템플릿으로 대체했다 — 화면 유형이 정해지면 레이아웃/캡션/키워드 등은 결정적으로 계산되므로 AI 왕복이 불필요했다.

**입력**
- 씬 나레이션 (해당 씬) + 앞뒤 씬 정보 (컨텍스트용, 화면 유형 선정에만 사용)
- `document-summary.txt` (있는 경우): 문서 전체 개요를 모든 씬 프롬프트에 공통 컨텍스트로 포함 — 특히 문서 앞/뒤쪽이라 이웃 씬만으로는 맥락이 부족한 씬에서 유용하다.
- 사용 가능한 화면 유형 목록: `lib/visual-templates`의 `SCREEN_TYPE_OPTIONS` 14종. 각 유형마다 `SCREEN_TYPE_INFO`의 설명 문구를 프롬프트에 함께 제공한다(이름만으로는 AI가 유형을 오판하기 쉬워서, 특히 간지/타이틀형 vs 요약/정리형처럼 헷갈리는 쌍). 전체 유형 목록과 상세 가이드는 [화면 유형 레퍼런스](screen-types.md) 참고.
- 직전 1~2개 씬의 화면 유형: 같은 유형이 3연속 반복되지 않도록 프롬프트에 다양성 유도 문구를 동적으로 추가한다(2연속 반복 시에는 해당 유형을 명시적으로 배제).
- AI(flash 모델)는 화면 유형 중 하나를 정확히 선택하고, 그 결과(`screenType`/`recommendedLayout`/`rationale`/`caption`/`keywords`)를 `computeVisualDesign(scene, screenType)`(AI 호출 없는 순수 함수)에 넘겨 나머지 비주얼 설계 필드(레이아웃 템플릿 문구)를 코드로 계산한다. `caption`(화면 자막)과 `keywords`(핵심 키워드)는 AI가 나레이션 전체를 검토해 직접 작성/선정한 값이며 — 나레이션을 앞에서부터 자르거나(caption) 등장 순서로 단어를 줍는(keywords) 로컬 휴리스틱이 아니다. 그 로컬 휴리스틱은 AI가 값을 안 줬을 때만 쓰이는 폴백으로 남아 있다.

**시퀀스 모드 확장**: 시퀀스 모드 프로젝트는 `sequences.json`을 로드/검증해 해당 씬이 속한 시퀀스의 `purpose`/`continuity`/`masterVisual.description`과 그 씬의 카메라·오버레이 지시만 골라 `sequenceContext`로 프롬프트에 추가한다(다른 시퀀스 정보는 넘기지 않음). `sequences.json`이 없거나 무결성 오류가 있으면 사용자에게 "먼저 시퀀스 단계를 완료해달라"는 사전조건 오류를 보여준다. 프롬프트는 씬 고유의 교육 콘텐츠를 우선하면서 시퀀스의 비주얼 세계관을 유지하도록 지시하고, 자막/숫자/라벨/차트는 렌더러가 그리는 오버레이이지 이미지에 구워 넣을 텍스트가 아니라는 점을 명시한다. 씬 모드는 이 컨텍스트 없이 기존 경로를 그대로 타며 출력 계약도 동일하다.

**출력** (`screen-design.json`, 씬 id 기준 매핑 — 화면 유형과 비주얼 설계를 한 파일에 저장)
```json
{
  "screenTypes": {
    "scene-001": {
      "screenType": "텍스트 강조형",
      "recommendedLayout": "중앙 큰 텍스트 + 하단 서브카피",
      "rationale": "핵심 정의를 강조하는 문장이므로",
      "caption": "화면 하단 자막 (AI가 새로 요약, 말줄임표 없음)",
      "keywords": ["핵심키워드1", "핵심키워드2"]
    }
  },
  "visualDesigns": {
    "scene-001": {
      "caption": "화면 하단 자막 (AI가 새로 요약, 말줄임표 없음)",
      "keywords": ["핵심키워드1", "핵심키워드2"],
      "imageOrDiagramDescription": "이미지 또는 도식에 대한 설명(제작 지시용, 이미지 자체는 생성하지 않음)",
      "objectPlacement": "좌측 인물 아이콘, 우측 텍스트 박스",
      "appearanceOrder": ["제목", "본문 텍스트", "아이콘"],
      "productionNotes": "제작 지시 사항"
    }
  }
}
```

`visualDesigns[id].caption`/`keywords`는 `screenTypes[id]`의 동일 필드를 그대로 복사한 값이다(`computeVisualDesign`이 AI 응답을 그대로 통과시킴) — 두 곳에 있는 이유는 `screenTypes`가 AI 원본 응답을, `visualDesigns`가 화면 구성에 필요한 전체 필드를 한데 모은 최종 산출물을 나타내기 때문.

씬별 재생성은 `POST /api/projects/{id}/screen-design/{sceneId}`로 해당 씬만 AI 재호출 + 코드 재계산한다(작업 레지스트리를 쓰지 않는 단발성 요청 — 전체 재생성만 Phase 1의 작업 엔진을 사용).

**화면 유형별 목업 베리에이션**: 반복이 잦은 유형(간지/타이틀형, 텍스트 강조형)은 `computeMockupVariantIndexes`가 같은 유형이 연속으로 몇 번째 등장인지 세어, `ScreenMockup`이 2-3가지 레이아웃을 순환하며 보여준다 — 같은 화면 유형이 여러 씬에 걸쳐 반복돼도 목업이 전부 똑같아 보이지 않도록. 이미지 생성/최종 스토리보드/미리보기 세 화면 모두 이 로직을 공유한다.

## 단계 4 — 일관성 검수

**입력**: 전체 씬의 나레이션 + 화면유형 + 비주얼설계 데이터

**점검 항목**
- 용어 통일
- 중복 화면 확인
- 지나치게 긴 나레이션 확인
- 동일한 레이아웃 반복 확인
- 나레이션과 화면 불일치 확인
- 학습 목표 누락 확인
- 화면 번호 및 장 번호 확인

**출력** (`review.json`)
```json
{
  "issues": [
    {
      "id": "issue-001",
      "type": "duplicate-layout",
      "severity": "warning",
      "sceneIds": ["scene-003", "scene-004"],
      "message": "동일한 레이아웃이 연속 반복됩니다"
    }
  ]
}
```

## 단계 5 — 이미지 생성 (v2 Phase 7, 선택 사항)

**입력**
- 씬별 `imageOrDiagramDescription`/`objectPlacement`(`screen-design.json`의 `visualDesigns`) + 나레이션

**모델**: `lib/ai/openaiImageClient.ts`의 `OPENAI_IMAGE_MODELS.default`(현재 `"gpt-image-2"`) 한 곳에서만 정의 — 실패 시 이 한 줄만 고치면 됨. `quality: "low"`, `size: "1536x1024"` 고정.

**출력**: JSON 파일이 아니라 바이너리 — `data/projects/{id}/images/{sceneId}.png`. 어떤 씬에 이미지가 있는지는 파일 존재 여부로 판단(`listProjectImageIds`), 별도 인덱스 파일 없음.

**비용 주의**: 실제 과금되는 OpenAI 호출이라 다른 단계와 달리 **필수 단계가 아니다** — "다음 단계" 버튼은 이미지가 하나도 없어도 항상 활성화되어 있고, Phase 4의 자동진행(`?auto=1`)은 일관성 검수 단계에서 멈추고 이 단계로는 자동 진행하지 않는다(의도적 설계). 씬별 재생성은 `POST /api/projects/{id}/images/{sceneId}`로 단발 호출(작업 레지스트리 미사용, `screen-design`의 씬별 재생성과 동일한 패턴).

**시퀀스 모드 확장**: 씬 모드는 이 단계에서 씬을 개별적으로(또는 타이틀 계층 기준으로만) 처리하지만, 시퀀스 모드는 `sequences.json` 기준으로 씬을 시퀀스 단위로 묶어 시퀀스 내부는 순서대로 생성한다(전역 동시성 상한은 시퀀스 경계를 넘어 그대로 유지). 각 씬 프롬프트에 해당 시퀀스의 마스터 이미지 버퍼/연속성/카메라 지시/오버레이 제외 지시(`sequenceImageContext`, `lib/pipeline/generateSceneImage.ts`)가 추가되며, 라벨·화살표·숫자 차트·자막을 이미지에 굽지 말라는 지시가 명시적으로 들어간다(그런 요소는 영상 렌더러의 오버레이 레이어 몫). 시퀀스 마스터 이미지가 아직 없으면 텍스트 연속성만으로 생성하되 UI에 경고를 띄우고 전체 작업을 실패시키지 않는다. 씬 모드는 이 확장과 무관하게 기존 프롬프트 경로를 그대로 사용한다(회귀 테스트로 고정됨).

## 단계 6 — 최종 스토리보드 뷰 (조회 전용)

이전 단계 파일(`scenes.json`, `screen-design.json`)을 조합해 씬별로 "상단 화면 설계 + 하단 나레이션" 형태로 렌더링한다. 별도 저장 파일은 없음 (조회 시점에 조합). 이미지는 아직 이 뷰에 포함되지 않음 — 구조화 화면과 이미지를 나란히 보여주는 것은 별도의 `preview` 화면(Phase 6)의 역할.
