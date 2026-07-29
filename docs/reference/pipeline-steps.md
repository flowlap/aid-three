# 파이프라인 단계별 입출력 명세 (구현 레퍼런스)

이 문서는 [설계 문서](../superpowers/specs/2026-07-27-elearning-storyboard-generator-design.md)의 파이프라인 단계를 구현 시 참고할 상세 계약(contract)으로 정리한 것이다. `lib/pipeline/*` 모듈을 작성할 때 이 입출력 형태를 기준으로 삼는다.

## 공통 원칙

- 각 단계 모듈은 `(input) => Promise<output>` 형태의 순수 함수형 인터페이스로 작성한다. 호출부는 내부 구현이 Node 함수인지, 외부 프로세스 위임인지 알 필요가 없다.
- 각 단계의 출력은 해당 단계의 JSON 파일에 그대로 저장 가능한 구조로 반환한다.
- AI 호출은 DeepSeek 클라이언트 인터페이스를 통해서만 이뤄지며, 테스트 시 목(mock)으로 대체 가능해야 한다.

## 단계 1 — 마크다운 변환

**입력**
- 원본 파일 내용 (pdf 텍스트 추출 결과 또는 txt 원문)
- 타입 플래그: `script`(원고) | `narration`(나레이션)

**출력**
- `narration.md`: 나레이션체 마크다운 문서
  - `script` 타입: 내용을 나레이션체로 변환
  - `narration` 타입: 내용 수정 없이 형태만 마크다운으로 정리

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

## 단계 3 — 화면 설계 (v2: 화면 유형 선정 + 비주얼 설계 통합)

> v1에서는 "화면 유형 선정"(3단계)과 "비주얼 설계"(4단계)가 분리되어 있었고 둘 다 AI 호출이었다. v2(Phase 5)에서 하나의 단계로 통합하면서, 비주얼 설계 쪽은 AI 호출을 제거하고 `lib/visual-templates`의 코드 템플릿으로 대체했다 — 화면 유형이 정해지면 레이아웃/캡션/키워드 등은 결정적으로 계산되므로 AI 왕복이 불필요했다.

**입력**
- 씬 나레이션 (해당 씬) + 앞뒤 씬 정보 (컨텍스트용, 화면 유형 선정에만 사용)
- 사용 가능한 화면 유형 목록: `lib/visual-templates`의 `SCREEN_TYPE_OPTIONS` 10종(텍스트 강조형/인물 등장형/이미지 설명형/표·그래프형/절차 애니메이션형/비교 대조형/타임라인형/인용·사례형/체크리스트형/요약·정리형) — AI(flash 모델)는 이 중 하나를 정확히 선택만 하고, 그 결과를 `computeVisualDesign(scene, screenType)`(AI 호출 없는 순수 함수)에 넘겨 비주얼 설계를 코드로 계산한다.

**출력** (`screen-design.json`, 씬 id 기준 매핑 — 화면 유형과 비주얼 설계를 한 파일에 저장)
```json
{
  "screenTypes": {
    "scene-001": {
      "screenType": "텍스트 강조형",
      "recommendedLayout": "중앙 큰 텍스트 + 하단 서브카피",
      "rationale": "핵심 정의를 강조하는 문장이므로"
    }
  },
  "visualDesigns": {
    "scene-001": {
      "caption": "화면에 표시될 자막",
      "keywords": ["핵심키워드1", "핵심키워드2"],
      "imageOrDiagramDescription": "이미지 또는 도식에 대한 설명(제작 지시용, 이미지 자체는 생성하지 않음)",
      "objectPlacement": "좌측 인물 아이콘, 우측 텍스트 박스",
      "appearanceOrder": ["제목", "본문 텍스트", "아이콘"],
      "productionNotes": "제작 지시 사항"
    }
  }
}
```

씬별 재생성은 `POST /api/projects/{id}/screen-design/{sceneId}`로 해당 씬만 AI 재호출 + 코드 재계산한다(작업 레지스트리를 쓰지 않는 단발성 요청 — 전체 재생성만 Phase 1의 작업 엔진을 사용).

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

## 단계 6 — 최종 스토리보드 뷰 (조회 전용)

이전 단계 파일(`scenes.json`, `screen-design.json`)을 조합해 씬별로 "상단 화면 설계 + 하단 나레이션" 형태로 렌더링한다. 별도 저장 파일은 없음 (조회 시점에 조합). 이미지는 아직 이 뷰에 포함되지 않음 — 구조화 화면과 이미지를 나란히 보여주는 것은 별도의 `preview` 화면(Phase 6)의 역할.
