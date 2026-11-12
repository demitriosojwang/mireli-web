import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { DriverError } from "@/lib/driver/errors";

const enrollmentTtl = 30 * 60 * 1000;

export function staffAuthSecret(): string {
  const value = process.env.STAFF_AUTH_SECRET;
  if (!value || value.length < 32) throw new DriverError(503, "STAFF_AUTH_NOT_CONFIGURED", "Staff sign-in is not configured.");
  return value;
}

function signature(email: string, payload: string): string {
  return createHmac("sha256", staffAuthSecret()).update(`staff:enrollment:${email}:${payload}`).digest("base64url");
}

export function createStaffEnrollmentCode(email: string, now = Date.now()): string {
  const payload = `${now + enrollmentTtl}.${randomBytes(12).toString("base64url")}`;
  return `${payload}.${signature(email, payload)}`;
}

export function verifyStaffEnrollmentCode(email: string, code: unknown, now = Date.now()): boolean {
  if (typeof code !== "string" || !/^\d{13}\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{43}$/.test(code)) return false;
  const [expiresAt, nonce, supplied] = code.split(".");
  if (Number(expiresAt) <= now || Number(expiresAt) > now + enrollmentTtl) return false;
  return timingSafeEqual(Buffer.from(supplied), Buffer.from(signature(email, `${expiresAt}.${nonce}`)));
}
