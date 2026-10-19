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
    expect(await response.json()).toEqual({ points: [{ ...point, fare: 400 }], hasMore: false });
    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        order: { gt: 0 },
        fare: { gt: 0 },
        homeSurcharge: { gte: 0 },
        route: { is: { active: true } },
        name: { contains: "mtwapa", mode: "insensitive" },
      }),
      take: 13,
    }));
  });

  it("uses the approved price for an older spelling without changing its display name", async () => {
    mocks.findMany.mockResolvedValue([{
      id: "stage-legacy",
      name: "Naivas Bamburi",
      order: 8,
      fare: 650,
      homeSurcharge: 60,
      routeId: "route-1",
      route: { id: "route-1", name: "Mombasa Terminus ↔ North Coast", charterPrice: 0 },
    }]);

    const response = await GET(request("naivas bamburi"));

    expect(await response.json()).toMatchObject({
      points: [{ id: "stage-legacy", name: "Naivas Bamburi", fare: 400 }],
    });
  });

  it("caps broad matches at twelve and marks when more stops exist", async () => {
    mocks.findMany.mockResolvedValue(Array.from({ length: 13 }, (_, index) => ({
      id: `stage-${index + 1}`,
      name: `Mtwapa ${index + 1}`,
      order: index + 1,
      fare: 400,
      homeSurcharge: 0,
      routeId: "route-1",
      route: { id: "route-1", name: "Mombasa Terminus ↔ North Coast", charterPrice: 0 },
    })));

    const response = await GET(request("mt"));
    const result = await response.json();

    expect(response.status).toBe(200);
    expect(result.points).toHaveLength(12);
    expect(result.hasMore).toBe(true);
    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 13 }));
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
