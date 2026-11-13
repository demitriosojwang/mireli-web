import { db } from "@/lib/db";
import { applicableRequirements, POLICY_VERSION } from "./catalogue";
import { documentGraceUntil, DRIVER_DOCUMENT_DAY_MS } from "./eligibility";
import { EmailProviderError, sendTransactionalEmail, transactionalEmailConfigured } from "./email";
import { purgeDocumentFile } from "./storage";

const limit = 40;
const reminderDays = 30;

export async function maintainDriverDocuments(now = new Date()) {
  const files = await db.driverDocument.findMany({
    where: { filePurgedAt: null, filePurgeAt: { lte: now }, state: { in: ["approved", "rejected", "replaced"] } },
    orderBy: { filePurgeAt: "asc" }, take: limit, select: { id: true, objectKey: true },
  });
  for (const file of files) {
    try {
      await purgeDocumentFile(file.objectKey);
      await db.driverDocument.updateMany({ where: { id: file.id, objectKey: file.objectKey },
        data: { objectKey: `purged/${file.id}`, filePurgedAt: now, sha256: "", mime: "", bytes: 0, filePurgeAt: null } });
    } catch (error) {
      console.error("driver.document.purge.failed", { name: error instanceof Error ? error.name : "Unknown" });
    }
  }

  if (!transactionalEmailConfigured()) return;
  const windowEnd = new Date(now.getTime() + reminderDays * DRIVER_DOCUMENT_DAY_MS);
  const windowStart = new Date(now.getTime() - reminderDays * DRIVER_DOCUMENT_DAY_MS);
  const date = new Intl.DateTimeFormat("en-KE", { dateStyle: "long", timeZone: "Africa/Nairobi" });
  const documents = await db.driverDocument.findMany({
    where: { state: "approved", scanState: "clean", expiresAt: { gt: windowStart, lte: windowEnd }, expiryReminderAt: null,
      application: { status: "approved", policyVersion: POLICY_VERSION, driver: { status: "active", email: { not: null } } } },
    orderBy: { expiresAt: "asc" }, take: limit,
    select: { id: true, type: true, expiresAt: true, application: { select: { ownsVehicle: true, driver: { select: { email: true } } } } },
  });
  for (const document of documents) {
    const expiry = document.expiresAt;
    const title = applicableRequirements(document.application.ownsVehicle).find((r) => r.id === document.type && r.required)?.title;
    const email = document.application.driver.email;
    if (!expiry || !title || !email) continue;
    const claim = await db.driverDocument.updateMany({ where: { id: document.id, state: "approved", expiryReminderAt: null },
      data: { expiryReminderAt: now } });
    if (claim.count !== 1) continue;
    try {
      await sendTransactionalEmail({ to: email, subject: "Renew your Mireli Driver document", tags: ["driver-document-renewal"],
        textContent: `${title} ${expiry > now ? "expires" : "expired"} on ${date.format(expiry)}. Open Mireli Driver, go to Account, and upload your renewed document for review. New assignments require current documents. Renew by ${date.format(documentGraceUntil(expiry))} to keep your blue check.` });
    } catch (error) {
      // Only a definite rejection can be safely retried without sending a duplicate.
      if (error instanceof EmailProviderError && error.outcome === "rejected") {
        await db.driverDocument.updateMany({ where: { id: document.id, expiryReminderAt: now }, data: { expiryReminderAt: null } });
      }
      console.error("driver.document.reminder.failed", { name: error instanceof Error ? error.name : "Unknown" });
    }
  }
}
