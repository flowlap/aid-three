import { describe, it, expect } from "vitest";
import { MockDeepSeekClient } from "../ai/deepseekClient.mock";
import { selectScreenTypes } from "./selectScreenTypes";
import type { Scene } from "./splitScenes";

const scenes: Scene[] = [
  { id: "scene-001", order: 1, narrationText: "정의를 설명합니다.", estimatedDurationSec: 10, splitReason: "문장종결" },
  { id: "scene-002", order: 2, narrationText: "표를 보여줍니다.", estimatedDurationSec: 20, splitReason: "표/그래프 등장" },
];

function assignmentJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    screenType: "텍스트 강조형",
    recommendedLayout: "중앙 텍스트",
    rationale: "정의 강조",
    caption: "짧은 요약 자막",
    keywords: ["키워드1", "키워드2"],
    imageOrDiagramDescription: "화면 설명",
    objectPlacement: "중앙",
    ...overrides,
  });
}

/**
 * Response for the up-front topic-grouping call. `boundaries` are the
 * "last scene order" of each group except the last (see
 * buildGroupsFromBoundaries in selectScreenTypes.ts); [] means "one group,
 * everything together" — the setting most tests below want, so a scene's
 * freshly-generated predecessor is always visible to it.
 */
function groupingResponse(boundaries: number[] = []): string {
  return JSON.stringify({ groupBoundaries: boundaries });
}

function manyScenes(count: number): Scene[] {
  return Array.from({ length: count }, (_, idx) => ({
    id: `scene-${String(idx + 1).padStart(3, "0")}`,
    order: idx + 1,
    narrationText: `문장 ${idx + 1}.`,
    estimatedDurationSec: 5,
    splitReason: "문장종결",
  }));
}

describe("selectScreenTypes", () => {
  it("maps each scene id to a screen type assignment", async () => {
    const client = new MockDeepSeekClient([
      groupingResponse(),
      assignmentJson(),
      assignmentJson({ screenType: "표/그래프형", recommendedLayout: "전체 화면 표", rationale: "표 데이터 설명" }),
    ]);

    const result = await selectScreenTypes(client, scenes);

    expect(Object.keys(result)).toEqual(["scene-001", "scene-002"]);
    expect(result["scene-002"].screenType).toBe("표/그래프형");
    expect(result["scene-001"].keywords).toEqual(["키워드1", "키워드2"]);
  });

  it("asks the topic-grouping call to find contiguous group boundaries before any scene call", async () => {
    const client = new MockDeepSeekClient([groupingResponse(), assignmentJson(), assignmentJson()]);

    await selectScreenTypes(client, scenes);

    expect(client.calls).toHaveLength(3);
    const groupingPrompt = client.calls[0].messages[1].content;
    expect(groupingPrompt).toContain("연속 구간");
    expect(groupingPrompt).toContain("정의를 설명합니다.");
    expect(groupingPrompt).toContain("표를 보여줍니다.");
    expect(client.calls[0].options?.model).toBe("deepseek-v4-pro");
  });

  it("skips the topic-grouping call entirely for a single pending scene", async () => {
    const client = new MockDeepSeekClient([assignmentJson()]);

    await selectScreenTypes(client, [scenes[0]]);

    expect(client.calls).toHaveLength(1);
    expect(client.calls[0].messages[1].content).not.toContain("groupBoundaries");
  });

  it("falls back to an even split when the grouping response is malformed", async () => {
    const client = new MockDeepSeekClient(["이건 JSON이 아님", assignmentJson(), assignmentJson()]);

    const result = await selectScreenTypes(client, scenes);

    expect(Object.keys(result)).toEqual(["scene-001", "scene-002"]);
    expect(client.calls).toHaveLength(3);
  });

  it("includes neighboring scene context and per-type descriptions in the prompt", async () => {
    const client = new MockDeepSeekClient([groupingResponse(), assignmentJson(), assignmentJson({ screenType: "표/그래프형" })]);

    await selectScreenTypes(client, scenes);

    const scene1Call = client.calls.find((call) => call.messages[1].content.includes("현재 씬: 정의를 설명합니다."));
    const prompt = scene1Call!.messages[1].content;
    expect(prompt).toContain("표를 보여줍니다.");
    // The guide now carries a description per type, not just a bare name list.
    expect(prompt).toContain("표/그래프형:");
    expect(prompt).toContain("간지/타이틀형:");
  });

  it("includes the document summary as shared context when provided", async () => {
    const client = new MockDeepSeekClient([assignmentJson()]);

    await selectScreenTypes(client, [scenes[0]], { documentSummary: "이 문서는 탄소배출권 제도를 다룬다." });

    expect(client.calls[0].messages[1].content).toContain("이 문서는 탄소배출권 제도를 다룬다.");
  });

  it("requests the flash model for per-scene design calls", async () => {
    const client = new MockDeepSeekClient([assignmentJson()]);

    await selectScreenTypes(client, [scenes[0]]);

    expect(client.calls[0].options?.model).toBe("deepseek-v4-flash");
  });

  it("calls onProgress after each scene with its index/total", async () => {
    const client = new MockDeepSeekClient([groupingResponse(), assignmentJson(), assignmentJson({ screenType: "표/그래프형" })]);
    const calls: Array<{ sceneId: string; index: number; total: number }> = [];

    await selectScreenTypes(client, scenes, {
      onProgress: (sceneId, index, total) => {
        calls.push({ sceneId, index, total });
      },
    });

    expect(calls).toEqual([
      { sceneId: "scene-001", index: 0, total: 2 },
      { sceneId: "scene-002", index: 1, total: 2 },
    ]);
  });

  it("stops before each worker's next scene once the signal is aborted", async () => {
    // 11 pending scenes grouped into 5 topic groups of sizes [3,2,2,2,2].
    // Every worker fires its *first* call synchronously before any of them
    // resolves, so no matter which one triggers the abort (via onProgress),
    // that first round of 5 calls has already gone out — but no worker
    // starts a second scene after that.
    const elevenScenes = manyScenes(11);
    const client = new MockDeepSeekClient([groupingResponse([3, 5, 7, 9]), assignmentJson()]);
    const controller = new AbortController();

    await expect(
      selectScreenTypes(client, elevenScenes, {
        onProgress: () => {
          controller.abort();
        },
        signal: controller.signal,
      })
    ).rejects.toThrow();

    // 1 grouping call + 5 first-round scene calls (one per worker).
    expect(client.calls).toHaveLength(6);
  });

  it("rejects a response missing the keywords field", async () => {
    const client = new MockDeepSeekClient([
      JSON.stringify({
        screenType: "텍스트 강조형",
        recommendedLayout: "중앙 텍스트",
        rationale: "정의 강조",
        caption: "짧은 요약 자막",
        // keywords omitted
      }),
    ]);

    await expect(selectScreenTypes(client, [scenes[0]])).rejects.toThrow();
  });

  it("warns the model off a screen type after it repeats twice in a row within one worker's group", async () => {
    // groupingResponse([3, 5, 7, 9]) over 11 scenes yields groups of sizes
    // [3,2,2,2,2] — worker 1 sequentially handles scene-001..003, so by
    // scene-003 it has full prevType/prevPrevType context from its own two
    // prior scenes in the same group.
    const elevenScenes = manyScenes(11);
    const client = new MockDeepSeekClient([groupingResponse([3, 5, 7, 9]), assignmentJson({ rationale: "-" })]);

    await selectScreenTypes(client, elevenScenes);

    const scene3Call = client.calls.find((call) => call.messages[1].content.includes("현재 씬: 문장 3."));
    expect(scene3Call).toBeDefined();
    expect(scene3Call!.messages[1].content).toContain('"텍스트 강조형"은 선택하지 말고');
  });

  it("reuses existingAssignments without calling the AI, and only for those scenes", async () => {
    const client = new MockDeepSeekClient([assignmentJson({ screenType: "표/그래프형" })]);
    const existing = {
      "scene-001": {
        screenType: "간지/타이틀형",
        recommendedLayout: "",
        rationale: "",
        caption: "기존 자막",
        keywords: ["기존"],
        imageOrDiagramDescription: "",
        objectPlacement: "",
      },
    };

    const result = await selectScreenTypes(client, scenes, { existingAssignments: existing });

    expect(result["scene-001"]).toEqual(existing["scene-001"]);
    expect(result["scene-002"].screenType).toBe("표/그래프형");
    expect(client.calls).toHaveLength(1); // only scene-002 hit the AI — a single pending scene skips grouping too
  });

  it("does not call onProgress for reused scenes, only for freshly generated ones", async () => {
    const client = new MockDeepSeekClient([assignmentJson({ screenType: "표/그래프형" })]);
    const existing = {
      "scene-001": {
        screenType: "간지/타이틀형",
        recommendedLayout: "",
        rationale: "",
        caption: "기존 자막",
        keywords: ["기존"],
        imageOrDiagramDescription: "",
        objectPlacement: "",
      },
    };
    const progressed: string[] = [];

    await selectScreenTypes(client, scenes, {
      existingAssignments: existing,
      onProgress: (sceneId) => {
        progressed.push(sceneId);
      },
    });

    expect(progressed).toEqual(["scene-002"]);
  });

  it("uses a reused scene's type for diversity checks on the following scene", async () => {
    const threeScenes: Scene[] = [
      { id: "scene-001", order: 1, narrationText: "첫 문장.", estimatedDurationSec: 5, splitReason: "문장종결" },
      { id: "scene-002", order: 2, narrationText: "두번째 문장.", estimatedDurationSec: 5, splitReason: "문장종결" },
      { id: "scene-003", order: 3, narrationText: "세번째 문장.", estimatedDurationSec: 5, splitReason: "문장종결" },
    ];
    const existing = {
      "scene-001": {
        screenType: "텍스트 강조형",
        recommendedLayout: "",
        rationale: "",
        caption: "c1",
        keywords: [],
        imageOrDiagramDescription: "",
        objectPlacement: "",
      },
      "scene-002": {
        screenType: "텍스트 강조형",
        recommendedLayout: "",
        rationale: "",
        caption: "c2",
        keywords: [],
        imageOrDiagramDescription: "",
        objectPlacement: "",
      },
    };
    const client = new MockDeepSeekClient([assignmentJson({ screenType: "요약/정리형" })]);

    await selectScreenTypes(client, threeScenes, { existingAssignments: existing });

    // Only scene-003 is pending — a single pending scene skips grouping too.
    expect(client.calls).toHaveLength(1);
    expect(client.calls[0].messages[1].content).toContain('"텍스트 강조형"은 선택하지 말고');
  });

  it("includes the common prompt as shared context when provided", async () => {
    const client = new MockDeepSeekClient([assignmentJson()]);

    await selectScreenTypes(client, [scenes[0]], { commonPrompt: "이 콘텐츠는 B2B 금융 실무자 대상입니다." });

    expect(client.calls[0].messages[1].content).toContain("이 콘텐츠는 B2B 금융 실무자 대상입니다.");
  });

  it("asks for imageOrDiagramDescription and objectPlacement in the prompt", async () => {
    const client = new MockDeepSeekClient([assignmentJson()]);

    await selectScreenTypes(client, [scenes[0]]);

    expect(client.calls[0].messages[1].content).toContain("imageOrDiagramDescription:");
    expect(client.calls[0].messages[1].content).toContain("objectPlacement:");
  });

  it("includes related scenes' narration as context when relatedSceneIds is set", async () => {
    const withRelation: Scene[] = [
      scenes[0],
      scenes[1],
      { id: "scene-003", order: 3, narrationText: "두 내용을 하나로 잇습니다.", estimatedDurationSec: 8, splitReason: "연결", relatedSceneIds: ["scene-001", "scene-002"] },
    ];
    const client = new MockDeepSeekClient([groupingResponse(), assignmentJson(), assignmentJson(), assignmentJson()]);

    await selectScreenTypes(client, withRelation);

    const thirdPrompt = client.calls.find((call) => call.messages[1].content.includes("현재 씬: 두 내용을 하나로 잇습니다."))!
      .messages[1].content;
    expect(thirdPrompt).toContain("관련 씬");
    expect(thirdPrompt).toContain("scene-001");
    expect(thirdPrompt).toContain("scene-002");
  });

  it("keeps a well-formed layoutElements array from the AI response", async () => {
    const client = new MockDeepSeekClient([
      assignmentJson({
        layoutElements: [
          { label: "인물", position: "left" },
          { label: "그래프", position: "right" },
        ],
      }),
    ]);

    const result = await selectScreenTypes(client, [scenes[0]]);

    expect(result["scene-001"].layoutElements).toEqual([
      { label: "인물", position: "left" },
      { label: "그래프", position: "right" },
    ]);
  });

  it("drops malformed layoutElements instead of failing the whole response", async () => {
    const client = new MockDeepSeekClient([
      assignmentJson({
        layoutElements: [
          { label: "인물", position: "not-a-real-position" },
          { label: "", position: "center" },
          { position: "left" },
        ],
      }),
    ]);

    const result = await selectScreenTypes(client, [scenes[0]]);

    expect(result["scene-001"].layoutElements).toBeUndefined();
  });

  it("keeps a valid presenterPosition from the AI response", async () => {
    const client = new MockDeepSeekClient([assignmentJson({ presenterPosition: "right" })]);

    const result = await selectScreenTypes(client, [scenes[0]]);

    expect(result["scene-001"].presenterPosition).toBe("right");
  });

  it("drops an invalid presenterPosition value", async () => {
    const client = new MockDeepSeekClient([assignmentJson({ presenterPosition: "somewhere" })]);

    const result = await selectScreenTypes(client, [scenes[0]]);

    expect(result["scene-001"].presenterPosition).toBeUndefined();
  });

  it("clears presenterPosition for a transition/title screen type even if the AI returned one", async () => {
    const client = new MockDeepSeekClient([assignmentJson({ screenType: "간지/타이틀형", presenterPosition: "center" })]);

    const result = await selectScreenTypes(client, [scenes[0]]);

    expect(result["scene-001"].presenterPosition).toBeUndefined();
  });

  it("tells the model the previous scene's presenter position and to keep it for continuing content / change it for a topic shift", async () => {
    // scene-001 is pre-resolved (existingAssignments) so scene-002 is the
    // only pending scene — single pending scene skips grouping and can see
    // scene-001's assignment synchronously.
    const existing = {
      "scene-001": {
        screenType: "텍스트 강조형",
        recommendedLayout: "",
        rationale: "",
        caption: "c1",
        keywords: [],
        imageOrDiagramDescription: "",
        objectPlacement: "",
        presenterPosition: "left" as const,
      },
    };
    const client = new MockDeepSeekClient([assignmentJson({ presenterPosition: "left" })]);

    await selectScreenTypes(client, scenes, { existingAssignments: existing });

    const prompt = client.calls[0].messages[1].content;
    expect(prompt).toContain('이전 씬의 아나운서 위치는 "left"였습니다');
    expect(prompt).toContain("같은 내용/주제의 연장선");
    expect(prompt).toContain('"left"을 그대로 유지');
    expect(prompt).toContain("새로운 주제나 내용으로 전환되는 지점이라면 다른 위치로");
  });

  it("omits the presenter continuity note for the first scene (no previous position yet)", async () => {
    const client = new MockDeepSeekClient([assignmentJson()]);

    await selectScreenTypes(client, [scenes[0]]);

    expect(client.calls[0].messages[1].content).not.toContain("아나운서 위치는");
  });

  it("resolves related scenes from allScenesForContext when scenes is a subset (single-scene regenerate)", async () => {
    const fullScenes: Scene[] = [
      scenes[0],
      scenes[1],
      { id: "scene-003", order: 3, narrationText: "두 내용을 하나로 잇습니다.", estimatedDurationSec: 8, splitReason: "연결", relatedSceneIds: ["scene-001", "scene-002"] },
    ];
    const client = new MockDeepSeekClient([assignmentJson()]);

    await selectScreenTypes(client, [fullScenes[2]], { allScenesForContext: fullScenes });

    const prompt = client.calls[0].messages[1].content;
    expect(prompt).toContain("관련 씬");
    expect(prompt).toContain("정의를 설명합니다.");
  });
});
