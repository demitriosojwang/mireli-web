import type { MetadataRoute } from "next";
import { isLocalDemoEnabled } from "@/lib/runtime-mode";

// Resolve the public origin at request time: the same Docker image is used for
// local production-style checks and for the AWS VM.
export const dynamic = "force-dynamic";

const SITE_ORIGIN = process.env.MIRELI_PUBLIC_ORIGIN?.replace(/\/$/, "") || "https://mirelisgr.duckdns.org";

export default function sitemap(): MetadataRoute.Sitemap {
  // Customer, booking and operations screens are private workflows. Only the
  // public homepage is currently intended for search indexing.
  if (isLocalDemoEnabled()) return [];
  return [{ url: SITE_ORIGIN, changeFrequency: "weekly", priority: 1 }];
}
