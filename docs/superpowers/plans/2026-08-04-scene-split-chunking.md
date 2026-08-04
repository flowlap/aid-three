# 씬 분할 긴 원고 청크 처리 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 긴 나레이션에서 씬 분할 AI 호출이 `max_tokens`(출력 길이 한도)에 걸려 실패하는 문제를, 원고를 여러 구간으로 나눠 순차적으로 AI를 호출하고 결과를 병합하는 방식으로 해결한다.

**Architecture:** `lib/pipeline/splitScenes.ts`에 순수 함수 `chunkNarration()`(헤더/문단 경계 기반 청크 분할)을 추가하고, 기존 프롬프트 빌더와 응답 파서를 구간 병합이 가능하도록 확장한다. `app/api/projects/[projectId]/scenes/route.ts`는 청크 배열을 순차 순회하며 각 구간을 스트리밍 호출하고, 앞 구간에서 만든 씬 목록을 다음 구간 프롬프트에 컨텍스트로 넘겨 `relatedSceneIds`가 구간을 넘어 이전 구간을 참조할 수 있게 한다.

**Tech Stack:** TypeScript, Next.js API Route, Vitest

**참고 스펙**: `docs/superpowers/specs/2026-08-04-scene-split-chunking-design.md`

---

### Task 1: `chunkNarration` — 나레이션을 청크로 나누는 순수 함수

**Files:**
- Modify: `lib/pipeline/splitScenes.ts`
- Test: `lib/pipeline/splitScenes.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`lib/pipeline/splitScenes.test.ts` 파일 맨 위 import 문을 아래와 같이 수정한다(기존 `import { splitScenes } from "./splitScenes";`를 대체):

```ts
import { splitScenes, chunkNarration } from "./splitScenes";
```

파일 맨 끝(마지막 `});` 다음)에 아래 `describe` 블록을 추가한다:

```ts

describe("chunkNarration", () => {
  it("returns the whole narration as a single chunk when under budget", () => {
    const text = "안녕하세요.\n오늘은 이러닝을 배웁니다.";
    expect(chunkNarration(text, 1000)).toEqual([text]);
  });

  it("splits at header boundaries once the budget is exceeded", () => {
    const text = "# 1장\n내용1\n\n# 2장\n내용2\n\n# 3장\n내용3";
    const chunks = chunkNarration(text, 20);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0]).toContain("# 1장");
  });

  it("reconstructs the original text exactly when chunks are concatenated", () => {
    const text =
      "# 1장\n내용1입니다.\n\n# 2장\n내용2입니다.\n\n일반 문단도 있습니다.\n\n# 3장\n내용3입니다.";
    const chunks = chunkNarration(text, 15);
    expect(chunks.join("")).toBe(text);
  });

  it("splits an oversized header section by paragraph", () => {
    const text = "# 1장\n첫 문단입니다.\n\n둘째 문단입니다.\n\n셋째 문단입니다.";
    const chunks = chunkNarration(text, 20);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join("")).toBe(text);
  });

  it("keeps an oversized single paragraph whole when it has no blank lines to split further", () => {
    const longParagraph = "매우 긴 문단입니다. ".repeat(20);
    expect(chunkNarration(longParagraph, 20)).toEqual([longParagraph]);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run lib/pipeline/splitScenes.test.ts`
Expected: FAIL — `chunkNarration is not exported` 또는 `chunkNarration is not defined` 에러.

- [ ] **Step 3: `chunkNarration` 구현**

`lib/pipeline/splitScenes.ts`의 최상단 import 바로 아래(기존 `export interface Scene { ... }` 블록 앞, 파일 1번째 줄 `import { LARGE_OUTPUT_MAX_TOKENS, ... } from "../ai/llm/types";` 다음 줄)에 아래 코드를 추가한다:

```ts
const HEADING_LINE_PATTERN = /^#{1,6}\s+/;

/** Splits text into lines, keeping each line's trailing newline attached so `lines.join("")` reconstructs the input exactly. */
function splitIntoLines(text: string): string[] {
  return text.split(/(?<=\n)/);
}

/** Splits text at the start of each heading line — a "section" spans from one heading (inclusive) to just before the next. Leading content before the first heading (if any) is its own section. */
function splitIntoHeaderSections(text: string): string[] {
  const lines = splitIntoLines(text);
  const sections: string[] = [];
  let current = "";
  for (const line of lines) {
    const isHeading = HEADING_LINE_PATTERN.test(line.replace(/\n$/, ""));
    if (isHeading && current.length > 0) {
      sections.push(current);
      current = line;
    } else {
      current += line;
    }
  }
  if (current.length > 0) sections.push(current);
  return sections;
}

/** Splits text at blank-line boundaries — a "paragraph" ends right before the first non-blank line that follows one or more blank lines. Blank lines stay attached to the end of the preceding paragraph. */
function splitIntoParagraphs(text: string): string[] {
  const lines = splitIntoLines(text);
  const paragraphs: string[] = [];
  let current = "";
  let sawBlank = false;
  for (const line of lines) {
    const isBlank = line.replace(/\n$/, "").trim() === "";
    if (isBlank) {
      current += line;
      sawBlank = true;
      continue;
    }
    if (sawBlank && current.length > 0) {
      paragraphs.push(current);
      current = line;
    } else {
      current += line;
    }
    sawBlank = false;
  }
  if (current.length > 0) paragraphs.push(current);
  return paragraphs;
}

/** Greedily packs blocks (in order) into chunks no larger than `budget`, never splitting a block. A single block already over budget becomes its own chunk. */
function packByBudget(blocks: string[], budget: number): string[] {
  const chunks: string[] = [];
  let current = "";
  for (const block of blocks) {
    if (current.length > 0 && current.length + block.length > budget) {
      chunks.push(current);
      current = block;
    } else {
      current += block;
    }
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

/** Conservative starting budget: see docs/superpowers/specs/2026-08-04-scene-split-chunking-design.md for the reasoning (a 35,928-char narration already overflowed the 65536-token output ceiling). */
export const SCENE_SPLIT_CHUNK_CHAR_BUDGET = 8000;

/**
 * Splits a long narration into character-budget-sized chunks so a single AI
 * call's JSON output (original text + per-scene metadata) doesn't exceed the
 * model's max_tokens ceiling. Boundaries prefer document headers; a header
 * section that alone exceeds the budget is further split by paragraph. The
 * concatenation of the returned chunks always reconstructs the input exactly
 * (validateNarrationIntegrity depends on this).
 */
export function chunkNarration(
  narrationMarkdown: string,
  budget: number = SCENE_SPLIT_CHUNK_CHAR_BUDGET
): string[] {
  if (narrationMarkdown.length <= budget) return [narrationMarkdown];

  const sections = splitIntoHeaderSections(narrationMarkdown);
  const blocks = sections.flatMap((section) =>
    section.length > budget ? splitIntoParagraphs(section) : [section]
  );
  return packByBudget(blocks, budget);
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run lib/pipeline/splitScenes.test.ts`
Expected: PASS — 기존 테스트 전부 + 새 `chunkNarration` 테스트 5개 모두 통과.

- [ ] **Step 5: 커밋**

```bash
git add lib/pipeline/splitScenes.ts lib/pipeline/splitScenes.test.ts
git commit -m "$(cat <<'EOF'
Add chunkNarration for splitting long narrations before AI scene-split calls

Scene splitting must reproduce the narration verbatim inside the JSON
response, so very long documents overflow the model's max_tokens output
ceiling. chunkNarration splits at header/paragraph boundaries (never
mid-sentence) into budget-sized pieces that reconstruct the original
text exactly when concatenated.
EOF
)"
```

---

### Task 2: `RawScene` 분리 — `parseRawScenes` / `assignSceneIds`

이 리팩터링은 여러 구간의 원시 응답을 모았다가 마지막에 한 번만 id를 매기기 위한 준비 작업이다. `parseScenesResponse`의 동작은 바뀌지 않는다(순수 리팩터링).

**Files:**
- Modify: `lib/pipeline/splitScenes.ts`
- Test: `lib/pipeline/splitScenes.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`splitScenes.test.ts`의 import 문을 아래와 같이 갱신한다:

```ts
import { splitScenes, chunkNarration, parseRawScenes, assignSceneIds } from "./splitScenes";
```

파일 끝에 아래 `describe` 블록을 추가한다:

```ts

describe("parseRawScenes / assignSceneIds", () => {
  it("resolves relatedOrders that point at scenes merged in from an earlier chunk", () => {
    const chunk1 = parseRawScenes(
      JSON.stringify({
        scenes: [{ order: 1, narrationText: "개념 A", estimatedDurationSec: 5, splitReason: "도입" }],
      })
    );
    const chunk2 = parseRawScenes(
      JSON.stringify({
        scenes: [
          {
            order: 2,
            narrationText: "A와 B를 연결",
            estimatedDurationSec: 5,
            splitReason: "연결",
            relatedOrders: [1],
          },
        ],
      })
    );

    const scenes = assignSceneIds([...chunk1, ...chunk2]);

    expect(scenes[1].relatedSceneIds).toEqual(["scene-001"]);
  });

  it("throws on malformed JSON, same as parseScenesResponse used to", () => {
    expect(() => parseRawScenes("not json")).toThrow();
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run lib/pipeline/splitScenes.test.ts`
Expected: FAIL — `parseRawScenes is not exported` / `assignSceneIds is not exported`.

- [ ] **Step 3: 구현 — `parseScenesResponse`를 두 함수로 분리**

`lib/pipeline/splitScenes.ts`에서 다음 블록을 찾는다:

```ts
interface RawScene {
  order: number;
  narrationText: string;
  estimatedDurationSec: number;
  splitReason: string;
  relatedOrders?: number[];
  sceneType?: "title" | "content";
  depth?: number | null;
}

export function parseScenesResponse(raw: string): Scene[] {
  const parsed = JSON.parse(raw) as { scenes: RawScene[] };
  if (!parsed || !Array.isArray(parsed.scenes)) {
    throw new Error("AI 응답 형식이 올바르지 않습니다 (scenes 배열 없음)");
  }

  const idByOrder = new Map(parsed.scenes.map((scene, index) => [scene.order, `scene-${String(index + 1).padStart(3, "0")}`]));

  return parsed.scenes.map((scene, index) => {
    const id = `scene-${String(index + 1).padStart(3, "0")}`;
    const relatedSceneIds = (scene.relatedOrders ?? [])
      .map((order) => idByOrder.get(order))
      .filter((relatedId): relatedId is string => Boolean(relatedId) && relatedId !== id);
    const sceneType = scene.sceneType === "title" ? "title" : "content";
    return {
      id,
      order: scene.order,
      narrationText: scene.narrationText,
      estimatedDurationSec: scene.estimatedDurationSec,
      splitReason: scene.splitReason,
      ...(relatedSceneIds.length > 0 ? { relatedSceneIds } : {}),
      sceneType,
      ...(sceneType === "title" && typeof scene.depth === "number" ? { depth: scene.depth } : {}),
    };
  });
}
```

이걸 통째로 아래로 교체한다:

```ts
export interface RawScene {
  order: number;
  narrationText: string;
  estimatedDurationSec: number;
  splitReason: string;
  relatedOrders?: number[];
  sceneType?: "title" | "content";
  depth?: number | null;
}

export function parseRawScenes(raw: string): RawScene[] {
  const parsed = JSON.parse(raw) as { scenes: RawScene[] };
  if (!parsed || !Array.isArray(parsed.scenes)) {
    throw new Error("AI 응답 형식이 올바르지 않습니다 (scenes 배열 없음)");
  }
  return parsed.scenes;
}

/** Assigns global sequential ids and resolves relatedOrders → relatedSceneIds. Call once on the full, order-concatenated list — see chunkNarration/splitScenesStream for how multi-chunk runs build that list before calling this. */
export function assignSceneIds(rawScenes: RawScene[]): Scene[] {
  const idByOrder = new Map(rawScenes.map((scene, index) => [scene.order, `scene-${String(index + 1).padStart(3, "0")}`]));

  return rawScenes.map((scene, index) => {
    const id = `scene-${String(index + 1).padStart(3, "0")}`;
    const relatedSceneIds = (scene.relatedOrders ?? [])
      .map((order) => idByOrder.get(order))
      .filter((relatedId): relatedId is string => Boolean(relatedId) && relatedId !== id);
    const sceneType = scene.sceneType === "title" ? "title" : "content";
    return {
      id,
      order: scene.order,
      narrationText: scene.narrationText,
      estimatedDurationSec: scene.estimatedDurationSec,
      splitReason: scene.splitReason,
      ...(relatedSceneIds.length > 0 ? { relatedSceneIds } : {}),
      sceneType,
      ...(sceneType === "title" && typeof scene.depth === "number" ? { depth: scene.depth } : {}),
    };
  });
}

export function parseScenesResponse(raw: string): Scene[] {
  return assignSceneIds(parseRawScenes(raw));
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run lib/pipeline/splitScenes.test.ts`
Expected: PASS — 기존 `parseScenesResponse`/`splitScenes` 테스트(동작 동일하므로 무수정 통과) + 새 테스트 2개 모두 통과.

- [ ] **Step 5: 커밋**

```bash
git add lib/pipeline/splitScenes.ts lib/pipeline/splitScenes.test.ts
git commit -m "$(cat <<'EOF'
Split parseScenesResponse into parseRawScenes + assignSceneIds

Pure refactor, no behavior change (parseScenesResponse now delegates
to the two). Lets the scenes API route parse each chunk's response
independently and assign global scene ids only once, after every
chunk's raw scenes are concatenated in order.
EOF
)"
```

---

### Task 3: 프롬프트에 이전 구간 컨텍스트 + 시작 order 추가

**Files:**
- Modify: `lib/pipeline/splitScenes.ts`
- Test: `lib/pipeline/splitScenes.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`splitScenes.test.ts`의 import 문을 아래와 같이 갱신한다:

```ts
import { splitScenes, splitScenesStream, chunkNarration, parseRawScenes, assignSceneIds } from "./splitScenes";
```

파일 끝에 아래 `describe` 블록을 추가한다:

```ts

describe("splitScenesStream prior-chunk context", () => {
  it("does not mention prior scenes or a start order when none are given", async () => {
    const client = new MockLlmClient([SAMPLE_RESPONSE]);

    await splitScenesStream(client, "나레이션");

    const prompt = client.calls[0].messages[1].content;
    expect(prompt).not.toContain("이전 구간에서 이미 분할된 씬 목록");
    expect(prompt).not.toContain("이어서 번호를 매기세요");
  });

  it("includes the prior scene list and start-order instruction when given", async () => {
    const client = new MockLlmClient([SAMPLE_RESPONSE]);

    await splitScenesStream(client, "나레이션", undefined, {
      priorScenes: [{ order: 1, narrationText: "이전 씬 내용" }],
      startOrder: 2,
    });

    const prompt = client.calls[0].messages[1].content;
    expect(prompt).toContain("[order=1] 이전 씬 내용");
    expect(prompt).toContain("order 2");
    expect(prompt).toContain("이어서 번호를 매기세요");
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run lib/pipeline/splitScenes.test.ts`
Expected: FAIL — 두 번째 테스트가 프롬프트에 해당 문구가 없어 실패(`splitScenesStream`이 아직 4번째 인자를 받지 않음 — TypeScript 컴파일 자체는 vitest가 esbuild로 타입 무시하고 실행하므로 런타임에서 문구 불일치로 실패).

- [ ] **Step 3: 구현 — `buildSplitScenesMessages`/`splitScenesStream` 확장**

`lib/pipeline/splitScenes.ts`에서 아래 함수를 찾는다:

```ts
function buildSplitScenesMessages(narrationMarkdown: string): ChatMessage[] {
  const prompt = `다음 나레이션을 씬으로 분할하세요. 나레이션 문구는 절대 수정하지 말고 분절만 하세요.
```

이 함수 전체(시그니처부터 반환문까지)를 아래로 교체한다:

```ts
function buildSplitScenesMessages(
  narrationMarkdown: string,
  priorScenes?: { order: number; narrationText: string }[],
  startOrder?: number
): ChatMessage[] {
  const priorScenesBlock =
    priorScenes && priorScenes.length > 0
      ? `\n이전 구간에서 이미 분할된 씬 목록(참고용 — 다시 만들지 말고, relatedOrders에서 참조만 하세요):\n${priorScenes
          .map((s) => `[order=${s.order}] ${s.narrationText}`)
          .join("\n")}\n`
      : "";
  const startOrderInstruction =
    typeof startOrder === "number" && startOrder > 1
      ? `\n이번 구간은 더 긴 원고의 일부입니다. 새로 만드는 씬은 order ${startOrder}부터 이어서 번호를 매기세요(1부터 다시 시작하지 마세요).\n`
      : "";
  const relatedOrdersNote =
    priorScenes && priorScenes.length > 0
      ? " 위에 나열된 이전 구간의 order도 참조할 수 있습니다."
      : "";

  const prompt = `다음 나레이션을 씬으로 분할하세요. 나레이션 문구는 절대 수정하지 말고 분절만 하세요.

이 결과물은 최종적으로 나레이션 음성 + 화면 이미지를 이어붙인 "동영상"으로 제작됩니다. 씬 하나 = 화면이 실제로 전환되는 한 컷이라고 생각하고, 화면 전환이 자연스러운 지점에서 분할하세요 — 문장을 기계적으로 끊는 것이 아니라, "여기서 화면이 바뀌어야 시청자가 자연스럽다"고 판단되는 지점을 찾으세요.

씬 길이 기준(문장 수): 씬 하나는 1~2문장으로 구성하세요. 3문장 이상을 한 씬에 담지 마세요. 문장 하나가 매우 길거나 그 자체로 완결된 화면 전환 단위라면 1문장짜리 씬도 괜찮습니다.

씬 길이 기준(예상 재생시간, 참고용):
${SCENE_LENGTH_GUIDE}

분할 기준: ${SPLIT_CRITERIA}

제목 줄 처리: 원문에서 #, ##, ### 등으로 시작하는 헤더 줄을 만나면, 그 줄 하나를 독립된 씬으로 만들고 sceneType을 "title", depth를 헤더 기호(#) 개수로 설정하세요(# → 1, ## → 2, ### → 3). title 씬의 narrationText는 헤더 기호만 제거한 제목 텍스트 그대로 두세요 — 단어를 바꾸거나 요약하지 마세요. title 씬은 문장 분할 대상이 아니라 그 줄 자체가 하나의 씬입니다.

내용 줄 처리: 헤더가 아닌 본문 문장은 지금까지처럼 sceneType을 "content"로 설정하고 분할하세요. content 씬의 narrationText는 실제 사람이 읽는 순수한 나레이션 문장만 담아야 합니다. 원문에 포함된 마크다운 문법(-, *, 숫자. 같은 목록 기호, **, _, \` 같은 강조/코드 기호 등)은 narrationText에 포함하지 말고 제거한 뒤 문장만 옮기세요. 서식은 나레이션 문서(narration.md)의 가독성을 위한 것이며, 씬 나레이션 텍스트 자체는 서식 없는 평문(plain prose)이어야 합니다. 단, 문장의 실제 단어나 표현은 임의로 바꾸지 마세요. content 씬에는 depth를 넣지 마세요.

splitReason: 왜 하필 이 지점에서 화면을 나눴는지 구체적으로 설명하세요. "문장이 끝나서"처럼 형식적인 이유가 아니라 "새로운 개념 도입", "질문 제기 후 답변 전환", "사례 나열 시작", "이전 두 내용을 하나로 연결" 등 실제 내용/화면 전환 근거를 쓰세요. title 씬은 "장/절 제목"처럼 간단히 써도 됩니다.

relatedOrders: 이 씬이 다른 씬과 하나의 이야기 흐름으로 묶인다면(예: 두 개념을 각각 소개한 뒤 하나로 잇거나 요약하는 씬), 관련된 씬들의 order 번호를 배열로 쓰세요. 특히 여러 씬에서 각각 다룬 내용을 종합·연결·비교하는 씬이라면 그 대상이 되는 씬들의 order를 반드시 표시하세요. 독립적인 씬이면 빈 배열로 두세요.${relatedOrdersNote}
${priorScenesBlock}${startOrderInstruction}
나레이션:
"""
${narrationMarkdown}
"""

JSON으로만 응답하세요: {"scenes": [{"order": number, "narrationText": string, "estimatedDurationSec": number, "splitReason": string, "relatedOrders": number[], "sceneType": "title" | "content", "depth": number | null}]}`;

  return [
    { role: "system", content: "당신은 이러닝 스토리보드 제작을 돕는 씬 분할 전문가입니다." },
    { role: "user", content: prompt },
  ];
}
```

그다음, 파일 맨 아래의 `splitScenesStream` 함수를 찾는다:

```ts
export async function splitScenesStream(
  client: LlmClient,
  narrationMarkdown: string,
  signal?: AbortSignal
): Promise<AsyncIterable<string>> {
  return client.completeStream(buildSplitScenesMessages(narrationMarkdown), {
    jsonMode: true,
    tier: "accurate",
    maxTokens: LARGE_OUTPUT_MAX_TOKENS,
    signal,
  });
}
```

이걸 아래로 교체한다:

```ts
export async function splitScenesStream(
  client: LlmClient,
  narrationMarkdown: string,
  signal?: AbortSignal,
  context?: { priorScenes?: { order: number; narrationText: string }[]; startOrder?: number }
): Promise<AsyncIterable<string>> {
  return client.completeStream(
    buildSplitScenesMessages(narrationMarkdown, context?.priorScenes, context?.startOrder),
    {
      jsonMode: true,
      tier: "accurate",
      maxTokens: LARGE_OUTPUT_MAX_TOKENS,
      signal,
    }
  );
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run lib/pipeline/splitScenes.test.ts`
Expected: PASS — 전체 테스트(기존 + Task 1/2/3 신규분) 모두 통과.

- [ ] **Step 5: 커밋**

```bash
git add lib/pipeline/splitScenes.ts lib/pipeline/splitScenes.test.ts
git commit -m "$(cat <<'EOF'
Let splitScenesStream carry prior-chunk context across scene-split calls

Adds optional priorScenes + startOrder to buildSplitScenesMessages/
splitScenesStream so a later narration chunk's scenes can continue the
global order sequence and reference scenes from earlier chunks via
relatedOrders. No-op when omitted (short, single-chunk narrations are
byte-identical to before).
EOF
)"
```

---

### Task 4: `scenes/route.ts` — 구간 순회 루프로 교체

이 코드 경로는 저장소 관례상(다른 API 라우트도 전부 그렇듯) 자동화 테스트 대상이 아니다 — Task 5에서 실제 서버로 수동 검증한다.

**Files:**
- Modify: `app/api/projects/[projectId]/scenes/route.ts`

- [ ] **Step 1: `POST` 핸들러 교체**

`app/api/projects/[projectId]/scenes/route.ts` 파일 전체를 아래로 교체한다(`PUT` 핸들러는 무수정 — 그대로 둔다):

```ts
import { NextRequest, NextResponse } from "next/server";
import { readProject, readProjectFile, writeProjectFile, updateProjectStep } from "@/lib/projects/store";
import { createLlmClient } from "@/lib/ai/llm/factory";
import {
  splitScenesStream,
  parseRawScenes,
  assignSceneIds,
  chunkNarration,
  type Scene,
  type RawScene,
} from "@/lib/pipeline/splitScenes";
import { validateNarrationIntegrity } from "@/lib/pipeline/validateNarrationIntegrity";
import { createResilientStream } from "@/lib/http/resilientStream";
import { startJob, finishJob, recordChunk, recordProgress, getJob, JobAlreadyRunningError } from "@/lib/jobs/registry";

const STEP = "scenes" as const;

export async function POST(_req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const project = await readProject(projectId);
  if (!project) return NextResponse.json({ error: "프로젝트를 찾을 수 없습니다" }, { status: 404 });

  const narration = await readProjectFile(projectId, "narration.md");
  if (!narration) return NextResponse.json({ error: "나레이션 마크다운이 없습니다" }, { status: 400 });

  let job;
  try {
    job = startJob(projectId, STEP);
  } catch (err) {
    if (err instanceof JobAlreadyRunningError) {
      return NextResponse.json({ error: "이미 실행 중입니다" }, { status: 409 });
    }
    throw err;
  }

  const narrationChunks = chunkNarration(narration);
  const client = createLlmClient();

  let firstChunkStream: AsyncIterable<string>;
  try {
    firstChunkStream = await splitScenesStream(client, narrationChunks[0], job.controller.signal);
  } catch (err) {
    console.error("씬 분할 실패:", err);
    finishJob(projectId, STEP, "error", "AI 씬 분할에 실패했습니다");
    return NextResponse.json(
      { error: "AI 씬 분할에 실패했습니다. 잠시 후 다시 시도해주세요." },
      { status: 502 }
    );
  }

  const stream = createResilientStream(async (emit) => {
    async function consumeChunk(chunkStream: AsyncIterable<string>): Promise<string> {
      let raw = "";
      for await (const delta of chunkStream) {
        raw += delta;
        recordChunk(projectId, STEP, delta);
        emit(JSON.stringify({ type: "chunk", text: delta }) + "\n");
      }
      return raw;
    }

    try {
      const allRawScenes: RawScene[] = [];

      for (let i = 0; i < narrationChunks.length; i++) {
        const chunkStream =
          i === 0
            ? firstChunkStream
            : await splitScenesStream(client, narrationChunks[i], job.controller.signal, {
                priorScenes: allRawScenes.map((s) => ({ order: s.order, narrationText: s.narrationText })),
                startOrder: allRawScenes.length + 1,
              });

        const raw = await consumeChunk(chunkStream);

        let chunkScenes: RawScene[];
        try {
          chunkScenes = parseRawScenes(raw);
        } catch (err) {
          console.error("씬 분할 응답 파싱 실패:", err);
          finishJob(projectId, STEP, "error", "AI 응답 형식이 올바르지 않습니다");
          emit(JSON.stringify({ type: "error", message: "AI 응답 형식이 올바르지 않습니다" }) + "\n");
          return;
        }
        allRawScenes.push(...chunkScenes);

        if (narrationChunks.length > 1) recordProgress(projectId, STEP, i + 1, narrationChunks.length);
      }

      const scenes = assignSceneIds(allRawScenes);

      const integrityOk = validateNarrationIntegrity(
        narration,
        scenes.map((s) => s.narrationText)
      );

      await writeProjectFile(projectId, "scenes.json", JSON.stringify({ scenes }, null, 2));
      await updateProjectStep(projectId, STEP);
      finishJob(projectId, STEP, "done");

      emit(JSON.stringify({ type: "result", scenes, integrityOk }) + "\n");
    } catch (err) {
      if (job.controller.signal.aborted) {
        finishJob(projectId, STEP, "cancelled");
        emit(JSON.stringify({ type: "cancelled" }) + "\n");
        return;
      }
      console.error("씬 분할 스트리밍 중 오류:", err);
      finishJob(projectId, STEP, "error", "AI 씬 분할에 실패했습니다");
      emit(JSON.stringify({ type: "error", message: "AI 씬 분할에 실패했습니다" }) + "\n");
    }
  });

  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8" } });
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  if (getJob(projectId, STEP)?.status === "running") {
    return NextResponse.json({ error: "생성이 진행 중입니다. 완료 후 다시 시도해주세요" }, { status: 409 });
  }

  const body = (await req.json()) as { scenes?: unknown };
  if (!Array.isArray(body.scenes)) {
    return NextResponse.json({ error: "scenes 필드는 배열이어야 합니다" }, { status: 400 });
  }
  for (const scene of body.scenes) {
    if (
      typeof scene !== "object" ||
      scene === null ||
      typeof (scene as Scene).id !== "string" ||
      typeof (scene as Scene).order !== "number" ||
      typeof (scene as Scene).narrationText !== "string" ||
      typeof (scene as Scene).estimatedDurationSec !== "number" ||
      typeof (scene as Scene).splitReason !== "string"
    ) {
      return NextResponse.json({ error: "scenes 항목의 형식이 올바르지 않습니다" }, { status: 400 });
    }
  }
  await writeProjectFile(projectId, "scenes.json", JSON.stringify({ scenes: body.scenes }, null, 2));
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: 타입 체크**

Run: `npx tsc --noEmit`
Expected: 에러 없음(0 errors). `RawScene`/`parseRawScenes`/`assignSceneIds`/`chunkNarration` import 및 사용처 타입이 모두 일치해야 한다.

- [ ] **Step 3: 전체 테스트 스위트 실행**

Run: `npm test`
Expected: 전체 테스트 PASS (route.ts는 이 저장소 관례상 단위 테스트 대상이 아니므로 새 테스트는 없음 — 기존 스위트가 깨지지 않는지만 확인).

- [ ] **Step 4: 커밋**

```bash
git add app/api/projects/\[projectId\]/scenes/route.ts
git commit -m "$(cat <<'EOF'
Loop scene-split API route over narration chunks

Replaces the single AI call with a sequential loop over
chunkNarration()'s pieces, carrying forward each chunk's raw scenes as
context (and the running order count) so later chunks can reference
earlier ones. Chunk 0 still runs before the streaming Response is
constructed, preserving the existing 502-on-connection-failure path;
everything after streams in-band exactly like before.
EOF
)"
```

---

### Task 5: 실제 실패 사례로 수동 E2E 검증

Task 4의 코드는 자동화 테스트가 없으므로, 실제로 씬 분할이 실패했던 원고로 재현/검증한다.

**Files:** 없음(검증만 수행)

- [ ] **Step 1: 개발 서버 기동 확인**

Run: `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:9625`
Expected: `200`. 아니라면 `./start.sh`로 기동 후 재확인.

- [ ] **Step 2: 실패했던 원고로 씬 분할 재현**

이전에 max_tokens로 실패했던 프로젝트(`38c6bc8f-3b9a-401a-a682-74999e3002b9`, 나레이션 35,928자)로 씬 분할을 다시 호출한다:

Run:
```bash
curl -N -X POST http://localhost:9625/api/projects/38c6bc8f-3b9a-401a-a682-74999e3002b9/scenes
```

Expected: NDJSON 스트림이 끊기지 않고 끝까지 이어지고, 마지막 줄이 `{"type":"result", "scenes": [...], "integrityOk": true}` 형태로 도착한다(`integrityOk`가 `false`면 원문 재구성이 깨진 것이므로 실패로 간주). 서버 로그(`dev.log`)에 `[Job] ...:scenes 시작`이 여러 번(구간 수만큼) 찍히고, 이번엔 `stop_reason: max_tokens`로 실패하는 로그가 없어야 한다.

- [ ] **Step 3: 무결성/구간 로그 확인**

Run: `grep -E "\[Job\]|max_tokens" dev.log | tail -30`
Expected: `[Job] ...:scenes 진행 N/M` 형태의 진행 로그가 여러 줄 보이고(청크 개수만큼), `max_tokens` 관련 에러 로그는 없다.

- [ ] **Step 4: 짧은 원고로 회귀 확인 (기존 동작 무변화 검증)**

8,000자 미만 나레이션을 가진 다른 프로젝트를 찾는다:

Run: `for f in data/projects/*/narration.md; do echo "$(wc -m < "$f") $f"; done | sort -n | head -5`
Expected: 첫 줄에 8000 미만인 프로젝트가 하나 이상 보인다. 그 경로에서 프로젝트 id(`data/projects/<id>/narration.md`의 `<id>`)를 확인한다.

그 프로젝트 id로 동일하게 호출한다:

Run: `curl -N -X POST http://localhost:9625/api/projects/<위에서-찾은-id>/scenes`
Expected: 스트림이 끝까지 이어지고 `{"type":"result", ...}`로 마무리된다.

Run: `grep -E "\[Job\]" dev.log | tail -5`
Expected: 진행(`진행 N/M`) 로그 없이 `시작` → `종료 status=done`만 찍힌다(청크 1개일 때 `recordProgress`를 호출하지 않도록 만든 조건이 의도대로 동작 — 8,000자 미만이면 `chunkNarration`이 청크 1개만 반환하므로 기존과 동일).

이 태스크는 커밋할 코드 변경이 없으므로 별도 커밋은 없다. 검증 중 문제가 발견되면 해당 Task로 돌아가 수정 후 재검증한다.
