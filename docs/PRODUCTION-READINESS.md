# Mireli booking launch checklist

**Status: not ready to accept customer bookings.** The last read-only SSM check
on 18 October found the AWS VM and API healthy internally, but public DNS/TLS
was not cut over. The production catalogue was empty and the deployed image
could not report eligible driver supply. The `mireli` AWS CLI session is now
expired, so those production findings have not been rechecked today. Live
payment/email credentials have not been verified. Keep pooled cabs at zero and
do not accept payment until the end-to-end gates below pass.

## Local Docker verification (19 October 2026, 21:18 EAT)

- [x] Rebuilt `mireli-web:latest` from the current working tree after detecting
  that the prior local image dated 18 October was stale. The production build
  compiled, TypeScript passed, and Next.js generated all 55 static pages.
- [x] The single local container `mireli-app-1` is healthy on the rebuilt image,
  bound to `127.0.0.1:3000`. The existing `mireli_db-data` and
  `mireli_app-state` volumes remain attached. Startup logs confirm versioned
  migrations and operations-settings bootstrap completed.
- [x] Read-only local API checks returned `/api/health` 200,
  `/api/routes` 200 with `pointCount: 0`, `/api/trains` 200 with no trains,
  `/api/stages?q=mtwapa` 200 with no matches, and `/api/driver-supply` 200
  with `hasEligibleDrivers: false`. The live local booking page states
  bookings are not open and shows `0 pooled cabs`; no driver or route inventory
  was invented.
- [x] The local banner labels this runtime `LOCAL PREVIEW` with simulated
  payments. `/api/pay/options` advertises `mpesa_stk` inside this demo; this is
  not proof of real Daraja credentials, collection, or settlement.
- [x] The demo `/sitemap.xml` is an empty XML urlset and `/robots.txt`
  disallows indexing. Do not submit this local demo sitemap to search engines.
- [x] Current source validation: 236 tests passed across 45 files;
  `tsc --noEmit`, ESLint, and `git diff --check` passed. These are source/local
  checks, not a successful customer-to-driver production booking.
- [ ] A live stop-picker interaction with actual approved stage data is still
  unverified: the empty route catalogue correctly keeps the picker closed.
- [ ] A workstation DNS/TLS probe at 21:37 EAT resolves
  `mirelisgr.duckdns.org` to `105.161.112.67`, not the VM's
  `13.53.183.149`; TCP 443 is unreachable and the HTTPS health request timed
  out. The `mireli` AWS CLI session is expired, so SSM was not rechecked. No
  AWS, VM, or DNS configuration was changed.

## AWS deployment state (read-only SSM verification: 18 October 2026, 18:18 EAT)

- [x] EC2 `i-097df027e02b0708f` is running in `eu-north-1`, with SSM Online.
- [x] AWS identity verification succeeded and SSM reports the node Online with
  agent `3.3.5390.0`. See the
  [driver VM handoff](DRIVER-AGENT-VM-HANDOFF.md) for per-developer access.
- [x] The 14:07 EAT SSM check confirmed Docker, Caddy, and `mireli-app` are
  active. Exactly one `mireli` container is healthy on image `794fb87`, bound
  to `127.0.0.1:3000`; it had been up 47 hours.
- [x] A read-only SSM check at 14:07 EAT confirms internal
  `GET /api/health` returns `{"status":"ok"}`.
- [x] A read-only SSM check at 11:14 EAT found four database migrations through
  `20261011_booking_fee_charter_commission`. The VM enables migrations at
  application startup. Current source commit `10a3d26` includes three
  additional migrations for booking ticket email, train service days, and
  durable refund attempts; they were not yet applied in production at the last
  database inspection. The 13:04 EAT health check did not query migrations.
- [x] The 14:07 EAT internal `GET /api/routes` returns `pointCount: 0` and a
  KSh 50 booking fee; `GET /api/trains` returns no trains; and
  `GET /api/stages?q=Mtwapa` returns `{"points":[],"hasMore":false}`. The
  AWS database has no active published stops, so the drop-off picker must stay
  empty until the owner supplies and publishes the approved catalogue.
- [x] The 11:25 EAT customer availability check for 18 October returned
  `{"hasEligibleDrivers":false,"trips":[]}`. The web app must show zero pooled
  cabs and must not create booking inventory when no eligible driver exists.
- [x] The 14:07 EAT driver API status is strict (`simulation: false`); phone/email sign-in,
  registration, and navigation are currently closed. The status response says
  driver email sign-in is not configured.
- [x] The 14:07 EAT `/api/driver-supply` probe returns HTTP 404 on image
  `794fb87`, although the endpoint exists in the current source. This stale
  image is a release blocker; the new deployment readiness gate will reject an
  image that omits this endpoint.
- [x] At 14:20 EAT, `/api/pay/options` on the VM returned HTTP 500 while the
  health and booking catalogue endpoints were responding. Checkout payment
  readiness is unresolved on the deployed image; do not assume M-Pesa is
  configured or request customer payment. The current source now has a safe
  503 response and a booking preflight that refuses cash bookings before
  allocation when STK or its signed HTTPS callback is unavailable. Code commit
  `83f59b0` passed CI run
  [#39124074073](https://github.com/demitriosojwang/mireli-web/actions/runs/39124074073),
  but has not been deployed to the VM.
- [x] At 15:02 EAT, SSM still reports the VM Online and the container healthy
  on image `794fb87`. `/api/health` returns 200, but `/api/driver-supply`
  remains 404 and `/api/pay/options` remains 500. `/api/routes` reports zero
  published stops, `/api/trains` is empty, and the strict driver status keeps
  sign-in, registration, and navigation closed. No VM or DNS changes were
  made during this verification.
- [x] Fresh read-only SSM checks at 15:13–15:15 EAT reconfirmed that the node
  is Online (Amazon Linux 2023, agent `3.3.5390.0`), and Docker, Caddy, and
  `mireli-app` are active. The single healthy container still runs image
  `794fb87`. `/api/health` returns 200; `/api/routes` reports `pointCount: 0`;
  `/api/trains` returns no trains; `/api/stages?q=Mtwapa` returns no points;
  `/api/driver-supply` returns 404; `/api/pay/options` returns 500; and strict
  driver status keeps sign-in, registration, and navigation closed. SSM command
  IDs are `0d8f4b77-f34d-415d-8a13-e3ee4d0e68e4` and
  `df1d344f-6bb7-4773-a6ec-decf6bf20a21`. No VM configuration, application
  image, or DNS record was changed.
- [x] A new read-only SSM check at 15:43 EAT reconfirmed SSM Online and the
  healthy `794fb87` container. `/api/health` is 200, `/api/routes` reports zero
  points, `/api/trains` is empty, stage search is 200, `/api/driver-supply` is
  404, `/api/pay/options` is 500, and driver sign-in, registration, and
  navigation remain closed. Command ID:
  `04972fa3-995a-423a-968a-e7d4e13ca038`. No VM or DNS configuration changed.
- [x] A fresh read-only SSM check at 15:48 EAT again confirmed the healthy
  `794fb87` container and `/api/health` 200. `/api/routes` reports zero points
  and the KSh 50 booking fee; `/api/trains` is empty; `/api/driver-supply`
  returns 404; `/api/pay/options` returns 500; and strict driver status keeps
  sign-in, registration, and navigation closed. Command ID:
  `f3145d6e-c336-4b52-8338-89f5628a8420`. No VM, DNS, or AWS configuration
  changed.
- [x] The 16:17 EAT SSM health check reconfirmed one healthy `794fb87`
  container. `/api/health` is 200, routes report zero published points, trains
  are empty, `/api/driver-supply` still resolves to the framework not-found
  page, `/api/pay/options` is 500, and driver sign-in/registration/navigation
  remain closed. Command ID:
  `9137394a-1584-40bf-9b64-b3ed2e260caf`. No app or AWS configuration changed.
- [x] The 16:37 EAT read-only SSM check found no VM deployment since the prior
  check: one healthy `794fb87` container, `/api/health` 200, zero published
  points, no trains, `/api/driver-supply` 404, `/api/pay/options` 500, and
  driver sign-in/registration/navigation closed. Command ID:
  `17d4f5dc-26e7-4c70-993a-58151185e2bf`. No app, VM, or DNS configuration
  changed.
- [x] Fresh read-only SSM checks at 16:43 EAT confirmed the node Online
  (Amazon Linux 2023, agent `3.3.5390.0`; last ping 16:38 EAT), with Docker,
  Caddy, and `mireli-app` active and one healthy `794fb87` container. HTTP
  results: `/api/health` 200; `/api/routes` 200 with `pointCount: 0`;
  `/api/trains` 200 with no trains; `/api/driver-supply` 404;
  `/api/pay/options` 500; `/api/v1/driver/status` 200 with
  `simulation: false`. The current status response did not report sign-in
  capability, so Android driver authentication is not verified ready. Command
  IDs: `8d1da7d6-9c1c-4081-aa11-29c3a89ec21c` and
  `508cc79a-5f22-4559-b3ac-ea4d1fcb9398`. No app, VM, or DNS configuration
  changed.
- [x] A 17:03 EAT read-only SSM check reconfirmed the node Online (last ping
  16:58 EAT), and the healthy `mireli` container still runs image `794fb87`.
  `/api/health` is 200; `/api/routes` is 200 with zero points; `/api/trains` is
  200 with zero trains; `/api/driver-supply` is 404; `/api/pay/options` is 500;
  and `/api/v1/driver/status` is 200 with `simulation: false`. The status body
  does not establish Android sign-in readiness. Command ID:
  `bcd7fbb0-da43-4d8c-bfec-7aee44dbf11a`. No VM, app, or DNS changes were made.
- [x] A concise 17:11 EAT read-only SSM probe reconfirmed the single healthy
  `mireli` container on image `794fb87`. Endpoint status: `/api/health` 200,
  `/api/routes` 200, `/api/trains` 200, `/api/driver-supply` 404,
  `/api/pay/options` 500, `/api/v1/driver/status` 200, and `/sitemap.xml` 404.
  The VM remains on the older image; current local source changes are not live.
  Command ID: `4ca4874a-4d8e-45cf-99f5-e8d4eb380388`. No VM, app, or DNS
  configuration changed.
- [x] The 17:25 EAT read-only SSM probe again found image `794fb87` healthy,
  zero route points, zero trains, and strict driver mode (`simulation: false`).
  Endpoint status remains `/api/driver-supply` 404, `/api/pay/options` 500,
  and `/sitemap.xml` 404. The container and DNS were not changed. Command ID:
  `1bc65922-bc19-4023-9c0d-5eeca08b65b0`.
- [x] A fresh 17:31 EAT SSM check confirmed the VM is running with SSM Online;
  Docker, Caddy, and `mireli-app` are active, and one healthy container still
  runs image `794fb87`. `/api/health` is 200, `/api/routes` reports zero
  published points, `/api/trains` is empty, and `/api/stages?q=Mtwapa` is 200
  JSON but has no published stop to return. `/api/driver-supply` and
  `/sitemap.xml` are 404, `/api/pay/options` is 500, and strict driver status
  confirms phone sign-in, email sign-in, registration, and navigation are
  closed. Driver supply remains unverified; do not treat the missing endpoint
  as a driver count. SSM command IDs:
  `57536900-07ef-465a-86eb-2283a83a5ce5` and
  `c7029710-61ef-479e-801c-c4282a25d63b`. No VM, application, or DNS
  configuration changed.
- [x] A fresh 17:43 EAT SSM check again confirmed the single healthy `mireli`
  container remains on image `794fb87`; Docker, Caddy, and `mireli-app` are
  active. `/api/health`, `/api/routes`, `/api/trains`, and `/api/stages?q=Mtwapa`
  return HTTP 200; the route catalogue still has zero points and the timetable
  is empty. `/api/driver-supply` and `/sitemap.xml` return 404, payment options
  return 500, and driver phone/email sign-in, registration, and navigation
  remain closed. Command ID: `f7f45888-d79d-4310-adad-9a7486b5490f`. No VM,
  application, or DNS settings changed.
- [x] A 17:55 EAT read-only SSM check reconfirmed Docker, Caddy, and
  `mireli-app` active with one healthy `794fb87` container. `/api/health`
  returns 200; routes have zero points; trains are empty; stage search is JSON
  with no stops; `/api/driver-supply` and `/sitemap.xml` return 404;
  `/api/pay/options` returns 500; and strict driver status keeps sign-in,
  registration, and navigation closed. EC2 has no key pair and TCP 22 is
  unreachable; use SSM. Command ID:
  `583f36f1-a582-47e3-bd0d-32026ccd1d75`. No VM, app, or DNS changes were made.
- [x] A fresh 18:18 EAT read-only SSM check reconfirmed the node Online
  (Amazon Linux 2023; agent `3.3.5390.0`, last ping 18:13), with Docker, Caddy,
  and `mireli-app` active and one healthy container still on image `794fb87`.
  `/api/health`, `/api/routes`, `/api/trains`, and `/api/stages?q=Mtwapa`
  return 200; `/api/driver-supply` and `/sitemap.xml` return 404;
  `/api/pay/options` returns 500; and `/api/v1/driver/status` returns 200.
  EC2 has no key pair, its security group has no inbound TCP 22 rule, and the
  workstation's port 22 check failed. SSM command ID:
  `6384846d-b013-404e-a315-3b1bddfafda0`. No VM, application, security-group,
  or DNS configuration changed.
- [x] External reachability check at 19:30 EAT confirmed that the EC2 Elastic
  IP `13.53.183.149` is associated with `i-097df027e02b0708f`, but
  `mirelisgr.duckdns.org` resolves to `105.161.112.67` via the workstation DNS,
  Cloudflare, and Google resolvers. HTTPS requests for `/api/health` and
  `/sitemap.xml` timed out without an HTTP response. DNS and VM settings were
  not changed. Rotate the previously exposed DuckDNS token before fixing the A
  record; do not publish or reuse that token.
- [ ] Eligible driver supply could not be confirmed: the deployed
  `/api/driver-supply` endpoint returns 404, and a read-only aggregate query
  through the container Prisma client failed during client initialization
  without returning any driver data. Do not present a driver count as verified.
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
- [ ] Latest public endpoint check at 17:04 EAT: DNS through `1.1.1.1` still resolves
  `mirelisgr.duckdns.org` to `105.161.112.67` (TTL 60), not the VM's EIP
  `13.53.183.149`. HTTPS requests to `/api/health` and `/sitemap.xml` timed out
  on port 443 (HTTP 000). Earlier checks found Caddy's TLS handshake for the
  hostname failed. Rotate the exposed DuckDNS token, update its A record, then
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
- [x] VM handoff and TLS evidence commit `7dd46a1` passed the full workflow in
  [run #39120951606](https://github.com/demitriosojwang/mireli-web/actions/runs/39120951606).
- [x] Payment preflight and driver handoff commit `83f59b0` passed all GitHub
  Actions checks in
  [run #39124074073](https://github.com/demitriosojwang/mireli-web/actions/runs/39124074073),
  including tests, typecheck, lint, production build, infrastructure checks,
  and AMD64/ARM64 container builds. PR #4 remains open; CI passing does not
  deploy the VM. GitHub still runs Vercel status and Preview Comments checks on
  the PR (both green on the latest observed run); AWS is the runtime target.
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
- [ ] The latest booking-flow changes are local and are not running on the VM.
  The GitHub CLI credential currently reports invalid, so these changes have
  not been pushed or checked by remote CI. The VM remains on image `794fb87`.
  The sitemap route also returns 404 on this image, despite being present in
  the current local build.
- [x] Earlier local verification on 18 October 2026, 18:04 EAT: all 216 tests
  across 41 files passed; TypeScript and ESLint passed; and the production build
  compiled successfully and generated all 55 static pages, including
  `/api/driver-supply` and `/sitemap.xml`. Build checks use placeholder local
  credentials with database migrations and empty-database bootstrap disabled.
  This verifies source only; the VM remains on its older image.
- [x] Stop search now prioritizes matching stop names, then searches route or
  area names only when no stop name matches. This prevents a query such as
  “Mtwapa” from returning the first 12 unrelated stops merely because “Mtwapa”
  appears in the route name. Area search remains capped at 12 results. Search
  failures log only a database error code and never the query or connection
  details. The fix is local and has not been deployed to the VM.
- [x] The customer empty state now describes the backend's actual signal
  (“no eligible drivers”) instead of claiming that no drivers have been
  approved. Trip-availability errors also log only a safe error code, not the
  raw provider/ORM exception. Local tests cover the log-redaction behavior;
  neither change is deployed to the VM.
- [x] Charter creation now prices from the exact selected vehicle capacity
  and checks M-Pesa availability before creating a booking or allocating the
  cab. This avoids deleting an already allocated charter after checkout fails
  and leaving a stale trip seat counter. Regression tests assert the fare
  quote/write/allocation order and the no-payment no-write path. This change is
  local and has not been deployed to the VM.
- [x] Travel-credit redemption now locks the passenger's active credit rows in
  FIFO order and reads/updates the balance inside one transaction. If a
  credit-only booking loses a race and no longer has enough credit, it clears
  the unpaid draft and recalculates the trip seat count; partial credit is
  retried only when M-Pesa is ready. Unit regressions cover lock-before-read,
  all-or-nothing coverage, and seat recount. A two-transaction PostgreSQL
  integration test remains a launch check because the unit mocks do not
  simulate real database lock contention.
- [ ] Define and enforce the payment-hold expiry for abandoned
  `awaiting_payment` bookings. Those bookings count against vehicle capacity,
  and no automatic age-based release was found in the operational or payment
  reconciliation paths. Keep a seat held while an M-Pesa result is ambiguous;
  release it only after a safe terminal outcome and an owner-approved hold
  duration.
- [x] The AWS VM release smoke check now validates that `/sitemap.xml` is
  parseable XML with at least one URL and that `/api/pay/options` returns either
  a real STK option or the documented `PAYMENT_OPTIONS_UNAVAILABLE` fail-closed
  response. It will reject missing/malformed endpoints and an unhandled 500,
  while allowing a safe deployment when live payment credentials are not yet
  configured. The workflow YAML parsed locally; CI has not run for this edit.
- [x] The booking page now checks payment readiness before opening the
  passenger-details sheet. It permits the sheet when STK is available or when
  existing travel credit covers the full total; the server still validates
  payment and allocation independently. Locked-trip cards explain that late
  cancellations convert the fare to credit instead of labeling the trip
  “credits only.”
- [x] Booking confirmation copy now describes credit-covered bookings and
  post-trip driver settlement without claiming that a customer's payment sits
  in Mireli's ledger.
- [x] A local, no-write browser preview verified the published-empty state:
  booking stays closed, no drop-off stops are shown, and pooled cab count stays
  at zero when no eligible drivers are available. A separately labeled local-only
  fixture verified the compact ride-choice step and KSh 450 display for a
  KSh 400 sample fare plus the KSh 50 fee. All API writes were blocked and none
  were attempted. This is a UI check only; it does not verify a real booking,
  payment, ticket email, driver assignment, or payout.
- [x] The rebuilt local page's title and About panel were browser-checked: no
  unapproved stop/fare list, fixed timetable, or live M-Pesa/ledger promise is
  presented. The preview used a dummy database URL and intentionally did not
  verify API availability or payment.
- [ ] A database-backed local preview remains blocked. Docker CLI 29.8.1 is
  installed, but Docker Desktop is absent/unregistered and the Linux engine
  pipe is unavailable. Starting Desktop fails because its registry entry is
  missing. Windows reports firmware virtualization and SLAT unavailable, and
  the WSL optional component needs Windows administrator action. No sample
  records were inserted. Repair Docker Desktop and enable the Windows/firmware
  prerequisites before attempting the local end-to-end journey.
- [ ] GitHub PR #4 still points to `48dfc11`; the local branch has the
  booking-flow change at `e91edf2` and follow-up documentation at `01f5bb3`, so
  the green PR checks do not cover the current local source yet. GitHub PR
  updates still start Vercel Preview checks. Vercel project access returned
  HTTP 403 and no Vercel CLI is installed, so the preview integration could
  not be disabled from this session; no push was made.
- [ ] Real passenger/driver authentication, M-Pesa callbacks and reconciliation,
  Brevo ticket delivery, and post-trip payouts are not configured on the VM.
- [ ] The fare catalogue is now transcribed and integrated in source, but the
  active stage rows, verified coordinates, door-to-door surcharge amounts,
  route order, and timetable are not loaded on the VM. The current VM image
  also cannot report eligible driver supply because `/api/driver-supply`
  returns 404. The driver count must be verified through a working endpoint.
  The passenger UI must keep its honest empty state; no customer booking can
  yet be matched successfully.

The Vercel URL remains a legacy, stale public page and is not a launch target.
AWS EC2 is the intended web/API host; the local Docker stack is for testing only.

## Completed in this change

- [x] Replace the oversized drop-off list with a searchable, grouped point picker.
- [x] Show loading, empty, and retryable error states for route/timetable data;
  do not leave a blank loading bar when the database has no stages.
- [x] While approved stops load, show only a compact progress state. When the
  stop count is zero, replace journey and ride controls with one booking-closed
  card and a refresh action. Show “0 pooled cabs” only when the shared
  driver-supply check confirms no eligible drivers, skip timetable requests
  until customer stops exist, and clear stale stop selections when a refresh
  confirms an empty catalogue.
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
- [x] Keep available cabs at zero when there are no active, eligible drivers.
- [x] Reuse the same driver-eligibility check in the booking bootstrap
  and trip-availability API, so the homepage can show zero cabs without running
  the scheduler or loading trip schedules. An unavailable driver check remains
  unknown and does not block stop discovery.
- [x] Return that empty supply state before running the scheduling tick, and
  limit availability reads to approved-driver and booking-display fields.
- [x] Count and search only active customer stops with a positive fare and a
  non-negative door surcharge; return only that count on initial load and search
  at most 12 matching points on demand instead of downloading every stage.
- [x] Filter cab availability to routes with at least one bookable stop in the
  database query without loading the full stop list for every departure. The
  customer cab quote uses the selected stop's approved fare and does not fetch
  a second route-wide minimum-fare list.
- [x] Gate VM releases on JSON contracts for `/api/routes`, `/api/trains`,
  `/api/stages?q=Mtwapa`, and `/api/driver-supply` in addition to `/api/health`.
  A missing endpoint or failed database-backed response now triggers rollback;
  an empty catalogue and `hasEligibleDrivers: false` remain valid responses.
- [x] Keep the stop picker request-free until the passenger enters at least two
  letters; opening it no longer sends a blank query or claims the catalogue is
  empty while only the search prompt is empty.
- [x] Present stage and door-to-door service as explicit, compact choices;
  show the door surcharge with its full driver pass-through before booking.
- [x] Remove the unapproved static stop/fare/timetable catalogue and unsupported
  live-payment assurances from customer About/SEO copy. Keep only the approved
  fare model and explain that live booking data is shown when service is open.
- [x] Add a protected, audited Admin → Routes directory for entering and
  reviewing approved routes/stops. New routes start unpublished; route stops
  require coordinates and validated fares/surcharges; publishing requires a
  complete ordered stop list. Published routes must be paused before editing.
  No sample/candidate catalogue is inserted by the app.
- [x] Prepare a review-only map-match draft at
  `docs/STAGE-MAP-MATCHES-DRAFT.md`. Candidate pins are explicitly not loaded
  into the production catalogue; owner review must confirm exact passenger
  waiting points, route order, and every door surcharge before activation.
- [x] Expire abandoned unpaid reservations after a configurable 15-minute
  default hold, retain their booking/audit record, restore any redeemed travel
  credit transactionally, and recount trip seats. The expiry skips every
  confirmed/ambiguous/pending M-Pesa attempt, ledger entry, or Paybill receipt.
  Payment initiation, Paybill callback, and payment confirmation now recheck or
  serialize against expiry to prevent a stale checkout from charging after its
  seat has been released.
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
- [x] Show the KSh 50 Mireli fee per booked shared seat in the fare preview and checkout total.
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
- [x] Clear the previous route's driver-supply result when the passenger
  changes or clears the selected stop. Show `0 cabs` only for a confirmed
  no-driver response; show `Unavailable` after a failed availability check.
- [x] Latest source verification on 19 October 2026: all 236 tests across 45
  files, TypeScript, and ESLint passed. Prisma schema validation and Prisma
  client generation passed in the 18 October run. The booking-focused suite
  passed all 52 tests across
  seven files. The two metadata-route tests also verify both local-demo
  indexing protection and the strict production sitemap/robots output. A
  current-source Linux production image also built successfully
  with Next.js 16.3.4, passed its production TypeScript phase, and generated all
  55 static pages. This is local-image evidence; hosted CI and the AWS VM still
  need their own verification.
- [x] Latest local Docker runtime verification on 18 October 2026: the
  single-container `mireli-app-1` service is healthy from image
  `mireli-web:latest`; its `db-data` and `app-state` volumes were preserved.
  `/api/health`, `/`, `/robots.txt`, and `/sitemap.xml` returned HTTP 200. The
  first current-source startup exposed a stray empty migration directory
  (`20261018_durable_refund_attempts`), which Prisma counted as a migration and
  rejected with P3015. Only that verified-empty directory was removed; the
  rebuild then applied migrations and reached healthy status.
- [x] Local production-style smoke evidence is honest about missing supply:
  `/api/routes` reports `pointCount: 0`, `/api/trains` is empty, a stop search
  returns no points, and `/api/driver-supply` reports no eligible drivers. The
  homepage displays “Bookings aren’t open yet” and “0 pooled cabs”. No route,
  timetable, driver, or booking was invented or seeded.
- [x] Local preview explicitly runs with both demo flags enabled and has no
  M-Pesa or Brevo credentials. It displays a local-preview banner, blocks all
  crawlers, and returns an empty sitemap by design. The strict production
  sitemap branch points to the public homepage, but public production metadata,
  email delivery, payment callbacks, and driver matching have not been verified
  against the AWS deployment.
- [ ] Live AWS readiness remains unverified: this workstation could not resolve
  `mirelisgr.duckdns.org`; the AWS CLI could not reach its sign-in token endpoint,
  and GitHub CLI reports its stored token invalid. No VM, AWS setting, DNS
  record, or GitHub state was changed in this verification.
- [x] Follow-up local and public-path checks on 19 October 2026: the single
  Compose service is still healthy; health, homepage, robots, sitemap, route,
  timetable, stop search, driver supply, and trip availability endpoints
  responded. The customer screen visibly says bookings are not open and shows
  `0 pooled cabs`. The database still has no published stops or train services,
  and the availability API reports no eligible drivers. Demo mode is labeled
  and blocks crawling. The fare-stop search still requires two characters and
  returns at most 12 results. No production catalogue or driver was added.
- [x] Admin route entry requires an explicit non-negative door surcharge;
  omission is rejected by the API instead of silently becoming zero. The
  route-admin regression test covers this case, and the full 236-test suite
  passes.
- [ ] Public VM is still not verified healthy: DuckDNS does not resolve from
  this workstation. Port 80 at `13.53.183.149` returns the expected redirect
  to HTTPS, but a certificate-validating TLS request to that IP with the
  `mirelisgr.duckdns.org` hostname fails during handshake (`EPROTO`). Port 22
  is unreachable, and AWS CLI reports the `mireli` session expired. No DNS,
  VM, or AWS configuration was changed.

## Must complete before opening bookings

### Approved route catalogue

- [ ] Publish the approved routes and stage names, in order, with coordinates,
  per-stage fare, and door-to-door surcharge. Charter fares are calculated from
  the assigned vehicle capacity and per-stage fare.
- [x] Add a protected admin route/stage directory or a reviewed data-entry
  workflow. Use Admin → Routes to enter the owner-approved values.
- [ ] Check each route for at least one non-terminus stage, valid fares, and
  coordinates before making it active.
- [x] Apply the KSh 50 Mireli fee once per shared passenger seat; retain the
  charter fee line inside Mireli's 10% share.

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

## Owner-approved Mombasa passenger fare sheet

The supplied `DOC20261012_10575504_0232.pdf` is a handwritten, one-page scan
that lists passenger fares for 4- and 7-seater cabs. Its metadata gives a
creation date of 12 October 2026, but it has no effective date, author/sign-off,
coordinates, route order, or door-to-door surcharge schedule. The owner
approved its listed stage names and fares for integration; those missing
operational details still block publishing routes.

North Coast entries 1-16 are KSh 400 per passenger seat: Kiembeni Mwisho,
Kiembeni Police, Ananda Magaya, San Sera, Green Estate, Kona Kiembeni,
Bamburi Mwisho, Bamburi Naivas, Total Bamburi, Fisheries, Mwenbeni, GCC
Junction, Nyali Centre, VOK, Bambolulu, and Lights. The remaining North Coast
entries are Mtwapa KSh 400, Malindi KSh 700, Changamwe KSh 200, Mikindani KSh
250, Miritini KSh 250, and Town (CBD)/Mwembe Tayari KSh 300 per seat. South
Coast entries are Likoni Ferry Container KSh 400, Kona Mpya (Fayaz) KSh 400,
Shika Adabu (Checkpoint) KSh 400, and Diani Naivas KSh 500 per seat.

The owner clarified that shared fares for 10/11-seat cabs are exactly KSh 50
lower per passenger seat. Mireli retains KSh 50 for each booked shared seat;
the driver receives the rest, including the full door-to-door surcharge. For
private charters, keep the agreed rule: vehicle capacity × (listed stage fare +
KSh 100 per seat). Mireli retains 10% of that charter total, with one KSh 50
fee line inside the 10% share; the driver receives the rest plus the full
surcharge.

These rules are implemented in `src/lib/pricing.ts`,
`src/lib/fare-catalogue.ts`, the customer quote, booking API, and settlement
path. The point picker is a bounded, searchable dropdown and does not load the
whole network up front. The VM database is still empty, so stage options will
not appear until an admin loads the stages with verified coordinates and
surcharge values. Do not run the legacy destructive demo seed against the
production database.

Candidate map matches and confidence notes are in
`docs/STAGE-MAP-MATCHES-DRAFT.md`. They are only a review aid; exact stop pins,
route order, spelling, and door surcharges are still unapproved and must not be
published to customers yet.

Before activating routes, verify the Mombasa Terminus origin and route order,
coordinates, door-to-door surcharge for each stop, handwritten spellings, and
the current timetable. The fare list does not establish driver availability
or a successful booking path.

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
