import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rateUpsert: vi.fn(),
  challengeCreate: vi.fn(),
  challengeFindUnique: vi.fn(),
  challengeUpdateMany: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    driverRateLimit: { upsert: mocks.rateUpsert },
    driverAuthChallenge: {
      create: mocks.challengeCreate,
      findUnique: mocks.challengeFindUnique,
      updateMany: mocks.challengeUpdateMany,
    },
  },
}));

import { requestPassengerChallenge, verifyPassengerChallenge } from "@/lib/passenger-auth";

const hash = (id: string, code: string) =>
  createHmac("sha256", process.env.DRIVER_AUTH_SECRET!).update(`${id}:${code}`).digest("hex");

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("MIRELI_DEMO_MODE", "false");
  vi.stubEnv("VERCEL", "1");
  vi.stubEnv("DRIVER_AUTH_SECRET", "a".repeat(48));
  vi.stubEnv("SESSION_SECRET", "b".repeat(48));
  vi.stubEnv("AT_USERNAME", "mireli-test");
  vi.stubEnv("AT_API_KEY", "test-key");
  vi.stubEnv("BREVO_API_KEY", "test-key");
  vi.stubEnv("BREVO_SENDER_EMAIL", "login@example.com");
  mocks.rateUpsert.mockResolvedValue({ count: 1 });
  mocks.challengeCreate.mockImplementation(async ({ data }) => data);
  mocks.challengeUpdateMany.mockResolvedValue({ count: 1 });
  mocks.fetch.mockResolvedValue({
    ok: true,
    json: async () => ({ SMSMessageData: { Recipients: [{ statusCode: 101 }] }, messageId: "mail-id" }),
  });
  vi.stubGlobal("fetch", mocks.fetch);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("passenger verification challenges", () => {
  it("sends a six-digit SMS code, stores only its hash, and never returns the code in production", async () => {
    const result = await requestPassengerChallenge("0712 345 678");
    const data = mocks.challengeCreate.mock.calls[0][0].data;
    const body = mocks.fetch.mock.calls[0][1].body as URLSearchParams;
    const code = body.get("message")?.match(/\b\d{6}\b/)?.[0];

    expect(result).not.toHaveProperty("demoCode");
    expect(result).toMatchObject({ challengeId: expect.stringMatching(/^[a-f0-9]{48}$/), cooldownSeconds: 60 });
    expect(data).toMatchObject({ channel: "passenger_sms", phone: "+254712345678", email: null });
    expect(code).toMatch(/^\d{6}$/);
    expect(data.codeHash).toBe(hash(result.challengeId, code!));
    expect(data.codeHash).not.toBe(code);
    expect(mocks.fetch).toHaveBeenCalledOnce();
  });

  it("sends passenger email codes through the configured mail provider", async () => {
    const result = await requestPassengerChallenge("Passenger@Example.com");
    const data = mocks.challengeCreate.mock.calls[0][0].data;
    const request = JSON.parse(mocks.fetch.mock.calls[0][1].body as string);

    expect(result).not.toHaveProperty("demoCode");
    expect(data).toMatchObject({ channel: "passenger_email", email: "passenger@example.com", phone: null });
    expect(request.subject).toBe("Your Mi-Reli verification code");
    expect(request.to).toEqual([{ email: "passenger@example.com" }]);
  });

  it("returns a demo code only in explicitly enabled local demo mode", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("MIRELI_DEMO_MODE", "true");
    vi.stubEnv("VERCEL", "");

    const result = await requestPassengerChallenge("0712345678");

    expect(result).toMatchObject({ simulation: true, demoCode: expect.stringMatching(/^\d{6}$/) });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("rate limits requests before creating a challenge or contacting a provider", async () => {
    mocks.rateUpsert.mockResolvedValue({ count: 2 });

    await expect(requestPassengerChallenge("0712345678")).rejects.toMatchObject({ status: 429, code: "RATE_LIMITED" });
    expect(mocks.challengeCreate).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("invalidates the challenge when provider delivery fails", async () => {
    mocks.fetch.mockResolvedValue({ ok: false, json: async () => ({}) });

    await expect(requestPassengerChallenge("0712345678")).rejects.toMatchObject({ status: 503, code: "VERIFICATION_UNAVAILABLE" });
    expect(mocks.challengeUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ consumedAt: null }),
      data: { consumedAt: expect.any(Date) },
    }));
  });

  it("accepts only a valid passenger-scoped, unexpired code and denies driver challenges", async () => {
    const id = "a".repeat(48);
    mocks.challengeFindUnique.mockResolvedValue({
      id,
      channel: "passenger_sms",
      phone: "+254712345678",
      email: null,
      codeHash: hash(id, "123456"),
      expiresAt: new Date(Date.now() + 60000),
      consumedAt: null,
      attempts: 0,
    });

    await expect(verifyPassengerChallenge(id, "123456")).resolves.toMatchObject({
      id,
      channel: "passenger_sms",
      phone: "+254712345678",
    });
    expect(mocks.challengeUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ channel: "passenger_sms", attempts: { lt: 5 } }),
      data: { attempts: { increment: 1 } },
    }));

    mocks.challengeFindUnique.mockResolvedValueOnce({
      id,
      channel: "sms",
      phone: "+254712345678",
      email: null,
      codeHash: hash(id, "123456"),
      expiresAt: new Date(Date.now() + 60000),
      consumedAt: null,
      attempts: 0,
    });
    await expect(verifyPassengerChallenge(id, "123456")).rejects.toMatchObject({ status: 401, code: "INVALID_CHALLENGE" });
  });

  it("does not accept a code after the challenge expires or its attempt budget is spent", async () => {
    const id = "b".repeat(48);
    mocks.challengeFindUnique.mockResolvedValue({
      id,
      channel: "passenger_email",
      phone: null,
      email: "passenger@example.com",
      codeHash: hash(id, "123456"),
      expiresAt: new Date(0),
      consumedAt: null,
      attempts: 0,
    });
    await expect(verifyPassengerChallenge(id, "123456")).rejects.toMatchObject({ status: 401 });

    mocks.challengeFindUnique.mockResolvedValueOnce({
      id,
      channel: "passenger_email",
      phone: null,
      email: "passenger@example.com",
      codeHash: hash(id, "123456"),
      expiresAt: new Date(Date.now() + 60000),
      consumedAt: null,
      attempts: 5,
    });
    await expect(verifyPassengerChallenge(id, "123456")).rejects.toMatchObject({ status: 401 });
  });
});
