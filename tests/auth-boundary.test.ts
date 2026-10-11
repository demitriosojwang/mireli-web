import { afterEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/session", () => ({
  encodeSession: vi.fn(), getPassengerSession: vi.fn(), getAdminSession: vi.fn(),
  isAdminEmail: vi.fn(), normalizePhone: vi.fn(), passengerCookieOptions: vi.fn(), adminCookieOptions: vi.fn(),
}));
vi.mock("@/lib/money", () => ({ getConfig: vi.fn(() => { throw new Error("Must not query database"); }), issueCredit: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
import { POST as passengerLogin } from "@/app/api/auth/route";
import { POST as adminLogin } from "@/app/api/admin/auth/route";

afterEach(() => vi.unstubAllEnvs());
it.each([passengerLogin, adminLogin])("rejects prototype login before querying production data", async (handler) => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("MIRELI_DEMO_MODE", "true");
  const response = await handler(new NextRequest("https://example.test/api/auth", {
    method: "POST", body: JSON.stringify({ step: "verify", challengeId: "a".repeat(48), code: "123456" }), headers: { "content-type": "application/json" },
  }));
  expect(response.status).toBe(503);
});
