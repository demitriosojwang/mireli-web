import { SiteHeader, SiteFooter } from "@/components/site-chrome";

export const metadata = {
  title: "Privacy Policy — Mi-Reli",
  description: "How Mi-Reli collects, uses, and protects passenger and driver data.",
};

export default function PrivacyPage() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <SiteHeader subtitle="Privacy Policy" />
      <main className="mx-auto w-full max-w-md flex-1 px-4 py-6 text-sm leading-relaxed text-muted-foreground">
        <h1 className="text-lg font-bold text-foreground">Privacy Policy</h1>
        <p className="mt-1 text-xs">
          Last updated: 13 November 2026 · Mi-Reli (Mireli SGR Pilot), Mombasa, Kenya
        </p>

        <div className="mt-5 space-y-5 [&_h2]:text-sm [&_h2]:font-semibold [&_h2]:text-foreground [&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2 [&_p]:mt-1 [&_li]:mt-1">
          <section>
            <h2>1. Data we collect</h2>
            <ul className="list-disc space-y-0.5 pl-4">
              <li>Account data: your name and phone number (a guest session is started silently on first visit).</li>
              <li>Booking data: journey, date, train, stage, pickup or drop-off choice, seat count, and fare.</li>
              <li>Payment data: M-Pesa references and amounts. We do not store M-Pesa PINs or card details.</li>
              <li>Driver data (for drivers): vehicle, plate, stage eligibility and payout contact details.</li>
            </ul>
          </section>

          <section>
            <h2>2. How we use it</h2>
            <p>
              To create and manage your booking, let drivers serve the right journey at the right
              time, verify payments, provide support, and meet Kenyan record-keeping obligations.
              We never sell your data.
            </p>
          </section>

          <section>
            <h2>3. Sharing</h2>
            <p>
              Your name, phone number, and journey details are shared with the driver serving your
              booking so they can reach you; your phone number is shown to them only for that
              purpose. Payment references are shared with our payment provider to verify
              transactions.
            </p>
            <p>When a driver searches for a destination or requests a route, Mireli shares the search and relevant location with Amazon Location Service to return places and directions. Satellite imagery and routing data are subject to the <a href="https://docs.aws.amazon.com/location/latest/developerguide/data-attribution.html">Amazon Location data attributions</a>.</p>
          </section>

          <section>
            <h2>4. Storage and retention</h2>
            <p>
              Data is stored on servers in the European Union and Kenya-adjacent regions as the
              service grows. Booking records are kept as long as needed to operate the service and
              meet legal requirements, then deleted or anonymised.
            </p>
            <p>
              Driver document files are kept privately for review and scheduled for deletion seven days after review.
              Mireli keeps the document type, review outcome and expiry date to record verification and send renewal reminders.
              Driver account and payout information are kept separately to operate the service.
            </p>
          </section>

          <section>
            <h2>5. Your rights (Data Protection Act, 2019)</h2>
            <ul className="list-disc space-y-0.5 pl-4">
              <li>Request a copy, correction, or deletion of your personal data.</li>
              <li>Ask us to delete your account at any time.</li>
              <li>Complain to the Office of the Data Protection Commissioner (ODPC).</li>
            </ul>
            <p>
              To exercise any right, email{" "}
              <a href="mailto:mirelisgr001@gmail.com">mirelisgr001@gmail.com</a>. Account deletion
              removes your personal data; completed bookings are retained in anonymised form for
              accounting.
            </p>
            <p className="text-xs">
              ODPC registration status: not yet confirmed. Mi-Reli does not enable precise location
              tracking or open managed bookings until registration is confirmed and a data
              protection impact assessment is complete. This notice will be updated once the
              status changes.
            </p>
          </section>

          <section>
            <h2>6. Cookies and local storage</h2>
            <p>
              The Mi-Reli web app keeps your session in cookies or local storage on your device so
              bookings survive app restarts. We do not run advertising or third-party tracking
              scripts for passengers.
            </p>
          </section>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
