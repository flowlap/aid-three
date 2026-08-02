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

describe("selectScreenTypes", () => {
  it("maps each scene id to a screen type assignment", async () => {
    const client = new MockDeepSeekClient([
      assignmentJson(),
      assignmentJson({ screenType: "표/그래프형", recommendedLayout: "전체 화면 표", rationale: "표 데이터 설명" }),
    ]);

    const result = await selectScreenTypes(client, scenes);

    expect(Object.keys(result)).toEqual(["scene-001", "scene-002"]);
    expect(result["scene-002"].screenType).toBe("표/그래프형");
    expect(result["scene-001"].keywords).toEqual(["키워드1", "키워드2"]);
  });

  it("includes neighboring scene context and per-type descriptions in the prompt", async () => {
    const client = new MockDeepSeekClient([assignmentJson(), assignmentJson({ screenType: "표/그래프형" })]);

    await selectScreenTypes(client, scenes);

    const prompt = client.calls[0].messages[1].content;
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

  it("requests the flash model", async () => {
    const client = new MockDeepSeekClient([assignmentJson()]);

    await selectScreenTypes(client, [scenes[0]]);

    expect(client.calls[0].options?.model).toBe("deepseek-v4-flash");
  });

  it("calls onProgress after each scene with its index/total", async () => {
    const client = new MockDeepSeekClient([assignmentJson(), assignmentJson({ screenType: "표/그래프형" })]);
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

  it("stops before the next scene once the signal is aborted", async () => {
    const client = new MockDeepSeekClient([assignmentJson(), assignmentJson({ screenType: "표/그래프형" })]);
    const controller = new AbortController();

    await expect(
      selectScreenTypes(client, scenes, {
        onProgress: () => {
          controller.abort();
        },
        signal: controller.signal,
      })
    ).rejects.toThrow();

    expect(client.calls).toHaveLength(1);
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

  it("warns the model off a screen type after it repeats twice in a row", async () => {
    const threeScenes: Scene[] = [
      { id: "scene-001", order: 1, narrationText: "첫 문장.", estimatedDurationSec: 5, splitReason: "문장종결" },
      { id: "scene-002", order: 2, narrationText: "두번째 문장.", estimatedDurationSec: 5, splitReason: "문장종결" },
      { id: "scene-003", order: 3, narrationText: "세번째 문장.", estimatedDurationSec: 5, splitReason: "문장종결" },
    ];
    const client = new MockDeepSeekClient([
      assignmentJson({ rationale: "-", caption: "자막1" }),
      assignmentJson({ rationale: "-", caption: "자막2" }),
      assignmentJson({ screenType: "요약/정리형", recommendedLayout: "목록", rationale: "-", caption: "자막3" }),
    ]);

    await selectScreenTypes(client, threeScenes);

    expect(client.calls[2].messages[1].content).toContain('"텍스트 강조형"은 선택하지 말고');
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
    expect(client.calls).toHaveLength(1); // only scene-002 hit the AI
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
    const client = new MockDeepSeekClient([assignmentJson(), assignmentJson(), assignmentJson()]);

    await selectScreenTypes(client, withRelation);

    const thirdPrompt = client.calls[2].messages[1].content;
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
    const client = new MockDeepSeekClient([
      assignmentJson({ presenterPosition: "left" }),
      assignmentJson({ presenterPosition: "left" }),
    ]);

    await selectScreenTypes(client, scenes);

    const secondPrompt = client.calls[1].messages[1].content;
    expect(secondPrompt).toContain('이전 씬의 아나운서 위치는 "left"였습니다');
    expect(secondPrompt).toContain("같은 내용/주제의 연장선");
    expect(secondPrompt).toContain('"left"을 그대로 유지');
    expect(secondPrompt).toContain("새로운 주제나 내용으로 전환되는 지점이라면 다른 위치로");
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
