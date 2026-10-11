import crypto from "crypto";
import { cookies } from "next/headers";
import { isLocalDemoEnabled } from "@/lib/runtime-mode";

/**
 * Lightweight signed-cookie sessions (HMAC-SHA256).
 * The cookie is signed server-side and verified for each request. These
 * signatures do not replace server-side revocation or administrator MFA.
 * Passenger sign-in is verified with a one-time SMS/email challenge.
 */

function sessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (secret && secret.length >= 32) return secret;
  if (isLocalDemoEnabled()) return "mireli-local-preview-only-not-a-production-key";
  throw new Error("SESSION_SECRET must contain at least 32 characters.");
}

const PASSENGER_COOKIE = "mireli_session";
const ADMIN_COOKIE = "mireli_admin";

export type SessionRole = "passenger" | "admin";

export interface Session {
  role: SessionRole;
  id: string; // passenger or admin identity id
  name: string;
  identifier: string; // phone (passenger) or email (admin)
  exp: number; // epoch ms
}

function sign(payload: string): string {
  return crypto.createHmac("sha256", sessionSecret()).update(payload).digest("base64url");
}

export function encodeSession(s: Session): string {
  const body = Buffer.from(JSON.stringify(s)).toString("base64url");
  return `${body}.${sign(body)}`;
}

export function decodeSession(token: string | undefined): Session | null {
  if (!token || token.length > 8192) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  if (!body || !sig || !/^[A-Za-z0-9_-]+$/.test(body) || !/^[A-Za-z0-9_-]{43}$/.test(sig)) return null;
  const expected = sign(body);
  // constant-time compare
  if (
    sig.length !== expected.length ||
    !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
  ) {
    return null;
  }
  try {
    const s = JSON.parse(Buffer.from(body, "base64url").toString()) as Session;
    if (!Number.isSafeInteger(s.exp) || s.exp <= Date.now() ||
        !["passenger", "admin"].includes(s.role) ||
        typeof s.id !== "string" || !s.id ||
        typeof s.name !== "string" || typeof s.identifier !== "string") return null;
    return s;
  } catch {
    return null;
  }
}

export async function getPassengerSession(): Promise<Session | null> {
  const store = await cookies();
  const s = decodeSession(store.get(PASSENGER_COOKIE)?.value);
  return s && s.role === "passenger" ? s : null;
}

export async function getAdminSession(): Promise<Session | null> {
  const store = await cookies();
  const s = decodeSession(store.get(ADMIN_COOKIE)?.value);
  return s && s.role === "admin" ? s : null;
}

export function passengerCookieOptions() {
  return {
    name: PASSENGER_COOKIE,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: 60 * 60 * 24 * 7, // 7 days
  };
}

export function adminCookieOptions() {
  return {
    name: ADMIN_COOKIE,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: 60 * 60 * 12, // 12 hours
  };
}

export { PASSENGER_COOKIE, ADMIN_COOKIE };

// ─── Phone normalization (Kenyan numbers) ───────────────────────────────────

export function normalizePhone(input: string): string | null {
  const digits = input.replace(/[^\d+]/g, "");
  let n = digits.startsWith("+") ? digits.slice(1) : digits;
  if (n.startsWith("254")) n = n.slice(3);
  else if (n.startsWith("0")) n = n.slice(1);
  if (/^[17]\d{8}$/.test(n)) return `+254${n}`;
  return null;
}

export function isAdminEmail(
  email: string,
  adminEmails: string[]
): boolean {
  return adminEmails.map((e) => e.toLowerCase().trim()).includes(email.toLowerCase().trim());
}
