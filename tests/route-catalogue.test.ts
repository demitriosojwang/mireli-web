import {afterEach, describe, expect, it, vi} from "vitest";
const query = vi.hoisted(() => ({pointCount: vi.fn(), configFindUnique: vi.fn(), driverFindMany: vi.fn()}));
vi.mock("@/lib/db", () => ({db: {
  routeStage: {count: query.pointCount},
  platformConfig: {findUnique: query.configFindUnique},
  driver: {findMany: query.driverFindMany},
}}));
vi.mock("@/lib/engine", () => ({runOperationalTick: async () => {
  throw Object.assign(new Error("Operating settings are absent"), {status: 503, code: "PLATFORM_NOT_CONFIGURED"});
}}));
import {GET} from "@/app/api/routes/route";
afterEach(() => vi.resetAllMocks());

describe("public route catalogue on a fresh platform", () => {
  it("returns an empty catalogue without needing operating settings or creating records", async () => {
    query.pointCount.mockResolvedValue(0);
    query.configFindUnique.mockResolvedValue(null);
    query.driverFindMany.mockResolvedValue([]);
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({bookingFeeAmount: 50, pointCount: 0, hasEligibleDrivers: false});
    expect(query.pointCount).toHaveBeenCalledWith({
      where: {
        order: {gt: 0},
        fare: {gt: 0},
        homeSurcharge: {gte: 0},
        route: {is: {active: true}},
      },
    });
  });
  it("returns only the active customer-point count and configured booking fee", async () => {
    query.pointCount.mockResolvedValue(9);
    query.configFindUnique.mockResolvedValue({bookingFeeAmount: 75});
    query.driverFindMany.mockResolvedValue([]);
    const response = await GET();
    const result = await response.json();
    expect(response.status).toBe(200);
    expect(result).toEqual({bookingFeeAmount: 75, pointCount: 9, hasEligibleDrivers: false});
  });

  it("keeps point discovery available with the confirmed default fee if config lookup fails", async () => {
    query.pointCount.mockResolvedValue(0);
    query.driverFindMany.mockResolvedValue([]);
    query.configFindUnique.mockRejectedValue(Object.assign(
      new Error("postgres://private:secret@database"),
      {code: "P2022"},
    ));
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({bookingFeeAmount: 50, pointCount: 0, hasEligibleDrivers: false});
    expect(log).toHaveBeenCalledWith("route catalogue fee config failed", {code: "P2022"});
    expect(JSON.stringify(log.mock.calls)).not.toContain("secret");
  });

  it("returns a controlled unavailable response without leaking a database credential when point count fails", async () => {
    query.pointCount.mockRejectedValue(Object.assign(
      new Error("postgres://private:secret@database"),
      {code: "P1001"},
    ));
    query.driverFindMany.mockResolvedValue([]);
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await GET();

    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("secret");
    expect(log).toHaveBeenCalledWith("route catalogue point count failed", {code: "P1001"});
    expect(JSON.stringify(log.mock.calls)).not.toContain("secret");
  });

  it("keeps the route catalogue usable if the separate driver availability check fails", async () => {
    query.pointCount.mockResolvedValue(2);
    query.configFindUnique.mockResolvedValue({bookingFeeAmount: 50});
    query.driverFindMany.mockRejectedValue(Object.assign(new Error("database unavailable"), {code: "P1001"}));
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({bookingFeeAmount: 50, pointCount: 2, hasEligibleDrivers: null});
    expect(log).toHaveBeenCalledWith("route catalogue driver availability failed", {code: "P1001"});
  });
});
