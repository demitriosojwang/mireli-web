# Alignment validation — 6 October 2026

## Current booking-flow verification — 18 October 2026

- The focused booking checks passed: 30 existing tests across stage search,
  stage API responses, zero-driver supply, trip availability, and booking
  allocation. Source commit `10a3d26` passed GitHub Actions run
  [#39117363934](https://github.com/demitriosojwang/mireli-web/actions/runs/39117363934)
  with the full test, typecheck, lint, production build, CloudFormation,
-  Compose, AMD64, and ARM64 checks. Documentation checkpoint `f7652e3`
  also passed [run #39118544935](https://github.com/demitriosojwang/mireli-web/actions/runs/39118544935).
- Read-only AWS SSM checks at 13:21 EAT found one healthy app container on
  image `794fb87`, `GET /api/health` healthy, zero published route stops, and
  no active train schedule. Driver status remains strict with sign-in closed.
  `/api/driver-supply` returns 404 on the running image, but exists in current
  source; the branch is not deployed to the VM. The SSM command returned a
  nonzero status because of this 404; its preceding service/health/catalogue
  probes succeeded.
- The page currently served at this workstation's `localhost:3000` is a stale
  local preview, not a rendering of the current source: its visible controls
  differ from `src/app/page.tsx`, and `/api/driver-supply` returns 404 there.
  Do not use that process to verify current-branch UI behavior.
- The isolated preview now converts PostgreSQL's train `Int[]` field into a
  SQLite JSON array. Prisma schema validation and client generation succeed,
  but `db push` returns a blank `Schema engine error` on this Windows host even
  with a minimal SQLite schema. No sample records were inserted. A current-source
  Next dev render at `localhost:3100` returned HTTP 200 with a deliberately
  unreachable local PostgreSQL URL. Its browser accessibility snapshot showed
  the compact booking steps, date/train controls, labelled drop-off picker, and
  retry states. Local API calls returned 503/500 because the isolated database
  was not running, so this verifies rendering only; it does not verify
  database-backed booking or the production empty-catalogue state. No sample
  drivers or routes were inserted.

## Driver services increment

- 23 unit tests, TypeScript and ESLint pass. Local HTTP checks cover verified OTP
  replay, encrypted private evidence, approval, assigned-trip commands, stale
  versions, duplicate boarding/completion, partial no-show fund hold, beneficiary
  review, simulated settlement/callback correlation, support replies and logout.
- PostgreSQL 16 test container: cofounder-schema baseline and additive migration
  applied successfully. Concurrent replay/boarding/completion and payout tests pass.
  Synthetic records are retained; this is not the Vercel production database.
- Android staging: four native emulator tests pass, including a delivered charter
  and queued KSh 1,700 settlement. No real passengers or financial movement.
  Encrypted session expiry, saved-action account isolation and tamper rejection pass.
- Full web production build passes with PostgreSQL generation, TypeScript and
  48 static-generation tasks. It uses the isolated test DB, not Vercel data.
- Instant payout HTTP completion dispatch is verified in the local simulator;
  replay still produces one transfer attempt. Queued records remain recoverable
  when dispatch is interrupted or beneficiary/configuration review defers sending.
- GitHub access to upstream is read-only; Vercel has no signed-in local session.
  Official `/api/v1/driver/status` returned 404 on 6 October 2026.

Earlier passenger alignment results follow; their driver-API limitations are
superseded by the local implementation above, not by a live deployment.

## Verified locally

- Cofounder source baseline: `687ef7a0b7e14fc97628f578dfafe15a500cd0cc`.
  Extracted source files were checked against their Git object hashes before editing.
- Original `C:\Users\user\Desktop\msafiri` was not modified. Work is in the separate
  `msafiri-web` checkout on `feat/mireli-alignment`.
- Four Vitest files / 14 tests passed: simulation boundaries, session signatures
  and claims, production authentication boundary, and Nairobi calendar handling.
- ESLint passed without disabling the React state or memoization rules.
- Final `npm run build` passed after the UI and font changes: PostgreSQL client
  generation, webpack compilation, TypeScript and all 42 static-generation tasks.
  The build used a placeholder localhost database URL and made no live connection.
- PostgreSQL Prisma schema validation and client generation passed. These checks
  do not connect to or prove compatibility with the deployed database.
- Browser test against localhost and an isolated SQLite preview: chose tomorrow,
  selected a sample stage, closed/reopened the booking form, entered synthetic
  passenger details, reserved one seat, initiated and verified a mock payment,
  and viewed the confirmed booking on My rides. Availability changed from ten to
  nine seats. No real M-Pesa request or booking was made.
- Local screenshot: `artifacts/confirmed-sample-ride.png` (ignored by Git).

## Important limits and observed follow-ups

- The preview uses synthetic SQLite data, not the claimed live Prisma Postgres
  database. PostgreSQL migration, restoration, concurrent allocation and payment
  replay tests remain required.
- Concurrent initial reads produced duplicate scheduled trip cards in the inherited
  scheduler. Its check-then-create approach needs a database uniqueness constraint
  and transactional generation before release. Existing preview records were preserved.
- A passenger gender selector emits an uncontrolled-to-controlled React warning;
  selection and booking submission worked, but this remains a UI cleanup item.
- Sample route names were adjusted in the seed to include North/South Coast so
  inherited name-based coast labels agree. The change applies on the next preview
  launch. Explicit route region fields would be more robust than name matching.
- No mobile device, production OTP, admin MFA, live payment, driver API, background
  location, Play Store submission or legal compliance validation occurred here.
- CI configuration was added but has not run on GitHub. Local runtime was Node
  26.4.0; CI targets Node 22 and must be verified independently.

See `ALIGNMENT.md` for the database reconciliation and deployment gates, and
`DRIVER-INTEGRATION.md` for how the Android app should share this backend.
