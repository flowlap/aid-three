"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { AiJobStatus } from "@/components/AiJobStatus";
import { useAiJob } from "@/lib/client/useAiJob";
import { estimateSecondsForScenes } from "@/lib/client/estimateAiDuration";
import type { Scene } from "@/lib/pipeline/splitScenes";

type TtsStreamEvent =
  | { type: "scene"; sceneId: string; index: number; total: number; durationSec: number }
  | { type: "result" }
  | { type: "error"; message: string }
  | { type: "cancelled" };

type VideoStreamEvent =
  | { type: "scene"; sceneId: string; index: number; total: number }
  | { type: "concatenating" }
  | { type: "result" }
  | { type: "error"; message: string }
  | { type: "cancelled" };

interface AudioManifestEntry {
  durationSec: number;
  voice: string;
  generatedAt: string;
}

/** Rough local-model inference estimate — no real-world timing data yet, refine once used. */
const TTS_SECONDS_PER_SCENE_ESTIMATE = 8;
/** Frame render + ffmpeg encode per scene, run 2-at-a-time (VIDEO_RENDER_CONCURRENCY). */
const VIDEO_SECONDS_PER_SCENE_ESTIMATE = 6;
const VIDEO_RENDER_CONCURRENCY = 2;

function formatDuration(sec: number): string {
  return `${sec.toFixed(1)}초`;
}

export function NarrationAudioEditor({
  projectId,
  projectTitle,
  scenes,
  initialAudioIds,
  initialDurations,
  initialVideoClipIds,
  initialVideoReady,
}: {
  projectId: string;
  projectTitle: string;
  scenes: Scene[];
  initialAudioIds: string[];
  initialDurations: Record<string, AudioManifestEntry>;
  initialVideoClipIds: string[];
  initialVideoReady: boolean;
}) {
  const [audioIds, setAudioIds] = useState<Set<string>>(new Set(initialAudioIds));
  const [durations, setDurations] = useState<Record<string, number>>(
    Object.fromEntries(Object.entries(initialDurations).map(([id, entry]) => [id, entry.durationSec]))
  );
  const [versions, setVersions] = useState<Record<string, number>>({});
  const [activityLines, setActivityLines] = useState<string[]>([]);

  const {
    loading: ttsLoading,
    discoveredRunning: ttsDiscoveredRunning,
    error: ttsError,
    progress: ttsProgress,
    startedAt: ttsStartedAt,
    start: startTts,
    cancel: cancelTts,
  } = useAiJob<TtsStreamEvent>({
    projectId,
    step: "tts",
    onEvent: (event) => {
      if (event.type === "scene") {
        setAudioIds((prev) => new Set(prev).add(event.sceneId));
        setDurations((prev) => ({ ...prev, [event.sceneId]: event.durationSec }));
        setVersions((prev) => ({ ...prev, [event.sceneId]: (prev[event.sceneId] ?? 0) + 1 }));
        setActivityLines((prev) => [
          ...prev,
          `[${event.index + 1}/${event.total}] ${event.sceneId} 음성 생성 완료 (${formatDuration(event.durationSec)})`,
        ]);
      }
    },
  });

  const [videoReady, setVideoReady] = useState(initialVideoReady);
  const [videoVersion, setVideoVersion] = useState(0);
  const [videoActivityLines, setVideoActivityLines] = useState<string[]>([]);
  const [videoClipIds, setVideoClipIds] = useState<Set<string>>(new Set(initialVideoClipIds));

  const {
    loading: videoLoading,
    discoveredRunning: videoDiscoveredRunning,
    error: videoError,
    progress: videoProgress,
    startedAt: videoStartedAt,
    start: startVideo,
    cancel: cancelVideo,
  } = useAiJob<VideoStreamEvent>({
    projectId,
    step: "video",
    onEvent: (event) => {
      if (event.type === "scene") {
        setVideoClipIds((prev) => new Set(prev).add(event.sceneId));
        setVideoActivityLines((prev) => [...prev, `[${event.index + 1}/${event.total}] ${event.sceneId} 클립 생성 완료`]);
      } else if (event.type === "concatenating") {
        setVideoActivityLines((prev) => [...prev, "클립을 하나로 연결하는 중..."]);
      } else if (event.type === "result") {
        setVideoReady(true);
        setVideoVersion((v) => v + 1);
      }
    },
  });

  async function handleGenerate(mode: "full" | "resume") {
    setActivityLines([]);
    await startTts({ body: { mode } });
  }

  async function handleGenerateVideo(mode: "full" | "resume") {
    setVideoActivityLines([]);
    await startVideo({ body: { mode } });
  }

  const completedCount = scenes.filter((s) => audioIds.has(s.id)).length;
  const remainingCount = scenes.length - completedCount;
  const isPartial = completedCount > 0 && remainingCount > 0;
  const allAudioReady = scenes.length > 0 && completedCount === scenes.length;

  const completedClipCount = scenes.filter((s) => videoClipIds.has(s.id)).length;
  const remainingClipCount = scenes.length - completedClipCount;
  const isClipPartial = completedClipCount > 0 && remainingClipCount > 0;

  return (
    <div className="mx-auto max-w-[1000px] px-6 py-8 md:px-8">
      <Link
        href={`/projects/${projectId}/storyboard`}
        className="mb-4 inline-block text-sm font-medium text-muted-foreground hover:text-foreground"
      >
        ← {projectTitle}
      </Link>
      <h1 className="mb-1 text-3xl font-semibold tracking-tight">동영상으로 보기</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        이 Mac에 설치된 로컬 TTS(Qwen3-TTS)로 씬별 내레이션 음성을 생성합니다. Windows에서는 사용할 수 없습니다.
      </p>

      <Card className="mb-4 gap-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => handleGenerate(isPartial ? "resume" : "full")} disabled={ttsLoading}>
            {ttsLoading
              ? ttsDiscoveredRunning
                ? `이미 실행 중...${ttsProgress ? ` (${ttsProgress.index}/${ttsProgress.total})` : ""}`
                : ttsProgress
                  ? `생성 중... (${ttsProgress.index}/${ttsProgress.total})`
                  : "생성 중..."
              : isPartial
                ? `이어서 생성 (${remainingCount}개 남음)`
                : audioIds.size
                  ? "전체 다시 생성"
                  : "AI로 음성 생성"}
          </Button>
          {!ttsLoading && isPartial && (
            <Button variant="outline" onClick={() => handleGenerate("full")}>
              전체 다시 생성
            </Button>
          )}
          {ttsLoading && (
            <Button variant="outline" onClick={cancelTts}>
              취소
            </Button>
          )}
          <span className="ml-auto text-xs font-medium text-muted-foreground">
            {audioIds.size} / {scenes.length}개 생성됨
          </span>
        </div>
        <AiJobStatus
          loading={ttsLoading}
          label={ttsDiscoveredRunning ? "다른 곳에서 시작된 음성 생성이 진행 중입니다" : "로컬 모델이 씬별 음성을 생성하는 중입니다"}
          startedAt={ttsStartedAt}
          progress={ttsProgress}
          estimateSeconds={estimateSecondsForScenes(scenes.length, TTS_SECONDS_PER_SCENE_ESTIMATE)}
          activityLines={activityLines}
        />
      </Card>

      {ttsError && (
        <p className="mb-4 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {ttsError}
        </p>
      )}

      <Card className="mb-6 gap-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <div>
            <p className="text-sm font-medium">동영상 생성</p>
            <p className="text-xs text-muted-foreground">
              제목 목업과 생성 이미지를 생성된 이미지 비율에 맞는 mp4로 만들며, 각 내레이션 뒤에는 짧은 텀과 페이지 전환 효과가 적용됩니다. ffmpeg 필요.
            </p>
          </div>
          <Button
            className="ml-auto"
            onClick={() => handleGenerateVideo(completedClipCount > 0 ? "resume" : "full")}
            disabled={videoLoading || !allAudioReady}
          >
            {videoLoading
              ? videoDiscoveredRunning
                ? `이미 실행 중...${videoProgress ? ` (${videoProgress.index}/${videoProgress.total})` : ""}`
                : videoProgress
                  ? `생성 중... (${videoProgress.index}/${videoProgress.total})`
                  : "생성 중..."
              : isClipPartial
                ? `이어서 생성 (${remainingClipCount}개 남음)`
                : completedClipCount > 0
                  ? "합치기 재시도"
                  : "동영상 생성"}
          </Button>
          {!videoLoading && completedClipCount > 0 && (
            <Button variant="outline" onClick={() => handleGenerateVideo("full")}>
              전체 다시 생성
            </Button>
          )}
          {videoLoading && (
            <Button variant="outline" onClick={cancelVideo}>
              취소
            </Button>
          )}
        </div>
        {!allAudioReady && <p className="text-xs text-muted-foreground">모든 씬의 음성이 먼저 준비되어야 합니다.</p>}
        {completedClipCount > 0 && (
          <p className="text-xs text-muted-foreground">클립 {completedClipCount} / {scenes.length}개 생성됨</p>
        )}
        <AiJobStatus
          loading={videoLoading}
          label={videoDiscoveredRunning ? "다른 곳에서 시작된 동영상 생성이 진행 중입니다" : "씬별 프레임/클립을 만들고 연결하는 중입니다"}
          startedAt={videoStartedAt}
          progress={videoProgress}
          estimateSeconds={estimateSecondsForScenes(scenes.length, VIDEO_SECONDS_PER_SCENE_ESTIMATE, VIDEO_RENDER_CONCURRENCY)}
          activityLines={videoActivityLines}
        />
        {videoError && <p className="text-sm text-destructive">{videoError}</p>}
        {videoReady && !videoLoading && (
          <div className="space-y-2">
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <video controls src={`/api/projects/${projectId}/video?v=${videoVersion}`} className="w-full rounded-lg border" />
            <a
              href={`/api/projects/${projectId}/video`}
              download={`${projectTitle}.mp4`}
              className="inline-block text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            >
              mp4 다운로드
            </a>
          </div>
        )}
      </Card>

      <div className="space-y-4">
        {scenes.map((scene, index) => {
          const hasAudio = audioIds.has(scene.id);
          const version = versions[scene.id] ?? 0;
          const durationSec = durations[scene.id];
          return (
            <Card key={scene.id} id={scene.id} className="gap-3 p-5">
              <div className="flex items-center gap-2">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">
                  {index + 1}
                </span>
                <span className="text-xs font-medium text-muted-foreground">{scene.id}</span>
                {typeof durationSec === "number" && (
                  <span className="text-xs text-muted-foreground">
                    실제 {formatDuration(durationSec)} · 예상 {scene.estimatedDurationSec}초
                  </span>
                )}
              </div>
              <p className="rounded-lg border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
                {scene.narrationText}
              </p>
              {hasAudio ? (
                // eslint-disable-next-line jsx-a11y/media-has-caption
                <audio controls src={`/api/projects/${projectId}/audio/${scene.id}?v=${version}`} className="w-full" />
              ) : (
                <p className="text-xs text-muted-foreground">아직 생성된 음성이 없습니다</p>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
