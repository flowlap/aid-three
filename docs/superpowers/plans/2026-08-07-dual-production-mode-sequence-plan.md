# 씬·시퀀스 이중 제작 모드 Implementation Plan

> **For Claude Code:** Implement this plan one task at a time. Before editing, read `CLAUDE.md` and `docs/PROJECT_OVERVIEW.md`. Keep the worktree clean between tasks, run the task's focused tests first, and run `npm test`, `npm run lint`, and `npx tsc --noEmit` before declaring the implementation complete.

**Goal:** Keep the current scene-based storyboard workflow intact while adding an opt-in sequence-based workflow for projects that need continuous visual worlds, sequence master visuals, camera plans, and motion-oriented video rendering.

**Architecture:** Add a project-level immutable `productionMode` (`"scene" | "sequence"`) with legacy projects defaulting to `"scene"`. Preserve `scenes.json` as the sole source of narration, scene order, TTS, PPTX, and per-scene screen-design data. Add `sequences.json` only to sequence-mode projects; it references scene IDs in order and owns continuity, master visual, camera, and overlay metadata. Never duplicate narration into `sequences.json`. Existing scene-mode API routes and output paths stay backward compatible.

**Tech Stack:** Next.js 16 App Router, TypeScript, React, Vitest, file-backed project storage, existing `LlmClient` / `ImageClient`, ffmpeg.

## Non-negotiable compatibility rules

- A `project.json` without `productionMode` is a valid legacy scene-mode project.
- The default for all newly created projects is `"scene"` unless the user chooses sequence mode at creation.
- Do not change `scenes.json`, `screen-design.json`, `images/{sceneId}.png`, `audio/{sceneId}.wav`, PPTX export inputs, or existing scene-mode API contracts.
- `sequences.json` is only written after an explicit sequence-plan generation or save. Opening a legacy project must not write it.
- Every non-title scene in a saved sequence plan appears exactly once, in the same relative order as `scenes.json`. Title scenes may be either omitted or included as explicit divider sequences, but the policy must be consistent and validated.
- Changing production mode after project creation is not supported in this feature. Offer no in-place toggle; a future “duplicate as sequence project” feature may be added separately.
- Do not automatically spend image-generation money after a sequence edit. Mark derived assets stale and require an explicit user action.

---

## Target data contracts

### `ProjectMeta`

```ts
export type ProductionMode = "scene" | "sequence";

export interface ProjectMeta {
  id: string;
  title: string;
  createdAt: string;
  scriptType: ScriptType;
  productionMode?: ProductionMode; // optional solely for old project.json files
  currentStep: PipelineStep;
}

export function getProductionMode(project: ProjectMeta): ProductionMode {
  return project.productionMode ?? "scene";
}
```

### `sequences.json`

```ts
export interface Sequence {
  id: string;                 // sequence-001, sequence-002 …
  order: number;
  title: string;
  sceneIds: string[];         // reference only; narration is never copied here
  estimatedDurationSec: number;
  purpose: string;
  continuity: {
    location: string;
    timeOfDay?: string;
    visualStyle: string;
    fixedElements: string[];
    doNotChange: string[];
  };
  masterVisual: {
    description: string;
    prompt?: string;
    status: "not-generated" | "generated" | "stale";
    assetId?: string;
  };
  cameraPlan: Array<{
    sceneId: string;
    shot: "wide" | "medium" | "detail" | "close-up";
    motion: "static" | "slow-push-in" | "slow-pull-out" | "pan-left" | "pan-right" | "follow-flow";
  }>;
  overlays: Array<{
    sceneId: string;
    type: "label" | "arrow-flow" | "highlight" | "diagram" | "chart";
    description: string;
  }>;
  needsReview?: boolean;
}

export interface SequencePlan {
  version: 1;
  sequences: Sequence[];
}
```

Store master images beneath `sequence-assets/{sequenceId}/{assetId}.png`. Keep per-scene image output under its current `images/{sceneId}.png` path.

---

## Task 1: Add project production mode without breaking legacy projects

**Files:**
- Modify: `lib/projects/types.ts`
- Modify: `lib/projects/store.ts`
- Modify: `app/projects/new/page.tsx`
- Modify: `app/api/projects/upload/route.ts`
- Test: `lib/projects/store.test.ts`

- [ ] Add `ProductionMode`, optional `ProjectMeta.productionMode`, and `getProductionMode()` in `lib/projects/types.ts`.
- [ ] Change `createProject(title, scriptType, productionMode = "scene")`; validate mode at the store boundary.
- [ ] Update the new-project form with a required, accessible choice: **씬 기반 과정 제작** (default) or **시퀀스 기반 과정 제작**. Explain that the sequence option is optimized for continuous visual-video production.
- [ ] Pass the selected mode through upload/create API validation; reject values other than `scene` and `sequence` with a generic 400 response.
- [ ] Add focused tests for: default new project, explicit sequence project, reading legacy JSON with no property, invalid input rejection.
- [ ] Run `npx vitest run lib/projects/store.test.ts`.

## Task 2: Make pipeline navigation mode-aware

**Files:**
- Modify: `app/AppShell.tsx`
- Modify: `app/projects/[projectId]/(pipeline)/layout.tsx`
- Modify: `lib/projects/types.ts`
- Add: `lib/projects/pipelineSteps.ts`
- Test: `lib/projects/pipelineSteps.test.ts`

- [ ] Extract the current hard-coded step list into a pure helper returning either:
  - scene mode: `markdown → scenes → screen-design → review → images → storyboard`
  - sequence mode: `markdown → scenes → sequences → screen-design → review → images → storyboard`
- [ ] Add `"sequences"` to the `PipelineStep` union. Do not remove or rename current keys.
- [ ] Note on scope: `AppShell.tsx`'s step list is currently a top-level `as const` array, and `layout.tsx`'s `computeStepCompletion` hardcodes a `Promise.all` over a fixed set of steps. Making both mode-aware means updating each call site that assumes the old fixed step list, not just adding the new helper — budget this task accordingly rather than treating it as a drop-in helper swap.
- [ ] Make AppShell derive labels, current index, previous navigation, and completion display from the project mode.
- [ ] Update completion computation: scene mode must not require `sequences.json`; sequence mode considers the step complete only when a valid sequence plan exists.
- [ ] Test both ordered step lists and legacy project fallback.

## Task 3: Build the sequence model, storage, and integrity validator

**Files:**
- Add: `lib/pipeline/sequenceTypes.ts`
- Add: `lib/pipeline/validateSequenceIntegrity.ts`
- Add: `lib/pipeline/validateSequenceIntegrity.test.ts`
- Modify: `lib/projects/store.ts`

- [ ] Define `Sequence`, `SequencePlan`, allowed shot/motion/overlay unions, and `SequenceIntegrityIssue`.
- [ ] Add safe store helpers for `sequences.json` and sequence assets. Validate sequence IDs with the same defensive pattern used for scene IDs.
- [ ] Implement a pure `validateSequenceIntegrity(scenes, plan)` returning structured errors rather than throwing for normal invalid user input.
- [ ] Enforce exactly-once inclusion and scene order for content scenes; reject unknown scene IDs, duplicate IDs, empty sequences, mismatched order, non-finite duration, missing or duplicate sequence IDs, and camera/overlay references outside that sequence.
- [ ] Define one title policy: recommended policy is title scenes are omitted from `sceneIds`, because their current renderer already creates title cards without image generation. Make this explicit in validation and UI copy.
- [ ] Derive and compare total duration from referenced scenes rather than trusting client input.
- [ ] Add exhaustive unit tests for valid plans, all failure cases, title scenes, and sequences after a scene split/merge changes IDs.

## Task 4: Generate an AI sequence plan and expose its API

**Files:**
- Add: `lib/pipeline/planSequences.ts`
- Add: `lib/pipeline/planSequences.test.ts`
- Add: `app/api/projects/[projectId]/sequences/route.ts`
- Modify: `lib/jobs/registry.ts`

- [ ] Implement `planSequences(client, scenes, options)` as a pure AI-facing module. It must accept `LlmClient` by injection, use JSON mode, and expose parser/type guards separately for tests.
- [ ] Prompt requirements:
  - group 2–6 adjacent content scenes when place, subject, viewpoint, and time remain continuous;
  - target 20–40 seconds but allow a short introductory/transition sequence;
  - never change narration or scene boundaries;
  - return purpose, continuity, master visual, per-scene camera plan, and precise overlay descriptions;
  - do not ask the model to render text or data charts into master images.
- [ ] Validate the parsed plan against current scenes before writing. Return 502 for AI parse/schema failure, 400 only for missing source data, and never expose upstream error details.
- [ ] Add `sequences` job registry support, NDJSON stream events, cancellation, progress, resume behavior only if it is genuinely useful, and `currentStep` update on success.
- [ ] Implement PUT for manually edited plans. Validate body and integrity before write.
- [ ] Add tests for prompt/parser behavior, malformed output, scene-order rejection, and a mock-client successful plan.

## Task 5: Create the sequence-plan review and editor page

**Files:**
- Add: `app/projects/[projectId]/(pipeline)/sequences/page.tsx`
- Add: `app/projects/[projectId]/(pipeline)/sequences/SequencePlanEditor.tsx`
- Modify: `app/projects/[projectId]/(pipeline)/layout.tsx`
- Test: component tests only if the existing test setup supports them; otherwise test pure editor helpers separately.

- [ ] Route only sequence-mode projects to the editor. Scene-mode users must never see a broken or empty sequence step; server-side redirect them to `screen-design`.
- [ ] Follow `SceneListEditor` and `useAiJob` conventions: generate, cancel, NDJSON progress, error handling, PUT save, and AppShell next-step registration.
- [ ] Render each sequence as a card showing title, total duration, purpose, the ordered scene list, continuity fields, master visual description/status, camera rows, and overlays.
- [ ] Support safe manual changes: rename sequence, edit continuity/visual instructions, move a scene only between adjacent sequences, merge adjacent sequences, and split a sequence between adjacent scenes.
- [ ] After any structural edit, recompute order/duration and validate before enabling Save/Next. Do not permit an empty sequence.
- [ ] Clearly label sequence plan as a visual-production plan; scene narration remains edited in the existing Scene page.
- [ ] Surface `needsReview` and derived-asset stale warnings without auto-generating assets.

## Task 6: Feed sequence context into existing screen design without changing scene-mode output

**Files:**
- Modify: `app/api/projects/[projectId]/screen-design/route.ts`
- Modify: `app/api/projects/[projectId]/screen-design/[sceneId]/route.ts`
- Modify: `lib/pipeline/selectScreenTypes.ts`
- Test: `lib/pipeline/selectScreenTypes.test.ts`

- [ ] Load and validate `sequences.json` only when mode is `sequence`. If absent or invalid in sequence mode, return a user-facing prerequisite error.
- [ ] Add optional `sequenceContext` to the screen-design module, including only the current sequence’s purpose, continuity, master visual description, and the current scene’s camera/overlay plan.
- [ ] Update the prompt to treat scene-specific education content as authoritative while preserving the sequence visual world. Explicitly state that captions, numbers, labels, and charts are renderer overlays, not generated-image typography.
- [ ] Ensure scene mode invokes the existing code path with no sequence context and produces the same contract.
- [ ] Add a mock-client test proving sequence context appears only for sequence mode and does not alter legacy input/output shape.

## Task 7: Add sequence master-asset generation as an explicit action

**Files:**
- Add: `lib/pipeline/generateSequenceMasterImage.ts`
- Add: `app/api/projects/[projectId]/sequences/[sequenceId]/master-image/route.ts`
- Modify: `lib/projects/store.ts`
- Modify: `app/projects/[projectId]/(pipeline)/sequences/SequencePlanEditor.tsx`
- Test: `lib/pipeline/generateSequenceMasterImage.test.ts`

- [ ] Generate a master visual only after explicit user action; never include it in automatic progress.
- [ ] Reuse the existing `ImageClient` factory, retry policy, style/presenter/background references where applicable, and safe error handling.
- [ ] The prompt must request a text-free, wide composition with safe room for camera crops and overlays; use the sequence continuity and master description.
- [ ] Save to `sequence-assets/{sequenceId}/{assetId}.png`, then atomically update the relevant `masterVisual` status and asset ID in `sequences.json`.
- [ ] Mark master asset stale when its master description or continuity changes. Do not delete prior files automatically.
- [ ] Add an image serving GET route only if the browser cannot safely use the existing static project API pattern; preserve path validation either way.

## Task 8: Make scene-image generation sequence-aware while preserving the scene pipeline

**Files:**
- Modify: `lib/pipeline/generateSceneImage.ts`
- Modify: `app/api/projects/[projectId]/images/route.ts`
- Modify: `app/api/projects/[projectId]/images/[sceneId]/route.ts`
- Modify: `lib/pipeline/sceneHierarchy.ts` or add a dedicated sequence lookup helper
- Test: `lib/pipeline/generateSceneImage.test.ts`

- [ ] Add optional `sequenceImageContext` containing master image buffer/path, continuity, current camera instruction, fixed elements, and overlay exclusions.
- [ ] In sequence mode, group image generation work by sequence rather than only title hierarchy. Within a sequence, process scenes in order so generated results share master context; retain the global concurrency cap across sequences.
- [ ] Preserve the OpenAI/local engine split and existing reference-image behavior.
- [ ] If a sequence master image is unavailable, allow scene image generation using textual continuity but display a warning in UI; do not silently fail the whole job.
- [ ] Explicitly prohibit baked-in labels, arrows, numeric charts, and captions for sequence images. Those belong to the renderer.
- [ ] Scene mode must use the old prompt path exactly. Add regression tests that assert no sequence instructions or references are added in scene mode.

## Task 9: Compile a sequence timeline and add conservative motion rendering

**Files:**
- Add: `lib/video/buildSequenceTimeline.ts`
- Add: `lib/video/buildSequenceTimeline.test.ts`
- Modify: `app/api/projects/[projectId]/video/route.ts`
- Modify: `lib/video/buildVideoClip.ts`
- Add or modify: `lib/video/renderSequenceFrame.tsx`

- [ ] Keep current scene-mode rendering byte-for-byte behavior where practical: per-scene static frame, narration, 0.65s hold, then fade. `buildVideoClip.ts`'s existing single-ffmpeg-process invocation (`-loop 1 -i frame -i audio ...`) must stay untouched on this path.
- [ ] For sequence mode, compile validated scenes + sequence plan + real WAV durations into a `SequenceTimeline` before calling ffmpeg. Persist it only if useful for debugging; it is a derived render plan, not the editing source of truth.
- [ ] **Motion implementation strategy (resolves the conflict between this task and `buildVideoClip.ts`'s existing "avoid ffmpeg's fragile `zoompan` filter" decision):**
  - Do **not** use `zoompan`. It carries a persistent frame-counter (`z`) that accumulates state across frames and is known to jitter, freeze, or reset on `-loop 1` static-image inputs — this is exactly the fragility the current code comment warns about, and this plan must not reintroduce it.
  - Implement pan/zoom instead with ffmpeg's `crop` filter whose `x`/`y`/`w`/`h` are expressions of the built-in `t` variable (seconds since clip start, known in advance from the timeline), immediately followed by `scale=width:height` to the project's fixed frame dimensions. Every frame's crop window is a pure function of `t`, so there is no accumulated state to drift or glitch.
    - `slow-push-in` / `slow-pull-out`: crop window size interpolates linearly between 100% and ~82% of the source frame (centered), then is scaled up to fill the output — push-in starts large and shrinks, pull-out runs the same math in reverse.
    - `pan-left` / `pan-right`: a fixed-size crop window (matching the output aspect ratio) whose `x` offset slides linearly across the available source width; `y` stays centered.
    - `follow-flow`: the same crop+scale mechanics; the camera plan may supply explicit start/end crop-origin hints, defaulting to a diagonal pan when absent. Not a separate rendering code path.
  - This still runs as one `-vf` filter chain inside a single ffmpeg process per clip, in the same shape `buildVideoClip.ts` already uses — no second rendering pass, no new binary dependency.
  - Requires the source image to have margin beyond the output frame in the pan/zoom direction. Task 7's master-image prompt already asks for a "wide composition with safe room for camera crops," so no separate change is needed there; scene images generated without a master (Task 8's fallback) may not have this margin.
  - Clamp every crop window to the source image's actual bounds; if the requested motion would exceed them (image too small, or no master image and scene image lacks margin), fall back to `static` for that clip and do not fail the render.
  - Update `buildVideoClip.ts`'s doc comment so it's clear crop+scale is the sequence-mode motion mechanism and the original zoompan-avoidance decision still stands (scene mode's code path and output remain byte-for-byte unchanged).
- [ ] Render `label`, `highlight`, `arrow-flow`, `diagram`, and `chart` overlays as deterministic SVG/HTML/Satori layers. Do not generate them with an image model.
- [ ] Apply transition effects at sequence boundaries; retain the existing fade as fallback.
- [ ] Version or invalidate clip/frame outputs when a scene image, audio, camera plan, master asset, or overlay changes. Never reuse a clip merely because the scene ID still exists.
- [ ] Test timeline order, duration alignment, missing-master fallback, frame crop bounds (including the too-small-source-image fallback to `static`), title behavior, and stale cache detection.

## Task 10: Final integration, documentation, and regression verification

**Files:**
- Modify: `docs/PROJECT_OVERVIEW.md`
- Modify: `docs/reference/pipeline-steps.md`
- Modify: `docs/ROADMAP.md`
- Add or update targeted test files above

- [ ] Document both modes, their storage files, image/renderer differences, and the no-mode-switch rule.
- [ ] Update the pipeline input/output reference with `sequences.json` and sequence asset paths.
- [ ] Add a manual E2E checklist:
  1. Open an old project and complete scene-mode image/TTS/video flow without `sequences.json`.
  2. Create a new scene-mode project and verify no sequence page/API generation is required.
  3. Create a new sequence-mode project, generate/edit/save a sequence plan, and verify scene IDs, ordering, and narration stay unchanged.
  4. Generate master visuals explicitly, then scene images, then TTS/video; inspect sequence continuity and overlays.
  5. Split, merge, and delete scenes after a plan exists; verify stale/review states and no silent destructive regeneration.
- [ ] Run `npm test`, `npm run lint`, `npx tsc --noEmit`, and `npm run build`.
- [ ] Do not commit generated project data, images, audio, video, or secrets.

## Implementation order and review gates

1. Tasks 1–3: safe data model, compatibility and validation foundation.
2. Tasks 4–5: usable sequence-plan MVP; review before creating paid assets.
3. Task 6: sequence-aware screen design.
4. Tasks 7–8: explicit master assets and sequence-aware images; review generated quality.
5. Task 9: motion renderer; validate output manually on at least two representative courses.
6. Task 10: regression, documentation, full verification.

Do not start Tasks 7–9 until Tasks 1–6 are merged and scene-mode regression tests are green.
