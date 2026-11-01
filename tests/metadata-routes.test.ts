import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("public crawler metadata", () => {
  it("keeps the local preview out of search indexes", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("MIRELI_DEMO_MODE", "true");
    vi.stubEnv("MIRELI_ALLOW_UNSAFE_DEMO", "true");
    vi.stubEnv("MIRELI_PUBLIC_ORIGIN", "http://localhost:3000");
    vi.resetModules();

    const [{ default: sitemap }, { default: robots }] = await Promise.all([
      import("@/app/sitemap"),
      import("@/app/robots"),
    ]);

    expect(sitemap()).toEqual([]);
    expect(robots()).toEqual({ rules: { userAgent: "*", disallow: "/" } });
  });

  it("publishes the production homepage but excludes private workflows", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("MIRELI_DEMO_MODE", "false");
    vi.stubEnv("MIRELI_ALLOW_UNSAFE_DEMO", "true");
    vi.stubEnv("MIRELI_PUBLIC_ORIGIN", "https://mirelisgr.duckdns.org/");
    vi.resetModules();

    const [{ default: sitemap }, { default: robots }] = await Promise.all([
      import("@/app/sitemap"),
      import("@/app/robots"),
    ]);

    expect(sitemap()).toEqual([
      { url: "https://mirelisgr.duckdns.org", changeFrequency: "weekly", priority: 1 },
    ]);
    expect(robots()).toEqual({
      rules: {
        userAgent: "*",
        allow: "/",
        disallow: ["/admin", "/api", "/bookings", "/credits", "/login"],
      },
      sitemap: "https://mirelisgr.duckdns.org/sitemap.xml",
    });
  });
});
