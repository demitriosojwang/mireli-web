import { isLocalDemoEnabled } from "@/lib/runtime-mode";
import { applicableRequirements, POLICY_VERSION } from "./catalogue";

type EligibilityApplication = {
  status: string;
  policyVersion: string | null;
  ownsVehicle: boolean;
  documents: { type: string; state: string; scanState: string; expiresAt: Date | null }[];
};

export function evaluateDriverApplication(
  app: EligibilityApplication | null,
  driverStatus: string,
  now = new Date(),
  demo = isLocalDemoEnabled(),
) {
  const reasons: string[] = [];
  if (!app || app.status !== "approved") reasons.push("Your application requires compliance approval.");
  if (app) {
    if (driverStatus !== "active") reasons.push("Your driver account is not active.");
    if (app.policyVersion !== POLICY_VERSION) reasons.push("Your driver policy acknowledgement needs updating.");
    applicableRequirements(app.ownsVehicle).filter((r) => r.required).forEach((requirement) => {
      if (!app.documents.some((document) =>
        document.type === requirement.id &&
        document.state === "approved" &&
        (document.scanState === "clean" || (demo && document.scanState === "clean_demo")) &&
        (!document.expiresAt || document.expiresAt > now),
      )) reasons.push(`${requirement.title} needs current approved evidence.`);
    });
  }
  // The blue check is the driver-facing mark of this same evaluation. It is not a
  // separate approval step: it is true only while every required document is
  // approved, scanned clean and unexpired, the application is approved and the
  // account is active. It disappears the moment any of that stops being true,
  // which is why it is derived here rather than stored as a flag someone could
  // leave set after a document expired.
  const verified = reasons.length === 0;
  const required = app ? applicableRequirements(app.ownsVehicle).filter((r) => r.required) : [];
  const approvedDocuments = app
    ? required.filter((requirement) => app.documents.some((document) =>
        document.type === requirement.id &&
        document.state === "approved" &&
        (document.scanState === "clean" || (demo && document.scanState === "clean_demo")) &&
        (!document.expiresAt || document.expiresAt > now),
      )).length
    : 0;
  return {
    eligible: verified,
    verified,
    verifiedDocuments: approvedDocuments,
    requiredDocuments: required.length,
    reasons,
  };
}
