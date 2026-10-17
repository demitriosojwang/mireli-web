# Mireli Driver agent: shared VM handoff

Updated 18 October 2026. Use this when connecting the Mireli Driver Android
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

## Latest connection and VM check (18 October 2026)

- AWS CLI v2.38.1 is installed at
  `C:\Users\favou\AppData\Local\Programs\Amazon\AWSCLIV2\aws.exe`; this
  Codex shell could not access it through PATH, so commands used the explicit
  path. `aws login --profile mireli --region eu-north-1` completed. AWS CLI
  credentials are temporary; every developer must sign in with their own AWS
  identity and must not reuse this workstation's profile.
- SSM reports `i-097df027e02b0708f` `Online` on Amazon Linux with agent
  `3.3.5390.0`. Read-only SSM Run Command works. The Session Manager plugin is
  not available in this shell, so an interactive `aws ssm start-session` was
  not verified.
- Read-only checks showed Docker, Caddy, and `mireli-app` active. There is one
  healthy container named `mireli`, image tag `794fb87`, bound to
  `127.0.0.1:3000`; `/api/health` returns `{"status":"ok"}`.
- `/api/routes` returns `pointCount: 0` and a KSh 50 fee; `/api/trains` is
  empty; `/api/stages?q=Mtwapa` returns no points; and today's trip query
  returns `hasEligibleDrivers: false` with no trips. The production catalogue
  and approved driver supply are empty.
- `/api/v1/driver/status` is strict (`simulation: false`) but phone/email
  sign-in, registration, and navigation are closed. Its response says driver
  email sign-in is not configured.
- `mirelisgr.duckdns.org` resolves to `105.161.112.67`, not the VM's EIP
  `13.53.183.149`. Public DNS/TLS is not ready. Rotate the DuckDNS token that
  appeared in a screenshot before changing DNS.
- The prior SSH attempt timed out on port 22. The instance has no EC2 key pair
  and inbound SSH is intentionally closed. Do not open SSH as a workaround.
- These were read-only checks; no VM configuration, DNS, or application state
  was changed.

For another developer to use the same VM, invite them as an AWS project team
member and grant only the SSM session permissions they need. They must use
their own AWS sign-in. The VM is shared runtime infrastructure, not a shared
development checkout; coordinate deployments and avoid editing the live
container. Session Manager is the supported path. Only switch to SSH if the
owner deliberately provisions a key pair and narrowly scopes TCP 22 to the
developer's current IP.

## Connect with an individual AWS identity

The VM is an SSM managed node and reported `Online` at the last check. Each
developer must be invited as a team member in AWS Settings and granted the
narrowest permission needed to start a session on this instance. The developer
uses their own AWS sign-in/profile. AWS CLI v2 and the Session Manager plugin
are both needed for an interactive CLI session; this workstation currently has
AWS CLI v2 but is missing the plugin. Install it from the
[official AWS Session Manager plugin instructions](https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-working-with-install-plugin.html).

PowerShell commands (replace `<your-profile>` with that developer's own profile
name):

```powershell
aws sts get-caller-identity --profile <your-profile> --region eu-north-1
session-manager-plugin --version
aws ssm describe-instance-information --profile <your-profile> --region eu-north-1 --filters Key=InstanceIds,Values=i-097df027e02b0708f
aws ssm start-session --target i-097df027e02b0708f --region eu-north-1 --profile <your-profile>
```

If `start-session` returns `TargetNotConnected`, check that the caller has
session permissions, the instance still reports `Online`, and the SSM agent has
network access. Do not alter security-group ingress as a first response.

Read-only checks inside the session:

```bash
sudo systemctl is-active docker caddy mireli-app
docker ps --filter name=mireli --format '{{.Names}} {{.Image}} {{.Status}}'
curl -fsS http://127.0.0.1:3000/api/health
curl -fsS http://127.0.0.1:3000/api/v1/driver/status
```

Never run `env`, print `/etc/mireli/runtime.env`, dump full `docker inspect`, or
read Secrets Manager values in a transcript. Runtime secrets come from the VM
role and must never be copied into Android.

## Verified VM state

The read-only state above is current as of 18 October 2026. The VM is healthy
internally, but it cannot support a customer or driver pilot until its route and
train catalogue, approved drivers, driver authentication, public DNS/TLS,
payment callbacks, and passenger/driver email delivery are configured and
tested. Do not use the public URL in a production Android build until the owner
verifies DNS, HTTPS, and strict-mode status from outside AWS.

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
