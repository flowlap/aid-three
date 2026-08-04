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

const SLIDE_XML_WITH_IMAGE_BOX = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
<p:cSld><p:spTree>
<p:sp><p:txBody><a:p><a:r><a:t>{{과정명}}</a:t></a:r></a:p></p:txBody></p:sp>
<p:sp><p:nvSpPr><p:cNvPr id="5" name="화면 영역"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="100" y="200"/><a:ext cx="4000000" cy="2000000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:p><a:r><a:t>화면 (스크린샷을 붙여넣으세요)</a:t></a:r></a:p></p:txBody></p:sp>
</p:spTree></p:cSld>
</p:sld>`;

async function buildTemplateBytesWithImageBox(
  contentTypesXml: string = CONTENT_TYPES,
  slideRelsXml: string = SLIDE_RELS
): Promise<Buffer> {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", contentTypesXml);
  zip.file("ppt/presentation.xml", PRESENTATION_XML);
  zip.file("ppt/_rels/presentation.xml.rels", PRESENTATION_RELS);
  zip.file("ppt/slides/slide1.xml", SLIDE_XML_WITH_IMAGE_BOX);
  zip.file("ppt/slides/_rels/slide1.xml.rels", slideRelsXml);
  return zip.generateAsync({ type: "nodebuffer" });
}

/** Non-sequential rId set (rId1, rId5 — deliberately skips rId2-4) to catch a nextAvailableRelId
 * implementation that uses `ids.length + 1` instead of `Math.max(...ids) + 1`. */
const SLIDE_RELS_NON_SEQUENTIAL = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
<Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide1.xml"/>
</Relationships>`;

/** Not a fully valid PNG — just enough of the signature + IHDR chunk for readPngDimensions to parse the given size. */
function buildFakePngBuffer(width: number, height: number): Buffer {
  const buf = Buffer.alloc(24);
  buf.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  buf.writeUInt32BE(13, 8);
  buf.write("IHDR", 12, "ascii");
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  return buf;
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

  it("embeds a scene image into the 화면 영역 placeholder and removes the placeholder shape", async () => {
    const template = await buildTemplateBytesWithImageBox();
    const image = buildFakePngBuffer(400, 200);

    const output = await buildScenePptx(template, [{ 과정명: "테스트 과정" }], [image]);
    const outZip = await JSZip.loadAsync(output);
    const slide1 = await outZip.file("ppt/slides/slide1.xml")!.async("string");

    expect(slide1).not.toContain('name="화면 영역"');
    expect(slide1).toContain("<p:pic>");
    expect(slide1).toContain('<a:off x="100" y="200"/>');
    expect(slide1).toContain('<a:ext cx="4000000" cy="2000000"/>');

    const rels = await outZip.file("ppt/slides/_rels/slide1.xml.rels")!.async("string");
    const relMatch = rels.match(/Id="(rId\d+)"[^>]*Target="\.\.\/media\/(pptxImage\d+\.png)"/);
    expect(relMatch).not.toBeNull();
    expect(slide1).toContain(`r:embed="${relMatch![1]}"`);

    const mediaFile = outZip.file(`ppt/media/${relMatch![2]}`);
    expect(mediaFile).not.toBeNull();
    expect(await mediaFile!.async("nodebuffer")).toEqual(image);

    const contentTypes = await outZip.file("[Content_Types].xml")!.async("string");
    expect(contentTypes).toContain('Extension="png"');
  });

  it("computes a cover-fit crop when the image aspect ratio doesn't match the placeholder box", async () => {
    const template = await buildTemplateBytesWithImageBox();
    const image = buildFakePngBuffer(400, 400); // square image, 2:1 box -> crop top/bottom

    const output = await buildScenePptx(template, [{ 과정명: "x" }], [image]);
    const outZip = await JSZip.loadAsync(output);
    const slide1 = await outZip.file("ppt/slides/slide1.xml")!.async("string");

    const srcRectMatch = slide1.match(/<a:srcRect\s+l="(\d+)"\s+t="(\d+)"\s+r="(\d+)"\s+b="(\d+)"\s*\/>/);
    expect(srcRectMatch).not.toBeNull();
    const [, l, t, r, b] = srcRectMatch!;
    expect(l).toBe("0");
    expect(r).toBe("0");
    expect(Number(t)).toBeGreaterThan(0);
    expect(Number(b)).toBeGreaterThan(0);
  });

  it("embeds distinct images into multiple slides without collisions", async () => {
    const template = await buildTemplateBytesWithImageBox();
    const imageA = buildFakePngBuffer(400, 200);
    const imageB = buildFakePngBuffer(300, 300);

    const output = await buildScenePptx(template, [{ 과정명: "A" }, { 과정명: "B" }], [imageA, imageB]);
    const outZip = await JSZip.loadAsync(output);

    const mediaFiles = Object.keys(outZip.files).filter((n) => /^ppt\/media\/pptxImage\d+\.png$/.test(n));
    expect(mediaFiles).toHaveLength(2);

    const slideFiles = Object.keys(outZip.files).filter((n) => /ppt\/slides\/slide\d+\.xml$/.test(n)).sort();
    expect(slideFiles).toHaveLength(2);
    const relsFiles = Object.keys(outZip.files).filter((n) => /ppt\/slides\/_rels\/slide\d+\.xml\.rels$/.test(n));
    expect(relsFiles).toHaveLength(2);

    for (const relsFile of relsFiles) {
      const relsXml = await outZip.file(relsFile)!.async("string");
      const imageRels = [...relsXml.matchAll(/Type="[^"]*\/image"[^>]*Target="\.\.\/media\/(pptxImage\d+\.png)"/g)];
      expect(imageRels).toHaveLength(1);
    }

    const mediaBuffers = await Promise.all(mediaFiles.map((f) => outZip.file(f)!.async("nodebuffer")));
    const matchesA = mediaBuffers.filter((b) => b.equals(imageA)).length;
    const matchesB = mediaBuffers.filter((b) => b.equals(imageB)).length;
    expect(matchesA).toBe(1);
    expect(matchesB).toBe(1);

    const contentTypes = await outZip.file("[Content_Types].xml")!.async("string");
    expect([...contentTypes.matchAll(/Extension="png"/g)]).toHaveLength(1);
  });

  it("leaves scenes without a provided image as plain text output", async () => {
    const template = await buildTemplateBytesWithImageBox();
    const image = buildFakePngBuffer(400, 200);

    const output = await buildScenePptx(template, [{ 과정명: "A" }, { 과정명: "B" }], [image, undefined]);
    const outZip = await JSZip.loadAsync(output);

    const slide1 = await outZip.file("ppt/slides/slide1.xml")!.async("string");
    expect(slide1).toContain("<p:pic>");

    const otherSlideName = Object.keys(outZip.files).find(
      (n) => /ppt\/slides\/slide\d+\.xml$/.test(n) && n !== "ppt/slides/slide1.xml"
    );
    const slide2 = await outZip.file(otherSlideName!)!.async("string");
    expect(slide2).toContain('name="화면 영역"');
    expect(slide2).not.toContain("<p:pic>");
  });

  it("does nothing when perSlideImages is passed but the template has no 화면 영역 shape", async () => {
    const template = await buildTemplateBytes();
    const image = buildFakePngBuffer(400, 200);

    const output = await buildScenePptx(template, [{ 과정명: "x", 나레이션: "y" }], [image]);
    const outZip = await JSZip.loadAsync(output);
    const slide1 = await outZip.file("ppt/slides/slide1.xml")!.async("string");

    expect(slide1).not.toContain("<p:pic>");
    expect(slide1).toContain("y");
  });

  it("doesn't duplicate the png content-type entry if the template already declares one", async () => {
    const contentTypesWithPng = CONTENT_TYPES.replace(
      '<Default Extension="xml" ContentType="application/xml"/>',
      '<Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/>'
    );
    const template = await buildTemplateBytesWithImageBox(contentTypesWithPng);

    const output = await buildScenePptx(template, [{ 과정명: "x" }], [buildFakePngBuffer(400, 200)]);
    const outZip = await JSZip.loadAsync(output);
    const contentTypes = await outZip.file("[Content_Types].xml")!.async("string");

    expect([...contentTypes.matchAll(/Extension="png"/g)]).toHaveLength(1);
  });

  it("assigns the new image relationship the next rId after the highest existing one, not count+1", async () => {
    const template = await buildTemplateBytesWithImageBox(CONTENT_TYPES, SLIDE_RELS_NON_SEQUENTIAL);
    const image = buildFakePngBuffer(400, 200);

    const output = await buildScenePptx(template, [{ 과정명: "x" }], [image]);
    const outZip = await JSZip.loadAsync(output);
    const slide1 = await outZip.file("ppt/slides/slide1.xml")!.async("string");
    const rels = await outZip.file("ppt/slides/_rels/slide1.xml.rels")!.async("string");

    expect(rels).toContain('Id="rId6"');
    expect(slide1).toContain('r:embed="rId6"');
  });
});
