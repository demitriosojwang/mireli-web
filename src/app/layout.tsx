import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { isLocalDemoEnabled } from "@/lib/runtime-mode";
import { connection } from "next/server";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.MIRELI_PUBLIC_ORIGIN?.replace(/\/$/, "") || "https://mirelisgr.duckdns.org"),
  title: "Mi-Reli — SGR ride booking from Mombasa Terminus",
  description:
    "Plan a ground ride from Mombasa Terminus with Mi-Reli. Approved stops, published train times, fares, and cab availability appear in the booking flow when service is open.",
  keywords: ["Mi-Reli", "Mombasa", "SGR", "Madaraka Express", "Mombasa Terminus", "shared rides", "private cab"],
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
