# Mireli Driver agent: shared VM handoff

Updated 16 October 2026. Use this when connecting the Mireli Driver Android
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

## Latest connection check after EC2 access validation (16 October 2026)

- AWS CLI authentication succeeded for the Mireli project in `eu-north-1`.
- EC2 reports this instance as `running`, at `13.53.183.149`, with no key pair
  (`KeyName` is unset), and instance profile
  `mireli-sgr-pilot-AppInstanceProfile-dqfW7OaoQlbY`.
- The one SSH attempt from the development workstation to
  `ec2-user@13.53.183.149` timed out on port 22. This is a network-path timeout,
  not a rejected SSH key. The validation email did not change the instance key
  pair or SSH ingress.
- SSM reports the instance `Online` on Amazon Linux 2023, agent `3.3.5390.0`;
  the last heartbeat returned by AWS was 16 October at 21:38 East Africa Time.
- This workstation does not have `session-manager-plugin`, so an interactive
  CLI session was not opened. Use the AWS Management Console's Session Manager
  for a browser terminal, or install the official plugin before running
  `aws ssm start-session`. Read-only SSM Run Command health checks succeeded
  earlier on 16 October; no application or host changes were made in this
  connection attempt.

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

On 16 October 2026, read-only SSM Run Command checks succeeded. Docker, Caddy,
and `mireli-app` were active. The single Mireli container was healthy on image
tag `794fb87`; `/api/health` returned `{"status":"ok"}`. Driver status returned
strict mode (`simulation: false`), while phone sign-in, email sign-in,
registration, and navigation were all closed. The interactive CLI shell could
not start from the current workstation because its Session Manager plugin is
not installed; SSM Run Command itself worked.

The public hostname still resolves to an old IP, not the VM's EIP, and public
TLS has not been verified. The DuckDNS token previously shown in a screenshot
must be rotated by the owner before DNS is changed. Do not use the public URL in
a production Android build until the owner verifies DNS, HTTPS, and strict-mode
status from outside AWS.

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
