# Running Mireli with Docker

Mireli runs as one container and one built image. The image contains the
Next.js server and PostgreSQL 16; the database listens only on container
loopback, so only the web port is published. Database files and encrypted
driver documents remain in separate named volumes and survive image rebuilds.
Runtime secrets and settings stay in `.env.docker` rather than image layers.

```sh
cp .env.docker.example .env.docker   # then edit the required secrets
docker compose --env-file .env.docker up -d --build
open http://localhost:3000
```

If moving from the previous two-container setup, stop and remove the old
containers while keeping their volumes, then build the single image:

```sh
docker compose --env-file .env.docker down --remove-orphans
docker compose --env-file .env.docker up -d --build
```

Do not add `-v` to the `down` command; that would delete the booking database.
After confirming no other local project uses the old image, remove its unused
image to reclaim disk space:

```sh
docker image rm postgres:16-alpine
```

Check it is healthy:

```sh
docker compose --env-file .env.docker ps            # one app container: healthy
docker compose --env-file .env.docker logs -f app   # PostgreSQL, migrations, app
curl http://localhost:3000/api/health   # {"status":"ok"}
```

## What runs

| Container | Image | Published port | Persistent state |
| --- | --- | --- | --- |
| `app` | `mireli-web` (Next.js + PostgreSQL 16) | `${MIRELI_PORT:-3000}` → 3000 | `db-data` → PostgreSQL files; `app-state` → encrypted driver documents |

At startup the container starts its private PostgreSQL process, runs
`prisma migrate deploy` (versioned migrations only — never seeds, never resets)
and then starts the traced Next.js server as the unprivileged `nextjs` user.
The healthcheck polls `GET /api/health`, which proves the server **and** the
database connection both work. Docker restarts the container if either process
exits unexpectedly.

## Configuration

All configuration lives in `.env.docker` (git-ignored). The example supplies
local defaults except `SESSION_SECRET`, which is marked **REQUIRED**:

| Variable | Purpose |
| --- | --- |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | Local PostgreSQL identity. User/database names use letters, digits, and underscores. The entrypoint safely URL-encodes the password into the private database URL. |
| `DATABASE_URL` | Generated at startup for the bundled PostgreSQL instance; external or stale URLs are ignored. |
| `SESSION_SECRET` | **Required.** Signs passenger/admin session cookies (32+ characters). Rotating it signs everyone out. |
| `MIRELI_PUBLIC_ORIGIN` | Origin browsers use. A demo deployment derives it from each request; a pinned production origin is enforced at the CSRF boundary. |
| `MIRELI_PORT` | Host port for the app (default 3000). |
| `MIRELI_APPLY_DATABASE_MIGRATIONS` | `true` (default) applies `prisma/migrations` at container start. |
| `MIRELI_BOOTSTRAP_PLATFORM_CONFIG` | `true` (default) creates the single operations-settings row on a brand new database, below. |
| `MIRELI_DEMO_MODE` + `MIRELI_ALLOW_UNSAFE_DEMO` | The prototype boundary, below. |
| `TZ` | Defaults to `Africa/Nairobi`; statements and trip times use it. |
| `MPESA_*`, `DRIVER_*`, `AWS_*`, `BREVO_*` | Optional provider credentials — see `.env.docker.example`. |

PostgreSQL applies its identity settings when `db-data` is first initialized.
Keep the configured user, database, and password aligned with that volume on
later starts; the database volume is the source of truth for existing records.

### First run on an empty database

Every booking, payout and settlement reads one operations-settings row
(`PlatformConfig.id = "main"`). A fresh PostgreSQL volume has no such row, and
the only surface that would create it is Admin → Payments — which needs an
administrator sign-in, which needs the same row. With
`MIRELI_BOOTSTRAP_PLATFORM_CONFIG=true` (the default) the container closes that
loop on first start by creating the row with the documented schema defaults.

It creates **nothing else**: no bookings, drivers, timetable or money records,
and it never modifies or resets an existing row. Set it to `false` if you
prefer to insert the row yourself:

```sh
docker compose exec app sh -c \
  'node -e "const{PrismaClient}=require(\"@prisma/client\");const db=new PrismaClient();db.platformConfig.create({data:{id:\"main\"}}).then(()=>db.$disconnect())"'
```

### Demo boundary versus strict production

This codebase keeps prototype behaviour behind a two-flag gate, so a stray
environment variable can never switch it on in a real deployment:

| `MIRELI_DEMO_MODE` | `MIRELI_ALLOW_UNSAFE_DEMO` | Result |
| --- | --- | --- |
| `true` | `true` | Prototype behaviour: admin/passenger sign-in works, M-Pesa is simulated, driver documents are encrypted to the local volume. A banner marks every page. **Never use for real passengers.** |
| `true` | `false` | Strict production. Sign-in and payments stay disabled until verified authentication and real Daraja credentials exist. |
| `false` | anything | Strict production. |

To move a VM to strict production later, set `MIRELI_DEMO_MODE=false`, restart
the container, and add the real provider credentials — no rebuild.

### Signing in for the first time (prototype)

With the demo boundary open, the admin allow-list and second factor come from
the freshly created operations-settings row: sign in at `/admin/login` as
`admin@mireli.co.ke` or `demitri@mireli.co.ke`, accept any 4-digit OTP, and
enter the second factor `mireli2026`. Change both immediately in Admin →
Config. Passenger sign-in works the same way in demo mode.

## Moving to a VM

1. Install Docker Engine (or Docker Desktop) on the VM.
2. Copy the project folder **and** `.env.docker` (e.g. `rsync -a --exclude node_modules`).
3. Adjust `.env.docker`: `MIRELI_PUBLIC_ORIGIN` must be the origin users type
   (e.g. `http://203.0.113.10:3000` or `https://mireli.example`).
4. `docker compose --env-file .env.docker up -d --build` — the build happens on the VM, so it needs
   internet access for `npm ci` and the Prisma engine download.
5. Point a browser at `http://<vm-ip>:3000`.

To skip building on the VM, tag and push the image to a registry first, then
replace the `build:` block with `image: <registry>/mireli-web:<tag>`. If the VM
has a different CPU architecture, build with
`docker build --platform linux/amd64 -t mireli-web .` (Prisma and sharp ship
per-platform engines).

Put a TLS-terminating reverse proxy (Caddy, nginx, Traefik) in front before
exposing it to the internet — the repo already keeps a `Caddyfile` for local
use, and Next.js expects `X-Forwarded-*` headers from a proxy.

## Backups and restore

```sh
# dump
docker compose --env-file .env.docker exec -T app sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" /usr/lib/postgresql/16/bin/pg_dump -h 127.0.0.1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > backup.dump
# restore (into a fresh stack)
docker compose --env-file .env.docker exec -T app sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" /usr/lib/postgresql/16/bin/pg_restore -h 127.0.0.1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists' < backup.dump
```

The `app-state` volume holds encrypted driver documents; include it in any
migration if you use local document storage:

```sh
docker run --rm -v mireli_app-state:/data -v "%cd%":/backup alpine tar czf /backup/app-state.tgz -C /data .
```

## Day-to-day operations

```sh
docker compose --env-file .env.docker logs -f app          # PostgreSQL + app logs
docker compose --env-file .env.docker restart app          # picks up .env.docker changes
docker compose --env-file .env.docker up -d --build        # deploy a new image
docker compose --env-file .env.docker exec app sh          # shell inside Mireli
docker compose --env-file .env.docker down                 # stop (data volumes are kept)
docker compose --env-file .env.docker down -v              # stop and DELETE all data
```

Migrations are applied automatically at start. To run them by hand:

```sh
docker compose --env-file .env.docker exec app sh -c 'cd /opt/prisma-cli && node node_modules/prisma/build/index.js migrate deploy'
```

## Who consumes this backend: the Android driver app

The `mireli-driver` repository talks to `/api/v1/driver/*` on whichever host its
`BuildConfig.DRIVER_SERVICE_URL` points at, and it **requires the backend's
`simulation` flag to match its build** (`src/lib/driver/readiness.ts`):

| Driver build | Expects `/api/v1/driver/status` `simulation` | Backend mode |
| --- | --- | --- |
| `staging` (emulator, `http://10.0.2.2`) | `true` | `MIRELI_DEMO_MODE=true` + `MIRELI_ALLOW_UNSAFE_DEMO=true` |
| `pilot` / `production` (`https://…`) | `false` | `MIRELI_DEMO_MODE=false`, with `DRIVER_AUTH_SECRET` + `AT_*` configured |

So a mismatch is deliberate: testing builds refuse a strict backend, release
builds refuse a simulated one. The phone never receives backend secrets — only
the base URL. Full build and wiring instructions live in the driver repository's
`docs/BUILD-AND-BACKEND-SETUP.md`.

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| `403 Request origin is not allowed` on any write | `MIRELI_PUBLIC_ORIGIN` does not match the origin in the address bar. Update `.env.docker`, `docker compose restart app`. |
| PostgreSQL does not become ready | Check `docker compose --env-file .env.docker logs app`; verify the `db-data` volume has free space and configured credentials match the existing volume. |
| Migration failure on first boot | `docker compose logs app` prints the Prisma error code. The app refuses to start on a failed migration so you never run against a half-migrated schema. |
| Sign-in returns 503 in strict mode | Expected: set `MIRELI_DEMO_MODE=true` and `MIRELI_ALLOW_UNSAFE_DEMO=true` for prototype behaviour, or wire real authentication. |
| Payments fail in strict mode | Expected: add Daraja credentials (`MPESA_*`) or the saved platform credentials in Admin → Payments. |
| Healthcheck `unavailable` while the page loads | The database connection is failing; check the combined container logs and `db-data` volume space. |

## What this setup does not configure

Same gates as the rest of the project: production passenger/admin
authentication, live M-Pesa settlement, provider verification, refund
settlement and production storage. See `docs/PRODUCTION-READINESS.md` and
`docs/ALIGNMENT.md`.
