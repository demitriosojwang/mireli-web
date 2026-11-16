import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  type Payout = {
    id: string;
    driverId: string;
    status: string;
    netPayoutAmount: number;
    ledgerEntryId: string | null;
    failureReason: string | null;
    settlementVerified: boolean;
    mpesaResultCode: string | null;
    completedAt: Date | null;
    initiatedAt: Date;
  };
  type Attempt = {
    id: string;
    payoutId: string;
    callbackHash: string;
    receiverPhone: string;
    amount: number;
    state: string;
    conversationId: string | null;
    originatorId: string | null;
    receipt: string | null;
    resultCode: string | null;
    createdAt: Date;
    updatedAt: Date;
  };
  type Destination = {
    id: string;
    driverId: string;
    phone: string;
    accountName: string;
    status: string;
    version: number;
    acknowledgedAt: Date;
    reviewedAt: Date | null;
    reviewedBy: string | null;
    reviewNote: string | null;
  };
  type Driver = {
    id: string;
    phone: string | null;
    mpesaNumber: string;
    name: string;
    status: string;
    application: { status: string } | null;
  };
  type Ledger = { id: string; status: string; statusChangedAt: Date; refunds?: {status: string}[] };
  type Config = {
    id: string;
    payoutMode: string;
    payoutDay: number;
    stuckPayoutHours: number;
    sweepPendingMinutes: number;
    lastPayoutRunAt: Date | null;
    lastReconciliationAt: Date | null;
  };

  const state = {
    payouts: new Map<string, Payout>(),
    attempts: new Map<string, Attempt>(),
    destinations: new Map<string, Destination>(),
    drivers: new Map<string, Driver>(),
    ledgers: new Map<string, Ledger>(),
    audits: [] as unknown[],
    config: {
      id: "main",
      payoutMode: "instant_per_trip",
      payoutDay: 5,
      stuckPayoutHours: 1,
      sweepPendingMinutes: 0,
      lastPayoutRunAt: null,
      lastReconciliationAt: null,
    } as Config,
    nextId: 1,
  };

  const clone = <T>(value: T): T => structuredClone(value);
  const id = (prefix: string) => `${prefix}-${state.nextId++}`;

  const db = {
    payoutRecord: {
      findMany: vi.fn(async (args: { where?: Record<string, any>; orderBy?: unknown }) => {
        let rows = [...state.payouts.values()].filter((row) => {
          const where = args.where ?? {};
          if (typeof where.status === "string" && row.status !== where.status) return false;
          if (where.status?.in && !where.status.in.includes(row.status)) return false;
          if (where.initiatedAt?.lte && row.initiatedAt > where.initiatedAt.lte) return false;
          return true;
        });
        if (args.orderBy) rows = rows.sort((a, b) => a.initiatedAt.getTime() - b.initiatedAt.getTime());
        return clone(rows);
      }),
      findUnique: vi.fn(async (args: { where: { id: string } }) => {
        const row = state.payouts.get(args.where.id);
        return row ? clone(row) : null;
      }),
      count: vi.fn(async (args: { where?: Record<string, any> }) => {
        const where = args.where ?? {};
        return [...state.payouts.values()].filter((row) => {
          if (where.driverId && row.driverId !== where.driverId) return false;
          if (where.status?.in && !where.status.in.includes(row.status)) return false;
          if (where.OR && !where.OR.some((clause: { status: string | { in: string[] }; attempts?: { some: { state: { in: string[] } } } }) => {
            if (typeof clause.status !== "string") return clause.status.in.includes(row.status);
            const states = clause.attempts?.some.state.in;
            return clause.status === row.status && (!states || [...state.attempts.values()].some(
              attempt => attempt.payoutId === row.id && states.includes(attempt.state),
            ));
          })) return false;
          return true;
        }).length;
      }),
      update: vi.fn(async (args: { where: { id: string }; data: Record<string, any> }) => {
        const row = state.payouts.get(args.where.id);
        if (!row) throw new Error("Payout not found");
        Object.assign(row, args.data);
        return clone(row);
      }),
      updateMany: vi.fn(async (args: { where: Record<string, any>; data: Record<string, any> }) => {
        let count = 0;
        for (const row of state.payouts.values()) {
          if (args.where.id && row.id !== args.where.id) continue;
          if (args.where.driverId && row.driverId !== args.where.driverId) continue;
          if (args.where.status?.in && !args.where.status.in.includes(row.status)) continue;
          Object.assign(row, args.data);
          count++;
        }
        return { count };
      }),
    },
    payoutAttempt: {
      create: vi.fn(async (args: { data: Omit<Attempt, "id" | "createdAt" | "updatedAt"> }) => {
        const now = new Date();
        const row: Attempt = { id: id("attempt"), ...args.data, state: args.data.state ?? "submitting", createdAt: now, updatedAt: now };
        state.attempts.set(row.id, row);
        return clone(row);
      }),
      findFirst: vi.fn(async (args: { where: Record<string, any>; orderBy?: unknown; include?: { payout?: boolean } }) => {
        const rows = [...state.attempts.values()].filter((row) => {
          const where = args.where ?? {};
          if (where.payoutId && row.payoutId !== where.payoutId) return false;
          if (where.state?.in && !where.state.in.includes(row.state)) return false;
          if (where.originatorId && row.originatorId !== where.originatorId) return false;
          return true;
        }).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        if (!rows[0]) return null;
        const result = clone(rows[0]) as Attempt & { payout?: unknown };
        if (args.include?.payout) result.payout = clone(state.payouts.get(rows[0].payoutId));
        return result;
      }),
      findMany: vi.fn(async (args: { where?: Record<string, any> }) => {
        const where = args.where ?? {};
        const rows = [...state.attempts.values()].filter((row) => {
          if (where.state?.in && !where.state.in.includes(row.state)) return false;
          if (where.updatedAt?.lte && row.updatedAt > where.updatedAt.lte) return false;
          if (where.payout?.status?.in) {
            const payout = state.payouts.get(row.payoutId);
            if (!payout || !where.payout.status.in.includes(payout.status)) return false;
          }
          return true;
        });
        return clone(rows);
      }),
      findUnique: vi.fn(async (args: { where: { id?: string; callbackHash?: string }; include?: { payout?: boolean } }) => {
        const row = args.where.id
          ? state.attempts.get(args.where.id)
          : [...state.attempts.values()].find((attempt) => attempt.callbackHash === args.where.callbackHash);
        return row ? clone(args.include?.payout ? { ...row, payout: state.payouts.get(row.payoutId) } : row) : null;
      }),
      update: vi.fn(async (args: { where: { id: string }; data: Record<string, any> }) => {
        const row = state.attempts.get(args.where.id);
        if (!row) throw new Error("Attempt not found");
        Object.assign(row, args.data);
        row.updatedAt = new Date();
        return clone(row);
      }),
      updateMany: vi.fn(async (args: { where: Record<string, any>; data: Record<string, any> }) => {
        let count = 0;
        for (const row of state.attempts.values()) {
          if (args.where.id && row.id !== args.where.id) continue;
          if (args.where.state?.in && !args.where.state.in.includes(row.state)) continue;
          if (typeof args.where.state === "string" && args.where.state !== row.state) continue;
          Object.assign(row, args.data);
          row.updatedAt = new Date();
          count++;
        }
        return { count };
      }),
    },
    driverPayoutDestination: {
      findUnique: vi.fn(async (args: { where: { driverId?: string; id?: string }; include?: { driver?: boolean } }) => {
        const row = [...state.destinations.values()].find((item) =>
          args.where.driverId ? item.driverId === args.where.driverId : item.id === args.where.id,
        );
        if (!row) return null;
        const result = clone(row) as Destination & { driver?: unknown };
        if (args.include?.driver) result.driver = clone(state.drivers.get(row.driverId) ?? { application: null });
        return result;
      }),
      create: vi.fn(async (args: { data: Omit<Destination, "id" | "status" | "version"> & { status?: string; version?: number } }) => {
        const row: Destination = {
          id: id("destination"),
          ...args.data,
          status: args.data.status ?? "pending_review",
          version: args.data.version ?? 0,
        };
        mocks.state.destinations.set(row.id, row);
        return clone(row);
      }),
      updateMany: vi.fn(async (args: { where: Record<string, any>; data: Record<string, any> }) => {
        let count = 0;
        for (const row of state.destinations.values()) {
          if (args.where.driverId && row.driverId !== args.where.driverId) continue;
          if (args.where.id && row.id !== args.where.id) continue;
          if (args.where.version !== undefined && row.version !== args.where.version) continue;
          const { version, ...data } = args.data;
          Object.assign(row, data);
          if (version?.increment) row.version += version.increment;
          count++;
        }
        return { count };
      }),
    },
    driver: {
      findUnique: vi.fn(async (args: { where: { id: string } }) => {
        const row = state.drivers.get(args.where.id);
        return row ? clone(row) : null;
      }),
      findUniqueOrThrow: vi.fn(async (args: { where: { id: string } }) => {
        const row = state.drivers.get(args.where.id);
        if (!row) throw new Error("Driver not found");
        return clone(row);
      }),
      update: vi.fn(async (args: { where: { id: string }; data: Record<string, any> }) => {
        const row = state.drivers.get(args.where.id);
        if (!row) throw new Error("Driver not found");
        Object.assign(row, args.data);
        return clone(row);
      }),
    },
    ledgerEntry: {
      findUnique: vi.fn(async (args: { where: { id: string } }) => {
        const row = state.ledgers.get(args.where.id);
        return row ? clone(row) : null;
      }),
      updateMany: vi.fn(async (args: { where: Record<string, any>; data: Record<string, any> }) => {
        let count = 0;
        for (const row of state.ledgers.values()) {
          if (args.where.id && row.id !== args.where.id) continue;
          if (args.where.status && row.status !== args.where.status) continue;
          Object.assign(row, args.data);
          count++;
        }
        return { count };
      }),
    },
    platformConfig: {
      findUnique: vi.fn(async () => clone(state.config)),
      update: vi.fn(async (args: { data: Record<string, any> }) => {
        Object.assign(state.config, args.data);
        return clone(state.config);
      }),
    },
    auditLog: {
      create: vi.fn(async (args: { data: unknown }) => {
        state.audits.push(clone(args.data));
        return clone(args.data);
      }),
    },
    $queryRaw: vi.fn(async () => []),
    $transaction: vi.fn(async (work: (tx: typeof db) => unknown) => work(db)),
  };

  return {
    state,
    db,
    b2c: vi.fn(),
    transactionStatus: vi.fn(),
    resolveDaraja: vi.fn(),
    driverPayoutConfigurationIssues: vi.fn(),
  };
});

vi.mock("@/lib/db", () => ({ db: mocks.db }));
vi.mock("@/lib/daraja", () => ({
  RESULT_CODES: { SUCCESS: "0", TIMEOUT: "1007", INVALID_INITIATOR: "2001" },
  b2c: mocks.b2c,
  transactionStatus: mocks.transactionStatus,
  resolveDaraja: mocks.resolveDaraja,
  driverPayoutConfigurationIssues: mocks.driverPayoutConfigurationIssues,
  verifyCallbackToken: (_scope: string, token: string | null) => token === "valid-token",
}));

import { requestPayoutDestination, reviewPayoutDestination } from "@/lib/driver/beneficiary";
import { sendPayout, settleCallback } from "@/lib/payout-settlement";

const now = new Date("2026-11-16T12:00:00.000Z");

function addDriver(overrides: Partial<{ id: string; phone: string | null; mpesaNumber: string; name: string; status: string }> = {}) {
  const driver = {
    id: overrides.id ?? "driver-1",
    phone: overrides.phone ?? "+254700000001",
    mpesaNumber: overrides.mpesaNumber ?? "+254700000001",
    name: overrides.name ?? "Test Driver",
    status: overrides.status ?? "active",
    application: { status: "approved" },
  };
  mocks.state.drivers.set(driver.id, driver);
  return driver;
}

function addApprovedDestination(driverId: string, phone: string) {
  const destination = {
    id: "destination-1",
    driverId,
    phone,
    accountName: "Test Driver",
    status: "approved",
    version: 1,
    acknowledgedAt: now,
    reviewedAt: now,
    reviewedBy: "finance-1",
    reviewNote: "Verified",
  };
  mocks.state.destinations.set(destination.id, destination);
  return destination;
}

function addPayout(overrides: Partial<{
  id: string;
  driverId: string;
  status: string;
  netPayoutAmount: number;
  ledgerEntryId: string | null;
  failureReason: string | null;
  settlementVerified: boolean;
  mpesaResultCode: string | null;
  completedAt: Date | null;
  initiatedAt: Date;
}> = {}) {
  const payout = {
    id: overrides.id ?? "payout-1",
    driverId: overrides.driverId ?? "driver-1",
    status: overrides.status ?? "queued",
    netPayoutAmount: overrides.netPayoutAmount ?? 500,
    ledgerEntryId: overrides.ledgerEntryId ?? null,
    failureReason: overrides.failureReason ?? null,
    settlementVerified: overrides.settlementVerified ?? false,
    mpesaResultCode: overrides.mpesaResultCode ?? null,
    completedAt: overrides.completedAt ?? null,
    initiatedAt: overrides.initiatedAt ?? now,
  };
  mocks.state.payouts.set(payout.id, payout);
  return payout;
}


beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(now);
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("VERCEL", "");
  vi.stubEnv("MIRELI_DEMO_MODE", "true");
  vi.stubEnv("MIRELI_ALLOW_UNSAFE_DEMO", "");
  mocks.state.payouts.clear();
  mocks.state.attempts.clear();
  mocks.state.destinations.clear();
  mocks.state.drivers.clear();
  mocks.state.ledgers.clear();
  mocks.state.audits.length = 0;
  mocks.state.nextId = 1;
  Object.assign(mocks.state.config, {
    payoutMode: "instant_per_trip",
    payoutDay: 5,
    stuckPayoutHours: 1,
    sweepPendingMinutes: 0,
    lastPayoutRunAt: null,
    lastReconciliationAt: null,
  });
  mocks.driverPayoutConfigurationIssues.mockReturnValue([]);
  mocks.resolveDaraja.mockResolvedValue({ mode: "mock", callbackBaseUrl: "https://mireli.test" });
  mocks.b2c.mockResolvedValue({ resultCode: "0", resultDesc: "Confirmed", settled: true, receipt: "ABC1234567" });
  mocks.transactionStatus.mockResolvedValue({ pending: true, resultCode: "", resultDesc: "Still processing" });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("driver payout destination", () => {
  it("persists and sends the supplied normalized destination without changing the profile phone", async () => {
    const driver = addDriver();
    await requestPayoutDestination(driver.id, {
      expectedVersion: 0,
      accountName: driver.name,
      phoneNumber: "+254711111111",
      acknowledged: true,
    });
    const destination = [...mocks.state.destinations.values()][0];
    expect(destination.phone).toBe("+254711111111");
    expect(destination.status).toBe("pending_review");

    await reviewPayoutDestination({
      id: destination.id,
      expectedVersion: 0,
      action: "approve",
      note: "Ownership verified",
    }, { id: "finance-1", name: "Finance" });
    expect(mocks.state.drivers.get(driver.id)?.phone).toBe("+254700000001");
    expect(mocks.state.drivers.get(driver.id)?.mpesaNumber).toBe("+254711111111");

    addPayout({ driverId: driver.id, ledgerEntryId: null });
    await sendPayout("payout-1");
    expect(mocks.b2c).toHaveBeenCalledWith(expect.objectContaining({ receiverPhone: "+254711111111" }), expect.any(Object));
  });

  it("uses the authoritative profile phone when the destination phone is absent", async () => {
    const driver = addDriver();
    await requestPayoutDestination(driver.id, {
      expectedVersion: 0,
      accountName: driver.name,
      acknowledged: true,
    });
    expect([...mocks.state.destinations.values()][0].phone).toBe("+254700000001");
  });

  it("rejects a malformed supplied destination with a safe DriverError", async () => {
    const driver = addDriver();
    await expect(requestPayoutDestination(driver.id, {
      expectedVersion: 0,
      accountName: driver.name,
      phoneNumber: "+12345678901",
      acknowledged: true,
    })).rejects.toMatchObject({ status: 400, code: "INVALID_PHONE", message: "Use a Kenyan mobile number." });
  });

  it("keeps acknowledgement and optimistic version checks unchanged", async () => {
    const driver = addDriver();
    await expect(requestPayoutDestination(driver.id, {
      expectedVersion: 0,
      accountName: driver.name,
      acknowledged: false,
    })).rejects.toMatchObject({ status: 400, code: "ACKNOWLEDGEMENT_REQUIRED" });

    addApprovedDestination(driver.id, "+254700000001");
    await expect(requestPayoutDestination(driver.id, {
      expectedVersion: 3,
      accountName: "Changed Name",
      acknowledged: true,
    })).rejects.toMatchObject({ status: 409, code: "DESTINATION_CHANGED" });
  });
});

function livePayout() {
  vi.stubEnv("MIRELI_DEMO_MODE", "false");
  vi.stubEnv("MPESA_LIVE_PAYOUTS_ENABLED", "true");
  mocks.resolveDaraja.mockResolvedValue({ mode: "live", callbackBaseUrl: "https://mireli.test" });
  const driver = addDriver();
  addApprovedDestination(driver.id, driver.mpesaNumber);
  const ledger = { id: "ledger-1", status: "driver_payable", statusChangedAt: now, refunds: [] };
  mocks.state.ledgers.set(ledger.id, ledger);
  return addPayout({ ledgerEntryId: ledger.id });
}

describe("live payout boundary using a simulated Daraja responder", () => {
  it("keeps queued earnings recoverable when B2C setup is incomplete", async () => {
    const payout = livePayout();
    mocks.driverPayoutConfigurationIssues.mockReturnValue(["Enter the approved B2C shortcode."]);
    await expect(sendPayout(payout.id)).rejects.toMatchObject({ code: "PAYOUT_NOT_READY" });
    expect(payout.status).toBe("queued");
    expect(mocks.state.attempts.size).toBe(0);
    expect(mocks.b2c).not.toHaveBeenCalled();
  });

  it("holds a payout during replacement review and settles once to the verified new number", async () => {
    const payout = livePayout();
    const driver = mocks.state.drivers.get(payout.driverId)!;
    const phone = "+254711111111";
    await requestPayoutDestination(driver.id, {
      expectedVersion: 1, accountName: driver.name, phoneNumber: phone, acknowledged: true,
    });
    await expect(sendPayout(payout.id)).rejects.toMatchObject({ code: "BENEFICIARY_NOT_APPROVED" });
    expect(payout.status).toBe("queued");
    expect(mocks.b2c).not.toHaveBeenCalled();

    await reviewPayoutDestination({
      id: "destination-1", expectedVersion: 2, action: "approve", note: "Ownership verified",
    }, { id: "finance-1", name: "Finance" });
    expect(driver.phone).toBe("+254700000001");
    mocks.b2c.mockResolvedValue({ resultCode: "ACCEPTED", conversationId: "provider-1" });
    await expect(sendPayout(payout.id)).resolves.toBe(false);
    expect(payout.status).toBe("processing");
    expect(payout.settlementVerified).toBe(false);
    const transfer = mocks.b2c.mock.calls[0][0];
    expect(transfer.receiverPhone).toBe(phone);
    const capability = new URL(transfer.resultUrl).pathname.split("/").at(-1)!;
    const result = {
      ResultCode: 0, ConversationID: "provider-1", OriginatorConversationID: transfer.originatorId, TransactionID: "ABC1234567",
      ResultParameters: { ResultParameter: [{ Key: "TransactionAmount", Value: payout.netPayoutAmount },
        { Key: "ReceiverPartyPublicName", Value: "254711111111 - Test Driver" }] },
    };
    await expect(settleCallback(capability, { ...result, ConversationID: "wrong" })).rejects.toMatchObject({ code: "RESULT_MISMATCH" });
    await expect(settleCallback(capability, result)).resolves.toEqual({ duplicate: false });
    await expect(settleCallback(capability, result)).resolves.toEqual({ duplicate: true });
    expect(payout.status).toBe("completed");
    expect(payout.settlementVerified).toBe(true);
    expect(mocks.state.ledgers.get("ledger-1")?.status).toBe("commission_taken");
    expect(mocks.b2c).toHaveBeenCalledOnce();
  });

  it("preserves a timeout received before the submission response", async () => {
    const payout = livePayout();
    mocks.b2c.mockImplementationOnce(async ({ resultUrl }) => {
      const capability = new URL(resultUrl).pathname.split("/").at(-1)!;
      await settleCallback(capability, {}, true);
      return { resultCode: "ACCEPTED", conversationId: "provider-1" };
    });
    await expect(sendPayout(payout.id)).resolves.toBe(false);
    expect(payout.status).toBe("ambiguous");
    await expect(sendPayout(payout.id)).resolves.toBe(false);
    expect(mocks.b2c).toHaveBeenCalledOnce();
  });
});
