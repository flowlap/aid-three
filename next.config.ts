import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["pdf-parse"],
  // python/tts/.venv의 python 심볼릭 링크가 프로젝트 루트 밖(시스템 python)을 가리켜
  // Turbopack의 프로덕션 빌드 파일 추적이 이를 따라가다 패닉을 일으킴 — 추적 대상에서 제외.
  outputFileTracingExcludes: {
    "*": ["python/**"],
  },
  // Next.js dev mode blocks cross-origin requests to internal dev resources
  // (HMR websocket, /_next/* assets) by default — only "localhost" is
  // allowed out of the box. Accessing via the Tailscale MagicDNS hostname
  // from another device sends that hostname as the Origin header, which
  // gets rejected with a 403 (surfaces to the client as a socket/connection
  // error on the HMR websocket). Allowlisting it here fixes remote access.
  allowedDevOrigins: ["macmini.tail0d4349.ts.net"],
  images: {
    // The header logo's `?v=<version>` cache-busting query string (see
    // app/AppHeader.tsx) needs an explicit local pattern — next/image
    // rejects local src query strings by default as of Next 15.3+.
    localPatterns: [{ pathname: "/icons/**" }],
  },
};

export default nextConfig;
