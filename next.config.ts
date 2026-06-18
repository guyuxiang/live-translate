import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  allowedDevOrigins: ["www.openshort.cloud"],
  serverExternalPackages: ["@livekit/rtc-node", "ws"],
};

export default nextConfig;
