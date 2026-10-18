# Mireli Driver agent: shared VM handoff

Updated 18 October 2026, 15:02 EAT. Use this when connecting the Mireli Driver Android
project to the same backend used by Mireli Web.

## What is running

- Region: `eu-north-1`
- VM: `i-097df027e02b0708f` (`t4g.small`, ARM64, Amazon Linux)
- Public IP / Elastic IP: `13.53.183.149`
- Mireli container image repository:
  `036834403673.dkr.ecr.eu-north-1.amazonaws.com/mireli-sgr-pilot-appimagerepository-juxctzu7badb`
- Internal web/API origin: `http://127.0.0.1:3000`
- Intended public origin: `https://mirelisgr.duckdns.org` (DNS and public TLS are not ready)
- Web health: `/api/health`
- Driver API status: `/api/v1/driver/status`

The AWS access validation email confirms the EC2 access request was validated;
it does not create an SSH key or open port 22. The instance has no EC2 key pair,
and inbound SSH is intentionally closed. Use the individually authorized AWS
Systems Manager (SSM) path below. Do not share a teammate's AWS profile, open
port 22, or copy a private key to the VM.

## Latest SSM connection and VM check (18 October 2026, 15:02 EAT)

AWS authentication was verified with the `mireli` profile in account
`036834403673`. SSM reported the VM Online (agent `3.3.5390.0`). A read-only
SSM Run Command reached the VM at 15:02 EAT (command
ID `213ad552-5194-41c0-b06e-13b2a4f8e550`) and completed successfully with no
command errors. One healthy container named `mireli` runs image tag `794fb87`
(up 2 days). Fresh HTTP status checks returned:

- `/api/health`: HTTP 200; body `{"status":"ok"}`.
- `/api/routes`: HTTP 200; body reports `pointCount: 0` and a KSh 50 booking
  fee.
- `/api/trains`: HTTP 200; no trains are published.
- `/api/stages?q=Mtwapa`: HTTP 200; no points and `hasMore: false`.
- `/api/v1/driver/status`: HTTP 200, strict mode (`simulation: false`), but
  phone/email sign-in, registration, and navigation are closed. The response
  says driver email sign-in is not configured.
- `/api/driver-supply`: HTTP 404. This route exists in the current source
  branch, so the VM image is stale relative to source.
- `/api/pay/options`: HTTP 500 with an empty response body. Do not expose
  customer checkout as ready until payment configuration and signed HTTPS
  callbacks are installed and verified. Source now returns a sanitized
  unavailable response and blocks cash bookings before allocation when M-Pesa
  is not ready. Code commit `83f59b0` passed CI run
  [#39124074073](https://github.com/demitriosojwang/mireli-web/actions/runs/39124074073),
  but has not been deployed to the VM.
- `/api/trips?date=2026-10-18&direction=FROM_TERMINUS` returned no trips and
  `hasEligibleDrivers: false` in the earlier 14:20 EAT check. There are no
  approved drivers or published stops/trains, so Android sign-in and matching
  must remain closed.

EC2 reports the instance `running`, public IP `13.53.183.149`, type `t4g.small`,
and no key pair. No application, VM configuration, DNS, or other AWS resources
were changed by these checks. The SSM Run Command itself is recorded in AWS as
an audit event.

- AWS CLI v2 is installed on the operator workstation at
  `C:\Users\favou\AppData\Local\Programs\Amazon\AWSCLIV2\aws.exe`; it may
  not be on every PowerShell process's `PATH`. `aws sts get-caller-identity`
  succeeded with the `mireli` profile in `eu-north-1`. Credentials are
  temporary; every developer must use their own AWS identity and must not
  reuse this workstation's profile.
- SSM reached `i-097df027e02b0708f` on Amazon Linux 2023. The 13:21 EAT
  read-only Run Command verified
  `docker`, `caddy`, and `mireli-app` are active. There is one healthy
  container named `mireli`,
  image tag `794fb87`, serving the local API on port 3000;
  `/api/health` returns `{"status":"ok"}`. `/api/routes` reports
  `pointCount: 0` and a KSh 50 booking fee, `/api/trains` returns no trains,
  and `/api/stages?q=Mtwapa` returns no points. `/api/v1/driver/status` reports
  strict mode (`simulation: false`), with phone/email sign-in, registration,
  and navigation closed. Its message says driver email sign-in is not
  configured. The current VM image returns HTTP 404 for `/api/driver-supply`,
  although that route exists in the current source branch. The container had
  been up for 46 hours at the time of the earlier 13:04 check.
- AWS EC2 metadata confirms the instance has no key pair. A TCP check at
  11:25 EAT to `13.53.183.149:22` failed, so direct SSH is unavailable; SSM is
  the verified connection path. Do not open port 22 as a workaround.
- The VM still runs image `794fb87`. Current source revision `83f59b0` is on
  branch `codex/booking-flow-production-readiness`. Full CI passed in run
  [#39124074073](https://github.com/demitriosojwang/mireli-web/actions/runs/39124074073),
  including database validation, tests, typecheck, lint, production build,
  CloudFormation lint/Guard, and AMD64/ARM64 container builds. The feature
  branch has not been deployed. PR #4 has not been merged. GitHub still runs
  the Vercel status and Preview Comments checks on the PR (both green on the
  latest observed run); AWS is the runtime target. The AWS GitHub OIDC
  deploy workflow remains disabled while project policy denies creating the
  OIDC provider. Do not use long-lived AWS keys as a workaround. The new
  release workflow also checks route, train, stage-search, driver-supply, and
  health API contracts before declaring a deployment ready.
- The last read-only production database inspection (18 October, 11:14 EAT)
  found four applied migrations:
  `20261001_initial_postgres`, `20261006_driver_services`,
  `20261008_driver_email_auth`, and
  `20261011_booking_fee_charter_commission`. Runtime settings currently enable
  migrations at application startup. The current source branch adds three
  additive migrations (`20261016_booking_ticket_email`,
  `20261018_train_service_days`, and
  `20261018_z_durable_refund_attempts`); they are not yet applied in production.
  Review the release and backup plan before deploying the new image.
- The live API has no bookable supply: `/api/routes` reports `pointCount: 0`,
  `/api/trains` returns `{"trains":[]}`, `/api/stages?q=Mtwapa` returns no
  points, and the 18 October trip-availability query returns
  `hasEligibleDrivers: false` and no trips. No approved driver inventory is
  available; do not display invented vehicles or schedules.
- `/api/v1/driver/status` reports strict mode (`simulation: false`), but phone
  and email sign-in, registration, and navigation are closed. The response says
  driver email sign-in is not configured. Keep driver sign-in closed until real
  production authentication credentials and provider configuration are set up
  and verified.
- The 13:54 EAT DNS checks through public resolvers `1.1.1.1` and `8.8.8.8`
  still found `mirelisgr.duckdns.org` resolving to `105.161.112.67` (TTL 60),
  not the VM's EIP `13.53.183.149`. Public HTTPS requests at 13:49 EAT to
  `/api/health` and `/api/routes` timed out. TCP 443 on the EIP is reachable;
  Caddy listens on 443 and is configured for this hostname with upstream
  `127.0.0.1:3000`, but the local SNI TLS handshake fails with an internal TLS
  alert. No `.crt` file was listed under `/var/lib/caddy`. Rotate the exposed
  DuckDNS token, point its A record to the EIP, and verify the certificate and
  public API from outside AWS before using the HTTPS origin in Android. Never
  put the token in this repository or chat.

For another developer to use this VM, invite them as an AWS project team member
and grant only the SSM session permissions they need. They must sign in with
their own AWS identity. This VM is shared runtime infrastructure, not a shared
development checkout; coordinate deployments and do not edit the live container
as source. Session Manager is the supported access path. SSH would require the
owner to deliberately provision a key pair and narrowly scope port 22.

## Connect with an individual AWS identity

The VM is an SSM managed node and reported `Online` at the last check. Each
developer must be invited as a team member in AWS Settings and granted the
narrowest permission needed to start a session on this instance. The developer
uses their own AWS sign-in/profile. AWS CLI v2 and the Session Manager plugin
are both needed for an interactive CLI session. The tested operator workstation
has AWS CLI `2.38.1` and plugin `1.2.896.0`; other developers must install the
plugin themselves using the [official AWS Windows install steps](https://docs.aws.amazon.com/systems-manager/latest/userguide/install-plugin-windows.html).
The AWS CLI path recorded above is specific to this workstation; on another
machine, use that developer's own AWS CLI installation.

PowerShell commands (replace `<your-profile>` with that developer's own profile
name. Replace `$aws` with that developer's local AWS CLI path if it is not on
`PATH`):

```powershell
$aws = 'C:\Users\favou\AppData\Local\Programs\Amazon\AWSCLIV2\aws.exe'
& $aws sts get-caller-identity --profile <your-profile> --region eu-north-1
session-manager-plugin --version
& $aws ssm describe-instance-information --profile <your-profile> --region eu-north-1 --filters Key=InstanceIds,Values=i-097df027e02b0708f
& $aws ssm start-session --target i-097df027e02b0708f --region eu-north-1 --profile <your-profile>
```

If the session command says `SessionManagerPlugin is not found`, add the
plugin's installed `bin` directory to that PowerShell process's `PATH` before
retrying. For the verified workstation, run:

```powershell
$env:PATH += ';C:\Program Files\Amazon\SessionManagerPlugin\bin'
```

If `start-session` returns `TargetNotConnected`, check that the caller has
session permissions, the instance still reports `Online`, and the SSM agent has
network access. Do not alter security-group ingress as a first response.

Read-only checks inside the session:

```bash
sudo systemctl is-active docker caddy mireli-app
sudo docker ps --filter name=mireli --format '{{.Names}} {{.Image}} {{.Status}}'
curl -fsS http://127.0.0.1:3000/api/health
curl -fsS http://127.0.0.1:3000/api/v1/driver/status
```

Never run `env`, print `/etc/mireli/runtime.env`, dump full `docker inspect`, or
read Secrets Manager values in a transcript. Runtime secrets come from the VM
role and must never be copied into Android.

## Verified VM state

The read-only state above is current as of 18 October 2026, 15:02 EAT. The VM is
healthy internally, but it cannot support a customer or driver pilot until its
route and train catalogue, approved drivers, driver authentication, public
DNS/TLS, payment callbacks, and passenger/driver email delivery are configured
and tested. Do not use the public URL in a production Android build until the
owner verifies DNS, HTTPS, and strict-mode status from outside AWS.

## Android and shared-backend contract

1. Android calls the existing `/api/v1/driver/*` API. PostgreSQL, bookings,
   payments, driver identity, trips, and payouts stay owned by the web backend.
2. Keep service origin in `BuildConfig.DRIVER_SERVICE_URL`. Use the verified
   public HTTPS origin only after the owner clears the DNS/TLS gates. For local
   emulator development, use the staging flavor and the developer's local
   Docker backend at `http://10.0.2.2:3000` in demo mode. The offline `demo`
   flavor does not prove shared-backend integration.
3. Keep `DRIVER_SERVICE_TEST` aligned with backend mode: staging with an
   isolated demo backend uses `true`; pilot/production against strict mode uses
   `false`. A mode mismatch must fail closed.
4. The app may display only trips returned for the authenticated driver. Do not
   synthesize vehicles or assignments: no production driver is approved yet,
   and the API currently returns no available inventory.
5. Coordinate additive API/schema changes with Mireli Web. Do not add a second
   driver or payment database. Keep boarding credentials and passenger identity
   data out of manifests and logs.

Read the authoritative contract and build-flavor requirements in
[DRIVER-INTEGRATION.md](DRIVER-INTEGRATION.md) and
[DRIVER-SHARED-BACKEND-SETUP.md](DRIVER-SHARED-BACKEND-SETUP.md).

## Source changes and releases

The VM is runtime infrastructure, not a development checkout. Make Android
changes in the Mireli Driver repository and backend changes in this repository;
use reviewed branches/PRs, CI, and immutable images. Do not edit deployed
container files as source. Current web CI is separate from deployment: the AWS
GitHub OIDC deploy workflow remains disabled while AWS policy denies creation
of the OIDC provider. Do not add long-lived AWS keys as a workaround.

Before a customer or driver pilot, the owner must complete the DNS/TLS,
production authentication, route/timetable catalogue, driver vetting, M-Pesa,
email delivery, and callback/reconciliation gates in
[PRODUCTION-READINESS.md](PRODUCTION-READINESS.md).
