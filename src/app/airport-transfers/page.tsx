import type { Metadata } from "next";
import { Plane } from "lucide-react";
import { SiteFooter, SiteHeader, SiteNav } from "@/components/site-chrome";
import { MIRELI_SUPPORT_PHONE_E164, MIRELI_SUPPORT_PHONE_LOCAL } from "@/lib/support";
import AirportRequestForm from "./request-form";

export const metadata: Metadata = {
  title: "Mombasa & Diani Airport Transfers | Mi-Reli",
  description: "Request a private airport pickup or drop-off at Moi International Airport in Mombasa or Ukunda Airstrip in Diani.",
  alternates: { canonical: "/airport-transfers" },
};

export default function AirportTransfersPage() {
  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <SiteHeader subtitle="Airport transfers" />
      <SiteNav />
      <main className="mx-auto grid w-full max-w-md flex-1 items-start gap-5 px-4 pb-8 pt-2 sm:max-w-2xl sm:px-6 lg:max-w-4xl lg:grid-cols-[0.8fr_1fr] lg:gap-8 lg:pt-5 xl:max-w-5xl">
        <section className="rounded-3xl bg-[#142e2a] p-6 text-white sm:p-8">
          <Plane aria-hidden="true" className="mb-4 size-7 text-emerald-300" />
          <h1 className="max-w-sm text-3xl font-semibold tracking-tight sm:text-4xl">Mombasa &amp; Diani airport transfers</h1>
          <p className="mt-3 max-w-sm text-sm leading-relaxed text-emerald-50/85">
            Request a private ride to or from Moi International Airport or Ukunda Airstrip.
          </p>
          <p className="mt-6 border-t border-white/20 pt-4 text-sm text-emerald-50/85">
            Prefer to call? <a href={`tel:${MIRELI_SUPPORT_PHONE_E164}`} className="font-medium text-white underline underline-offset-4">{MIRELI_SUPPORT_PHONE_LOCAL}</a>
          </p>
        </section>
        <AirportRequestForm />
      </main>
      <SiteFooter airportTransfers />
    </div>
  );
}
