import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "fs";
import path from "path";
import os from "os";
import {
  createProject,
  listProjects,
  readProject,
  updateProjectStep,
  deleteProject,
  writeProjectFile,
  readProjectFile,
  mergeProjectJsonMap,
  writeProjectImage,
  readProjectImage,
  listProjectImageIds,
  readSequencePlan,
  writeSequencePlan,
  writeSequenceMasterImage,
  readSequenceMasterImage,
  listSequenceMasterImageIds,
  projectSequenceMasterImagePath,
} from "./store";
import { getProductionMode, type ProductionMode } from "./types";
import type { SequencePlan } from "../pipeline/sequenceTypes";

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "projects-store-"));
  process.env.PROJECTS_DATA_DIR = tempRoot;
});

afterEach(async () => {
  delete process.env.PROJECTS_DATA_DIR;
  await fs.rm(tempRoot, { recursive: true, force: true });
});

describe("project store", () => {
  it("creates a project with upload as the initial step", async () => {
    const project = await createProject("샘플 원고", "script");

    expect(project.title).toBe("샘플 원고");
    expect(project.scriptType).toBe("script");
    expect(project.currentStep).toBe("upload");
    expect(project.id).toBeTruthy();
  });

  it("lists created projects newest first", async () => {
    const first = await createProject("첫번째", "script");
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = await createProject("두번째", "narration");

    const projects = await listProjects();

    expect(projects.map((p) => p.id)).toEqual([second.id, first.id]);
  });

  it("reads back a created project", async () => {
    const project = await createProject("조회 테스트", "script");

    const found = await readProject(project.id);

    expect(found).toEqual(project);
  });

  it("returns null for a missing project", async () => {
    const found = await readProject("does-not-exist");
    expect(found).toBeNull();
  });

  it("updates the current step", async () => {
    const project = await createProject("단계 업데이트", "script");

    await updateProjectStep(project.id, "scenes");
    const updated = await readProject(project.id);

    expect(updated?.currentStep).toBe("scenes");
  });

  it("writes and reads a project file", async () => {
    const project = await createProject("파일 테스트", "script");

    await writeProjectFile(project.id, "narration.md", "# 제목\n내용");
    const content = await readProjectFile(project.id, "narration.md");

    expect(content).toBe("# 제목\n내용");
  });

  it("returns null when reading a missing project file", async () => {
    const project = await createProject("빈 파일", "script");
    const content = await readProjectFile(project.id, "scenes.json");
    expect(content).toBeNull();
  });

  it("deletes a project folder", async () => {
    const project = await createProject("삭제 테스트", "script");

    await deleteProject(project.id);
    const found = await readProject(project.id);

    expect(found).toBeNull();
  });

  it("rejects path-traversal attempts in project id", async () => {
    const found = await readProject("../../../../etc/passwd");
    expect(found).toBeNull();
  });

  it("rejects path-traversal attempts in filename", async () => {
    const project = await createProject("경로 검증", "script");
    await expect(writeProjectFile(project.id, "../../evil.txt", "bad")).rejects.toThrow();
  });
});

describe("project production mode", () => {
  it("defaults new projects to scene mode", async () => {
    const project = await createProject("기본 모드", "script");

    expect(project.productionMode).toBe("scene");
    expect(getProductionMode(project)).toBe("scene");
  });

  it("creates a project explicitly in sequence mode", async () => {
    const project = await createProject("시퀀스 모드", "script", "sequence");

    expect(project.productionMode).toBe("sequence");
    expect(getProductionMode(project)).toBe("sequence");

    const found = await readProject(project.id);
    expect(found?.productionMode).toBe("sequence");
  });

  it("treats legacy project.json without productionMode as scene mode", async () => {
    const project = await createProject("레거시 프로젝트", "script");
    const legacyMeta = { ...project };
    delete (legacyMeta as { productionMode?: string }).productionMode;
    await writeProjectFile(project.id, "project.json", JSON.stringify(legacyMeta, null, 2));

    const found = await readProject(project.id);

    expect(found?.productionMode).toBeUndefined();
    expect(getProductionMode(found!)).toBe("scene");
  });

  it("rejects an invalid production mode", async () => {
    await expect(
      createProject("잘못된 모드", "script", "invalid" as unknown as ProductionMode)
    ).rejects.toThrow();
  });
});

describe("project images", () => {
  it("writes and reads back a scene image", async () => {
    const project = await createProject("이미지 테스트", "script");
    const buffer = Buffer.from([1, 2, 3, 4]);

    await writeProjectImage(project.id, "scene-001", buffer);
    const read = await readProjectImage(project.id, "scene-001");

    expect(read).toEqual(buffer);
  });

  it("returns null for a scene with no image yet", async () => {
    const project = await createProject("이미지 없음", "script");
    const read = await readProjectImage(project.id, "scene-001");
    expect(read).toBeNull();
  });

  it("lists only scene ids that have a saved image", async () => {
    const project = await createProject("이미지 목록", "script");
    await writeProjectImage(project.id, "scene-001", Buffer.from([1]));
    await writeProjectImage(project.id, "scene-002", Buffer.from([2]));

    const ids = await listProjectImageIds(project.id);

    expect(ids.sort()).toEqual(["scene-001", "scene-002"]);
  });

  it("returns an empty list when the images directory doesn't exist yet", async () => {
    const project = await createProject("이미지 빈 목록", "script");
    expect(await listProjectImageIds(project.id)).toEqual([]);
  });

  it("rejects an unsafe scene id", async () => {
    const project = await createProject("이미지 경로 검증", "script");
    await expect(writeProjectImage(project.id, "../evil", Buffer.from([1]))).rejects.toThrow();
  });
});

describe("mergeProjectJsonMap", () => {
  it("creates the file with the merged entry when it doesn't exist yet", async () => {
    const project = await createProject("병합 생성", "script");

    await mergeProjectJsonMap(project.id, "screen-types.json", "screenTypes", "scene-001", { screenType: "A" });
    const content = await readProjectFile(project.id, "screen-types.json");

    expect(JSON.parse(content!)).toEqual({ screenTypes: { "scene-001": { screenType: "A" } } });
  });

  it("preserves sibling entries already in the map", async () => {
    const project = await createProject("병합 보존", "script");
    await mergeProjectJsonMap(project.id, "screen-types.json", "screenTypes", "scene-001", { screenType: "A" });

    await mergeProjectJsonMap(project.id, "screen-types.json", "screenTypes", "scene-002", { screenType: "B" });
    const content = await readProjectFile(project.id, "screen-types.json");

    expect(JSON.parse(content!)).toEqual({
      screenTypes: { "scene-001": { screenType: "A" }, "scene-002": { screenType: "B" } },
    });
  });

  it("overwrites the same entry key in place", async () => {
    const project = await createProject("병합 갱신", "script");
    await mergeProjectJsonMap(project.id, "screen-types.json", "screenTypes", "scene-001", { screenType: "A" });

    await mergeProjectJsonMap(project.id, "screen-types.json", "screenTypes", "scene-001", { screenType: "C" });
    const content = await readProjectFile(project.id, "screen-types.json");

    expect(JSON.parse(content!)).toEqual({ screenTypes: { "scene-001": { screenType: "C" } } });
  });

  it("preserves other top-level keys already in the file", async () => {
    const project = await createProject("최상위 보존", "script");
    await writeProjectFile(project.id, "screen-types.json", JSON.stringify({ note: "keep me" }));

    await mergeProjectJsonMap(project.id, "screen-types.json", "screenTypes", "scene-001", { screenType: "A" });
    const content = await readProjectFile(project.id, "screen-types.json");

    expect(JSON.parse(content!)).toEqual({ note: "keep me", screenTypes: { "scene-001": { screenType: "A" } } });
  });

  it("rejects path-traversal attempts in filename", async () => {
    const project = await createProject("병합 경로 검증", "script");
    await expect(
      mergeProjectJsonMap(project.id, "../../evil.json", "screenTypes", "scene-001", {})
    ).rejects.toThrow();
  });
});

function samplePlan(): SequencePlan {
  return {
    version: 1,
    sequences: [
      {
        id: "sequence-001",
        order: 1,
        title: "도입부",
        sceneIds: ["scene-001", "scene-002"],
        estimatedDurationSec: 20,
        purpose: "테스트 목적",
        continuity: { location: "교실", visualStyle: "플랫 일러스트", fixedElements: [], doNotChange: [] },
        masterVisual: { description: "마스터 비주얼", status: "not-generated" },
        cameraPlan: [],
        overlays: [],
      },
    ],
  };
}

describe("sequence plan storage", () => {
  it("returns null when no sequence plan has been written yet", async () => {
    const project = await createProject("시퀀스 없음", "script", "sequence");
    expect(await readSequencePlan(project.id)).toBeNull();
  });

  it("writes and reads back a sequence plan", async () => {
    const project = await createProject("시퀀스 저장", "script", "sequence");
    const plan = samplePlan();

    await writeSequencePlan(project.id, plan);
    const read = await readSequencePlan(project.id);

    expect(read).toEqual(plan);
  });

  it("returns null for a malformed sequences.json instead of throwing", async () => {
    const project = await createProject("시퀀스 손상", "script", "sequence");
    await writeProjectFile(project.id, "sequences.json", "{not valid json");

    await expect(readSequencePlan(project.id)).resolves.toBeNull();
  });
});

describe("sequence master image storage", () => {
  it("writes and reads back a sequence master image", async () => {
    const project = await createProject("마스터 이미지", "script", "sequence");
    const buffer = Buffer.from([9, 9, 9]);

    await writeSequenceMasterImage(project.id, "sequence-001", "asset-001", buffer);
    const read = await readSequenceMasterImage(project.id, "sequence-001", "asset-001");

    expect(read).toEqual(buffer);
  });

  it("returns null for a sequence with no master image yet", async () => {
    const project = await createProject("마스터 이미지 없음", "script", "sequence");
    expect(await readSequenceMasterImage(project.id, "sequence-001", "asset-001")).toBeNull();
  });

  it("lists only asset ids that have a saved master image for that sequence", async () => {
    const project = await createProject("마스터 이미지 목록", "script", "sequence");
    await writeSequenceMasterImage(project.id, "sequence-001", "asset-001", Buffer.from([1]));
    await writeSequenceMasterImage(project.id, "sequence-001", "asset-002", Buffer.from([2]));
    await writeSequenceMasterImage(project.id, "sequence-002", "asset-001", Buffer.from([3]));

    const ids = await listSequenceMasterImageIds(project.id, "sequence-001");

    expect(ids.sort()).toEqual(["asset-001", "asset-002"]);
  });

  it("returns an empty list when the sequence has no asset directory yet", async () => {
    const project = await createProject("마스터 이미지 빈 목록", "script", "sequence");
    expect(await listSequenceMasterImageIds(project.id, "sequence-001")).toEqual([]);
  });

  it("rejects an unsafe sequence id", async () => {
    const project = await createProject("시퀀스 경로 검증", "script", "sequence");
    await expect(writeSequenceMasterImage(project.id, "../evil", "asset-001", Buffer.from([1]))).rejects.toThrow();
  });

  it("rejects an unsafe asset id", async () => {
    const project = await createProject("에셋 경로 검증", "script", "sequence");
    await expect(
      writeSequenceMasterImage(project.id, "sequence-001", "../evil", Buffer.from([1]))
    ).rejects.toThrow();
  });

  it("builds the same file path that writeSequenceMasterImage/readSequenceMasterImage use internally", async () => {
    const project = await createProject("마스터 이미지 경로", "script", "sequence");
    const buffer = Buffer.from([7, 7]);
    await writeSequenceMasterImage(project.id, "sequence-001", "asset-001", buffer);

    const filePath = projectSequenceMasterImagePath(project.id, "sequence-001", "asset-001");
    const { promises: fs } = await import("fs");

    await expect(fs.readFile(filePath)).resolves.toEqual(buffer);
  });

  it("rejects an unsafe asset id when building the path", async () => {
    const project = await createProject("마스터 이미지 경로 검증", "script", "sequence");
    expect(() => projectSequenceMasterImagePath(project.id, "sequence-001", "../evil")).toThrow();
  });
});
