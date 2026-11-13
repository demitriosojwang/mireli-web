import { beforeEach, describe, expect, it, vi } from "vitest";

const { db, transaction, tx } = vi.hoisted(() => {
  const tx = {
    driverApplication: { findUnique: vi.fn(), updateMany: vi.fn() },
    driverDocument: { updateMany: vi.fn() },
    auditLog: { create: vi.fn() },
  };
  const transaction = vi.fn(async (execute: (client: typeof tx) => unknown) => execute(tx));
  return { db: { $transaction: transaction, driverApplication: { findUnique: vi.fn() } }, transaction, tx };
});
vi.mock("@/lib/db", () => ({ db }));

import { removePendingDocument } from "@/lib/driver/onboarding";

beforeEach(() => {
  vi.clearAllMocks();
  tx.driverApplication.findUnique.mockResolvedValue({ id: "application", version: 3, status: "submitted" });
  tx.driverApplication.updateMany.mockResolvedValue({ count: 1 });
  tx.driverDocument.updateMany.mockResolvedValue({ count: 1 });
  db.driverApplication.findUnique.mockResolvedValue({
    id: "application", version: 4, status: "draft", ownsVehicle: true, documents: [], driver: {},
  });
});

describe("remove pending driver document", () => {
  it("withdraws a submitted application and queues the owned pending file for purge", async () => {
    const result = await removePendingDocument("driver", "document", 3);
    expect(tx.driverApplication.findUnique).toHaveBeenCalledWith({ where: { driverId: "driver" } });
    expect(tx.driverApplication.updateMany).toHaveBeenCalledWith({
      where: { id: "application", version: 3, status: "submitted" },
      data: { version: { increment: 1 }, status: "draft", submittedAt: null },
    });
    expect(tx.driverDocument.updateMany).toHaveBeenCalledWith({
      where: { id: "document", applicationId: "application", state: "pending_review" },
      data: { state: "replaced", filePurgeAt: expect.any(Date) },
    });
    expect(result.application.status).toBe("draft");
    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it("keeps an approved application approved when withdrawing a pending replacement", async () => {
    tx.driverApplication.findUnique.mockResolvedValue({ id: "application", version: 3, status: "approved" });
    await removePendingDocument("driver", "document", 3);
    expect(tx.driverApplication.updateMany).toHaveBeenCalledWith({
      where: { id: "application", version: 3, status: "approved" },
      data: { version: { increment: 1 } },
    });
  });

  it("rejects a changed application or a file outside the pending scope", async () => {
    await expect(removePendingDocument("driver", "document", 2)).rejects.toMatchObject({ code: "STALE_APPLICATION" });
    expect(tx.driverDocument.updateMany).not.toHaveBeenCalled();
    tx.driverDocument.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(removePendingDocument("driver", "other", 3)).rejects.toMatchObject({ code: "DOCUMENT_NOT_REMOVABLE" });
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });
});
