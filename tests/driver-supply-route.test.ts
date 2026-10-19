import { afterEach, describe, expect, it, vi } from "vitest";

const getEligibleDriverIds = vi.hoisted(() => vi.fn());
vi.mock("@/lib/driver/availability", () => ({ getEligibleDriverIds }));

import { GET } from "@/app/api/driver-supply/route";

afterEach(() => vi.resetAllMocks());

describe("public driver-supply summary", () => {
  it("returns only whether at least one eligible driver exists", async () => {
    getEligibleDriverIds.mockResolvedValue(["driver-1"]);
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ hasEligibleDrivers: true });
  });

  it("reports no approved supply without exposing driver records", async () => {
    getEligibleDriverIds.mockResolvedValue([]);
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ hasEligibleDrivers: false });
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
