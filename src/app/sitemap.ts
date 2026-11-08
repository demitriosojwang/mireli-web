import type { MetadataRoute } from "next";
import { isLocalDemoEnabled } from "@/lib/runtime-mode";

// Resolve the public origin at request time: the same Docker image is used for
// local production-style checks and for the AWS VM.
export const dynamic = "force-dynamic";

const SITE_ORIGIN = process.env.MIRELI_PUBLIC_ORIGIN?.replace(/\/$/, "") || "https://mireli.online";

export default function sitemap(): MetadataRoute.Sitemap {
  // Customer, booking and operations screens are private workflows. Only the
  // public homepage and the public legal pages are intended for search indexing.
  // Keep this list aligned with robots.ts: Disallow'd pages must never appear here.
  if (isLocalDemoEnabled()) return [];
  return [
    { url: SITE_ORIGIN, lastModified: new Date(), changeFrequency: "weekly", priority: 1 },
    { url: `${SITE_ORIGIN}/terms`, lastModified: new Date(), changeFrequency: "yearly", priority: 0.3 },
    { url: `${SITE_ORIGIN}/privacy`, lastModified: new Date(), changeFrequency: "yearly", priority: 0.3 },
  ];
}
