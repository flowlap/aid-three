# PPTX 내보내기에 생성 이미지/목업 삽입 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** pptx 내보내기 시 각 씬의 화면 박스 자리에 실제 생성 이미지(없으면 화면 설계 레이아웃을 반영한 목업 이미지)를 자동으로 삽입한다.

**Architecture:** `lib/pptx/exportPptx.ts`의 `buildScenePptx`가 씬별 이미지 버퍼 배열을 추가로 받아, 템플릿 슬라이드에서 `name="화면 영역"` 도형을 찾아 그 자리에 `<p:pic>`으로 교체한다(위치/크기는 원래 도형 그대로, 이미지는 cover-fit 크롭). 씬에 생성 이미지가 없으면 `lib/pptx/renderMockupImage.ts`(next/og의 Satori 렌더러, `lib/video/renderSceneFrameToPng.ts`와 같은 패턴)가 화면 설계의 `layoutElements` 그리드를 PNG로 렌더링해 대신 채운다.

**Tech Stack:** Next.js API Route, TypeScript, JSZip(pptx OOXML 조작), next/og `ImageResponse`(Satori 기반 PNG 렌더링), Vitest.

## Global Constraints

- 새 외부 npm 의존성을 추가하지 않는다 — 이미 프로젝트에 있는 `jszip`, `next/og`만 사용한다.
- 사용자에게 노출되는 문자열과 로그 메시지는 한국어로 작성한다(기존 코드 컨벤션).
- 라우트(`app/api/**/route.ts`) 레벨 자동 테스트는 추가하지 않는다 — 기존 pptx/video 라우트에도 없고, 파이프라인 로직은 `lib/*` 단위 테스트로 커버하는 기존 패턴을 유지한다.
- 이미지 삽입 대상 도형은 반드시 `name="화면 영역"`(공백 포함, `lib/pptx/defaultTemplate.ts`의 `screenBoxXml`이 이미 쓰는 값)과 정확히 일치해야 한다 — 다른 이름의 도형은 인식하지 않는다.
- 관련 설계 문서: `docs/superpowers/specs/2026-08-05-pptx-image-embed-design.md`.

---

### Task 1: Satori 폰트 로더 공용화

`lib/video/renderSceneFrameToPng.ts`에 있는 Pretendard 폰트 로딩 코드(파일 읽기 + 캐시)를 `lib/pptx/renderMockupImage.ts`(Task 3)에서도 그대로 써야 한다. 중복을 피하기 위해 공용 모듈로 뺀다. 순수 리팩터링이라 동작은 바뀌지 않는다 — 기존 `renderSceneFrame.test.tsx`가 회귀를 잡아준다.

**Files:**
- Create: `lib/satoriFonts.ts`
- Modify: `lib/video/renderSceneFrameToPng.ts` (전체 47줄)
- Test: 기존 `lib/video/renderSceneFrame.test.tsx` (수정 없음, 통과 여부만 확인)

**Interfaces:**
- Produces: `loadPretendardFonts(): Promise<SatoriFont[]>`, `type SatoriFont = { data: ArrayBuffer; name: string; weight: 400 | 700; style: "normal" }` — Task 3에서 그대로 가져다 쓴다.

- [ ] **Step 1: `lib/satoriFonts.ts` 작성**

```ts
import { promises as fs } from "fs";
import path from "path";

export type SatoriFont = { data: ArrayBuffer; name: string; weight: 400 | 700; style: "normal" };

let fontsCache: SatoriFont[] | null = null;

function toArrayBuffer(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
}

/** Loads Pretendard Regular/Bold once and caches them for any Satori (`next/og` ImageResponse) renderer in this process. */
export async function loadPretendardFonts(): Promise<SatoriFont[]> {
  if (fontsCache) return fontsCache;
  const dir = path.join(process.cwd(), "assets", "fonts");
  const [regular, bold] = await Promise.all([
    fs.readFile(path.join(dir, "Pretendard-Regular.otf")),
    fs.readFile(path.join(dir, "Pretendard-Bold.otf")),
  ]);
  fontsCache = [
    { data: toArrayBuffer(regular), name: "Pretendard", weight: 400, style: "normal" },
    { data: toArrayBuffer(bold), name: "Pretendard", weight: 700, style: "normal" },
  ];
  return fontsCache;
}
```

- [ ] **Step 2: `lib/video/renderSceneFrameToPng.ts`를 공용 로더를 쓰도록 전체 교체**

```ts
import { ImageResponse } from "next/og";
import { buildSceneFrameLayout, FRAME_WIDTH, FRAME_HEIGHT } from "./renderSceneFrame";
import { loadPretendardFonts } from "@/lib/satoriFonts";
import type { Scene } from "@/lib/pipeline/splitScenes";
import type { VisualDesign } from "@/lib/pipeline/designVisuals";

function toDataUri(buffer: Buffer): string {
  return `data:image/png;base64,${buffer.toString("base64")}`;
}

/** Rasterizes one scene's NotebookLM-style video frame to a 1920x1080 PNG. */
export async function renderSceneFrameToPng(
  scene: Scene,
  design: VisualDesign | undefined,
  imageBuffer?: Buffer
): Promise<Buffer> {
  const fonts = await loadPretendardFonts();
  const response = new ImageResponse(buildSceneFrameLayout(scene, design, imageBuffer ? toDataUri(imageBuffer) : undefined), {
    width: FRAME_WIDTH,
    height: FRAME_HEIGHT,
    fonts,
  });
  return Buffer.from(await response.arrayBuffer());
}
```

- [ ] **Step 3: 타입체크**

Run: `npx tsc --noEmit`
Expected: 에러 없음

- [ ] **Step 4: 기존 테스트 스위트 실행**

Run: `npx vitest run`
Expected: 모든 테스트 PASS (특히 `lib/video/renderSceneFrame.test.tsx`)

- [ ] **Step 5: 커밋**

```bash
git add lib/satoriFonts.ts lib/video/renderSceneFrameToPng.ts
git commit -m "Extract shared Satori font loader for PNG renderers"
```

---

### Task 2: 레이아웃 그리드 목업 JSX

`ScreenMockup.tsx`의 `LayoutElementsMockup`(3x3 그리드 + 자막)을 Satori 호환 인라인 스타일로 재구현한다. `layoutElements`가 없는 씬은 자막/화면유형만 보여주는 카드로 대체한다.

**Files:**
- Create: `lib/pptx/renderMockupLayout.tsx`
- Test: `lib/pptx/renderMockupLayout.test.tsx`

**Interfaces:**
- Consumes: `VisualDesign`, `LayoutPosition`, `LAYOUT_POSITIONS` from `lib/pipeline/designVisuals.ts` (이미 존재).
- Produces: `buildMockupLayout(design: VisualDesign | undefined, screenType: string | undefined, width: number, height: number)` — JSX 엘리먼트를 반환하는 순수 함수. Task 3의 `renderMockupImage`가 이것을 `ImageResponse`에 넘긴다.

- [ ] **Step 1: 실패하는 테스트 작성 — `lib/pptx/renderMockupLayout.test.tsx`**

```tsx
import { describe, it, expect } from "vitest";
import { buildMockupLayout } from "./renderMockupLayout";
import type { VisualDesign, LayoutElement } from "@/lib/pipeline/designVisuals";

const layoutElements: LayoutElement[] = [
  { label: "제목", position: "top" },
  { label: "설명 카드", position: "center" },
];

const design: VisualDesign = {
  caption: "화면 자막입니다",
  keywords: [],
  imageOrDiagramDescription: "",
  objectPlacement: "",
  appearanceOrder: [],
  productionNotes: "",
  layoutElements,
};

function findText(node: unknown, text: string): boolean {
  if (typeof node === "string") return node.includes(text);
  if (Array.isArray(node)) return node.some((child) => findText(child, text));
  if (node && typeof node === "object" && "props" in node) {
    const props = (node as { props?: { children?: unknown } }).props;
    return findText(props?.children, text);
  }
  return false;
}

describe("buildMockupLayout", () => {
  it("renders at the requested width/height", () => {
    const layout = buildMockupLayout(design, "표/그래프형", 1600, 900);
    expect(layout.props.style.width).toBe(1600);
    expect(layout.props.style.height).toBe(900);
  });

  it("shows layoutElements labels when present", () => {
    const layout = buildMockupLayout(design, "표/그래프형", 1600, 900);
    expect(findText(layout, "제목")).toBe(true);
    expect(findText(layout, "설명 카드")).toBe(true);
  });

  it("shows the caption below the grid", () => {
    const layout = buildMockupLayout(design, "표/그래프형", 1600, 900);
    expect(findText(layout, "화면 자막입니다")).toBe(true);
  });

  it("falls back to a caption-only card when layoutElements is missing", () => {
    const layout = buildMockupLayout({ ...design, layoutElements: undefined }, "표/그래프형", 1600, 900);
    expect(findText(layout, "화면 자막입니다")).toBe(true);
  });

  it("falls back to the screen type name when there is no caption either", () => {
    const layout = buildMockupLayout({ ...design, caption: "", layoutElements: undefined }, "표/그래프형", 1600, 900);
    expect(findText(layout, "표/그래프형")).toBe(true);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run lib/pptx/renderMockupLayout.test.tsx`
Expected: FAIL (`renderMockupLayout` 모듈이 없어서 import 에러)

- [ ] **Step 3: `lib/pptx/renderMockupLayout.tsx` 구현**

```tsx
import { LAYOUT_POSITIONS, type LayoutPosition, type VisualDesign } from "@/lib/pipeline/designVisuals";

const GRID_CELL_BG = "rgba(214,211,209,0.4)";
const GRID_CELL_BORDER = "2px dashed rgba(87,83,78,0.4)";

/**
 * JSX for a generic layout-grid mockup frame, rendered via next/og's
 * `ImageResponse` (Satori) in lib/pptx/renderMockupImage.ts — used for pptx
 * export when a scene has no AI-generated image yet. Satori supports only a
 * CSS subset (no Tailwind classes, no CSS custom properties), so this can't
 * reuse ScreenMockup.tsx's LayoutElementsMockup directly; it's a
 * purpose-built re-implementation of the same 3x3 grid + caption using only
 * inline styles, matching lib/video/renderSceneFrame.tsx's approach to the
 * same constraint. Falls back to a plain caption/screen-type card when
 * `design.layoutElements` is missing (older screen-design data).
 */
export function buildMockupLayout(
  design: VisualDesign | undefined,
  screenType: string | undefined,
  width: number,
  height: number
) {
  const caption = design?.caption?.trim() || screenType || "화면 미리보기";
  const elements = design?.layoutElements ?? [];

  if (elements.length === 0) {
    return (
      <div
        style={{
          width,
          height,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 16,
          padding: 64,
          backgroundColor: "#F5F5F4",
          fontFamily: "Pretendard",
        }}
      >
        {screenType && <div style={{ display: "flex", fontSize: 22, color: "#78716C" }}>{screenType}</div>}
        <div
          style={{
            display: "flex",
            maxWidth: width - 128,
            fontSize: 32,
            fontWeight: 700,
            color: "#44403C",
            textAlign: "center",
          }}
        >
          {caption}
        </div>
      </div>
    );
  }

  const byPosition = new Map<LayoutPosition, string[]>();
  for (const el of elements) {
    const list = byPosition.get(el.position) ?? [];
    list.push(el.label);
    byPosition.set(el.position, list);
  }

  return (
    <div style={{ width, height, display: "flex", flexDirection: "column", backgroundColor: "#F5F5F4", fontFamily: "Pretendard" }}>
      <div style={{ display: "flex", flexWrap: "wrap", flex: 1 }}>
        {LAYOUT_POSITIONS.map((pos) => {
          const labels = byPosition.get(pos) ?? [];
          return (
            <div
              key={pos}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                width: `${100 / 3}%`,
                height: `${100 / 3}%`,
                ...(labels.length > 0 ? { border: GRID_CELL_BORDER, backgroundColor: GRID_CELL_BG } : {}),
              }}
            >
              {labels.map((label, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    borderRadius: 999,
                    padding: "8px 20px",
                    fontSize: 20,
                    fontWeight: 600,
                    color: "#57534E",
                    backgroundColor: "rgba(255,255,255,0.85)",
                  }}
                >
                  {label}
                </div>
              ))}
            </div>
          );
        })}
      </div>
      {caption && (
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            borderTop: "1px solid #D6D3D1",
            backgroundColor: "rgba(255,255,255,0.9)",
            padding: "20px 32px",
          }}
        >
          <div style={{ display: "flex", fontSize: 26, fontWeight: 700, color: "#292524", textAlign: "center" }}>{caption}</div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run lib/pptx/renderMockupLayout.test.tsx`
Expected: 5개 테스트 모두 PASS

- [ ] **Step 5: 커밋**

```bash
git add lib/pptx/renderMockupLayout.tsx lib/pptx/renderMockupLayout.test.tsx
git commit -m "Add layout-grid mockup JSX for pptx export"
```

---

### Task 3: 목업 PNG 래스터화

Task 2의 JSX를 `ImageResponse`로 실제 PNG 버퍼로 렌더링하는 래퍼. `lib/video/renderSceneFrameToPng.ts`와 동일한 패턴이며, 이 얇은 래퍼 자체는 (기존 `renderSceneFrameToPng`와 동일하게) 별도 테스트를 두지 않는다 — Satori 실행 자체는 Task 2에서 순수 JSX로 이미 검증했고, 실제 PNG 출력 검증은 Task 6의 수동 확인에서 한다.

**Files:**
- Create: `lib/pptx/renderMockupImage.ts`

**Interfaces:**
- Consumes: `loadPretendardFonts` (Task 1), `buildMockupLayout` (Task 2).
- Produces: `renderMockupImage(design: VisualDesign | undefined, screenType: string | undefined, aspectRatio?: number): Promise<Buffer>` — Task 5(라우트)가 호출한다.

- [ ] **Step 1: `lib/pptx/renderMockupImage.ts` 작성**

```ts
import { ImageResponse } from "next/og";
import { loadPretendardFonts } from "@/lib/satoriFonts";
import { buildMockupLayout } from "./renderMockupLayout";
import type { VisualDesign } from "@/lib/pipeline/designVisuals";

const RENDER_WIDTH = 1600;
const DEFAULT_ASPECT_RATIO = 16 / 9;

/**
 * Rasterizes a generic layout-grid mockup PNG for a scene that has no
 * AI-generated image yet (see renderMockupLayout.tsx). The pptx export path
 * (lib/pptx/exportPptx.ts) crops whatever it's given to cover the
 * placeholder box, so `aspectRatio` only needs to be a reasonable default —
 * it doesn't have to match any specific template's box exactly.
 */
export async function renderMockupImage(
  design: VisualDesign | undefined,
  screenType: string | undefined,
  aspectRatio: number = DEFAULT_ASPECT_RATIO
): Promise<Buffer> {
  const width = RENDER_WIDTH;
  const height = Math.max(1, Math.round(RENDER_WIDTH / aspectRatio));
  const fonts = await loadPretendardFonts();
  const response = new ImageResponse(buildMockupLayout(design, screenType, width, height), { width, height, fonts });
  return Buffer.from(await response.arrayBuffer());
}
```

- [ ] **Step 2: 타입체크**

Run: `npx tsc --noEmit`
Expected: 에러 없음

- [ ] **Step 3: 커밋**

```bash
git add lib/pptx/renderMockupImage.ts
git commit -m "Add mockup PNG rasterizer for pptx export"
```

---

### Task 4: `buildScenePptx`에 이미지 삽입 기능 추가

가장 핵심적인 작업. `perSlideImages` 파라미터를 추가하고, 슬라이드마다 `"화면 영역"` 도형을 찾아 `<p:pic>`으로 교체하는 로직을 넣는다.

**Files:**
- Modify: `lib/pptx/exportPptx.ts:150-256` (기존 `buildScenePptx` 및 그 앞뒤에 헬퍼 함수 추가)
- Modify: `lib/pptx/exportPptx.test.ts` (새 테스트 5개 추가)

**Interfaces:**
- Produces: `buildScenePptx(templateBytes: Buffer | Uint8Array, perSlideData: PptxPlaceholderData[], perSlideImages?: (Buffer | undefined)[]): Promise<Buffer>` — 기존 2-인자 호출과 100% 하위 호환(3번째 인자 생략 시 지금과 동일하게 동작). Task 5(라우트)가 3-인자로 호출한다.

- [ ] **Step 1: 실패하는 테스트 추가 — `lib/pptx/exportPptx.test.ts`**

`SLIDE_RELS` 상수 선언(24번째 줄) 바로 다음, `buildTemplateBytes` 함수(36-44번째 줄) 바로 뒤에 아래 상수/헬퍼를 추가한다:

```ts
const SLIDE_XML_WITH_IMAGE_BOX = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
<p:cSld><p:spTree>
<p:sp><p:txBody><a:p><a:r><a:t>{{과정명}}</a:t></a:r></a:p></p:txBody></p:sp>
<p:sp><p:nvSpPr><p:cNvPr id="5" name="화면 영역"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="100" y="200"/><a:ext cx="4000000" cy="2000000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:p><a:r><a:t>화면 (스크린샷을 붙여넣으세요)</a:t></a:r></a:p></p:txBody></p:sp>
</p:spTree></p:cSld>
</p:sld>`;

async function buildTemplateBytesWithImageBox(contentTypesXml: string = CONTENT_TYPES): Promise<Buffer> {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", contentTypesXml);
  zip.file("ppt/presentation.xml", PRESENTATION_XML);
  zip.file("ppt/_rels/presentation.xml.rels", PRESENTATION_RELS);
  zip.file("ppt/slides/slide1.xml", SLIDE_XML_WITH_IMAGE_BOX);
  zip.file("ppt/slides/_rels/slide1.xml.rels", SLIDE_RELS);
  return zip.generateAsync({ type: "nodebuffer" });
}

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
```

그리고 파일 맨 끝의 `describe("buildScenePptx", ...)` 블록 안, `"throws when given no slide data"` 테스트(현재 132-135번째 줄) 바로 뒤, 블록을 닫는 `});` 바로 앞에 아래 5개 테스트를 추가한다:

```ts
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
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run lib/pptx/exportPptx.test.ts`
Expected: 새로 추가한 5개 테스트 FAIL(나머지 기존 테스트는 PASS), `<p:pic>`이 없다거나 `perSlideImages`가 정의되지 않은 파라미터라는 취지의 실패

- [ ] **Step 3: `lib/pptx/exportPptx.ts` 전체 교체**

```ts
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
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run lib/pptx/exportPptx.test.ts`
Expected: 전체(기존 6개 + 신규 5개) PASS

- [ ] **Step 5: 타입체크 + 전체 테스트**

Run: `npx tsc --noEmit && npx vitest run`
Expected: 에러/실패 없음

- [ ] **Step 6: 커밋**

```bash
git add lib/pptx/exportPptx.ts lib/pptx/exportPptx.test.ts
git commit -m "Embed per-scene images into the 화면 영역 pptx placeholder"
```

---

### Task 5: pptx export 라우트에서 씬 이미지/목업 연결

**Files:**
- Modify: `app/api/projects/[projectId]/storyboard/pptx/route.ts` (전체 85줄)

**Interfaces:**
- Consumes: `readProjectImage` (`lib/projects/store.ts`, 기존), `renderMockupImage` (Task 3), `buildScenePptx(..., perSlideImages)` (Task 4).

- [ ] **Step 1: `route.ts` 전체 교체**

```ts
import { NextRequest, NextResponse } from "next/server";
import { readProject, readProjectFile, readProjectPptxTemplate, readProjectImage } from "@/lib/projects/store";
import { buildScenePptx, type PptxPlaceholderData } from "@/lib/pptx/exportPptx";
import { buildDefaultPptxTemplate, buildNotebookLmPptxTemplate } from "@/lib/pptx/defaultTemplate";
import { renderMockupImage } from "@/lib/pptx/renderMockupImage";
import type { Scene } from "@/lib/pipeline/splitScenes";
import type { ScreenTypeAssignment } from "@/lib/pipeline/selectScreenTypes";
import type { VisualDesign } from "@/lib/pipeline/designVisuals";

/**
 * Fills in the per-scene pptx template — an ad-hoc file attached to this
 * request takes priority, otherwise the project's saved custom template
 * (registered via `/pptx-template`) is used if one exists, otherwise falls
 * back to the bundled default/노트북LM template for a one-click "PPTX로 저장"
 * with no upload step. Each scene's generated image (or, if none exists
 * yet, a layout-grid mockup — see lib/pptx/renderMockupImage.ts) is
 * embedded into the template's "화면 영역" placeholder shape when present;
 * templates without that shape still get text-only slides as before.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const project = await readProject(projectId);
  if (!project) return NextResponse.json({ error: "프로젝트를 찾을 수 없습니다" }, { status: 404 });

  const formData = await req.formData();
  const template = formData.get("template") as File | null;
  const style = formData.get("style") as string | null;

  let templateBytes: Buffer;
  if (template) {
    if (!template.name.toLowerCase().endsWith(".pptx")) {
      return NextResponse.json({ error: "pptx 파일만 업로드 가능합니다" }, { status: 400 });
    }
    templateBytes = Buffer.from(await template.arrayBuffer());
  } else {
    const savedTemplate = await readProjectPptxTemplate(projectId);
    templateBytes =
      savedTemplate ?? (style === "notebooklm" ? await buildNotebookLmPptxTemplate() : await buildDefaultPptxTemplate());
  }

  const scenesRaw = await readProjectFile(projectId, "scenes.json");
  if (!scenesRaw) {
    return NextResponse.json({ error: "씬 데이터가 없습니다" }, { status: 400 });
  }
  const scenes: Scene[] = JSON.parse(scenesRaw).scenes ?? [];
  if (scenes.length === 0) {
    return NextResponse.json({ error: "씬 데이터가 없습니다" }, { status: 400 });
  }

  const screenDesignRaw = await readProjectFile(projectId, "screen-design.json");
  const screenDesign = screenDesignRaw ? JSON.parse(screenDesignRaw) : {};
  const screenTypes: Record<string, ScreenTypeAssignment> = screenDesign.screenTypes ?? {};
  const visualDesigns: Record<string, VisualDesign> = screenDesign.visualDesigns ?? {};

  const perSlideData: PptxPlaceholderData[] = scenes.map((scene, index) => {
    const screenType = screenTypes[scene.id];
    const design = visualDesigns[scene.id];
    return {
      과정명: project.title,
      번호: String(index + 1),
      나레이션: scene.narrationText,
      자막: design?.caption ?? "",
      화면유형: screenType?.screenType ?? "",
      설명: design?.imageOrDiagramDescription ?? "",
      배치: design?.objectPlacement ?? "",
      키워드: design?.keywords?.join(", ") ?? "",
      길이: `${scene.estimatedDurationSec}초`,
    };
  });

  const perSlideImages: (Buffer | undefined)[] = await Promise.all(
    scenes.map(async (scene) => {
      const generated = await readProjectImage(projectId, scene.id);
      if (generated) return generated;
      try {
        return await renderMockupImage(visualDesigns[scene.id], screenTypes[scene.id]?.screenType);
      } catch (err) {
        console.error(`목업 이미지 생성 실패 (씬 ${scene.id}):`, err);
        return undefined;
      }
    })
  );

  let output: Buffer;
  try {
    output = await buildScenePptx(templateBytes, perSlideData, perSlideImages);
  } catch (err) {
    console.error("pptx 생성 실패:", err);
    const message = err instanceof Error ? err.message : "pptx 생성에 실패했습니다";
    return NextResponse.json({ error: message }, { status: 422 });
  }

  const filename = encodeURIComponent(`${project.title}-스토리보드.pptx`);
  return new Response(new Uint8Array(output), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "Content-Disposition": `attachment; filename*=UTF-8''${filename}`,
    },
  });
}
```

- [ ] **Step 2: 타입체크**

Run: `npx tsc --noEmit`
Expected: 에러 없음

- [ ] **Step 3: 전체 테스트 실행**

Run: `npx vitest run`
Expected: 모든 테스트 PASS

- [ ] **Step 4: 커밋**

```bash
git add app/api/projects/\[projectId\]/storyboard/pptx/route.ts
git commit -m "Wire scene images/mockups into the pptx export route"
```

---

### Task 6: 실제 pptx로 수동 검증

자동 테스트는 XML 조작이 맞는지만 확인한다 — 실제 PowerPoint/Keynote에서 열었을 때 이미지가 깨지지 않고 올바른 위치에 보이는지는 직접 확인해야 한다.

**Files:** 없음(검증 전용, 코드 변경 없음)

- [ ] **Step 1: 서버 기동**

Run: `./start.sh dev`
Expected: `서버 시작 (모드: dev, pm2 프로세스명: aid-three, 포트: 9625)` 출력

- [ ] **Step 2: 기존 프로젝트로 pptx 다운로드**

브라우저에서 `http://localhost:9625`에 접속 → 이미지 생성까지 완료된(또는 일부만 생성된) 기존 프로젝트를 열고 → 미리보기(Preview) 화면에서 "PPTX로 저장" 버튼으로 파일을 내려받는다. 씬 중 일부는 이미지가 생성되어 있고 일부는 없는 프로젝트로 테스트하면 두 경로(실제 이미지/목업)를 한 번에 확인할 수 있다.

- [ ] **Step 3: 결과 pptx 확인**

PowerPoint, Keynote, 또는 LibreOffice Impress로 다운로드한 파일을 열어 각 슬라이드의 "화면 영역" 자리에 이미지(생성 이미지 또는 그리드 목업)가 채워져 있고, 잘림/찌그러짐 없이 박스 안에 꽉 차 있는지 확인한다. 파일이 열리지 않거나 손상되었다는 경고가 뜨면 실패.

앱을 열 수 없는 환경이라면 커맨드라인으로도 최소 확인 가능:

```bash
unzip -l <다운로드한-파일>.pptx | grep media
unzip -p <다운로드한-파일>.pptx ppt/slides/slide2.xml | grep -o '<p:pic>'
```

Expected: `ppt/media/pptxImageN.png` 파일들이 나열되고, 슬라이드 XML에 `<p:pic>`이 존재.

- [ ] **Step 4: 서버 종료**

Run: `./stop.sh`

---

## Self-Review 결과

- **스펙 커버리지**: 아키텍처(Task 1-5), 에러 처리(Task 4의 `embedScreenImage`가 도형/이미지 없음을 null로 처리 + Task 5의 try/catch), 테스트(Task 2, 4의 신규 테스트), 범위 밖 항목(토글/14종 전용 목업/커스텀 템플릿 자동 도형 생성 없음 — 계획에 포함하지 않음으로써 반영) 모두 태스크로 매핑됨.
- **플레이스홀더 스캔**: "TBD"/"나중에"/설명만 있고 코드가 없는 단계 없음 — 모든 스텝에 완전한 코드 포함.
- **타입 일관성**: `buildScenePptx(templateBytes, perSlideData, perSlideImages?)`, `renderMockupImage(design, screenType, aspectRatio?)`, `buildMockupLayout(design, screenType, width, height)`, `loadPretendardFonts(): Promise<SatoriFont[]>` — 정의한 시그니처를 태스크 전체에서 동일하게 사용.
