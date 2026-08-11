# 시퀀스 모드 교육용 의미 기반 합성 설계

- 작성일: 2026-08-11
- 상태: 제안
- 대상: 시퀀스 모드의 `코드 기반 합성 (마스터 + 오버레이)`

> 2026-08-11 초기 구현: 기존 `SequenceOverlayEntry`에 선택적 `content` 계약을 추가했다. 새 시퀀스 계획은 흐름 단계, 다이어그램 노드, 차트의 레이블·수치, 마스터 기준 강조 좌표를 생성하고 `renderSequenceFrame.tsx`가 이를 결정적으로 렌더링한다. 기존 `{ sceneId, type, description }` 데이터는 기존 배너 표현으로 폴백한다. 이 호환 가능한 계약 확장은 아래의 더 큰 `VisualSceneSpec`으로 가기 위한 첫 단계다.

## 결정

현재의 코드 기반 합성을 없애거나 AI 재생성으로 대체하지 않는다. 대신 이를 **의미 기반 합성(semantic composite)** 으로 확장한다. 이미 생성한 시퀀스 마스터 비주얼을 주 시각 자산으로 쓰고, 코드가 그 위에 교육 목적의 장면 구성·타이포그래피·차트·도식·강조·모션을 결정적으로 렌더링한다. 추가 AI 에셋 생성은 기본 흐름에 포함하지 않는다.

이 방식의 목표는 두 가지를 동시에 얻는 것이다.

- AI 재생성의 장점인 실제 장면감·소재 다양성은 시퀀스 마스터 비주얼 생성에 사용한다.
- 코드 합성의 장점인 정확한 한글, 사실에 맞는 수치, 일관된 레이아웃, 영상 프레임 간 안정성은 최종 교육 그래픽에 사용한다.

따라서 최종 결과는 배경 위에 설명 배너만 얹는 화면이 아니라, 씬마다 다른 **교육 시각 문법**(비교, 과정, 구조, 데이터, 사례, 정의 등)을 갖는 방송형 강의 화면이 된다.

## 문제의 사실 확인

현재 `SequenceOverlayEntry`는 아래처럼 `type`과 자유 텍스트 `description`만 가진다.

```ts
{ sceneId, type: "label" | "arrow-flow" | "highlight" | "diagram" | "chart", description }
```

[`lib/video/renderSequenceFrame.tsx`](../../../lib/video/renderSequenceFrame.tsx)는 이를 `label/diagram/chart`는 하단, `highlight/arrow-flow`는 우상단에 같은 모양의 칩으로 쌓는다. 이 데이터에는 다음 정보가 없으므로 렌더러가 실제 교재 도식을 만들 수 없다.

- 무엇을 가리키는지(대상 object ID)
- 화면 내 좌표·크기·안전 영역
- 비교 항목, 과정 단계, 노드와 연결선, 수치/축/단위
- 배경 위에 놓일 인물·제품·사진 같은 전경 에셋
- 씬별 시각적 강조 순서와 레이아웃 변형

`bakeSequenceSceneStill.ts`도 마스터의 시작 크롭과 위 배너 PNG만 합성한다. 따라서 품질 저하는 렌더러가 단순해서가 아니라, **자유 문장을 정해진 두 영역에 배치하는 데이터 계약**에서 발생한다. 자유 문장을 프롬프트에 넣는 AI 재생성은 이 빈칸을 모델의 추정으로 채우므로 더 풍부해 보이지만, 한글·수치·도식 정확도와 시퀀스 연속성을 잃는다.

## 범위와 비범위

- 범위: 시퀀스 모드의 이미지/목업/영상에서 같은 장면 명세를 렌더링하는 것, 현재 합성 모드의 품질 개선, 기존 프로젝트의 안전한 읽기.
- 비범위: 나레이션 수정, 씬 모드의 동작 변경, 생성 모델에게 정확한 한글/차트를 그리게 하는 것, 마스터 이미지를 자동으로 재생성하는 것.
- AI 재생성(`ai`)은 당분간 유지한다. 품질·비용·속도 비교를 위한 폴백이며, 의미 기반 합성의 완료 후 기본 선택지는 `semantic-composite`로 바꾼다.

## 목표 구조

```text
나레이션 + 화면 유형 + 시퀀스 연속성
               │
               ▼
  Visual Scene Spec 생성/검수 (구조화 JSON, LLM은 계획만)
               │
       ┌───────┼────────────────┐
       ▼       ▼                ▼
  마스터 비주얼              SVG 교육 그래픽
  (AI 1회/시퀀스)            (코드: 차트·도식·텍스트)
       └────────────────────────┘
                         ▼
              Semantic Scene Renderer
             ├─ 목업 (React)
             ├─ PNG still (Satori + ffmpeg)
             └─ video overlay/motion (동일 명세)
```

### 깊은 모듈

새 `semanticSceneRenderer` 모듈의 **Interface**는 작게 유지한다.

```ts
renderSemanticScene(spec, assets, frame): ReactElement
```

호출자는 레이아웃 규칙, 줄바꿈, 텍스트 축약, 충돌 회피, SVG 좌표, 테마, 모션 전/후 레이어를 알 필요가 없다. 이 복잡도는 모듈의 **Implementation** 안에 숨긴다. 같은 Interface를 목업·still·영상이 공유하므로, 한 수정이 세 출력에 반영되는 높은 **Depth**와 **Locality**를 얻는다.

AI 계획 생성과 화면 렌더링은 서로 다른 **Seam**으로 둔다. `VisualSceneSpec`은 두 seam 사이의 검증 가능한 계약이며, 이미지 provider나 Satori/ffmpeg는 각각 내부 Adapter다.

## 데이터 계약

기존 `SequenceOverlayEntry`는 삭제하지 않는다. `SequencePlan.version: 1`은 그대로 읽고, 없는 장면 명세는 `legacyOverlayToSceneSpec`으로 변환해 기존 칩 스타일을 렌더링한다. 새 저장 형식은 `screen-design.json`에 씬 ID로 둔다. 시퀀스 구조 자체와 화면 제작 명세를 분리해, 시퀀스 재배치가 교육 그래픽의 세부 데이터 모델을 비대하게 만들지 않는다.

```ts
// lib/pipeline/semanticSceneTypes.ts
export type NormalizedRect = {
  x: number; y: number; width: number; height: number; // all 0..1
};

export type VisualSceneSpec = {
  version: 1;
  sceneId: string;
  composition: "hero-explainer" | "split-compare" | "process" |
    "relationship-map" | "data-story" | "definition" | "case-study" | "recap";
  theme: "editorial" | "technical" | "warm"; // 프로젝트 톤에서 선택
  background: { cropAnchor?: "left" | "center" | "right" };
  title?: TextElement;
  body: SemanticElement[];
  entranceOrder: string[];
};

export type TextElement = {
  id: string;
  kind: "text";
  text: string;
  role: "title" | "subtitle" | "label" | "body" | "caption";
  rect?: NormalizedRect; // optional: renderer chooses a template slot when absent
  emphasis?: "normal" | "key";
};

export type SemanticElement =
  | TextElement
  | { id: string; kind: "stat"; label: string; value: string; unit?: string; trend?: "up" | "down" | "flat"; rect?: NormalizedRect }
  | { id: string; kind: "process"; steps: Array<{ id: string; label: string; detail?: string }>; direction: "horizontal" | "vertical"; rect?: NormalizedRect }
  | { id: string; kind: "comparison"; left: CompareSide; right: CompareSide; rect?: NormalizedRect }
  | { id: string; kind: "relationship"; nodes: DiagramNode[]; edges: DiagramEdge[]; layout: "radial" | "hierarchy" | "flow"; rect?: NormalizedRect }
  | { id: string; kind: "chart"; chartType: "bar" | "line" | "donut"; series: ChartSeries[]; unit?: string; rect?: NormalizedRect }
  | { id: string; kind: "callout"; targetId?: string; text: string; anchor: "top" | "right" | "bottom" | "left"; rect?: NormalizedRect }
  | { id: string; kind: "focus"; targetId: string; shape: "ring" | "bracket" | "spotlight" }
  | { id: string; kind: "master-subject"; role: "object" | "photo" | "illustration"; rect?: NormalizedRect };
```

`CompareSide`, `DiagramNode`, `DiagramEdge`, `ChartSeries`는 모두 문자열/숫자 배열만 포함하는 작은 DTO로 정의한다. 숫자는 유한값만 허용하고, `chart`는 최대 6개 범주·3개 series, `process`는 2–6 단계, `relationship`은 2–8 노드로 제한한다. 이 제한은 화면 밀도를 통제하고 테스트 가능한 오류 메시지를 만든다.

정규화 좌표는 필수가 아니다. 템플릿이 먼저 좋은 구도를 선택하고, 저작자가 정말 특정 위치가 필요할 때만 좌표를 준다. 즉 다시 “모든 것을 정해진 박스에 넣는” 설계가 되지 않는다.

### 저장과 에셋

```text
screen-design.json
  semanticScenes: Record<sceneId, VisualSceneSpec>  # 새 필드, 기존 필드 보존

sequence-assets/{sequenceId}/
  {assetId}.png                                     # 기존 마스터 비주얼
```

마스터 비주얼과 벡터 그래픽만으로 완결되어야 한다. `master-subject`는 별도 파일을 뜻하지 않으며, 마스터 안의 핵심 피사체를 강조선·스포트라이트·콜아웃의 대상으로 삼는 의미 요소다. 이 요소에 정확한 좌표가 필요하면 생성 단계에서 마스터의 핵심 피사체 영역만 정규화 좌표로 기록하거나, 사용자가 미리보기에서 보정한다.

## 생성과 검수 흐름

1. 시퀀스 계획 후, 현재 `selectScreenTypes`가 만든 `screenType`·`caption`·`keywords`·`layoutElements`를 입력으로 사용한다.
2. 새 `planSemanticScenes(client, scenes, screenDesign, sequencePlan)`가 시퀀스 단위로 JSON만 생성한다. 모델에게 픽셀 위치나 CSS를 쓰게 하지 않고, 학습 메시지에 맞는 `composition`과 사실 데이터(단계/항목/수치/관계)만 추출하게 한다.
3. `parseSemanticScenePlan`과 `validateSemanticSceneSpec`이 enum, 길이, 숫자, `sceneId`, 참조 ID를 검사한다. 실패한 씬은 기존 화면 유형으로 결정적 폴백을 만들고 `needsReview`로 표시한다. 잘못된 LLM JSON이 저장되거나 영상 렌더를 멈추게 해서는 안 된다.
4. 편집 UI는 자유 JSON 편집기가 아니라, 화면 유형별 폼을 제공한다. 예: 과정은 단계 추가/삭제·순서 변경, 차트는 표 형태 숫자 입력, 관계도는 노드/간선 편집, 강조는 대상 선택이다. 우측에는 동일 renderer로 즉시 미리보기를 보인다.
5. `master-subject`를 쓰는 씬은 마스터 안의 대상 위치를 선택한다. 자동 계획은 정규화 좌표를 제안하고, 사용자는 미리보기에서 드래그로 보정할 수 있다. 별도 이미지를 만들지 않고도 강조선·스포트라이트·콜아웃이 실제 대상에 붙는다.

## 렌더링 규칙

### 계층

1. 마스터 배경을 카메라 크롭으로 배치한다.
2. 색상 그라데이션, 흐림, vignette 등 낮은 대비의 배경 보정으로 텍스트 안전 영역을 확보한다.
3. 마스터 안의 핵심 대상을 향한 공간적 강조(spotlight, ring, connector)를 배치한다.
4. 차트·도식·과정 등 교육 그래픽을 SVG/React로 렌더링한다.
5. 제목·라벨·접근성 대비를 만족하는 한글 텍스트를 렌더링한다.

기존처럼 카메라가 1–3 레이어를 움직일 때 4–5 레이어가 함께 움직이지 않게 분리한다. 그래야 텍스트·차트가 흔들리거나 화면 밖으로 사라지지 않는다.

### 템플릿은 박스 모음이 아니라 조판 알고리즘이다

`composition`별 renderer는 최소 2–3 변형을 갖고, 배경의 `cropAnchor`, 텍스트 길이, 강조 대상, 씬 인덱스에 따라 변형을 고른다.

| composition | 코드가 만드는 교육 장면 | AI/에셋의 역할 |
| --- | --- | --- |
| `hero-explainer` | 마스터 속 대상 옆에 짧은 설명·콜아웃·강조선 | 실제 배경/대상 |
| `split-compare` | 공통 기준선, 좌우 항목의 동일한 계층 | 마스터의 공간·모티프 |
| `process` | 단계 수에 맞춰 간격이 자동 조절되는 흐름도 | 필요 시 단계의 대표 에셋 |
| `relationship-map` | radial/hierarchy/flow 그래프와 연결선 | 중앙 주제/배경 |
| `data-story` | 실제 값에서 계산한 축·막대·추세·단위 | 맥락 배경 |
| `definition` | 용어-정의-예시를 다른 위계로 조판 | 마스터의 상황 맥락 |
| `case-study` | 마스터 상황, 관찰 포인트, 결론의 편집형 구성 | 사례 맥락 |
| `recap` | 최대 3개 핵심을 리듬감 있게 재배열 | 시퀀스 모티프 |

텍스트 규칙도 renderer가 소유한다: 제목 20자, 라벨 12자, 단계 라벨 16자 등 역할별 상한을 둔다. 넘치면 폰트를 무한히 줄이지 않고 2줄 줄바꿈 → 짧은 편집 제안 → `needsReview` 순서로 처리한다. 사실 문자열은 임의로 잘라 의미를 바꾸지 않는다.

### 구현 파일 배치

```text
lib/pipeline/semanticSceneTypes.ts          # DTO, type guard, 한계값
lib/pipeline/validateSemanticSceneSpec.ts   # 순수 검증기
lib/pipeline/planSemanticScenes.ts          # LLM JSON 계획, client 주입
lib/pipeline/legacyOverlayToSceneSpec.ts    # v1 호환 폴백
lib/semantic-renderer/
  renderSemanticScene.tsx                   # 유일한 public Interface
  selectCompositionVariant.ts               # 순수 변형 선택
  layout.ts                                  # 충돌 회피·safe area·텍스트 측정 규칙
  themes.ts                                  # 색·타입 스케일·간격 토큰
  diagrams.tsx                              # process/relationship SVG
  charts.tsx                                # 실제 값 기반 chart SVG
  compositions/*.tsx                        # 8개 composition Adapter
lib/video/renderSequenceFrame.tsx           # 기존 칩 renderer를 새 renderer 호출로 교체
lib/video/renderSequenceFrameToPng.ts       # 기존 rasterizeToPng 재사용
lib/pipeline/bakeSequenceSceneStill.ts      # 동일 spec/asset을 전달
components/SemanticScenePreview.tsx         # 편집 UI와 목업의 공용 preview
app/api/projects/[projectId]/semantic-scenes/route.ts
```

기존 `rasterizeToPng`(Satori)와 `composeSequenceStill`(ffmpeg)은 재사용한다. 새 패키지가 필수는 아니다. 차트/도식은 `<svg>`와 기본 도형으로 작성해 데이터 정확성과 해상도 독립성을 확보한다. 전경 PNG가 투명하지 않은 provider인 경우에는 우선 사각 사진 프레임으로 사용하고, 후속으로 사용자 업로드 또는 별도 배경 제거 Adapter를 선택적으로 추가한다. 알파 채널을 가정해 핵심 경로를 막지 않는다.

## 이미지 모드 전환과 호환성

```ts
export type SequenceImageMode = "legacy-composite" | "semantic-composite" | "ai";
```

- 기존 `composite` 파일 값은 읽을 때 `legacy-composite`로 매핑한다. 기존 프로젝트의 출력은 변하지 않는다.
- 새 시퀀스 프로젝트는 초기에는 `semantic-composite`를 기본값으로 둔다. 아직 `semanticScenes`가 없으면 자동 실행하지 않고 “교육 화면 설계 생성” 액션을 보인다.
- `ai`는 현재 동작과 동일하다. 단, 명세가 있으면 프롬프트에 장면의 교육적 의도를 참조용으로만 전달할 수 있고, 텍스트/차트의 정확성을 모델에 의존하지 않는다.
- 모드 전환 또는 명세/에셋 수정은 해당 씬의 `images/{sceneId}.png`와 영상 clip fingerprint를 stale 처리한다. 원본 파일을 즉시 삭제하지 않고 명시적 재생성 때 덮어쓴다.

## 단계별 구현 계획

### Phase 1 — 데이터와 결정적 기본 화면

1. `semanticSceneTypes`, parser, validator와 단위 테스트를 추가한다.
2. `screen-design.json`에 optional `semanticScenes`를 추가하고, v1 프로젝트에서 `legacyOverlayToSceneSpec`이 기존 결과를 보존하는지 검증한다.
3. `process`, `comparison`, `relationship`, `chart`, `hero-explainer`의 다섯 renderer를 구현한다. 기존 `ScreenMockup`의 화면 유형 지식은 복사하지 말고 공용 composition 선택 모듈로 옮긴다.
4. 기존 `renderSequenceOverlayToPng`와 `bakeSequenceSceneStill`이 새 renderer 출력 PNG를 쓰게 한다.

완료 기준: AI 호출 없이도 같은 입력에서 동일 PNG가 나오고, 과정/관계/차트가 “설명 배너”가 아니라 구조화된 교재 그래픽으로 보인다.

### Phase 2 — 구조화 계획과 편집

1. `planSemanticScenes`를 시퀀스 단위 NDJSON 작업으로 추가한다. `LlmClient` 주입, strict JSON parser, 실패 씬 폴백을 적용한다.
2. 시퀀스 설계/이미지 단계에 “교육 화면 설계 생성”과 명세별 편집 UI를 추가한다.
3. 새 명세 변경 시 프로젝트 상태와 클립 fingerprint가 갱신되도록 한다.

완료 기준: 사용자는 차트 수치·과정 단계·관계 노드를 UI에서 수정할 수 있고, 수정 결과가 목업/still/영상에 똑같이 보인다.

### Phase 3 — 마스터 대상 지정과 품질 제어

1. 마스터 내 대상의 정규화 좌표를 자동 제안하고, 미리보기에서 보정하는 UI를 추가한다.
2. `hero-explainer`, `case-study`에서 해당 대상에 콜아웃/강조를 연결한다.
3. 장면 검사기를 추가한다: 안전영역 침범, 요소 겹침, 최소 글자 크기, 차트 데이터 누락, 대상 없는 callout을 오류/경고로 표시한다.

완료 기준: 마스터 하나를 재사용하면서도, 대다수 교육 정보는 코드가 정확하게 그리고 강조 요소는 마스터의 실제 대상에 연결된다.

## 검증 전략

- `validateSemanticSceneSpec.test.ts`: enum, 좌표 범위, 유한 숫자, 상한, 대상 참조, scene ID 불일치.
- `legacyOverlayToSceneSpec.test.ts`: 모든 기존 overlay type이 읽히며 v1 저장 데이터를 바꾸지 않음.
- `renderSemanticScene.test.tsx`: 각 composition의 필수 노드/텍스트, 긴 문장 줄바꿈, 요소 충돌 폴백, 테마/변형 선택.
- `charts.test.tsx`: 입력 값과 축/범례/단위가 일치하고 NaN/Infinity를 거부함.
- `bakeSequenceSceneStill.test.ts`: 같은 spec이 still에 합성되고, 마스터 부재는 기존의 안전한 폴백을 유지함.
- `sceneClipFingerprint.test.ts`: semantic spec 또는 마스터 대상 좌표가 바뀌면 fingerprint가 바뀜.
- 수동 E2E: 과정·비교·수치 차트·관계도·사례의 다섯 시퀀스를 16:9로 생성하여 목업, PNG, 동영상 프레임의 동일성·한글 가독성·카메라 중 오버레이 고정 여부를 확인한다.

## 수용 기준

1. 코드 기반 모드에서 차트 값, 단계 순서, 용어가 모델 이미지에 의해 왜곡되지 않는다.
2. 같은 장면 명세는 미리보기·씬 PNG·영상에서 동일한 정보 구조를 보인다.
3. 모든 기존 `sequences.json`과 `sequence-image-mode.txt`의 `composite` 값은 오류 없이 열리고 기존 결과를 유지한다.
4. 마스터가 없어도 구조화 교육 그래픽은 렌더링할 수 있으며, 배경만 중립 색/그라데이션으로 폴백한다.
5. 시퀀스당 필수 AI 비용은 마스터 1회이며, 씬 수에 비례해 증가하지 않는다.
6. 한 프레임의 설명 배너 반복이 아니라, 화면 유형과 데이터에 따라 적어도 다섯 종류의 조판 결과가 나온다.

## 대안과 기각 이유

- **기존 배너의 CSS만 고도화**: 좌표와 사실 데이터가 없어서 예쁜 배너일 뿐 교육 도식이 되지 못한다.
- **AI 재생성을 기본값으로 유지**: 장면감은 좋지만 한글·숫자·관계 표현을 검증할 수 없고, 비용과 화면 간 드리프트가 씬 수에 비례한다.
- **AI에게 SVG/HTML을 직접 생성하게 함**: 검증·보안·레이아웃 실패 표면이 커진다. AI는 작은 JSON 의미 모델만 만들고, SVG는 신뢰된 코드가 만든다.
- **모든 요소에 절대 좌표를 요구**: 전문 모션 디자이너용 도구가 되고 자동 생성 품질이 떨어진다. composition 알고리즘이 기본 구도를 소유하고, 좌표는 예외적 override로만 허용한다.
