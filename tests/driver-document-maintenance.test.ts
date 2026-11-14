import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ findMany: vi.fn(), updateMany: vi.fn(), purge: vi.fn(), send: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { driverDocument: { findMany: mocks.findMany, updateMany: mocks.updateMany } } }));
vi.mock("@/lib/driver/storage", () => ({ purgeDocumentFile: mocks.purge }));
vi.mock("@/lib/driver/email", () => ({
  EmailProviderError: class EmailProviderError extends Error {},
  transactionalEmailConfigured: () => true,
  sendTransactionalEmail: mocks.send,
}));
import { maintainDriverDocuments } from "@/lib/driver/document-maintenance";

const now = new Date("2026-11-13T09:00:00Z");
const document = { id: "doc1", objectKey: `driver-documents/${"a".repeat(64)}` };
const renewal = { id: "doc2", type: "licence", expiresAt: new Date("2026-12-01T20:59:59Z"),
  application: { driver: { email: "driver@example.com" } } };

describe("driver document maintenance", () => {
  beforeEach(() => vi.resetAllMocks());

  it("clears file metadata only after storage deletion and claims the reminder before sending", async () => {
    mocks.findMany.mockResolvedValueOnce([document]).mockResolvedValueOnce([renewal]);
    mocks.updateMany.mockResolvedValue({ count: 1 });
    await maintainDriverDocuments(now);
    expect(mocks.purge).toHaveBeenCalledWith(document.objectKey);
    expect(mocks.findMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: expect.objectContaining({ type: { in: ["licence", "psv_badge", "insurance", "inspection"] } }),
    }));
    expect(mocks.updateMany).toHaveBeenNthCalledWith(1, { where: document,
      data: { objectKey: "purged/doc1", filePurgedAt: now, sha256: "", mime: "", bytes: 0, filePurgeAt: null } });
    expect(mocks.updateMany).toHaveBeenNthCalledWith(2, { where: { id: "doc2", state: "approved", expiryReminderAt: null },
      data: { expiryReminderAt: now } });
    expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({ to: "driver@example.com", subject: "Renew your Mireli Driver document" }));
  });

  it("retains a failed purge for retry and skips a reminder claimed by another worker", async () => {
    mocks.findMany.mockResolvedValueOnce([document]).mockResolvedValueOnce([renewal]);
    mocks.purge.mockRejectedValueOnce(new Error("Unavailable"));
    mocks.updateMany.mockResolvedValue({ count: 0 });
    await maintainDriverDocuments(now);
    expect(mocks.updateMany).toHaveBeenCalledTimes(1);
    expect(mocks.send).not.toHaveBeenCalled();
  });
});
