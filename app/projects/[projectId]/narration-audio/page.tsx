import { notFound } from "next/navigation";
import {
  readProject,
  readProjectFile,
  listProjectAudioIds,
  listProjectVideoClipIds,
  statProjectVideo,
} from "@/lib/projects/store";
import { NarrationAudioEditor } from "./NarrationAudioEditor";
import type { Scene } from "@/lib/pipeline/splitScenes";

interface AudioManifestEntry {
  durationSec: number;
  voice: string;
  generatedAt: string;
}

export default async function NarrationAudioPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const project = await readProject(projectId);
  if (!project) notFound();

  const scenesRaw = await readProjectFile(projectId, "scenes.json");
  const scenes: Scene[] = scenesRaw ? JSON.parse(scenesRaw).scenes : [];

  const manifestRaw = await readProjectFile(projectId, "audio-manifest.json");
  const durations: Record<string, AudioManifestEntry> = manifestRaw ? (JSON.parse(manifestRaw).durations ?? {}) : {};

  const audioIds = await listProjectAudioIds(projectId);
  const videoClipIds = await listProjectVideoClipIds(projectId);
  const videoInfo = await statProjectVideo(projectId);

  return (
    <NarrationAudioEditor
      projectId={projectId}
      projectTitle={project.title}
      scenes={scenes}
      initialAudioIds={audioIds}
      initialDurations={durations}
      initialVideoClipIds={videoClipIds}
      initialVideoReady={videoInfo !== null}
    />
  );
}
