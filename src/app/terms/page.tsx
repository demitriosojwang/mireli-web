import { SiteHeader, SiteFooter } from "@/components/site-chrome";

export const metadata = {
  title: "Terms of Service — Mi-Reli",
  description: "The terms that govern bookings and rides arranged through Mi-Reli.",
};

export default function TermsPage() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <SiteHeader subtitle="Terms of Service" />
      <main className="mx-auto w-full max-w-md flex-1 px-4 py-6 text-sm leading-relaxed text-muted-foreground">
        <h1 className="text-lg font-bold text-foreground">Terms of Service</h1>
        <p className="mt-1 text-xs">
          Last updated: 8 November 2026 · Mi-Reli (Mireli SGR Pilot), Mombasa, Kenya
        </p>

        <div className="mt-5 space-y-5 [&_h2]:text-sm [&_h2]:font-semibold [&_h2]:text-foreground [&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2 [&_p]:mt-1 [&_li]:mt-1">
          <section>
            <h2>1. What Mi-Reli does</h2>
            <p>
              Mi-Reli arranges ground rides that connect with Madaraka Express trains at Mombasa
              Terminus, using approved drivers and designated pickup or drop-off stages. We are a
              booking platform, not a transport operator: each ride is provided by an independent
              driver.
            </p>
          </section>

          <section>
            <h2>2. Booking and fares</h2>
            <ul className="list-disc space-y-0.5 pl-4">
              <li>The full fare and fee breakdown is shown before you confirm a booking.</li>
              <li>A booking is confirmed only after payment is confirmed by the payment provider.</li>
              <li>Shared rides add a KSh 50 Mireli fee per booked seat; charters use Mireli&apos;s 10% share.</li>
              <li>Availability is checked at checkout. If a listed cab cannot serve your journey, we show alternatives or an open state.</li>
            </ul>
          </section>

          <section>
            <h2>3. Payments</h2>
            <p>
              Payments are collected through the method shown at checkout (currently M-Pesa). Never
              send money directly to a driver outside the Mi-Reli checkout. Receipts are shown in
              the app after payment is verified.
            </p>
          </section>

          <section>
            <h2>4. Cancellations and no-shows</h2>
            <p>
              Cancellation terms are shown before you confirm a booking. If you miss your train or
              do not arrive at the stage by the agreed time, the driver may treat the ride as
              no-show; the specific terms presented at checkout then apply.
            </p>
          </section>

          <section>
            <h2>5. Passengers and drivers</h2>
            <ul className="list-disc space-y-0.5 pl-4">
              <li>Passengers: be at the designated stage on time and treat drivers respectfully.</li>
              <li>Drivers: use only Mi-Reli-approved vehicles and stages, and charge only the accepted fare.</li>
              <li>Mi-Reli may refuse service to accounts that misuse the platform.</li>
            </ul>
          </section>

          <section>
            <h2>6. Contacts and complaints</h2>
            <p>
              Questions, complaints or requests (including account deletion): email{" "}
              <a href="mailto:mirelisgr001@gmail.com">mirelisgr001@gmail.com</a>. We aim to respond
              within three working days.
            </p>
          </section>

          <section>
            <h2>7. Changes to these terms</h2>
            <p>
              We may update these terms as the service grows. The &quot;last updated&quot; date
              above always reflects the current version.
            </p>
          </section>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
