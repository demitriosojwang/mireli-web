# Mireli Web

Mireli Web is the customer booking site and shared API for Mireli Driver. The
production target is a single AWS EC2 VM in `eu-north-1`; its one immutable
container contains the Next.js frontend, API, and PostgreSQL. Caddy terminates
HTTPS on the host. Local Docker is for development and release testing only; the
AWS site stays online when a developer's computer is off.

## Current AWS state

- EC2: `i-097df027e02b0708f` (`t4g.small`, ARM64), Elastic IP `13.53.183.149`.
- The VM's app and API are healthy internally on image `794fb87`.
- The intended hostname is `https://mirelisgr.duckdns.org`, but it still
  resolves to the old IP `105.161.112.67`. Rotate the exposed DuckDNS token,
  update its A record to the EIP, and verify public TLS before calling the site
  live for customers.
- Production uses strict mode. The stage/timetable catalogue is empty and no
  driver is approved, so available pooled cabs correctly remain at zero.
- Real customer/driver authentication, Daraja collection and reconciliation,
  Brevo ticket delivery, and post-trip payout credentials are not configured.
  The app is not ready to accept customer bookings.

See [AWS migration and launch gates](docs/AWS-MIGRATION.md),
[the production checklist](docs/PRODUCTION-READINESS.md), and the
[VM/driver handoff](docs/VM-AGENT-HANDOFF.md) or the focused
[Mireli Driver agent VM handoff](docs/DRIVER-AGENT-VM-HANDOFF.md).

## Local Docker test environment

```powershell
if (!(Test-Path .env.docker)) { Copy-Item .env.docker.example .env.docker }
# Set unique local-only secrets in .env.docker before first start.
docker compose --env-file .env.docker up -d --build
docker compose --env-file .env.docker ps
curl.exe http://127.0.0.1:3000/api/health
```

The health response should be `{"status":"ok"}`. The Compose app is one
container with embedded PostgreSQL and persistent named volumes. Local demo
mode is labelled and must never be used for real fares, passenger data, or
production credentials. Do not use `docker compose down -v`; it deletes the
database volume. See [Docker operations](docs/DOCKER.md).

## Verify a change before pushing

```powershell
npm ci --ignore-scripts --no-audit --no-fund
npm run db:validate
npm run db:generate
npm test
npm run typecheck
npm run lint
npm run build
docker compose --env-file .env.docker up -d --build
curl.exe http://127.0.0.1:3000/api/health
```

Push the reviewed commit only after local verification. GitHub Actions repeats
the application checks, Linux container build, and CloudFormation/Guard
validation. The AWS OIDC deploy job remains disabled because the AWS project
policy currently denies creation of GitHub's OIDC provider. Do not use
long-lived AWS keys in GitHub. The tested release procedure and current blocker
are documented in [AWS migration](docs/AWS-MIGRATION.md).

## Mireli Driver shared backend

The driver app uses `/api/v1/driver/*` on the same service and PostgreSQL data;
it never connects to the database directly. Give the Android agent
[DRIVER-SHARED-BACKEND-SETUP.md](docs/DRIVER-SHARED-BACKEND-SETUP.md) and
[DRIVER-INTEGRATION.md](docs/DRIVER-INTEGRATION.md) and
[DRIVER-AGENT-VM-HANDOFF.md](docs/DRIVER-AGENT-VM-HANDOFF.md). VM access is through
individual AWS team membership and SSM, not shared SSH keys. The public driver
URL stays blocked until DNS and TLS work.

## Customer ticket email

After a booking is confirmed and ledgered, the server sends a branded Brevo
ticket email and records its delivery state so duplicate payment callbacks do
not send duplicate tickets. Configure `BREVO_API_KEY`,
`BREVO_SENDER_EMAIL`, and optional sender/support names in AWS Secrets Manager;
verify the sender/domain and a real inbox delivery before opening bookings.
Provider acceptance alone is not proof of delivery.
