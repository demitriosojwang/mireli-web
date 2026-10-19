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
  return { eligible: reasons.length === 0, reasons };
}
