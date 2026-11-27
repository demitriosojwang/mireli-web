import { afterEach, describe, expect, it, vi } from "vitest";
import { b2c, callbackUrls, getPublicPayOptions, stkPush, verifyCallbackToken, type DarajaCredentials } from "@/lib/daraja";

const mocks = vi.hoisted(() => ({ platformConfigFindUnique: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { platformConfig: { findUnique: mocks.platformConfigFindUnique } } }));

const creds = { callbackBaseUrl: "https://mireli.example" } as DarajaCredentials;

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("Daraja callback authorization", () => {
  it("does not advertise M-Pesa in strict production without complete provider credentials", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("MIRELI_DEMO_MODE", "false");
    vi.stubEnv("MIRELI_ALLOW_UNSAFE_DEMO", "");
    vi.stubEnv("MPESA_MODE", "");
    vi.stubEnv("MPESA_CONSUMER_KEY", "");
    vi.stubEnv("MPESA_CONSUMER_SECRET", "");
    vi.stubEnv("MPESA_SHORTCODE", "");
    vi.stubEnv("MPESA_PASSKEY", "");
    mocks.platformConfigFindUnique.mockResolvedValue(null);

    await expect(getPublicPayOptions()).rejects.toThrow("M-Pesa is not configured");
  });

  it("requires a configured public HTTPS callback before advertising strict-mode STK", async () => {
    vi.stubEnv("SESSION_SECRET", "mireli-test-secret-that-is-long-enough-123456");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("MIRELI_DEMO_MODE", "false");
    vi.stubEnv("MIRELI_ALLOW_UNSAFE_DEMO", "");
    vi.stubEnv("MPESA_MODE", "");
    vi.stubEnv("MPESA_CONSUMER_KEY", "test-consumer-key");
    vi.stubEnv("MPESA_CONSUMER_SECRET", "test-consumer-secret");
    vi.stubEnv("MPESA_SHORTCODE", "174379");
    vi.stubEnv("MPESA_PASSKEY", "test-passkey");
    mocks.platformConfigFindUnique.mockResolvedValue(null);

    vi.stubEnv("MPESA_CALLBACK_BASE_URL", "");
    await expect(getPublicPayOptions()).rejects.toThrow("callback base URL is not configured");

    vi.stubEnv("MPESA_CALLBACK_BASE_URL", "http://mireli.example");
    await expect(getPublicPayOptions()).rejects.toThrow("require a public HTTPS origin");
  });

  it("advertises strict-mode STK only after credentials, callback URL, and signer are ready", async () => {
    vi.stubEnv("SESSION_SECRET", "mireli-test-secret-that-is-long-enough-123456");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("MIRELI_DEMO_MODE", "false");
    vi.stubEnv("MIRELI_ALLOW_UNSAFE_DEMO", "");
    vi.stubEnv("MPESA_MODE", "");
    vi.stubEnv("MPESA_CONSUMER_KEY", "test-consumer-key");
    vi.stubEnv("MPESA_CONSUMER_SECRET", "test-consumer-secret");
    vi.stubEnv("MPESA_SHORTCODE", "174379");
    vi.stubEnv("MPESA_PASSKEY", "test-passkey");
    vi.stubEnv("MPESA_CALLBACK_BASE_URL", "https://mireli.example");
    mocks.platformConfigFindUnique.mockResolvedValue(null);

    await expect(getPublicPayOptions()).resolves.toEqual({
      paybill: "174379",
      methods: ["mpesa_stk", "mpesa_paybill"],
    });
    vi.stubEnv("MPESA_MANUAL_PAYBILL_ENABLED", "false");
    await expect(getPublicPayOptions()).resolves.toEqual({ paybill: null, methods: ["mpesa_stk"] });
  });

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
    vi.stubEnv("MPESA_STK_TRANSACTION_TYPE", "CustomerBuyGoodsOnline");
    vi.stubEnv("MPESA_STK_PARTY_B", "654321");
    mocks.platformConfigFindUnique.mockResolvedValue(null);

    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: "token", expires_in: "3599" }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ResponseCode: "0", CheckoutRequestID: "ws_CO_123", MerchantRequestID: "merchant-1" }) });
    vi.stubGlobal("fetch", fetchMock);

    const result = await stkPush("+254712345678", 500, "MR-ABC123", "tx-123");
    const payload = JSON.parse(fetchMock.mock.calls[1][1].body as string);
    const callback = new URL(payload.CallBackURL);

    expect(result.ok).toBe(true);
    expect(payload).toMatchObject({ BusinessShortCode: "174379", PartyB: "654321", TransactionType: "CustomerBuyGoodsOnline" });
    expect(callback.searchParams.get("intent")).toBe("tx-123");
    expect(verifyCallbackToken("stk", callback.searchParams.get("mireli_token"))).toBe(true);
    expect(payload.QueueTimeOutURL).toBeUndefined();
  });

  it("uses the provisioned B2C v1 endpoint and returns the provider-generated correlation IDs", async () => {
    vi.stubEnv("MPESA_MODE", "");
    vi.stubEnv("MPESA_ENVIRONMENT", "production");
    vi.stubEnv("MPESA_CONSUMER_KEY", "test-b2c-key");
    vi.stubEnv("MPESA_CONSUMER_SECRET", "test-b2c-secret");
    vi.stubEnv("MPESA_SHORTCODE", "174379");
    vi.stubEnv("MPESA_PASSKEY", "test-passkey");
    vi.stubEnv("MPESA_B2C_SHORTCODE", "654321");
    vi.stubEnv("MPESA_INITIATOR_NAME", "test-operator");
    vi.stubEnv("MPESA_SECURITY_CREDENTIAL", "test-security-credential");
    mocks.platformConfigFindUnique.mockResolvedValue(null);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: "token", expires_in: "3599" }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ResponseCode: "0", ConversationID: "provider-conversation", OriginatorConversationID: "provider-originator" }) });
    vi.stubGlobal("fetch", fetchMock);

    const result = await b2c({ apiVersion: "v1", receiverPhone: "+254712345678", amount: 500,
      resultUrl: "https://mireli.example/result", timeoutUrl: "https://mireli.example/timeout" });

    expect(fetchMock.mock.calls[1][0]).toBe("https://api.safaricom.co.ke/mpesa/b2c/v1/paymentrequest");
    const payload = JSON.parse(fetchMock.mock.calls[1][1].body as string);
    expect(payload).toMatchObject({ Amount: 500, PartyA: "654321", PartyB: "254712345678", CommandID: "BusinessPayment" });
    expect(payload.OriginatorConversationID).toBeUndefined();
    expect(result).toMatchObject({ resultCode: "ACCEPTED", settled: false, conversationId: "provider-conversation", originatorId: "provider-originator" });
  });
});
