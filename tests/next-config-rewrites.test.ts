import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import nextConfig from "../next.config";

beforeEach(() => {
  vi.stubEnv("VERCEL_URL", "");
  vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "");
});

afterEach(() => vi.unstubAllEnvs());

describe("Vercel-to-Docker API rewrite", () => {
  it("leaves local and preview builds on their own API when no origin is configured", async () => {
    vi.stubEnv("MIRELI_API_ORIGIN", "");
    vi.stubEnv("VERCEL_ENV", "preview");

    await expect(nextConfig.rewrites?.()).resolves.toEqual({ beforeFiles: [], afterFiles: [], fallback: [] });
  });

  it("forwards the same API path to the configured HTTPS backend origin", async () => {
    vi.stubEnv("MIRELI_API_ORIGIN", "https://api.example.com/");
    vi.stubEnv("VERCEL_ENV", "preview");

    await expect(nextConfig.rewrites?.()).resolves.toEqual({
      beforeFiles: [{ source: "/api/:path*", destination: "https://api.example.com/api/:path*" }],
      afterFiles: [],
      fallback: [],
    });
  });

  it("fails closed when a Vercel production build has no backend origin", async () => {
    vi.stubEnv("MIRELI_API_ORIGIN", "");
    vi.stubEnv("VERCEL_ENV", "production");

    await expect(nextConfig.rewrites?.()).rejects.toThrow("MIRELI_API_ORIGIN is required");
  });

  it.each([
    "http://api.example.com",
    "https://api.example.com/v1",
    "https://user:password@api.example.com",
    "https://api.example.com?token=secret",
  ])("rejects an unsafe or non-origin backend URL: %s", async (origin) => {
    vi.stubEnv("MIRELI_API_ORIGIN", origin);
    vi.stubEnv("VERCEL_ENV", "preview");

    await expect(nextConfig.rewrites?.()).rejects.toThrow("origin-only HTTPS URL");
  });

  it("rejects a rewrite back to the same Vercel frontend", async () => {
    vi.stubEnv("MIRELI_API_ORIGIN", "https://mireli-tau.vercel.app");
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "mireli-tau.vercel.app");

    await expect(nextConfig.rewrites?.()).rejects.toThrow("not this Vercel deployment");
  });
});

