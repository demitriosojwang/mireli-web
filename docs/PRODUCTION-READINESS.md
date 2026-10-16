# Mireli booking launch checklist

**Status: not ready to accept customer bookings.** The AWS VM and shared API are
healthy internally, but public DNS/TLS is not cut over. The production catalogue
is empty, there is no approved driver, and live payment/email credentials have
not been installed. Keep pooled cabs at zero and do not accept payment until the
end-to-end gates below pass.

## AWS deployment state (read-only SSM verification, 16 October 2026)

- [x] EC2 `i-097df027e02b0708f` is running in `eu-north-1`, with SSM Online.
- [x] One `mireli` Docker container is healthy on image `794fb87`; Caddy and
  Docker are active on the host.
- [x] Internal `GET /api/health` returns `{"status":"ok"}`.
- [x] Internal `GET /api/routes` returns `pointCount: 0` and the confirmed
  KSh 50 booking fee; `GET /api/trains` returns no trains; searching Mtwapa
  returns no points. The production catalogue is therefore genuinely empty.
- [x] Customer availability `GET /api/trips?date=2026-10-16` returns
  `{"hasEligibleDrivers":false,"trips":[]}`. The web app shows zero pooled cabs
  and does not create booking inventory when no eligible driver exists.
- [x] Driver API is strict (`simulation: false`). Phone/email sign-in,
  registration, and navigation are currently closed.
- [x] No driver or stop data was added to make the booking UI look populated.
- [x] Local Docker is a test environment only. The AWS VM continues serving
  independently when the developer's computer is off.
- [ ] `mirelisgr.duckdns.org` still resolves to old IP `105.161.112.67` rather
  than EIP `13.53.183.149`; a public HTTPS health request timed out. Rotate the
  exposed DuckDNS token, update its A record, then verify Caddy TLS and public
  health/status checks from outside AWS.
- [x] The latest application source commit `1d6b5ae` passed GitHub Actions on
  16 October 2026: application verification, AWS infrastructure validation,
  and AMD64/ARM64 production image builds all succeeded ([run 38946592991](https://github.com/demitriosojwang/mireli-web/actions/runs/38946592991)).
- [ ] AWS deployment has not run for this feature branch. The release workflow
  requires a successful `main` build plus its deployment flag and role; AWS
  project policy currently denies creation of the GitHub OIDC provider. Keep
  static AWS keys out of GitHub and use the reviewed short-lived CLI/SSM release
  process until the project policy is resolved.
- [ ] Real passenger/driver authentication, M-Pesa callbacks and reconciliation,
  Brevo ticket delivery, and post-trip payouts are not configured on the VM.
- [ ] Approved stage catalogue, timetable, and driver supply are missing. The
  passenger UI must keep its honest empty state; no customer booking can yet be
  matched successfully.

Previous Vercel checks in older project notes are historical only. AWS EC2 is
the intended web/API host; the local Docker stack does not serve production.

## Completed in this change

- [x] Replace the oversized drop-off list with a searchable, grouped point picker.
- [x] Show loading, empty, and retryable error states for route/timetable data;
  do not leave a blank loading bar when the database has no stages.
- [x] Start a passenger guest session without creating default operator
  settings; issue the welcome credit only when configured credit validity is
  present, and retry guest creation only for a unique-phone collision.
- [x] Check the session-signing key before writing guest records or credits;
  show a retryable booking-session error and block booking submission when
  passenger identity could not be initialized.
- [x] Require an explicit pickup/drop-off point before a cab can be booked.
- [x] Revalidate the route is active and the selected stage is a published
  non-terminus stop in the booking API; reject malformed ride-option booleans
  and invalid fare data before writing a booking.
- [x] Keep available cabs at zero when there are no active, approved drivers.
- [x] Return that empty supply state before running the scheduling tick, and
  limit availability reads to approved-driver and booking-display fields.
- [x] Count and search only active customer stops with a positive fare and a
  non-negative door surcharge; return only that count on initial load and search
  at most 12 matching points on demand instead of downloading every stage.
- [x] Keep the stop picker request-free until the passenger enters at least two
  letters; opening it no longer sends a blank query or claims the catalogue is
  empty while only the search prompt is empty.
- [x] Present stage and door-to-door service as explicit, compact choices;
  show the door surcharge with its full driver pass-through before booking.
- [x] Label the selected stop as a pickup or drop-off according to journey
  direction in booking records and ticket emails; format legacy door-service
  bookings correctly when an email is retried.
- [x] Keep customer stop discovery independent of the booking-fee config read;
  use the confirmed KSh 50 display fee as a discovery fallback and log only a
  sanitized database error code. Trip and booking APIs still require full
  operating settings before they can proceed.
- [x] Allocate eligible drivers across every active route, matching the
  current operating policy.
- [x] Show the flat booking fee in the fare preview and booking total.
- [x] Price a private charter as vehicle capacity × (selected stage fare +
  KSh 100 per vehicle seat). Include the KSh 50 booking fee inside Mireli's
  10% share; pass the rest of the charter fare and the full door-to-door
  surcharge to the driver.
- [x] Create/dispatch a driver payout after trip completion; retain queued and
  failed transfers for recovery.
- [x] Restrict simulated callback and injected failure controls to local demo
  mode at both the admin UI and API layers.
- [x] Replace the passenger four-digit prototype with single-use six-digit
  SMS/email challenges, hashed challenge storage, delivery failure handling,
  rate limits, and a one-minute resend cooldown. Demo codes are local-only.
- [x] Require a verified Kenyan mobile number for new passenger accounts;
  email verification can sign in to an existing account without creating a
  synthetic phone number.

## Must complete before opening bookings

### Approved route catalogue

- [ ] Publish the approved routes and stage names, in order, with coordinates,
  per-stage fare, and door-to-door surcharge. Charter fares are calculated from
  the assigned vehicle capacity and per-stage fare.
- [ ] Add a protected admin route/stage directory or a reviewed data-entry
  workflow. There is no customer-facing source for this catalogue today.
- [ ] Check each route for at least one non-terminus stage, valid fares, and
  coordinates before making it active.
- [ ] Confirm the current flat booking fee is KSh 50 and verify shared-ride
  totals add it once while charter totals include it inside Mireli's 10% share.

### Madaraka Express timetable

- [ ] Confirm that the attached schedule is still current; the PDF has no
  effective date. Enter the confirmed trains in the production timetable.
- [x] Apply each train's destination-day offset when scheduling Mombasa arrival
  pickups, including the 03:55 next-day Nairobi-to-Mombasa night train.
- [ ] Test the feeder schedule against train arrivals/departures. The current
  engine rule leaves Mombasa pickup-stage cabs 120 minutes before the train:
  06:00 for 08:00, 13:00 for 15:00, and 20:00 for 22:00.
- [ ] Until a KRC data feed exists, assign an operator to update timetable
  changes and mark train delays before affected booking cutoffs.

### Driver platform and assignment

- [ ] Agree the production API/database contract with the separate driver-app
  developer and verify both apps use the same production backend.
- [ ] Complete verified driver onboarding, document review, vehicle/PSV checks,
  and payout-destination approval. Do not seed a demo driver into production.
- [ ] Have at least one approved driver onboarded and test assignment,
  capacity, cancellation, reassignment, and the passenger manifest on each
  active route. Under the current policy, every approved active driver can serve
  every active route.
- [ ] Confirm customer availability stays at zero when all drivers are inactive,
  suspended, or unapproved.

### Payments and settlement

- [x] Restrict simulated refund completion to explicit local demo mode. In strict
  mode, the reconciliation sweep leaves a pending refund pending until provider
  confirmation; it cannot report a fake refund as completed.
- [x] Recover confirmed M-Pesa transactions whose ledger write failed. A capture
  arriving after a cancelled/no-show booking is kept in the held ledger, does not
  reopen the booking or send a ticket, and appears in the admin exceptions view.
- [x] Confirm Paybill bookings only when the received amount exactly matches the
  amount due. Mismatched receipts stay unconfirmed and appear in the admin
  exceptions view with received and expected amounts.
- [ ] Add durable, correlated production refund attempts and settle them only from
  verified Daraja results. The current B2C/reversal callback is audit-only, so
  live refunds still need end-to-end implementation and provider sandbox tests.
- [ ] Define and implement handling for a successful payment callback after its
  trip has departed or been cancelled. The closed-booking exception path currently
  covers booking states `cancelled` and `no_show`; verify other trip cutoffs.
- [ ] Configure and verify production Daraja collection callbacks and
  reconciliation. A successful STK prompt alone must not confirm a booking.
- [ ] Run sandbox end-to-end cases for payment success, failure, duplicate and
  missing callbacks, refund/credit, and passenger cancellation cutoffs.
- [ ] Verify completed-trip settlement with real examples: shared ride has no
  percentage commission; a 4-seat charter at KSh 400 per seat totals KSh 2,000,
  including the booking fee; Mireli retains KSh 200 total (including KSh 50 fee)
  and the driver receives KSh 1,800 plus any full home surcharge. Payout
  dispatch begins only after trip completion.
- [ ] Approve and verify each driver's B2C payout destination, then test
  completed, failed, ambiguous, and retried payout outcomes. Keep live payouts
  disabled until reconciliation is proven.
- [ ] Apply the additive booking-fee/commission/payout migration to staging,
  verify the ledger and payout totals, and rehearse rollback/restore before
  production migration.

### Operations, security, and launch checks

- [ ] Configure production `SESSION_SECRET`, `DRIVER_AUTH_SECRET`, Africa's
  Talking SMS credentials, and Brevo email credentials; verify real delivery,
  expiry, resend throttling, and lockout with production-like accounts.
- [ ] Implement and verify administrator authentication/MFA and staff roles.
- [ ] Verify authentication audit records, session revocation, backups, and
  recovery using production-like accounts.
- [ ] Build the exceptions inbox for unassigned trips, safety alerts, stuck
  refunds/payouts, and fairness disputes; ensure alerts reach the operator.
- [ ] Add booking lookup by booking ID/phone and test it with support scenarios.
- [ ] Verify SMS/email delivery, privacy/terms links, and secure document storage
  before opening driver registration.
- [x] Add `/sitemap.xml` for the public booking homepage and `robots.txt` that
  blocks indexing of admin, API, account, and local-demo routes.
- [ ] After DNS/TLS cutover, verify `/sitemap.xml`, `/robots.txt`, canonical
  metadata, and the favicon from the public hostname; do not submit a sitemap
  while the production hostname points elsewhere.
- [ ] Configure the Brevo sender and runtime secret on the AWS VM, authenticate
  the owned mail domain with SPF/DKIM/DMARC, and verify a paid test booking
  reaches a real passenger inbox. Confirm a duplicate callback does not resend
  the ticket and review failures in the admin booking view.
- [ ] Run the GitHub CI workflow for the committed branch and verify the ARM64
  image build. Deploy only an immutable image through the AWS VM release
  procedure; apply migrations only through the reviewed deployment setting.
- [ ] Complete a full customer-to-driver journey in staging: choose route,
  point, date/train and cab; pay; receive confirmation; board with PIN; complete
  trip; confirm driver payout and ledger entries.
- [ ] Recheck production route/trains/driver counts, health/logging, and payment
  mode after deployment. Do not announce bookings until one real staging
  journey succeeds end to end.

## Candidate Mombasa stage and fare note (not production-approved)

The supplied `DOC20261012_10575504_0232.pdf` is a handwritten, one-page scan
that appears to list passenger fares for 4- and 7-seater cabs. Its metadata
gives a creation date of 12 October 2026, but the page has no effective date,
author/sign-off, route origin, or coordinates. Treat this as a working
transcription, not an active catalogue.

The North Coast list brackets entries 1-16 at KSh 400: Kiembeni Mwisho,
Kiembeni Police, Ananda Magaya, San Sera, Green Estate, Kona Kiembeni,
Bamburi Mwisho, Bamburi Naivas, Total Bamburi, Fisheries, Mwenbeni, GCC
Junction, Nyali Centre, VOK, Bambolulu, and Lights. The spelling of Ananda
Magaya, San Sera, and Mwenbeni should be confirmed; entry 8 has a crossed-out
word before “Naivas.”

The remaining listed North Coast fares are Mtwapa KSh 400, Malindi KSh 700,
Changamwe KSh 200, Mikindani KSh 250, Miritini KSh 250, and Town (CBD)/Mwembe
Tayari KSh 300. The South Coast list gives Likoni Ferry Container KSh 400,
Kona Mpya (Fayaz) KSh 400, Shika Adabu (Checkpoint) KSh 400, and Diani Naivas
KSh 500.

The note says 10/11-seater fares should be reduced by “a minimum of KSh 50”; it
does not say whether that is an exact discount or a floor. It also says the
platform “bags” the listed fares, which is not precise enough to define driver
settlement. Do not interpret that wording as Mireli commission. The confirmed
charter rule is vehicle capacity × (selected stage fare + KSh 100 per seat),
with Mireli retaining 10% of the charter fare (including the KSh 50 flat fee)
and the driver receiving the rest plus the full door-to-door surcharge.

The booking and settlement model now uses assigned vehicle capacity for charter
pricing. The separate 10/11-seater discount in the supplied note remains
unresolved, and no discount is inferred from the wording.

Before entering these values, confirm the service origin/direction, whether
each amount is per passenger and applies to both 4- and 7-seaters, the exact
10/11-seater discount, spelling/aliases, and stage coordinates. The list does
not establish train times, driver availability, or a successful booking path.

## Timetable extracted from the supplied PDF

All times are local Kenya time. `NTM` is Nairobi Terminus and `MTM` is Mombasa
Terminus. For Mombasa feeder cabs, Mireli's current engine rule is based on the
MTM departure time; for Nairobi-origin trains, Mireli meets passengers after
arrival at MTM.

| Direction and train | Terminus departure | Voi | MTM/NTM arrival |
| --- | --- | --- | --- |
| NTM to MTM · Inter-County | NTM 08:00 | 12:02 | MTM 14:00 |
| NTM to MTM · Express | NTM 15:00 | 18:48 | MTM 20:30 |
| NTM to MTM · Night Train | NTM 22:00 | 02:05 next day | MTM 03:55 next day |
| MTM to NTM · Inter-County | MTM 08:00 | 09:49 | NTM 14:10 |
| MTM to NTM · Express | MTM 15:00 | 16:38 | NTM 20:18 |
| MTM to NTM · Night Train | MTM 22:00 | 23:45 | NTM 03:55 next day |

The Inter-County train also serves these stops:

- NTM to MTM: Athi River 08:19, Emali 09:27, Kibwezi 10:14, Mtito Andei
  10:50, Miasenyi 12:41, and Mariakani 13:27.
- MTM to NTM: Mariakani 08:26, Miasenyi 09:12, Mtito Andei 11:18, Kibwezi
  11:51, Emali 12:36, and Athi River 13:45.

The PDF also lists Nairobi–Suswa and Suswa–Nairobi excursion trains; those do
not connect to Mireli's current Mombasa routes. It notes long-distance service
on Friday, Saturday, and Sunday. Kenya Railways contact details printed on the
PDF are www.krc.co.ke, info@krc.co.ke, 0709 907 000, and 0709 907 555; these
are not Mireli customer-support contacts.
