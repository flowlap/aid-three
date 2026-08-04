# 씬 분할(splitScenes) 긴 원고 청크 처리 설계

- 작성일: 2026-08-04
- 배경: 나레이션이 35,928자인 프로젝트에서 씬 분할 AI 호출이 9.4분간 스트리밍하다 `stop_reason: max_tokens`로 실패했다. 원문을 한 글자도 수정하지 않고 그대로 씬 단위 JSON으로 재현해야 하는 특성상, 원고가 길면 출력이 씬 개수만큼의 JSON 메타데이터(narrationText 전문 + splitReason + relatedOrders 등)로 불어나 `LARGE_OUTPUT_MAX_TOKENS`(65536, 해당 모델의 사실상 최대 출력 한도)를 넘길 수 있다. 이 한도는 컨텍스트 윈도우(입력, 최대 1M 토큰급)와는 별개의, 응답 1회당 생성 가능한 토큰 수 제한이라 입력을 더 받을 수 있어도 해결되지 않는다.

## 목표

- 긴 원고도 씬 분할이 실패하지 않도록, 원고를 여러 구간으로 나눠 구간별로 AI를 순차 호출하고 결과를 합친다.
- 짧은 원고(기존 대부분의 경우)는 지금과 동일하게 단일 호출로 처리되어 성능/동작에 변화가 없어야 한다.
- 구간이 나뉘어도 "나레이션 원문을 임의로 수정하지 않고 분절만 한다"는 원칙과, 이를 검증하는 `validateNarrationIntegrity`(원문 재조합 diff 체크)가 그대로 성립해야 한다.
- 구간이 나뉘어도 뒤 구간의 씬이 앞 구간의 씬을 `relatedSceneIds`로 참조할 수 있어야 한다(완전히 못 쓰게 되는 것은 회피).

## 범위 밖

- 앞 구간의 씬이 아직 생성되지 않은 뒤 구간의 씬을 참조하는 것(정방향 참조)은 지원하지 않는다 — 순차 처리 특성상 뒤 구간의 내용을 앞 구간이 미리 알 수 없다. 기존 프롬프트의 관계 서술("두 개념을 각각 소개한 뒤 하나로 잇는 씬")도 본질적으로 역방향이라 실질적 손실은 작다.
- 다른 파이프라인 스텝(화면 설계, 일관성 검수 등)의 청크/배치 처리는 이미 자체 방식(`selectScreenTypes`의 `MAX_GROUP_SIZE` 그룹핑)이 있으므로 이번 변경 대상이 아니다.
- 구간이 많아질 때(원고가 아주 길 때) 앞 구간 컨텍스트를 요약/축약하는 최적화는 하지 않는다 — 컨텍스트 윈도우는 넉넉하므로(문제는 출력 쪽), 전체 프롬프트가 실제로 문제가 될 정도로 커지는 사례가 나오면 그때 다룬다.
- 청크 병렬 처리는 하지 않는다(순차로 확정).

## 아키텍처

### 처리 흐름

```
lib/pipeline/splitScenes.ts
  chunkNarration(narrationMarkdown, budget?) : string[]   ← 신규, 순수 함수, AI 미사용
  buildSplitScenesMessages(chunk, priorScenes?, startOrder?) : ChatMessage[]  ← 기존 함수 확장
  parseRawScenes(raw) : RawScene[]                         ← 기존 parseScenesResponse에서 분리
  assignSceneIds(rawScenes) : Scene[]                      ← 기존 parseScenesResponse에서 분리
  parseScenesResponse(raw) = assignSceneIds(parseRawScenes(raw))  ← 기존 시그니처 유지(하위 호환)

app/api/projects/[projectId]/scenes/route.ts
  POST: chunkNarration()으로 나눈 구간을 순서대로 순회하며
        각 구간을 splitScenesStream()으로 스트리밍 호출 → parseRawScenes() →
        누적 배열에 push → recordProgress(i+1, total) →
        모든 구간 완료 후 assignSceneIds(누적 배열) 한 번 실행
```

원고가 청크 기준값 이하면 `chunkNarration`이 원고 전체를 담은 배열 1개를 반환하므로, 반복문이 정확히 1회만 돌아 **기존 단일 호출과 동일하게 동작**한다. 별도의 분기(`if 길면 청크, 아니면 기존 방식`)를 두지 않고 하나의 코드 경로로 통일한다.

### 1. 청크 분할 (`chunkNarration`)

```ts
export const SCENE_SPLIT_CHUNK_CHAR_BUDGET = 8000;

export function chunkNarration(
  narrationMarkdown: string,
  budget: number = SCENE_SPLIT_CHUNK_CHAR_BUDGET
): string[]
```

- 원고를 "블록" 단위로 먼저 쪼갠다. 블록 = 헤더 줄(`#`/`##`/`###`) 하나, 또는 헤더가 아닌 문단(빈 줄로 구분된 구간) 하나. 블록 경계는 문자 단위로 정확히 원문을 재구성 가능해야 한다(공백·줄바꿈 유실 없음).
- 블록을 순서대로 그리디하게 채워 넣는다: 현재 청크에 다음 블록을 더했을 때 `budget`을 넘으면 새 청크를 시작한다.
- 예외: 블록 하나가 단독으로 `budget`을 넘으면(헤더 하나 아래 내용이 매우 긴 경우), 그 블록만 다시 문단(빈 줄) 단위로 재귀 분할한다. 그래도 남는 단일 문단이 `budget`을 넘으면 분할하지 않고 그대로 청크 하나로 둔다 — 문장 중간을 강제로 자르는 것보다 낫다.
- AI를 호출하지 않는 순수 로컬 문자열 처리다. 여기서 정하는 경계는 "화면이 전환되는 지점"이 아니라 순전히 AI 호출을 안전한 크기로 쪼개기 위한 사전 분할이며, 실제 씬(화면 전환) 경계는 각 청크를 받은 AI가 청크 내부에서 기존 프롬프트 기준대로 판단한다.

### 2. 프롬프트 확장 (`buildSplitScenesMessages`)

기존 시그니처 `buildSplitScenesMessages(narrationMarkdown)`에 두 개의 선택 인자를 추가한다:

```ts
function buildSplitScenesMessages(
  narrationMarkdown: string,
  priorScenes?: { order: number; narrationText: string }[],
  startOrder?: number
): ChatMessage[]
```

- `priorScenes`가 있으면(2번째 구간부터) 프롬프트에 "이전 구간에서 이미 분할된 씬 목록"으로 `order`+`narrationText`를 나열해 덧붙인다.
- `startOrder`가 있으면 "이번 구간의 첫 씬은 order {startOrder}부터 시작하세요"라고 명시한다.
- `relatedOrders` 설명에 "이번 구간에서 새로 만드는 씬뿐 아니라 위에 나열된 이전 씬의 order도 참조할 수 있다"는 문장을 추가한다.
- 1번째 구간(또는 청크가 1개뿐인 짧은 원고)은 `priorScenes`/`startOrder`가 없으므로 지금 프롬프트와 완전히 동일한 문구가 나간다 — 기존 동작 100% 보존.

이렇게 하면 **AI가 매 구간마다 전역적으로 이어지는 `order` 번호를 직접 매긴다.** 구간별로 로컬 번호를 매기고 나중에 오프셋을 더하는 방식보다 단순하고, `relatedOrders`가 구간 경계를 넘어 이전 구간의 order를 그대로 참조할 수 있다.

### 3. 파싱/병합 (`parseRawScenes` + `assignSceneIds`)

기존 `parseScenesResponse`를 두 단계로 쪼갠다(동작 변경 없음, 순수 리팩터링):

```ts
interface RawScene { order: number; narrationText: string; estimatedDurationSec: number;
  splitReason: string; relatedOrders?: number[]; sceneType?: "title"|"content"; depth?: number|null; }

function parseRawScenes(raw: string): RawScene[] {
  const parsed = JSON.parse(raw) as { scenes: RawScene[] };
  if (!parsed || !Array.isArray(parsed.scenes)) {
    throw new Error("AI 응답 형식이 올바르지 않습니다 (scenes 배열 없음)");
  }
  return parsed.scenes;
}

function assignSceneIds(rawScenes: RawScene[]): Scene[] {
  // 기존 parseScenesResponse의 id 생성 + relatedOrders → relatedSceneIds 매핑 로직 그대로
}

export function parseScenesResponse(raw: string): Scene[] {
  return assignSceneIds(parseRawScenes(raw));
}
```

호출 측(`scenes/route.ts`)은 구간마다 `parseRawScenes()`로 그 구간의 `RawScene[]`만 얻어 누적 배열에 이어 붙이고, **모든 구간이 끝난 뒤 딱 한 번** `assignSceneIds(누적 배열 전체)`를 호출한다. `order`가 전 구간에 걸쳐 이미 전역적으로 이어지도록 프롬프트에서 지시했으므로(2번 항목), `idByOrder` 매핑이 구간 구분 없이 정확히 동작해 `relatedOrders`가 이전 구간을 가리켜도 정상적으로 `relatedSceneIds`로 변환된다. 존재하지 않는 order를 참조하면(AI가 아직 나오지 않은 뒤 구간을 착각해서 언급하는 경우 등) 기존 로직이 이미 그런 항목을 조용히 걸러낸다 — 별도 처리 불필요.

### 4. API 라우트 (`scenes/route.ts`)

```ts
const narrationChunks = chunkNarration(narration);
const allRawScenes: RawScene[] = [];

for (let i = 0; i < narrationChunks.length; i++) {
  const priorScenes = allRawScenes.map((s) => ({ order: s.order, narrationText: s.narrationText }));
  const startOrder = allRawScenes.length + 1;
  const messages = buildSplitScenesMessages(narrationChunks[i], priorScenes, startOrder);
  const chunkStream = await client.completeStream(messages, { jsonMode: true, tier: "accurate", maxTokens: LARGE_OUTPUT_MAX_TOKENS, signal: job.controller.signal });

  let chunkRaw = "";
  for await (const delta of chunkStream) {
    chunkRaw += delta;
    recordChunk(projectId, STEP, delta);
    emit(JSON.stringify({ type: "chunk", text: delta }) + "\n");
  }

  allRawScenes.push(...parseRawScenes(chunkRaw)); // 실패 시 catch로 빠져 아래 5번과 동일하게 처리
  recordProgress(projectId, STEP, i + 1, narrationChunks.length);
}

const scenes = assignSceneIds(allRawScenes);
const integrityOk = validateNarrationIntegrity(narration, scenes.map((s) => s.narrationText));
// 이후 저장/finishJob/emit(result)는 기존과 동일
```

- `recordChunk`/`{type:"chunk"}` emit은 구간 구분 없이 계속 이어서 전송한다 — 화면(`rawPreview`)엔 청크 경계 없이 텍스트가 쭉 이어지는 것처럼 보인다.
- `recordProgress(projectId, STEP, i+1, narrationChunks.length)`는 구간이 2개 이상일 때만 호출한다(`narrationChunks.length > 1`). 클라이언트(`AiJobStatus`)는 이미 `progress: {index, total}`을 지원하므로 긴 원고에서는 "1/4", "2/4" 형태로 자동 표시되고, 청크가 1개뿐인 기존 대부분의 경우는 지금처럼 progress 표시 없이 동작해 화면상 변화가 없다.
- `estimateSecondsForChars`(예상 소요시간)는 원고 전체 글자수 기준 계산을 그대로 사용한다. 구간을 나눠도 처리하는 총 글자수는 동일하므로 추정치 산식은 변경하지 않는다.

### 5. 에러 처리

- 특정 구간에서 스트리밍 실패(예: 그 구간도 너무 길어 재차 max_tokens에 걸림) 또는 JSON 파싱 실패 시, 전체 작업을 실패로 종료한다 — 이미 완료된 앞 구간들의 결과는 저장하지 않는다(부분 저장으로 인한 애매한 상태 방지). 기존 단일 호출 경로의 에러 처리(`finishJob(..., "error", ...)` + `{type:"error"}` emit)를 그대로 재사용한다.
- 취소(`cancel`, `DELETE /jobs/scenes`)는 `job.controller.signal`을 그대로 각 구간의 `completeStream` 호출에 전달하므로, 현재 진행 중인 구간에서 즉시 중단되고 다음 구간으로 넘어가지 않는다 — 기존과 동일.

### 6. 무결성 검증

`validateNarrationIntegrity`는 수정하지 않는다. `chunkNarration`이 원문을 문자 단위로 유실·중복 없이 정확히 파티션하고, 각 구간의 씬을 구간 순서대로(=원문 순서대로) 이어 붙이기만 하면, 전체 `narrationText`를 합친 결과는 지금과 동일하게 원문과 정확히 일치한다.

## 상수/설정

- `SCENE_SPLIT_CHUNK_CHAR_BUDGET = 8000` (문자 수 기준, `lib/pipeline/splitScenes.ts`에 정의). 이번에 실패한 사례(35,928자)의 근거로 여유 있게 잡은 시작값이며, 실사용 데이터를 보면서 조정 가능하도록 상수 하나로만 관리한다. 별도의 "언제부터 나눌지" 임계값은 따로 두지 않는다 — 이 값 자체가 곧 임계값이다(원고 길이가 이 값 이하면 청크가 1개로만 나와 단일 호출과 동일).

## 테스트 전략

- `chunkNarration`: 헤더/문단 경계 보존, budget 이하 원고는 청크 1개 반환, 헤더 하나가 budget을 넘는 경우 문단 단위 재귀 분할, 전체 청크를 이어붙이면 원문과 100% 일치(문자 단위) 하는지 검증.
- `buildSplitScenesMessages`: `priorScenes`/`startOrder` 없을 때 기존 프롬프트와 동일한 문자열이 나오는지(회귀), 있을 때 이전 씬 목록과 시작 order 지시가 포함되는지 검증.
- `parseRawScenes`/`assignSceneIds`: 기존 `parseScenesResponse` 테스트를 두 함수로 분리해 그대로 이식 + 여러 구간의 `RawScene[]`를 이어붙인 뒤 `assignSceneIds` 한 번으로 처리했을 때 구간을 넘는 `relatedOrders`가 올바르게 `relatedSceneIds`로 매핑되는지 새 테스트 추가.
- `scenes/route.ts`: mock LLM 클라이언트로 원고를 2~3개 청크로 나눠지는 긴 텍스트를 넣고, 구간별로 다른 응답을 반환하도록 설정해 (a) `recordProgress`가 구간마다 호출되는지, (b) 최종 병합된 씬 배열의 순서/id/relatedSceneIds가 올바른지, (c) 중간 구간 실패 시 전체가 에러로 종료되고 저장이 안 되는지 검증.

## 하위 호환성

- 짧은 원고(대부분의 기존 프로젝트)는 `chunkNarration`이 청크 1개를 반환해 기존과 완전히 동일한 프롬프트/단일 호출/응답 형식으로 동작한다.
- `parseScenesResponse(raw)` 시그니처와 동작은 그대로 유지되므로(내부적으로 `assignSceneIds(parseRawScenes(raw))`로 위임), 이 함수를 사용하는 다른 코드(테스트 등)는 변경 없이 동작한다.
- `Scene`/`scenes.json` 데이터 형식은 변경되지 않는다.

## 미해결/확인 필요 항목

없음 — 청크 기준, 경계 결정 방식, 순차/병렬 여부, relatedSceneIds 처리 방식 모두 사용자 확인 완료.
