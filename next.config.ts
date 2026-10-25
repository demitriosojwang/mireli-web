import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Keep local production builds out of sync-managed `.next` directories when
  // OneDrive or another file provider holds generated files open.
  distDir: process.env.MIRELI_NEXT_DIST_DIR || ".next",
  typescript: {
    ignoreBuildErrors: false,
  },
  reactStrictMode: true,
};

export default nextConfig;
