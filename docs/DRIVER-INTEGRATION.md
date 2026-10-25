# Connect Mireli Driver to this backend

The driver API runs on the same AWS VM as Mireli Web; Android uses the API over
HTTPS and never connects to PostgreSQL directly. The internal VM health check
passed on 16 October 2026, but the public DuckDNS record still points to the old
IP and public TLS has not been verified. The API is strict mode but driver
sign-in and registration remain closed until real credentials, staff review,
and approved supply are ready. Follow
[DRIVER-SHARED-BACKEND-SETUP.md](DRIVER-SHARED-BACKEND-SETUP.md) for the current
VM access, build-flavor, and release rules.

## Confirmed fares and driver earnings

- Shared ride: listed stage fare × booked seats, plus KSh 50 for each booked
  seat. The fee is retained by Mireli and deducted from the driver's settlement.
  There is no percentage commission on shared rides; vehicle capacity does not
  change the approved stage fare.
- Private charter: assigned vehicle capacity × (selected stage fare + KSh 100
  per vehicle seat). The KSh 50 fee is included inside Mireli's 10% share; it
  is not added again. For a 4-seat vehicle and KSh 400 stage fare, the total is
  KSh 2,000, Mireli's total share is KSh 200, and the driver receives KSh 1,800.
- Door-to-door surcharge passes to the driver in full for both service types.
- Driver payout is created and dispatched only after trip completion. The API's
  server-calculated earnings and payout fields are authoritative; Android must
  not recalculate fares, commission, or net payout locally.
- Earnings lines expose `grossMinor`, `platformFeeMinor`, `commissionMinor`,
  `surchargeMinor`, and `netMinor`. The payout reconciles as gross minus the
  separately recorded fee and commission; the full home surcharge is already
  part of gross and remains in net.

## Implemented contract — 6 October 2026

- `/api/v1/driver/status` returns separate `phoneSignInOpen` and
  `registrationOpen` flags. Existing drivers can authenticate while new
  applications are paused; an unknown verified number cannot create a driver
  account unless intake is open. The status request itself never sends an SMS.
- POST `auth/challenges`, POST `auth/sessions`, DELETE
  `auth/session`: environment assertion, verified phone, hashed revocable sessions.
- GET/PUT `onboarding`, POST `documents/{type}`, POST `onboarding/submissions`:
  private evidence, expiry/checklist, optimistic versions and audited staff review.
- GET `trips`, POST `trips/{id}/commands`: accept/decline/arrive/board/no_show/start/
  complete, driver ownership, versioned receipts and atomic settlement creation.
  Manifests omit boarding codes and identity numbers; historical trips omit PII.
- GET `earnings`, POST `payout-destination`: KES minor units, settlement status,
  explicit beneficiary attestation and finance approval before transfers.
- GET/POST `support`: driver-owned cases, replay protection and staff replies.
- Administrative onboarding, private-document scanning, beneficiary and support
  routes have reviewer authorization, origin checks and audit records.
- Native staging passed a complete synthetic charter and account/support test.
  PostgreSQL simultaneous retries create one command effect/settlement/transfer.

Migration `20261006_driver_services` is additive against the cofounder source
baseline. Do not apply it blindly to the claimed deployed database: reconcile its
schema/history and prove backup restoration first. Production SMS/S3/scanner and
verified administrator login are not configured. No real payment was sent.

The mapping and earlier API proposal below are historical design notes. The active
contract uses `/api/v1/driver`, not the older `/api/mobile/v1` paths.

| Android concept | Cofounder source | Required interpretation |
| --- | --- | --- |
| Driver identity | `Driver.id`, status | Bind verified identity to a server-owned driver ID; reject inactive/suspended drivers |
| Assignment | `Trip.id`, `Trip.driverId` | Authorize every read/write against the assigned driver |
| Direction | `Trip.direction` | Preserve FROM_TERMINUS / TO_TERMINUS |
| Train connection | `Trip.trainId`, Train | Use server timestamps, display Africa/Nairobi |
| Route / meeting point | Route, RouteStage, booking stage snapshot | Support shared/charter, pickup/drop-off and home surcharge separately |
| Passenger party | Booking, seats, passengerName | Only paid/eligible bookings; exclude identity numbers, nationality and unrelated personal data |
| Boarding | Booking.status, checkedInAt | Verify a limited-use boarding credential; do not expose secret codes in manifests |
| Earnings | LedgerEntry, PayoutRecord | Distinguish held gross fares, driver payable, deductions and settled payout |
| Currency | Integer KSh in upstream | Android sample uses minor units: convert KSh to cents explicitly with checked integer arithmetic |

Upstream trip states are scheduled/locked/departed/completed/cancelled. Android's
preview states assigned/accepted/at_pickup/in_progress/completed are not identical.
Add an explicit driver execution state/version through a reviewed migration;
do not interpret a booking lock as driver acceptance or scheduled time as arrival.

## Proposed versioned API

- `POST /api/mobile/v1/auth/challenges` and `/auth/verify`: real verified driver
  sign-in, short-lived access tokens, rotated refresh tokens and server revocation.
- `GET /api/mobile/v1/assignments`: paginated, server-filtered driver assignments,
  server time, version and bounded next-sync cursor.
- `GET /api/mobile/v1/assignments/{id}`: minimal authorized manifest and meeting points.
- `POST /api/mobile/v1/assignments/{id}/commands`: accept, arrive, board, no-show,
  start and complete with command ID and expected version. Persist idempotency and
  state changes in one transaction. Reject stale/reassigned/cancelled trips.
- `GET /api/mobile/v1/earnings`: audited ledger projection and payout status.
- Location/device registration only after consent, permissions, retention and
  assignment ownership are implemented. Push messages signal a refresh, not authority.

No endpoint above exists merely because it is listed here. Contract tests must
prove unauthenticated, passenger, wrong-driver, suspended-driver, stale-version,
duplicate-command and lost-network cases before Android's production adapter is enabled.

The existing passenger or administrator cookie must not be embedded in Android.
Do not create a second payment ledger or copy production credentials into the APK.
