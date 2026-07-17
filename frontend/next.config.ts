import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emits .next/standalone with a minimal server.js so the production image
  // ships without node_modules. See the Docker stage in ./Dockerfile.
  output: "standalone",
};

export default nextConfig;
