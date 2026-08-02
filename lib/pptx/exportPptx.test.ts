import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { buildScenePptx } from "./exportPptx";

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
<Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
</Types>`;

const PRESENTATION_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<p:sldIdLst><p:sldId id="256" r:id="rId2"/></p:sldIdLst>
</p:presentation>`;

const PRESENTATION_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
</Relationships>`;

const SLIDE_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
<p:cSld><p:spTree>
<p:sp><p:txBody><a:p><a:r><a:t>{{과정명}}</a:t></a:r></a:p><a:p><a:r><a:t>{{나레이션}}</a:t></a:r></a:p></p:txBody></p:sp>
</p:spTree></p:cSld>
</p:sld>`;

const SLIDE_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
</Relationships>`;

async function buildTemplateBytes(): Promise<Buffer> {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", CONTENT_TYPES);
  zip.file("ppt/presentation.xml", PRESENTATION_XML);
  zip.file("ppt/_rels/presentation.xml.rels", PRESENTATION_RELS);
  zip.file("ppt/slides/slide1.xml", SLIDE_XML);
  zip.file("ppt/slides/_rels/slide1.xml.rels", SLIDE_RELS);
  return zip.generateAsync({ type: "nodebuffer" });
}

describe("buildScenePptx", () => {
  it("duplicates the template slide once per scene and fills in placeholders", async () => {
    const template = await buildTemplateBytes();

    const output = await buildScenePptx(template, [
      { 과정명: "테스트 과정", 나레이션: "첫 번째 나레이션" },
      { 과정명: "테스트 과정", 나레이션: "두 번째 나레이션" },
      { 과정명: "테스트 과정", 나레이션: "세 번째 나레이션" },
    ]);

    const outZip = await JSZip.loadAsync(output);
    const slideFiles = Object.keys(outZip.files).filter((n) => /ppt\/slides\/slide\d+\.xml$/.test(n));
    expect(slideFiles).toHaveLength(3);

    const slide1 = await outZip.file("ppt/slides/slide1.xml")!.async("string");
    expect(slide1).toContain("첫 번째 나레이션");
    expect(slide1).not.toContain("{{나레이션}}");

    const slideRelsFiles = Object.keys(outZip.files).filter((n) => /ppt\/slides\/_rels\/slide\d+\.xml\.rels$/.test(n));
    expect(slideRelsFiles).toHaveLength(3);

    const presentationXml = await outZip.file("ppt/presentation.xml")!.async("string");
    expect([...presentationXml.matchAll(/<p:sldId\b/g)]).toHaveLength(3);

    const presentationRels = await outZip.file("ppt/_rels/presentation.xml.rels")!.async("string");
    expect([...presentationRels.matchAll(/Type="[^"]*\/slide"/g)]).toHaveLength(3);

    const contentTypes = await outZip.file("[Content_Types].xml")!.async("string");
    expect([...contentTypes.matchAll(/Override PartName="\/ppt\/slides\/slide\d+\.xml"/g)]).toHaveLength(3);
  });

  it("leaves unrecognized or missing placeholders untouched instead of deleting them", async () => {
    const template = await buildTemplateBytes();
    const output = await buildScenePptx(template, [{ 과정명: "테스트 과정" }]);
    const outZip = await JSZip.loadAsync(output);
    const slide1 = await outZip.file("ppt/slides/slide1.xml")!.async("string");

    expect(slide1).toContain("테스트 과정");
    expect(slide1).toContain("{{나레이션}}");
  });

  it("XML-escapes substituted values", async () => {
    const template = await buildTemplateBytes();
    const output = await buildScenePptx(template, [{ 과정명: "A & B <상> \"인용\"", 나레이션: "본문" }]);
    const outZip = await JSZip.loadAsync(output);
    const slide1 = await outZip.file("ppt/slides/slide1.xml")!.async("string");

    expect(slide1).toContain("A &amp; B &lt;상&gt; &quot;인용&quot;");
  });

  it("fills in a placeholder even when PowerPoint split it across multiple text runs", async () => {
    const zip = new JSZip();
    zip.file("[Content_Types].xml", CONTENT_TYPES);
    zip.file("ppt/presentation.xml", PRESENTATION_XML);
    zip.file("ppt/_rels/presentation.xml.rels", PRESENTATION_RELS);
    zip.file(
      "ppt/slides/slide1.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
<p:cSld><p:spTree>
<p:sp><p:txBody><a:p><a:r><a:rPr b="1"/><a:t>{{</a:t></a:r><a:r><a:t>나레이션</a:t></a:r><a:r><a:t>}}</a:t></a:r></a:p></p:txBody></p:sp>
</p:spTree></p:cSld>
</p:sld>`
    );
    zip.file("ppt/slides/_rels/slide1.xml.rels", SLIDE_RELS);
    const template = await zip.generateAsync({ type: "nodebuffer" });

    const output = await buildScenePptx(template, [{ 나레이션: "실제 나레이션 값" }]);
    const outZip = await JSZip.loadAsync(output);
    const slide1 = await outZip.file("ppt/slides/slide1.xml")!.async("string");

    expect(slide1).toContain("실제 나레이션 값");
    expect(slide1).not.toContain("{{");
    expect(slide1).not.toContain("}}");
  });

  it("throws for a pptx with no slides", async () => {
    const zip = new JSZip();
    zip.file("[Content_Types].xml", CONTENT_TYPES);
    zip.file("ppt/presentation.xml", `<p:presentation xmlns:p="x"><p:sldIdLst/></p:presentation>`);
    zip.file("ppt/_rels/presentation.xml.rels", PRESENTATION_RELS);
    const bytes = await zip.generateAsync({ type: "nodebuffer" });

    await expect(buildScenePptx(bytes, [{ 과정명: "x" }])).rejects.toThrow();
  });

  it("throws when given no slide data", async () => {
    const template = await buildTemplateBytes();
    await expect(buildScenePptx(template, [])).rejects.toThrow();
  });
});
