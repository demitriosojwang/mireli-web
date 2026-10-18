# Mireli booking launch checklist

**Status: not ready to accept customer bookings.** Read-only SSM confirmed the
AWS VM and shared API are healthy internally, but public DNS/TLS is not cut
over. The production catalogue is empty, there is no approved driver, and live
payment/email credentials have not been installed. Keep pooled cabs at zero and
do not accept payment until the end-to-end gates below pass.

## AWS deployment state (read-only SSM verification: 18 October 2026, 13:35 EAT)

- [x] EC2 `i-097df027e02b0708f` is running in `eu-north-1`, with SSM Online.
- [x] AWS identity verification succeeded and SSM reports the node Online with
  agent `3.3.5390.0`. See the
  [driver VM handoff](DRIVER-AGENT-VM-HANDOFF.md) for per-developer access.
- [x] The 13:35 EAT SSM check confirmed Docker, Caddy, and `mireli-app` are
  active. Exactly one `mireli` container is healthy on image `794fb87`, bound
  to `127.0.0.1:3000`; it had been up 47 hours.
- [x] A read-only SSM check at 13:35 EAT confirms internal
  `GET /api/health` returns `{"status":"ok"}`.
- [x] A read-only SSM check at 11:14 EAT found four database migrations through
  `20261011_booking_fee_charter_commission`. The VM enables migrations at
  application startup. Current source commit `10a3d26` includes three
  additional migrations for booking ticket email, train service days, and
  durable refund attempts; they were not yet applied in production at the last
  database inspection. The 13:04 EAT health check did not query migrations.
- [x] The 13:35 EAT internal `GET /api/routes` returns `pointCount: 0` and a
  KSh 50 booking fee; `GET /api/trains` returns no trains; and
  `GET /api/stages?q=Mtwapa` returns `{"points":[],"hasMore":false}`. The
  AWS database has no active published stops, so the drop-off picker must stay
  empty until the owner supplies and publishes the approved catalogue.
- [x] The 11:25 EAT customer availability check for 18 October returned
  `{"hasEligibleDrivers":false,"trips":[]}`. The web app must show zero pooled
  cabs and must not create booking inventory when no eligible driver exists.
- [x] The 13:35 EAT driver API status is strict (`simulation: false`); phone/email sign-in,
  registration, and navigation are currently closed. The status response says
  driver email sign-in is not configured.
- [x] The 13:35 EAT `/api/driver-supply` probe returns HTTP 404 on image
  `794fb87`, although the endpoint exists in the current source. This stale
  image is a release blocker; the new deployment readiness gate will reject an
  image that omits this endpoint.
- [x] No driver or stop data was added to make the booking UI look populated.
- [x] The drop-off problem has two confirmed causes on the two checked hosts.
  On AWS, the catalogue query succeeds but returns `pointCount: 0`; no approved
  stop data exists there. The latest AWS check also found that `/api/driver-supply`
  returns HTTP 404 on image `794fb87`, even though that endpoint exists in the
  current source branch, confirming the live image is behind the branch. The
  legacy public Vercel URL still serves an older
  booking page: its `/api/routes` response says the route catalogue is
  temporarily unavailable, `/api/stages?q=mtwapa` and `/api/trains` return
  empty results, and `/api/driver-supply` returns 404. Its rendered controls
  also differ from the current branch, which hides ride choices until a stop is
  selected. No Vercel settings or deployment were changed. In the current
  source, stop search waits for two typed characters, is debounced, returns at
  most 12 stops, and trip availability runs only after a stop is selected and
  is scoped to that route. Timeouts and loading, empty, and retryable error
  states prevent an indefinite blank field. These source changes are not live
  on AWS until a reviewed image is deployed.
- [x] Local Docker is a test environment only. The AWS VM continues serving
  independently when the developer's computer is off.
- [ ] The 14:49 EAT DNS check still found `mirelisgr.duckdns.org` resolving to
  `105.161.112.67`, not the VM's EIP `13.53.183.149`. Public HTTPS requests to
  `/api/health` and `/api/routes` timed out. TCP port 443 on the VM's EIP is
  reachable, and SSM confirms Caddy listens there with the expected hostname
  and `127.0.0.1:3000` upstream, but a local TLS handshake for that hostname
  fails with an internal TLS alert; no `.crt` file was listed under Caddy's
  data directory. Rotate the exposed DuckDNS token, update its A record, then
  verify certificate issuance and public health/API checks. DNS was not changed.
- [x] Booking source commit `6b30ca4` passed
  [GitHub Actions run #39119655201](https://github.com/demitriosojwang/mireli-web/actions/runs/39119655201),
  including tests, typecheck, lint, build, Prisma validation/generation,
  AMD64/ARM64 image builds, Compose validation, and CloudFormation checks. See
  [PR #4](https://github.com/demitriosojwang/mireli-web/pull/4). The VM still
  runs `794fb87`; passing CI does not mean the branch has been deployed.
- [x] The driver handoff documentation commit `6fde2be` also passed the full
  verification workflow in
  [run #39119957348](https://github.com/demitriosojwang/mireli-web/actions/runs/39119957348).
- [x] Remove the unused `GET /api` Hello World scaffold from source; keep
  `/api/health` as the dedicated health endpoint. The VM still runs the older
  image until a release is promoted.
- [ ] AWS deployment has not run for this feature branch. The release workflow
  requires a successful `main` build plus its deployment flag and role; AWS
  project policy explicitly denies creating a GitHub OIDC provider and also
  denies listing existing providers. The current role listing returned no
  GitHub/Mireli deploy role. The provider inventory and deployment role cannot
  be verified with the current CLI identity. Keep deployment disabled and
  static AWS keys out of GitHub until the project policy is resolved.
- [ ] Real passenger/driver authentication, M-Pesa callbacks and reconciliation,
  Brevo ticket delivery, and post-trip payouts are not configured on the VM.
- [ ] Approved stage catalogue, timetable, and driver supply are missing. The
  passenger UI must keep its honest empty state; no customer booking can yet be
  matched successfully.

The Vercel URL remains a legacy, stale public page and is not a launch target.
AWS EC2 is the intended web/API host; the local Docker stack is for testing only.

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
- [x] Keep the chosen cab ID and passenger-selected travel date through booking
  creation; a stale or full cab now fails without payment instead of silently
  moving the booking to another departure.
- [x] Keep the booking UI and API aligned at a maximum of six pooled seats,
  reject out-of-range server requests instead of silently clamping them, and
  disable a cab card that cannot fit the requested seats.
- [x] Keep route/date trip inventory deferred until a passenger chooses a
  stop, while showing a small, truthful zero-cab state on the homepage when
  the shared approved-driver check confirms there is no eligible supply.
- [x] Defer trip-availability requests until a stop is chosen, and filter the
  availability query to that stop's active route instead of loading every route
  for the selected date and direction on the initial page view.
- [x] Revalidate the route is active and the selected stage is a published
  non-terminus stop in the booking API; reject malformed ride-option booleans
  and invalid fare data before writing a booking.
- [x] Keep available cabs at zero when there are no active, approved drivers.
- [x] Reuse the same approved-driver eligibility check in the booking bootstrap
  and trip-availability API, so the homepage can show zero cabs without running
  the scheduler or loading trip schedules. An unavailable driver check remains
  unknown and does not block stop discovery.
- [x] Return that empty supply state before running the scheduling tick, and
  limit availability reads to approved-driver and booking-display fields.
- [x] Count and search only active customer stops with a positive fare and a
  non-negative door surcharge; return only that count on initial load and search
  at most 12 matching points on demand instead of downloading every stage.
- [x] Gate VM releases on JSON contracts for `/api/routes`, `/api/trains`,
  `/api/stages?q=Mtwapa`, and `/api/driver-supply` in addition to `/api/health`.
  A missing endpoint or failed database-backed response now triggers rollback;
  an empty catalogue and `hasEligibleDrivers: false` remain valid responses.
- [x] Keep the stop picker request-free until the passenger enters at least two
  letters; opening it no longer sends a blank query or claims the catalogue is
  empty while only the search prompt is empty.
- [x] Present stage and door-to-door service as explicit, compact choices;
  show the door surcharge with its full driver pass-through before booking.
- [x] Add a protected, audited Admin → Routes directory for entering and
  reviewing approved routes/stops. New routes start unpublished; route stops
  require coordinates and validated fares/surcharges; publishing requires a
  complete ordered stop list. Published routes must be paused before editing.
  No sample/candidate catalogue is inserted by the app.
- [x] Add a protected, audited Admin → Timetable editor. Train entries start
  unpublished, and entries linked to trip history cannot be rewritten. Each
  train can be limited to confirmed origin-departure weekdays; overnight
  arrivals retain their origin service date.
- [x] Label the selected stop as a pickup or drop-off according to journey
  direction in booking records and ticket emails; format legacy door-service
  bookings correctly when an email is retried.
- [x] Keep customer stop discovery independent from booking-fee and driver
  eligibility reads: `/api/routes` now performs only the active-stop count,
  while fee and boolean-only driver-supply checks run separately. The fee check
  falls back to the confirmed KSh 50 display fee, and logs only a sanitized
  database error code. Trip and booking APIs still require full operating
  settings before they can proceed.
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
- [x] Add a protected admin route/stage directory or a reviewed data-entry
  workflow. Use Admin → Routes to enter the owner-approved values.
- [ ] Check each route for at least one non-terminus stage, valid fares, and
  coordinates before making it active.
- [ ] Confirm the current flat booking fee is KSh 50 and verify shared-ride
  totals add it once while charter totals include it inside Mireli's 10% share.

### Madaraka Express timetable

- [x] Add a protected timetable data-entry screen; do not auto-import a
  schedule whose effective date and operating days are unconfirmed.
- [x] Filter customer availability and generated feeder trips by each train's
  declared origin service weekdays, including next-day arrivals.
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
  exceptions view with received and expected amounts; the passenger is told to
  contact support before trying another payment.
- [x] Persist refund attempts before provider submission, use a private
  per-attempt HTTPS callback, and keep accepted or timed-out transfers pending.
  Only a correlated terminal Daraja result completes the refund and changes the
  ledger; duplicate/conflicting callback handling is idempotent and audited.
- [x] Route admin retries through that same callback flow. An uncertain or
  timed-out attempt cannot be resent; only a confirmed provider failure can be
  retried deliberately, avoiding duplicate refunds.
- [ ] Verify reversal and B2C refund callbacks in Safaricom sandbox, including
  callback query-string preservation and timeout/reconciliation behavior. Keep
  `MPESA_LIVE_REFUNDS_ENABLED=false` until sandbox results are reviewed and the
  public HTTPS callback endpoint is stable.
- [ ] Define and implement handling for a successful payment callback after its
  trip has departed or been cancelled. The closed-booking exception path currently
  covers booking states `cancelled` and `no_show`; verify other trip cutoffs.
- [ ] Configure and verify production Daraja collection callbacks and
  reconciliation. A successful STK prompt alone must not confirm a booking.
- [x] In the current source, require signed authorization tokens on M-Pesa
  callback routes, and save a per-booking payment intent before sending an STK
  request so retries do not
  create duplicate prompts and an early callback can find its booking.
- [ ] From Admin → Payments, register the current signed C2B confirmation URL
  with Safaricom and verify signed STK, timeout, C2B, and B2C callbacks in the
  sandbox. The callback URLs include query parameters; confirm Safaricom
  preserves them through the callback. Their value is derived from the stable
  `SESSION_SECRET`; re-register callbacks and wait for pending payments to
  settle before rotating that secret.
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
