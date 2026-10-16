# Mireli VM and shared driver API handoff

Updated 16 October 2026. This guide is for the developer or agent building Mireli Driver and working on the shared API. The Android app stays in its own repository; this repository contains the shared backend and web application.

For Android API setup and flavor rules, read
[DRIVER-SHARED-BACKEND-SETUP.md](DRIVER-SHARED-BACKEND-SETUP.md) first.

## Live AWS target

- AWS project plan: Free, temporary pilot only. Region: `eu-north-1`.
- CloudFormation stack: `mireli-sgr-pilot` (`CREATE_COMPLETE`). Template: `infra/aws/mireli-vm.yaml`.
- EC2: `i-097df027e02b0708f` (Amazon Linux 2023, ARM64 `t4g.small`). EC2 status checks are `ok`; Systems Manager reports `Online`.
- Elastic IP: `13.53.183.149`.
- ECR repository: `036834403673.dkr.ecr.eu-north-1.amazonaws.com/mireli-sgr-pilot-appimagerepository-juxctzu7badb`.
- Intended public hostname: `mirelisgr.duckdns.org`; DNS has not been pointed to this VM and HTTPS has not been verified. The old DuckDNS token was exposed in a screenshot; the owner must rotate it before changing DNS.
- Security group opens only inbound TCP 80/443. Port 22 is not open. The web app binds to host loopback port 3000 behind Caddy.
- Latest SSM health check (16 October 2026): Docker, Caddy, and `mireli-app` are active; the single `mireli` container is healthy on image tag `794fb87`; `http://127.0.0.1:3000/api/health` returns `{"status":"ok"}`.
- Driver status is strict (`simulation: false`), but phone/email sign-in, registration, and navigation are closed because production provider credentials and approved drivers are absent.
- DuckDNS currently resolves to `105.161.112.67`, not the VM's EIP. HTTPS and public driver API access are unverified. Rotate the exposed token and point the A record to `13.53.183.149` before treating the site as online for customers.
- Runtime database is PostgreSQL 16 embedded in the one Mireli image and persisted on the VM volume. Daily `pg_dump` backups are sent to the private, versioned S3 bucket `mireli-sgr-pilot-036834403673-db-backups-eu-north-1`, with 30-day expiry.

The first cloud-init run failed because Amazon Linux `curl-minimal` conflicts with installing `curl`, and an unquoted heredoc expanded a database variable too early. Both issues are fixed in the template and the resolved user-data script was successfully rerun through SSM. Cloud-init still records the first run's error; the current systemd, Docker, SSM, and HTTP health checks are authoritative. Do not reset cloud-init or replace the VM to clear that historical error.

## Get a keyless shell on the VM

Use an individual AWS identity and SSM rather than sharing SSH keys. The owner must invite each developer as a team member in AWS Settings and grant the narrowest available permission to start a session on this named instance. Each developer uses their own AWS CLI profile and the Session Manager plugin:

```powershell
aws ssm start-session --target i-097df027e02b0708f --region eu-north-1 --profile mireli
```

The instance profile includes `AmazonSSMManagedInstanceCore` and the required service permissions. Do not open port 22, share the owner's profile, copy private keys to the VM, or put AWS credentials into the repository. If a developer needs a shell but cannot start a session, check their AWS project/team permissions and the SSM agent's `Online` status.

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

1. Wait for successful verification on `main` and the owner approval gate.
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

- Owner-approved stages, coordinates, fares/surcharges, and Madaraka Express timetable have been loaded. No approved catalogue has been supplied yet.
- At least one driver has been onboarded, vetted, and approved by the shared driver platform. Until then available pooled cabs remain zero and driver assignment is not a successful end-to-end flow.
- Production authentication, staff review/roles, M-Pesa collection, post-trip driver payout, SMS/email, callback reconciliation, and monitoring are configured and verified.
- The customer booking-to-trip flow passes in strict mode, including payment callback, driver match/acceptance, pickup PIN, trip completion, payout, and ledger reconciliation.
- The backup has been restored in a drill, and TLS plus passenger/driver access have been checked from outside AWS over mobile networks.
- The owner reviews Free-plan credit use and chooses a sustainable plan before the temporary credits/window expire.

Do not point DuckDNS at the VM or report the product launch-ready until the DNS token has been rotated, HTTPS and both API checks work publicly, and the booking/driver/payment gates above pass.
