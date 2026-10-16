# Mireli Web

Aligned with the cofounder passenger app at upstream commit
`687ef7a0b7e14fc97628f578dfafe15a500cd0cc`, with PostgreSQL configuration,
portable builds and stricter separation of local simulation from production.

Target passenger URL: https://mirelisgr.duckdns.org (AWS cutover pending).

Company contact: mirelisgr001@gmail.com

**Development integration copy; not approved for deployment.** Passenger and
administrator production sign-in remain disabled until verified authentication
is configured. Driver SMS authentication is implemented; live setup is pending.
No live database has been connected or migrated.

The implemented driver API is `/api/v1/driver`: verified session access, separate
existing-driver sign-in and new-application availability, private
onboarding, compliance review, assigned-trip commands, statement/beneficiary review
and support. Driver operations use the same passenger bookings and payment ledger.
Accepted B2C requests remain processing until a correlated settlement result.
Payouts require beneficiary approval; live sending defaults to disabled.
Local HTTP and isolated PostgreSQL concurrency tests passed. Production storage,
SMS/admin authentication, refund settlement and provider verification remain gates.

```sh
npm ci --ignore-scripts
npm run preview:local
```

The isolated synthetic preview runs at http://127.0.0.1:3100. It does not book
real journeys or transfer money. Your original local project is preserved.

### Containerised local host (Docker)

```sh
cp .env.docker.example .env.docker   # then set SESSION_SECRET
docker compose --env-file .env.docker up -d --build
```

Runs one production container with PostgreSQL 16, versioned migrations applied
at start, and a healthcheck on `/api/health`. Database and encrypted upload data
persist in named volumes. Because the image holds no configuration, it moves to
any VM without a rebuild.
See [container hosting](docs/DOCKER.md) for configuration, demo versus strict
production mode, backups and VM migration.

```sh
npm run test
npm run db:generate
npm run typecheck
npm run build
```

See [alignment and deployment gates](docs/ALIGNMENT.md) and
[driver integration contract](docs/DRIVER-INTEGRATION.md), plus
[local validation evidence and limitations](docs/VALIDATION.md).

Stop the preview before running a PostgreSQL build: the preview generates a
SQLite-specific Prisma client, while `npm run build` regenerates the PostgreSQL
client. Restart `npm run preview:local` when returning to the synthetic demo.
