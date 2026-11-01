import { describe, expect, it } from "vitest";
import nextConfig from "../next.config";

describe("self-hosted Next.js configuration", () => {
  it("serves API routes from the same standalone server without an external rewrite", () => {
    expect(nextConfig.output).toBe("standalone");
    expect(nextConfig.rewrites).toBeUndefined();
  });
});

