#!/bin/sh
# One Mireli container runs PostgreSQL and the Next.js server. PostgreSQL
# accepts connections only on loopback; the app is the only published service.
set -eu

log() { printf '[mireli] %s\n' "$*"; }
fail() { log "$*"; exit 1; }

# AWS can run the same single application container against private RDS. The
# default remains the existing one-container/embedded-PostgreSQL setup used by
# local Docker, so existing developers do not need to change their environment.
case "${MIRELI_DATABASE_MODE:-embedded}" in
  external)
    [ -n "${DATABASE_URL:-}" ] || fail "DATABASE_URL is required when MIRELI_DATABASE_MODE=external."
    case "$DATABASE_URL" in
      postgres://*|postgresql://*) ;;
      *) fail "DATABASE_URL must use the PostgreSQL protocol." ;;
    esac

    if [ "${MIRELI_APPLY_DATABASE_MIGRATIONS:-false}" = "true" ]; then
      log "applying versioned migrations to the external PostgreSQL database..."
      if ! gosu nextjs sh -c 'cd /opt/prisma-cli && node node_modules/prisma/build/index.js migrate deploy'; then
        fail "migrations failed; not starting the application."
      fi
      log "database schema is up to date."
    else
      log "MIRELI_APPLY_DATABASE_MIGRATIONS is not 'true'; skipping migrations."
    fi

    if [ "${MIRELI_BOOTSTRAP_PLATFORM_CONFIG:-false}" = "true" ]; then
      log "ensuring operations settings exist..."
      if ! gosu nextjs node /app/mireli-bootstrap.mjs; then
        fail "operations-settings bootstrap failed; not starting the application."
      fi
      log "operations settings are ready."
    else
      log "MIRELI_BOOTSTRAP_PLATFORM_CONFIG is not 'true'; skipping first-run bootstrap."
    fi

    log "starting the Mireli server on ${HOSTNAME:-0.0.0.0}:${PORT:-3000}..."
    exec gosu nextjs "$@"
    ;;
  embedded)
    ;;
  *)
    fail "MIRELI_DATABASE_MODE must be 'embedded' or 'external'."
    ;;
esac

POSTGRES_USER=${POSTGRES_USER:-mireli}
POSTGRES_PASSWORD=${POSTGRES_PASSWORD:-}
POSTGRES_DB=${POSTGRES_DB:-mireli}
PGDATA=${PGDATA:-/var/lib/postgresql/data}

case "$POSTGRES_USER" in
  ''|*[!A-Za-z0-9_]*|[0-9]*) fail "POSTGRES_USER must use letters, digits, and underscores, and must not start with a digit." ;;
esac
case "$POSTGRES_DB" in
  ''|*[!A-Za-z0-9_]*|[0-9]*) fail "POSTGRES_DB must use letters, digits, and underscores, and must not start with a digit." ;;
esac
[ -n "$POSTGRES_PASSWORD" ] || fail "POSTGRES_PASSWORD is required."

# Always point the app to this container's private PostgreSQL. This keeps a
# stale local or hosted DATABASE_URL from sending test bookings to the wrong DB.
DATABASE_URL=$(node -e 'const e=encodeURIComponent; process.stdout.write(`postgresql://${e(process.env.POSTGRES_USER)}:${e(process.env.POSTGRES_PASSWORD)}@127.0.0.1:5432/${e(process.env.POSTGRES_DB)}?schema=public`);')
export DATABASE_URL

mkdir -p "$PGDATA"
POSTGRES_UID=$(id -u postgres)
if [ "$(stat -c '%u' "$PGDATA")" != "$POSTGRES_UID" ]; then
  log "updating PostgreSQL data directory ownership..."
  chown -R postgres:postgres "$PGDATA"
fi

if [ ! -s "$PGDATA/PG_VERSION" ]; then
  log "initializing PostgreSQL 16 data directory..."
  password_file=$(mktemp)
  chmod 0600 "$password_file"
  chown postgres:postgres "$password_file"
  printf '%s\n' "$POSTGRES_PASSWORD" > "$password_file"
  if ! gosu postgres /usr/lib/postgresql/16/bin/initdb \
      --pgdata="$PGDATA" \
      --username="$POSTGRES_USER" \
      --pwfile="$password_file" \
      --auth-local=trust \
      --auth-host=scram-sha-256 \
      --encoding=UTF8 \
      --locale=C.UTF-8; then
    rm -f "$password_file"
    fail "PostgreSQL initialization failed."
  fi
  rm -f "$password_file"
elif [ "$(cat "$PGDATA/PG_VERSION")" != "16" ]; then
  fail "PostgreSQL data volume is not version 16; refusing an unsafe in-place upgrade."
fi

log "starting PostgreSQL 16 on loopback..."
gosu postgres /usr/lib/postgresql/16/bin/postgres \
  -D "$PGDATA" \
  -c listen_addresses=127.0.0.1 \
  -c port=5432 \
  -c logging_collector=off \
  -c log_destination=stderr &
POSTGRES_PID=$!

stop_postgres() {
  if kill -0 "$POSTGRES_PID" 2>/dev/null; then
    kill -INT "$POSTGRES_PID" 2>/dev/null || true
    wait "$POSTGRES_PID" || true
  fi
}

attempt=0
until /usr/lib/postgresql/16/bin/pg_isready --quiet --host=127.0.0.1 --port=5432 --username="$POSTGRES_USER" --dbname=postgres; do
  if ! kill -0 "$POSTGRES_PID" 2>/dev/null; then
    wait "$POSTGRES_PID" || true
    fail "PostgreSQL exited before it became ready."
  fi
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 90 ]; then
    stop_postgres
    fail "PostgreSQL did not become ready within 90 seconds."
  fi
  sleep 1
done
log "PostgreSQL is ready."

# The environment-provided database name is restricted above, so it is safe to
# use in this SQL literal and as a createdb argument.
if ! database_exists=$(PGPASSWORD="$POSTGRES_PASSWORD" /usr/lib/postgresql/16/bin/psql --host=127.0.0.1 --port=5432 --username="$POSTGRES_USER" --dbname=postgres --tuples-only --no-align \
  --command="SELECT 1 FROM pg_database WHERE datname = '$POSTGRES_DB';"); then
  stop_postgres
  fail "could not inspect PostgreSQL databases with the configured credentials."
fi
if [ "$database_exists" != "1" ]; then
  if ! PGPASSWORD="$POSTGRES_PASSWORD" /usr/lib/postgresql/16/bin/createdb --host=127.0.0.1 --port=5432 --username="$POSTGRES_USER" "$POSTGRES_DB"; then
    stop_postgres
    fail "could not create the configured PostgreSQL database."
  fi
fi

if [ "${MIRELI_APPLY_DATABASE_MIGRATIONS:-false}" = "true" ]; then
  log "applying versioned migrations..."
  if ! gosu nextjs sh -c 'cd /opt/prisma-cli && node node_modules/prisma/build/index.js migrate deploy'; then
    stop_postgres
    fail "migrations failed; not starting the application."
  fi
  log "database schema is up to date."
else
  log "MIRELI_APPLY_DATABASE_MIGRATIONS is not 'true'; skipping migrations."
fi

if [ "${MIRELI_BOOTSTRAP_PLATFORM_CONFIG:-false}" = "true" ]; then
  log "ensuring operations settings exist..."
  if ! gosu nextjs node /app/mireli-bootstrap.mjs; then
    stop_postgres
    fail "operations-settings bootstrap failed; not starting the application."
  fi
  log "operations settings are ready."
else
  log "MIRELI_BOOTSTRAP_PLATFORM_CONFIG is not 'true'; skipping first-run bootstrap."
fi

log "starting the Mireli server on ${HOSTNAME:-0.0.0.0}:${PORT:-3000}..."
gosu nextjs "$@" &
APP_PID=$!

shutdown() {
  trap - TERM INT
  if kill -0 "$APP_PID" 2>/dev/null; then
    kill -TERM "$APP_PID" 2>/dev/null || true
  fi
  stop_postgres
  wait "$APP_PID" || true
}
trap 'shutdown; exit 0' TERM INT

# Exit the container if either service stops. This lets Docker restart the
# whole local stack instead of leaving a healthy-looking but unusable app.
while kill -0 "$APP_PID" 2>/dev/null; do
  if ! kill -0 "$POSTGRES_PID" 2>/dev/null; then
    log "PostgreSQL exited unexpectedly; stopping Mireli."
    kill -TERM "$APP_PID" 2>/dev/null || true
    wait "$APP_PID" || true
    exit 1
  fi
  sleep 1
done

set +e
wait "$APP_PID"
app_status=$?
set -e
stop_postgres
exit "$app_status"
