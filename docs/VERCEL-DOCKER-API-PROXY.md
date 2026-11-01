# Retired: Vercel pages with the shared Docker API

This deployment pattern has been retired. Mireli Web and its `/api/*` routes
run together on the AWS VM. The Next.js config no longer proxies requests to a
separate backend, and `MIRELI_API_ORIGIN` is no longer used.

Use [AWS migration status](AWS-MIGRATION.md) for production hosting and
[Docker setup](DOCKER.md) for local testing. The Vercel GitHub App connection is
managed outside this repository; remove only `mireli-web` from that app
installation to stop automatic Vercel previews.

