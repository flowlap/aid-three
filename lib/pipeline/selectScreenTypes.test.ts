import { describe, it, expect } from "vitest";
import { MockLlmClient } from "../ai/llm/mockLlmClient";
import { selectScreenTypes, type SceneSequenceContext } from "./selectScreenTypes";
import type { Scene } from "./splitScenes";
import type { Sequence, SequencePlan } from "./sequenceTypes";

function content(id: string, narrationText: string, order: number, extra: Partial<Scene> = {}): Scene {
  return { id, order, narrationText, estimatedDurationSec: 5, splitReason: "-", sceneType: "content", ...extra };
}

function title(id: string, narrationText: string, depth: number, order: number): Scene {
  return { id, order, narrationText, estimatedDurationSec: 3, splitReason: "장 제목", sceneType: "title", depth };
}

const scenes: Scene[] = [
  content("scene-001", "정의를 설명합니다.", 1),
  content("scene-002", "표를 보여줍니다.", 2),
];

/** Batch response for a group of scenes: one entry per scene, keyed by order, with sensible defaults. */
function batchResponse(groupScenes: Scene[], overridesByOrder: Record<number, Record<string, unknown>> = {}): string {
  return JSON.stringify({
    scenes: groupScenes.map((s) => ({
      order: s.order,
      screenType: "텍스트 강조형",
      recommendedLayout: "중앙 텍스트",
      rationale: "정의 강조",
      caption: "짧은 요약 자막",
      keywords: ["키워드1", "키워드2"],
      imageOrDiagramDescription: "화면 설명",
      objectPlacement: "중앙",
      ...(overridesByOrder[s.order] ?? {}),
    })),
  });
}

describe("selectScreenTypes", () => {
  it("maps each scene id to a screen type assignment", async () => {
    const client = new MockLlmClient([
      batchResponse(scenes, {
        2: { screenType: "표/그래프형", recommendedLayout: "전체 화면 표", rationale: "표 데이터 설명" },
      }),
    ]);

    const result = await selectScreenTypes(client, scenes);

    expect(Object.keys(result)).toEqual(["scene-001", "scene-002"]);
    expect(result["scene-002"].screenType).toBe("표/그래프형");
    expect(result["scene-001"].keywords).toEqual(["키워드1", "키워드2"]);
  });

  it("sends every pending content scene in a single batch call when there is no title scene", async () => {
    const client = new MockLlmClient([batchResponse(scenes)]);

    await selectScreenTypes(client, scenes);

    expect(client.calls).toHaveLength(1);
    const prompt = client.calls[0].messages[1].content;
    expect(prompt).toContain("[order=1]");
    expect(prompt).toContain("[order=2]");
    expect(prompt).toContain("정의를 설명합니다.");
    expect(prompt).toContain("표를 보여줍니다.");
    expect(client.calls[0].options?.tier).toBe("fast");
  });

  it("designs title scenes locally without any AI call", async () => {
    const withTitle = [title("scene-000", "1장 소개", 1, 0), ...scenes];
    const client = new MockLlmClient([batchResponse(scenes)]);

    const result = await selectScreenTypes(client, withTitle);

    expect(client.calls).toHaveLength(1); // only the content batch call — the title never hits the AI
    expect(result["scene-000"]).toMatchObject({ screenType: "간지/타이틀형", caption: "1장 소개" });
  });

  it("calls onProgress for title scenes before any content batch call resolves", async () => {
    const withTitle = [title("scene-000", "1장 소개", 1, 0), ...scenes];
    const client = new MockLlmClient([batchResponse(scenes)]);
    const progressed: string[] = [];

    await selectScreenTypes(client, withTitle, {
      onProgress: (sceneId) => {
        progressed.push(sceneId);
      },
    });

    expect(progressed).toEqual(["scene-000", "scene-001", "scene-002"]);
  });

  it("groups content scenes by their nearest ancestor title into separate batch calls", async () => {
    const s = [
      title("t1", "1장", 1, 1),
      content("c1", "내용 A", 2),
      content("c2", "내용 B", 3),
      title("t2", "2장", 1, 4),
      content("c3", "내용 C", 5),
    ];
    const client = new MockLlmClient([batchResponse([s[1], s[2]]), batchResponse([s[4]])]);

    await selectScreenTypes(client, s);

    expect(client.calls).toHaveLength(2);
    const promptA = client.calls.find((c) => c.messages[1].content.includes("내용 A"))!.messages[1].content;
    expect(promptA).toContain("내용 B");
    expect(promptA).not.toContain("내용 C");
  });

  it("splits a group larger than the max batch size into parallel sub-batches", async () => {
    const contentScenes = Array.from({ length: 10 }, (_, i) => content(`c${i + 1}`, `내용 ${i + 1}`, i + 1));
    const client = new MockLlmClient([batchResponse(contentScenes.slice(0, 8)), batchResponse(contentScenes.slice(8, 10))]);

    const result = await selectScreenTypes(client, contentScenes);

    expect(client.calls).toHaveLength(2);
    expect(Object.keys(result)).toHaveLength(10);
  });

  it("includes a generic same-group diversity instruction instead of a per-scene note", async () => {
    const client = new MockLlmClient([batchResponse(scenes)]);

    await selectScreenTypes(client, scenes);

    expect(client.calls[0].messages[1].content).toContain("3개 연속으로 동일하게 선택하지 마세요");
  });

  it("includes the document summary as shared context when provided", async () => {
    const client = new MockLlmClient([batchResponse([scenes[0]])]);

    await selectScreenTypes(client, [scenes[0]], { documentSummary: "이 문서는 탄소배출권 제도를 다룬다." });

    expect(client.calls[0].messages[1].content).toContain("이 문서는 탄소배출권 제도를 다룬다.");
  });

  it("includes the common prompt as shared context when provided", async () => {
    const client = new MockLlmClient([batchResponse([scenes[0]])]);

    await selectScreenTypes(client, [scenes[0]], { commonPrompt: "이 콘텐츠는 B2B 금융 실무자 대상입니다." });

    expect(client.calls[0].messages[1].content).toContain("이 콘텐츠는 B2B 금융 실무자 대상입니다.");
  });

  it("requests the fast tier with a large output budget for group calls", async () => {
    const client = new MockLlmClient([batchResponse([scenes[0]])]);

    await selectScreenTypes(client, [scenes[0]]);

    expect(client.calls[0].options?.tier).toBe("fast");
    expect(client.calls[0].options?.maxTokens).toBe(64000);
  });

  it("parses a response the AI wrapped in a markdown code fence", async () => {
    const client = new MockLlmClient([`\`\`\`json\n${batchResponse(scenes)}\n\`\`\``]);

    const result = await selectScreenTypes(client, scenes);

    expect(Object.keys(result)).toEqual(["scene-001", "scene-002"]);
  });

  it("asks for imageOrDiagramDescription and objectPlacement in the prompt", async () => {
    const client = new MockLlmClient([batchResponse([scenes[0]])]);

    await selectScreenTypes(client, [scenes[0]]);

    expect(client.calls[0].messages[1].content).toContain("imageOrDiagramDescription:");
    expect(client.calls[0].messages[1].content).toContain("objectPlacement:");
  });

  it("calls onProgress after each scene with its index/total", async () => {
    const client = new MockLlmClient([
      batchResponse(scenes, { 2: { screenType: "표/그래프형" } }),
    ]);
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

  it("rejects when the AI response is missing one of the requested scenes on every attempt", async () => {
    const client = new MockLlmClient([batchResponse([scenes[0]])]); // only order 1, order 2 missing

    await expect(selectScreenTypes(client, scenes)).rejects.toThrow();
    expect(client.calls).toHaveLength(5); // retries up to MAX_GROUP_ATTEMPTS before giving up
  });

  it("retries a group call that came back missing a scene, and succeeds if the retry is complete", async () => {
    const client = new MockLlmClient([
      batchResponse([scenes[0]]), // first attempt: order 2 missing
      batchResponse(scenes), // retry: complete
    ]);

    const result = await selectScreenTypes(client, scenes);

    expect(client.calls).toHaveLength(2);
    expect(Object.keys(result)).toEqual(["scene-001", "scene-002"]);
  });

  it("rejects a scene entry missing the keywords field", async () => {
    const client = new MockLlmClient([
      JSON.stringify({
        scenes: [
          {
            order: 1,
            screenType: "텍스트 강조형",
            recommendedLayout: "중앙 텍스트",
            rationale: "정의 강조",
            caption: "짧은 요약 자막",
            imageOrDiagramDescription: "화면 설명",
            objectPlacement: "중앙",
            // keywords omitted
          },
        ],
      }),
    ]);

    await expect(selectScreenTypes(client, [scenes[0]])).rejects.toThrow();
  });

  it("propagates a rejection when one group's batch call fails, without corrupting other groups' results", async () => {
    const s = [title("t1", "1장", 1, 1), content("c1", "내용 A", 2), title("t2", "2장", 1, 3), content("c2", "내용 B", 4)];
    const client = new MockLlmClient(["이건 JSON이 아님", batchResponse([s[3]])]);
    const progressed: string[] = [];

    await expect(
      selectScreenTypes(client, s, {
        onProgress: (sceneId) => {
          progressed.push(sceneId);
        },
      })
    ).rejects.toThrow();

    // Both title scenes are always resolved locally regardless of the content groups' outcome.
    expect(progressed).toContain("t1");
    expect(progressed).toContain("t2");
  });

  it("retries a group call that throws (invalid JSON), and succeeds on retry", async () => {
    const client = new MockLlmClient(["이건 JSON이 아님", batchResponse(scenes)]);

    const result = await selectScreenTypes(client, scenes);

    expect(client.calls).toHaveLength(2);
    expect(Object.keys(result)).toEqual(["scene-001", "scene-002"]);
  });

  it("processes every pending group when there are more groups than the concurrency cap", async () => {
    const groupCount = 8; // > MAX_CONCURRENT_GROUPS (6)
    const s: Scene[] = [];
    for (let i = 0; i < groupCount; i++) {
      s.push(title(`t${i}`, `${i}장`, 1, i * 2 + 1));
      s.push(content(`c${i}`, `내용 ${i}`, i * 2 + 2));
    }
    const contentScenes = s.filter((scene) => scene.sceneType === "content");
    // A single shared response covering every group's order, reused for every
    // call (MockLlmClient repeats the last response once exhausted) — this
    // keeps the test independent of the exact worker dispatch order under
    // bounded concurrency, while still asserting every group's scene resolves.
    const client = new MockLlmClient([batchResponse(contentScenes)]);

    const result = await selectScreenTypes(client, s);

    for (const scene of contentScenes) {
      expect(result[scene.id]).toBeDefined();
    }
    expect(Object.keys(result)).toHaveLength(s.length);
  });

  it("reuses existingAssignments without calling the AI, and only for those scenes", async () => {
    const client = new MockLlmClient([batchResponse([scenes[1]], { 2: { screenType: "표/그래프형" } })]);
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
    const client = new MockLlmClient([batchResponse([scenes[1]], { 2: { screenType: "표/그래프형" } })]);
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

  it("includes related scenes' narration or resolved design as context when relatedSceneIds is set", async () => {
    const withRelation: Scene[] = [
      scenes[0],
      scenes[1],
      content("scene-003", "두 내용을 하나로 잇습니다.", 3, { relatedSceneIds: ["scene-001", "scene-002"] }),
    ];
    const client = new MockLlmClient([batchResponse(withRelation)]);

    await selectScreenTypes(client, withRelation);

    const prompt = client.calls[0].messages[1].content;
    expect(prompt).toContain("관련 씬");
    expect(prompt).toContain("scene-001");
    expect(prompt).toContain("scene-002");
  });

  it("keeps a well-formed layoutElements array from the AI response", async () => {
    const client = new MockLlmClient([
      batchResponse([scenes[0]], {
        1: {
          layoutElements: [
            { label: "인물", position: "left" },
            { label: "그래프", position: "right" },
          ],
        },
      }),
    ]);

    const result = await selectScreenTypes(client, [scenes[0]]);

    expect(result["scene-001"].layoutElements).toEqual([
      { label: "인물", position: "left" },
      { label: "그래프", position: "right" },
    ]);
  });

  it("drops malformed layoutElements instead of failing the whole response", async () => {
    const client = new MockLlmClient([
      batchResponse([scenes[0]], {
        1: {
          layoutElements: [
            { label: "인물", position: "not-a-real-position" },
            { label: "", position: "center" },
            { position: "left" },
          ],
        },
      }),
    ]);

    const result = await selectScreenTypes(client, [scenes[0]]);

    expect(result["scene-001"].layoutElements).toBeUndefined();
  });

  it("keeps a valid presenterPosition from the AI response", async () => {
    const client = new MockLlmClient([batchResponse([scenes[0]], { 1: { presenterPosition: "right" } })]);

    const result = await selectScreenTypes(client, [scenes[0]]);

    expect(result["scene-001"].presenterPosition).toBe("right");
  });

  it("keeps 'none' as a valid presenterPosition (AI judged the presenter doesn't fit this screen)", async () => {
    const client = new MockLlmClient([batchResponse([scenes[0]], { 1: { presenterPosition: "none" } })]);

    const result = await selectScreenTypes(client, [scenes[0]]);

    expect(result["scene-001"].presenterPosition).toBe("none");
  });

  it("drops an invalid presenterPosition value", async () => {
    const client = new MockLlmClient([batchResponse([scenes[0]], { 1: { presenterPosition: "somewhere" } })]);

    const result = await selectScreenTypes(client, [scenes[0]]);

    expect(result["scene-001"].presenterPosition).toBeUndefined();
  });

  it("clears presenterPosition for a transition/title screen type even if the AI returned one", async () => {
    const client = new MockLlmClient([
      batchResponse([scenes[0]], { 1: { screenType: "간지/타이틀형", presenterPosition: "center" } }),
    ]);

    const result = await selectScreenTypes(client, [scenes[0]]);

    expect(result["scene-001"].presenterPosition).toBeUndefined();
  });

  it("keeps a well-formed overlayPositions array from the AI response", async () => {
    const client = new MockLlmClient([batchResponse([scenes[0]], { 1: { overlayPositions: ["top-left", "bottom-right"] } })]);

    const result = await selectScreenTypes(client, [scenes[0]]);

    expect(result["scene-001"].overlayPositions).toEqual(["top-left", "bottom-right"]);
  });

  it("keeps index alignment by replacing an invalid overlayPositions entry with undefined instead of dropping it", async () => {
    const client = new MockLlmClient([
      batchResponse([scenes[0]], { 1: { overlayPositions: ["top-left", "not-a-real-position", "center"] } }),
    ]);

    const result = await selectScreenTypes(client, [scenes[0]]);

    expect(result["scene-001"].overlayPositions).toEqual(["top-left", undefined, "center"]);
  });

  it("omits overlayPositions entirely when the AI response has none", async () => {
    const client = new MockLlmClient([batchResponse([scenes[0]])]);

    const result = await selectScreenTypes(client, [scenes[0]]);

    expect(result["scene-001"].overlayPositions).toBeUndefined();
  });

  it("resolves related scenes from allScenesForContext when scenes is a subset (single-scene regenerate)", async () => {
    const fullScenes: Scene[] = [
      scenes[0],
      scenes[1],
      content("scene-003", "두 내용을 하나로 잇습니다.", 3, { relatedSceneIds: ["scene-001", "scene-002"] }),
    ];
    const client = new MockLlmClient([batchResponse([fullScenes[2]])]);

    await selectScreenTypes(client, [fullScenes[2]], { allScenesForContext: fullScenes });

    const prompt = client.calls[0].messages[1].content;
    expect(prompt).toContain("관련 씬");
    expect(prompt).toContain("정의를 설명합니다.");
  });

  describe("sequenceContextByScene (sequence mode)", () => {
    function makeSequenceContext(overrides: Partial<SceneSequenceContext> = {}): SceneSequenceContext {
      return {
        purpose: "탄소배출권 개념을 사무실 배경에서 소개",
        continuity: {
          location: "현대적 사무실",
          timeOfDay: "낮",
          visualStyle: "플랫 일러스트, 파스텔톤",
          fixedElements: ["주인공 캐릭터", "창가 화분"],
          doNotChange: ["캐릭터 의상 색상"],
        },
        masterVisualDescription: "파스텔톤 사무실에서 캐릭터가 창밖을 바라보는 마스터 비주얼",
        overlays: [],
        ...overrides,
      };
    }

    it("includes the sequence's purpose/continuity/master-visual and this scene's camera/overlay plan when context is provided", async () => {
      const client = new MockLlmClient([batchResponse([scenes[0]])]);
      const sequenceContext = makeSequenceContext({
        camera: { sceneId: "scene-001", shot: "wide", motion: "slow-push-in" },
        overlays: [{ sceneId: "scene-001", type: "chart", description: "배출권 가격 추이 그래프" }],
      });

      await selectScreenTypes(client, [scenes[0]], {
        sequenceContextByScene: { "scene-001": sequenceContext },
      });

      const prompt = client.calls[0].messages[1].content;
      expect(prompt).toContain("탄소배출권 개념을 사무실 배경에서 소개");
      expect(prompt).toContain("현대적 사무실");
      expect(prompt).toContain("플랫 일러스트, 파스텔톤");
      expect(prompt).toContain("주인공 캐릭터");
      expect(prompt).toContain("캐릭터 의상 색상");
      expect(prompt).toContain("파스텔톤 사무실에서 캐릭터가 창밖을 바라보는 마스터 비주얼");
      expect(prompt).toContain("wide");
      expect(prompt).toContain("slow-push-in");
      expect(prompt).toContain("배출권 가격 추이 그래프");
    });

    it("numbers the overlay list from 0 so the AI can address entries positionally in overlayPositions", async () => {
      const client = new MockLlmClient([batchResponse([scenes[0]])]);
      const sequenceContext = makeSequenceContext({
        overlays: [
          { sceneId: "scene-001", type: "label", description: "첫 오버레이" },
          { sceneId: "scene-001", type: "chart", description: "둘째 오버레이" },
        ],
      });

      await selectScreenTypes(client, [scenes[0]], {
        sequenceContextByScene: { "scene-001": sequenceContext },
      });

      const prompt = client.calls[0].messages[1].content;
      expect(prompt).toContain("0: (label) 첫 오버레이");
      expect(prompt).toContain("1: (chart) 둘째 오버레이");
      expect(prompt).toContain("overlayPositions");
    });

    it("does not append any sequence-context block when sequenceContextByScene is omitted (scene mode)", async () => {
      const client = new MockLlmClient([batchResponse(scenes)]);

      await selectScreenTypes(client, scenes);

      const prompt = client.calls[0].messages[1].content;
      expect(prompt).not.toContain("시퀀스 공유 맥락");
    });

    it("does not append a sequence-context block for a scene absent from sequenceContextByScene", async () => {
      const client = new MockLlmClient([batchResponse(scenes)]);

      await selectScreenTypes(client, scenes, {
        sequenceContextByScene: { "scene-002": makeSequenceContext() },
      });

      const prompt = client.calls[0].messages[1].content;
      // Only scene-002's block should appear; scene-001 gets none.
      const scene1Block = prompt.slice(prompt.indexOf("[order=1]"), prompt.indexOf("[order=2]"));
      expect(scene1Block).not.toContain("시퀀스 공유 맥락");
      expect(prompt).toContain("시퀀스 공유 맥락");
    });

    it("does not append a sequence-context block for a title scene even when scenes has other context entries", async () => {
      const withTitle = [title("scene-000", "1장 소개", 1, 0), ...scenes];
      const client = new MockLlmClient([batchResponse(scenes)]);

      const result = await selectScreenTypes(client, withTitle, {
        // Includes an entry keyed by the title scene's own id — title scenes
        // are never supposed to end up in sequenceContextByScene in
        // practice (see buildSequenceContextByScene), but this proves the
        // title code path ignores it even if one were present, rather than
        // merely never being asked to check (which the "scene-001"-only
        // version above would not distinguish).
        sequenceContextByScene: { "scene-000": makeSequenceContext(), "scene-001": makeSequenceContext() },
      });

      // Title scenes never hit the AI at all, so there's no prompt to check —
      // just confirm the fixed local title design is untouched by the option.
      expect(result["scene-000"]).toMatchObject({ screenType: "간지/타이틀형", caption: "1장 소개" });
      expect(client.calls[0].messages[1].content).toContain("시퀀스 공유 맥락");
    });

    it("omits the camera-plan bullet when the scene has no camera entry (overlays only)", async () => {
      const client = new MockLlmClient([batchResponse([scenes[0]])]);
      const sequenceContext = makeSequenceContext({
        overlays: [{ sceneId: "scene-001", type: "chart", description: "배출권 가격 추이 그래프" }],
      });

      await selectScreenTypes(client, [scenes[0]], {
        sequenceContextByScene: { "scene-001": sequenceContext },
      });

      const prompt = client.calls[0].messages[1].content;
      expect(prompt).not.toContain("카메라 계획");
      expect(prompt).toContain("배출권 가격 추이 그래프");
    });

    it("omits the camera-plan bullet when the scene has neither camera nor overlays", async () => {
      const client = new MockLlmClient([batchResponse([scenes[0]])]);
      const sequenceContext = makeSequenceContext();

      await selectScreenTypes(client, [scenes[0]], {
        sequenceContextByScene: { "scene-001": sequenceContext },
      });

      const prompt = client.calls[0].messages[1].content;
      expect(prompt).not.toContain("카메라 계획");
      expect(prompt).not.toContain("계획된 오버레이");
    });

    it("never emits the literal string 'undefined' in the sequence-context block when continuity has no timeOfDay", async () => {
      const client = new MockLlmClient([batchResponse([scenes[0]])]);
      const sequenceContext = makeSequenceContext({
        continuity: {
          location: "현대적 사무실",
          visualStyle: "플랫 일러스트, 파스텔톤",
          fixedElements: [],
          doNotChange: [],
        },
      });

      await selectScreenTypes(client, [scenes[0]], {
        sequenceContextByScene: { "scene-001": sequenceContext },
      });

      const prompt = client.calls[0].messages[1].content;
      const blockStart = prompt.indexOf("시퀀스 공유 맥락");
      expect(blockStart).toBeGreaterThanOrEqual(0);
      expect(prompt.slice(blockStart)).not.toContain("undefined");
    });
  });

  describe("sequencePlan (grouping by sequence)", () => {
    function makeSequence(overrides: Partial<Sequence> = {}): Sequence {
      return {
        id: "sequence-001",
        order: 1,
        title: "시퀀스 1",
        sceneIds: [],
        estimatedDurationSec: 10,
        purpose: "탄소배출권 개념을 사무실 배경에서 소개",
        continuity: {
          location: "현대적 사무실",
          visualStyle: "플랫 일러스트",
          fixedElements: [],
          doNotChange: [],
        },
        masterVisual: { description: "사무실 마스터 비주얼", status: "not-generated" },
        cameraPlan: [],
        overlays: [],
        ...overrides,
      };
    }

    it("groups scenes from different title sections into one call when they share a sequence", async () => {
      const s = [
        title("t1", "1장", 1, 1),
        content("c1", "내용 A", 2),
        title("t2", "2장", 1, 3),
        content("c2", "내용 B", 4),
      ];
      const plan: SequencePlan = { version: 1, sequences: [makeSequence({ sceneIds: ["c1", "c2"] })] };
      const client = new MockLlmClient([batchResponse([s[1], s[3]])]);

      await selectScreenTypes(client, s, { sequencePlan: plan });

      expect(client.calls).toHaveLength(1);
      const prompt = client.calls[0].messages[1].content;
      expect(prompt).toContain("내용 A");
      expect(prompt).toContain("내용 B");
    });

    it("orders scenes within a group by the sequence's sceneIds order, not the input scenes array order", async () => {
      const s = [content("c1", "내용 A", 1), content("c2", "내용 B", 2)];
      const plan: SequencePlan = { version: 1, sequences: [makeSequence({ sceneIds: ["c2", "c1"] })] };
      const client = new MockLlmClient([batchResponse([s[1], s[0]])]);

      await selectScreenTypes(client, s, { sequencePlan: plan });

      const prompt = client.calls[0].messages[1].content;
      expect(prompt.indexOf("내용 B")).toBeLessThan(prompt.indexOf("내용 A"));
    });

    it("splits a sequence larger than the max batch size into sub-batches", async () => {
      const contentScenes = Array.from({ length: 10 }, (_, i) => content(`c${i + 1}`, `내용 ${i + 1}`, i + 1));
      const plan: SequencePlan = {
        version: 1,
        sequences: [makeSequence({ sceneIds: contentScenes.map((s) => s.id) })],
      };
      const client = new MockLlmClient([batchResponse(contentScenes.slice(0, 8)), batchResponse(contentScenes.slice(8, 10))]);

      const result = await selectScreenTypes(client, contentScenes, { sequencePlan: plan });

      expect(client.calls).toHaveLength(2);
      expect(Object.keys(result)).toHaveLength(10);
    });

    it("hoists shared sequence context to appear once per group instead of once per scene", async () => {
      const s = [content("c1", "내용 A", 1), content("c2", "내용 B", 2)];
      const plan: SequencePlan = { version: 1, sequences: [makeSequence({ sceneIds: ["c1", "c2"] })] };
      const sharedContext: SceneSequenceContext = {
        purpose: "탄소배출권 개념을 사무실 배경에서 소개",
        continuity: { location: "현대적 사무실", visualStyle: "플랫 일러스트", fixedElements: [], doNotChange: [] },
        masterVisualDescription: "사무실 마스터 비주얼",
        overlays: [],
      };
      const client = new MockLlmClient([batchResponse(s)]);

      await selectScreenTypes(client, s, {
        sequencePlan: plan,
        sequenceContextByScene: { c1: sharedContext, c2: sharedContext },
      });

      const prompt = client.calls[0].messages[1].content;
      // "시퀀스 목적:" only appears in the header line of the shared block, so
      // this proves the block was hoisted once per group rather than emitted
      // once per scene (which would produce two occurrences here).
      const occurrences = prompt.split("시퀀스 목적:").length - 1;
      expect(occurrences).toBe(1);
    });

    it("falls back to title-based grouping when sequencePlan is not provided (scene mode unaffected)", async () => {
      const s = [
        title("t1", "1장", 1, 1),
        content("c1", "내용 A", 2),
        title("t2", "2장", 1, 3),
        content("c2", "내용 B", 4),
      ];
      const client = new MockLlmClient([batchResponse([s[1]]), batchResponse([s[3]])]);

      await selectScreenTypes(client, s);

      expect(client.calls).toHaveLength(2);
    });
  });
});
