import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["pdf-parse"],
  // Next.js dev mode blocks cross-origin requests to internal dev resources
  // (HMR websocket, /_next/* assets) by default — only "localhost" is
  // allowed out of the box. Accessing via the Tailscale MagicDNS hostname
  // from another device sends that hostname as the Origin header, which
  // gets rejected with a 403 (surfaces to the client as a socket/connection
  // error on the HMR websocket). Allowlisting it here fixes remote access.
  allowedDevOrigins: ["macmini.tail0d4349.ts.net"],
};

export default nextConfig;
