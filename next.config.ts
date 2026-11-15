import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Do not advertise the framework in a response header.
  poweredByHeader: false,
  // Keep local production builds out of sync-managed `.next` directories when
  // OneDrive or another file provider holds generated files open.
  distDir: process.env.MIRELI_NEXT_DIST_DIR || ".next",
  typescript: {
    ignoreBuildErrors: false,
  },
  reactStrictMode: true,
  // Long-lived caching for stable public assets (the service worker and HTML
  // keep their revalidation behaviour; only fingerprinted-style files opt in).
  async headers() {
    return [
      {
        source: "/icons/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=2592000, immutable" }],
      },
      {
        source: "/:file(mireli-logo.jpeg|mireli-logo.svg|logo.svg|favicon.svg)",
        headers: [{ key: "Cache-Control", value: "public, max-age=604800" }],
      },
    ];
  },
};

export default nextConfig;
