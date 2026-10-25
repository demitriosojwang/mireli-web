import { db } from "@/lib/db";
import { evaluateDriverApplication } from "@/lib/driver/eligibility";
import { isLocalDemoEnabled } from "@/lib/runtime-mode";

/** Return approved, active driver IDs that may be shown in customer availability. */
export async function getEligibleDriverIds(): Promise<string[]> {
  const activeDrivers = await db.driver.findMany({
    where: { status: "active" },
    select: {
      id: true,
      status: true,
      application: {
        select: {
          status: true,
          policyVersion: true,
          ownsVehicle: true,
          documents: {
            where: { state: { not: "replaced" } },
            select: { type: true, state: true, scanState: true, expiresAt: true },
          },
        },
      },
    },
  });

  return activeDrivers
    .filter((driver) => isLocalDemoEnabled() || evaluateDriverApplication(driver.application, driver.status).eligible)
    .map((driver) => driver.id);
}
