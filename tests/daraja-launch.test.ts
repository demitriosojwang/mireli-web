import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  config: {} as Record<string, unknown>,
  update: vi.fn(),
  fetch: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db: { platformConfig: {
  findUnique: async () => mocks.config,
  update: mocks.update,
} } }));
vi.mock("@/lib/session", () => ({ getAdminSession: async () => ({ id: "admin-1", name: "Admin" }) }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));

import { GET, POST, PUT } from "@/app/api/admin/payments/route";
import { resolveDaraja } from "@/lib/daraja";

function request(method: string, body: Record<string, string>) {
  return new NextRequest("https://mireli.test/api/admin/payments", {
    method, body: JSON.stringify(body), headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  for (const key of Object.keys(process.env).filter(name => name.startsWith("MPESA_"))) vi.stubEnv(key, "");
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("MIRELI_DEMO_MODE", "false");
  vi.stubEnv("SESSION_SECRET", "test-session-secret-for-launch-checks");
  vi.stubGlobal("fetch", mocks.fetch);
  mocks.config = { id: "main" };
  mocks.update.mockImplementation(async ({ data }) => Object.assign(mocks.config, data));
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("Daraja setup without provider credentials", () => {
  it("opens, saves partial setup, and reports missing settings without enabling payment", async () => {
    const initial = await GET();
    expect(initial.status).toBe(200);
    expect(await initial.json()).toMatchObject({ status: { mode: "unconfigured", livePayoutsEnabled: false } });
    const save = await PUT(request("PUT", { environment: "production", shortcode: "123456", callbackBaseUrl: "https://mireli.test" }));
    expect(save.status).toBe(200);
    expect(await save.json()).toMatchObject({ ok: true, mode: "unconfigured" });
    const check = await POST(request("POST", { action: "test_connection" }));
    expect(await check.json()).toMatchObject({ ok: false, mode: "unconfigured" });
    await expect(resolveDaraja()).rejects.toThrow("M-Pesa is not configured");
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("distinguishes an OAuth connection from B2C readiness and never discloses the access token", async () => {
    Object.assign(mocks.config, { mpesaConsumerKey: "synthetic-key", mpesaConsumerSecret: "synthetic-secret",
      mpesaShortcode: "123456", mpesaPasskey: "synthetic-passkey", mpesaEnvironment: "production",
      mpesaCallbackBaseUrl: "https://mireli.test" });
    vi.stubEnv("MPESA_LIVE_PAYOUTS_ENABLED", "true");
    const settings = await GET();
    expect(await settings.json()).toMatchObject({ status: {
      mode: "live", livePayoutsEnabled: false, payoutIssues: expect.arrayContaining(["Enter the approved B2C shortcode."]),
    } });
    mocks.fetch.mockResolvedValueOnce(Response.json({ access_token: "private-test-token", expires_in: "3600" }));
    const check = await POST(request("POST", { action: "test_connection" }));
    const result = await check.json();
    expect(result).toMatchObject({ ok: true, mode: "live" });
    expect(result.message).toContain("Enter the approved B2C shortcode.");
    expect(result.message).not.toContain("private");
    expect(mocks.fetch).toHaveBeenCalledOnce();
  });
});
