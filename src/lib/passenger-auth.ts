import { createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { DriverError, text } from "@/lib/driver/errors";
import { emailAddress, emailSignInConfigured } from "@/lib/driver/email";
import { isLocalDemoEnabled } from "@/lib/runtime-mode";

type PassengerChallengeChannel = "passenger_sms" | "passenger_email";

export type VerifiedPassengerChallenge = {
  id: string;
  channel: PassengerChallengeChannel;
  phone: string | null;
  email: string | null;
};

function secret(): string {
  const value = process.env.DRIVER_AUTH_SECRET;
  if (value && value.length >= 32) return value;
  if (isLocalDemoEnabled()) return "local-passenger-auth-fixtures-only-never-production";
  throw new DriverError(503, "AUTH_NOT_CONFIGURED", "Passenger verification is not configured yet.");
}

function requireSessionSecret() {
  if ((process.env.SESSION_SECRET?.length ?? 0) < 32 && !isLocalDemoEnabled()) {
    throw new DriverError(503, "AUTH_NOT_CONFIGURED", "Passenger verification is not configured yet.");
  }
}

function normalizePhone(value: string): string | null {
  const compact = value.trim().replace(/[\s-]/g, "");
  const normalized = compact.startsWith("0")
    ? `+254${compact.slice(1)}`
    : compact.startsWith("254")
      ? `+${compact}`
      : compact;
  return /^\+254[17]\d{8}$/.test(normalized) ? normalized : null;
}

function challengeHash(id: string, code: string): string {
  return createHmac("sha256", secret()).update(`${id}:${code}`).digest("hex");
}

function matchesChallenge(id: string, code: string, expected: string): boolean {
  if (!/^[a-f0-9]{64}$/.test(expected)) return false;
  return timingSafeEqual(Buffer.from(challengeHash(id, code), "hex"), Buffer.from(expected, "hex"));
}

async function limit(scope: string, max: number, windowMs: number) {
  const now = Date.now();
  const key = createHmac("sha256", secret())
    .update(`passenger:${scope}:${Math.floor(now / windowMs)}`)
    .digest("hex");
  const row = await db.driverRateLimit.upsert({
    where: { key },
    create: { key, expiresAt: new Date(now + windowMs) },
    update: { count: { increment: 1 } },
  });
  if (row.count > max) throw new DriverError(429, "RATE_LIMITED", "Please wait before trying again.");
}

function contactFor(value: unknown): { channel: PassengerChallengeChannel; phone: string | null; email: string | null; value: string } {
  if (typeof value !== "string" || value.trim().length < 5 || value.trim().length > 254) {
    throw new DriverError(400, "INVALID_CONTACT", "Enter a valid email address or Kenyan mobile number.");
  }
  const phone = normalizePhone(value);
  if (phone) return { channel: "passenger_sms", phone, email: null, value: phone };
  const email = emailAddress(value);
  return { channel: "passenger_email", phone: null, email, value: email };
}

function ensureDeliveryConfigured(channel: PassengerChallengeChannel) {
  requireSessionSecret();
  if (isLocalDemoEnabled()) return;
  // `secret` also checks the shared OTP signing key used by the driver platform.
  secret();
  if (channel === "passenger_sms" && (!process.env.AT_USERNAME?.trim() || !process.env.AT_API_KEY?.trim())) {
    throw new DriverError(503, "SMS_NOT_CONFIGURED", "Passenger text verification is not configured yet.");
  }
  if (channel === "passenger_email" && !emailSignInConfigured()) {
    throw new DriverError(503, "EMAIL_NOT_CONFIGURED", "Passenger email verification is not configured yet.");
  }
}

async function sendSms(phone: string, code: string) {
  const form = new URLSearchParams({
    username: process.env.AT_USERNAME!,
    to: phone,
    message: `Your Mi-Reli account verification code is ${code}. It expires in 5 minutes. Do not share it.`,
  });
  if (process.env.AT_SENDER_ID) form.set("from", process.env.AT_SENDER_ID);
  const response = await fetch("https://api.africastalking.com/version1/messaging", {
    method: "POST",
    headers: { apiKey: process.env.AT_API_KEY!, Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: form,
    signal: AbortSignal.timeout(10000),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result?.SMSMessageData?.Recipients?.some((recipient: { statusCode: number }) => recipient.statusCode === 101)) {
    throw new Error("SMS delivery failed");
  }
}

async function sendEmail(email: string, code: string) {
  const response = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": process.env.BREVO_API_KEY!, Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      sender: { email: emailAddress(process.env.BREVO_SENDER_EMAIL), name: "Mi-Reli" },
      to: [{ email }],
      subject: "Your Mi-Reli verification code",
      textContent: `Your Mi-Reli verification code is ${code}.\n\nIt expires in 5 minutes. Do not share it. If you did not request it, you can ignore this email.`,
      tags: ["passenger-verification"],
    }),
    signal: AbortSignal.timeout(10000),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || typeof result?.messageId !== "string" || !result.messageId) throw new Error("Email delivery failed");
}

export async function requestPassengerChallenge(contactInput: unknown) {
  const contact = contactFor(contactInput);
  ensureDeliveryConfigured(contact.channel);

  await limit(`request:${contact.channel}:${contact.value}`, 1, 60000);
  await limit(`daily:${contact.channel}:${contact.value}`, 12, 86400000);
  await limit("request-global", 200, 60000);
  await limit("request-global-day", 2000, 86400000);

  const id = randomBytes(24).toString("hex");
  const code = randomInt(100000, 1000000).toString();
  const expiresAt = new Date(Date.now() + 300000);
  const challenge = await db.driverAuthChallenge.create({
    data: { id, phone: contact.phone, email: contact.email, channel: contact.channel, codeHash: challengeHash(id, code), expiresAt },
  });

  if (!isLocalDemoEnabled()) {
    try {
      if (contact.phone) await sendSms(contact.phone, code);
      else await sendEmail(contact.email!, code);
    } catch {
      await db.driverAuthChallenge.updateMany({ where: { id, consumedAt: null }, data: { consumedAt: new Date() } });
      throw new DriverError(503, "VERIFICATION_UNAVAILABLE", "The verification code could not be sent. Try again later.");
    }
  }

  return {
    challengeId: challenge.id,
    expiresAt: challenge.expiresAt,
    cooldownSeconds: 60,
    ...(isLocalDemoEnabled() ? { demoCode: code, simulation: true } : {}),
  };
}

export async function verifyPassengerChallenge(challengeIdInput: unknown, codeInput: unknown): Promise<VerifiedPassengerChallenge> {
  const id = text(challengeIdInput, "Challenge", 48, 48);
  const code = text(codeInput, "Code", 6, 6);
  const denied = () => new DriverError(401, "INVALID_CHALLENGE", "The code is invalid or expired.");
  if (!/^[a-f0-9]{48}$/.test(id) || !/^\d{6}$/.test(code)) throw denied();

  await limit(`verify:${id}`, 6, 300000);
  const challenge = await db.driverAuthChallenge.findUnique({ where: { id } });
  if (!challenge || !["passenger_sms", "passenger_email"].includes(challenge.channel) || challenge.consumedAt || challenge.expiresAt <= new Date() || challenge.attempts >= 5) {
    throw denied();
  }
  const attempted = await db.driverAuthChallenge.updateMany({
    where: { id, channel: challenge.channel, consumedAt: null, attempts: { lt: 5 }, expiresAt: { gt: new Date() } },
    data: { attempts: { increment: 1 } },
  });
  if (attempted.count !== 1 || !matchesChallenge(id, code, challenge.codeHash)) throw denied();
  if ((challenge.channel === "passenger_sms" && !challenge.phone) || (challenge.channel === "passenger_email" && !challenge.email)) throw denied();
  return { id, channel: challenge.channel as PassengerChallengeChannel, phone: challenge.phone, email: challenge.email };
}

export async function consumePassengerChallenge(tx: Prisma.TransactionClient, challenge: VerifiedPassengerChallenge) {
  const consumed = await tx.driverAuthChallenge.updateMany({
    where: { id: challenge.id, channel: challenge.channel, consumedAt: null, expiresAt: { gt: new Date() } },
    data: { consumedAt: new Date() },
  });
  if (consumed.count !== 1) throw new DriverError(401, "INVALID_CHALLENGE", "The code is invalid or expired.");
}
