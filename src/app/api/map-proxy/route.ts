import { NextResponse } from "next/server";
import {
  MAP_PROXY_PATH,
  OPENFREEMAP_ORIGIN,
  isAllowedMapAssetPath,
  resolvePublicOrigin,
  rewriteMapAssetUrls,
} from "@/lib/map-proxy";

const CACHE_CONTROL = "public, max-age=3600, stale-while-revalidate=86400";
const NO_STORE = "no-store";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const path = requestUrl.searchParams.get("path") ?? "";

  if (!isAllowedMapAssetPath(path)) {
    return NextResponse.json(
      { error: "Unsupported map asset." },
      { status: 400, headers: { "cache-control": NO_STORE } },
    );
  }

  try {
    const upstream = await fetch(`${OPENFREEMAP_ORIGIN}/${path}`, { next: { revalidate: 3600 } });

    if (!upstream.ok) {
      return NextResponse.json(
        { error: "The map is temporarily unavailable." },
        { status: 502, headers: { "cache-control": NO_STORE } },
      );
    }

    const contentType = upstream.headers.get("content-type") ?? "application/octet-stream";

    if (contentType.includes("json")) {
      const body = await upstream.text();
      const origin = resolvePublicOrigin(request.url, process.env.MIRELI_PUBLIC_ORIGIN);
      return new NextResponse(rewriteMapAssetUrls(body, origin), {
        status: 200,
        headers: { "content-type": contentType, "cache-control": CACHE_CONTROL },
      });
    }

    return new NextResponse(upstream.body, {
      status: 200,
      headers: { "content-type": contentType, "cache-control": CACHE_CONTROL },
    });
  } catch {
    return NextResponse.json(
      { error: "The map is temporarily unavailable." },
      { status: 502, headers: { "cache-control": NO_STORE } },
    );
  }
}
