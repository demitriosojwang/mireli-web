import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ findMany: vi.fn() }));

vi.mock("@/lib/db", () => ({
  db: { routeStage: { findMany: mocks.findMany } },
}));

import { GET } from "@/app/api/stages/route";

const request = (query: string) => new NextRequest(`https://mireli.test/api/stages?q=${encodeURIComponent(query)}`);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findMany.mockResolvedValue([]);
});

afterEach(() => vi.restoreAllMocks());

describe("public customer stop search", () => {
  it("does not query the database until the search has two characters", async () => {
    const response = await GET(request("m"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ points: [], hasMore: false });
    expect(mocks.findMany).not.toHaveBeenCalled();
  });

  it("searches active routes for only stops with usable fare data", async () => {
    const point = {
      id: "stage-1",
      name: "Mtwapa",
      order: 1,
      fare: 700,
      homeSurcharge: 200,
      routeId: "route-1",
      route: { id: "route-1", name: "Mombasa Terminus ↔ North Coast", charterPrice: 4000 },
    };
    mocks.findMany.mockResolvedValue([point]);

    const response = await GET(request("mtwapa"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ points: [point], hasMore: false });
    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        order: { gt: 0 },
        fare: { gt: 0 },
        homeSurcharge: { gte: 0 },
        route: { is: { active: true } },
      }),
      take: 13,
    }));
  });

  it("rejects overly long searches before querying the database", async () => {
    const response = await GET(request("x".repeat(81)));

    expect(response.status).toBe(400);
    expect(mocks.findMany).not.toHaveBeenCalled();
  });

  it("returns a retryable service error if the catalogue query fails", async () => {
    mocks.findMany.mockRejectedValue(new Error("database unavailable"));

    const response = await GET(request("mtwapa"));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Point search is temporarily unavailable." });
  });
});
