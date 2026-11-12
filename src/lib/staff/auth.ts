import { createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";
import { DriverError } from "@/lib/driver/errors";
import { emailAddress, sendEmailCode } from "@/lib/driver/email";
import { staffRoles } from "./config";
import { staffAuthSecret, verifyStaffEnrollmentCode } from "./enrollment";
import { decryptMfaSecret, encodeBase32, encryptMfaSecret, matchTotp } from "./mfa";
import { STAFF_SESSION_SECONDS, staffTokenHash } from "./session";

export function staffChallengeHash(id: string, code: string): string {
  return createHmac("sha256", staffAuthSecret()).update(`staff:challenge:${id}:${code}`).digest("hex");
}

const denied = () => new DriverError(401, "INVALID_STAFF_CHALLENGE", "The verification codes are invalid or expired.");

async function rate(scope: string, max: number, windowMs: number): Promise<boolean> {
  const now = Date.now();
  const key = createHmac("sha256", staffAuthSecret()).update(`staff:rate:${scope}:${Math.floor(now / windowMs)}`).digest("hex");
  const row = await db.driverRateLimit.upsert({
    where: { key }, create: { key, expiresAt: new Date(now + windowMs) }, update: { count: { increment: 1 } },
  });
  return row.count <= max;
}

export async function requestStaffChallenge(input: unknown) {
  const email = emailAddress(input);
  const id = randomBytes(24).toString("hex");
  const expiresAt = new Date(Date.now() + 300000);
  const response = { challengeId: id, expiresAt, cooldownSeconds: 60 };
  if (!staffRoles(email).length) return response;
  const account = await db.staffAccount.findUnique({ where: { email }, select: { disabledAt: true } });
  if (account?.disabledAt || !await rate(`send:${email}`, 1, 60000) || !await rate(`daily:${email}`, 12, 86400000)) return response;

  const code = randomInt(100000, 1000000).toString();
  await db.staffAuthChallenge.create({ data: { id, email, expiresAt, codeHash: staffChallengeHash(id, code) } });
  try {
    await sendEmailCode(email, code, "staff");
  } catch {
    await db.staffAuthChallenge.updateMany({ where: { id }, data: { consumedAt: new Date() } });
  }
  return response;
}

export async function verifyStaffChallenge(input: Record<string, unknown>) {
  const { challengeId: id, code, twofa, setupCode } = input;
  if (typeof id !== "string" || !/^[a-f0-9]{48}$/.test(id) || typeof code !== "string" || !/^\d{6}$/.test(code)) throw denied();
  const challenge = await db.staffAuthChallenge.findUnique({ where: { id } });
  if (!challenge || challenge.consumedAt || challenge.expiresAt <= new Date() || !staffRoles(challenge.email).length) throw denied();
  const attempted = await db.staffAuthChallenge.updateMany({
    where: { id, consumedAt: null, attempts: { lt: 5 }, expiresAt: { gt: new Date() } },
    data: { attempts: { increment: 1 } },
  });
  if (attempted.count !== 1 || !/^[a-f0-9]{64}$/.test(challenge.codeHash) ||
      !timingSafeEqual(Buffer.from(staffChallengeHash(id, code), "hex"), Buffer.from(challenge.codeHash, "hex"))) throw denied();

  let account = await db.staffAccount.findUnique({ where: { email: challenge.email } });
  if (account?.disabledAt) throw denied();
  if (!account?.mfaEnrolledAt && !verifyStaffEnrollmentCode(challenge.email, setupCode)) {
    throw new DriverError(401, "STAFF_SETUP_REQUIRED", "Enter the staff setup code issued separately by your administrator.");
  }
  if (!account) {
    const accountId = randomBytes(24).toString("hex");
    const totpSecret = encryptMfaSecret(accountId, encodeBase32(randomBytes(20)));
    account = await db.staffAccount.upsert({
      where: { email: challenge.email }, update: {}, create: { id: accountId, email: challenge.email, totpSecret },
    });
  }
  if (!account.totpSecret || account.disabledAt) throw denied();
  const totpSecret = decryptMfaSecret(account.id, account.totpSecret);
  if (!account.mfaEnrolledAt && !twofa) return { enrollmentRequired: true, totpSecret } as const;
  const step = matchTotp(totpSecret, typeof twofa === "string" ? twofa : "", account.lastTotpStep);
  if (step === null) throw denied();

  const token = randomBytes(32).toString("base64url");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + STAFF_SESSION_SECONDS * 1000);
  await db.$transaction(async tx => {
    const claimed = await tx.staffAuthChallenge.updateMany({
      where: { id, consumedAt: null, expiresAt: { gt: now } }, data: { consumedAt: now },
    });
    if (claimed.count !== 1) throw denied();
    const enrolled = await tx.staffAccount.updateMany({
      where: { id: account.id, disabledAt: null, totpSecret: account.totpSecret, lastTotpStep: { lt: step } },
      data: { lastTotpStep: step, mfaEnrolledAt: account.mfaEnrolledAt ?? now },
    });
    if (enrolled.count !== 1) throw denied();
    await tx.staffSession.create({ data: { accountId: account.id, tokenHash: staffTokenHash(token), expiresAt } });
    await tx.auditLog.create({ data: {
      actorId: account.id, actorName: account.email, actorRole: "staff", action: "staff.verified_login",
      entity: "staff_account", entityId: account.id, metadata: JSON.stringify({ roles: staffRoles(account.email) }),
    } });
  });
  return { token, roles: staffRoles(account.email) };
}
