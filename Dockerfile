# syntax=docker/dockerfile:1
# ---------------------------------------------------------------------------
# Mireli web — single-container self-hosted image (Next.js + PostgreSQL 16)
#
#   docker build -t mireli-web .
#   docker compose --env-file .env.docker up -d  # migrations run at startup
#
# The image carries no configuration: DATABASE_URL, SESSION_SECRET and the rest
# are read at runtime, so one image can be promoted from a laptop to a VM.
# ---------------------------------------------------------------------------

ARG NODE_IMAGE=node:22-bookworm-slim

# --- base -------------------------------------------------------------------
FROM ${NODE_IMAGE} AS base
WORKDIR /app
# Prisma picks its engine by inspecting the installed OpenSSL; bookworm-slim
# ships libssl but no `openssl` binary, which makes detection fall back to a
# legacy engine. Installing it keeps engine selection unambiguous.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl \
 && rm -rf /var/lib/apt/lists/*
ENV NEXT_TELEMETRY_DISABLED=1 \
    npm_config_update_notifier=false

# --- dependencies -----------------------------------------------------------
# Scripts are skipped so no package can run arbitrary code at install time;
# Prisma's engine download happens later, explicitly, in the build stage.
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

# --- build ------------------------------------------------------------------
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# prisma generate (PostgreSQL client, Linux/OpenSSL 3 engine) + the same
# `next build --webpack` a developer machine runs. No database is contacted.
RUN node scripts/container-build.mjs

# A self-contained Prisma CLI for runtime migrations. It is installed into its
# own prefix so the CLI's dependency tree (effect, @prisma/config, engines) is
# complete and never has to be reconciled with the application's node_modules.
# The final RUN also downloads the schema engine, so a locked-down VM never
# needs network access to migrate.
RUN CLI_VERSION="$(node -p "require('./package.json').devDependencies.prisma")" \
 && mkdir -p /opt/prisma-cli \
 && cd /opt/prisma-cli \
 && npm init -y > /dev/null \
 && npm install --no-audit --no-fund "prisma@${CLI_VERSION}" \
 && node node_modules/prisma/build/index.js migrate diff \
      --from-empty --to-schema-datamodel /app/prisma/schema.prisma --script > /dev/null

# --- test (optional, not part of the shipped image) -------------------------
# `docker build --target test .` type-checks and runs the vitest suite inside
# the same Linux dependency tree the image is built from. Kept before the
# runtime stage so the default build target stays the runnable image.
FROM build AS test
RUN npm run typecheck && npm run test

# --- runtime ----------------------------------------------------------------
FROM ${NODE_IMAGE} AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    PGDATA=/var/lib/postgresql/data

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl gosu openssl tini \
 && install -d -m 0755 /usr/share/keyrings \
 && curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc -o /usr/share/keyrings/postgresql.asc \
 && echo "deb [signed-by=/usr/share/keyrings/postgresql.asc] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" > /etc/apt/sources.list.d/pgdg.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends postgresql-16 postgresql-client-16 locales \
 && localedef -i en_US -f UTF-8 en_US.utf8 \
 && if pg_lsclusters --no-header | grep -q '^16[[:space:]]\+main'; then pg_dropcluster --stop 16 main; fi \
 && apt-get purge -y --auto-remove curl \
 && rm -f /etc/apt/sources.list.d/pgdg.list /usr/share/keyrings/postgresql.asc \
 && rm -rf /var/lib/apt/lists/* \
 && groupadd --system --gid 1001 nodejs \
 && useradd --system --uid 1001 --gid nodejs nextjs

# Traced production server (server.js + only the modules it needs).
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=build --chown=nextjs:nodejs /app/public ./public

# Self-contained Prisma CLI + versioned migrations, kept outside the traced
# app so the runtime migrator can never collide with the application's client.
COPY --from=build --chown=nextjs:nodejs /opt/prisma-cli /opt/prisma-cli
COPY --from=build /app/prisma/schema.prisma /opt/prisma-cli/prisma/schema.prisma
COPY --from=build /app/prisma/migrations /opt/prisma-cli/prisma/migrations

# Named volumes start out empty; initialize them with the correct service users.
RUN mkdir -p /app/.local /var/lib/postgresql/data \
 && chown nextjs:nodejs /app/.local \
 && chown postgres:postgres /var/lib/postgresql/data

COPY --chmod=0755 docker/entrypoint.sh /usr/local/bin/mireli-entrypoint.sh
# A Windows checkout can preserve CRLF in shell scripts. Normalize it in the
# Linux image so the kernel can resolve the entrypoint's shebang.
RUN sed -i 's/\r$//' /usr/local/bin/mireli-entrypoint.sh
COPY --chown=nextjs:nodejs docker/bootstrap-platform-config.mjs /app/mireli-bootstrap.mjs

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["tini", "-g", "--", "/usr/local/bin/mireli-entrypoint.sh"]
CMD ["node", "server.js"]
