# Mireli Driver shared-backend setup

Updated 16 October 2026. Give this guide to the Android developer or coding
agent before connecting Mireli Driver to the web application's backend.

## Start here

Mireli Web and Mireli Driver share one API and PostgreSQL database hosted by the
Mireli AWS VM. Android is a client of that API; it does not connect directly to
PostgreSQL and must not create a second driver, booking, payment, or payout
store. The authoritative endpoint contract is
[DRIVER-INTEGRATION.md](DRIVER-INTEGRATION.md).
For AWS team access and the current safe VM status snapshot, read the focused
[driver agent VM handoff](DRIVER-AGENT-VM-HANDOFF.md).

The AWS pilot VM is:

- Region: `eu-north-1`
- EC2 instance: `i-097df027e02b0708f` (`t4g.small`, ARM64)
- Elastic IP: `13.53.183.149`
- ECR image repository: `036834403673.dkr.ecr.eu-north-1.amazonaws.com/mireli-sgr-pilot-appimagerepository-juxctzu7badb`
- Intended public service URL: `https://mirelisgr.duckdns.org`
- App health path: `/api/health`
- Driver API status path: `/api/v1/driver/status`

The VM currently runs the app and driver API in one healthy container. A verified
SSM check on 16 October 2026 returned `{"status":"ok"}` from the local health
path. The public hostname is not live yet: it still resolves to the old address
`105.161.112.67`, while the VM's EIP is `13.53.183.149`. The DuckDNS token was
exposed in a screenshot and must be rotated before the owner updates that A
record. Until public DNS and HTTPS are verified, production Android builds must
not depend on this hostname.

## Current driver API state

The VM is strict mode (`simulation: false`), but the current status endpoint
reports phone sign-in, email sign-in, new registration, and navigation closed.
Real OTP credentials have not been configured, no driver is approved, and the
production stage/trains catalogue is empty. Do not create a fake driver or make
the Android UI show a trip as available until the real shared API returns it.

Once the hostname is fixed, verify before enabling a production app build:

```sh
curl -fsS https://mirelisgr.duckdns.org/api/health
curl -fsS https://mirelisgr.duckdns.org/api/v1/driver/status
```

Expected production mode: `simulation` is `false`. Sign-in flags may be false
until the owner configures provider credentials; a false flag is a deliberate
fail-closed state, not an Android networking bug.

## Build flavors and service URL

Set the API origin using the driver's existing Gradle configuration
`BuildConfig.DRIVER_SERVICE_URL`; do not hard-code AWS credentials or any
provider keys in the app.

- `staging` on the Android emulator may use `http://10.0.2.2:3000` to reach the
  developer's local Docker backend. The backend must explicitly be in demo mode
  for the staging build, and the emulator should contain only synthetic data.
- `demo` remains offline and must not be used to prove shared-backend behavior.
- `pilot` and `production` use the public HTTPS URL only after DNS, Caddy TLS,
  external health checks, and strict-mode status are confirmed. Their
  `DRIVER_SERVICE_TEST` setting must be `false`.

Never point a production/pilot build at `10.0.2.2`, the developer's laptop, the
Vercel hostname, or an unverified endpoint. Never turn on demo mode in the AWS
production environment. Local Docker helps test a change before it is pushed;
the website and API continue running on the AWS VM when the developer's PC is
off.

## Keyless access to the same VM

Port 22 is intentionally closed. The supported shell is AWS Systems Manager,
which gives each developer an auditable session without copying SSH private
keys. The owner first invites the developer as a team member in AWS Settings and
grants the narrowest permission to start a session on this one instance. Each
developer then uses their own AWS sign-in/profile and the Session Manager
plugin:

```powershell
aws ssm start-session --target i-097df027e02b0708f --region eu-north-1 --profile mireli
```

Useful read-only checks inside the session:

```bash
sudo systemctl is-active docker caddy mireli-app
docker ps --filter name=mireli
curl -fsS http://127.0.0.1:3000/api/health
curl -fsS http://127.0.0.1:3000/api/v1/driver/status
```

Do not print `/etc/mireli/runtime.env`, shell environment variables, full
container inspection output, or Secrets Manager values. Do not open SSH or
share the owner's AWS profile. Keep code edits in Git and deploy only a reviewed
image; do not make source edits directly inside the VM.

## Provider configuration owned by the backend

Configure server-side values in the existing `MireliRuntimeSecret` in AWS
Secrets Manager. The host loads the secret when `mireli-app` starts and writes
only the required variables into the root-owned `0600` runtime file. Never put
these values in Git, an Android build, GitHub Actions variables, screenshots,
or this document.

- Driver SMS OTP: `DRIVER_AUTH_SECRET` (at least 32 characters),
  `AT_USERNAME`, and `AT_API_KEY`.
- Driver email OTP and customer booking tickets: `DRIVER_AUTH_SECRET`,
  `BREVO_API_KEY`, and a verified `BREVO_SENDER_EMAIL`. The display name is
  `BREVO_SENDER_NAME` (defaults to `Mi-Reli SGR Bookings`).
- Optional customer-facing support contact: `MIRELI_SUPPORT_EMAIL`.
- In-app routing: the documented `VALHALLA_*` settings.
- Secure onboarding documents: the documented `DRIVER_DOCUMENT_BUCKET`,
  scanner, reviewer, privacy, and terms settings. Registration stays closed
  until authenticated staff review is implemented and all checks pass.
- Driver payout: the documented `MPESA_*` B2C settings and approved beneficiary
  review. Do not enable live payout until callbacks and reconciliation pass.

The free `mirelisgr.duckdns.org` hostname only supplies web DNS; it is not a
verified email domain or mailbox. For branded sender addresses such as
`bookings@your-owned-domain`, use a domain whose DNS you control, authenticate it
with Brevo (SPF/DKIM and a DMARC policy), and verify a sender before sending
customer tickets. Brevo accepting a message is not proof it arrived; verify a
real inbox delivery in Brevo's transactional log.

## Release and shared-data rules

1. Make API contract changes in Mireli Web and Android client changes in the
   separate Mireli Driver repository. Additive Prisma migrations are the only
   schema-change path; coordinate them before shipping either client.
2. Run the Android unit/lint/build checks and the web Docker/CI checks. Keep
   local demo and production data separate.
3. Push a reviewed commit. GitHub CI validates application code, the Linux
   container, and the AWS VM template. The GitHub OIDC deploy job remains off
   while the AWS project policy denies creation of an OIDC provider. Do not
   work around that with long-lived AWS keys.
4. Deploy an immutable ARM64 image to the VM through the documented AWS release
   procedure, then check `/api/health` and `/api/v1/driver/status` over the
   internal and public paths.
5. Complete an end-to-end test with an approved driver, correct route and
   timetable, successful M-Pesa callback, driver acceptance, boarding PIN,
   trip completion, and post-trip payout reconciliation before enabling a
   customer release.

The existing web-side deployment status, DNS gate, and service details are in
[AWS-MIGRATION.md](AWS-MIGRATION.md). Do not describe the system as production
ready while any of these gates is open.
