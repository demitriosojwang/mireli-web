import { createHash } from "node:crypto";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { staffAuthConfigured, staffRoles } from "./config";

export const STAFF_COOKIE = "__Host-mireli_staff";
export const STAFF_SESSION_SECONDS = 2 * 60 * 60;
export const staffTokenHash = (token: string) => createHash("sha256").update(token).digest("hex");

export function staffCookieOptions() {
  return { name: STAFF_COOKIE, httpOnly: true, secure: true, sameSite: "strict" as const, path: "/", maxAge: STAFF_SESSION_SECONDS };
}

export async function getVerifiedStaffSession() {
  const token = (await cookies()).get(STAFF_COOKIE)?.value;
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token) || !staffAuthConfigured()) return null;
  const session = await db.staffSession.findUnique({
    where: { tokenHash: staffTokenHash(token) },
    select: { accountId: true, expiresAt: true, revokedAt: true,
      account: { select: { email: true, disabledAt: true, mfaEnrolledAt: true } } },
  });
  if (!session || session.revokedAt || session.expiresAt <= new Date() || session.account.disabledAt || !session.account.mfaEnrolledAt) return null;
  const roles = staffRoles(session.account.email);
  if (!roles.length) return null;
  return { id: session.accountId, name: session.account.email, identifier: session.account.email, exp: session.expiresAt.getTime(), roles };
}
