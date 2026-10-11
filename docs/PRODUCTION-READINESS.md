# Mireli booking launch checklist

**Status: not ready to accept customer bookings.** The last recorded production
check on 8 October 2026 returned empty route and train catalogues and no approved
driver accounts. Recheck those records before launch if they have since changed.
The passenger UI should continue to show an honest empty state until the shared
driver platform and approved route data are live.

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
- [x] Keep available cabs at zero when there are no active, approved drivers.
- [x] Return that empty supply state before running the scheduling tick, and
  limit availability reads to approved-driver and booking-display fields.
- [x] Keep route stages in one route-catalogue response instead of repeating
  the full stop list in every cab's availability response.
- [x] Allocate eligible drivers across every active route, matching the
  current operating policy.
- [x] Show the flat booking fee in the fare preview and booking total.
- [x] Apply the 10% commission only to a private charter's fare. Pass the full
  door-to-door surcharge to the driver and retain the KSh 50 booking fee for
  each booking.
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
  per-stage fare, charter fare, and door-to-door surcharge.
- [ ] Add a protected admin route/stage directory or a reviewed data-entry
  workflow. There is no customer-facing source for this catalogue today.
- [ ] Check each route for at least one non-terminus stage, valid fares, and
  coordinates before making it active.
- [ ] Confirm the current flat booking fee is KSh 50 and that displayed totals
  match the amount sent to M-Pesa.

### Madaraka Express timetable

- [ ] Confirm that the attached schedule is still current; the PDF has no
  effective date. Enter the confirmed trains in the production timetable.
- [ ] Store overnight arrival day offsets correctly, especially the 03:55
  Nairobi arrival for the night train.
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

- [ ] Configure and verify production Daraja collection callbacks and
  reconciliation. A successful STK prompt alone must not confirm a booking.
- [ ] Run sandbox end-to-end cases for payment success, failure, duplicate and
  missing callbacks, refund/credit, and passenger cancellation cutoffs.
- [ ] Verify completed-trip settlement with real examples: shared ride has no
  percentage commission; private charter commission is 10% of charter fare;
  the full home surcharge goes to the driver; the booking fee is retained by
  Mireli; payout dispatch begins only after trip completion.
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
- [ ] Run the GitHub CI workflow and Vercel Preview build from the committed
  branch. Apply migrations only through the approved deployment setting.
- [ ] Complete a full customer-to-driver journey in staging: choose route,
  point, date/train and cab; pay; receive confirmation; board with PIN; complete
  trip; confirm driver payout and ledger entries.
- [ ] Recheck production route/trains/driver counts, health/logging, and payment
  mode after deployment. Do not announce bookings until one real staging
  journey succeeds end to end.

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
