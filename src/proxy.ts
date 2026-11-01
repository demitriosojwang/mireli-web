import {NextRequest, NextResponse} from "next/server";
import {browserSecurityHeaders, contentSecurityPolicy, rejectBrowserMutation} from "@/lib/http-security";
import {isLocalDemoEnabled} from "@/lib/runtime-mode";

export function proxy(request: NextRequest) {
  const development = process.env.NODE_ENV === "development";
  const api = request.nextUrl.pathname.startsWith("/api/");
  // A demo deployment is reached over whatever host or address the operator
  // used, so it derives the trusted origin from the request like the dev
  // server does. A production deployment keeps the pinned public origin.
  const origin = development || isLocalDemoEnabled() ? request.nextUrl.origin : process.env.MIRELI_PUBLIC_ORIGIN;
  if (api && rejectBrowserMutation(request, origin)) {
    return NextResponse.json({error: "Request origin is not allowed."}, {
      status: 403, headers: {...browserSecurityHeaders, "Cache-Control": "no-store"},
    });
  }
  const requestHeaders = new Headers(request.headers);
  // Ignore caller-supplied nonce/CSP values. Each HTML response gets fresh entropy.
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const policy = api ? "default-src 'none'; frame-ancestors 'none'; sandbox" : contentSecurityPolicy(nonce, development);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", policy);
  const response = NextResponse.next({request: {headers: requestHeaders}});
  Object.entries(browserSecurityHeaders).forEach(([key, value]) => response.headers.set(key, value));
  response.headers.set("Content-Security-Policy", policy);
  if (api) response.headers.set("Cache-Control", "no-store");
  if (!development) response.headers.set("Strict-Transport-Security", "max-age=31536000");
  return response;
}

export const config = {matcher: ["/api/:path*", "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|webp|woff2)$).*)"]};
