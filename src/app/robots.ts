import type { MetadataRoute } from "next";
import { isLocalDemoEnabled } from "@/lib/runtime-mode";

// Evaluate demo-mode protections and the site origin at runtime because one
// Docker image is reused across local and production environments.
export const dynamic = "force-dynamic";

const SITE_ORIGIN = process.env.MIRELI_PUBLIC_ORIGIN?.replace(/\/$/, "") || "https://mirelisgr.duckdns.org";

export default function robots(): MetadataRoute.Robots {
  if (isLocalDemoEnabled()) {
    return { rules: { userAgent: "*", disallow: "/" } };
  }

  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/admin/", "/api/", "/bookings/", "/credits/", "/login/"],
    },
    sitemap: `${SITE_ORIGIN}/sitemap.xml`,
  };
}
