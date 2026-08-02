import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { buildDefaultPptxTemplate, buildNotebookLmPptxTemplate } from "./defaultTemplate";
import { buildScenePptx } from "./exportPptx";

describe.each([
  ["buildDefaultPptxTemplate", buildDefaultPptxTemplate],
  ["buildNotebookLmPptxTemplate", buildNotebookLmPptxTemplate],
] as const)("%s", (_name, buildTemplate) => {
  it("produces a zip with every required OOXML part", async () => {
    const bytes = await buildTemplate();
    const zip = await JSZip.loadAsync(bytes);

    for (const path of [
      "[Content_Types].xml",
      "_rels/.rels",
      "ppt/presentation.xml",
      "ppt/_rels/presentation.xml.rels",
      "ppt/slideMasters/slideMaster1.xml",
      "ppt/slideMasters/_rels/slideMaster1.xml.rels",
      "ppt/slideLayouts/slideLayout1.xml",
      "ppt/slideLayouts/_rels/slideLayout1.xml.rels",
      "ppt/slides/slide1.xml",
      "ppt/slides/_rels/slide1.xml.rels",
      "ppt/theme/theme1.xml",
    ]) {
      expect(zip.file(path), `missing ${path}`).not.toBeNull();
    }
  });

  it("includes every placeholder the storyboard pptx export route fills in", async () => {
    const bytes = await buildTemplate();
    const zip = await JSZip.loadAsync(bytes);
    const slideXml = await zip.file("ppt/slides/slide1.xml")!.async("string");

    for (const key of ["과정명", "번호", "나레이션", "자막", "화면유형", "설명", "배치", "키워드", "길이"]) {
      expect(slideXml).toContain(`{{${key}}}`);
    }
  });

  it("works as a real upload template: buildScenePptx can duplicate and fill it", async () => {
    const bytes = await buildTemplate();
    const output = await buildScenePptx(bytes, [
      { 과정명: "테스트 과정", 번호: "1", 나레이션: "첫 씬 나레이션", 자막: "자막1" },
      { 과정명: "테스트 과정", 번호: "2", 나레이션: "둘째 씬 나레이션", 자막: "자막2" },
    ]);

    const outZip = await JSZip.loadAsync(output);
    const slideFiles = Object.keys(outZip.files).filter((n) => /ppt\/slides\/slide\d+\.xml$/.test(n));
    expect(slideFiles).toHaveLength(2);

    const slide1 = await outZip.file("ppt/slides/slide1.xml")!.async("string");
    expect(slide1).toContain("첫 씬 나레이션");
    expect(slide1).not.toContain("{{나레이션}}");
  });
});

describe("buildDefaultPptxTemplate vs buildNotebookLmPptxTemplate", () => {
  it("use visibly different accent colors", async () => {
    const [defaultZip, notebookLmZip] = await Promise.all([
      buildDefaultPptxTemplate().then((b) => JSZip.loadAsync(b)),
      buildNotebookLmPptxTemplate().then((b) => JSZip.loadAsync(b)),
    ]);
    const defaultTheme = await defaultZip.file("ppt/theme/theme1.xml")!.async("string");
    const notebookLmTheme = await notebookLmZip.file("ppt/theme/theme1.xml")!.async("string");

    expect(defaultTheme).toContain("5645D4");
    expect(notebookLmTheme).toContain("D97706");
    expect(defaultTheme).not.toEqual(notebookLmTheme);
  });
});
