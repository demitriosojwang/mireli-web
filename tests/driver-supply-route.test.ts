import { afterEach, describe, expect, it, vi } from "vitest";

const getEligibleDriverIds = vi.hoisted(() => vi.fn());
const driverGroupBy = vi.hoisted(() => vi.fn());
vi.mock("@/lib/driver/availability", () => ({ getEligibleDriverIds }));
vi.mock("@/lib/db", () => ({
  db: { driver: { groupBy: driverGroupBy } },
}));

import { GET } from "@/app/api/driver-supply/route";

afterEach(() => vi.resetAllMocks());

describe("public driver-supply summary", () => {
  it("returns an aggregate count without exposing driver identities", async () => {
    getEligibleDriverIds.mockResolvedValue(["driver-1"]);
    driverGroupBy.mockResolvedValue([{ cabType: "14-seater matatu", _count: { _all: 1 } }]);
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      hasEligibleDrivers: true,
      eligibleDriverCount: 1,
      cabTypes: [{ cabType: "14-seater matatu", count: 1 }],
    });
  });

  it("reports no approved supply without exposing driver records", async () => {
    getEligibleDriverIds.mockResolvedValue([]);
    driverGroupBy.mockResolvedValue([]);
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      hasEligibleDrivers: false,
      eligibleDriverCount: 0,
      cabTypes: [],
    });
  });

  it("returns an unavailable status if the eligibility check fails", async () => {
    getEligibleDriverIds.mockRejectedValue(Object.assign(new Error("database unavailable"), { code: "P1001" }));
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await GET();

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Driver availability is temporarily unavailable." });
    expect(log).toHaveBeenCalledWith("driver supply check failed", { code: "P1001" });
  });
});
