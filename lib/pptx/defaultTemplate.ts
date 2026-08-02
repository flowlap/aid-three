import JSZip from "jszip";

/** EMU per inch (English Metric Units — the unit PowerPoint XML positions/sizes use). */
const IN = 914400;
const SLIDE_WIDTH = 12192000; // 13.333in, 16:9
const SLIDE_HEIGHT = 6858000; // 7.5in

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

interface FieldRow {
  label: string;
  placeholder: string;
  fontSize: number;
  bold?: boolean;
}

// Mirrors the placeholder keys `app/api/projects/[projectId]/storyboard/pptx/route.ts`
// substitutes for each scene. Grouped into 3 zones below instead of one flat
// stack: 우측 설명 컬럼 + 하단 나레이션 스트립이 가운데 화면 박스를 감싸는
// (mirrored ㄴ) layout — see buildSlideXml.
const HEADER_FIELDS: FieldRow[] = [{ label: "과정명", placeholder: "과정명", fontSize: 2000, bold: true }];
const HEADER_NUMBER_FIELD: FieldRow = { label: "번호", placeholder: "번호", fontSize: 1400 };
const DESCRIPTION_FIELDS: FieldRow[] = [
  { label: "자막", placeholder: "자막", fontSize: 1200, bold: true },
  { label: "화면유형", placeholder: "화면유형", fontSize: 1200 },
  { label: "설명", placeholder: "설명", fontSize: 1100 },
  { label: "배치", placeholder: "배치", fontSize: 1100 },
  { label: "키워드", placeholder: "키워드", fontSize: 1100 },
  { label: "길이", placeholder: "길이", fontSize: 1100 },
];
const NARRATION_FIELD: FieldRow = { label: "나레이션", placeholder: "나레이션", fontSize: 1600 };

/** Every text run is explicit black — don't rely on inherited theme color. */
const TEXT_COLOR = "000000";

function textBoxXml(
  id: number,
  x: number,
  y: number,
  cx: number,
  cy: number,
  text: string,
  fontSize: number,
  bold: boolean
): string {
  return (
    `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="필드 ${id}"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr/></p:nvSpPr>` +
    `<p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>` +
    `<p:txBody><a:bodyPr wrap="square" rtlCol="0"><a:normAutofit/></a:bodyPr><a:lstStyle/>` +
    `<a:p><a:r><a:rPr lang="ko-KR" sz="${fontSize}"${bold ? ' b="1"' : ""} dirty="0"><a:solidFill><a:srgbClr val="${TEXT_COLOR}"/></a:solidFill></a:rPr><a:t>${escapeXml(text)}</a:t></a:r></a:p>` +
    `</p:txBody></p:sp>`
  );
}

/** Empty bordered placeholder frame — reserved for a screenshot/scene image to be pasted in manually (pptx export doesn't embed images yet). */
function screenBoxXml(id: number, x: number, y: number, cx: number, cy: number): string {
  return (
    `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="화면 영역"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>` +
    `<p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom>` +
    `<a:noFill/><a:ln w="19050"><a:solidFill><a:srgbClr val="BFBFBF"/></a:solidFill><a:prstDash val="dash"/></a:ln></p:spPr>` +
    `<p:txBody><a:bodyPr wrap="square" anchor="ctr" rtlCol="0"/><a:lstStyle/>` +
    `<a:p><a:pPr algn="ctr"/><a:r><a:rPr lang="ko-KR" sz="1400" dirty="0"><a:solidFill><a:srgbClr val="BFBFBF"/></a:solidFill></a:rPr><a:t>화면 (스크린샷을 붙여넣으세요)</a:t></a:r></a:p>` +
    `</p:txBody></p:sp>`
  );
}

/**
 * Mirrored-ㄴ layout: a big empty 화면 box center-left, a 설명 column running
 * down the right edge (the vertical stroke), and a 나레이션 strip along the
 * full bottom edge (the horizontal stroke) — the two together frame the
 * 화면 box on its right and bottom sides.
 */
function buildSlideXml(backgroundHex: string): string {
  const margin = Math.round(0.4 * IN);
  const gap = Math.round(0.1 * IN);
  const rightColumnWidth = Math.round(3.2 * IN);
  const narrationHeight = Math.round(1.5 * IN);

  const headerY = Math.round(0.2 * IN);
  const headerHeight = Math.round(0.35 * IN);

  const screenY = headerY + headerHeight + gap;
  const narrationY = SLIDE_HEIGHT - margin - narrationHeight;
  const screenHeight = narrationY - gap - screenY;
  const screenWidth = SLIDE_WIDTH - margin - gap - rightColumnWidth - margin;

  const rightColumnX = margin + screenWidth + gap;

  const shapes: string[] = [];
  let id = 2;

  // Header: 과정명 (left) + 번호 (right, aligned with the 설명 column below it)
  shapes.push(textBoxXml(id++, margin, headerY, screenWidth, headerHeight, `${HEADER_FIELDS[0].label}: {{${HEADER_FIELDS[0].placeholder}}}`, HEADER_FIELDS[0].fontSize, true));
  shapes.push(
    textBoxXml(id++, rightColumnX, headerY, rightColumnWidth, headerHeight, `${HEADER_NUMBER_FIELD.label}: {{${HEADER_NUMBER_FIELD.placeholder}}}`, HEADER_NUMBER_FIELD.fontSize, false)
  );

  // Center: empty 화면 placeholder
  shapes.push(screenBoxXml(id++, margin, screenY, screenWidth, screenHeight));

  // Right column: 설명 stack
  const rowGap = Math.round(0.05 * IN);
  const rowHeight = Math.round((screenHeight - rowGap * (DESCRIPTION_FIELDS.length - 1)) / DESCRIPTION_FIELDS.length);
  DESCRIPTION_FIELDS.forEach((field, i) => {
    const y = screenY + i * (rowHeight + rowGap);
    shapes.push(textBoxXml(id++, rightColumnX, y, rightColumnWidth, rowHeight, `${field.label}: {{${field.placeholder}}}`, field.fontSize, field.bold ?? false));
  });

  // Bottom strip: 나레이션, full width
  const fullWidth = SLIDE_WIDTH - margin * 2;
  shapes.push(
    textBoxXml(id++, margin, narrationY, fullWidth, narrationHeight, `${NARRATION_FIELD.label}: {{${NARRATION_FIELD.placeholder}}}`, NARRATION_FIELD.fontSize, false)
  );

  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">` +
    `<p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="${backgroundHex}"/></a:solidFill><a:effectLst/></p:bgPr></p:bg><p:spTree>` +
    `<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>` +
    `<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>` +
    shapes.join("") +
    `</p:spTree></p:cSld>` +
    `<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>` +
    `</p:sld>`
  );
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>
<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>
<Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`;

const CORE_PROPS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<dc:title>스토리보드 기본 템플릿</dc:title>
<dc:creator>aid-three</dc:creator>
</cp:coreProperties>`;

const APP_PROPS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
<Application>aid-three</Application>
<Slides>1</Slides>
</Properties>`;

const PRESENTATION_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>
<p:sldIdLst><p:sldId id="256" r:id="rId2"/></p:sldIdLst>
<p:sldSz cx="${SLIDE_WIDTH}" cy="${SLIDE_HEIGHT}" type="screen16x9"/>
<p:notesSz cx="6858000" cy="9144000"/>
</p:presentation>`;

const PRESENTATION_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
</Relationships>`;

const SLIDE_MASTER_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
<p:cSld>
<p:spTree>
<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
</p:spTree>
</p:cSld>
<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>
<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>
</p:sldMaster>`;

const SLIDE_MASTER_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/>
</Relationships>`;

const SLIDE_LAYOUT_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="blank" preserve="1">
<p:cSld name="Blank">
<p:spTree>
<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
</p:spTree>
</p:cSld>
<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sldLayout>`;

const SLIDE_LAYOUT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/>
</Relationships>`;

const SLIDE_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
</Relationships>`;

interface ThemeColors {
  /** Slide background tint (theme's lt1 — what the master's bgRef paints). */
  background: string;
  accent1: string;
  accent2: string;
}

const DEFAULT_THEME: ThemeColors = { background: "FFFFFF", accent1: "5645D4", accent2: "ED7D31" };

/** Warm, minimal palette matching NotebookLmMockup.tsx's amber/orange card. */
const NOTEBOOKLM_THEME: ThemeColors = { background: "FDF6EC", accent1: "D97706", accent2: "EA580C" };

function buildThemeXml(colors: ThemeColors): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Office Theme">
<a:themeElements>
<a:clrScheme name="Office">
<a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1>
<a:lt1><a:srgbClr val="${colors.background}"/></a:lt1>
<a:dk2><a:srgbClr val="44546A"/></a:dk2>
<a:lt2><a:srgbClr val="E7E6E6"/></a:lt2>
<a:accent1><a:srgbClr val="${colors.accent1}"/></a:accent1>
<a:accent2><a:srgbClr val="${colors.accent2}"/></a:accent2>
<a:accent3><a:srgbClr val="A5A5A5"/></a:accent3>
<a:accent4><a:srgbClr val="FFC000"/></a:accent4>
<a:accent5><a:srgbClr val="5B9BD5"/></a:accent5>
<a:accent6><a:srgbClr val="70AD47"/></a:accent6>
<a:hlink><a:srgbClr val="0563C1"/></a:hlink>
<a:folHlink><a:srgbClr val="954F72"/></a:folHlink>
</a:clrScheme>
<a:fontScheme name="Office">
<a:majorFont><a:latin typeface="Calibri Light"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont>
<a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont>
</a:fontScheme>
<a:fmtScheme name="Office">
<a:fillStyleLst>
<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
</a:fillStyleLst>
<a:lnStyleLst>
<a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>
<a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>
<a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>
</a:lnStyleLst>
<a:effectStyleLst>
<a:effectStyle><a:effectLst/></a:effectStyle>
<a:effectStyle><a:effectLst/></a:effectStyle>
<a:effectStyle><a:effectLst/></a:effectStyle>
</a:effectStyleLst>
<a:bgFillStyleLst>
<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
</a:bgFillStyleLst>
</a:fmtScheme>
</a:themeElements>
</a:theme>`;
}

async function assembleTemplateZip(colors: ThemeColors): Promise<Buffer> {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", CONTENT_TYPES);
  zip.file("_rels/.rels", ROOT_RELS);
  zip.file("docProps/core.xml", CORE_PROPS);
  zip.file("docProps/app.xml", APP_PROPS);
  zip.file("ppt/presentation.xml", PRESENTATION_XML);
  zip.file("ppt/_rels/presentation.xml.rels", PRESENTATION_RELS);
  zip.file("ppt/slideMasters/slideMaster1.xml", SLIDE_MASTER_XML);
  zip.file("ppt/slideMasters/_rels/slideMaster1.xml.rels", SLIDE_MASTER_RELS);
  zip.file("ppt/slideLayouts/slideLayout1.xml", SLIDE_LAYOUT_XML);
  zip.file("ppt/slideLayouts/_rels/slideLayout1.xml.rels", SLIDE_LAYOUT_RELS);
  zip.file("ppt/slides/slide1.xml", buildSlideXml(colors.background));
  zip.file("ppt/slides/_rels/slide1.xml.rels", SLIDE_RELS);
  zip.file("ppt/theme/theme1.xml", buildThemeXml(colors));
  return zip.generateAsync({ type: "nodebuffer" });
}

/**
 * A ready-to-open, single-slide .pptx whose slide lays out every
 * `{{placeholder}}` key `buildScenePptx` (and the storyboard export route)
 * substitutes per scene — 과정명/번호/나레이션/자막/화면유형/설명/배치/키워드/길이 —
 * each labeled so a user can see what it is, restyle it in PowerPoint, and
 * re-upload it as their own export template.
 */
export async function buildDefaultPptxTemplate(): Promise<Buffer> {
  return assembleTemplateZip(DEFAULT_THEME);
}

/**
 * Same field layout as `buildDefaultPptxTemplate` (so it substitutes through
 * `buildScenePptx` unchanged) but themed with the warm amber/orange palette
 * that matches `NotebookLmMockup.tsx`, for users who want their pptx export
 * to match the NotebookLM-style preview.
 */
export async function buildNotebookLmPptxTemplate(): Promise<Buffer> {
  return assembleTemplateZip(NOTEBOOKLM_THEME);
}
