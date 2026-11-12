import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { DriverError } from "@/lib/driver/errors";
import { readBoundedBody } from "@/lib/http-body";
import { requestStaffChallenge, verifyStaffChallenge } from "./auth";
import { publicStaffOrigin, staffAuthConfigured } from "./config";
import { staffLandingPage } from "./routes";
import { STAFF_COOKIE, staffCookieOptions, staffTokenHash } from "./session";

const headers = { "Cache-Control": "no-store" };

export async function staffAuthPost(req: NextRequest) {
  try {
    const origin = publicStaffOrigin();
    if (!origin) throw new DriverError(503, "STAFF_AUTH_NOT_CONFIGURED", "Verified staff sign-in is not configured.");
    if (req.headers.get("origin") !== origin) throw new DriverError(403, "ORIGIN_REJECTED", "Request origin is invalid.");
    if (req.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
      throw new DriverError(415, "JSON_REQUIRED", "Send an application/json request.");
    }

    const bytes = await readBoundedBody(req, 8192);
    const body = parseBody(bytes);
    if (body.step === "logout") {
      const token = req.cookies.get(STAFF_COOKIE)?.value;
      if (token && /^[A-Za-z0-9_-]{43}$/.test(token)) await db.staffSession.updateMany({
        where: { tokenHash: staffTokenHash(token), revokedAt: null }, data: { revokedAt: new Date() },
      });
      const response = NextResponse.json({ ok: true }, { headers });
      response.cookies.set({ ...staffCookieOptions(), value: "", maxAge: 0 });
      return response;
    }

    if (!staffAuthConfigured()) throw new DriverError(503, "STAFF_AUTH_NOT_CONFIGURED", "Verified staff sign-in is not configured.");
    if (body.step === "request") return NextResponse.json(await requestStaffChallenge(body.email), { headers });
    if (body.step !== "verify") throw new DriverError(400, "INVALID_STEP", "Invalid authentication step.");
    const result = await verifyStaffChallenge(body);
    if (result.enrollmentRequired) return NextResponse.json(result, { headers });
    const response = NextResponse.json({ ok: true, landingPage: staffLandingPage(result.roles) }, { headers });
    response.cookies.set({ ...staffCookieOptions(), value: result.token });
    return response;
  } catch (error) {
    return NextResponse.json({
      error: error instanceof DriverError ? error.message : "Staff sign-in is temporarily unavailable.",
      code: error instanceof DriverError ? error.code : "STAFF_AUTH_UNAVAILABLE",
    }, { status: error instanceof DriverError ? error.status : 503, headers });
  }
}

function parseBody(bytes: Buffer): Record<string, unknown> {
  try {
    const body = JSON.parse(bytes.toString());
    if (body && typeof body === "object" && !Array.isArray(body)) return body;
  } catch {
    // Share the same error for malformed JSON and non-object bodies.
  }
  throw new DriverError(400, "INVALID_JSON", "Invalid request body.");
}
