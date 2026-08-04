import type { MetadataRoute } from "next";
import packageJson from "../package.json";

// Replaces the old static public/manifest.webmanifest so the icon URLs can be
// version-busted — Chrome's in-process image cache otherwise keeps serving old
// icon bytes for a static URL across reloads even after the underlying file changes.
export default function manifest(): MetadataRoute.Manifest {
  const v = packageJson.version;
  return {
    name: "부하3호 — 이러닝 스토리보드 제작 지원 도구",
    short_name: "부하3호",
    description: "이러닝 교육 과정 원고를 영상 제작용 스토리보드로 변환하는 제작 지원 도구",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#6366f1",
    lang: "ko",
    icons: [
      { src: `/icons/icon-192.png?v=${v}`, sizes: "192x192", type: "image/png", purpose: "any" },
      { src: `/icons/icon-512.png?v=${v}`, sizes: "512x512", type: "image/png", purpose: "any" },
      { src: `/icons/icon-192.png?v=${v}`, sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: `/icons/icon-512.png?v=${v}`, sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
