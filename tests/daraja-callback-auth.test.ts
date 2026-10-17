import { afterEach, describe, expect, it, vi } from "vitest";
import { callbackUrls, stkPush, verifyCallbackToken, type DarajaCredentials } from "@/lib/daraja";

const mocks = vi.hoisted(() => ({ platformConfigFindUnique: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { platformConfig: { findUnique: mocks.platformConfigFindUnique } } }));

const creds = { callbackBaseUrl: "https://mireli.example" } as DarajaCredentials;

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("Daraja callback authorization", () => {
  it("signs each configured webhook URL for its own callback type", () => {
    vi.stubEnv("SESSION_SECRET", "mireli-test-secret-that-is-long-enough-123456");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("MIRELI_DEMO_MODE", "false");

    const urls = callbackUrls(creds);
    const c2b = new URL(urls.c2bConfirmation);
    const stk = new URL(urls.stkResult);
    const c2bToken = c2b.searchParams.get("mireli_token");

    expect(c2b.origin).toBe("https://mireli.example");
    expect(verifyCallbackToken("c2b", c2bToken)).toBe(true);
    expect(verifyCallbackToken("stk", c2bToken)).toBe(false);
    expect(verifyCallbackToken("stk", stk.searchParams.get("mireli_token"))).toBe(true);
    expect(verifyCallbackToken("c2b", "invalid")).toBe(false);
  });

  it("fails closed when production has no signing key", () => {
    vi.stubEnv("SESSION_SECRET", "");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("MIRELI_DEMO_MODE", "false");

    expect(() => callbackUrls(creds)).toThrow("SESSION_SECRET");
    expect(verifyCallbackToken("c2b", null)).toBe(false);
  });

  it("sends the signed intent URL to the STK callback without exposing provider IDs to the passenger", async () => {
    vi.stubEnv("SESSION_SECRET", "mireli-test-secret-that-is-long-enough-123456");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("MIRELI_DEMO_MODE", "false");
    vi.stubEnv("MPESA_MODE", "");
    vi.stubEnv("MPESA_ENVIRONMENT", "sandbox");
    vi.stubEnv("MPESA_CONSUMER_KEY", `test-key-${Date.now()}`);
    vi.stubEnv("MPESA_CONSUMER_SECRET", "test-consumer-secret");
    vi.stubEnv("MPESA_SHORTCODE", "174379");
    vi.stubEnv("MPESA_PASSKEY", "test-passkey");
    vi.stubEnv("MPESA_CALLBACK_BASE_URL", "https://mireli.example");
    mocks.platformConfigFindUnique.mockResolvedValue(null);

    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: "token", expires_in: "3599" }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ResponseCode: "0", CheckoutRequestID: "ws_CO_123", MerchantRequestID: "merchant-1" }) });
    vi.stubGlobal("fetch", fetchMock);

    const result = await stkPush("+254712345678", 500, "MR-ABC123", "tx-123");
    const payload = JSON.parse(fetchMock.mock.calls[1][1].body as string) as { CallBackURL: string; QueueTimeOutURL?: string };
    const callback = new URL(payload.CallBackURL);

    expect(result.ok).toBe(true);
    expect(callback.searchParams.get("intent")).toBe("tx-123");
    expect(verifyCallbackToken("stk", callback.searchParams.get("mireli_token"))).toBe(true);
    expect(payload.QueueTimeOutURL).toBeUndefined();
  });
});
