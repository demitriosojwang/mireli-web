import {afterEach, describe, expect, it, vi} from "vitest";
const query = vi.hoisted(() => ({pointCount: vi.fn(), configFindUnique: vi.fn()}));
vi.mock("@/lib/db", () => ({db: {routeStage: {count: query.pointCount}, platformConfig: {findUnique: query.configFindUnique}}}));
vi.mock("@/lib/engine", () => ({runOperationalTick: async () => {
  throw Object.assign(new Error("Operating settings are absent"), {status: 503, code: "PLATFORM_NOT_CONFIGURED"});
}}));
import {GET} from "@/app/api/routes/route";
afterEach(() => vi.resetAllMocks());

describe("public route catalogue on a fresh platform", () => {
  it("returns an empty catalogue without needing operating settings or creating records", async () => {
    query.pointCount.mockResolvedValue(0);
    query.configFindUnique.mockResolvedValue(null);
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({bookingFeeAmount: 50, pointCount: 0});
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
    const response = await GET();
    const result = await response.json();
    expect(response.status).toBe(200);
    expect(result).toEqual({bookingFeeAmount: 75, pointCount: 9});
  });

  it("keeps point discovery available with the confirmed default fee if config lookup fails", async () => {
    query.pointCount.mockResolvedValue(0);
    query.configFindUnique.mockRejectedValue(Object.assign(
      new Error("postgres://private:secret@database"),
      {code: "P2022"},
    ));
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({bookingFeeAmount: 50, pointCount: 0});
    expect(log).toHaveBeenCalledWith("route catalogue fee config failed", {code: "P2022"});
    expect(JSON.stringify(log.mock.calls)).not.toContain("secret");
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
