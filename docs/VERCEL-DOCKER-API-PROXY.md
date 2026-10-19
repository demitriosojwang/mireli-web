# Vercel pages with the shared Docker API

The passenger site calls same-origin `/api/*` URLs. On Vercel, Next.js rewrites
those requests to the shared Mireli backend while leaving the browser on the
official Mireli site. The rewrite is configured in `next.config.ts` with
`MIRELI_API_ORIGIN`.

## Configure Vercel

Set `MIRELI_API_ORIGIN` in the Vercel project's **Preview** and **Production**
environments to the public HTTPS origin of the Docker-backed Mireli server, for
example `https://api.example.com`. Use the staging backend for Preview and the
production backend for Production. Redeploy after changing the value because
Next.js includes external rewrite destinations in the build output.

The value must be an HTTPS origin only: no username/password, path, query, or
fragment. Do not point it at `mireli-tau.vercel.app` or another Vercel frontend
alias, which would proxy requests back to itself.

Vercel cannot reach `localhost`, a Docker Compose service name, or the Android
emulator address `10.0.2.2`. The Docker host must have a stable, externally
reachable HTTPS endpoint, such as a TLS-terminating reverse proxy on a hosted
VM or an approved HTTPS tunnel. Do not expose the database port. Keep the
backend in strict mode for real passengers and configure its `MIRELI_PUBLIC_ORIGIN`
to the exact public Mireli site origin so browser mutation checks accept the
same-origin requests.

## Local Docker

Leave `MIRELI_API_ORIGIN` unset in `.env.docker`. The local Next.js container
continues to serve its own `/api/*` handlers and PostgreSQL connection; this
rewrite is only needed when a Vercel deployment is acting as the web frontend
for a separate shared backend.

See [Docker setup](DOCKER.md), [driver integration contract](DRIVER-INTEGRATION.md),
and the [production readiness checklist](PRODUCTION-READINESS.md) for the
backend setup, shared API contract, and remaining launch gates.

