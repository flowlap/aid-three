# 이러닝 스토리보드 생성기 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 이러닝 원고/나레이션을 업로드해 마크다운 변환 → 씬 분할 → 화면 유형 선정 → 비주얼 설계 → 일관성 검수 → 최종 스토리보드 뷰까지 이어지는 로컬 실행 Next.js 웹앱을 만든다.

**Architecture:** Next.js(App Router) 단일 앱. `lib/pipeline/*`에 각 파이프라인 단계를 순수 함수형 모듈(DeepSeek 클라이언트를 인자로 주입받는 형태)로 구현해 테스트 가능하게 만들고, `lib/projects/store.ts`가 `data/projects/{id}/` 폴더에 단계별 JSON/마크다운 파일로 상태를 저장한다. 각 단계는 API Route가 파이프라인 모듈을 호출해 결과를 저장하고, 서버 컴포넌트 페이지가 저장된 파일을 읽어 편집 UI로 보여준다.

**Tech Stack:** Next.js (App Router, TypeScript) · Tailwind CSS · shadcn/ui · Vitest (유닛 테스트) · pdf-parse (PDF 텍스트 추출) · DeepSeek API (fetch 기반 직접 호출)

## Global Constraints

- 로컬 실행 웹앱: `npm run dev`로 실행, Windows/Mac 브라우저에서 접속. 별도 서버 프로세스 없음.
- AI 제공자는 DeepSeek API만 사용. 모델명은 반드시 `deepseek-v4-pro` 또는 `deepseek-v4-flash` 사용 (레거시 `deepseek-chat`/`deepseek-reasoner`는 2026-07-24부로 폐지되어 사용 불가). Base URL: `https://api.deepseek.com`, 엔드포인트 `/chat/completions`. 상세: `docs/reference/deepseek-api.md`.
- 데이터 저장은 DB 없이 `data/projects/{project-id}/` 폴더 + 파일(JSON/markdown) 구조로만 한다.
- 씬 분할 시 나레이션 원문을 임의로 수정하지 않고 분절만 한다 — 코드 레벨로 원문 재조합 검증을 반드시 포함한다.
- `lib/pipeline/*` 모듈은 `(input) => Promise<output>` 형태의 순수 함수형 인터페이스로 작성해, 나중에 특정 모듈을 Python 프로세스로 교체할 수 있는 여지를 남긴다. 지금 Python 코드는 작성하지 않는다.
- v1 범위에는 pptx 템플릿 삽입/내보내기와 AI 이미지 생성(OpenAI GPT Image 1.5 Low)을 포함하지 않는다 — 자리만 마련하고 구현하지 않는다.
- 결정적 로직(폴더 CRUD, 마크다운 포맷팅, 씬 텍스트 무결성 검증, 일관성 검수 규칙)과 AI 호출부(mock 클라이언트로 프롬프트/파싱 검증)는 유닛 테스트로 커버한다. UI 페이지와 API Route의 "AI 산출물 품질"은 자동 테스트 대상이 아니며, 각 태스크의 수동 검증 단계로 확인한다.

---

### Task 1: Next.js 프로젝트 스캐폴딩 & 툴체인 구성

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `tailwind.config.ts`, `app/layout.tsx`, `app/page.tsx`, `app/globals.css`
- Create: `vitest.config.ts`
- Create: `components/ui/*` (shadcn 컴포넌트: button, input, textarea, card, badge, table)
- Create: `.env.example`

**Interfaces:**
- Produces: `npm run dev`(로컬 서버), `npm test`(vitest 실행) 스크립트. 이후 모든 태스크가 이 스캐폴딩 위에서 동작.

- [ ] **Step 1: Next.js 앱 생성**

```bash
npx --yes create-next-app@latest . --typescript --tailwind --eslint --app --import-alias "@/*" --use-npm --no-src-dir --turbopack
```

기존 `.git`, `.gitignore`, `CLAUDE.md`, `docs/` 는 유지된 채로 진행된다(비어있지 않은 디렉터리라는 경고가 뜨면 계속 진행 선택).

- [ ] **Step 2: 개발 서버 동작 확인**

Run: `npm run dev` 실행 후 `http://localhost:3000` 접속해 기본 Next.js 페이지가 뜨는지 확인, 이후 Ctrl+C로 종료.

- [ ] **Step 3: Vitest 설치 및 설정**

```bash
npm install -D vitest @vitejs/plugin-react vite-tsconfig-paths
```

```ts
// vitest.config.ts
import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts"],
  },
});
```

`package.json`의 `scripts`에 추가:
```json
"test": "vitest run"
```

- [ ] **Step 4: 테스트 러너 동작 확인용 더미 테스트**

```ts
// lib/sanity.test.ts
import { describe, it, expect } from "vitest";

describe("sanity", () => {
  it("vitest가 정상 동작한다", () => {
    expect(1 + 1).toBe(2);
  });
});
```

Run: `npm test`
Expected: PASS (1 test)

더미 테스트는 Task 2에서 실제 테스트로 대체되므로 이 파일은 Task 2 완료 후 삭제한다.

- [ ] **Step 5: shadcn/ui 초기화 및 컴포넌트 추가**

```bash
npx --yes shadcn@latest init -d
npx --yes shadcn@latest add button input textarea card badge table
```

- [ ] **Step 6: 환경변수 예시 파일 작성**

```
# .env.example
DEEPSEEK_API_KEY=
```

- [ ] **Step 7: 커밋**

```bash
git add package.json package-lock.json tsconfig.json next.config.ts tailwind.config.ts app components lib vitest.config.ts .env.example .gitignore
git commit -m "Scaffold Next.js app with Tailwind, shadcn/ui, and Vitest"
```

---

### Task 2: 프로젝트 데이터 타입 & 파일 기반 저장소

**Files:**
- Create: `lib/projects/types.ts`
- Create: `lib/projects/store.ts`
- Test: `lib/projects/store.test.ts`
- Delete: `lib/sanity.test.ts` (Task 1의 더미 테스트)

**Interfaces:**
- Consumes: 없음 (최하위 계층)
- Produces:
  - `ProjectMeta { id, title, createdAt, scriptType: "script" | "narration", currentStep }`
  - `PipelineStep = "upload" | "markdown" | "scenes" | "screen-types" | "visual-design" | "review" | "storyboard"`
  - `createProject(title: string, scriptType: ScriptType): Promise<ProjectMeta>`
  - `listProjects(): Promise<ProjectMeta[]>`
  - `readProject(id: string): Promise<ProjectMeta | null>`
  - `updateProjectStep(id: string, step: PipelineStep): Promise<void>`
  - `deleteProject(id: string): Promise<void>`
  - `writeProjectFile(id: string, filename: string, content: string): Promise<void>`
  - `readProjectFile(id: string, filename: string): Promise<string | null>`
  - `projectSourceDir(id: string): string`
  - 이후 모든 태스크가 이 함수들로 프로젝트 상태를 읽고 쓴다.

- [ ] **Step 1: 타입 정의**

```ts
// lib/projects/types.ts
export type ScriptType = "script" | "narration";

export type PipelineStep =
  | "upload"
  | "markdown"
  | "scenes"
  | "screen-types"
  | "visual-design"
  | "review"
  | "storyboard";

export interface ProjectMeta {
  id: string;
  title: string;
  createdAt: string;
  scriptType: ScriptType;
  currentStep: PipelineStep;
}
```

- [ ] **Step 2: 실패하는 테스트 작성**

```ts
// lib/projects/store.test.ts
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
} from "./store";

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
});
```

- [ ] **Step 3: 테스트 실패 확인**

Run: `npm test -- store.test.ts`
Expected: FAIL — `./store` 모듈이 존재하지 않음

- [ ] **Step 4: 저장소 구현**

```ts
// lib/projects/store.ts
import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import type { ProjectMeta, PipelineStep, ScriptType } from "./types";

function getProjectsRoot(): string {
  return process.env.PROJECTS_DATA_DIR || path.join(process.cwd(), "data", "projects");
}

function projectDir(id: string): string {
  return path.join(getProjectsRoot(), id);
}

export function projectSourceDir(id: string): string {
  return path.join(projectDir(id), "source");
}

export async function createProject(title: string, scriptType: ScriptType): Promise<ProjectMeta> {
  const id = randomUUID();
  await fs.mkdir(projectSourceDir(id), { recursive: true });

  const meta: ProjectMeta = {
    id,
    title,
    createdAt: new Date().toISOString(),
    scriptType,
    currentStep: "upload",
  };
  await fs.writeFile(path.join(projectDir(id), "project.json"), JSON.stringify(meta, null, 2), "utf-8");
  return meta;
}

export async function listProjects(): Promise<ProjectMeta[]> {
  const root = getProjectsRoot();
  await fs.mkdir(root, { recursive: true });
  const entries = await fs.readdir(root, { withFileTypes: true });

  const metas: ProjectMeta[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const meta = await readProject(entry.name);
    if (meta) metas.push(meta);
  }
  return metas.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function readProject(id: string): Promise<ProjectMeta | null> {
  try {
    const raw = await fs.readFile(path.join(projectDir(id), "project.json"), "utf-8");
    return JSON.parse(raw) as ProjectMeta;
  } catch {
    return null;
  }
}

export async function updateProjectStep(id: string, step: PipelineStep): Promise<void> {
  const meta = await readProject(id);
  if (!meta) throw new Error(`Project not found: ${id}`);
  meta.currentStep = step;
  await fs.writeFile(path.join(projectDir(id), "project.json"), JSON.stringify(meta, null, 2), "utf-8");
}

export async function deleteProject(id: string): Promise<void> {
  await fs.rm(projectDir(id), { recursive: true, force: true });
}

export async function writeProjectFile(id: string, filename: string, content: string): Promise<void> {
  await fs.writeFile(path.join(projectDir(id), filename), content, "utf-8");
}

export async function readProjectFile(id: string, filename: string): Promise<string | null> {
  try {
    return await fs.readFile(path.join(projectDir(id), filename), "utf-8");
  } catch {
    return null;
  }
}
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `npm test -- store.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 6: 더미 테스트 삭제 및 전체 테스트 실행**

```bash
rm lib/sanity.test.ts
npm test
```

Expected: PASS

- [ ] **Step 7: 커밋**

```bash
git add lib/projects vitest.config.ts
git rm lib/sanity.test.ts
git commit -m "Add file-based project store with CRUD operations"
```

---

### Task 3: DeepSeek 클라이언트 (실제 구현 + 목)

**Files:**
- Create: `lib/ai/deepseekClient.ts`
- Create: `lib/ai/deepseekClient.mock.ts`
- Test: `lib/ai/deepseekClient.test.ts`

**Interfaces:**
- Consumes: `process.env.DEEPSEEK_API_KEY`
- Produces:
  - `interface ChatMessage { role: "system" | "user" | "assistant"; content: string }`
  - `interface DeepSeekClient { complete(messages: ChatMessage[], options?: { model?: string; jsonMode?: boolean }): Promise<string> }`
  - `createDeepSeekClient(): DeepSeekClient` (실 구현, `.env`의 `DEEPSEEK_API_KEY` 필요)
  - `class MockDeepSeekClient implements DeepSeekClient` — `calls` 배열에 호출 기록, 고정 응답 리스트 반환. 이후 모든 파이프라인 모듈 테스트가 이 mock을 사용.

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// lib/ai/deepseekClient.test.ts
import { describe, it, expect } from "vitest";
import { MockDeepSeekClient } from "./deepseekClient.mock";

describe("MockDeepSeekClient", () => {
  it("returns queued responses in order", async () => {
    const client = new MockDeepSeekClient(["첫 응답", "두번째 응답"]);

    const first = await client.complete([{ role: "user", content: "a" }]);
    const second = await client.complete([{ role: "user", content: "b" }]);

    expect(first).toBe("첫 응답");
    expect(second).toBe("두번째 응답");
  });

  it("repeats the last response once queue is exhausted", async () => {
    const client = new MockDeepSeekClient(["유일한 응답"]);

    await client.complete([{ role: "user", content: "a" }]);
    const second = await client.complete([{ role: "user", content: "b" }]);

    expect(second).toBe("유일한 응답");
  });

  it("records call messages and options for assertions", async () => {
    const client = new MockDeepSeekClient(["응답"]);

    await client.complete([{ role: "user", content: "질문" }], { jsonMode: true });

    expect(client.calls).toHaveLength(1);
    expect(client.calls[0].messages[0].content).toBe("질문");
    expect(client.calls[0].options?.jsonMode).toBe(true);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm test -- deepseekClient.test.ts`
Expected: FAIL — `./deepseekClient.mock` 모듈이 존재하지 않음

- [ ] **Step 3: 인터페이스와 실제 클라이언트 구현**

```ts
// lib/ai/deepseekClient.ts
export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface DeepSeekCompleteOptions {
  model?: string;
  jsonMode?: boolean;
}

export interface DeepSeekClient {
  complete(messages: ChatMessage[], options?: DeepSeekCompleteOptions): Promise<string>;
}

const DEFAULT_MODEL = "deepseek-v4-pro";
const BASE_URL = "https://api.deepseek.com";

export class RealDeepSeekClient implements DeepSeekClient {
  constructor(private readonly apiKey: string) {}

  async complete(messages: ChatMessage[], options?: DeepSeekCompleteOptions): Promise<string> {
    const response = await fetch(`${BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: options?.model ?? DEFAULT_MODEL,
        messages,
        response_format: options?.jsonMode ? { type: "json_object" } : undefined,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`DeepSeek API error (${response.status}): ${body}`);
    }

    const data = (await response.json()) as {
      choices: Array<{ message: { content: string } }>;
    };
    return data.choices[0].message.content;
  }
}

export function createDeepSeekClient(): DeepSeekClient {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    throw new Error("DEEPSEEK_API_KEY 환경변수가 설정되지 않았습니다");
  }
  return new RealDeepSeekClient(apiKey);
}
```

```ts
// lib/ai/deepseekClient.mock.ts
import type { ChatMessage, DeepSeekClient, DeepSeekCompleteOptions } from "./deepseekClient";

export class MockDeepSeekClient implements DeepSeekClient {
  public calls: Array<{ messages: ChatMessage[]; options?: DeepSeekCompleteOptions }> = [];
  private callIndex = 0;

  constructor(private readonly responses: string[]) {}

  async complete(messages: ChatMessage[], options?: DeepSeekCompleteOptions): Promise<string> {
    this.calls.push({ messages, options });
    const response = this.responses[this.callIndex] ?? this.responses[this.responses.length - 1];
    this.callIndex += 1;
    return response;
  }
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm test -- deepseekClient.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: 커밋**

```bash
git add lib/ai
git commit -m "Add DeepSeek client interface with real and mock implementations"
```

---

### Task 4: 텍스트 추출 모듈 (PDF/TXT)

**Files:**
- Create: `lib/pipeline/extractText.ts`
- Test: `lib/pipeline/extractText.test.ts`

**Interfaces:**
- Consumes: 없음
- Produces: `extractText(filePath: string, mimeType: "pdf" | "txt"): Promise<string>` — Task 5(업로드 API)가 사용.

- [ ] **Step 1: 패키지 설치**

```bash
npm install pdf-parse
npm install -D @types/pdf-parse
```

- [ ] **Step 2: 실패하는 테스트 작성**

```ts
// lib/pipeline/extractText.test.ts
import { describe, it, expect } from "vitest";
import { promises as fs } from "fs";
import path from "path";
import os from "os";
import { extractText } from "./extractText";

describe("extractText", () => {
  it("reads plain text files as-is", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "extract-text-"));
    const filePath = path.join(dir, "sample.txt");
    await fs.writeFile(filePath, "안녕하세요 원고 내용입니다.", "utf-8");

    const result = await extractText(filePath, "txt");

    expect(result).toBe("안녕하세요 원고 내용입니다.");
  });

  it("throws a clear error for invalid pdf content", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "extract-text-"));
    const filePath = path.join(dir, "broken.pdf");
    await fs.writeFile(filePath, "이건 진짜 pdf가 아닙니다");

    await expect(extractText(filePath, "pdf")).rejects.toThrow();
  });
});
```

- [ ] **Step 3: 테스트 실패 확인**

Run: `npm test -- extractText.test.ts`
Expected: FAIL — `./extractText` 모듈이 존재하지 않음

- [ ] **Step 4: 구현**

```ts
// lib/pipeline/extractText.ts
import { promises as fs } from "fs";
import pdfParse from "pdf-parse";

export async function extractText(filePath: string, mimeType: "pdf" | "txt"): Promise<string> {
  if (mimeType === "txt") {
    return fs.readFile(filePath, "utf-8");
  }
  const buffer = await fs.readFile(filePath);
  const data = await pdfParse(buffer);
  return data.text;
}
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `npm test -- extractText.test.ts`
Expected: PASS (2 tests)

이 테스트는 pdf 파싱 실패 경로만 검증한다. 실제 pdf 파싱 품질은 Task 13의 수동 검증 단계에서 실제 pdf 파일로 확인한다.

- [ ] **Step 6: 커밋**

```bash
git add lib/pipeline package.json package-lock.json
git commit -m "Add text extraction module for pdf/txt uploads"
```

---

### Task 5: 업로드 흐름 (API + 홈 화면 + 새 프로젝트 화면)

**Files:**
- Create: `app/api/projects/route.ts`
- Create: `app/api/projects/upload/route.ts`
- Create: `app/page.tsx`
- Create: `app/projects/new/page.tsx`

**Interfaces:**
- Consumes: `listProjects`, `createProject`, `projectSourceDir`, `writeProjectFile` (Task 2), `extractText` (Task 4)
- Produces: `GET /api/projects`, `POST /api/projects/upload` (multipart: `file`, `title`, `scriptType`) → `{ project: ProjectMeta }`. Task 6이 업로드 직후 `extracted.txt`를 읽어 마크다운 변환에 사용.

- [ ] **Step 1: 프로젝트 목록 API**

```ts
// app/api/projects/route.ts
import { NextResponse } from "next/server";
import { listProjects } from "@/lib/projects/store";

export async function GET() {
  const projects = await listProjects();
  return NextResponse.json({ projects });
}
```

- [ ] **Step 2: 업로드 API**

```ts
// app/api/projects/upload/route.ts
import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { createProject, projectSourceDir, writeProjectFile } from "@/lib/projects/store";
import { extractText } from "@/lib/pipeline/extractText";
import type { ScriptType } from "@/lib/projects/types";

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  const title = formData.get("title") as string | null;
  const scriptType = formData.get("scriptType") as ScriptType | null;

  if (!file || !title || !scriptType) {
    return NextResponse.json({ error: "file, title, scriptType는 필수입니다" }, { status: 400 });
  }

  const lowerName = file.name.toLowerCase();
  const isPdf = lowerName.endsWith(".pdf");
  const isTxt = lowerName.endsWith(".txt");
  if (!isPdf && !isTxt) {
    return NextResponse.json({ error: "pdf 또는 txt 파일만 업로드 가능합니다" }, { status: 400 });
  }

  const project = await createProject(title, scriptType);
  const sourcePath = path.join(projectSourceDir(project.id), file.name);
  const buffer = Buffer.from(await file.arrayBuffer());
  await fs.writeFile(sourcePath, buffer);

  let rawText: string;
  try {
    rawText = await extractText(sourcePath, isPdf ? "pdf" : "txt");
  } catch (err) {
    return NextResponse.json(
      { error: `파일 파싱에 실패했습니다: ${(err as Error).message}` },
      { status: 422 }
    );
  }
  await writeProjectFile(project.id, "extracted.txt", rawText);

  return NextResponse.json({ project });
}
```

- [ ] **Step 3: 홈 화면 (프로젝트 목록)**

```tsx
// app/page.tsx
import Link from "next/link";
import { listProjects } from "@/lib/projects/store";
import { Button } from "@/components/ui/button";

export default async function HomePage() {
  const projects = await listProjects();

  return (
    <main className="mx-auto max-w-3xl p-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">스토리보드 프로젝트</h1>
        <Button asChild>
          <Link href="/projects/new">새 프로젝트</Link>
        </Button>
      </div>
      <ul className="space-y-2">
        {projects.map((project) => (
          <li key={project.id} className="rounded border p-4">
            <Link href={`/projects/${project.id}/markdown`} className="font-medium hover:underline">
              {project.title}
            </Link>
            <p className="text-sm text-gray-500">
              현재 단계: {project.currentStep} · 생성일:{" "}
              {new Date(project.createdAt).toLocaleDateString("ko-KR")}
            </p>
          </li>
        ))}
        {projects.length === 0 && <p className="text-gray-500">아직 프로젝트가 없습니다.</p>}
      </ul>
    </main>
  );
}
```

- [ ] **Step 4: 새 프로젝트 화면 (업로드 폼)**

```tsx
// app/projects/new/page.tsx
"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function NewProjectPage() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [scriptType, setScriptType] = useState<"script" | "narration">("script");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!file) {
      setError("파일을 선택해주세요");
      return;
    }
    setSubmitting(true);
    setError(null);

    const formData = new FormData();
    formData.append("file", file);
    formData.append("title", title);
    formData.append("scriptType", scriptType);

    const res = await fetch("/api/projects/upload", { method: "POST", body: formData });
    const data = await res.json();
    setSubmitting(false);

    if (!res.ok) {
      setError(data.error ?? "업로드에 실패했습니다");
      return;
    }
    router.push(`/projects/${data.project.id}/markdown`);
  }

  return (
    <main className="mx-auto max-w-xl p-8">
      <h1 className="mb-6 text-2xl font-bold">새 프로젝트</h1>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="mb-1 block text-sm font-medium">프로젝트 제목</label>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} required />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">타입</label>
          <select
            className="w-full rounded border p-2"
            value={scriptType}
            onChange={(e) => setScriptType(e.target.value as "script" | "narration")}
          >
            <option value="script">원고</option>
            <option value="narration">나레이션</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">파일 (pdf, txt)</label>
          <input
            type="file"
            accept=".pdf,.txt"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            required
          />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <Button type="submit" disabled={submitting}>
          {submitting ? "업로드 중..." : "프로젝트 생성"}
        </Button>
      </form>
    </main>
  );
}
```

- [ ] **Step 5: 수동 검증**

Run: `npm run dev`
1. `http://localhost:3000/projects/new` 접속
2. 제목 입력, 타입 선택, 샘플 `.txt` 파일 업로드 후 "프로젝트 생성" 클릭
3. `/projects/{id}/markdown`로 리다이렉트되는지 확인 (Task 6에서 실제 페이지 구현 전까지는 404가 정상)
4. `data/projects/{id}/project.json`, `source/`, `extracted.txt`가 생성됐는지 파일시스템에서 확인
5. 홈(`/`)에서 방금 만든 프로젝트가 목록에 뜨는지 확인

- [ ] **Step 6: 커밋**

```bash
git add app
git commit -m "Add project upload flow with home and new-project pages"
```

---

### Task 6: 1단계 — 마크다운 변환

**Files:**
- Create: `lib/pipeline/convertMarkdown.ts`
- Test: `lib/pipeline/convertMarkdown.test.ts`
- Create: `app/api/projects/[projectId]/markdown/route.ts`
- Create: `app/projects/[projectId]/markdown/page.tsx`
- Create: `app/projects/[projectId]/markdown/MarkdownEditor.tsx`

**Interfaces:**
- Consumes: `DeepSeekClient` (Task 3), `readProjectFile`/`writeProjectFile`/`updateProjectStep` (Task 2)
- Produces: `convertToMarkdown(client, rawText, scriptType): Promise<string>`. 저장 파일 `narration.md` — Task 7(씬 분할)이 입력으로 사용.

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// lib/pipeline/convertMarkdown.test.ts
import { describe, it, expect } from "vitest";
import { MockDeepSeekClient } from "../ai/deepseekClient.mock";
import { convertToMarkdown } from "./convertMarkdown";

describe("convertToMarkdown", () => {
  it("converts script-type text and returns the AI response", async () => {
    const client = new MockDeepSeekClient(["# 변환된 나레이션\n\n안녕하세요."]);

    const result = await convertToMarkdown(client, "원본 원고 텍스트", "script");

    expect(result).toBe("# 변환된 나레이션\n\n안녕하세요.");
    expect(client.calls[0].messages[1].content).toContain("나레이션체로 변환");
  });

  it("reformats narration-type text without content changes in the prompt", async () => {
    const client = new MockDeepSeekClient(["# 나레이션\n\n원문 그대로."]);

    const result = await convertToMarkdown(client, "원문 나레이션", "narration");

    expect(result).toBe("# 나레이션\n\n원문 그대로.");
    expect(client.calls[0].messages[1].content).toContain("내용은 절대 수정하지 말고");
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm test -- convertMarkdown.test.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 구현**

```ts
// lib/pipeline/convertMarkdown.ts
import type { DeepSeekClient } from "../ai/deepseekClient";
import type { ScriptType } from "../projects/types";

export async function convertToMarkdown(
  client: DeepSeekClient,
  rawText: string,
  scriptType: ScriptType
): Promise<string> {
  if (scriptType === "narration") {
    const prompt = `다음 나레이션 텍스트의 내용은 절대 수정하지 말고, 형태만 읽기 좋은 마크다운 문서로 정리하세요. 문단 구분과 제목만 추가하세요.

텍스트:
"""
${rawText}
"""

마크다운 결과만 응답하세요.`;
    return client.complete([
      { role: "system", content: "당신은 문서 포맷팅 전문가입니다." },
      { role: "user", content: prompt },
    ]);
  }

  const prompt = `다음 원고를 이러닝 영상 나레이션체로 변환하고, 읽기 좋은 마크다운 문서로 작성하세요.

원고:
"""
${rawText}
"""

마크다운 결과만 응답하세요.`;
  return client.complete([
    { role: "system", content: "당신은 이러닝 나레이션 작성 전문가입니다." },
    { role: "user", content: prompt },
  ]);
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm test -- convertMarkdown.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: API Route (생성 + 저장)**

```ts
// app/api/projects/[projectId]/markdown/route.ts
import { NextRequest, NextResponse } from "next/server";
import { readProject, readProjectFile, writeProjectFile, updateProjectStep } from "@/lib/projects/store";
import { createDeepSeekClient } from "@/lib/ai/deepseekClient";
import { convertToMarkdown } from "@/lib/pipeline/convertMarkdown";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const project = await readProject(projectId);
  if (!project) return NextResponse.json({ error: "프로젝트를 찾을 수 없습니다" }, { status: 404 });

  const rawText = await readProjectFile(projectId, "extracted.txt");
  if (!rawText) return NextResponse.json({ error: "업로드된 원본 텍스트가 없습니다" }, { status: 400 });

  const client = createDeepSeekClient();
  const markdown = await convertToMarkdown(client, rawText, project.scriptType);

  await writeProjectFile(projectId, "narration.md", markdown);
  await updateProjectStep(projectId, "markdown");

  return NextResponse.json({ markdown });
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const { markdown } = (await req.json()) as { markdown: string };
  await writeProjectFile(projectId, "narration.md", markdown);
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 6: 페이지 (서버 컴포넌트 + 클라이언트 에디터)**

```tsx
// app/projects/[projectId]/markdown/page.tsx
import { readProjectFile } from "@/lib/projects/store";
import { MarkdownEditor } from "./MarkdownEditor";

export default async function MarkdownPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const existing = await readProjectFile(projectId, "narration.md");

  return (
    <main className="mx-auto max-w-3xl p-8">
      <h1 className="mb-4 text-2xl font-bold">1단계 — 마크다운 변환</h1>
      <MarkdownEditor projectId={projectId} initialMarkdown={existing} />
    </main>
  );
}
```

```tsx
// app/projects/[projectId]/markdown/MarkdownEditor.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export function MarkdownEditor({
  projectId,
  initialMarkdown,
}: {
  projectId: string;
  initialMarkdown: string | null;
}) {
  const router = useRouter();
  const [markdown, setMarkdown] = useState(initialMarkdown ?? "");
  const [loading, setLoading] = useState(false);

  async function handleGenerate() {
    setLoading(true);
    const res = await fetch(`/api/projects/${projectId}/markdown`, { method: "POST" });
    const data = await res.json();
    setLoading(false);
    if (res.ok) setMarkdown(data.markdown);
  }

  async function handleNext() {
    await fetch(`/api/projects/${projectId}/markdown`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ markdown }),
    });
    router.push(`/projects/${projectId}/scenes`);
  }

  return (
    <div className="space-y-4">
      <Button onClick={handleGenerate} disabled={loading}>
        {loading ? "변환 중..." : markdown ? "다시 생성" : "AI로 변환"}
      </Button>
      <Textarea
        rows={20}
        value={markdown}
        onChange={(e) => setMarkdown(e.target.value)}
        placeholder="변환 결과가 여기에 표시됩니다. 직접 수정할 수 있습니다."
      />
      <Button onClick={handleNext} disabled={!markdown}>
        다음 단계
      </Button>
    </div>
  );
}
```

- [ ] **Step 7: 수동 검증**

`DEEPSEEK_API_KEY`를 `.env.local`에 설정 후 `npm run dev` 실행. Task 5에서 만든 프로젝트로 `/projects/{id}/markdown` 접속 → "AI로 변환" 클릭 → 결과가 표시되고 편집 가능한지 확인 → "다음 단계" 클릭 시 `/projects/{id}/scenes`로 이동(Task 7 전까지 404 정상) → `data/projects/{id}/narration.md` 파일 생성 확인.

- [ ] **Step 8: 커밋**

```bash
git add lib/pipeline/convertMarkdown.ts lib/pipeline/convertMarkdown.test.ts app/api/projects/[projectId]/markdown app/projects/[projectId]/markdown
git commit -m "Add markdown conversion step with editable review UI"
```

---

### Task 7: 2단계 — 씬 분할

**Files:**
- Create: `lib/pipeline/splitScenes.ts`
- Create: `lib/pipeline/validateNarrationIntegrity.ts`
- Test: `lib/pipeline/splitScenes.test.ts`
- Test: `lib/pipeline/validateNarrationIntegrity.test.ts`
- Create: `app/api/projects/[projectId]/scenes/route.ts`
- Create: `app/projects/[projectId]/scenes/page.tsx`
- Create: `app/projects/[projectId]/scenes/SceneListEditor.tsx`

**Interfaces:**
- Consumes: `DeepSeekClient`, `narration.md` (Task 6)
- Produces:
  - `interface Scene { id: string; order: number; narrationText: string; estimatedDurationSec: number; splitReason: string }`
  - `splitScenes(client, narrationMarkdown): Promise<Scene[]>`
  - `validateNarrationIntegrity(originalText: string, sceneTexts: string[]): boolean`
  - 저장 파일 `scenes.json` — Task 8, 9, 10이 입력으로 사용.

- [ ] **Step 1: 원문 무결성 검증 함수 — 실패하는 테스트**

```ts
// lib/pipeline/validateNarrationIntegrity.test.ts
import { describe, it, expect } from "vitest";
import { validateNarrationIntegrity } from "./validateNarrationIntegrity";

describe("validateNarrationIntegrity", () => {
  it("returns true when scene texts reconstruct the original exactly", () => {
    const original = "안녕하세요. 오늘은 이러닝을 배웁니다.";
    const scenes = ["안녕하세요.", " 오늘은 이러닝을 배웁니다."];

    expect(validateNarrationIntegrity(original, scenes)).toBe(true);
  });

  it("ignores whitespace-only differences", () => {
    const original = "안녕하세요.\n오늘은 이러닝을 배웁니다.";
    const scenes = ["안녕하세요.", "오늘은 이러닝을 배웁니다."];

    expect(validateNarrationIntegrity(original, scenes)).toBe(true);
  });

  it("returns false when scene text changes the wording", () => {
    const original = "안녕하세요. 오늘은 이러닝을 배웁니다.";
    const scenes = ["안녕하십니까.", " 오늘은 이러닝을 배웁니다."];

    expect(validateNarrationIntegrity(original, scenes)).toBe(false);
  });

  it("returns false when a scene is missing content", () => {
    const original = "첫 문장. 둘째 문장. 셋째 문장.";
    const scenes = ["첫 문장.", " 둘째 문장."];

    expect(validateNarrationIntegrity(original, scenes)).toBe(false);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm test -- validateNarrationIntegrity.test.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 구현**

```ts
// lib/pipeline/validateNarrationIntegrity.ts
function normalize(text: string): string {
  return text.replace(/\s+/g, "");
}

export function validateNarrationIntegrity(originalText: string, sceneTexts: string[]): boolean {
  return normalize(sceneTexts.join("")) === normalize(originalText);
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm test -- validateNarrationIntegrity.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: 씬 분할 모듈 — 실패하는 테스트**

```ts
// lib/pipeline/splitScenes.test.ts
import { describe, it, expect } from "vitest";
import { MockDeepSeekClient } from "../ai/deepseekClient.mock";
import { splitScenes } from "./splitScenes";

const SAMPLE_RESPONSE = JSON.stringify({
  scenes: [
    { order: 1, narrationText: "안녕하세요.", estimatedDurationSec: 5, splitReason: "문장종결" },
    { order: 2, narrationText: " 오늘은 이러닝을 배웁니다.", estimatedDurationSec: 10, splitReason: "주제전환" },
  ],
});

describe("splitScenes", () => {
  it("assigns sequential scene ids to the AI-produced scenes", async () => {
    const client = new MockDeepSeekClient([SAMPLE_RESPONSE]);

    const scenes = await splitScenes(client, "안녕하세요. 오늘은 이러닝을 배웁니다.");

    expect(scenes).toHaveLength(2);
    expect(scenes[0].id).toBe("scene-001");
    expect(scenes[1].id).toBe("scene-002");
    expect(scenes[0].splitReason).toBe("문장종결");
  });

  it("requests json mode from the client", async () => {
    const client = new MockDeepSeekClient([SAMPLE_RESPONSE]);

    await splitScenes(client, "나레이션");

    expect(client.calls[0].options?.jsonMode).toBe(true);
  });
});
```

- [ ] **Step 6: 테스트 실패 확인**

Run: `npm test -- splitScenes.test.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 7: 구현**

```ts
// lib/pipeline/splitScenes.ts
import type { DeepSeekClient } from "../ai/deepseekClient";

export interface Scene {
  id: string;
  order: number;
  narrationText: string;
  estimatedDurationSec: number;
  splitReason: string;
}

const SCENE_LENGTH_GUIDE =
  "- 일반 화면: 8~20초\n- 강조 화면: 4~10초\n- 표/그래프 설명: 15~30초\n- 절차 애니메이션: 15~40초";

const SPLIT_CRITERIA =
  "문장종결, 주제전환, 설명 대상 변경, 화면 유형 변경, 열거 시작과 종료, 사례 또는 질문, 표/그래프 등장, 예상 재생시간";

export async function splitScenes(client: DeepSeekClient, narrationMarkdown: string): Promise<Scene[]> {
  const prompt = `다음 나레이션을 씬으로 분할하세요. 나레이션 문구는 절대 수정하지 말고 분절만 하세요.

씬 길이 기준:
${SCENE_LENGTH_GUIDE}

분할 기준: ${SPLIT_CRITERIA}

나레이션:
"""
${narrationMarkdown}
"""

JSON으로만 응답하세요: {"scenes": [{"order": number, "narrationText": string, "estimatedDurationSec": number, "splitReason": string}]}`;

  const raw = await client.complete(
    [
      { role: "system", content: "당신은 이러닝 스토리보드 제작을 돕는 씬 분할 전문가입니다." },
      { role: "user", content: prompt },
    ],
    { jsonMode: true }
  );

  const parsed = JSON.parse(raw) as { scenes: Array<Omit<Scene, "id">> };
  return parsed.scenes.map((scene, index) => ({
    id: `scene-${String(index + 1).padStart(3, "0")}`,
    ...scene,
  }));
}
```

- [ ] **Step 8: 테스트 통과 확인**

Run: `npm test -- splitScenes.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 9: API Route**

```ts
// app/api/projects/[projectId]/scenes/route.ts
import { NextRequest, NextResponse } from "next/server";
import { readProjectFile, writeProjectFile, updateProjectStep } from "@/lib/projects/store";
import { createDeepSeekClient } from "@/lib/ai/deepseekClient";
import { splitScenes } from "@/lib/pipeline/splitScenes";
import { validateNarrationIntegrity } from "@/lib/pipeline/validateNarrationIntegrity";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const narration = await readProjectFile(projectId, "narration.md");
  if (!narration) return NextResponse.json({ error: "나레이션 마크다운이 없습니다" }, { status: 400 });

  const client = createDeepSeekClient();
  const scenes = await splitScenes(client, narration);
  const integrityOk = validateNarrationIntegrity(
    narration,
    scenes.map((s) => s.narrationText)
  );

  await writeProjectFile(projectId, "scenes.json", JSON.stringify({ scenes }, null, 2));
  await updateProjectStep(projectId, "scenes");

  return NextResponse.json({ scenes, integrityOk });
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const { scenes } = await req.json();
  await writeProjectFile(projectId, "scenes.json", JSON.stringify({ scenes }, null, 2));
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 10: 페이지**

```tsx
// app/projects/[projectId]/scenes/page.tsx
import { readProjectFile } from "@/lib/projects/store";
import { SceneListEditor } from "./SceneListEditor";
import type { Scene } from "@/lib/pipeline/splitScenes";

export default async function ScenesPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const raw = await readProjectFile(projectId, "scenes.json");
  const initialScenes: Scene[] = raw ? JSON.parse(raw).scenes : [];

  return (
    <main className="mx-auto max-w-3xl p-8">
      <h1 className="mb-4 text-2xl font-bold">2단계 — 씬 분할</h1>
      <SceneListEditor projectId={projectId} initialScenes={initialScenes} />
    </main>
  );
}
```

```tsx
// app/projects/[projectId]/scenes/SceneListEditor.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Scene } from "@/lib/pipeline/splitScenes";

export function SceneListEditor({
  projectId,
  initialScenes,
}: {
  projectId: string;
  initialScenes: Scene[];
}) {
  const router = useRouter();
  const [scenes, setScenes] = useState<Scene[]>(initialScenes);
  const [loading, setLoading] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);

  async function handleGenerate() {
    setLoading(true);
    const res = await fetch(`/api/projects/${projectId}/scenes`, { method: "POST" });
    const data = await res.json();
    setLoading(false);
    if (res.ok) {
      setScenes(data.scenes);
      setWarning(data.integrityOk ? null : "AI가 나레이션 원문을 임의로 수정했을 수 있습니다. 확인해주세요.");
    }
  }

  function updateScene(index: number, patch: Partial<Scene>) {
    setScenes((prev) => prev.map((scene, i) => (i === index ? { ...scene, ...patch } : scene)));
  }

  async function handleNext() {
    await fetch(`/api/projects/${projectId}/scenes`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scenes }),
    });
    router.push(`/projects/${projectId}/screen-types`);
  }

  return (
    <div className="space-y-4">
      <Button onClick={handleGenerate} disabled={loading}>
        {loading ? "분할 중..." : scenes.length ? "다시 생성" : "AI로 씬 분할"}
      </Button>
      {warning && <p className="text-sm text-amber-600">{warning}</p>}
      <ul className="space-y-3">
        {scenes.map((scene, index) => (
          <li key={scene.id} className="rounded border p-3">
            <div className="mb-2 flex items-center gap-2 text-sm text-gray-500">
              <span>{scene.id}</span>
              <span>· 사유: {scene.splitReason}</span>
              <Input
                type="number"
                className="w-24"
                value={scene.estimatedDurationSec}
                onChange={(e) => updateScene(index, { estimatedDurationSec: Number(e.target.value) })}
              />
              <span>초</span>
            </div>
            <textarea
              className="w-full rounded border p-2"
              rows={2}
              value={scene.narrationText}
              onChange={(e) => updateScene(index, { narrationText: e.target.value })}
            />
          </li>
        ))}
      </ul>
      <Button onClick={handleNext} disabled={scenes.length === 0}>
        다음 단계
      </Button>
    </div>
  );
}
```

- [ ] **Step 11: 수동 검증**

`/projects/{id}/scenes` 접속 → "AI로 씬 분할" 클릭 → 씬 목록과 시간이 표시되는지, 편집이 반영되는지 확인 → `data/projects/{id}/scenes.json` 생성 확인.

- [ ] **Step 12: 커밋**

```bash
git add lib/pipeline/splitScenes.ts lib/pipeline/splitScenes.test.ts lib/pipeline/validateNarrationIntegrity.ts lib/pipeline/validateNarrationIntegrity.test.ts "app/api/projects/[projectId]/scenes" "app/projects/[projectId]/scenes"
git commit -m "Add scene-splitting step with narration integrity check"
```

---

### Task 8: 3단계 — 화면 유형 선정

**Files:**
- Create: `lib/pipeline/selectScreenTypes.ts`
- Test: `lib/pipeline/selectScreenTypes.test.ts`
- Create: `app/api/projects/[projectId]/screen-types/route.ts`
- Create: `app/projects/[projectId]/screen-types/page.tsx`
- Create: `app/projects/[projectId]/screen-types/ScreenTypeEditor.tsx`

**Interfaces:**
- Consumes: `DeepSeekClient`, `Scene[]` (Task 7)
- Produces: `interface ScreenTypeAssignment { screenType: string; recommendedLayout: string; rationale: string }`, `selectScreenTypes(client, scenes): Promise<Record<string, ScreenTypeAssignment>>`. 저장 파일 `screen-types.json` — Task 9, 10이 입력으로 사용.

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// lib/pipeline/selectScreenTypes.test.ts
import { describe, it, expect } from "vitest";
import { MockDeepSeekClient } from "../ai/deepseekClient.mock";
import { selectScreenTypes } from "./selectScreenTypes";
import type { Scene } from "./splitScenes";

const scenes: Scene[] = [
  { id: "scene-001", order: 1, narrationText: "정의를 설명합니다.", estimatedDurationSec: 10, splitReason: "문장종결" },
  { id: "scene-002", order: 2, narrationText: "표를 보여줍니다.", estimatedDurationSec: 20, splitReason: "표/그래프 등장" },
];

describe("selectScreenTypes", () => {
  it("maps each scene id to a screen type assignment", async () => {
    const client = new MockDeepSeekClient([
      JSON.stringify({ screenType: "텍스트 강조형", recommendedLayout: "중앙 텍스트", rationale: "정의 강조" }),
      JSON.stringify({ screenType: "표/그래프형", recommendedLayout: "전체 화면 표", rationale: "표 데이터 설명" }),
    ]);

    const result = await selectScreenTypes(client, scenes);

    expect(Object.keys(result)).toEqual(["scene-001", "scene-002"]);
    expect(result["scene-002"].screenType).toBe("표/그래프형");
  });

  it("includes neighboring scene context in the prompt", async () => {
    const client = new MockDeepSeekClient([
      JSON.stringify({ screenType: "텍스트 강조형", recommendedLayout: "중앙 텍스트", rationale: "정의 강조" }),
      JSON.stringify({ screenType: "표/그래프형", recommendedLayout: "전체 화면 표", rationale: "표 데이터 설명" }),
    ]);

    await selectScreenTypes(client, scenes);

    expect(client.calls[0].messages[1].content).toContain("표를 보여줍니다.");
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm test -- selectScreenTypes.test.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 구현**

```ts
// lib/pipeline/selectScreenTypes.ts
import type { DeepSeekClient } from "../ai/deepseekClient";
import type { Scene } from "./splitScenes";

export interface ScreenTypeAssignment {
  screenType: string;
  recommendedLayout: string;
  rationale: string;
}

const AVAILABLE_SCREEN_TYPES = ["텍스트 강조형", "이미지 설명형", "표/그래프형", "절차 애니메이션형", "인물 등장형"];

export async function selectScreenTypes(
  client: DeepSeekClient,
  scenes: Scene[]
): Promise<Record<string, ScreenTypeAssignment>> {
  const result: Record<string, ScreenTypeAssignment> = {};

  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    const prevScene = scenes[i - 1];
    const nextScene = scenes[i + 1];

    const prompt = `다음 씬에 어울리는 화면 유형을 선택하세요.

사용 가능한 화면 유형: ${AVAILABLE_SCREEN_TYPES.join(", ")}

이전 씬: ${prevScene?.narrationText ?? "(없음)"}
현재 씬: ${scene.narrationText}
다음 씬: ${nextScene?.narrationText ?? "(없음)"}

JSON으로만 응답하세요: {"screenType": string, "recommendedLayout": string, "rationale": string}`;

    const raw = await client.complete(
      [
        { role: "system", content: "당신은 이러닝 스토리보드 화면 설계 전문가입니다." },
        { role: "user", content: prompt },
      ],
      { jsonMode: true }
    );

    result[scene.id] = JSON.parse(raw) as ScreenTypeAssignment;
  }

  return result;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm test -- selectScreenTypes.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: API Route**

```ts
// app/api/projects/[projectId]/screen-types/route.ts
import { NextRequest, NextResponse } from "next/server";
import { readProjectFile, writeProjectFile, updateProjectStep } from "@/lib/projects/store";
import { createDeepSeekClient } from "@/lib/ai/deepseekClient";
import { selectScreenTypes } from "@/lib/pipeline/selectScreenTypes";
import type { Scene } from "@/lib/pipeline/splitScenes";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const raw = await readProjectFile(projectId, "scenes.json");
  if (!raw) return NextResponse.json({ error: "씬 데이터가 없습니다" }, { status: 400 });
  const scenes: Scene[] = JSON.parse(raw).scenes;

  const client = createDeepSeekClient();
  const screenTypes = await selectScreenTypes(client, scenes);

  await writeProjectFile(projectId, "screen-types.json", JSON.stringify({ screenTypes }, null, 2));
  await updateProjectStep(projectId, "screen-types");

  return NextResponse.json({ screenTypes });
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const { screenTypes } = await req.json();
  await writeProjectFile(projectId, "screen-types.json", JSON.stringify({ screenTypes }, null, 2));
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 6: 페이지**

```tsx
// app/projects/[projectId]/screen-types/page.tsx
import { readProjectFile } from "@/lib/projects/store";
import { ScreenTypeEditor } from "./ScreenTypeEditor";
import type { Scene } from "@/lib/pipeline/splitScenes";
import type { ScreenTypeAssignment } from "@/lib/pipeline/selectScreenTypes";

export default async function ScreenTypesPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const scenesRaw = await readProjectFile(projectId, "scenes.json");
  const scenes: Scene[] = scenesRaw ? JSON.parse(scenesRaw).scenes : [];

  const screenTypesRaw = await readProjectFile(projectId, "screen-types.json");
  const initialScreenTypes: Record<string, ScreenTypeAssignment> = screenTypesRaw
    ? JSON.parse(screenTypesRaw).screenTypes
    : {};

  return (
    <main className="mx-auto max-w-3xl p-8">
      <h1 className="mb-4 text-2xl font-bold">3단계 — 화면 유형 선정</h1>
      <ScreenTypeEditor projectId={projectId} scenes={scenes} initialScreenTypes={initialScreenTypes} />
    </main>
  );
}
```

```tsx
// app/projects/[projectId]/screen-types/ScreenTypeEditor.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Scene } from "@/lib/pipeline/splitScenes";
import type { ScreenTypeAssignment } from "@/lib/pipeline/selectScreenTypes";

export function ScreenTypeEditor({
  projectId,
  scenes,
  initialScreenTypes,
}: {
  projectId: string;
  scenes: Scene[];
  initialScreenTypes: Record<string, ScreenTypeAssignment>;
}) {
  const router = useRouter();
  const [screenTypes, setScreenTypes] = useState(initialScreenTypes);
  const [loading, setLoading] = useState(false);

  async function handleGenerate() {
    setLoading(true);
    const res = await fetch(`/api/projects/${projectId}/screen-types`, { method: "POST" });
    const data = await res.json();
    setLoading(false);
    if (res.ok) setScreenTypes(data.screenTypes);
  }

  function updateAssignment(sceneId: string, patch: Partial<ScreenTypeAssignment>) {
    setScreenTypes((prev) => ({ ...prev, [sceneId]: { ...prev[sceneId], ...patch } }));
  }

  async function handleNext() {
    await fetch(`/api/projects/${projectId}/screen-types`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ screenTypes }),
    });
    router.push(`/projects/${projectId}/visual-design`);
  }

  return (
    <div className="space-y-4">
      <Button onClick={handleGenerate} disabled={loading}>
        {loading ? "선정 중..." : Object.keys(screenTypes).length ? "다시 생성" : "AI로 화면 유형 선정"}
      </Button>
      <ul className="space-y-3">
        {scenes.map((scene) => {
          const assignment = screenTypes[scene.id];
          return (
            <li key={scene.id} className="rounded border p-3">
              <p className="mb-2 text-sm text-gray-500">{scene.id} — {scene.narrationText}</p>
              <Input
                className="mb-2"
                value={assignment?.screenType ?? ""}
                onChange={(e) => updateAssignment(scene.id, { screenType: e.target.value })}
                placeholder="화면 유형"
              />
              <Input
                value={assignment?.recommendedLayout ?? ""}
                onChange={(e) => updateAssignment(scene.id, { recommendedLayout: e.target.value })}
                placeholder="추천 레이아웃"
              />
              {assignment?.rationale && <p className="mt-1 text-xs text-gray-400">근거: {assignment.rationale}</p>}
            </li>
          );
        })}
      </ul>
      <Button onClick={handleNext} disabled={Object.keys(screenTypes).length === 0}>
        다음 단계
      </Button>
    </div>
  );
}
```

- [ ] **Step 7: 수동 검증**

`/projects/{id}/screen-types` 접속 → "AI로 화면 유형 선정" 클릭 → 씬별 화면 유형/레이아웃이 표시되고 수정 가능한지 확인 → `screen-types.json` 생성 확인.

- [ ] **Step 8: 커밋**

```bash
git add lib/pipeline/selectScreenTypes.ts lib/pipeline/selectScreenTypes.test.ts "app/api/projects/[projectId]/screen-types" "app/projects/[projectId]/screen-types"
git commit -m "Add screen-type selection step"
```

---

### Task 9: 4단계 — 비주얼 설계

**Files:**
- Create: `lib/pipeline/designVisuals.ts`
- Test: `lib/pipeline/designVisuals.test.ts`
- Create: `app/api/projects/[projectId]/visual-design/route.ts`
- Create: `app/projects/[projectId]/visual-design/page.tsx`
- Create: `app/projects/[projectId]/visual-design/VisualDesignEditor.tsx`

**Interfaces:**
- Consumes: `DeepSeekClient`, `Scene[]` (Task 7), `Record<string, ScreenTypeAssignment>` (Task 8)
- Produces: `interface VisualDesign { caption; keywords; imageOrDiagramDescription; objectPlacement; appearanceOrder; productionNotes }`, `designVisuals(client, scenes, screenTypes, designGuide?): Promise<Record<string, VisualDesign>>`. 저장 파일 `visual-design.json` — Task 10, 11이 입력으로 사용.

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// lib/pipeline/designVisuals.test.ts
import { describe, it, expect } from "vitest";
import { MockDeepSeekClient } from "../ai/deepseekClient.mock";
import { designVisuals } from "./designVisuals";
import type { Scene } from "./splitScenes";
import type { ScreenTypeAssignment } from "./selectScreenTypes";

const scenes: Scene[] = [
  { id: "scene-001", order: 1, narrationText: "정의를 설명합니다.", estimatedDurationSec: 10, splitReason: "문장종결" },
];
const screenTypes: Record<string, ScreenTypeAssignment> = {
  "scene-001": { screenType: "텍스트 강조형", recommendedLayout: "중앙 텍스트", rationale: "정의 강조" },
};

describe("designVisuals", () => {
  it("maps each scene id to a visual design", async () => {
    const client = new MockDeepSeekClient([
      JSON.stringify({
        caption: "핵심 정의",
        keywords: ["정의"],
        imageOrDiagramDescription: "중앙에 큰 텍스트",
        objectPlacement: "중앙",
        appearanceOrder: ["제목", "본문"],
        productionNotes: "폰트 크게",
      }),
    ]);

    const result = await designVisuals(client, scenes, screenTypes);

    expect(result["scene-001"].caption).toBe("핵심 정의");
    expect(result["scene-001"].keywords).toEqual(["정의"]);
  });

  it("includes the screen type and layout in the prompt", async () => {
    const client = new MockDeepSeekClient([
      JSON.stringify({
        caption: "핵심 정의",
        keywords: ["정의"],
        imageOrDiagramDescription: "중앙에 큰 텍스트",
        objectPlacement: "중앙",
        appearanceOrder: ["제목", "본문"],
        productionNotes: "폰트 크게",
      }),
    ]);

    await designVisuals(client, scenes, screenTypes);

    expect(client.calls[0].messages[1].content).toContain("텍스트 강조형");
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm test -- designVisuals.test.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 구현**

```ts
// lib/pipeline/designVisuals.ts
import type { DeepSeekClient } from "../ai/deepseekClient";
import type { Scene } from "./splitScenes";
import type { ScreenTypeAssignment } from "./selectScreenTypes";

export interface VisualDesign {
  caption: string;
  keywords: string[];
  imageOrDiagramDescription: string;
  objectPlacement: string;
  appearanceOrder: string[];
  productionNotes: string;
}

export interface DesignGuide {
  toneAndManner: string;
  colorPalette: string;
}

const DEFAULT_DESIGN_GUIDE: DesignGuide = {
  toneAndManner: "차분하고 신뢰감 있는 톤",
  colorPalette: "네이비/화이트 기본, 포인트 컬러 블루",
};

export async function designVisuals(
  client: DeepSeekClient,
  scenes: Scene[],
  screenTypes: Record<string, ScreenTypeAssignment>,
  designGuide: DesignGuide = DEFAULT_DESIGN_GUIDE
): Promise<Record<string, VisualDesign>> {
  const result: Record<string, VisualDesign> = {};

  for (const scene of scenes) {
    const screenType = screenTypes[scene.id];
    const prompt = `다음 씬의 비주얼을 설계하세요.

나레이션: ${scene.narrationText}
화면 유형: ${screenType?.screenType ?? "미지정"}
레이아웃: ${screenType?.recommendedLayout ?? "미지정"}
디자인 가이드: 톤앤매너 - ${designGuide.toneAndManner}, 컬러 - ${designGuide.colorPalette}

JSON으로만 응답하세요: {"caption": string, "keywords": string[], "imageOrDiagramDescription": string, "objectPlacement": string, "appearanceOrder": string[], "productionNotes": string}`;

    const raw = await client.complete(
      [
        { role: "system", content: "당신은 이러닝 스토리보드 비주얼 디자이너입니다." },
        { role: "user", content: prompt },
      ],
      { jsonMode: true }
    );

    result[scene.id] = JSON.parse(raw) as VisualDesign;
  }

  return result;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm test -- designVisuals.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: API Route**

```ts
// app/api/projects/[projectId]/visual-design/route.ts
import { NextRequest, NextResponse } from "next/server";
import { readProjectFile, writeProjectFile, updateProjectStep } from "@/lib/projects/store";
import { createDeepSeekClient } from "@/lib/ai/deepseekClient";
import { designVisuals } from "@/lib/pipeline/designVisuals";
import type { Scene } from "@/lib/pipeline/splitScenes";
import type { ScreenTypeAssignment } from "@/lib/pipeline/selectScreenTypes";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const scenesRaw = await readProjectFile(projectId, "scenes.json");
  const screenTypesRaw = await readProjectFile(projectId, "screen-types.json");
  if (!scenesRaw || !screenTypesRaw) {
    return NextResponse.json({ error: "씬 또는 화면 유형 데이터가 없습니다" }, { status: 400 });
  }
  const scenes: Scene[] = JSON.parse(scenesRaw).scenes;
  const screenTypes: Record<string, ScreenTypeAssignment> = JSON.parse(screenTypesRaw).screenTypes;

  const client = createDeepSeekClient();
  const visualDesigns = await designVisuals(client, scenes, screenTypes);

  await writeProjectFile(projectId, "visual-design.json", JSON.stringify({ visualDesigns }, null, 2));
  await updateProjectStep(projectId, "visual-design");

  return NextResponse.json({ visualDesigns });
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const { visualDesigns } = await req.json();
  await writeProjectFile(projectId, "visual-design.json", JSON.stringify({ visualDesigns }, null, 2));
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 6: 페이지**

```tsx
// app/projects/[projectId]/visual-design/page.tsx
import { readProjectFile } from "@/lib/projects/store";
import { VisualDesignEditor } from "./VisualDesignEditor";
import type { Scene } from "@/lib/pipeline/splitScenes";
import type { VisualDesign } from "@/lib/pipeline/designVisuals";

export default async function VisualDesignPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const scenesRaw = await readProjectFile(projectId, "scenes.json");
  const scenes: Scene[] = scenesRaw ? JSON.parse(scenesRaw).scenes : [];

  const visualDesignRaw = await readProjectFile(projectId, "visual-design.json");
  const initialDesigns: Record<string, VisualDesign> = visualDesignRaw
    ? JSON.parse(visualDesignRaw).visualDesigns
    : {};

  return (
    <main className="mx-auto max-w-3xl p-8">
      <h1 className="mb-4 text-2xl font-bold">4단계 — 비주얼 설계</h1>
      <VisualDesignEditor projectId={projectId} scenes={scenes} initialDesigns={initialDesigns} />
    </main>
  );
}
```

```tsx
// app/projects/[projectId]/visual-design/VisualDesignEditor.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { Scene } from "@/lib/pipeline/splitScenes";
import type { VisualDesign } from "@/lib/pipeline/designVisuals";

export function VisualDesignEditor({
  projectId,
  scenes,
  initialDesigns,
}: {
  projectId: string;
  scenes: Scene[];
  initialDesigns: Record<string, VisualDesign>;
}) {
  const router = useRouter();
  const [designs, setDesigns] = useState(initialDesigns);
  const [loading, setLoading] = useState(false);

  async function handleGenerate() {
    setLoading(true);
    const res = await fetch(`/api/projects/${projectId}/visual-design`, { method: "POST" });
    const data = await res.json();
    setLoading(false);
    if (res.ok) setDesigns(data.visualDesigns);
  }

  function updateDesign(sceneId: string, patch: Partial<VisualDesign>) {
    setDesigns((prev) => ({ ...prev, [sceneId]: { ...prev[sceneId], ...patch } }));
  }

  async function handleNext() {
    await fetch(`/api/projects/${projectId}/visual-design`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ visualDesigns: designs }),
    });
    router.push(`/projects/${projectId}/review`);
  }

  return (
    <div className="space-y-4">
      <Button onClick={handleGenerate} disabled={loading}>
        {loading ? "설계 중..." : Object.keys(designs).length ? "다시 생성" : "AI로 비주얼 설계"}
      </Button>
      <div className="space-y-4">
        {scenes.map((scene) => {
          const design = designs[scene.id];
          return (
            <Card key={scene.id} className="space-y-2 p-4">
              <div className="rounded bg-gray-50 p-3 text-sm">
                <p className="font-medium">화면 자막: {design?.caption ?? "-"}</p>
                <p>핵심 키워드: {design?.keywords?.join(", ") ?? "-"}</p>
                <p>이미지/도식 설명: {design?.imageOrDiagramDescription ?? "-"}</p>
                <p>객체 배치: {design?.objectPlacement ?? "-"}</p>
                <p>등장 순서: {design?.appearanceOrder?.join(" → ") ?? "-"}</p>
                <Input
                  className="mt-2"
                  value={design?.productionNotes ?? ""}
                  onChange={(e) => updateDesign(scene.id, { productionNotes: e.target.value })}
                  placeholder="제작 지시"
                />
              </div>
              <p className="border-t pt-2 text-sm text-gray-600">{scene.narrationText}</p>
            </Card>
          );
        })}
      </div>
      <Button onClick={handleNext} disabled={Object.keys(designs).length === 0}>
        다음 단계
      </Button>
    </div>
  );
}
```

- [ ] **Step 7: 수동 검증**

`/projects/{id}/visual-design` 접속 → "AI로 비주얼 설계" 클릭 → 씬별 카드에 화면 설계(상단) + 나레이션(하단)이 전통적 스토리보드 형태로 표시되는지 확인 → `visual-design.json` 생성 확인.

- [ ] **Step 8: 커밋**

```bash
git add lib/pipeline/designVisuals.ts lib/pipeline/designVisuals.test.ts "app/api/projects/[projectId]/visual-design" "app/projects/[projectId]/visual-design"
git commit -m "Add visual design step with storyboard-style card editor"
```

---

### Task 10: 5단계 — 일관성 검수

**Files:**
- Create: `lib/pipeline/reviewConsistency.ts`
- Test: `lib/pipeline/reviewConsistency.test.ts`
- Create: `app/api/projects/[projectId]/review/route.ts`
- Create: `app/projects/[projectId]/review/page.tsx`
- Create: `app/projects/[projectId]/review/ReviewIssueList.tsx`

**Interfaces:**
- Consumes: `DeepSeekClient`, `Scene[]`, `Record<string, ScreenTypeAssignment>`, `Record<string, VisualDesign>`
- Produces: `interface ReviewIssue { id; type; severity: "info"|"warning"|"error"; sceneIds: string[]; message }`, `checkDuplicateLayouts`, `checkOverlongNarration`, `checkSceneNumbering` (결정적, 유닛 테스트 대상), `reviewSemanticConsistency` (AI 호출), `reviewConsistency` (통합). 저장 파일 `review.json` — Task 11이 표시에 사용.

- [ ] **Step 1: 결정적 검사 함수 — 실패하는 테스트**

```ts
// lib/pipeline/reviewConsistency.test.ts
import { describe, it, expect } from "vitest";
import { MockDeepSeekClient } from "../ai/deepseekClient.mock";
import {
  checkDuplicateLayouts,
  checkOverlongNarration,
  checkSceneNumbering,
  reviewSemanticConsistency,
} from "./reviewConsistency";
import type { Scene } from "./splitScenes";
import type { ScreenTypeAssignment } from "./selectScreenTypes";
import type { VisualDesign } from "./designVisuals";

function makeScene(id: string, order: number, durationSec = 10): Scene {
  return { id, order, narrationText: `${id} 나레이션`, estimatedDurationSec: durationSec, splitReason: "문장종결" };
}

describe("checkDuplicateLayouts", () => {
  it("flags three or more consecutive scenes with the same layout", () => {
    const scenes = [makeScene("scene-001", 1), makeScene("scene-002", 2), makeScene("scene-003", 3)];
    const screenTypes: Record<string, ScreenTypeAssignment> = {
      "scene-001": { screenType: "텍스트 강조형", recommendedLayout: "중앙 텍스트", rationale: "" },
      "scene-002": { screenType: "텍스트 강조형", recommendedLayout: "중앙 텍스트", rationale: "" },
      "scene-003": { screenType: "텍스트 강조형", recommendedLayout: "중앙 텍스트", rationale: "" },
    };

    const issues = checkDuplicateLayouts(scenes, screenTypes);

    expect(issues).toHaveLength(1);
    expect(issues[0].type).toBe("duplicate-layout");
    expect(issues[0].sceneIds).toEqual(["scene-001", "scene-002", "scene-003"]);
  });

  it("does not flag two consecutive repeats", () => {
    const scenes = [makeScene("scene-001", 1), makeScene("scene-002", 2)];
    const screenTypes: Record<string, ScreenTypeAssignment> = {
      "scene-001": { screenType: "텍스트 강조형", recommendedLayout: "중앙 텍스트", rationale: "" },
      "scene-002": { screenType: "텍스트 강조형", recommendedLayout: "중앙 텍스트", rationale: "" },
    };

    expect(checkDuplicateLayouts(scenes, screenTypes)).toHaveLength(0);
  });
});

describe("checkOverlongNarration", () => {
  it("flags scenes exceeding 40 seconds", () => {
    const scenes = [makeScene("scene-001", 1, 45)];

    const issues = checkOverlongNarration(scenes);

    expect(issues).toHaveLength(1);
    expect(issues[0].type).toBe("overlong-narration");
  });

  it("does not flag scenes within the limit", () => {
    const scenes = [makeScene("scene-001", 1, 30)];
    expect(checkOverlongNarration(scenes)).toHaveLength(0);
  });
});

describe("checkSceneNumbering", () => {
  it("flags gaps in scene ordering", () => {
    const scenes = [makeScene("scene-001", 1), makeScene("scene-002", 3)];

    const issues = checkSceneNumbering(scenes);

    expect(issues).toHaveLength(1);
    expect(issues[0].type).toBe("numbering-gap");
  });

  it("passes sequential ordering", () => {
    const scenes = [makeScene("scene-001", 1), makeScene("scene-002", 2)];
    expect(checkSceneNumbering(scenes)).toHaveLength(0);
  });
});

describe("reviewSemanticConsistency", () => {
  it("parses AI-reported issues", async () => {
    const client = new MockDeepSeekClient([
      JSON.stringify({
        issues: [
          { type: "terminology", severity: "warning", sceneIds: ["scene-001"], message: "용어 불일치" },
        ],
      }),
    ]);
    const scenes = [makeScene("scene-001", 1)];
    const designs: Record<string, VisualDesign> = {
      "scene-001": {
        caption: "자막",
        keywords: [],
        imageOrDiagramDescription: "",
        objectPlacement: "",
        appearanceOrder: [],
        productionNotes: "",
      },
    };

    const issues = await reviewSemanticConsistency(client, scenes, designs);

    expect(issues).toHaveLength(1);
    expect(issues[0].id).toBe("semantic-1");
    expect(issues[0].type).toBe("terminology");
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm test -- reviewConsistency.test.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 구현**

```ts
// lib/pipeline/reviewConsistency.ts
import type { DeepSeekClient } from "../ai/deepseekClient";
import type { Scene } from "./splitScenes";
import type { ScreenTypeAssignment } from "./selectScreenTypes";
import type { VisualDesign } from "./designVisuals";

export interface ReviewIssue {
  id: string;
  type: string;
  severity: "info" | "warning" | "error";
  sceneIds: string[];
  message: string;
}

const MAX_REASONABLE_DURATION_SEC = 40;
const REPEATED_LAYOUT_THRESHOLD = 3;

export function checkDuplicateLayouts(
  scenes: Scene[],
  screenTypes: Record<string, ScreenTypeAssignment>
): ReviewIssue[] {
  const issues: ReviewIssue[] = [];
  let streak: string[] = [];
  let streakLayout: string | null = null;

  function flushStreak() {
    if (streak.length >= REPEATED_LAYOUT_THRESHOLD) {
      issues.push({
        id: `dup-layout-${streak[0]}`,
        type: "duplicate-layout",
        severity: "warning",
        sceneIds: [...streak],
        message: `동일한 레이아웃(${streakLayout})이 ${streak.length}개 씬 연속 반복됩니다`,
      });
    }
  }

  for (const scene of scenes) {
    const layout = screenTypes[scene.id]?.recommendedLayout ?? "";
    if (layout && layout === streakLayout) {
      streak.push(scene.id);
    } else {
      flushStreak();
      streak = layout ? [scene.id] : [];
      streakLayout = layout || null;
    }
  }
  flushStreak();

  return issues;
}

export function checkOverlongNarration(scenes: Scene[]): ReviewIssue[] {
  return scenes
    .filter((scene) => scene.estimatedDurationSec > MAX_REASONABLE_DURATION_SEC)
    .map((scene) => ({
      id: `overlong-${scene.id}`,
      type: "overlong-narration",
      severity: "warning" as const,
      sceneIds: [scene.id],
      message: `예상 재생시간(${scene.estimatedDurationSec}초)이 권장 최대치(${MAX_REASONABLE_DURATION_SEC}초)를 초과합니다`,
    }));
}

export function checkSceneNumbering(scenes: Scene[]): ReviewIssue[] {
  const issues: ReviewIssue[] = [];
  const sorted = [...scenes].sort((a, b) => a.order - b.order);
  sorted.forEach((scene, index) => {
    const expectedOrder = index + 1;
    if (scene.order !== expectedOrder) {
      issues.push({
        id: `numbering-${scene.id}`,
        type: "numbering-gap",
        severity: "error",
        sceneIds: [scene.id],
        message: `씬 번호가 순차적이지 않습니다 (기대값: ${expectedOrder}, 실제값: ${scene.order})`,
      });
    }
  });
  return issues;
}

export async function reviewSemanticConsistency(
  client: DeepSeekClient,
  scenes: Scene[],
  visualDesigns: Record<string, VisualDesign>
): Promise<ReviewIssue[]> {
  const summary = scenes.map((scene) => ({
    sceneId: scene.id,
    narrationText: scene.narrationText,
    caption: visualDesigns[scene.id]?.caption ?? "",
    keywords: visualDesigns[scene.id]?.keywords ?? [],
  }));

  const prompt = `다음은 이러닝 스토리보드의 씬별 나레이션과 화면 정보입니다. 아래 항목을 점검하고 이슈를 찾아주세요:
- 용어 통일 (같은 개념에 다른 용어 사용)
- 나레이션과 화면 불일치
- 학습 목표 누락

데이터:
${JSON.stringify(summary, null, 2)}

JSON으로만 응답하세요: {"issues": [{"type": string, "severity": "info"|"warning"|"error", "sceneIds": string[], "message": string}]}`;

  const raw = await client.complete(
    [
      { role: "system", content: "당신은 이러닝 스토리보드 품질 검수 전문가입니다." },
      { role: "user", content: prompt },
    ],
    { jsonMode: true }
  );

  const parsed = JSON.parse(raw) as { issues: Array<Omit<ReviewIssue, "id">> };
  return parsed.issues.map((issue, index) => ({
    id: `semantic-${index + 1}`,
    ...issue,
  }));
}

export async function reviewConsistency(
  client: DeepSeekClient,
  scenes: Scene[],
  screenTypes: Record<string, ScreenTypeAssignment>,
  visualDesigns: Record<string, VisualDesign>
): Promise<ReviewIssue[]> {
  const deterministic = [
    ...checkDuplicateLayouts(scenes, screenTypes),
    ...checkOverlongNarration(scenes),
    ...checkSceneNumbering(scenes),
  ];
  const semantic = await reviewSemanticConsistency(client, scenes, visualDesigns);
  return [...deterministic, ...semantic];
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm test -- reviewConsistency.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: API Route**

```ts
// app/api/projects/[projectId]/review/route.ts
import { NextRequest, NextResponse } from "next/server";
import { readProjectFile, writeProjectFile, updateProjectStep } from "@/lib/projects/store";
import { createDeepSeekClient } from "@/lib/ai/deepseekClient";
import { reviewConsistency } from "@/lib/pipeline/reviewConsistency";
import type { Scene } from "@/lib/pipeline/splitScenes";
import type { ScreenTypeAssignment } from "@/lib/pipeline/selectScreenTypes";
import type { VisualDesign } from "@/lib/pipeline/designVisuals";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const scenesRaw = await readProjectFile(projectId, "scenes.json");
  const screenTypesRaw = await readProjectFile(projectId, "screen-types.json");
  const visualDesignRaw = await readProjectFile(projectId, "visual-design.json");
  if (!scenesRaw || !screenTypesRaw || !visualDesignRaw) {
    return NextResponse.json({ error: "이전 단계 데이터가 모두 필요합니다" }, { status: 400 });
  }

  const scenes: Scene[] = JSON.parse(scenesRaw).scenes;
  const screenTypes: Record<string, ScreenTypeAssignment> = JSON.parse(screenTypesRaw).screenTypes;
  const visualDesigns: Record<string, VisualDesign> = JSON.parse(visualDesignRaw).visualDesigns;

  const client = createDeepSeekClient();
  const issues = await reviewConsistency(client, scenes, screenTypes, visualDesigns);

  await writeProjectFile(projectId, "review.json", JSON.stringify({ issues }, null, 2));
  await updateProjectStep(projectId, "review");

  return NextResponse.json({ issues });
}
```

- [ ] **Step 6: 페이지**

```tsx
// app/projects/[projectId]/review/page.tsx
import { readProjectFile } from "@/lib/projects/store";
import { ReviewIssueList } from "./ReviewIssueList";
import type { ReviewIssue } from "@/lib/pipeline/reviewConsistency";

export default async function ReviewPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const raw = await readProjectFile(projectId, "review.json");
  const initialIssues: ReviewIssue[] = raw ? JSON.parse(raw).issues : [];

  return (
    <main className="mx-auto max-w-3xl p-8">
      <h1 className="mb-4 text-2xl font-bold">5단계 — 일관성 검수</h1>
      <ReviewIssueList projectId={projectId} initialIssues={initialIssues} />
    </main>
  );
}
```

```tsx
// app/projects/[projectId]/review/ReviewIssueList.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { ReviewIssue } from "@/lib/pipeline/reviewConsistency";

export function ReviewIssueList({
  projectId,
  initialIssues,
}: {
  projectId: string;
  initialIssues: ReviewIssue[];
}) {
  const router = useRouter();
  const [issues, setIssues] = useState<ReviewIssue[]>(initialIssues);
  const [loading, setLoading] = useState(false);

  async function handleGenerate() {
    setLoading(true);
    const res = await fetch(`/api/projects/${projectId}/review`, { method: "POST" });
    const data = await res.json();
    setLoading(false);
    if (res.ok) setIssues(data.issues);
  }

  return (
    <div className="space-y-4">
      <Button onClick={handleGenerate} disabled={loading}>
        {loading ? "검수 중..." : "일관성 검수 실행"}
      </Button>
      {issues.length === 0 ? (
        <p className="text-gray-500">발견된 이슈가 없습니다.</p>
      ) : (
        <ul className="space-y-2">
          {issues.map((issue) => (
            <li key={issue.id} className="rounded border p-3">
              <div className="mb-1 flex items-center gap-2">
                <Badge variant={issue.severity === "error" ? "destructive" : "secondary"}>{issue.severity}</Badge>
                <span className="text-sm font-medium">{issue.type}</span>
              </div>
              <p className="text-sm">{issue.message}</p>
              <div className="mt-1 flex gap-2 text-xs">
                {issue.sceneIds.map((sceneId) => (
                  <Link
                    key={sceneId}
                    href={`/projects/${projectId}/visual-design#${sceneId}`}
                    className="text-blue-600 hover:underline"
                  >
                    {sceneId} 수정하러 가기
                  </Link>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
      <Button onClick={() => router.push(`/projects/${projectId}/storyboard`)}>최종 스토리보드 보기</Button>
    </div>
  );
}
```

- [ ] **Step 7: 수동 검증**

`/projects/{id}/review` 접속 → "일관성 검수 실행" 클릭 → 이슈 목록(심각도 배지 + 메시지 + 해당 씬 링크)이 표시되는지 확인 → `review.json` 생성 확인.

- [ ] **Step 8: 커밋**

```bash
git add lib/pipeline/reviewConsistency.ts lib/pipeline/reviewConsistency.test.ts "app/api/projects/[projectId]/review" "app/projects/[projectId]/review"
git commit -m "Add consistency review step combining rule-based and AI checks"
```

---

### Task 11: 6단계 — 최종 스토리보드 뷰

**Files:**
- Create: `app/projects/[projectId]/storyboard/page.tsx`

**Interfaces:**
- Consumes: `scenes.json`, `screen-types.json`, `visual-design.json` (모두 읽기 전용 조합)
- Produces: 읽기 전용 스토리보드 페이지. 별도 저장 파일 없음.

- [ ] **Step 1: 페이지 구현**

```tsx
// app/projects/[projectId]/storyboard/page.tsx
import { readProjectFile } from "@/lib/projects/store";
import type { Scene } from "@/lib/pipeline/splitScenes";
import type { ScreenTypeAssignment } from "@/lib/pipeline/selectScreenTypes";
import type { VisualDesign } from "@/lib/pipeline/designVisuals";

export default async function StoryboardPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const scenesRaw = await readProjectFile(projectId, "scenes.json");
  const screenTypesRaw = await readProjectFile(projectId, "screen-types.json");
  const visualDesignRaw = await readProjectFile(projectId, "visual-design.json");

  const scenes: Scene[] = scenesRaw ? JSON.parse(scenesRaw).scenes : [];
  const screenTypes: Record<string, ScreenTypeAssignment> = screenTypesRaw
    ? JSON.parse(screenTypesRaw).screenTypes
    : {};
  const visualDesigns: Record<string, VisualDesign> = visualDesignRaw
    ? JSON.parse(visualDesignRaw).visualDesigns
    : {};

  return (
    <main className="mx-auto max-w-3xl p-8">
      <h1 className="mb-6 text-2xl font-bold">최종 스토리보드</h1>
      <div className="space-y-6">
        {scenes.map((scene) => {
          const screenType = screenTypes[scene.id];
          const design = visualDesigns[scene.id];
          return (
            <section key={scene.id} id={scene.id} className="rounded border">
              <div className="border-b bg-gray-50 p-4">
                <p className="text-xs text-gray-500">
                  {scene.id} · {screenType?.screenType ?? "미지정"} · {scene.estimatedDurationSec}초
                </p>
                <p className="font-medium">{design?.caption ?? "(자막 없음)"}</p>
                <p className="text-sm text-gray-600">{design?.imageOrDiagramDescription}</p>
                <p className="text-sm text-gray-600">배치: {design?.objectPlacement}</p>
              </div>
              <div className="p-4 text-sm">{scene.narrationText}</div>
            </section>
          );
        })}
        {scenes.length === 0 && <p className="text-gray-500">아직 씬 데이터가 없습니다.</p>}
      </div>
    </main>
  );
}
```

- [ ] **Step 2: 수동 검증**

`/projects/{id}/storyboard` 접속 → 각 씬이 "상단 화면 설계 + 하단 나레이션" 형태로 순서대로 표시되는지 확인.

- [ ] **Step 3: 커밋**

```bash
git add "app/projects/[projectId]/storyboard"
git commit -m "Add read-only final storyboard view"
```

---

### Task 12: 마법사 내비게이션 셸

**Files:**
- Create: `app/projects/[projectId]/layout.tsx`

**Interfaces:**
- Consumes: `readProject` (Task 2)
- Produces: 모든 단계 페이지를 감싸는 공통 스텝 내비게이션 레이아웃.

- [ ] **Step 1: 구현**

```tsx
// app/projects/[projectId]/layout.tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { readProject } from "@/lib/projects/store";

const STEPS = [
  { key: "markdown", label: "1. 마크다운" },
  { key: "scenes", label: "2. 씬 분할" },
  { key: "screen-types", label: "3. 화면 유형" },
  { key: "visual-design", label: "4. 비주얼 설계" },
  { key: "review", label: "5. 일관성 검수" },
  { key: "storyboard", label: "6. 최종 뷰" },
] as const;

export default async function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const project = await readProject(projectId);
  if (!project) notFound();

  return (
    <div>
      <nav className="border-b bg-white">
        <div className="mx-auto flex max-w-3xl items-center gap-4 overflow-x-auto p-4 text-sm">
          <Link href="/" className="font-medium text-gray-500 hover:underline">
            ← {project.title}
          </Link>
          {STEPS.map((step) => (
            <Link
              key={step.key}
              href={`/projects/${projectId}/${step.key}`}
              className="whitespace-nowrap text-gray-700 hover:underline"
            >
              {step.label}
            </Link>
          ))}
        </div>
      </nav>
      {children}
    </div>
  );
}
```

- [ ] **Step 2: 수동 검증**

각 단계 페이지 상단에 내비게이션 바가 표시되고, 단계 간 이동이 되는지 확인. 존재하지 않는 프로젝트 id로 접속 시 404가 뜨는지 확인.

- [ ] **Step 3: 커밋**

```bash
git add "app/projects/[projectId]/layout.tsx"
git commit -m "Add wizard navigation shell across pipeline steps"
```

---

### Task 13: 종단 간 수동 검증 & 문서 마무리

**Files:**
- Create: `README.md`
- Modify: `CLAUDE.md` (구현 완료 상태로 갱신)

**Interfaces:**
- Consumes: 전체 파이프라인
- Produces: 없음 (검증 및 문서화 태스크)

- [ ] **Step 1: README 작성**

```markdown
# aid-three — 이러닝 스토리보드 제작 지원 도구

## 시작하기

\`\`\`bash
npm install
cp .env.example .env.local   # DEEPSEEK_API_KEY 입력
npm run dev
\`\`\`

http://localhost:3000 접속

## 테스트

\`\`\`bash
npm test
\`\`\`

## 문서

- [설계 문서](docs/superpowers/specs/2026-07-27-elearning-storyboard-generator-design.md)
- [구현 계획](docs/superpowers/plans/2026-07-28-elearning-storyboard-generator.md)
- [파이프라인 단계별 입출력 명세](docs/reference/pipeline-steps.md)
- [DeepSeek API 레퍼런스](docs/reference/deepseek-api.md)
```

- [ ] **Step 2: 실제 pdf 파일로 전체 흐름 수동 검증**

1. `npm run dev` 실행
2. 실제 이러닝 원고 pdf(또는 txt) 파일로 새 프로젝트 생성 (`/projects/new`)
3. 1단계(마크다운 변환) → 2단계(씬 분할, 원문 무결성 경고 없는지 확인) → 3단계(화면 유형) → 4단계(비주얼 설계) → 5단계(일관성 검수) → 6단계(최종 뷰) 순서로 끝까지 진행
4. 각 단계에서 수정한 내용이 다음 단계 진입 후에도 유지되는지 확인 (파일 재조회)
5. 홈 화면에서 `currentStep`이 마지막 단계까지 갱신되는지 확인

- [ ] **Step 3: 전체 자동 테스트 실행**

Run: `npm test`
Expected: 모든 유닛 테스트 PASS

- [ ] **Step 4: CLAUDE.md 갱신**

`CLAUDE.md`의 "현재 상태" 섹션을 아래 내용으로 교체한다:

```markdown
## 현재 상태

- 2026-07-28: v1 파이프라인(업로드 ~ 최종 스토리보드 뷰) 구현 완료, 수동 검증 통과.
- 다음 단계 후보(v1 범위 밖, 필요 시 새 스펙으로 브레인스토밍): pptx 템플릿 내보내기, AI 이미지 초안 생성.
```

- [ ] **Step 5: 커밋**

```bash
git add README.md CLAUDE.md
git commit -m "Add README and update project status after v1 pipeline completion"
```
