import { afterEach, describe, expect, it, vi } from "vitest";

const configFindUnique = vi.hoisted(() => vi.fn());
vi.mock("@/lib/db", () => ({ db: { platformConfig: { findUnique: configFindUnique } } }));

import { GET } from "@/app/api/booking-fee/route";

afterEach(() => vi.resetAllMocks());

describe("public booking-fee discovery", () => {
  it("returns the saved fee", async () => {
    configFindUnique.mockResolvedValue({ bookingFeeAmount: 75 });
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ bookingFeeAmount: 75 });
  });

  it("uses the confirmed KSh 50 fee when no platform config exists", async () => {
    configFindUnique.mockResolvedValue(null);
    const response = await GET();
    expect(await response.json()).toEqual({ bookingFeeAmount: 50 });
  });

  it("does not publish an invalid fee value from a corrupted config row", async () => {
    configFindUnique.mockResolvedValue({ bookingFeeAmount: -1 });
    const response = await GET();
    expect(await response.json()).toEqual({ bookingFeeAmount: 50 });
  });

  it("falls back to the confirmed fee on config failure without logging secrets", async () => {
    configFindUnique.mockRejectedValue(Object.assign(new Error("postgres://private:secret@database"), { code: "P1001" }));
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ bookingFeeAmount: 50 });
    expect(log).toHaveBeenCalledWith("booking fee discovery failed", { code: "P1001" });
    expect(JSON.stringify(log.mock.calls)).not.toContain("secret");
  });
});
