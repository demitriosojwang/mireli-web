import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const findMany = vi.hoisted(() => vi.fn());
vi.mock("@/lib/db", () => ({db: {routeStage: {findMany}}}));

import { GET } from "@/app/api/stages/route";

const request = (query: string) => new NextRequest(`https://mireli.test/api/stages?${query}`);

const point = (index: number) => ({
  id: `point-${index}`,
  name: `Mtwapa ${index}`,
  order: index,
  fare: 700,
  homeSurcharge: 150,
  routeId: "route-north",
  route: {id: "route-north", name: "Mombasa Terminus ↔ North Coast", charterPrice: 4200},
});

beforeEach(() => {
  vi.clearAllMocks();
  findMany.mockResolvedValue([point(1)]);
});

afterEach(() => vi.restoreAllMocks());

describe("public stage point search", () => {
  it("does not query the database until the passenger enters at least two characters", async () => {
    const response = await GET(request("q=m"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({points: [], hasMore: false});
    expect(findMany).not.toHaveBeenCalled();
  });

  it("searches active non-terminus points and returns only booking fields", async () => {
    const response = await GET(request("q=%20Mtwapa%20"));
    const result = await response.json();

    expect(response.status).toBe(200);
    expect(result).toEqual({points: [point(1)], hasMore: false});
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        order: {gt: 0},
        route: {is: {active: true}},
        OR: [
          {name: {contains: "Mtwapa", mode: "insensitive"}},
          {route: {is: {name: {contains: "Mtwapa", mode: "insensitive"}}}},
        ],
      }),
      take: 13,
      select: expect.objectContaining({
        id: true,
        name: true,
        fare: true,
        homeSurcharge: true,
        route: {select: {id: true, name: true, charterPrice: true}},
      }),
    }));
    expect(result.points[0]).not.toHaveProperty("lat");
    expect(result.points[0]).not.toHaveProperty("lng");
  });

  it("caps results and tells the customer when to narrow the search", async () => {
    findMany.mockResolvedValue(Array.from({length: 13}, (_, index) => point(index + 1)));

    const response = await GET(request("q=coast"));
    const result = await response.json();

    expect(result.points).toHaveLength(12);
    expect(result.hasMore).toBe(true);
  });

  it("rejects oversized searches before querying the database", async () => {
    const response = await GET(request(`q=${"a".repeat(81)}`));

    expect(response.status).toBe(400);
    expect(findMany).not.toHaveBeenCalled();
  });

  it("returns a controlled error without exposing a database credential", async () => {
    findMany.mockRejectedValue(new Error("postgres://private:secret@database"));

    const response = await GET(request("q=mtwapa"));

    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("secret");
  });
});

