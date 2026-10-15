import type { NextConfig } from "next";

function getMireliApiOrigin(): string | null {
  const configuredOrigin = process.env.MIRELI_API_ORIGIN?.trim();
  const isVercelProductionBuild = process.env.VERCEL_ENV === "production";

  if (!configuredOrigin) {
    if (isVercelProductionBuild) {
      throw new Error("MIRELI_API_ORIGIN is required for Vercel production builds.");
    }
    return null;
  }

  let parsedOrigin: URL;
  try {
    parsedOrigin = new URL(configuredOrigin);
  } catch {
    throw new Error("MIRELI_API_ORIGIN must be an origin-only HTTPS URL.");
  }

  if (
    parsedOrigin.protocol !== "https:" ||
    parsedOrigin.username ||
    parsedOrigin.password ||
    parsedOrigin.pathname !== "/" ||
    parsedOrigin.search ||
    parsedOrigin.hash
  ) {
    throw new Error("MIRELI_API_ORIGIN must be an origin-only HTTPS URL without credentials, path, query, or fragment.");
  }

  const vercelHosts = [process.env.VERCEL_URL, process.env.VERCEL_PROJECT_PRODUCTION_URL]
    .filter((host): host is string => Boolean(host))
    .map((host) => {
      try {
        return new URL(host.startsWith("http://") || host.startsWith("https://") ? host : `https://${host}`).hostname;
      } catch {
        return null;
      }
    });
  if (vercelHosts.includes(parsedOrigin.hostname)) {
    throw new Error("MIRELI_API_ORIGIN must point to the shared backend, not this Vercel deployment.");
  }

  return parsedOrigin.origin;
}

const nextConfig: NextConfig = {
  output: "standalone",
  typescript: {
    ignoreBuildErrors: false,
  },
  reactStrictMode: true,
  async rewrites() {
    const apiOrigin = getMireliApiOrigin();
    return {
      beforeFiles: apiOrigin
        ? [{ source: "/api/:path*", destination: `${apiOrigin}/api/:path*` }]
        : [],
      afterFiles: [],
      fallback: [],
    };
  },
};

export default nextConfig;

