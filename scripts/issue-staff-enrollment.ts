import { emailAddress } from "../src/lib/driver/email";
import { staffRoles } from "../src/lib/staff/config";
import { createStaffEnrollmentCode } from "../src/lib/staff/enrollment";

try {
  const email = emailAddress(process.argv[2]);
  if (staffRoles(email).length === 0) throw new Error("The identity requires a staff allowlist entry and at least one role.");
  process.stdout.write(`${createStaffEnrollmentCode(email)}\n`);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : "Unable to issue a setup code."}\n`);
  process.exitCode = 1;
}
