import JSZip from "jszip";

/** Values to substitute into `{{key}}` placeholders found in the template slide, one map per output slide/scene. */
export type PptxPlaceholderData = Record<string, string>;

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function unescapeXml(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

interface RunInfo {
  /** Byte offset of this run's `<a:r>` in the paragraph string. */
  index: number;
  /** Length of the full `<a:r>...</a:r>` block. */
  length: number;
  rPrXml: string;
  tAttrs: string;
  /** Unescaped run text. */
  text: string;
  /** Offsets of `text` within the paragraph's concatenated run text. */
  textStart: number;
  textEnd: number;
}

function buildRunXml(rPrXml: string, tAttrs: string, text: string): string {
  return `<a:r>${rPrXml}<a:t${tAttrs}>${escapeXml(text)}</a:t></a:r>`;
}

/**
 * Substitutes `{{key}}` placeholders within a single paragraph, merging
 * runs when a placeholder was split across multiple `<a:t>` text runs — a
 * common side effect of PowerPoint autocomplete or a mid-phrase formatting
 * change while typing the placeholder in the template. Only the runs a
 * placeholder actually spans are rewritten (using the first spanned run's
 * formatting for the substituted value); every other run, and any non-run
 * content between them, is left byte-for-byte identical.
 */
function substituteInParagraph(paragraphXml: string, data: PptxPlaceholderData): string {
  if (!paragraphXml.includes("{{")) return paragraphXml;

  const runRegex = /<a:r>([\s\S]*?)<\/a:r>/g;
  const runs: RunInfo[] = [];
  let runMatch: RegExpExecArray | null;
  let textCursor = 0;
  while ((runMatch = runRegex.exec(paragraphXml))) {
    const runInner = runMatch[1];
    const rPrMatch = runInner.match(/<a:rPr\b[^>]*(?:\/>|>[\s\S]*?<\/a:rPr>)/);
    const tMatch = runInner.match(/<a:t\b([^>]*)>([\s\S]*?)<\/a:t>/);
    if (!tMatch) continue;
    const text = unescapeXml(tMatch[2]);
    runs.push({
      index: runMatch.index,
      length: runMatch[0].length,
      rPrXml: rPrMatch ? rPrMatch[0] : "",
      tAttrs: tMatch[1],
      text,
      textStart: textCursor,
      textEnd: textCursor + text.length,
    });
    textCursor += text.length;
  }
  if (runs.length === 0) return paragraphXml;

  const fullText = runs.map((r) => r.text).join("");
  if (!fullText.includes("{{")) return paragraphXml;

  const placeholderRegex = /\{\{\s*([^{}]+?)\s*\}\}/g;
  const matches: { start: number; end: number; value: string }[] = [];
  let placeholderMatch: RegExpExecArray | null;
  while ((placeholderMatch = placeholderRegex.exec(fullText))) {
    const key = placeholderMatch[1].trim();
    if (!Object.prototype.hasOwnProperty.call(data, key)) continue;
    matches.push({ start: placeholderMatch.index, end: placeholderMatch.index + placeholderMatch[0].length, value: data[key] ?? "" });
  }
  if (matches.length === 0) return paragraphXml;

  const runIndexAt = (pos: number): number => {
    const found = runs.findIndex((r) => pos >= r.textStart && pos < r.textEnd);
    return found >= 0 ? found : runs.length - 1;
  };

  const firstRunIdx = Math.min(...matches.map((m) => runIndexAt(m.start)));
  const lastRunIdx = Math.max(...matches.map((m) => runIndexAt(Math.max(m.end - 1, m.start))));
  const spanTextStart = runs[firstRunIdx].textStart;
  const spanTextEnd = runs[lastRunIdx].textEnd;

  const sliceRunsXml = (start: number, end: number): string => {
    if (start >= end) return "";
    const out: string[] = [];
    for (let i = firstRunIdx; i <= lastRunIdx; i++) {
      const r = runs[i];
      const s = Math.max(start, r.textStart);
      const e = Math.min(end, r.textEnd);
      if (s >= e) continue;
      out.push(buildRunXml(r.rPrXml, r.tAttrs, r.text.slice(s - r.textStart, e - r.textStart)));
    }
    return out.join("");
  };

  let rebuilt = "";
  let cursor = spanTextStart;
  for (const match of matches) {
    if (match.start > cursor) rebuilt += sliceRunsXml(cursor, match.start);
    const ownerRun = runs[runIndexAt(match.start)];
    rebuilt += buildRunXml(ownerRun.rPrXml, ownerRun.tAttrs, match.value);
    cursor = match.end;
  }
  if (cursor < spanTextEnd) rebuilt += sliceRunsXml(cursor, spanTextEnd);

  const before = paragraphXml.slice(0, runs[firstRunIdx].index);
  const after = paragraphXml.slice(runs[lastRunIdx].index + runs[lastRunIdx].length);
  return before + rebuilt + after;
}

/**
 * Replaces every `{{key}}` found in the slide XML's paragraphs with the
 * matching value from `data` (XML-escaped). Placeholders with no matching
 * key are left untouched so a typo or an unsupported field stays visible in
 * the output instead of silently disappearing.
 */
function substitutePlaceholders(xml: string, data: PptxPlaceholderData): string {
  return xml.replace(/<a:p\b[^>]*>[\s\S]*?<\/a:p>/g, (paragraphXml) => substituteInParagraph(paragraphXml, data));
}

function extractAttr(tag: string, name: string): string | null {
  const m = tag.match(new RegExp(`${name}="([^"]*)"`));
  return m ? m[1] : null;
}

const IMAGE_RELATIONSHIP_TYPE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image";
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Reads width/height out of a PNG's IHDR chunk, or null if `buffer` isn't a PNG. */
function readPngDimensions(buffer: Buffer): { width: number; height: number } | null {
  if (buffer.length < 24 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

/**
 * Computes an `<a:srcRect>` crop (in 1/1000ths of a percent, per OOXML) that
 * makes an `imgWidth`x`imgHeight` image cover a `boxCx`x`boxCy` box without
 * distorting its aspect ratio — cropping the wider dimension's excess evenly
 * from both edges, the same "cover" behavior the in-app preview/video frame
 * use for scene images.
 */
function computeSrcRectCropPermille(
  imgWidth: number,
  imgHeight: number,
  boxCx: number,
  boxCy: number
): { l: number; t: number; r: number; b: number } {
  if (imgWidth <= 0 || imgHeight <= 0 || boxCx <= 0 || boxCy <= 0) {
    return { l: 0, t: 0, r: 0, b: 0 };
  }
  const imgRatio = imgWidth / imgHeight;
  const boxRatio = boxCx / boxCy;

  if (imgRatio > boxRatio) {
    const visibleFraction = boxRatio / imgRatio;
    const each = Math.round(((1 - visibleFraction) / 2) * 100000);
    return { l: each, t: 0, r: each, b: 0 };
  }
  if (imgRatio < boxRatio) {
    const visibleFraction = imgRatio / boxRatio;
    const each = Math.round(((1 - visibleFraction) / 2) * 100000);
    return { l: 0, t: each, r: 0, b: each };
  }
  return { l: 0, t: 0, r: 0, b: 0 };
}

interface ScreenBoxShape {
  start: number;
  end: number;
  id: string;
  x: string;
  y: string;
  cx: string;
  cy: string;
}

/** Finds the `<p:sp>` shape named "화면 영역" (the pptx export's designated image placeholder — see lib/pptx/defaultTemplate.ts's screenBoxXml) in a slide's XML, if any. */
function findScreenBoxShape(slideXml: string): ScreenBoxShape | null {
  const spRegex = /<p:sp>[\s\S]*?<\/p:sp>/g;
  let m: RegExpExecArray | null;
  while ((m = spRegex.exec(slideXml))) {
    const block = m[0];
    if (!/name="화면 영역"/.test(block)) continue;
    const idMatch = block.match(/<p:cNvPr\s+id="(\d+)"/);
    const offMatch = block.match(/<a:off\s+x="(-?\d+)"\s+y="(-?\d+)"\s*\/>/);
    const extMatch = block.match(/<a:ext\s+cx="(\d+)"\s+cy="(\d+)"\s*\/>/);
    if (!idMatch || !offMatch || !extMatch) return null;
    return {
      start: m.index,
      end: m.index + block.length,
      id: idMatch[1],
      x: offMatch[1],
      y: offMatch[2],
      cx: extMatch[1],
      cy: extMatch[2],
    };
  }
  return null;
}

function buildPicXml(
  id: string,
  rid: string,
  x: string,
  y: string,
  cx: string,
  cy: string,
  crop: { l: number; t: number; r: number; b: number }
): string {
  const srcRectAttrs =
    crop.l || crop.t || crop.r || crop.b ? ` l="${crop.l}" t="${crop.t}" r="${crop.r}" b="${crop.b}"` : "";
  return (
    `<p:pic><p:nvPicPr><p:cNvPr id="${id}" name="화면 이미지"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr>` +
    `<p:blipFill><a:blip r:embed="${rid}"/><a:srcRect${srcRectAttrs}/><a:stretch><a:fillRect/></a:stretch></p:blipFill>` +
    `<p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>` +
    `</p:pic>`
  );
}

function nextAvailableRelId(relsXml: string): number {
  const ids = [...relsXml.matchAll(/Id="rId(\d+)"/g)].map((m) => Number(m[1]));
  return (ids.length ? Math.max(...ids) : 0) + 1;
}

/**
 * Replaces the slide's "화면 영역" placeholder shape (if any) with a `<p:pic>`
 * showing `imageBuffer`, cropped to cover the placeholder's box. Returns
 * null (leaving the slide untouched) when there's no such shape, or no rels
 * file to attach the image relationship to — the caller then keeps the
 * plain-text slide exactly as before, so custom templates without this
 * shape aren't affected.
 */
function embedScreenImage(
  slideXml: string,
  slideRelsXml: string | undefined,
  imageBuffer: Buffer,
  mediaFileName: string
): { slideXml: string; relsXml: string } | null {
  if (!slideRelsXml) return null;
  const shape = findScreenBoxShape(slideXml);
  if (!shape) return null;

  const rid = `rId${nextAvailableRelId(slideRelsXml)}`;
  const dims = readPngDimensions(imageBuffer);
  const crop = dims
    ? computeSrcRectCropPermille(dims.width, dims.height, Number(shape.cx), Number(shape.cy))
    : { l: 0, t: 0, r: 0, b: 0 };
  const picXml = buildPicXml(shape.id, rid, shape.x, shape.y, shape.cx, shape.cy, crop);

  const newSlideXml = slideXml.slice(0, shape.start) + picXml + slideXml.slice(shape.end);
  const newRelsXml = slideRelsXml.replace(
    "</Relationships>",
    `<Relationship Id="${rid}" Type="${IMAGE_RELATIONSHIP_TYPE}" Target="../media/${mediaFileName}"/></Relationships>`
  );

  return { slideXml: newSlideXml, relsXml: newRelsXml };
}

/** Adds a `png` Default content-type declaration if the template doesn't already have one. */
function ensurePngContentType(contentTypesXml: string): string {
  if (/Extension="png"/i.test(contentTypesXml)) return contentTypesXml;
  return contentTypesXml.replace("</Types>", `<Default Extension="png" ContentType="image/png"/></Types>`);
}

/**
 * Takes a .pptx template whose first slide contains `{{placeholder}}` text,
 * and returns a new .pptx with that slide duplicated once per entry in
 * `perSlideData`, each copy with its placeholders filled in.
 *
 * When `perSlideImages[i]` is given (parallel to `perSlideData[i]`) and the
 * template's slide has a shape named "화면 영역" (see
 * lib/pptx/defaultTemplate.ts), that shape is replaced with the image,
 * cropped to cover its box. Slides with no image for that index, or
 * templates with no such shape, are produced exactly as before — text
 * substitution only, layout/formatting untouched.
 */
export async function buildScenePptx(
  templateBytes: Buffer | Uint8Array,
  perSlideData: PptxPlaceholderData[],
  perSlideImages?: (Buffer | undefined)[]
): Promise<Buffer> {
  if (perSlideData.length === 0) {
    throw new Error("생성할 슬라이드 데이터가 없습니다");
  }

  const zip = await JSZip.loadAsync(templateBytes);

  const presentationPath = "ppt/presentation.xml";
  const presentationRelsPath = "ppt/_rels/presentation.xml.rels";
  const contentTypesPath = "[Content_Types].xml";

  const presentationXml = await zip.file(presentationPath)?.async("string");
  const presentationRelsXml = await zip.file(presentationRelsPath)?.async("string");
  const contentTypesXml = await zip.file(contentTypesPath)?.async("string");
  if (!presentationXml || !presentationRelsXml || !contentTypesXml) {
    throw new Error("올바른 pptx 파일이 아닙니다 (필수 구조 파일 없음)");
  }

  const sldIdEntries = [...presentationXml.matchAll(/<p:sldId\s+id="(\d+)"\s+r:id="(rId\d+)"\s*\/>/g)];
  if (sldIdEntries.length === 0) {
    throw new Error("템플릿 pptx에 슬라이드가 없습니다");
  }
  const [firstSldIdTag, templateSlideId, templateRid] = sldIdEntries[0];

  const relEntries = [...presentationRelsXml.matchAll(/<Relationship\s+[^>]*Id="(rId\d+)"[^>]*\/>/g)].map(
    (m) => m[0]
  );
  const templateRelTag = relEntries.find((tag) => extractAttr(tag, "Id") === templateRid);
  if (!templateRelTag) {
    throw new Error("템플릿 pptx의 슬라이드 관계 정보를 찾을 수 없습니다");
  }
  const templateRelType = extractAttr(templateRelTag, "Type");
  const templateTarget = extractAttr(templateRelTag, "Target"); // e.g. "slides/slide1.xml"
  if (!templateRelType || !templateTarget) {
    throw new Error("템플릿 pptx의 슬라이드 관계 정보가 올바르지 않습니다");
  }
  const templateSlidePath = `ppt/${templateTarget.replace(/^\.?\//, "")}`;

  const templateSlideXml = await zip.file(templateSlidePath)?.async("string");
  if (!templateSlideXml) {
    throw new Error("템플릿 pptx의 슬라이드 파일을 찾을 수 없습니다");
  }

  const contentTypeOverride = contentTypesXml.match(
    new RegExp(`<Override PartName="/${templateSlidePath}" ContentType="([^"]+)"\\s*/>`)
  );
  const slideContentType =
    contentTypeOverride?.[1] ?? "application/vnd.openxmlformats-officedocument.presentationml.slide+xml";

  const slideRelsPath = templateSlidePath.replace(/^ppt\/slides\/(.+)$/, "ppt/slides/_rels/$1.rels");
  const templateSlideRelsXml = await zip.file(slideRelsPath)?.async("string");

  const existingSlideNums = [...zip.file(/ppt\/slides\/slide\d+\.xml$/) ?? []].map((f) => {
    const m = f.name.match(/slide(\d+)\.xml$/);
    return m ? Number(m[1]) : 0;
  });
  let nextSlideNum = (existingSlideNums.length ? Math.max(...existingSlideNums) : 0) + 1;

  const existingRids = [...presentationRelsXml.matchAll(/Id="rId(\d+)"/g)].map((m) => Number(m[1]));
  let nextRidNum = (existingRids.length ? Math.max(...existingRids) : 0) + 1;

  const existingSlideIds = [...presentationXml.matchAll(/<p:sldId\s+id="(\d+)"/g)].map((m) => Number(m[1]));
  let nextSlideIdNum = Math.max(256, ...existingSlideIds) + 1;

  const newOverrides: string[] = [];
  const newRelationships: string[] = [];
  const newSldIdTags: string[] = [];
  let nextMediaNum = 1;
  let anyImageEmbedded = false;

  for (let i = 0; i < perSlideData.length; i++) {
    const filledXml = substitutePlaceholders(templateSlideXml, perSlideData[i]);

    let outputSlideXml = filledXml;
    let outputRelsXml = templateSlideRelsXml;
    const imageBuffer = perSlideImages?.[i];
    if (imageBuffer) {
      const mediaFileName = `pptxImage${nextMediaNum}.png`;
      const embedded = embedScreenImage(filledXml, templateSlideRelsXml, imageBuffer, mediaFileName);
      if (embedded) {
        outputSlideXml = embedded.slideXml;
        outputRelsXml = embedded.relsXml;
        zip.file(`ppt/media/${mediaFileName}`, imageBuffer);
        nextMediaNum++;
        anyImageEmbedded = true;
      }
    }

    if (i === 0) {
      zip.file(templateSlidePath, outputSlideXml);
      if (outputRelsXml !== templateSlideRelsXml) zip.file(slideRelsPath, outputRelsXml!);
      newSldIdTags.push(`<p:sldId id="${templateSlideId}" r:id="${templateRid}"/>`);
      continue;
    }

    const slideNum = nextSlideNum++;
    const rid = `rId${nextRidNum++}`;
    const slideId = nextSlideIdNum++;
    const slidePath = `ppt/slides/slide${slideNum}.xml`;
    const relsPath = `ppt/slides/_rels/slide${slideNum}.xml.rels`;

    zip.file(slidePath, outputSlideXml);
    if (outputRelsXml) zip.file(relsPath, outputRelsXml);

    newOverrides.push(`<Override PartName="/${slidePath}" ContentType="${slideContentType}"/>`);
    newRelationships.push(`<Relationship Id="${rid}" Type="${templateRelType}" Target="slides/slide${slideNum}.xml"/>`);
    newSldIdTags.push(`<p:sldId id="${slideId}" r:id="${rid}"/>`);
  }

  const updatedPresentationXml = presentationXml.replace(firstSldIdTag, newSldIdTags.join(""));
  const updatedPresentationRelsXml = presentationRelsXml.replace(
    "</Relationships>",
    `${newRelationships.join("")}</Relationships>`
  );
  const contentTypesWithPng = anyImageEmbedded ? ensurePngContentType(contentTypesXml) : contentTypesXml;
  const updatedContentTypesXml = contentTypesWithPng.replace("</Types>", `${newOverrides.join("")}</Types>`);

  zip.file(presentationPath, updatedPresentationXml);
  zip.file(presentationRelsPath, updatedPresentationRelsXml);
  zip.file(contentTypesPath, updatedContentTypesXml);

  return zip.generateAsync({ type: "nodebuffer" });
}
