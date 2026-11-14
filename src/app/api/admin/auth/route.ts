import { NextRequest, NextResponse } from "next/server";
import {
  adminCookieOptions,
  encodeSession,
  getAdminSession,
  getStaffConsoleSession,
  isAdminEmail,
} from "@/lib/session";
import { getConfig } from "@/lib/money";
import { audit } from "@/lib/audit";
import { isLocalDemoEnabled } from "@/lib/runtime-mode";
import { staffAuthPost } from "@/lib/staff/http";
import { publicStaffOrigin, staffAuthConfigured } from "@/lib/staff/config";
import { staffLandingPage } from "@/lib/staff/routes";

export async function GET() {
  const headers = { "Cache-Control": "no-store" };
  try {
    const session = await getStaffConsoleSession();
    if (!session) return NextResponse.json({ error: "Sign in to the staff console." }, { status: 401, headers });
    return NextResponse.json({ authenticated: true, landingPage: staffLandingPage(session.roles) }, { headers });
  } catch {
    return NextResponse.json({ error: "Staff sign-in is temporarily unavailable." }, { status: 503, headers });
  }
}

/**
 * Admin authentication — completely separate from the passenger site.
 *  1. Email must be on the admin whitelist (identity, not a UI choice)
 *  2. OTP (prototype: any 6 digits)
 *  3. Second factor: the admin access code from platform config
 * A wrong email gets a generic rejection — the panel's existence isn't advertised.
 */
export async function POST(req: NextRequest) {
  if (!isLocalDemoEnabled()) {
    if (!publicStaffOrigin() || (!staffAuthConfigured() && !req.headers.get("cookie"))) {
      return NextResponse.json({ error: "Verified staff sign-in is not configured." }, { status: 503, headers: { "Cache-Control": "no-store" } });
    }
    return staffAuthPost(req);
  }
  const body = await req.json().catch(() => ({}));
  const step = body.step as string;
  const cfg = await getConfig();
  const adminEmails = JSON.parse(cfg.adminEmails) as string[];

  if (step === "logout") {
    const session = await getAdminSession();
    if (session) {
      await audit({
        actorId: session.id,
        actorName: session.name,
        actorRole: "admin",
        action: "auth.logout",
        entity: "admin",
        entityId: session.id,
      });
    }
    const res = NextResponse.json({ ok: true });
    res.cookies.set({ ...adminCookieOptions(), value: "" });
    return res;
  }

  if (step === "request") {
    const email = String(body.email || "").trim().toLowerCase();
    if (!isAdminEmail(email, adminEmails)) {
      // Generic rejection — no enumeration of admin identities
      return NextResponse.json({ error: "This account does not have admin access." }, { status: 403 });
    }
    return NextResponse.json({ ok: true, email, requires2fa: true, hint: "Prototype: any 6-digit code works" });
  }

  if (step === "verify") {
    const email = String(body.email || "").trim().toLowerCase();
    const code = String(body.code || "").trim();
    const twofa = String(body.twofa || "").trim();
    if (!isAdminEmail(email, adminEmails)) {
      return NextResponse.json({ error: "This account does not have admin access." }, { status: 403 });
    }
    if (!/^\d{6}$/.test(code)) {
      return NextResponse.json({ error: "Enter the 6-digit verification code" }, { status: 400 });
    }
    if (twofa !== cfg.admin2faCode) {
      await audit({
        actorId: email,
        actorName: email,
        actorRole: "admin",
        action: "auth.admin_2fa_failed",
        entity: "admin",
        entityId: email,
      });
      return NextResponse.json({ error: "Invalid access code" }, { status: 403 });
    }
    const session = {
      role: "admin" as const,
      id: email,
      name: email.split("@")[0].replace(/\b\w/g, (c) => c.toUpperCase()),
      identifier: email,
      exp: Date.now() + 12 * 60 * 60 * 1000,
    };
    const res = NextResponse.json({ ok: true, session, landingPage: "/admin" });
    res.cookies.set({ ...adminCookieOptions(), value: encodeSession(session) });
    await audit({
      actorId: email,
      actorName: session.name,
      actorRole: "admin",
      action: "auth.admin_login",
      entity: "admin",
      entityId: email,
      metadata: { twofa: "passed" },
    });
    return res;
  }

  return NextResponse.json({ error: "Unknown step" }, { status: 400 });
}
