import { isLocalDemoEnabled } from "@/lib/runtime-mode";
import { applicableRequirements, POLICY_VERSION } from "./catalogue";

type EligibilityApplication = {
  status: string;
  policyVersion: string | null;
  ownsVehicle: boolean;
  documents: { type: string; state: string; scanState: string; expiresAt: Date | null }[];
};

export const DRIVER_DOCUMENT_DAY_MS = 86_400_000;
export const DRIVER_DOCUMENT_GRACE_DAYS = 30;

export function documentGraceUntil(expiry: Date): Date {
  return new Date(expiry.getTime() + DRIVER_DOCUMENT_GRACE_DAYS * DRIVER_DOCUMENT_DAY_MS);
}

export function evaluateDriverApplication(
  app: EligibilityApplication | null,
  driverStatus: string,
  now = new Date(),
  demo = isLocalDemoEnabled(),
) {
  const reasons: string[] = [];
  if (!app || app.status !== "approved") reasons.push("Your application requires compliance approval.");
  if (app && driverStatus !== "active") reasons.push("Your driver account is not active.");
  if (app && app.policyVersion !== POLICY_VERSION) reasons.push("Your driver policy acknowledgement needs updating.");
  const accountApproved = reasons.length === 0;
  const required = app ? applicableRequirements(app.ownsVehicle).filter((r) => r.required) : [];
  const evidence = app?.documents ?? [];
  const expiringDocuments: { type: string; expiresAt: Date }[] = [];
  const graceDeadlines: Date[] = [];
  let approvedDocuments = 0;
  let withinGrace = true;
  for (const requirement of required) {
    const documents = evidence.filter((d) => d.type === requirement.id && d.state === "approved" &&
      (d.scanState === "clean" || (demo && d.scanState === "clean_demo")));
    if (!requirement.expires && documents.some((d) => !d.expiresAt)) {
      approvedDocuments++;
      continue;
    }
    const latest = documents.reduce<Date | null>((date, d) =>
      d.expiresAt && (!date || d.expiresAt > date) ? d.expiresAt : date, null);
    if (latest && latest > now) {
      approvedDocuments++;
      if (latest.getTime() - now.getTime() <= DRIVER_DOCUMENT_GRACE_DAYS * DRIVER_DOCUMENT_DAY_MS) {
        expiringDocuments.push({ type: requirement.id, expiresAt: latest });
      }
      continue;
    }
    reasons.push(`${requirement.title} needs current approved evidence.`);
    const deadline = latest && documentGraceUntil(latest);
    if (deadline && deadline > now) graceDeadlines.push(deadline);
    else withinGrace = false;
  }
  const verified = accountApproved && withinGrace;
  return {
    eligible: reasons.length === 0,
    verified,
    graceUntil: verified ? graceDeadlines.sort((a, b) => a.getTime() - b.getTime())[0] ?? null : null,
    expiringDocuments: accountApproved ? expiringDocuments : [],
    verifiedDocuments: approvedDocuments,
    requiredDocuments: required.length,
    reasons,
  };
}
