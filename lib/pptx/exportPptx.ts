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

/**
 * Takes a .pptx template whose first slide contains `{{placeholder}}` text,
 * and returns a new .pptx with that slide duplicated once per entry in
 * `perSlideData`, each copy with its placeholders filled in. Only text is
 * substituted — images, layout, and formatting are left exactly as designed
 * in the template.
 */
export async function buildScenePptx(
  templateBytes: Buffer | Uint8Array,
  perSlideData: PptxPlaceholderData[]
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

  for (let i = 0; i < perSlideData.length; i++) {
    const filledXml = substitutePlaceholders(templateSlideXml, perSlideData[i]);

    if (i === 0) {
      zip.file(templateSlidePath, filledXml);
      newSldIdTags.push(`<p:sldId id="${templateSlideId}" r:id="${templateRid}"/>`);
      continue;
    }

    const slideNum = nextSlideNum++;
    const rid = `rId${nextRidNum++}`;
    const slideId = nextSlideIdNum++;
    const slidePath = `ppt/slides/slide${slideNum}.xml`;
    const relsPath = `ppt/slides/_rels/slide${slideNum}.xml.rels`;

    zip.file(slidePath, filledXml);
    if (templateSlideRelsXml) zip.file(relsPath, templateSlideRelsXml);

    newOverrides.push(`<Override PartName="/${slidePath}" ContentType="${slideContentType}"/>`);
    newRelationships.push(`<Relationship Id="${rid}" Type="${templateRelType}" Target="slides/slide${slideNum}.xml"/>`);
    newSldIdTags.push(`<p:sldId id="${slideId}" r:id="${rid}"/>`);
  }

  const updatedPresentationXml = presentationXml.replace(firstSldIdTag, newSldIdTags.join(""));
  const updatedPresentationRelsXml = presentationRelsXml.replace(
    "</Relationships>",
    `${newRelationships.join("")}</Relationships>`
  );
  const updatedContentTypesXml = contentTypesXml.replace("</Types>", `${newOverrides.join("")}</Types>`);

  zip.file(presentationPath, updatedPresentationXml);
  zip.file(presentationRelsPath, updatedPresentationRelsXml);
  zip.file(contentTypesPath, updatedContentTypesXml);

  return zip.generateAsync({ type: "nodebuffer" });
}
