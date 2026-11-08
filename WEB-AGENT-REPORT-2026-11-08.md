# WEB-AGENT REPORT — 2026-11-08

**To:** Mireli Driver (Android) agent · **From:** Mireli Web agent
**Date:** 2026-11-08 · **Commit released:** `d30cbc9` on `main` · **Deployed release tag:** `d30cbc9-nov08ui`
**Deployed method:** native VM build from `git archive` zip (staged at `s3://mireli-sgr-pilot-036834403673-db-backups-eu-north-1/mireli-sgr-pilot/database/build/mireli-src-d30cbc9.zip`), SSM `AWS-RunShellScript` → ECR image `036834403673.dkr.ecr.eu-north-1.amazonaws.com/mireli-sgr-pilot-appimagerepository-juxctzu7badb:d30cbc9-nov08ui`, release-gated on API readiness with automatic rollback.

## Local verification before deploy

- `tsc --noEmit`: clean.
- `vitest run`: **50 test files, 251 tests passed, 0 failed.**
- `eslint` on all 12 touched files: clean.

## Checklist curl results (run from outside AWS, after release)

All commands against `https://mireli.online` via `curl.exe`, 2026-11-08 ~13:05 UTC+3:

```
== /api/health ==
{"status":"ok"}
== /api/routes ==
{"pointCount":0}
== /api/driver-supply ==
{"hasEligibleDrivers":false}
== /api/pay/options ==        (with -w "HTTP %{http_code}")
{"error":"Payment methods are temporarily unavailable.","code":"PAYMENT_OPTIONS_UNAVAILABLE"}
HTTP 503
```

```
== /api/v1/driver/status ==
{"apiVersion":"v1","simulation":false,"phoneSignInOpen":false,"emailSignInOpen":false,
 "registrationOpen":false,"navigationOpen":false,"supportEmail":"mirelisgr001@gmail.com",
 "message":"Driver email sign-in is not configured yet."}
```
(one line in reality; wrapped here for width — all four flags `false`, verbatim values)

```
== /api/trains ==
{"trains":[{"id":"krc-2026-nbo-mba-intercounty","name":"Inter-County","direction":"NBO_TO_MBA","originCode":"NTM","destCode":"MTM","originTime":"08:00","destTime":"14:00","destDayOffset":0,"serviceDays":[0,1,2,3,4,5,6]},{"id":"krc-2026-mba-nbo-intercounty","name":"Inter-County","direction":"MBA_TO_NBO","originCode":"MTM","destCode":"NTM","originTime":"08:00","destTime":"14:10","destDayOffset":0,"serviceDays":[0,1,2,3,4,5,6]},{"id":"krc-2026-mba-nbo-express","name":"Express","direction":"MBA_TO_NBO","originCode":"MTM","destCode":"NTM","originTime":"15:00","destTime":"20:18","destDayOffset":0,"serviceDays":[0,1,2,3,4,5,6]},{"id":"krc-2026-nbo-mba-express","name":"Express","direction":"NBO_TO_MBA","originCode":"NTM","destCode":"MTM","originTime":"15:00","destTime":"20:30","destDayOffset":0,"serviceDays":[0,1,2,3,4,5,6]},{"id":"krc-2026-nbo-mba-night","name":"Night Train","direction":"NBO_TO_MBA","originCode":"NTM","destCode":"MTM","originTime":"22:00","destTime":"03:55","destDayOffset":1,"serviceDays":[0,1,2,3,4,5,6]},{"id":"krc-2026-mba-nbo-night","name":"Night Train","direction":"MBA_TO_NBO","originCode":"MTM","destCode":"NTM","originTime":"22:00","destTime":"03:55","destDayOffset":1,"serviceDays":[0,1,2,3,4,5,6]}]}

== /api/stages?q=Mtwapa ==
{"points":[],"hasMore":false}
```

```
== page statuses ==
terms 200
privacy 200
sitemap 200
manifest.webmanifest 200
sw.js 200
```

Live `sitemap.xml` (2026-11-08T13:01:11.276Z), verbatim:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
<url>
<loc>https://mireli.online</loc>
<lastmod>2026-11-08T13:01:11.276Z</lastmod>
<changefreq>weekly</changefreq>
<priority>1</priority>
</url>
<url>
<loc>https://mireli.online/terms</loc>
<lastmod>2026-11-08T13:01:11.276Z</lastmod>
<changefreq>yearly</changefreq>
<priority>0.3</priority>
</url>
<url>
<loc>https://mireli.online/privacy</loc>
<lastmod>2026-11-08T13:01:11.276Z</lastmod>
<changefreq>yearly</changefreq>
<priority>0.3</priority>
</url>
</urlset>
```

Gate result inside the VM (same 7 checks as the deploy workflow, run locally on 127.0.0.1:3000, plus `/terms` and `/privacy`): `Release d30cbc9-nov08ui is healthy.` (log evidence below).

## Secrets / configuration (presence only — values never gathered or shown)

VM-side key-name check (`grep -o "^[A-Z_]*="` on `/etc/mireli/bootstrap.env` and `/etc/mireli/runtime.env`, zero output changed, output at S3 `database/diagnostics/secrets-presence-d30cbc9.txt`):

| Secret / env | Configured on VM? |
| --- | --- |
| `BREVO_API_KEY` / `BREVO_SENDER_EMAIL` | **NO** — key names absent from all env files |
| `AT_USERNAME` / `AT_API_KEY` | **NO** — key names absent from all env files |
| `DARAJA_CONSUMER_KEY` / secret / passkey | **NO** — key names absent from all env files |
| `DRIVER_TERMS_URL` | **YES** — set in `/etc/mireli/bootstrap.env` this release to `https://mireli.online/terms` |
| `DRIVER_PRIVACY_URL` | **YES** — set in `/etc/mireli/bootstrap.env` this release to `https://mireli.online/privacy` |

Env keys actually present: `bootstrap.env`: `AWS_REGION, BACKUP_BUCKET, BACKUP_PREFIX, DB_SECRET_ARN, DRIVER_PRIVACY_URL, DRIVER_TERMS_URL, ECR_URI, IMAGE_TAG, PUBLIC_HOSTNAME, SESSION_SECRET_ARN`; `runtime.env`: `MIRELI_ALLOW_UNSAFE_DEMO, MIRELI_APPLY_DATABASE_MIGRATIONS, MIRELI_BOOTSTRAP_PLATFORM_CONFIG, MIRELI_DATABASE_MODE, MIRELI_DEMO_MODE, MIRELI_PUBLIC_ORIGIN, NODE_OPTIONS, POSTGRES_DB, POSTGRES_PASSWORD, POSTGRES_USER, SESSION_SECRET, TZ`.

## Onboarding payload (changed this release)

`GET /api/v1/driver/onboarding` (Bearer session) now returns the two new non-null URL fields when the envs are set:

```json
{
  "policyVersion": "<existing constant>",
  "privacyUrl": "https://mireli.online/privacy",
  "termsUrl": "https://mireli.online/terms",
  "maxDocumentBytes": <server constant>,
  "simulation": false
}
```

Exact source: `src/lib/driver/onboarding.ts` line 19 — `privacyUrl: process.env.DRIVER_PRIVACY_URL ?? null, termsUrl: process.env.DRIVER_TERMS_URL ?? null`. If either env is unset the field is `null` instead of a URL. New public pages: `https://mireli.online/terms`, `https://mireli.online/privacy` (plain static pages, no auth, FOUC-free server components, linked from the site footer).

## Exact `/api/stages` body

`GET /api/stages?q=<query>` — `SEARCH_LIMIT = 12`:

```jsonc
// ready:
{
  "points": [
    {
      "id": "<uuid>",
      "name": "<stage name>",
      "order": <int > 0>,
      "fare": <int > 0>,          // owner-approved fare sheet wins over DB value
      "homeSurcharge": <int >= 0>,
      "routeId": "<uuid>",
      "route": { "id": "<uuid>", "name": "<route name>", "charterPrice": <int> }
    }
  ],
  "hasMore": <bool>                 // true ⇔ matches.length > 12
}
// empty query / not ready:
{ "points": [], "hasMore": false }
// DB failure:
{ "error": "Point search is temporarily unavailable." }  // HTTP 503
```

Route publication for the owner-approved stages (Likoni Ferry Container, Kona Mpya (Fayaz), Shika Adabu (Checkpoint)) was **NOT done this session**: they need owner-verified coordinates and order, and inventing pins would corrupt driver navigation. Not blocked by this release — unblocks as soon as the owner supplies coordinates.

## Tracking contract (Part 3) — DRAFTED, NOT BUILT

Per the handoff's sequencing ("ship Part 1 and Part 2 first"), the endpoints below are a contract draft for the Android broadcast service, not deployed code. Nothing consumes or produces live positions yet; `/api/v1/driver/status` still reports no tracking.

### 1. Ingestion — `POST /api/v1/driver/position`

- **Auth:** `Authorization: Bearer <driver-session-token>` (same `requireDriver` check as the rest of `/api/v1/driver/*`; 43-char token, hashed server side).
- **Rate limit:** one write per trip id per 3 s enforced server-side; excess accepted-and-ignored (HTTP 204, no error) so the Android service can fire-and-forget.
- **Body:**

```jsonc
{
  "tripId": "<uuid>",        // must belong to this driver; required
  "lat": -4.04347,           // WGS-84, required, validated range ±90
  "lng": 39.66939,           // WGS-84, required, validated range ±180
  "accuracyM": 12.5,         // optional float, metres
  "bearingDeg": 87,          // optional float 0–360
  "speedMps": 8.3,           // optional float >= 0, metres per second
  "recordedAt": "2026-11-08T09:15:30.250Z", // ISO-8601 UTC; required
  "idempotencyKey": "<uuid>" // optional; duplicate key ⇒ 204 no double-write
}
```

- **Validation/phase gate:** server rejects (HTTP 409 `TRIP_NOT_ACTIVE`) unless the trip is the driver's and its phase is `accepted`, `at_pickup`, or `in_progress`. Rejection on wrong ownership: 403.
- **Storage:** latest fix per trip (single row, new-fix wins; optimistic update by `recordedAt` — stale fixes ignored) + rolling buffer of the last 100 fixes for the trail, deleted at settlement.

### 2. Fan-out — `GET /api/v1/trips/{id}/position/stream`

- **Auth:** passenger `mireli_session` cookie (same signed session as `/api/me`); the connection is authorized only if the trip belongs to that passenger.
- **Transport:** Server-Sent Events (`text/event-stream`), keep-alive 15 s, auto-reconnect expected on the client.
- **Events:**

```jsonc
event: position
data: {
  "tripId": "<uuid>",
  "lat": -4.04347, "lng": 39.66939,
  "accuracyM": 12.5, "bearingDeg": 87, "speedMps": 8.3,
  "etaSeconds": 240,           // computed server-side; clients never compute distance/ETA
  "phase": "in_progress",      // accepted | at_pickup | in_progress | completed
  "recordedAt": "2026-11-08T09:15:30.250Z"
}

event: trail            // first event on connect only
data: { "points": [{"lat": .., "lng": ..}, ...] }   // buffer so far, oldest → newest

event: end
data: { "phase": "completed" }   // stream closes after this
```

- **Push cadence:** latest fix every 3–5 s; suppress duplicates (no new fix ⇒ heartbeat comment only).
- **Precondition:** none of this ships tracking anywhere — the DPA prerequisites in the handoff (DPIA, purpose-specific retention, ODPC registration) still gate the feature launch; the seconds above remain under purpose-specific retention (latest fix + trail deleted after settlement).

## Known deviations

1. **Part 1 item 3 (reviewer-authentication deploy): not applicable on this machine.** The handoff claims reviewer-auth work "exists uncommitted in the local web checkout" — `git status` on this checkout shows nothing uncommitted beyond today's intended changes, and no reviewer-auth files exist. Verified fact, quoted: `git status` reported only the handoff doc, `infra/aws/mireli-pilot.yaml`, and `tmp/` as untracked; no modified files. If reviewer-auth work exists on a different machine, it was not on this one.
2. **Part 1 items 1–2 (Brevo, Africa's Talking), Part 2 (Daraja): NOT DONE.** Owner-supplied credentials were not provided this session, so `emailSignInOpen`, `phoneSignInOpen`, `registrationOpen`, `navigationOpen` remain `false` and `/api/pay/options` remains gated. Owner action, not web-agent action.
3. **Stage publication: NOT DONE** (needs owner-verified coordinates — see section above).
4. **`DRIVER_POLICY_VERSION` note:** `submitApplication` still requires `process.env.DRIVER_POLICY_VERSION === POLICY_VERSION` outside demo mode (`src/lib/driver/onboarding.ts` line 62). When the owner approves the driver policy, `DRIVER_POLICY_VERSION` must be set in the VM env to the current constant or submission will 503 with `POLICY_NOT_APPROVED`.
5. **Motion checklist items marked N/A (honest enumeration):** arcs for object movement (7), masks for reveals (17), rubber band past bounds (19) — no surface in this UI where they would not be decorative noise; deliberately skipped. "Don't tween while held" (14) honored by using `whileTap` final state with a fixed 0.08 s settle rather than a continuous tween. Splash screen keeps its one-shot brand bounce (outset `cubic-bezier(0.34,1.56,0.64,1)`) — deliberate brand moment, not everyday UI.
6. **Sitemap test change:** the pinned metadata test now asserts three entries (home + /terms + /privacy); intentional, matches the sitemap produced by this release.
7. **Release script failure (registered, verbatim):** the first deploy script died after `push-ok` and `legal-urls-ok` with
   `re.error: incomplete escape \x at position 20` — its `old_tag` reader used an invalid Python-3.9 regex (`[\x27\x\"]?`). **Failure order was safe:** the image for `d30cbc9-nov08ui` was already pushed to ECR, the two legal URLs were already written, and `IMAGE_TAG` still pointed at `75cd809-nov06pwa` — the node never ran an unverifiable image. The release was then promoted with a gate-only script (tag swap + restart + readiness gate + rollback), which reported `Release d30cbc9-nov08ui is healthy.` (promote log: `database/diagnostics/promote-d30cbc9.txt`).
8. **Privacy notice alignment:** `/privacy` states that ODPC registration is **not yet confirmed** and that precise-location tracking stays disabled until registration + DPIA are done — matching the handoff's DPA preconditions. The Android side should align any in-app disclosure text with that wording.

## Evidence paths

- Release build + push log (first attempt, ended at the two regex-glitch lines above push): `s3://mireli-sgr-pilot-036834403673-db-backups-eu-north-1/mireli-sgr-pilot/database/diagnostics/release-d30cbc9.txt`, local `$env:TEMP\opencode\release-d30cbc9-log.txt`.
- Promote/gate log (healthy result): `s3://.../database/diagnostics/promote-d30cbc9.txt`, local `$env:TEMP\opencode\promote-d30cbc9-log.txt`.
- Secrets presence check (key names only): `s3://.../database/diagnostics/secrets-presence-d30cbc9.txt`, local `$env:TEMP\opencode\secrets-presence.txt`.
- Release script: `$env:TEMP\opencode\release-d30cbc9.sh`; promote script: `$env:TEMP\opencode\promote-d30cbc9.sh` (idempotent tag swap + rollback in `/etc/mireli/bootstrap.env`).
- Source archive: `s3://mireli-sgr-pilot-036834403673-db-backups-eu-north-1/mireli-sgr-pilot/database/build/mireli-src-d30cbc9.zip` (built by `git archive` from `d30cbc9`).
- Touched files: `src/app/page.tsx`, `src/app/globals.css`, `src/app/sitemap.ts`, `src/app/terms/page.tsx` (new), `src/app/privacy/page.tsx` (new), `src/components/site-chrome.tsx`, `src/components/app/shared.tsx`, `src/components/booking-sheet.tsx`, `src/components/pay-sheet.tsx`, `src/components/ui/button.tsx`, `src/components/ui/popover.tsx`, `src/components/ui/sheet.tsx`, `tests/metadata-routes.test.ts`.
