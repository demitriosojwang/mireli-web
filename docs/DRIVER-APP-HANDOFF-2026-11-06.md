# Mireli Driver Android agent handoff — 6 November 2026

This is the consolidated, current-state handoff for the agent/developer building
**Mireli Driver** (the Android app for the shared backend). The standing docs
remain authoritative for details: [DRIVER-INTEGRATION.md](DRIVER-INTEGRATION.md)
(API contract), [DRIVER-SHARED-BACKEND-SETUP.md](DRIVER-SHARED-BACKEND-SETUP.md)
(VM access, flavors, secrets), and [DRIVER-AGENT-VM-HANDOFF.md](DRIVER-AGENT-VM-HANDOFF.md)
(verified VM state history). This document **supersedes**
[DRIVER-AGENT-HANDOFF-2026-11-01.md](DRIVER-AGENT-HANDOFF-2026-11-01.md); the
domain cutover it was waiting on is now complete.

## What is running now (verified 6 November 2026)

- Shared backend: one Next.js app + embedded PostgreSQL 16 on EC2
  `i-097df027e02b0708f` (`t4g.small`, ARM64) at Elastic IP `13.53.183.149`,
  Region `eu-north-1`, project `036834403673`.
- **Production origin is live: `https://mireli.online`.**
  `A @ → 13.53.183.149` and `CNAME www → mireli.online` are published in the
  Cloudflare zone (zone active since 4 November). `www` 301-redirects to the
  apex. The DuckDNS hostname is retired — do not use or reference it anywhere.
- HTTPS is live and validated end to end: Caddy on the VM holds Let's Encrypt
  certificates for `mireli.online` and `www.mireli.online` (issued 6 November);
  Cloudflare edge proxying is **on** for both records with SSL mode
  **Full (strict)** and **Always Use HTTPS** on. Origin cert answering real
  traffic is expected; edge checks should show `Server: cloudflare`.
- Driver API status, verified live through the public edge today:

  ```json
  {"apiVersion":"v1","simulation":false,"phoneSignInOpen":false,
   "emailSignInOpen":false,"registrationOpen":false,"navigationOpen":false,
   "supportEmail":"mirelisgr001@gmail.com",
   "message":"Driver email sign-in is not configured yet."}
  ```

  This is **fail-closed by design**, not a bug: flag opens happen only after the
  owner configures `AT_USERNAME`, `AT_API_KEY`, `BREVO_API_KEY`/
  `BREVO_SENDER_EMAIL`, and vetted drivers exist. Do not build against the
  emulator flag set or assume any open default.
- Web release on VM: `75cd809-nov06pwa` (deployed 6 November from a `git archive`
  of `main`, built natively on the VM, pushed to ECR, and swapped in through the
  readiness gate with automatic rollback). The gate's 7 checks — health, routes,
  trains, stages, driver-supply, sitemap, pay/options fail-closed — all pass, and
  the web PWA additions (install manifest/icons/service worker, GSC-ready
  sitemap) are verified live at `https://mireli.online`. Passenger bookings
  remain **closed** until the end-to-end launch gates in
  [PRODUCTION-READINESS.md](PRODUCTION-READINESS.md) pass.

## Exact setup instructions (unchanged from 1 November, validated by the cut-over)

1. **Repository.** Clone Mireli Driver (separate Android repo — never put
   driver code in `mireli-web`). Android Studio with JDK 17; Gradle wrapper
   configs define `BuildConfig.DRIVER_SERVICE_URL` and `DRIVER_SERVICE_TEST`;
   keep using them and never hard-code URLs elsewhere.
2. **Backend flavors.**
   - `staging`: local Docker backend from the driver repo's documented
     procedure, `http://10.0.2.2:3000` on the emulator, backend in demo mode,
     `DRIVER_SERVICE_TEST=true`, synthetic data only.
   - `pilot`/`production`: `https://mireli.online` — the origin now exists and
     is verified. `DRIVER_SERVICE_TEST=false`. Never point these flavors at an
     emulator, laptop, Vercel, DuckDNS, or any other origin.
3. **Verify the backend before connecting.**
   ```sh
   curl -fsS https://mireli.online/api/health          # {"status":"ok"}
   curl -fsS https://mireli.online/api/v1/driver/status
   # expect simulation:false — flags may be false; that is fail-closed, not a bug
   ```
4. **HTTP client notes.** The edge enforces HTTPS redirect (308 from `http://`),
   so build clients with an HTTPS base URL and normal certificate validation.
   Do not disable TLS verification to "handle the redirect".
5. **AWS/VM access (debugging only).** Use your own AWS identity (invite as a
   team member), the Session Manager plugin, and:
   ```powershell
   aws ssm start-session --target i-097df027e02b0708f --region eu-north-1 --profile <your-profile>
   ```
   Read-only checks expected inside:
   `sudo systemctl is-active docker caddy mireli-app`,
   `sudo docker ps --filter name=mireli`,
   `curl -fsS http://127.0.0.1:3000/api/health` and `.../api/v1/driver/status`.
   Never print `/etc/mireli/runtime.env` or `bootstrap.env`, secrets, or full
   `docker inspect`; keep SSH closed; do not edit container files as source.
6. **Money model Android must obey (server-authoritative).**
   - Shared ride: listed stage fare × seats + KSh 50 per booked seat (Mireli's
     fee). The full listed fare goes to the driver.
   - Charter: capacity × (stage fare + KSh 100/seat). Mireli keeps 10%
     (including the KSh 50 line); the driver gets the rest.
   - Off-stage surcharge (once enabled): KSh 50/km to the nearest stage, paid
     to the driver in full. Android must consume server-calculated values from
     `/api/v1/driver/earnings` and must not recompute fares/commission/net.
   - Unpaid checkouts sit in `Booking.reservationTripId` and never appear in
     driver manifests; only the paid transaction promotes to `Booking.tripId`.
7. **Releases.** Android builds are signed with the owner's release key and
   shipped by the driver repo's process; the VM hosts only the API. Web-side
   schema/API changes are additive-only and coordinated with `mireli-web` PRs.

## Cutover checks — all pass as of 6 November 2026

- [x] NS delegation live: `mireli.online` answers `kara`/`michael.ns.cloudflare.com`.
- [x] Cloudflare DNS set: `A @ → 13.53.183.149`, `CNAME www → mireli.online`
      (now proxied through the Cloudflare edge).
- [x] Public `https://mireli.online/api/health` returns `{"status":"ok"}` and
      `/api/v1/driver/status` reports strict mode, verified from outside AWS.
- [x] VM runs a released current image with the corrected readiness gate.
- [ ] Driver onboarding still pending: requires SMS/email credentials and
      staff review proof. Keep building against the fail-closed contract.
