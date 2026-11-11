# Mireli Driver — production handoff for the web-side agent

**Date:** 8 November 2026 · **From:** Mireli Driver (Android) · **To:** Mireli Web owner + agent
**Android state:** commit `72a87c5` on `main`, version 0.9.0 (versionCode 12), all four variants green.

The Android app is production-ready against the published API contract. Everything
that remains before the first driver can work is **server configuration and one new
backend feature (live tracking)**. This document is the complete list.

---

## Part 1 — Make the existing API usable (blocking, no code changes)

Verified live on 8 November against `https://mireli.online`:

| Endpoint | Current state | What must change |
| --- | --- | --- |
| `/api/health` | `{"status":"ok"}` | none |
| `/api/v1/driver/status` | all flags `false` | flags open after steps below |
| `/api/driver-supply` | `hasEligibleDrivers:false` | approve first driver |
| `/api/stages`, `/api/routes` | empty | publish the approved route |
| `/api/pay/options` | HTTP 503 | configure Daraja |

Do these in order:

1. **Email delivery (Brevo).** Set `BREVO_API_KEY` and `BREVO_SENDER_EMAIL` in the
   VM secret store (`/etc/mireli/runtime.env`, never in the repo). Send one
   verification code to an inbox the owner controls and confirm delivery and the
   sender's SPF/DKIM. This alone flips `emailSignInOpen` for existing drivers.
2. **SMS (Africa's Talking).** Set `AT_USERNAME` and `AT_API_KEY`. Needed for
   `phoneSignInOpen` and driver contact verification.
3. **Staff review.** Deploy the reviewer-authentication work that exists uncommitted
   in the local web checkout, then approve one real driver and vehicle. Until then
   `hasEligibleDrivers` stays false and no assignment can exist.
4. **Publish the route.** Owner-approved stages: **Likoni Ferry Container, Kona
   Mpya (Fayaz), Shika Adabu (Checkpoint)** with verified coordinates and order.
   The Android navigation tests already use these names.
5. **Terms and privacy URLs.** Publish driver terms and the privacy notice and put
   their URLs in the onboarding payload. Android blocks upload and submission until
   both links exist — that is deliberate.
6. **Account deletion.** The in-app support flow already accepts deletion requests.
   Publish the external deletion resource and assign staff, per
   [Play policy](https://support.google.com/googleplay/android-developer/answer/13327111?hl=en).

After 1–5, `/api/v1/driver/status` should report `emailSignInOpen:true`,
`registrationOpen:true`, `navigationOpen:true` and the app becomes usable end to end.

## Part 2 — Daraja (last gate before paid trips)

Configure in the shared backend secret store, never in the repo:

- `DARAJA_CONSUMER_KEY`, `DARAJA_CONSUMER_SECRET`
- Collection shortcode + Lipa na M-Pesa Online passkey
- HTTPS callback base URL (must be `https://mireli.online/...`; the edge already
  terminates TLS with Full (strict))

Then reconcile **one controlled booking** through collection → refund → driver
payout before opening paid trips. Confirm the callback correlation and that only
the paid transaction promotes `Booking.tripId`. B2C payout setup needs an approved
beneficiary. Reference: [Safaricom Daraja](https://developer.safaricom.co.ke/apis).

## Part 3 — Bolt/Uber-style live tracking (new backend feature)

What the user asked for: a car on the passenger's map showing the driver's live
position and distance, like Bolt. **This does not exist yet on either side.**
The Android app today is foreground-only: it requests location only while the
navigation screen is open, does not request `ACCESS_BACKGROUND_LOCATION`, and
sends position only to the authenticated route endpoint. There is no driver
position ingestion endpoint and no passenger-side map. Building the Bolt
experience needs four pieces:

1. **Driver position ingestion (web).** New authenticated endpoint, e.g.
   `POST /api/v1/driver/position`, accepting `{tripId, lat, lng, accuracy,
   bearing, speed, recordedAt}` with optimistic-concurrency or idempotency key.
   Server validates the driver owns the trip and the phase is
   `accepted`/`at_pickup`/`in_progress`. Store the latest fix per trip (not a
   history) plus a short rolling buffer for the trail.
2. **Realtime fan-out (web).** Server-Sent Events or WebSocket channel keyed by
   trip id, e.g. `GET /api/v1/trips/{id}/position/stream` for the passenger PWA.
   Push the latest fix every 3–5 s; include `etaSeconds` computed server-side so
   clients never compute distance/ETA themselves. Keep the channel authenticated
   and rate-limited like the existing route endpoint.
3. **Driver app broadcasting (Android — I will build this).** A foreground
   service with the `foregroundServiceType="location"` that streams fixes during
   `accepted → in_progress` only, throttled to one fix per 3–5 s and only while a
   trip is active. This requires `ACCESS_BACKGROUND_LOCATION` on the driver app,
   which triggers Play's
   [background location policy](https://support.google.com/googleplay/android-developer/answer/9799150?hl=en):
   prominent in-app disclosure before the permission dialog, a privacy-policy
   statement, a Play Console declaration with a demo video. Budget review time
   for that.
4. **Passenger map (web PWA).** MapLibre GL in the passenger booking view,
   same tiles the driver app already uses (OpenFreeMap Liberty), driver marker
   + remaining route polyline + ETA chip, fed by the SSE channel.

**Data-protection prerequisites before enabling tracking** (Kenya DPA — the
repo's legal review flags these): DPIA covering precise-location processing,
purpose-specific retention (keep latest fix + trail for the trip, delete after
settlement), and registration status confirmed with the ODPC. Do not launch
tracking before those are done; the Android side will keep consent and
disclosure text aligned with whatever the web side publishes.

**Sequencing:** ship Part 1 and Part 2 first. Tracking is a separate release —
the driver app can go live for the first pilot without it, then add
broadcasting once the ingestion endpoint and passenger map exist. I need the
endpoint contract from the web side (paths, field names, auth) before building
the Android service, so send it as soon as it is drafted.

## Part 4 — Android-side actions for the owner (not the web agent)

1. Sign `Mireli-Driver-0.9.0-production-unsigned.aab` with the owner upload key
   (`deliverables/` has the AAB and `SHA256SUMS-0.9.0.txt`).
2. Install the pilot APK on the first driver's phone and run the rehearsal in
   `docs/FIRST-DRIVER-PILOT.md`: email verification, document submission, staff
   approval, assigned trip, boarding by code, completion, settlement.
3. Complete Play Console declarations (Data Safety, location disclosure,
   account deletion) against the final behavior.

## Verification checklist for the web agent

When you believe you are done, these must all pass from outside AWS:

```
curl -fsS https://mireli.online/api/health                 -> {"status":"ok"}
curl -fsS https://mireli.online/api/v1/driver/status      -> emailSignInOpen:true, registrationOpen:true, navigationOpen:true
curl -fsS https://mireli.online/api/driver-supply         -> hasEligibleDrivers:true
curl -fsS https://mireli.online/api/stages                -> non-empty points including Ferry/Fayaz/Shika Adabu
curl -fsS https://mireli.online/api/pay/options           -> 200, not 503
```

Then tell me and I will re-run the full Android rehearsal against production,
including the tracking integration once its contract exists.

---

## Part 5 — How to report back to the Mireli Driver agent (required)

The owner will paste your report into the Mireli Driver agent chat. Write it as a
single markdown file named **`WEB-AGENT-REPORT-<YYYY-MM-DD>.md`** so it can be
copied in one message. Do not assume the Android agent can reach your repo, VM,
AWS account, or any URL behind authentication: everything it needs must be in the
report body itself.

### Required sections, in this order

1. **Header.** Date, your repo commit SHA (`git rev-parse HEAD` on the branch you
   deployed), and the deployed web release tag (the string like `75cd809-nov06pwa`
   shown by the readiness gate).
2. **Checklist results.** Run every command in the verification checklist above
   from outside AWS and paste the **raw responses verbatim**, one per line, with
   the HTTP status. Do not summarize them; the Android agent parses the JSON.
3. **Secrets configured.** For each of `BREVO_API_KEY`, `BREVO_SENDER_EMAIL`,
   `AT_USERNAME`, `AT_API_KEY`, and the Daraja set, state only
   `configured: yes/no` and the date. **Never paste a secret value, key, or
   passkey into the report.**
4. **Onboarding payload change.** If `termsUrl` / `privacyUrl` were added or the
   `maxDocumentBytes` limit changed, paste the exact new JSON of the
   `/api/v1/driver/onboarding` GET response (with any tokens redacted) so the
   Android side can verify its gating logic against the real payload.
5. **Stage data.** Paste the exact `/api/stages` response body. The Android
   navigation tests bind to stage names and ids; if any id differs from what was
   agreed (Ferry, Fayaz, Shika Adabu), say so explicitly.
6. **Tracking contract (only if Part 3 was built).** Paste the exact request and
   response schemas for `POST /api/v1/driver/position` and the passenger stream
   endpoint: paths, HTTP methods, auth header, every field name and type, error
   codes with their `code` strings, and rate limits. The Android foreground
   service is built directly from this section; ambiguity here becomes a bug.
7. **Known deviations.** Anything you did differently from this handoff, anything
   still open, and anything you could not verify. An honest "not done" is usable;
   a silent gap is not.
8. **Evidence.** Screenshots or logs are welcome as file paths on the shared
   machine or pasted text; do not link to dashboards that require sign-in.

### Rules

- Report **only facts you verified by running the command or reading the
  response** in this session. If you inherited a claim from a previous session,
  re-run it before reporting it.
- No secrets, no session tokens, no personal data of the first driver, no
  document images. The report may be stored and re-read later.
- If a checklist item fails, report the failure with the exact error text rather
  than marking it done.

### What happens next

The Android agent will, on receiving your report: re-verify every checklist
endpoint independently, run the full emulator rehearsal against production
(sign-in, onboarding, document upload, trip assignment, boarding, completion,
settlement), and report back to the owner with a pass/fail per step. If your
report and the agent's independent checks disagree, the agent's live re-check
wins and the discrepancy will be named explicitly. For the tracking feature, the
Android side will build against section 6 and reply with its integration test
results against your staging deployment before you promote it to production.
