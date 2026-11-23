import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  passengerFindUnique: vi.fn(),
  passengerFindFirst: vi.fn(),
  passengerCreate: vi.fn(),
  passengerUpdate: vi.fn(),
  passengerDelete: vi.fn(),
  bookingUpdateMany: vi.fn(),
  creditUpdateMany: vi.fn(),
  platformConfigFindUnique: vi.fn(),
  transaction: vi.fn(),
  getPassengerSession: vi.fn(),
  encodeSession: vi.fn(() => "signed-passenger-session"),
  verifyPassengerChallenge: vi.fn(),
  consumePassengerChallenge: vi.fn(),
  requestPassengerChallenge: vi.fn(),
  issueCredit: vi.fn(),
  audit: vi.fn(),
  txPassengerFindUnique: vi.fn(),
  txPassengerFindFirst: vi.fn(),
  txPassengerCreate: vi.fn(),
  txPassengerUpdate: vi.fn(),
  txPassengerDelete: vi.fn(),
  txBookingUpdateMany: vi.fn(),
  txCreditUpdateMany: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    passenger: {
      findUnique: mocks.passengerFindUnique,
      findFirst: mocks.passengerFindFirst,
      create: mocks.passengerCreate,
    },
    booking: { updateMany: mocks.bookingUpdateMany },
    credit: { updateMany: mocks.creditUpdateMany },
    platformConfig: { findUnique: mocks.platformConfigFindUnique },
    $transaction: mocks.transaction,
  },
}));

vi.mock("@/lib/session", () => ({
  getPassengerSession: mocks.getPassengerSession,
  encodeSession: mocks.encodeSession,
  normalizePhone: (input: string) => {
    const compact = input.replace(/[^\d+]/g, "");
    const national = compact.startsWith("+") ? compact.slice(1) : compact;
    const local = national.startsWith("254") ? national.slice(3) : national.startsWith("0") ? national.slice(1) : national;
    return /^[17]\d{8}$/.test(local) ? `+254${local}` : null;
  },
  passengerCookieOptions: () => ({ name: "mireli_session", httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 604800 }),
  adminCookieOptions: () => ({ name: "mireli_admin", httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 43200 }),
}));

vi.mock("@/lib/passenger-auth", () => ({
  verifyPassengerChallenge: mocks.verifyPassengerChallenge,
  consumePassengerChallenge: mocks.consumePassengerChallenge,
  requestPassengerChallenge: mocks.requestPassengerChallenge,
}));
vi.mock("@/lib/money", () => ({ issueCredit: mocks.issueCredit }));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));

import { POST } from "@/app/api/auth/route";
import { decryptPassengerIdNumber, isEncryptedPassengerIdNumber } from "@/lib/passenger-pii";

const post = (body: unknown) => new NextRequest("https://mireli.example/api/auth", {
  method: "POST",
  body: typeof body === "string" ? body : JSON.stringify(body),
  headers: { "content-type": "application/json" },
});

const guest = {
  id: "guest-1",
  name: "Guest",
  phone: "guest-random",
  email: null,
  idType: null,
  idNumber: null,
  nationality: null,
  gender: null,
};

const account = {
  id: "passenger-1",
  name: "Amina Wanjiru",
  phone: "+254712345678",
  email: "amina@example.com",
  idType: "id",
  idNumber: "12345678",
  nationality: "Kenyan",
  gender: "female",
};

const tx = {
  driverAuthChallenge: { updateMany: vi.fn() },
  passenger: {
    findUnique: mocks.txPassengerFindUnique,
    findFirst: mocks.txPassengerFindFirst,
    create: mocks.txPassengerCreate,
    update: mocks.txPassengerUpdate,
    delete: mocks.txPassengerDelete,
  },
  booking: { updateMany: mocks.txBookingUpdateMany },
  credit: { updateMany: mocks.txCreditUpdateMany },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.transaction.mockImplementation(async (run: (value: typeof tx) => unknown) => run(tx));
  mocks.passengerFindUnique.mockResolvedValue(null);
  mocks.passengerFindFirst.mockResolvedValue(null);
  mocks.passengerCreate.mockResolvedValue(account);
  mocks.txPassengerFindUnique.mockResolvedValue(null);
  mocks.txPassengerFindFirst.mockResolvedValue(null);
  mocks.txPassengerCreate.mockResolvedValue(account);
  mocks.txPassengerUpdate.mockResolvedValue(account);
  mocks.txPassengerDelete.mockResolvedValue(guest);
  mocks.txBookingUpdateMany.mockResolvedValue({ count: 0 });
  mocks.txCreditUpdateMany.mockResolvedValue({ count: 0 });
  mocks.verifyPassengerChallenge.mockResolvedValue({
    id: "challenge-1",
    channel: "passenger_sms",
    phone: account.phone,
    email: null,
  });
  mocks.consumePassengerChallenge.mockResolvedValue(undefined);
  mocks.getPassengerSession.mockResolvedValue(null);
  mocks.platformConfigFindUnique.mockResolvedValue(null);
  mocks.issueCredit.mockResolvedValue(undefined);
  mocks.audit.mockResolvedValue(undefined);
});

afterEach(() => vi.unstubAllEnvs());

describe("passenger authentication route", () => {
  it("returns a controlled 400 for malformed or non-object JSON", async () => {
    for (const body of ["{", "null", "[]", "\"invalid\""]) {
      const response = await POST(post(body));
      expect(response.status).toBe(400);
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
  });

  it("asks a new email passenger for name and mobile instead of rejecting them", async () => {
    mocks.verifyPassengerChallenge.mockResolvedValueOnce({
      id: "email-challenge",
      channel: "passenger_email",
      phone: null,
      email: "new@example.com",
    });

    const response = await POST(post({ step: "verify", challengeId: "email-challenge", code: "123456" }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ needsName: true, needsPhone: true, identifier: "new@example.com" });
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.txPassengerCreate).not.toHaveBeenCalled();
  });

  it("creates an account for a new email passenger with a verified name and free mobile", async () => {
    mocks.verifyPassengerChallenge.mockResolvedValueOnce({
      id: "email-challenge",
      channel: "passenger_email",
      phone: null,
      email: "new@example.com",
    });
    const created = { id: "new-passenger", name: "New Passenger", phone: "+254712345678", email: "new@example.com" };
    mocks.txPassengerCreate.mockResolvedValueOnce(created);

    const response = await POST(post({
      step: "verify",
      challengeId: "email-challenge",
      code: "123456",
      name: "New Passenger",
      phone: "0712345678",
    }));

    expect(response.status).toBe(200);
    expect((await response.json()).isNew).toBe(true);
    expect(mocks.txPassengerCreate).toHaveBeenCalledWith({
      data: { phone: "+254712345678", email: "new@example.com", name: "New Passenger" },
    });
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "auth.signup" }));
  });

  it("refuses to bind a mobile number that already belongs to another account", async () => {
    mocks.verifyPassengerChallenge.mockResolvedValueOnce({
      id: "email-challenge",
      channel: "passenger_email",
      phone: null,
      email: "new@example.com",
    });
    mocks.txPassengerFindUnique.mockResolvedValueOnce({ id: "someone-else" }); // mobile taken

    const response = await POST(post({
      step: "verify",
      challengeId: "email-challenge",
      code: "123456",
      name: "New Passenger",
      phone: "0712345678",
    }));

    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("MOBILE_IN_USE");
    expect(mocks.txPassengerCreate).not.toHaveBeenCalled();
  });

  it("signs in an existing passenger only after consuming the verified challenge", async () => {
    mocks.passengerFindUnique.mockResolvedValueOnce(account);
    mocks.txPassengerFindUnique.mockResolvedValueOnce(account);

    const response = await POST(post({ step: "verify", challengeId: "challenge-1", code: "123456" }));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("set-cookie")).toContain("mireli_session=signed-passenger-session");
    expect(mocks.consumePassengerChallenge).toHaveBeenCalledWith(tx, expect.objectContaining({ id: "challenge-1" }));
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "auth.login", entityId: account.id }));
  });

  it("upgrades the guest booking identity after the phone challenge is verified", async () => {
    mocks.getPassengerSession.mockResolvedValueOnce({ role: "passenger", id: guest.id, name: guest.name, identifier: guest.phone, exp: Date.now() + 60000 });
    mocks.passengerFindUnique.mockResolvedValueOnce(guest);
    mocks.txPassengerUpdate.mockResolvedValueOnce({ ...account, id: guest.id });
    mocks.txPassengerFindUnique
      .mockResolvedValueOnce(guest)
      .mockResolvedValueOnce(null);

    const response = await POST(post({
      step: "signup",
      challengeId: "challenge-1",
      code: "123456",
      name: account.name,
      phone: "0712345678",
      email: account.email,
      idType: account.idType,
      idNumber: account.idNumber,
      nationality: account.nationality,
      gender: account.gender,
    }));

    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("mireli_session=signed-passenger-session");
    expect(mocks.txPassengerUpdate).toHaveBeenCalledWith({
      where: { id: guest.id },
      data: expect.objectContaining({
        phone: account.phone,
        email: account.email,
        name: account.name,
        idNumber: expect.stringMatching(/^mireli-pii:v1:/),
      }),
    });
    const storedId = mocks.txPassengerUpdate.mock.calls[0][0].data.idNumber;
    expect(isEncryptedPassengerIdNumber(storedId)).toBe(true);
    expect(decryptPassengerIdNumber(storedId)).toBe(account.idNumber);
    expect(mocks.txBookingUpdateMany).not.toHaveBeenCalled();
    expect(mocks.txCreditUpdateMany).not.toHaveBeenCalled();
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "auth.signup", entityId: guest.id }));
  });

  it("moves guest bookings and credits to an exact matching existing passenger", async () => {
    const matchingAccount = { ...account };
    mocks.getPassengerSession.mockResolvedValueOnce({ role: "passenger", id: guest.id, name: guest.name, identifier: guest.phone, exp: Date.now() + 60000 });
    mocks.passengerFindUnique.mockResolvedValueOnce(guest);
    mocks.txPassengerFindUnique
      .mockResolvedValueOnce(guest)
      .mockResolvedValueOnce(matchingAccount);
    mocks.txPassengerUpdate.mockResolvedValueOnce(matchingAccount);
    mocks.txBookingUpdateMany.mockResolvedValueOnce({ count: 1 });
    mocks.txCreditUpdateMany.mockResolvedValueOnce({ count: 2 });

    const response = await POST(post({
      step: "signup",
      challengeId: "challenge-1",
      code: "123456",
      name: account.name,
      phone: "0712345678",
      email: account.email,
      idType: account.idType,
      idNumber: account.idNumber,
      nationality: account.nationality,
      gender: account.gender,
    }));

    expect(response.status).toBe(200);
    expect(mocks.txBookingUpdateMany).toHaveBeenCalledWith({ where: { passengerId: guest.id }, data: { passengerId: account.id } });
    expect(mocks.txCreditUpdateMany).toHaveBeenCalledWith({ where: { passengerId: guest.id }, data: { passengerId: account.id } });
    expect(mocks.txPassengerDelete).toHaveBeenCalledWith({ where: { id: guest.id } });
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "auth.claim", entityId: account.id }));
  });
});
