import type { MetadataRoute } from "next";

// PWA install manifest. Chrome on Android requires 192px and 512px PNG icons,
// a standalone display mode, and a same-origin start_url that does not
// redirect — the icons under /public/icons are generated from
// public/mireli-logo.svg (see docs/PRODUCTION-READINESS.md).
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Mi-Reli — SGR ride booking from Mombasa Terminus",
    short_name: "Mi-Reli",
    description:
      "Plan a ground ride from Mombasa Terminus with Mi-Reli. Approved stops, published train times, fares, and cab availability appear in the booking flow when service is open.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#1d2438",
    theme_color: "#26304a",
    categories: ["travel", "navigation"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/icons/icon-maskable-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
