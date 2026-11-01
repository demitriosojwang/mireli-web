# Mireli VM and shared driver API handoff

Updated 25 October 2026. This guide is for the developer or agent building Mireli Driver and working on the shared API. The Android app stays in its own repository; this repository contains the shared backend and web application.

The last AWS console inspection (19 October, 22:53 EAT) found the EC2 instance
running with 3/3 status checks, but reported `Managed: false`; Session
Manager's Connect action was disabled and EC2 Instance Connect reported SSH
port 22 is not authorized. The older 18 October SSM Online result is
historical. Read the
[driver VM handoff](DRIVER-AGENT-VM-HANDOFF.md) for the verified state and do
not assume a live VM shell is available.

The 25 October recovery attempt still could not query AWS: after the owner
confirmed the Chrome authorization, `aws sts get-caller-identity --profile
mireli --region eu-north-1` failed because the CLI could not connect to
`https://eu-north-1.signin.aws.amazon.com/v1/token`. This is a connection failure,
not evidence of an IAM denial; the live SSM registration and instance profile
remain unverified. The CloudFormation template declares
`AmazonSSMManagedInstanceCore` for the app instance role. No AWS changes were
made; keep port 22 closed while restoring the SSM access path.

For Android API setup and flavor rules, read
[DRIVER-SHARED-BACKEND-SETUP.md](DRIVER-SHARED-BACKEND-SETUP.md) and the focused
[driver agent VM handoff](DRIVER-AGENT-VM-HANDOFF.md) first.

## Live AWS target

- AWS project plan: Free, temporary pilot only. Region: `eu-north-1`.
- CloudFormation stack: `mireli-sgr-pilot` (`CREATE_COMPLETE`). Template: `infra/aws/mireli-vm.yaml`.
- EC2: `i-097df027e02b0708f` (Amazon Linux 2023, ARM64 `t4g.small`), running with 3/3 EC2 status checks at the 19 October 2026, 22:53 EAT browser check. The current console reports `Managed: false`; the 18 October SSM `Online` result is historical.
- Elastic IP: `13.53.183.149`.
- ECR repository: `036834403673.dkr.ecr.eu-north-1.amazonaws.com/mireli-sgr-pilot-appimagerepository-juxctzu7badb`.
- Intended public hostname: `mirelisgr.duckdns.org`; as of 18 October 2026, 13:54 EAT, public resolvers `1.1.1.1` and `8.8.8.8` still return `105.161.112.67` instead of this VM's EIP. Public HTTPS timed out at 13:49 EAT; TCP 443 on the EIP is reachable, but Caddy's local TLS handshake for the hostname fails. The old DuckDNS token was exposed in a screenshot; the owner must rotate it before changing DNS.
- Security group opens only inbound TCP 80/443. Port 22 is not open; EC2 Instance Connect specifically reports that its regional range `13.48.4.200/30` is not authorized. The web app binds to host loopback port 3000 behind Caddy.
- Previous SSM check (18 October 2026, 13:35 EAT; historical): Docker, Caddy, and `mireli-app` were active; the single `mireli` container was healthy on image tag `794fb87`; `http://127.0.0.1:3000/api/health` returned `{"status":"ok"}`. `/api/routes` reported `pointCount: 0`, `/api/trains` was empty, and `/api/stages?q=Mtwapa` returned no points. `/api/driver-supply` returned 404 on that deployed image, while that API route exists in the current source branch. This runtime has not been rechecked since the current console reported `Managed: false`.
- Driver status at 13:35 EAT is strict (`simulation: false`); phone/email sign-in, registration, and navigation are closed. The status response says driver email sign-in is not configured. The last trip-availability query (18 October, 11:25 EAT) found no eligible drivers and no trips; that query was not repeated at 13:35.
- As of 18 October 2026, 13:54 EAT, public resolvers `1.1.1.1` and `8.8.8.8` still return `105.161.112.67`, not the VM's EIP. HTTPS health/catalogue requests timed out at 13:49 EAT. TCP 443 is reachable on the EIP, but a local SNI TLS request to Caddy fails with an internal TLS alert; public driver API access is unverified. Rotate the exposed token and point the A record to `13.53.183.149` before treating the site as online for customers.
- Runtime database is PostgreSQL 16 embedded in the one Mireli image and persisted on the VM volume. Daily `pg_dump` backups are sent to the private, versioned S3 bucket `mireli-sgr-pilot-036834403673-db-backups-eu-north-1`, with 30-day expiry.

The first cloud-init run failed because Amazon Linux `curl-minimal` conflicts with installing `curl`, and an unquoted heredoc expanded a database variable too early. Both issues were fixed in the template and the resolved user-data script was successfully rerun through SSM at an earlier check. Cloud-init still records the first run's error. Those shell-based checks are historical; the current EC2 console reports `Managed: false`, and VM service health is unverified until shell access is restored. Do not reset cloud-init or replace the VM to clear that historical error.

## Restore a keyless shell on the VM

SSM is not currently verified as available: the 22:53 EAT EC2 console check
showed `Managed: false`, its SSM connection details remained loading, and
Connect was disabled. The latest AWS CLI sign-in expired before authorization,
so the live state could not be rechecked. The instance profile role is visible,
but the instance must be registered as a managed node and the profile must
allow Systems Manager. The owner should verify the attached role
includes `AmazonSSMManagedInstanceCore` (or an equivalent least-privilege
policy), that the SSM agent is running, and that the instance can reach the
regional SSM endpoints. Do not change IAM or security-group settings without
the owner approving the specific change.

When the managed node reports Online, use an individual AWS identity and SSM
rather than sharing SSH keys. The owner must invite each developer as a team
member in AWS Settings and grant the narrowest available permission to start a
session on this named instance. Each developer uses their own AWS CLI profile
and the Session Manager plugin:

```powershell
aws ssm start-session --target i-097df027e02b0708f --region eu-north-1 --profile mireli
```

Do not assume that the instance profile currently includes the required SSM
policy; confirm it in the console before attempting a session. Do not open port
22, share the owner's profile, copy private keys to the VM, or put AWS
credentials into the repository. If the owner deliberately chooses EC2 Instance
Connect instead, its documented regional source range is `13.48.4.200/30`; add
only the narrowly scoped rule after explicit approval, then remove it when no
longer needed.

## Safe VM checks

These checks do not print environment variables or credentials:

```bash
sudo systemctl status docker caddy mireli-app mireli-backup.timer --no-pager
sudo journalctl -u mireli-app -n 100 --no-pager
docker ps --filter name=mireli
curl -fsS http://127.0.0.1:3000/api/health
```

Never run `env`, print `/etc/mireli/runtime.env`, dump the full `docker inspect`, or print Secrets Manager values in a terminal transcript. The bootstrap and application secrets are read by the instance role and should remain in AWS Secrets Manager.

## Shared API contract and app ownership

- Mireli Driver calls `/api/v1/driver/*` on its configured `DRIVER_SERVICE_URL`.
- Before a pilot or production build signs in, `GET https://mirelisgr.duckdns.org/api/v1/driver/status` must return strict mode (`simulation: false`) and the app's `DRIVER_SERVICE_TEST` must be false. Staging must use an isolated demo-mode backend.
- The Android app contains a service URL only; it must not contain AWS, database, payment, messaging, or signing credentials.
- The VM hosts the API and web site, not the Android binary. Build and sign Android releases in the driver project using the owner's signing key.
- Make source changes in the correct repository, use a feature branch and PR, and do not edit deployed container files as the canonical source. The mobile developer may use SSM for inspection and approved operations; code still flows through Git review.

## Deployment workflow

`.github/workflows/verify.yml` checks the web repository and validates the AWS template. `.github/workflows/deploy-aws-vm.yml` is prepared but remains disabled until AWS/GitHub deployment configuration is complete. The deployment workflow is designed to:

1. Wait for successful verification on `main` and the owner approval gate. The
   deploy workflow serializes VM releases and skips a verified commit if it is
   no longer the current `main` head, preventing an older `workflow_run` from
   overwriting a newer release.
2. Build and push an immutable ARM64 image to the ECR URI above using GitHub OIDC.
3. Use SSM Run Command to change only `IMAGE_TAG` in `/etc/mireli/bootstrap.env` and restart `mireli-app`.
4. Check the local `/api/health` endpoint and restore the prior image tag if the new image fails its health check. Database migrations are not rolled back; review migrations and confirm backups before release.

**Current CI deployment blocker:** AWS returned an explicit service-control-policy denial for `iam:CreateOpenIDConnectProvider` on 16 October 2026. The current project permissions therefore cannot create the GitHub OIDC provider or its deploy role. The code-verification workflow is independent and can still run. Keep deployment disabled until the project owner resolves this with AWS; do not substitute long-lived AWS access keys.

The owner must configure these GitHub repository variables before enabling deploys:

- `AWS_REGION=eu-north-1`
- `AWS_DEPLOY_ROLE_ARN` (role trusted only for `repo:demitriosojwang/mireli-web:environment:production`, audience `sts.amazonaws.com`)
- `MIRELI_ECR_REPOSITORY_URI` (the repository listed above)
- `MIRELI_EC2_INSTANCE_ID=i-097df027e02b0708f`

Create a protected `production` environment with required owner reviewers and branch restrictions to `main`. Keep `MIRELI_AWS_DEPLOY_ENABLED` unset until the OIDC role, environment, instance, ECR permissions, and SSM target restrictions are verified. The workflow role must not have interactive SSM, broad EC2, or IAM permissions. Do not add AWS keys to GitHub secrets as an OIDC workaround.

## Customer and driver launch gates

The AWS VM is not a substitute for operational data. Keep bookings honest and pooled inventory empty until all applicable gates are met:

- The approved fare-sheet names and per-seat fares are integrated in `src/lib/fare-catalogue.ts`. Exact passenger-stage coordinates, route order, door-to-door surcharges, and the final Madaraka Express timetable remain unapproved and unloaded; keep production booking inventory closed until reviewed values are published.
- At least one driver must be onboarded, vetted, and approved by the shared driver platform. Until then available pooled cabs remain zero and driver assignment is not a successful end-to-end flow.
- Production authentication, staff review/roles, M-Pesa collection, post-trip driver payout, SMS/email, callback reconciliation, and monitoring must be configured and verified.
- The customer booking-to-trip flow must pass in strict mode, including payment callback, driver match/acceptance, pickup PIN, trip completion, payout, and ledger reconciliation.
- A backup restore drill must succeed, and TLS plus passenger/driver access must be checked from outside AWS over mobile networks.
- The owner should review Free-plan credit use and choose a sustainable plan before the temporary credits/window expire.

Do not point DuckDNS at the VM or report the product launch-ready until the DNS token has been rotated, HTTPS and both API checks work publicly, and the booking/driver/payment gates above pass.
