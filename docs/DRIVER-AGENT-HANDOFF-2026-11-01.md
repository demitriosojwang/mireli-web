# Mireli Driver Android agent handoff — 1 November 2026

This is the consolidated, current-state handoff for the agent/developer building
**Mireli Driver** (the Android app for the shared backend). The standing docs
remain authoritative for details: [DRIVER-INTEGRATION.md](DRIVER-INTEGRATION.md)
(API contract), [DRIVER-SHARED-BACKEND-SETUP.md](DRIVER-SHARED-BACKEND-SETUP.md)
(VM access, flavors, secrets), and [DRIVER-AGENT-VM-HANDOFF.md](DRIVER-AGENT-VM-HANDOFF.md)
(verified VM state history). This document supersedes stale claims in those
docs as of the date above.

## What is running now (verified 1 November 2026)

- Shared backend: one Next.js app + embedded PostgreSQL 16 on EC2
  `i-097df027e02b0708f` (`t4g.small`, ARM64) at Elastic IP `13.53.183.149`,
  Region `eu-north-1`, project `036834403673`. Free-plan credits remain
  (~$96 as of 1 November 2026); do not add paid infrastructure.
- SSM **verified Online** (agent `3.3.5390.0`) — shell access is restored;
  port 22 stays closed (no key pair, no SSH rules).
- Web repo: `github.com/demitriosojwang/mireli-web`, branch `main` is current
  (merged PR #4, the unpaid-hold/paid-assignment fix `2aae89a`, and the
  Vercel/domain commit `a5221bd`); Vercel hosting is retired — AWS is the only
  runtime.
- Public origin is changing to **`https://mireli.online`** (Cloudflare-managed
  DNS; see [DOMAIN-CUTOVER.md](DOMAIN-CUTOVER.md)). The DuckDNS hostname is
  retired. Until the Cloudflare A record is set to `13.53.183.149` and NS
  delegation is live, **no public HTTPS origin exists** — do not hard-code any
  public URL in a pilot/production build before the cutover checks pass.
- Driver API status (internal, still on the old image at the time of writing):
  `/api/v1/driver/status` returns strict mode (`simulation: false`) with
  phone/email sign-in, registration, and navigation closed. This is
  **fail-closed by design** until the owner configures `AT_USERNAME`,
  `AT_API_KEY`, `BREVO_API_KEY`/`BREVO_SENDER_EMAIL`, and vetted drivers exist.

## Exact setup instructions

1. **Repository.** Clone the Mireli Driver Android repo (separate repo — do not
   put driver code in `mireli-web`). Android Studio with JDK 17; Gradle
   wrapper configs already define `BuildConfig.DRIVER_SERVICE_URL` and
   `DRIVER_SERVICE_TEST` — keep using them; never hard-code URLs elsewhere.
2. **Backend flavors.**
   - `staging`: local Docker backend from the Mireli driver repo's documented
     procedure and `http://10.0.2.2:3000` on the emulator; the backend must be
     in demo mode; keep `DRIVER_SERVICE_TEST=true` and synthetic data only.
   - `pilot`/`production`: `https://mireli.online` **only after** the cutover
     checks below pass; `DRIVER_SERVICE_TEST=false`. Never point these flavors
     at an emulator, laptop, Vercel, DuckDNS, or any unverified origin.
3. **Verify the backend before connecting.**
   ```sh
   curl -fsS https://mireli.online/api/health          # {"status":"ok"}
   curl -fsS https://mireli.online/api/v1/driver/status
   # expect simulation:false — flags may be false; that is fail-closed, not a bug
   ```
4. **AWS/VM access (debugging only).** Use your own AWS identity (invite as a
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
5. **Money model Android must obey (server-authoritative).**
   - Shared ride: listed stage fare × seats + KSh 50 per booked seat (Mireli's
     fee). The full listed fare goes to the driver.
   - Charter: capacity × (stage fare + KSh 100/seat). Mireli keeps 10%
     (including the KSh 50 line); the driver gets the rest.
   - Off-stage surcharge (once enabled): KSh 50/km to the nearest stage, paid
     to the driver in full. Android must consume server-calculated values from
     `/api/v1/driver/earnings` and must not recompute fares/commission/net.
   - Unpaid checkouts sit in `Booking.reservationTripId` and never appear in
     driver manifests; only the paid transaction promotes to `Booking.tripId`.
6. **Releases.** Android builds are signed with the owner's release key and
   shipped by the driver repo's process; the VM hosts only the API. Web-side
   schema/API changes are additive-only and coordinated with `mireli-web` PRs.

## Cutover checks before any pilot/production build

- [ ] NS delegation live: `mireli.online` answers `kara/michael.ns.cloudflare.com`.
- [ ] Cloudflare DNS set: `A @ → 13.53.183.149`, `CNAME www → mireli.online`
      (DNS-only during verification).
- [ ] Public `https://mireli.online/api/health` and `/api/v1/driver/status`
      pass from outside AWS (mobile network preferred).
- [ ] VM runs the released current image (see PRODUCTION-READINESS status) and
      strict mode is reported.
- [ ] Driver onboarding opened only after SMS/email credentials are configured
      and staff review is proven; never seed a fake driver into production.
