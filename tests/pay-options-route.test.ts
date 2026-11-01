import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getPublicPayOptions = vi.hoisted(() => vi.fn());
vi.mock("@/lib/daraja", () => ({ getPublicPayOptions }));

import { GET } from "@/app/api/pay/options/route";

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());

describe("public payment-option discovery", () => {
  it("returns configured public methods without caching", async () => {
    getPublicPayOptions.mockResolvedValue({ paybill: "123456", methods: ["mpesa_stk", "mpesa_paybill"] });

    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ paybill: "123456", methods: ["mpesa_stk", "mpesa_paybill"] });
  });

  it("returns a sanitized unavailable response when payment configuration fails", async () => {
    getPublicPayOptions.mockRejectedValue(Object.assign(new Error("private credential details"), { code: "P1001" }));
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toEqual({ error: "Payment methods are temporarily unavailable.", code: "PAYMENT_OPTIONS_UNAVAILABLE" });
    expect(JSON.stringify(body)).not.toContain("private credential details");
    expect(log).toHaveBeenCalledWith("payment option discovery failed", { code: "P1001" });
  });
});
