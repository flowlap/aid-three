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

/**
 * Replaces every `{{key}}` found anywhere in the slide XML with the matching
 * value from `data` (XML-escaped). Placeholders with no matching key are left
 * untouched so a typo or an unsupported field stays visible in the output
 * instead of silently disappearing.
 *
 * Known limitation: PowerPoint sometimes splits a single typed phrase across
 * multiple `<a:t>` text runs (e.g. due to autocomplete or a mid-word
 * formatting change), which would split a placeholder across runs too and
 * make it invisible to this regex. Type each `{{placeholder}}` in one
 * continuous, unformatted run in the template to avoid this.
 */
function substitutePlaceholders(xml: string, data: PptxPlaceholderData): string {
  return xml.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (match, rawKey: string) => {
    const key = rawKey.trim();
    if (!Object.prototype.hasOwnProperty.call(data, key)) return match;
    return escapeXml(data[key] ?? "");
  });
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
