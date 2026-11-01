import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAdminSession } from "@/lib/session";
import { audit } from "@/lib/audit";
import { callbackUrls, resolveDaraja, testConnection } from "@/lib/daraja";

/**
 * Admin → Payments. The plug-and-play surface for M-Pesa Daraja:
 *   GET  — current mode (demo / sandbox live / production live), where the
 *          credentials come from (env vars or saved here), masked secrets,
 *          the callback URLs Safaricom will call, and the last test result.
 *   PUT  — save credentials. Blank secret fields KEEP the saved value;
 *          "__clear__" wipes one; "clear all" action wipes everything.
 *   POST — { action: "test_connection" } hits Daraja's OAuth endpoint with
 *          the resolved credentials and reports success/failure.
 *
 * Env vars (MPESA_*) always override what's saved here, so the console stays
 * useful even when credentials are injected by the deployment platform.
 */

function mask(value: string): string {
  if (!value) return "";
  if (value.length <= 8) return `••••${value.slice(-2)}`;
  return `${value.slice(0, 4)}••••${value.slice(-4)}`;
}

async function currentConfig() {
  const cfg = await db.platformConfig.findUnique({ where: { id: "main" } });
  if (!cfg) return db.platformConfig.create({ data: { id: "main" } });
  return cfg;
}

export async function GET() {
  const session = await getAdminSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const cfg = await currentConfig();
  const creds = await resolveDaraja();
  const urls = callbackUrls(creds);

  return NextResponse.json({
    status: {
      mode: creds.mode, // mock | live
      environment: creds.environment,
      source: creds.source, // environment | database | none
      paybill: creds.shortcode || null,
      callbacks: urls,
      hasCallbackBase: !!urls.base,
      liveRefundsEnabled: creds.mode === "live" && process.env.MPESA_LIVE_REFUNDS_ENABLED === "true",
      livePayoutsEnabled: creds.mode === "live" && process.env.MPESA_LIVE_PAYOUTS_ENABLED === "true",
    },
    saved: {
      environment: cfg.mpesaEnvironment,
      consumerKey: mask(cfg.mpesaConsumerKey),
      hasConsumerSecret: !!cfg.mpesaConsumerSecret,
      shortcode: cfg.mpesaShortcode,
      hasPasskey: !!cfg.mpesaPasskey,
      callbackBaseUrl: cfg.mpesaCallbackBaseUrl,
      b2cShortcode: cfg.mpesaB2CShortcode,
      initiatorName: cfg.mpesaInitiatorName,
      hasInitiatorPassword: !!cfg.mpesaInitiatorPassword,
      hasSecurityCredential: !!cfg.mpesaSecurityCredential,
      cert: mask(cfg.mpesaCert),
    },
    lastTest: cfg.mpesaLastTestAt
      ? { at: cfg.mpesaLastTestAt, ok: cfg.mpesaLastTestOk, message: cfg.mpesaLastTestMessage }
      : null,
  });
}

const SECRET_FIELDS = [
  "consumerKey",
  "consumerSecret",
  "passkey",
  "initiatorPassword",
  "securityCredential",
  "cert",
] as const;

export async function PUT(req: NextRequest) {
  const session = await getAdminSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as Record<string, string>;
  const cfg = await currentConfig();

  const data: Record<string, string> = {
    mpesaEnvironment: body.environment === "production" ? "production" : "sandbox",
    mpesaShortcode: (body.shortcode || "").trim(),
    mpesaCallbackBaseUrl: (body.callbackBaseUrl || "").trim().replace(/\/+$/, ""),
    mpesaB2CShortcode: (body.b2cShortcode || "").trim(),
    mpesaInitiatorName: (body.initiatorName || "").trim(),
  };

  // Secrets: blank = keep what's saved; "__clear__" = wipe; otherwise replace.
  for (const field of SECRET_FIELDS) {
    const incoming = (body[field] || "").trim();
    if (incoming === "" || incoming.startsWith("••")) continue;
    data[`mpesa${field.charAt(0).toUpperCase()}${field.slice(1)}`] = incoming === "__clear__" ? "" : incoming;
  }

  await db.platformConfig.update({ where: { id: cfg.id }, data });
  await audit({
    actorId: session.id,
    actorName: session.name,
    actorRole: "admin",
    action: "payments.credentials_update",
    entity: "platform_config",
    entityId: cfg.id,
    metadata: {
      environment: data.mpesaEnvironment,
      shortcode: data.mpesaShortcode || cfg.mpesaShortcode,
      secretsChanged: SECRET_FIELDS.filter((f) => (body[f] || "").trim() && !(body[f] || "").trim().startsWith("••")),
    },
  });

  const creds = await resolveDaraja();
  return NextResponse.json({
    ok: true,
    mode: creds.mode,
    message:
      creds.mode === "live"
        ? `Credentials saved — payments are now LIVE against Daraja ${creds.environment}.`
        : "Credentials saved — still in demo simulation until Consumer Key, Secret, Shortcode and Passkey are all set.",
  });
}

/** Danger-zone: wipe every saved credential (env vars still apply). */
export async function DELETE(req: NextRequest) {
  const session = await getAdminSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { action?: string };
  if (body.action !== "clear_all") return NextResponse.json({ error: "Unknown action" }, { status: 400 });

  await db.platformConfig.update({
    where: { id: "main" },
    data: {
      mpesaConsumerKey: "",
      mpesaConsumerSecret: "",
      mpesaShortcode: "",
      mpesaPasskey: "",
      mpesaCallbackBaseUrl: "",
      mpesaB2CShortcode: "",
      mpesaInitiatorName: "",
      mpesaInitiatorPassword: "",
      mpesaSecurityCredential: "",
      mpesaCert: "",
    },
  });
  await audit({
    actorId: session.id,
    actorName: session.name,
    actorRole: "admin",
    action: "payments.credentials_cleared",
    entity: "platform_config",
    entityId: "main",
  });
  return NextResponse.json({ ok: true, message: "Saved credentials cleared — back to demo simulation (env vars still override)." });
}

export async function POST(req: NextRequest) {
  const session = await getAdminSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { action?: string };
  if (body.action !== "test_connection") return NextResponse.json({ error: "Unknown action" }, { status: 400 });

  const result = await testConnection();
  await db.platformConfig.update({
    where: { id: "main" },
    data: {
      mpesaLastTestAt: new Date(),
      mpesaLastTestOk: result.ok,
      mpesaLastTestMessage: result.message.slice(0, 500),
    },
  });
  await audit({
    actorId: session.id,
    actorName: session.name,
    actorRole: "admin",
    action: "payments.test_connection",
    entity: "platform_config",
    entityId: "main",
    metadata: { ok: result.ok, mode: result.mode, message: result.message.slice(0, 200) },
  });
  return NextResponse.json(result);
}
