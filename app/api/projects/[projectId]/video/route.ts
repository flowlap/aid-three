import { NextRequest, NextResponse } from "next/server";
import { createReadStream } from "fs";
import { Readable } from "stream";
import { createHash } from "crypto";
import {
  readProject,
  readProjectFile,
  readProjectImage,
  readProjectAudio,
  listProjectAudioIds,
  listProjectVideoClipIds,
  writeProjectVideoFrame,
  projectVideoFramePath,
  projectAudioPath,
  projectVideoClipPath,
  projectVideoPath,
  projectVideoOverlayPath,
  writeProjectVideoOverlay,
  readProjectVideoClipFingerprint,
  writeProjectVideoClipFingerprint,
  readSequencePlan,
  statProjectVideo,
} from "@/lib/projects/store";
import { getProductionMode } from "@/lib/projects/types";
import { renderSceneFrameToPng } from "@/lib/video/renderSceneFrameToPng";
import { renderSequenceOverlayToPng } from "@/lib/video/renderSequenceFrameToPng";
import { buildVideoClip, buildSequenceVideoClip, SCENE_BREAK_HOLD_SEC } from "@/lib/video/buildVideoClip";
import { buildStaticScaleFilter, buildMotionFilter } from "@/lib/video/motionFilter";
import { buildSequenceTimeline } from "@/lib/video/buildSequenceTimeline";
import { computeSceneClipFingerprint } from "@/lib/video/sceneClipFingerprint";
import { concatClips, PAGE_TRANSITION_DURATION_SEC, SEQUENCE_HARD_CUT_DURATION_SEC } from "@/lib/video/concatClips";
import { computeFrameDimensions } from "@/lib/video/frameDimensions";
import { assertFfmpegAvailable } from "@/lib/media/ffmpeg";
import { getWavDurationSec } from "@/lib/media/wavDuration";
import { runWithConcurrencyLimit } from "@/lib/concurrency";
import { VIDEO_RENDER_CONCURRENCY } from "@/lib/pipeline/videoRenderConfig";
import { getProjectImageAspectRatio, getPngDimensions } from "@/lib/pipeline/imageAspectRatio";
import { validateSequenceIntegrity } from "@/lib/pipeline/validateSequenceIntegrity";
import { loadSequenceMasterAsset } from "@/lib/pipeline/sequenceLookup";
import type { Scene } from "@/lib/pipeline/splitScenes";
import type { VisualDesign } from "@/lib/pipeline/designVisuals";
import type { SequencePlan } from "@/lib/pipeline/sequenceTypes";
import { createResilientStream } from "@/lib/http/resilientStream";
import { startJob, finishJob, recordProgress, JobAlreadyRunningError } from "@/lib/jobs/registry";

const STEP = "video" as const;

/** Renders a scene's still frame (or caption-card fallback when imageBuffer is undefined) and encodes it into a fixed-duration clip with no camera motion — scene mode's only render path, and sequence mode's AI-image-mode path (a full AI-regenerated still, so no separate overlay/motion pass is needed). */
async function renderStaticSceneClip(
  projectId: string,
  scene: Scene,
  design: VisualDesign | undefined,
  imageBuffer: Buffer | undefined,
  frameDimensions: ReturnType<typeof computeFrameDimensions>,
  signal: AbortSignal
): Promise<void> {
  const framePng = await renderSceneFrameToPng(scene, design, imageBuffer, frameDimensions);
  await writeProjectVideoFrame(projectId, scene.id, framePng);
  await buildVideoClip(
    projectVideoFramePath(projectId, scene.id),
    projectAudioPath(projectId, scene.id),
    projectVideoClipPath(projectId, scene.id),
    frameDimensions,
    signal
  );
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const project = await readProject(projectId);
  if (!project) return NextResponse.json({ error: "프로젝트를 찾을 수 없습니다" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const resume = body?.mode === "resume";

  const scenesRaw = await readProjectFile(projectId, "scenes.json");
  if (!scenesRaw) return NextResponse.json({ error: "씬 데이터가 없습니다" }, { status: 400 });

  let scenes: Scene[];
  try {
    scenes = JSON.parse(scenesRaw).scenes;
  } catch (err) {
    console.error("씬 데이터 파싱 실패:", err);
    return NextResponse.json({ error: "씬 데이터 형식이 올바르지 않습니다" }, { status: 400 });
  }
  if (!Array.isArray(scenes) || scenes.length === 0) {
    return NextResponse.json({ error: "씬 데이터가 없습니다" }, { status: 400 });
  }

  const audioIds = new Set(await listProjectAudioIds(projectId));
  const missingAudio = scenes.filter((scene) => !audioIds.has(scene.id));
  if (missingAudio.length > 0) {
    return NextResponse.json(
      { error: `${missingAudio.length}개 씬에 내레이션 음성이 없습니다. 먼저 내레이션 음성 생성을 완료해주세요.` },
      { status: 400 }
    );
  }

  if (getProductionMode(project) === "sequence") {
    const plan = await readSequencePlan(projectId);
    if (!plan) {
      return NextResponse.json({ error: "시퀀스 계획이 없습니다. 먼저 시퀀스 단계를 완료해주세요." }, { status: 400 });
    }
    const issues = validateSequenceIntegrity(scenes, plan);
    if (issues.some((issue) => issue.severity === "error")) {
      return NextResponse.json({ error: "시퀀스 계획에 오류가 있습니다. 시퀀스 단계에서 먼저 수정해주세요." }, { status: 400 });
    }
    return handleSequenceModeVideo(projectId, scenes, plan, resume);
  }

  const screenDesignRaw = await readProjectFile(projectId, "screen-design.json");
  const visualDesigns: Record<string, VisualDesign> = screenDesignRaw
    ? (JSON.parse(screenDesignRaw).visualDesigns ?? {})
    : {};
  let durations: number[];
  try {
    durations = await Promise.all(
      scenes.map(async (scene) => {
        const audio = await readProjectAudio(projectId, scene.id);
        if (!audio) throw new Error(`씬 ${scene.order}의 내레이션 음성을 찾을 수 없습니다`);
        return getWavDurationSec(audio);
      })
    );
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "내레이션 음성 길이를 읽을 수 없습니다" }, { status: 400 });
  }

  try {
    await assertFfmpegAvailable();
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "ffmpeg를 사용할 수 없습니다" }, { status: 502 });
  }

  let job;
  try {
    job = startJob(projectId, STEP);
  } catch (err) {
    if (err instanceof JobAlreadyRunningError) {
      return NextResponse.json({ error: "이미 실행 중입니다" }, { status: 409 });
    }
    throw err;
  }

  const existingClipIds = resume ? new Set(await listProjectVideoClipIds(projectId)) : new Set<string>();
  const pending = scenes.filter((scene) => !existingClipIds.has(scene.id));
  const frameDimensions = computeFrameDimensions(await getProjectImageAspectRatio(projectId));

  const stream = createResilientStream(async (emit) => {
    let completedSoFar = existingClipIds.size;
    try {
      await runWithConcurrencyLimit(pending, VIDEO_RENDER_CONCURRENCY, async (scene) => {
        if (job.controller.signal.aborted) throw new DOMException("Aborted", "AbortError");

        const design = visualDesigns[scene.id];
        const imageBuffer = await readProjectImage(projectId, scene.id);
        await renderStaticSceneClip(projectId, scene, design, imageBuffer ?? undefined, frameDimensions, job.controller.signal);

        completedSoFar += 1;
        recordProgress(projectId, STEP, completedSoFar - 1, scenes.length);
        emit(JSON.stringify({ type: "scene", sceneId: scene.id, index: completedSoFar - 1, total: scenes.length }) + "\n");
      });

      emit(JSON.stringify({ type: "concatenating" }) + "\n");
      const clipPaths = scenes.map((scene) => projectVideoClipPath(projectId, scene.id));
      await concatClips(
        clipPaths,
        durations.map((duration) => duration + SCENE_BREAK_HOLD_SEC),
        projectVideoPath(projectId),
        job.controller.signal
      );

      finishJob(projectId, STEP, "done");
      emit(JSON.stringify({ type: "result" }) + "\n");
    } catch (err) {
      if (job.controller.signal.aborted) {
        finishJob(projectId, STEP, "cancelled");
        emit(JSON.stringify({ type: "cancelled" }) + "\n");
        return;
      }
      console.error("동영상 생성 실패:", err);
      const message = err instanceof Error ? err.message : "동영상 생성에 실패했습니다";
      finishJob(projectId, STEP, "error", message);
      emit(JSON.stringify({ type: "error", message }) + "\n");
    }
  });

  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8" } });
}

/**
 * Sequence-mode video rendering. Split out from the POST handler above (which
 * stays scene mode's exact original body) rather than interleaving branches
 * through it, since the two modes' render strategy diverges completely: a
 * fingerprint-based resume check instead of "clip file exists", per-scene
 * motion/overlay compositing via buildSequenceVideoClip instead of
 * buildVideoClip, and per-boundary (fade at real sequence boundaries, hard
 * cut elsewhere) transitions instead of a uniform fade.
 */
async function handleSequenceModeVideo(
  projectId: string,
  scenes: Scene[],
  plan: SequencePlan,
  resume: boolean
): Promise<Response> {
  const screenDesignRaw = await readProjectFile(projectId, "screen-design.json");
  const visualDesigns: Record<string, VisualDesign> = screenDesignRaw
    ? (JSON.parse(screenDesignRaw).visualDesigns ?? {})
    : {};
  const sequenceImageModeRaw = (await readProjectFile(projectId, "sequence-image-mode.txt"))?.trim();
  const sequenceImageMode: "composite" | "ai" = sequenceImageModeRaw === "ai" ? "ai" : "composite";

  let durations: number[];
  // Only a sha256 digest of each scene's narration WAV is retained here, not
  // the buffer itself — every scene's audio has to be read in this one
  // up-front pass to get its duration, and holding all of those buffers
  // alive for the whole render (unlike imageBuffer, which is read fresh
  // per-scene inside the concurrency-limited worker below) would mean a
  // large project's entire audio/ directory sits in memory simultaneously.
  // See sceneClipFingerprint.ts's audioDigest doc for the full rationale.
  const audioDigestsBySceneId: Record<string, string> = {};
  try {
    durations = await Promise.all(
      scenes.map(async (scene) => {
        const audio = await readProjectAudio(projectId, scene.id);
        if (!audio) throw new Error(`씬 ${scene.order}의 내레이션 음성을 찾을 수 없습니다`);
        audioDigestsBySceneId[scene.id] = createHash("sha256").update(audio).digest("hex");
        return getWavDurationSec(audio);
      })
    );
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "내레이션 음성 길이를 읽을 수 없습니다" }, { status: 400 });
  }

  try {
    await assertFfmpegAvailable();
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "ffmpeg를 사용할 수 없습니다" }, { status: 502 });
  }

  let job;
  try {
    job = startJob(projectId, STEP);
  } catch (err) {
    if (err instanceof JobAlreadyRunningError) {
      return NextResponse.json({ error: "이미 실행 중입니다" }, { status: 409 });
    }
    throw err;
  }

  const frameDimensions = computeFrameDimensions(await getProjectImageAspectRatio(projectId));
  const durationsBySceneId = Object.fromEntries(scenes.map((scene, index) => [scene.id, durations[index]]));
  const timeline = buildSequenceTimeline(scenes, plan, durationsBySceneId);
  const existingClipIds = resume ? new Set(await listProjectVideoClipIds(projectId)) : new Set<string>();

  const stream = createResilientStream(async (emit) => {
    let completedSoFar = 0;
    try {
      await runWithConcurrencyLimit(scenes, VIDEO_RENDER_CONCURRENCY, async (scene, index) => {
        if (job.controller.signal.aborted) throw new DOMException("Aborted", "AbortError");

        const entry = timeline.entries[index];

        // Sequence + AI mode: the scene's still (images/{sceneId}.png) is
        // already a full AI-regenerated image with any overlays baked
        // directly into it (see generateSceneImage.ts's bake mode), so this
        // renders exactly like a scene-mode clip — a static frame, no
        // camera crop/motion and no separate overlay layer. Title scenes
        // fall through to the branch below unchanged (no owning sequence,
        // renders as a caption card either way) and never need the sequence
        // master image loaded here.
        if (scene.sceneType !== "title" && sequenceImageMode === "ai") {
          const design = visualDesigns[scene.id];
          const imageBuffer = await readProjectImage(projectId, scene.id);
          const fingerprint = computeSceneClipFingerprint({
            imageBuffer: imageBuffer ?? null,
            audioDigest: audioDigestsBySceneId[scene.id],
            motion: "static",
            overlays: [],
            masterVisualAssetId: null,
            masterVisualStatus: null,
          });
          const canSkip =
            resume &&
            existingClipIds.has(scene.id) &&
            (await readProjectVideoClipFingerprint(projectId, scene.id)) === fingerprint;

          if (!canSkip) {
            await renderStaticSceneClip(projectId, scene, design, imageBuffer ?? undefined, frameDimensions, job.controller.signal);
            await writeProjectVideoClipFingerprint(projectId, scene.id, fingerprint);
          }

          completedSoFar += 1;
          recordProgress(projectId, STEP, completedSoFar - 1, scenes.length);
          emit(JSON.stringify({ type: "scene", sceneId: scene.id, index: completedSoFar - 1, total: scenes.length }) + "\n");
          return;
        }

        const sequence = entry.sequenceId ? plan.sequences.find((seq) => seq.id === entry.sequenceId) : undefined;
        // The base frame for a content scene is its sequence's MASTER image
        // (animated by the camera crop below + a fixed overlay layer), NOT a
        // per-scene image — sequence mode no longer generates one. The images/
        // {sceneId}.png that the images step bakes is only a still preview; the
        // video re-derives from the raw master so the crop can pan across it
        // while the overlay stays put. Title scenes (no owning sequence) and
        // content scenes whose sequence has no master fall back to a caption
        // card, exactly like a missing scene image did before.
        const masterAsset = sequence ? await loadSequenceMasterAsset(projectId, sequence) : {};
        const baseBuffer = masterAsset.buffer;
        const fingerprint = computeSceneClipFingerprint({
          imageBuffer: baseBuffer ?? null,
          audioDigest: audioDigestsBySceneId[scene.id],
          motion: entry.motion,
          overlays: entry.overlays,
          masterVisualAssetId: sequence?.masterVisual.assetId ?? null,
          masterVisualStatus: sequence?.masterVisual.status ?? null,
        });

        const canSkip =
          resume &&
          existingClipIds.has(scene.id) &&
          (await readProjectVideoClipFingerprint(projectId, scene.id)) === fingerprint;

        if (!canSkip) {
          let framePath: string;
          let vf: string;

          if (scene.sceneType === "title" || !baseBuffer || !masterAsset.path) {
            const design = visualDesigns[scene.id];
            const framePng = await renderSceneFrameToPng(scene, design, undefined, frameDimensions);
            await writeProjectVideoFrame(projectId, scene.id, framePng);
            framePath = projectVideoFramePath(projectId, scene.id);
            vf = buildStaticScaleFilter(frameDimensions);

            // A non-title scene only reaches here when its sequence has no
            // usable master image — warn (the caption card is the fallback).
            if (scene.sceneType !== "title") {
              emit(
                JSON.stringify({
                  type: "warning",
                  message: `${scene.id} 씬이 속한 시퀀스의 마스터 이미지를 찾을 수 없어 캡션 카드로 대체합니다.`,
                }) + "\n"
              );
            }
          } else {
            framePath = masterAsset.path;
            const staticVf = buildStaticScaleFilter(frameDimensions);
            const sourceDimensions = getPngDimensions(baseBuffer);
            const motionVf = sourceDimensions
              ? buildMotionFilter(entry.motion, sourceDimensions, frameDimensions, entry.clipDurationSec)
              : null;
            vf = motionVf ?? staticVf;

            if (motionVf === null && entry.motion !== "static") {
              // Two different reasons land here: the PNG couldn't be parsed
              // at all (sourceDimensions null — corrupt/non-PNG file), vs.
              // buildMotionFilter itself rejecting the motion for a
              // perfectly readable image (e.g. not enough pan slack). These
              // need distinct messages so a margin-insufficient warning
              // doesn't get shown for an unrelated file-read failure.
              const message =
                sourceDimensions === null
                  ? `${scene.id} 씬의 마스터 이미지 파일을 읽을 수 없어 정지 화면으로 대체합니다.`
                  : `${scene.id} 씬은 카메라 모션(${entry.motion})을 적용하기에 마스터 이미지 여백이 부족해 정지 화면으로 대체합니다.`;
              emit(JSON.stringify({ type: "warning", message }) + "\n");
            }
          }

          let overlayPath: string | null = null;
          if (entry.overlays.length > 0) {
            const overlayBuffer = await renderSequenceOverlayToPng(entry.overlays, frameDimensions);
            if (overlayBuffer) {
              await writeProjectVideoOverlay(projectId, scene.id, overlayBuffer);
              overlayPath = projectVideoOverlayPath(projectId, scene.id);
            }
          }

          await buildSequenceVideoClip(
            framePath,
            projectAudioPath(projectId, scene.id),
            projectVideoClipPath(projectId, scene.id),
            vf,
            overlayPath,
            job.controller.signal
          );
          await writeProjectVideoClipFingerprint(projectId, scene.id, fingerprint);
        }

        completedSoFar += 1;
        recordProgress(projectId, STEP, completedSoFar - 1, scenes.length);
        emit(JSON.stringify({ type: "scene", sceneId: scene.id, index: completedSoFar - 1, total: scenes.length }) + "\n");
      });

      emit(JSON.stringify({ type: "concatenating" }) + "\n");
      const clipPaths = scenes.map((scene) => projectVideoClipPath(projectId, scene.id));
      const clipDurations = timeline.entries.map((entry) => entry.clipDurationSec);
      const transitionDurations = timeline.entries.slice(0, -1).map((entry) =>
        entry.isSequenceBoundaryEnd ? PAGE_TRANSITION_DURATION_SEC : SEQUENCE_HARD_CUT_DURATION_SEC
      );
      await concatClips(clipPaths, clipDurations, projectVideoPath(projectId), job.controller.signal, transitionDurations);

      finishJob(projectId, STEP, "done");
      emit(JSON.stringify({ type: "result" }) + "\n");
    } catch (err) {
      if (job.controller.signal.aborted) {
        finishJob(projectId, STEP, "cancelled");
        emit(JSON.stringify({ type: "cancelled" }) + "\n");
        return;
      }
      console.error("동영상 생성 실패:", err);
      const message = err instanceof Error ? err.message : "동영상 생성에 실패했습니다";
      finishJob(projectId, STEP, "error", message);
      emit(JSON.stringify({ type: "error", message }) + "\n");
    }
  });

  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8" } });
}

/** Serves the final mp4 with Range support so <video> can seek/scrub without downloading the whole file. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const info = await statProjectVideo(projectId);
  if (!info) return NextResponse.json({ error: "생성된 동영상이 없습니다" }, { status: 404 });

  const range = req.headers.get("range");
  const commonHeaders = {
    "Content-Type": "video/mp4",
    "Accept-Ranges": "bytes",
    "Cache-Control": "no-store",
  };

  if (!range) {
    const stream = Readable.toWeb(createReadStream(info.path)) as ReadableStream;
    return new Response(stream, { headers: { ...commonHeaders, "Content-Length": String(info.size) } });
  }

  const match = range.match(/bytes=(\d*)-(\d*)/);
  const start = match?.[1] ? parseInt(match[1], 10) : 0;
  const end = match?.[2] ? Math.min(parseInt(match[2], 10), info.size - 1) : info.size - 1;

  const stream = Readable.toWeb(createReadStream(info.path, { start, end })) as ReadableStream;
  return new Response(stream, {
    status: 206,
    headers: {
      ...commonHeaders,
      "Content-Range": `bytes ${start}-${end}/${info.size}`,
      "Content-Length": String(end - start + 1),
    },
  });
}
