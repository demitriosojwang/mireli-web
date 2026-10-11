import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";
import { isLocalDemoEnabled } from "@/lib/runtime-mode";
import { DriverError, text } from "./errors";
import {driverPhoneSignInConfigured,driverRegistrationConfigured} from "./readiness";
import {emailAddress,emailSignInConfigured,sendEmailCode} from "./email";

export const hashToken = (value: string) => createHash("sha256").update(value).digest("hex");
function secret() {
  const value = process.env.DRIVER_AUTH_SECRET;
  if (value && value.length >= 32) return value;
  if (isLocalDemoEnabled()) return "local-driver-auth-fixtures-only-never-production";
  throw new DriverError(503, "AUTH_NOT_CONFIGURED", "Driver sign-in is not configured.");
}
export function phoneNumber(value: unknown): string {
  const valueText = text(value, "Phone", 9, 20).replace(/[\s-]/g, "");
  const normalized = valueText.startsWith("0") ? `+254${valueText.slice(1)}` : valueText.startsWith("254") ? `+${valueText}` : valueText;
  if (!/^\+254[17]\d{8}$/.test(normalized)) throw new DriverError(400, "INVALID_PHONE", "Use a Kenyan mobile number.");
  return normalized;
}
export function challengeHash(id: string, code: string) {
  return createHmac("sha256", secret()).update(`${id}:${code}`).digest("hex");
}
export function matchesChallenge(id: string, code: string, expected: string): boolean {
  const actual = challengeHash(id, code);
  return /^[a-f0-9]{64}$/.test(expected) && timingSafeEqual(Buffer.from(actual, "hex"), Buffer.from(expected, "hex"));
}
async function limit(scope: string, max: number, windowMs: number) {
  const now = Date.now();
  const key = createHmac("sha256", secret()).update(`${scope}:${Math.floor(now / windowMs)}`).digest("hex");
  const row = await db.driverRateLimit.upsert({where: {key}, create: {key, expiresAt: new Date(now + windowMs)}, update: {count: {increment: 1}}});
  if (row.count > max) throw new DriverError(429, "RATE_LIMITED", "Please wait before trying again.");
}
export async function requestChallenge(phoneInput: unknown) {
  const phone = phoneNumber(phoneInput);
  const demo = isLocalDemoEnabled();
  if(!driverPhoneSignInConfigured())
    throw new DriverError(503, "SMS_NOT_CONFIGURED", "Driver sign-in is temporarily unavailable.");
  await limit(`send:${phone}`, 1, 60000);
  await limit(`daily:${phone}`, 12, 86400000);
  await limit("send-global", 200, 60000);
  await limit("send-global-day",200,86400000);
  const id = randomBytes(24).toString("hex");
  const code = randomInt(100000, 1000000).toString();
  const challenge = await db.driverAuthChallenge.create({data: {id, phone, codeHash: challengeHash(id, code), expiresAt: new Date(Date.now() + 300000)}});
  if (!demo) {
    const form = new URLSearchParams({username: process.env.AT_USERNAME!, to: phone, message: `Your Mireli Driver sign-in code is ${code}. It expires in 5 minutes. Do not share it.`});
    if (process.env.AT_SENDER_ID) form.set("from", process.env.AT_SENDER_ID);
    try {
      const response = await fetch("https://api.africastalking.com/version1/messaging", {method: "POST", headers: {apiKey: process.env.AT_API_KEY!, Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded"}, body: form, signal: AbortSignal.timeout(10000)});
      const result = await response.json();
      if (!response.ok || !result.SMSMessageData?.Recipients?.some((r: {statusCode: number}) => r.statusCode === 101)) throw new Error("SMS unavailable");
    } catch {
      await db.driverAuthChallenge.update({where: {id}, data: {consumedAt: new Date()}});
      throw new DriverError(503, "SMS_UNAVAILABLE", "The verification message could not be sent. Try again later.");
    }
  }
  return {challengeId: challenge.id, expiresAt: challenge.expiresAt, cooldownSeconds: 60, ...(demo ? {demoCode: code, simulation: true} : {})};
}
export async function requestEmailChallenge(emailInput:unknown) {
  const email=emailAddress(emailInput),demo=isLocalDemoEnabled();
  if(!demo && !emailSignInConfigured())throw new DriverError(503,"EMAIL_NOT_CONFIGURED","Email sign-in is not connected yet.");
  await limit(`email-send:${email}`,1,60000);
  await limit(`email-daily:${email}`,12,86400000);
  await limit("email-global-day",200,86400000);
  const id=randomBytes(24).toString("hex"),code=randomInt(100000,1000000).toString();
  const challenge=await db.driverAuthChallenge.create({data:{id,email,channel:"email",codeHash:challengeHash(id,code),expiresAt:new Date(Date.now()+300000)}});
  if(!demo)try{await sendEmailCode(email,code);}catch(error){
    await db.driverAuthChallenge.update({where:{id},data:{consumedAt:new Date()}});throw error;
  }
  return {challengeId:challenge.id,expiresAt:challenge.expiresAt,cooldownSeconds:60,channel:"email",...(demo?{demoCode:code,simulation:true}:{})};
}
export async function verifyChallenge(input: Record<string, unknown>) {
  const id = text(input.challengeId, "Challenge", 20, 100);
  const code = text(input.code, "Code", 6, 6);
  const deviceId = text(input.deviceId, "Device", 10, 100);
  await limit(`verify:${id}`, 6, 300000);
  const challenge = await db.driverAuthChallenge.findUnique({where: {id}});
  const denied = () => new DriverError(401, "INVALID_CHALLENGE", "The code is invalid or expired.");
  // Passenger sign-in uses the same storage table with a separate channel.
  // Never allow a passenger OTP to create or authenticate a driver session.
  if (!challenge || !["sms", "email"].includes(challenge.channel) || challenge.consumedAt || challenge.expiresAt <= new Date() || challenge.attempts >= 5) throw denied();
  const attempted = await db.driverAuthChallenge.updateMany({where: {id, consumedAt: null, attempts: {lt: 5}, expiresAt: {gt: new Date()}}, data: {attempts: {increment: 1}}});
  if (attempted.count !== 1 || !/^\d{6}$/.test(code) || !matchesChallenge(id, code, challenge.codeHash)) throw denied();
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + 12 * 3600000);
  const driver = await db.$transaction(async tx => {
    const email=challenge.channel==="email"?challenge.email:null;
    if(!email && !challenge.phone)throw denied();
    const existing=await tx.driver.findUnique({where:email?{email}:{phone:challenge.phone!}});
    // Recruiting may be paused while current drivers still sign in. Do not create a
    // new driver/application unless the independently guarded intake is open.
    if(!existing&&!driverRegistrationConfigured())throw new DriverError(503,"REGISTRATION_PAUSED","Your code is valid. New driver applications are not open yet. Contact Mireli support.");
    const consumed = await tx.driverAuthChallenge.updateMany({where: {id, consumedAt: null, expiresAt: {gt: new Date()}}, data: {consumedAt: new Date()}});
    if (consumed.count !== 1) throw denied();
    const record = existing
      ? await tx.driver.update({where:{id:existing.id},data:email?{emailVerifiedAt:new Date()}:{}})
      : await tx.driver.create({data:{phone:email?null:challenge.phone,email,emailVerifiedAt:email?new Date():null,mpesaNumber:email?"":challenge.phone!,name:"New applicant",plate:"",cabType:"",capacity:1,status:"applicant"}});
    await tx.driverApplication.upsert({where: {driverId: record.id}, update: {}, create: {driverId: record.id}});
    await tx.driverSession.updateMany({where: {driverId: record.id, deviceId, revokedAt: null}, data: {revokedAt: new Date()}});
    await tx.driverSession.create({data: {driverId: record.id, deviceId, tokenHash: hashToken(token), expiresAt}});
    return record;
  });
  return {token, expiresAt, driver: {id: driver.id, name: driver.name, phone: driver.phone,email:driver.email}, simulation: isLocalDemoEnabled()};
}
export async function requireDriver(req: Request) {
  const bearer = req.headers.get("authorization") || "";
  if (!/^Bearer [A-Za-z0-9_-]{43}$/.test(bearer)) throw new DriverError(401, "UNAUTHENTICATED", "Sign in to continue.");
  const session = await db.driverSession.findUnique({where: {tokenHash: hashToken(bearer.slice(7))}, include: {driver: true}});
  if (!session || session.revokedAt || session.expiresAt <= new Date()) throw new DriverError(401, "SESSION_EXPIRED", "Your session has expired. Sign in again.");
  return session;
}
