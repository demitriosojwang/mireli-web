import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { isLocalDemoEnabled } from "@/lib/runtime-mode";
import { connection } from "next/server";

export const metadata: Metadata = {
  title: "Mi-Reli — Reliable rides from the SGR terminus",
  description:
    "Mi-Reli shuttles SGR passengers between Mombasa Terminus (MTM) and the coast: shared-ride pickup and drop-off points across the North Coast (Bamburi, Nyali, Mtwapa, Malindi) and South Coast (Likoni, Diani) — every cab timed to a Madaraka Express departure or arrival. Pay with M-Pesa.",
  keywords: ["Mi-Reli", "Mombasa", "SGR", "Madaraka Express", "Mombasa Terminus", "feeder", "cab", "M-Pesa", "Nyali", "Bamburi", "Mtwapa", "Likoni", "Diani"],
  icons: {
    icon: "/mireli-logo.jpeg",
  },
};

export const viewport: Viewport = {
  themeColor: "#26304a",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Nonce-based CSP requires a fresh server render for every document request.
  await connection();
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className="font-sans antialiased bg-background text-foreground min-h-screen flex flex-col"
      >
        {isLocalDemoEnabled() && <div role="status" className="bg-amber-100 px-4 py-2 text-center text-xs font-medium text-amber-950">LOCAL PREVIEW · Sample bookings and simulated payments · No transport service is booked</div>}
        {children}
        <Toaster />
      </body>
    </html>
  );
}
