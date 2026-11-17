import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
const query = vi.hoisted(() => ({pointCount: vi.fn(), routeFindMany: vi.fn(), offstageQuoteRouteIds: vi.fn(), hasCompleteOffstageStageLocations: vi.fn()}));
vi.mock("@/lib/db", () => ({db: {
  routeStage: {count: query.pointCount},
  route: {findMany: query.routeFindMany},
}}));
vi.mock("@/lib/offstage-quote", () => ({
  getEnabledOffstageQuoteRouteIds: query.offstageQuoteRouteIds,
  hasCompleteOffstageStageLocations: query.hasCompleteOffstageStageLocations,
}));
import {GET} from "@/app/api/routes/route";
beforeEach(() => {
  query.offstageQuoteRouteIds.mockReturnValue([]);
  query.hasCompleteOffstageStageLocations.mockReturnValue(true);
  query.routeFindMany.mockResolvedValue([]);
});
afterEach(() => vi.resetAllMocks());

describe("public stop-discovery bootstrap", () => {
  it("returns a zero count without reading driver supply or operating settings", async () => {
    query.pointCount.mockResolvedValue(0);
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({pointCount: 0, offstageQuoteRouteIds: []});
    expect(query.pointCount).toHaveBeenCalledWith({
      where: {
        order: {gt: 0},
        fare: {gt: 0},
        homeSurcharge: {gte: 0},
        route: {is: {active: true}},
      },
    });
  });
  it("returns only the count of active, priced customer stops", async () => {
    query.pointCount.mockResolvedValue(9);
    const response = await GET();
    const result = await response.json();
    expect(response.status).toBe(200);
    expect(result).toEqual({pointCount: 9, offstageQuoteRouteIds: []});
  });

  it("reports only the server-approved off-stage route allowlist", async () => {
    query.pointCount.mockResolvedValue(9);
    query.offstageQuoteRouteIds.mockReturnValue(["route-verified", "route-unreviewed"]);
    query.routeFindMany.mockResolvedValue([
      {id: "route-verified", stages: [{name: "Nyali Centre", order: 1, lat: -4.02, lng: 39.71, fare: 400}]},
      {id: "route-unreviewed", stages: [{name: "Mtwapa", order: 1, lat: 0, lng: 0, fare: 400}]},
    ]);
    query.hasCompleteOffstageStageLocations.mockImplementation((stages: unknown[]) =>
      (stages[0] as {name: string}).name === "Nyali Centre");

    const response = await GET();

    expect(await response.json()).toEqual({pointCount: 9, offstageQuoteRouteIds: ["route-verified"]});
    expect(query.routeFindMany).toHaveBeenCalledWith({
      where: {id: {in: ["route-verified", "route-unreviewed"]}, active: true},
      select: {id: true, stages: {where: {order: {gt: 0}}, select: {name: true, order: true, lat: true, lng: true, fare: true}}},
    });
  });

  it("returns a controlled unavailable response without leaking a database credential when point count fails", async () => {
    query.pointCount.mockRejectedValue(Object.assign(
      new Error("postgres://private:secret@database"),
      {code: "P1001"},
    ));
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await GET();

    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("secret");
    expect(log).toHaveBeenCalledWith("route catalogue point count failed", {code: "P1001"});
    expect(JSON.stringify(log.mock.calls)).not.toContain("secret");
  });

});
