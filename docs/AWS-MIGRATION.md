# Mireli AWS pilot status and launch gates

Updated 16 October 2026. This is the current state of the AWS pilot in `eu-north-1`; it replaces the earlier RDS proposal. The pilot is not a production cutover and is not ready to accept real bookings yet.

For the shared VM and Mireli Driver handoff, see [VM-AGENT-HANDOFF.md](VM-AGENT-HANDOFF.md).

## AWS project and live resources

- AWS plan: Free, active. The owner chose to stay on the Free plan temporarily; no Paid upgrade or ongoing spend above available credits is authorized. Check the current balance in AWS Settings before extending the pilot.
- Region: `eu-north-1`.
- CloudTrail: `mireli-audit-trail` is logging multi-region management events with log-file validation enabled.
- CloudFormation stack: `mireli-sgr-pilot`, status `CREATE_COMPLETE`.
- EC2: `i-097df027e02b0708f`, `t4g.small` ARM64, Systems Manager `Online`, EC2 status checks `ok`.
- Elastic IP: `13.53.183.149`.
- ECR: `036834403673.dkr.ecr.eu-north-1.amazonaws.com/mireli-sgr-pilot-appimagerepository-juxctzu7badb`.
- Database backups: private, versioned S3 bucket `mireli-sgr-pilot-036834403673-db-backups-eu-north-1`, SSE-S3, 30-day lifecycle. A daily `mireli-backup.timer` runs `pg_dump` when the app container is running. There is no S3 server-access-log bucket in this small pilot; retain CloudTrail and add dedicated S3 access logging before a compliance review or customer-data launch.

The host runs one Mireli container containing the Next.js app and PostgreSQL 16, with persistent host volumes. Caddy and Docker are host services. The app binds to `127.0.0.1:3000`; the security group exposes only TCP 80 and 443. There is no public SSH rule. The instance profile supplies ECR pull, Secrets Manager read, S3 backup, and SSM permissions.

### Bootstrap recovery record

The first EC2 user-data run failed for two template reasons: it requested the conflicting `curl` package although Amazon Linux already has `curl-minimal`, and an unquoted backup-script heredoc expanded `POSTGRES_PASSWORD` before the service was started. Both defects are fixed in `infra/aws/mireli-vm.yaml`. The resolved script on the existing instance was repaired and rerun through SSM; Docker and Caddy are active, and `mireli-app` plus the backup timer are enabled. Cloud-init continues to report the original failed run, so use the current systemd and SSM health checks as the source of truth. Do not reset cloud-init or replace the VM just to clear that historical status.

## Customer URL and DNS

- Intended hostname: `mirelisgr.duckdns.org`.
- The DuckDNS token appeared in a screenshot shared in this project and must be treated as compromised. The owner must recreate it in DuckDNS. Do not reuse it, paste the replacement into chat, or commit it.
- DNS has **not** been changed by this pilot. After token rotation, point the DuckDNS A record to `13.53.183.149`; then verify public DNS before expecting Caddy to obtain a certificate.
- HTTPS and the public API have not been verified. Do not describe the hostname as live until `https://mirelisgr.duckdns.org/api/health` and `/api/v1/driver/status` both pass from outside AWS.

The existing driver app is configured to use the intended HTTPS hostname for non-staging builds. It will not connect successfully until DNS, Caddy TLS, and the production API are verified.

## Booking and driver launch gates

Hosting does not create routes, train services, drivers, or provider credentials. Do not fake inventory or accept incomplete bookings.

- The owner has not supplied the approved stage names, coordinates, fares/surcharges, and final SGR timetable. Production stage and train data must remain empty until the approved catalogue is loaded.
- No driver is onboarded or approved. Available pooled cabs must remain zero until the shared driver platform supplies an approved driver who can serve the active route.
- Configure and verify live passenger/driver authentication, M-Pesa collection and post-trip driver payout credentials, callbacks, email/SMS delivery, and reconciliation. Secrets belong in AWS Secrets Manager; never put them in GitHub variables, an image, or a document.
- Keep driver registration closed until authenticated staff review, role restrictions, document checks, approval/suspension, and audit history are proven.
- Verify strict mode: `/api/v1/driver/status` must report `simulation: false` and unsafe demo behavior must remain disabled.
- Run a controlled end-to-end test: passenger booking → successful payment callback → eligible driver match → driver acceptance → trip completion/PIN validation → driver payout and ledger reconciliation.
- Perform backup restoration and confirm database persistence across container restart before loading customer data.
- Sign the Mireli Driver production bundle with the owner-controlled release key and complete the Android store/release process. The VM hosts its shared API; it does not host the Android app.

## CI/CD status

- `.github/workflows/verify.yml` is the required code-verification workflow and includes application checks, Linux container build verification, and `cfn-lint` plus AWS Guard checks for `infra/aws/mireli-vm.yaml`.
- `.github/workflows/deploy-aws-vm.yml` builds and publishes an immutable ARM64 ECR image, deploys it with SSM, checks `/api/health`, and attempts to restore the prior image tag if health fails. It is deliberately gated off until AWS OIDC and GitHub settings are configured.
- On 16 October 2026, AWS explicitly denied `iam:CreateOpenIDConnectProvider` under the project service-control policy. The GitHub OIDC provider/role cannot be completed from the current AWS project permissions. Do not replace OIDC with long-lived AWS access keys; keep deploy disabled until the project owner resolves the policy with AWS.
- Configure repository variables `AWS_REGION=eu-north-1`, `AWS_DEPLOY_ROLE_ARN`, `MIRELI_ECR_REPOSITORY_URI`, and `MIRELI_EC2_INSTANCE_ID`. Configure a protected GitHub `production` environment with owner approval and `main` branch restrictions. Set `MIRELI_AWS_DEPLOY_ENABLED=true` only after this role and environment are verified.
- Scope AWS OIDC trust to `repo:demitriosojwang/mireli-web:environment:production`, audience `sts.amazonaws.com`, this ECR repository, this VM, and the deploy commands only. Do not give the workflow interactive SSM access or broad IAM/EC2 rights.
- Keep the deployment workflow disabled until those controls are configured. The bootstrap image still needs to be pushed and the VM app health check must pass before automated releases are enabled.

## Current operating checklist

- [x] Keep project on the Free plan temporarily; do not upgrade without the owner’s explicit decision.
- [x] Confirm CloudTrail is logging in the selected Region.
- [x] Provision the EC2/ECR/backup pilot stack and verify EC2 health plus SSM connectivity.
- [x] Fix the package conflict and backup heredoc defects in the VM bootstrap template; rerun setup through SSM.
- [ ] Build and push the initial ARM64 image to ECR; start `mireli-app` and verify local health through SSM.
- [ ] Rotate the DuckDNS token and point the hostname to the Elastic IP; verify DNS, TLS, and public endpoints.
- [ ] Load the owner-approved route, stage, fare, and timetable catalogue.
- [ ] Onboard at least one real driver through the shared driver platform; verify matching and acceptance.
- [ ] Configure provider credentials and callbacks; test a complete booking through post-trip payment settlement.
- [ ] Configure OIDC deploy role, repository variables, protected environment reviewers, and run the deployment workflow on an approved `main` commit.
- [ ] Run a database restore drill and assess backup/access-log monitoring before customer data is stored.
- [ ] Recheck AWS spend and choose an ongoing hosting plan before the Free-plan credits/window end.

## Infrastructure validation

`infra/aws/mireli-vm.yaml` passes `cfn-lint` 1.57.2 for `eu-north-1` and the selected official AWS Guard rules after the bootstrap fixes. The one-bucket pilot intentionally suppresses the CIS S3 server-access-logging rule to avoid creating a second log bucket; this is documented above as a follow-up control. Validation is not evidence that customer booking, payments, driver matching, TLS, or recovery has passed.
