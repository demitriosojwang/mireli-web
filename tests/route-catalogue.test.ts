import {afterEach, describe, expect, it, vi} from "vitest";
const query = vi.hoisted(() => ({pointCount: vi.fn()}));
vi.mock("@/lib/db", () => ({db: {
  routeStage: {count: query.pointCount},
}}));
import {GET} from "@/app/api/routes/route";
afterEach(() => vi.resetAllMocks());

describe("public stop-discovery bootstrap", () => {
  it("returns a zero count without reading driver supply or operating settings", async () => {
    query.pointCount.mockResolvedValue(0);
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({pointCount: 0});
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
    expect(result).toEqual({pointCount: 9});
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
