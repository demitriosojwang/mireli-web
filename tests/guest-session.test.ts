import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getPassengerSession: vi.fn(),
  assertSessionSigningKeyAvailable: vi.fn(),
  platformConfigFindUnique: vi.fn(),
  passengerFindUnique: vi.fn(),
  passengerCreate: vi.fn(),
  creditFindMany: vi.fn(),
  bookingCount: vi.fn(),
  encodeSession: vi.fn(() => "signed-session"),
  issueCredit: vi.fn(),
  audit: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    platformConfig: { findUnique: mocks.platformConfigFindUnique },
    passenger: { findUnique: mocks.passengerFindUnique, create: mocks.passengerCreate },
    credit: { findMany: mocks.creditFindMany },
    booking: { count: mocks.bookingCount },
  },
}));
vi.mock("@/lib/session", () => ({
  getPassengerSession: mocks.getPassengerSession,
  assertSessionSigningKeyAvailable: mocks.assertSessionSigningKeyAvailable,
  encodeSession: mocks.encodeSession,
  passengerCookieOptions: () => ({
    name: "mireli_session",
    httpOnly: true,
    secure: false,
    sameSite: "lax",
    path: "/",
    maxAge: 604800,
  }),
}));
vi.mock("@/lib/money", () => ({ issueCredit: mocks.issueCredit }));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));

import { GET } from "@/app/api/me/route";

const guest = {
  id: "passenger-1",
  name: "Guest",
  phone: "guest-ab12cd34",
  email: null,
  idType: null,
  idNumber: null,
  nationality: null,
  gender: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.assertSessionSigningKeyAvailable.mockImplementation(() => undefined);
  mocks.getPassengerSession.mockResolvedValue(null);
  mocks.platformConfigFindUnique.mockResolvedValue(null);
  mocks.passengerCreate.mockResolvedValue(guest);
  mocks.creditFindMany.mockResolvedValue([]);
  mocks.bookingCount.mockResolvedValue(0);
});

afterEach(() => vi.unstubAllEnvs());

describe("guest passenger session", () => {
  it("lets a first-time visitor browse when platform configuration is not set up", async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect((await response.json()).passenger.isGuest).toBe(true);
    expect(response.headers.get("set-cookie")).toContain("mireli_session=");
    expect(mocks.issueCredit).not.toHaveBeenCalled();
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({
      metadata: { welcomeCredit: 0, welcomeCreditSkipped: true },
    }));
  });

  it("does not create a guest record when session signing is unavailable", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.assertSessionSigningKeyAvailable.mockImplementationOnce(() => {
      throw new Error("SESSION_SECRET must contain at least 32 characters.");
    });

    const response = await GET();

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect((await response.json()).error).toContain("booking session is temporarily unavailable");
    expect(mocks.getPassengerSession).not.toHaveBeenCalled();
    expect(mocks.platformConfigFindUnique).not.toHaveBeenCalled();
    expect(mocks.passengerCreate).not.toHaveBeenCalled();
    log.mockRestore();
  });

  it("issues configured welcome credit only when operator settings exist", async () => {
    mocks.platformConfigFindUnique.mockResolvedValue({ creditValidityDays: 30 });

    const response = await GET();

    expect(response.status).toBe(200);
    expect(mocks.issueCredit).toHaveBeenCalledWith(expect.objectContaining({
      passengerId: guest.id,
      amount: 100,
      validityDays: 30,
    }));
  });

  it("retries a unique guest-phone collision but does not hide other database failures", async () => {
    mocks.passengerCreate
      .mockRejectedValueOnce({ code: "P2002" })
      .mockResolvedValueOnce(guest);

    expect((await GET()).status).toBe(200);
    expect(mocks.passengerCreate).toHaveBeenCalledTimes(2);

    vi.clearAllMocks();
    mocks.getPassengerSession.mockResolvedValue(null);
    mocks.platformConfigFindUnique.mockResolvedValue(null);
    mocks.passengerCreate.mockRejectedValue(new Error("database unavailable"));

    await expect(GET()).rejects.toThrow("database unavailable");
    expect(mocks.passengerCreate).toHaveBeenCalledTimes(1);
  });
});
