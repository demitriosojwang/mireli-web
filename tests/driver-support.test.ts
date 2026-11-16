import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  driverSessionFindUnique: vi.fn(),
  caseFindUnique: vi.fn(),
  caseCreateMany: vi.fn(),
  caseFindMany: vi.fn(),
  caseUpdateMany: vi.fn(),
  driverFindUnique: vi.fn(),
  rateFindMany: vi.fn(),
  rateCreate: vi.fn(),
  rateDeleteMany: vi.fn(),
  executeRaw: vi.fn(),
  auditCreate: vi.fn(),
  transaction: vi.fn(),
  getAdminSession: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    driverSession: { findUnique: mocks.driverSessionFindUnique },
    driverSupportCase: {
      findUnique: mocks.caseFindUnique,
      createMany: mocks.caseCreateMany,
      findMany: mocks.caseFindMany,
      updateMany: mocks.caseUpdateMany,
    },
    driver: { findUnique: mocks.driverFindUnique },
    driverRateLimit: {
      findMany: mocks.rateFindMany,
      create: mocks.rateCreate,
      deleteMany: mocks.rateDeleteMany,
    },
    auditLog: { create: mocks.auditCreate },
    $transaction: mocks.transaction,
  },
}));

vi.mock("@/lib/session", () => ({ getAdminSession: mocks.getAdminSession }));

import { GET as driverGet, POST as driverPost } from "@/app/api/v1/driver/[...path]/route";
import { POST as adminPost } from "@/app/api/admin/driver-support/route";

const driverId = "driver-1";
const caseRow = {
  id: "case-1234567890abcdef",
  driverId,
  clientActionId: "request-1234567890",
  category: "payout",
  message: "My payout has not arrived.",
  status: "open",
  reply: null,
  version: 0,
  assignedTo: null,
  createdAt: new Date("2026-11-16T08:00:00.000Z"),
  updatedAt: new Date("2026-11-16T08:00:00.000Z"),
};
const caseView = {
  id: caseRow.id,
  category: caseRow.category,
  message: caseRow.message,
  status: caseRow.status,
  reply: caseRow.reply,
  createdAt: caseRow.createdAt.toISOString(),
  updatedAt: caseRow.updatedAt.toISOString(),
};
const driver = {
  id: driverId,
  name: "Amina Driver",
  email: "verified-driver@example.com",
  emailVerifiedAt: new Date("2026-01-01T00:00:00.000Z"),
};
const supportContext = { params: Promise.resolve({ path: ["support"] }) };
const supportRequest = (body: Record<string, unknown>) => new Request("https://mireli.test/api/v1/driver/support", {
  method: "POST",
  headers: {
    authorization: `Bearer ${"a".repeat(43)}`,
    "content-type": "application/json",
  },
  body: JSON.stringify(body),
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("DRIVER_AUTH_SECRET", "driver-support-test-secret".padEnd(48, "x"));
  vi.stubEnv("MIRELI_DEMO_MODE", "false");
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("MIRELI_PUBLIC_ORIGIN", "https://mireli.test");
  vi.stubEnv("DRIVER_SUPPORT_REVIEWERS", "support@example.com");
  vi.stubEnv("BREVO_API_KEY", "test-private-provider-key");
  vi.stubEnv("BREVO_SENDER_EMAIL", "support@example.com");
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  mocks.driverSessionFindUnique.mockResolvedValue({
    id: "session-1",
    driverId,
    expiresAt: new Date(Date.now() + 60_000),
    revokedAt: null,
    driver: { id: driverId, name: driver.name, phone: null, status: "active" },
  });
  mocks.caseFindUnique.mockResolvedValue(null);
  mocks.caseCreateMany.mockResolvedValue({ count: 1 });
  mocks.caseFindMany.mockResolvedValue([caseView]);
  mocks.caseUpdateMany.mockResolvedValue({ count: 1 });
  mocks.driverFindUnique.mockResolvedValue(driver);
  mocks.rateFindMany.mockResolvedValue([]);
  mocks.rateCreate.mockResolvedValue({ key: "support:case:test", count: 1, expiresAt: new Date(Date.now() + 3_600_000) });
  mocks.rateDeleteMany.mockResolvedValue({ count: 0 });
  mocks.executeRaw.mockResolvedValue(0);
  mocks.auditCreate.mockResolvedValue({ id: "audit-1" });
  mocks.transaction.mockImplementation(async (work: (tx: unknown) => Promise<unknown>) => work({
    driverSupportCase: {
      findUnique: mocks.caseFindUnique,
      createMany: mocks.caseCreateMany,
      findMany: mocks.caseFindMany,
      updateMany: mocks.caseUpdateMany,
    },
    driverRateLimit: {
      findMany: mocks.rateFindMany,
      create: mocks.rateCreate,
      deleteMany: mocks.rateDeleteMany,
    },
    auditLog: { create: mocks.auditCreate },
    $executeRaw: mocks.executeRaw,
  }));
  mocks.getAdminSession.mockResolvedValue({
    id: "staff-1",
    name: "Support Staff",
    identifier: "support@example.com",
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const adminSupportRequest = (body: Record<string, unknown>) => new Request("https://mireli.test/api/admin/driver-support", {
  method: "POST",
  headers: {
    origin: "https://mireli.test",
    "content-type": "application/json",
  },
  body: JSON.stringify(body),
});
const staffCaseRow = {
  ...caseRow,
  reply: "Your payout has been released.",
  status: "resolved",
  version: 1,
  driver,
};

describe("driver support creation", () => {
  it("persists a new case and sends one acknowledgement to the verified driver email", async () => {
    mocks.caseFindUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(caseRow);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ messageId: "provider-message-1" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await driverPost(supportRequest({
      clientActionId: caseRow.clientActionId,
      category: caseRow.category,
      message: caseRow.message,
      email: "attacker@example.com",
    }), supportContext);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ cases: [caseView] });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(payload.to).toEqual([{ email: driver.email }]);
    expect(payload.subject).toMatch(/MDS-[A-Z0-9]+/);
    expect(payload.textContent).toMatch(/received/i);
    expect(mocks.caseCreateMany).toHaveBeenCalledTimes(1);
    expect(mocks.caseCreateMany).toHaveBeenCalledWith({
      data: [{
        driverId,
        clientActionId: caseRow.clientActionId,
        category: caseRow.category,
        message: caseRow.message,
      }],
      skipDuplicates: true,
    });
  });

  it("keeps an idempotent replay successful without sending a second acknowledgement", async () => {
    mocks.caseFindUnique.mockResolvedValue(caseRow);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await driverPost(supportRequest({
      clientActionId: caseRow.clientActionId,
      category: caseRow.category,
      message: caseRow.message,
    }), supportContext);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ cases: [caseView] });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.caseCreateMany).not.toHaveBeenCalled();
  });

  it("keeps the case successful when acknowledgement delivery fails", async () => {
    mocks.caseFindUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(caseRow);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("provider unavailable")));

    const response = await driverPost(supportRequest({
      clientActionId: caseRow.clientActionId,
      category: caseRow.category,
      message: caseRow.message,
    }), supportContext);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ cases: [caseView] });
    expect(console.error).toHaveBeenCalled();
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(caseRow.message);
  });

  it("uses the validated fallback support address in outbound mail when configuration is invalid", async () => {
    vi.stubEnv("MIRELI_SUPPORT_EMAIL", "not-an-email");
    mocks.caseFindUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(caseRow);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ messageId: "provider-message-1" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await driverPost(supportRequest({
      clientActionId: caseRow.clientActionId,
      category: caseRow.category,
      message: caseRow.message,
    }), supportContext);

    expect(response.status).toBe(200);
    const payload = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(payload.textContent).toContain("mirelisgr001@gmail.com");
    expect(payload.textContent).not.toContain("not-an-email");
    expect(payload.htmlContent).toContain("mirelisgr001@gmail.com");
    expect(payload.htmlContent).not.toContain("not-an-email");
  });

  it("rejects a genuinely new case when the rolling creation limit is reached", async () => {
    mocks.caseFindUnique.mockResolvedValue(null);
    mocks.rateFindMany.mockResolvedValue(Array.from({ length: 10 }, () => ({ expiresAt: new Date(Date.now() + 3_600_000), count: 1 })));
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await driverPost(supportRequest({
      clientActionId: "new-request-123456",
      category: caseRow.category,
      message: caseRow.message,
    }), supportContext);

    expect(response.status).toBe(429);
    expect(await response.json()).toMatchObject({ code: "RATE_LIMITED" });
    expect(Number(response.headers.get("retry-after"))).toBeGreaterThan(3500);
    expect(Number(response.headers.get("retry-after"))).toBeLessThanOrEqual(3600);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.caseCreateMany).not.toHaveBeenCalled();
  });

  it("permits an idempotent replay without consulting the rolling limit", async () => {
    mocks.caseFindUnique.mockResolvedValue(caseRow);
    mocks.rateFindMany.mockResolvedValue(Array.from({ length: 10 }, () => ({ expiresAt: new Date(Date.now() + 3_600_000), count: 1 })));
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await driverPost(supportRequest({
      clientActionId: caseRow.clientActionId,
      category: caseRow.category,
      message: caseRow.message,
    }), supportContext);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ cases: [caseView] });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.rateFindMany).not.toHaveBeenCalled();
    expect(mocks.rateCreate).not.toHaveBeenCalled();
  });

  it("permits a replay that becomes visible while the rolling creation limit is reached", async () => {
    mocks.caseFindUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(caseRow);
    mocks.rateFindMany.mockResolvedValue(Array.from({ length: 10 }, () => ({ expiresAt: new Date(Date.now() + 3_600_000), count: 1 })));
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await driverPost(supportRequest({
      clientActionId: caseRow.clientActionId,
      category: caseRow.category,
      message: caseRow.message,
    }), supportContext);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ cases: [caseView] });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.rateCreate).not.toHaveBeenCalled();
  });

  it("returns the existing case when a concurrent insert wins the race without consuming quota", async () => {
    mocks.caseFindUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(caseRow);
    mocks.caseCreateMany.mockResolvedValue({ count: 0 });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await driverPost(supportRequest({
      clientActionId: caseRow.clientActionId,
      category: caseRow.category,
      message: caseRow.message,
    }), supportContext);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ cases: [caseView] });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.rateCreate).not.toHaveBeenCalled();
  });
});

describe("driver service support contact", () => {
  it("exposes the configured support contact and omits an invalid phone", async () => {
    vi.stubEnv("MIRELI_SUPPORT_EMAIL", "support@example.com");
    vi.stubEnv("MIRELI_SUPPORT_PHONE", "+254700123456");

    const configured = await driverGet(
      new Request("https://mireli.test/api/v1/driver/status"),
      { params: Promise.resolve({ path: ["status"] }) },
    );
    expect(configured.status).toBe(200);
    expect(await configured.json()).toMatchObject({
      supportEmail: "support@example.com",
      supportPhone: "+254700123456",
    });

    vi.stubEnv("MIRELI_SUPPORT_EMAIL", "");
    vi.stubEnv("MIRELI_SUPPORT_PHONE", "not-a-phone");
    const invalid = await driverGet(
      new Request("https://mireli.test/api/v1/driver/status"),
      { params: Promise.resolve({ path: ["status"] }) },
    );
    const body = await invalid.json();
    expect(body.supportEmail).toBe("mirelisgr001@gmail.com");
    expect(body).not.toHaveProperty("supportPhone");
  });
});

describe("staff driver support replies", () => {
  it("sends one reply email to the verified driver only after the audited transaction succeeds", async () => {
    mocks.caseFindUnique.mockResolvedValue(staffCaseRow);
    let committed = false;
    mocks.transaction.mockImplementation(async (work: (tx: unknown) => Promise<unknown>) => {
      const result = await work({
        driverSupportCase: {
          findUnique: mocks.caseFindUnique,
          updateMany: mocks.caseUpdateMany,
        },
        auditLog: { create: mocks.auditCreate },
      });
      committed = true;
      return result;
    });
    const fetchMock = vi.fn().mockImplementation(async () => {
      expect(committed).toBe(true);
      return {
        ok: true,
        status: 201,
        json: async () => ({ messageId: "provider-message-2" }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await adminPost(adminSupportRequest({
      id: staffCaseRow.id,
      reply: staffCaseRow.reply,
      status: staffCaseRow.status,
      expectedVersion: 0,
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(payload.to).toEqual([{ email: driver.email }]);
    expect(payload.subject).toMatch(/MDS-[A-Z0-9]+/);
    expect(payload.textContent).toContain(staffCaseRow.reply);
    expect(mocks.auditCreate).toHaveBeenCalledTimes(1);
    expect(mocks.auditCreate).toHaveBeenCalledWith({
      data: {
        actorId: "staff-1",
        actorRole: "support",
        actorName: "Support Staff",
        action: "driver.support_reply",
        entity: "driver_support",
        entityId: staffCaseRow.id,
        metadata: JSON.stringify({ status: staffCaseRow.status }),
      },
    });
  });

  it("rolls back the staff reply when the audit write fails and does not send email", async () => {
    mocks.caseFindUnique.mockResolvedValue(staffCaseRow);
    let committed = false;
    mocks.transaction.mockImplementation(async (work: (tx: unknown) => Promise<unknown>) => {
      const result = await work({
        driverSupportCase: {
          findUnique: mocks.caseFindUnique,
          updateMany: mocks.caseUpdateMany,
        },
        auditLog: { create: mocks.auditCreate },
      });
      committed = true;
      return result;
    });
    mocks.auditCreate.mockRejectedValue(new Error("audit unavailable"));
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await adminPost(adminSupportRequest({
      id: staffCaseRow.id,
      reply: staffCaseRow.reply,
      status: staffCaseRow.status,
      expectedVersion: 0,
    }));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Support service unavailable" });
    expect(committed).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not send another email when a staff reply is stale", async () => {
    mocks.caseUpdateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    mocks.caseFindUnique.mockResolvedValue(staffCaseRow);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ messageId: "provider-message-3" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const first = await adminPost(adminSupportRequest({
      id: staffCaseRow.id,
      reply: staffCaseRow.reply,
      status: staffCaseRow.status,
      expectedVersion: 0,
    }));
    const stale = await adminPost(adminSupportRequest({
      id: staffCaseRow.id,
      reply: "A stale reply.",
      status: staffCaseRow.status,
      expectedVersion: 0,
    }));

    expect(first.status).toBe(200);
    expect(stale.status).toBe(409);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps the committed staff reply successful when reply email delivery fails", async () => {
    mocks.caseFindUnique.mockResolvedValue(staffCaseRow);
    let committed = false;
    mocks.transaction.mockImplementation(async (work: (tx: unknown) => Promise<unknown>) => {
      const result = await work({
        driverSupportCase: {
          findUnique: mocks.caseFindUnique,
          updateMany: mocks.caseUpdateMany,
        },
        auditLog: { create: mocks.auditCreate },
      });
      committed = true;
      return result;
    });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("provider unavailable")));

    const response = await adminPost(adminSupportRequest({
      id: staffCaseRow.id,
      reply: staffCaseRow.reply,
      status: staffCaseRow.status,
      expectedVersion: 0,
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(committed).toBe(true);
    expect(console.error).toHaveBeenCalled();
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(staffCaseRow.reply);
  });
});
