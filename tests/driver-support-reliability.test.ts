import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";

const mocks = vi.hoisted(() => ({
  driverSessionFindUnique: vi.fn(),
  caseFindUnique: vi.fn(),
  caseCreateMany: vi.fn(),
  caseFindMany: vi.fn(),
  driverFindUnique: vi.fn(),
  rateUpsert: vi.fn(),
  rateFindMany: vi.fn(),
  rateCreate: vi.fn(),
  rateDeleteMany: vi.fn(),
  executeRaw: vi.fn(),
  auditCreate: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    driverSession: { findUnique: mocks.driverSessionFindUnique },
    driverSupportCase: {
      findUnique: mocks.caseFindUnique,
      createMany: mocks.caseCreateMany,
      findMany: mocks.caseFindMany,
    },
    driver: { findUnique: mocks.driverFindUnique },
    driverRateLimit: {
      upsert: mocks.rateUpsert,
      findMany: mocks.rateFindMany,
      create: mocks.rateCreate,
      deleteMany: mocks.rateDeleteMany,
    },
    auditLog: { create: mocks.auditCreate },
    $transaction: mocks.transaction,
  },
}));

import { POST as driverPost } from "@/app/api/v1/driver/[...path]/route";
import { hashToken } from "@/lib/driver/auth";

type StoredCase = {
  id: string;
  driverId: string;
  clientActionId: string;
  category: string;
  message: string;
  status: string;
  reply: string | null;
  version: number;
  assignedTo: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type CaseUniqueArgs = {
  where: { driverId_clientActionId: { driverId: string; clientActionId: string } };
};

type RateFilter = {
  key?: { startsWith?: string };
  expiresAt?: { gt?: Date; lte?: Date };
  OR?: Array<{ key?: { startsWith?: string } }>;
};

const caseStore = new Map<string, StoredCase>();
const rateBuckets = new Map<string, number>();
const rateEvents = new Map<string, { key: string; expiresAt: Date; count: number }>();
let transactionTail: Promise<void> = Promise.resolve();
let caseSequence = 0;

const supportContext = { params: Promise.resolve({ path: ["support"] }) };
const supportRequest = (body: Record<string, unknown>, token = "a") => new Request("https://mireli.test/api/v1/driver/support", {
  method: "POST",
  headers: {
    authorization: `Bearer ${token.repeat(43)}`,
    "content-type": "application/json",
  },
  body: JSON.stringify(body),
});

const caseKey = (driverId: string, clientActionId: string) => `${driverId}:${clientActionId}`;

const legacyRateKey = (driverId: string, bucket: number) =>
  `support:case:${createHash("sha256").update(driverId).digest("hex")}:${bucket}`;

const seedLegacyRateRow = (driverId: string, bucket: number, count: number, expiresAt: Date) => {
  const key = legacyRateKey(driverId, bucket);
  rateEvents.set(key, { key, expiresAt, count });
  return key;
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("DRIVER_AUTH_SECRET", "driver-support-reliability-secret".padEnd(48, "x"));
  vi.stubEnv("MIRELI_DEMO_MODE", "false");
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("MIRELI_PUBLIC_ORIGIN", "https://mireli.test");
  vi.stubEnv("MIRELI_SUPPORT_EMAIL", "support@example.com");
  vi.stubEnv("BREVO_API_KEY", "test-private-provider-key");
  vi.stubEnv("BREVO_SENDER_EMAIL", "support@example.com");
  vi.spyOn(console, "error").mockImplementation(() => undefined);

  caseStore.clear();
  rateBuckets.clear();
  rateEvents.clear();
  transactionTail = Promise.resolve();
  caseSequence = 0;

  const tokenDrivers = new Map([
    [hashToken("a".repeat(43)), "driver-a"],
    [hashToken("b".repeat(43)), "driver-b"],
  ]);

  mocks.driverSessionFindUnique.mockImplementation(async ({ where }: { where: { tokenHash: string } }) => {
    const id = tokenDrivers.get(where.tokenHash);
    if (!id) return null;
    return {
      id: `session-${id}`,
      driverId: id,
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: null,
      driver: { id, name: `${id} name`, phone: null, status: "active" },
    };
  });
  mocks.driverFindUnique.mockImplementation(async ({ where }: { where: { id: string } }) => ({
    id: where.id,
    name: `${where.id} name`,
    email: `${where.id}@example.com`,
    emailVerifiedAt: new Date("2026-01-01T00:00:00.000Z"),
  }));
  mocks.caseFindUnique.mockImplementation(async ({ where }: CaseUniqueArgs) => {
    const { driverId, clientActionId } = where.driverId_clientActionId;
    return caseStore.get(caseKey(driverId, clientActionId)) ?? null;
  });
  mocks.caseCreateMany.mockImplementation(async ({ data }: { data: Array<{ driverId: string; clientActionId: string; category: string; message: string }> }) => {
    let count = 0;
    for (const item of data) {
      const key = caseKey(item.driverId, item.clientActionId);
      if (caseStore.has(key)) continue;
      const now = new Date();
      caseSequence += 1;
      caseStore.set(key, {
        id: `case-${caseSequence}`,
        ...item,
        status: "open",
        reply: null,
        version: 0,
        assignedTo: null,
        createdAt: now,
        updatedAt: now,
      });
      count += 1;
    }
    return { count };
  });
  mocks.caseFindMany.mockImplementation(async ({ where }: { where: { driverId: string } }) => (
    [...caseStore.values()].filter((item) => item.driverId === where.driverId)
  ));
  mocks.rateUpsert.mockImplementation(async ({ where }: { where: { key: string } }) => {
    const count = (rateBuckets.get(where.key) ?? 0) + 1;
    rateBuckets.set(where.key, count);
    return { count };
  });
  mocks.rateFindMany.mockImplementation(async ({ where }: { where: RateFilter }) => {
    const prefixes = [where.key?.startsWith, ...(where.OR ?? []).map((entry) => entry.key?.startsWith)]
      .filter((prefix): prefix is string => Boolean(prefix));
    const cutoff = where.expiresAt?.gt;
    return [...rateEvents.values()]
      .filter((event) => (prefixes.length ? prefixes.some((prefix) => event.key.startsWith(prefix)) : true) && (!cutoff || event.expiresAt > cutoff))
      .sort((left, right) => left.expiresAt.getTime() - right.expiresAt.getTime())
      .map((event) => ({ expiresAt: event.expiresAt, count: event.count }));
  });
  mocks.rateCreate.mockImplementation(async ({ data }: { data: { key: string; expiresAt: Date; count?: number } }) => {
    rateEvents.set(data.key, { key: data.key, expiresAt: data.expiresAt, count: data.count ?? 1 });
    return data;
  });
  mocks.rateDeleteMany.mockImplementation(async ({ where }: { where: RateFilter }) => {
    const prefix = where.key?.startsWith ?? "";
    const expiredBefore = where.expiresAt?.lte;
    let count = 0;
    for (const [key, event] of rateEvents) {
      if (event.key.startsWith(prefix) && expiredBefore && event.expiresAt <= expiredBefore) {
        rateEvents.delete(key);
        count += 1;
      }
    }
    return { count };
  });
  mocks.executeRaw.mockResolvedValue(0);
  mocks.auditCreate.mockResolvedValue({ id: "audit-1" });
  mocks.transaction.mockImplementation((work: (tx: unknown) => Promise<unknown>) => {
    const transaction = transactionTail.then(async () => {
      const casesBefore = new Map(caseStore);
      const eventsBefore = new Map(rateEvents);
      try {
        return await work({
          driverSupportCase: {
            findUnique: mocks.caseFindUnique,
            createMany: mocks.caseCreateMany,
            findMany: mocks.caseFindMany,
          },
          driverRateLimit: {
            findMany: mocks.rateFindMany,
            create: mocks.rateCreate,
            deleteMany: mocks.rateDeleteMany,
          },
          auditLog: { create: mocks.auditCreate },
          $executeRaw: mocks.executeRaw,
        });
      } catch (error) {
        caseStore.clear();
        for (const [key, value] of casesBefore) caseStore.set(key, value);
        rateEvents.clear();
        for (const [key, value] of eventsBefore) rateEvents.set(key, value);
        throw error;
      }
    });
    transactionTail = transaction.then(() => undefined, () => undefined);
    return transaction;
  });

  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true,
    status: 201,
    json: async () => ({ messageId: "provider-message-1" }),
  }));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("driver support creation reliability", () => {
  it("persists a genuinely new case and returns it to the driver", async () => {
    const response = await driverPost(supportRequest({
      clientActionId: "request-persisted-123",
      category: "payout",
      message: "My payout has not arrived.",
    }), supportContext);

    expect(response.status).toBe(200);
    const body = await response.json() as { cases: Array<{ id: string; message: string }> };
    expect(body.cases).toHaveLength(1);
    expect(body.cases[0].message).toBe("My payout has not arrived.");
    expect(caseStore.size).toBe(1);
  });

  it("rolls back a new case when its audit write fails and does not acknowledge it", async () => {
    mocks.auditCreate.mockRejectedValue(new Error("audit unavailable"));

    const response = await driverPost(supportRequest({
      clientActionId: "request-audit-failure-123",
      category: "payout",
      message: "My payout has not arrived.",
    }), supportContext);

    expect(response.status).toBe(503);
    expect(mocks.auditCreate).toHaveBeenCalledTimes(1);
    expect(caseStore.size).toBe(0);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it("does not charge duplicate concurrency to the rolling creation limit", async () => {
    const duplicate = {
      clientActionId: "request-concurrent-123",
      category: "payout",
      message: "My payout has not arrived.",
    };

    const duplicateResponses = await Promise.all([
      driverPost(supportRequest(duplicate), supportContext),
      driverPost(supportRequest(duplicate), supportContext),
    ]);
    expect(duplicateResponses.map((response) => response.status)).toEqual([200, 200]);

    const uniqueResponses: Response[] = [];
    for (let index = 0; index < 9; index += 1) {
      uniqueResponses.push(await driverPost(supportRequest({
        clientActionId: `request-unique-${index}-123`,
        category: "trip",
        message: "This is a unique support request.",
      }), supportContext));
    }

    expect(uniqueResponses.map((response) => response.status)).toEqual(Array(9).fill(200));
    expect(caseStore.size).toBe(10);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(10);
  });

  it("enforces one rolling limit across a clock-window boundary", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-16T12:59:00.000Z"));

    const withinWindow: Response[] = [];
    for (let index = 0; index < 10; index += 1) {
      withinWindow.push(await driverPost(supportRequest({
        clientActionId: `request-window-${index}-123`,
        category: "trip",
        message: "This request is inside the rolling window.",
      }), supportContext));
    }
    expect(withinWindow.map((response) => response.status)).toEqual(Array(10).fill(200));

    vi.setSystemTime(new Date("2026-11-16T13:00:01.000Z"));
    const afterBoundary = await driverPost(supportRequest({
      clientActionId: "request-after-boundary-123",
      category: "trip",
      message: "This request is just over the fixed boundary.",
    }), supportContext);

    expect(afterBoundary.status).toBe(429);
    expect(await afterBoundary.json()).toMatchObject({ code: "RATE_LIMITED" });
  });

  it("isolates the rolling creation limit by driver", async () => {
    const driverA: Response[] = [];
    for (let index = 0; index < 11; index += 1) {
      driverA.push(await driverPost(supportRequest({
        clientActionId: `request-driver-a-${index}-123`,
        category: "trip",
        message: "This request belongs to driver A.",
      }, "a"), supportContext));
    }
    expect(driverA.slice(0, 10).map((response) => response.status)).toEqual(Array(10).fill(200));
    expect(driverA[10].status).toBe(429);

    const driverB = await driverPost(supportRequest({
      clientActionId: "request-driver-b-123",
      category: "trip",
      message: "This request belongs to driver B.",
    }, "b"), supportContext);

    expect(driverB.status).toBe(200);
  });

  it("counts legacy fixed-window rows toward the rolling creation limit after deployment", async () => {
    const original = {
      clientActionId: "request-transition-original",
      category: "payout",
      message: "My payout has not arrived.",
    };
    const created = await driverPost(supportRequest(original), supportContext);
    expect(created.status).toBe(200);

    seedLegacyRateRow("driver-a", 42, 9, new Date(Date.now() + 60 * 60 * 1000));

    const replay = await driverPost(supportRequest(original), supportContext);
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ cases: [{ id: "case-1" }] });

    const eleventh = await driverPost(supportRequest({
      clientActionId: "request-transition-eleventh",
      category: "trip",
      message: "This request is the eleventh genuine request.",
    }), supportContext);

    expect(eleventh.status).toBe(429);
    expect(await eleventh.json()).toMatchObject({ code: "RATE_LIMITED" });
    expect(caseStore.size).toBe(1);
  });

  it("purges expired legacy rows and keeps legacy rows isolated per driver", async () => {
    const expiredKey = seedLegacyRateRow("driver-a", 41, 10, new Date(Date.now() - 60 * 1000));
    const otherDriverKey = seedLegacyRateRow("driver-b", 42, 10, new Date(Date.now() + 60 * 60 * 1000));

    const response = await driverPost(supportRequest({
      clientActionId: "request-transition-isolation",
      category: "trip",
      message: "Legacy rows must not leak across drivers.",
    }), supportContext);

    expect(response.status).toBe(200);
    expect(caseStore.size).toBe(1);
    expect(rateEvents.has(expiredKey)).toBe(false);
    expect(rateEvents.has(otherDriverKey)).toBe(true);
  });
});
