import { emailAddress, transactionalEmailConfigured } from "@/lib/driver/email";
import { mfaEncryptionConfigured } from "./mfa";

const roleLists = {
  admin: "MIRELI_ADMIN_EMAILS",
  compliance: "DRIVER_COMPLIANCE_REVIEWERS",
  finance: "DRIVER_FINANCE_REVIEWERS",
} as const;

export type StaffRole = keyof typeof roleLists;

export function configuredEmails(value: string | undefined): string[] {
  try {
    return [...new Set((value ?? "").split(",").filter(item => item.trim()).map(emailAddress))];
  } catch {
    return [];
  }
}

export function staffRoles(email: string): StaffRole[] {
  if (!configuredEmails(process.env.MIRELI_STAFF_EMAILS).includes(email)) return [];
  return (Object.keys(roleLists) as StaffRole[]).filter(role => configuredEmails(process.env[roleLists[role]]).includes(email));
}

export function configuredStaff(role: StaffRole): string[] {
  return configuredEmails(process.env.MIRELI_STAFF_EMAILS).filter(email => staffRoles(email).includes(role));
}

export function publicStaffOrigin(): string | null {
  const value = process.env.MIRELI_PUBLIC_ORIGIN;
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.origin === value ? value : null;
  } catch {
    return null;
  }
}

export function staffAuthConfigured(): boolean {
  return (process.env.STAFF_AUTH_SECRET?.length ?? 0) >= 32 && mfaEncryptionConfigured() &&
    !!publicStaffOrigin() && transactionalEmailConfigured() &&
    configuredEmails(process.env.MIRELI_STAFF_EMAILS).some(email => staffRoles(email).length > 0);
}
