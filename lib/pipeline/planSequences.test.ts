import { describe, it, expect } from "vitest";
import { MockLlmClient } from "../ai/llm/mockLlmClient";
import type { Scene } from "./splitScenes";
import { validateSequenceIntegrity } from "./validateSequenceIntegrity";
import {
  buildPlanSequencesMessages,
  parseRawSequences,
  parseSequencePlanResponse,
  planSequences,
  isValidRawSequenceShape,
  type RawSequence,
} from "./planSequences";

function scene(overrides: Partial<Scene> & { id: string; order: number }): Scene {
  return {
    narrationText: "내레이션 텍스트",
    estimatedDurationSec: 10,
    splitReason: "테스트용 분절",
    ...overrides,
  };
}

function titleScene(overrides: Partial<Scene> & { id: string; order: number }): Scene {
  return scene({ sceneType: "title", depth: 1, estimatedDurationSec: 0, ...overrides });
}

function fourContentScenes(): Scene[] {
  return [
    scene({ id: "scene-001", order: 1, narrationText: "교실에서 선생님이 인사합니다." }),
    scene({ id: "scene-002", order: 2, narrationText: "선생님이 칠판에 그림을 그립니다." }),
    scene({ id: "scene-003", order: 3, narrationText: "학생들이 질문합니다." }),
    scene({ id: "scene-004", order: 4, narrationText: "선생님이 답변합니다." }),
  ];
}

function rawSequence(overrides: Partial<RawSequence> = {}): RawSequence {
  return {
    order: 1,
    title: "교실 도입부",
    sceneIds: ["scene-001", "scene-002"],
    estimatedDurationSec: 20,
    purpose: "수업 도입을 안내한다",
    continuity: {
      location: "교실",
      visualStyle: "플랫 일러스트",
      fixedElements: ["칠판", "선생님"],
      doNotChange: ["선생님 복장"],
    },
    masterVisual: {
      description: "넓은 교실 전경, 칠판과 책상이 보이는 구도",
    },
    cameraPlan: [
      { sceneId: "scene-001", shot: "wide", motion: "static" },
      { sceneId: "scene-002", shot: "medium", motion: "slow-push-in" },
    ],
    overlays: [],
    ...overrides,
  };
}

function goodTwoSequenceResponse(): string {
  return JSON.stringify({
    sequences: [
      rawSequence(),
      rawSequence({
        order: 2,
        title: "질의응답",
        sceneIds: ["scene-003", "scene-004"],
        continuity: {
          location: "교실",
          visualStyle: "플랫 일러스트",
          fixedElements: ["칠판", "선생님"],
          doNotChange: ["선생님 복장"],
        },
        cameraPlan: [
          { sceneId: "scene-003", shot: "close-up", motion: "static" },
          { sceneId: "scene-004", shot: "medium", motion: "pan-left" },
        ],
      }),
    ],
  });
}

describe("buildPlanSequencesMessages", () => {
  it("includes the content scene count, ids, and key grouping/duration instructions", () => {
    const scenes = fourContentScenes();
    const messages = buildPlanSequencesMessages(scenes);
    const userContent = messages.find((m) => m.role === "user")!.content;

    expect(userContent).toContain("4개");
    for (const s of scenes) {
      expect(userContent).toContain(s.id);
    }
    expect(userContent).toContain("2~6");
    expect(userContent).toContain("20~40");
    expect(userContent).toContain("나레이션");
    expect(userContent).toContain("절대 변경하지");
  });

  it("never mentions title scenes in the scene listing", () => {
    const scenes = [titleScene({ id: "scene-000", order: 0, narrationText: "1장. 소개" }), ...fourContentScenes()];
    const messages = buildPlanSequencesMessages(scenes);
    const userContent = messages.find((m) => m.role === "user")!.content;

    expect(userContent).not.toContain("scene-000");
  });

  it("instructs the model not to bake text/charts into the master visual", () => {
    const messages = buildPlanSequencesMessages(fourContentScenes());
    const userContent = messages.find((m) => m.role === "user")!.content;
    expect(userContent).toContain("텍스트나 데이터 시각화도 절대 포함하지");
  });
});

describe("parseRawSequences", () => {
  it("throws a plain Error on non-JSON input", () => {
    expect(() => parseRawSequences("이건 JSON이 아닙니다")).toThrow();
  });

  it("throws when the sequences field is missing", () => {
    expect(() => parseRawSequences(JSON.stringify({ foo: "bar" }))).toThrow(/sequences 배열/);
  });

  it("throws when sequences is not an array", () => {
    expect(() => parseRawSequences(JSON.stringify({ sequences: "nope" }))).toThrow();
  });

  it("parses a well-formed envelope", () => {
    const result = parseRawSequences(goodTwoSequenceResponse());
    expect(result).toHaveLength(2);
  });

  it("recovers when sequences is double-encoded as a JSON string of the array itself", () => {
    const inner = JSON.parse(goodTwoSequenceResponse()).sequences;
    const raw = JSON.stringify({ sequences: JSON.stringify(inner) });
    const result = parseRawSequences(raw);
    expect(result).toHaveLength(2);
  });

  it("recovers when sequences is double-encoded as a JSON string of another {sequences:[...]} envelope", () => {
    const raw = JSON.stringify({ sequences: goodTwoSequenceResponse() });
    const result = parseRawSequences(raw);
    expect(result).toHaveLength(2);
  });

  it("still throws when the double-encoded string doesn't contain a sequences array", () => {
    const raw = JSON.stringify({ sequences: JSON.stringify({ foo: "bar" }) });
    expect(() => parseRawSequences(raw)).toThrow(/sequences 배열/);
  });
});

describe("isValidRawSequenceShape", () => {
  it("accepts a fully-formed raw sequence", () => {
    expect(isValidRawSequenceShape(rawSequence())).toBe(true);
  });

  it("rejects a sequence missing purpose", () => {
    const withoutPurpose: Partial<RawSequence> = { ...rawSequence() };
    delete withoutPurpose.purpose;
    expect(isValidRawSequenceShape(withoutPurpose as RawSequence)).toBe(false);
  });

  it("rejects a sequence with an empty sceneIds array", () => {
    expect(isValidRawSequenceShape(rawSequence({ sceneIds: [] }))).toBe(false);
  });

  it("rejects a sequence missing continuity.location", () => {
    expect(
      isValidRawSequenceShape(
        rawSequence({ continuity: { visualStyle: "플랫 일러스트", fixedElements: [], doNotChange: [] } })
      )
    ).toBe(false);
  });

  it("rejects a sequence missing masterVisual.description", () => {
    expect(isValidRawSequenceShape(rawSequence({ masterVisual: {} }))).toBe(false);
  });
});

describe("parseSequencePlanResponse", () => {
  it("produces a valid SequencePlan with locally-assigned ids and order", () => {
    const plan = parseSequencePlanResponse(goodTwoSequenceResponse());

    expect(plan.version).toBe(1);
    expect(plan.sequences).toHaveLength(2);
    expect(plan.sequences[0].id).toBe("sequence-001");
    expect(plan.sequences[0].order).toBe(1);
    expect(plan.sequences[1].id).toBe("sequence-002");
    expect(plan.sequences[1].order).toBe(2);
  });

  it("sets masterVisual.status to not-generated and copies the description", () => {
    const plan = parseSequencePlanResponse(goodTwoSequenceResponse());
    expect(plan.sequences[0].masterVisual.status).toBe("not-generated");
    expect(plan.sequences[0].masterVisual.description).toContain("교실");
  });

  it("does not set needsReview when every scene has a camera plan entry", () => {
    const plan = parseSequencePlanResponse(goodTwoSequenceResponse());
    expect(plan.sequences[0].needsReview).toBeUndefined();
  });

  it("sets needsReview when a scene in sceneIds has no camera plan entry", () => {
    const raw = JSON.stringify({
      sequences: [rawSequence({ sceneIds: ["scene-001", "scene-002"], cameraPlan: [{ sceneId: "scene-001", shot: "wide", motion: "static" }] })],
    });
    const plan = parseSequencePlanResponse(raw);
    expect(plan.sequences[0].needsReview).toBe(true);
  });

  it("sets needsReview and drops the value when continuity.fixedElements or doNotChange is malformed", () => {
    const raw = JSON.stringify({
      sequences: [
        rawSequence({
          continuity: {
            location: "교실",
            visualStyle: "플랫 일러스트",
            fixedElements: "칠판", // should be an array, not a string
            doNotChange: ["선생님 복장", 123], // non-string item
          },
        }),
      ],
    });
    const plan = parseSequencePlanResponse(raw);

    expect(plan.sequences[0].needsReview).toBe(true);
    expect(plan.sequences[0].continuity.fixedElements).toEqual([]);
    expect(plan.sequences[0].continuity.doNotChange).toEqual([]);
  });

  it("drops individual camera-plan entries with an unrecognized shot/motion instead of failing the whole sequence", () => {
    const raw = JSON.stringify({
      sequences: [
        rawSequence({
          cameraPlan: [
            { sceneId: "scene-001", shot: "wide", motion: "static" },
            { sceneId: "scene-002", shot: "ultra-wide", motion: "static" }, // invalid shot
          ],
        }),
      ],
    });
    const plan = parseSequencePlanResponse(raw);
    expect(plan.sequences[0].cameraPlan).toHaveLength(1);
    expect(plan.sequences[0].cameraPlan[0].sceneId).toBe("scene-001");
  });

  it("drops individual overlay entries with an unrecognized type", () => {
    const raw = JSON.stringify({
      sequences: [
        rawSequence({
          overlays: [
            { sceneId: "scene-001", type: "label", description: "제목 라벨" },
            { sceneId: "scene-002", type: "video-clip", description: "잘못된 타입" }, // invalid type
          ],
        }),
      ],
    });
    const plan = parseSequencePlanResponse(raw);
    expect(plan.sequences[0].overlays).toHaveLength(1);
    expect(plan.sequences[0].overlays[0].type).toBe("label");
  });

  it("keeps valid structured educational overlay content while preserving the legacy description", () => {
    const raw = JSON.stringify({
      sequences: [
        rawSequence({
          overlays: [
            {
              sceneId: "scene-001",
              type: "chart",
              description: "분기별 학습 완료율 비교",
              content: { kind: "chart", chartType: "bar", labels: ["1분기", "2분기"], values: [32, 58], unit: "%" },
            },
          ],
        }),
      ],
    });
    const plan = parseSequencePlanResponse(raw);
    expect(plan.sequences[0].overlays[0].content).toEqual({
      kind: "chart", chartType: "bar", labels: ["1분기", "2분기"], values: [32, 58], unit: "%",
    });
    expect(plan.sequences[0].overlays[0].description).toBe("분기별 학습 완료율 비교");
  });

  it("keeps a legacy overlay when its optional structured payload is malformed", () => {
    const raw = JSON.stringify({
      sequences: [
        rawSequence({
          overlays: [{ sceneId: "scene-001", type: "chart", description: "기존 차트", content: { kind: "chart", labels: ["A"], values: [1] } }],
        }),
      ],
    });
    const plan = parseSequencePlanResponse(raw);
    expect(plan.sequences[0].overlays).toEqual([{ sceneId: "scene-001", type: "chart", description: "기존 차트" }]);
  });

  it("drops an individual malformed sequence entry (missing required fields) while keeping the valid ones", () => {
    const raw = JSON.stringify({
      sequences: [rawSequence(), { title: "부실한 항목" }],
    });
    const plan = parseSequencePlanResponse(raw);
    expect(plan.sequences).toHaveLength(1);
    expect(plan.sequences[0].title).toBe("교실 도입부");
  });

  it("throws when every entry is malformed", () => {
    const raw = JSON.stringify({ sequences: [{ title: "부실한 항목" }, { foo: "bar" }] });
    expect(() => parseSequencePlanResponse(raw)).toThrow(/유효한 시퀀스가 하나도 없습니다/);
  });

  it("returns an empty plan (no throw) when sequences is an empty array", () => {
    const plan = parseSequencePlanResponse(JSON.stringify({ sequences: [] }));
    expect(plan).toEqual({ version: 1, sequences: [] });
  });
});

describe("planSequences", () => {
  it("resolves to a valid, fully-passing SequencePlan for a well-formed mock response", async () => {
    const client = new MockLlmClient([goodTwoSequenceResponse()]);
    const scenes = fourContentScenes();

    const plan = await planSequences(client, scenes);

    expect(plan.sequences).toHaveLength(2);
    expect(validateSequenceIntegrity(scenes, plan)).toEqual([]);
  });

  it("calls the client in JSON mode with the accurate tier", async () => {
    const client = new MockLlmClient([goodTwoSequenceResponse()]);
    await planSequences(client, fourContentScenes());

    expect(client.calls).toHaveLength(1);
    expect(client.calls[0].options?.jsonMode).toBe(true);
    expect(client.calls[0].options?.tier).toBe("accurate");
  });

  it("forces tool-use JSON via jsonSchema (root-cause fix for malformed-JSON batch failures)", async () => {
    const client = new MockLlmClient([goodTwoSequenceResponse()]);
    await planSequences(client, fourContentScenes());

    expect(client.calls[0].options?.jsonSchema?.name).toBe("emit_sequence_plan");
    expect(client.calls[0].options?.jsonSchema?.schema).toBeTruthy();
  });

  it("rejects when the AI response is not valid JSON", async () => {
    const client = new MockLlmClient(["이건 JSON이 아닙니다"]);
    await expect(planSequences(client, fourContentScenes())).rejects.toThrow();
  });

  it("resolves (does not throw) when the model hallucinates an unknown scene id — the integrity gap surfaces via validateSequenceIntegrity instead", async () => {
    const badResponse = JSON.stringify({
      sequences: [
        rawSequence({ sceneIds: ["scene-001", "scene-002"] }),
        rawSequence({
          order: 2,
          title: "질의응답",
          sceneIds: ["scene-003", "scene-999"], // scene-999 does not exist; scene-004 is omitted
          cameraPlan: [
            { sceneId: "scene-003", shot: "close-up", motion: "static" },
            { sceneId: "scene-999", shot: "medium", motion: "static" },
          ],
        }),
      ],
    });
    const client = new MockLlmClient([badResponse]);
    const scenes = fourContentScenes();

    const plan = await planSequences(client, scenes);
    const issues = validateSequenceIntegrity(scenes, plan);

    expect(issues.some((i) => i.type === "unknown-scene-reference")).toBe(true);
    expect(issues.some((i) => i.type === "missing-scene-reference")).toBe(true);
  });

  it("resolves (does not throw) when the model includes a title scene in sceneIds — rejected by validateSequenceIntegrity's title policy", async () => {
    const scenes = [titleScene({ id: "scene-000", order: 0, narrationText: "1장. 소개" }), ...fourContentScenes()];
    const badResponse = JSON.stringify({
      sequences: [
        rawSequence({ sceneIds: ["scene-000", "scene-001", "scene-002"] }),
        rawSequence({ order: 2, title: "질의응답", sceneIds: ["scene-003", "scene-004"] }),
      ],
    });
    const client = new MockLlmClient([badResponse]);

    const plan = await planSequences(client, scenes);
    const issues = validateSequenceIntegrity(scenes, plan);

    expect(issues.some((i) => i.type === "title-scene-included")).toBe(true);
  });

  it("propagates AbortSignal through to the client call", async () => {
    const controller = new AbortController();
    controller.abort();
    const client = new MockLlmClient([goodTwoSequenceResponse()]);

    await expect(planSequences(client, fourContentScenes(), { signal: controller.signal })).rejects.toThrow();
  });
});
