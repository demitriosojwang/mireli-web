# Mireli handoff — web backend cleared, driver sign-in live (11 November 2026)

From the Mireli Web agent to the Mireli Driver (Android) agent.
Supersedes the 10 November handoff: the sign-in blocker is **cleared**. Everything below was
verified against the live VM on 11 November 2026.

## 1. State of the service (verified 11 November 2026)

```
GET https://mireli.online/api/health            -> 200 {"status":"ok"}
GET https://mireli.online/api/v1/driver/status -> 200
{"apiVersion":"v1","simulation":false,"phoneSignInOpen":false,"emailSignInOpen":true,
 "registrationOpen":false,"navigationOpen":false,"supportEmail":"mirelisgr001@gmail.com",
 "message":"Existing drivers can sign in. New driver applications are paused."}
```

- `emailSignInOpen: true` — the 10 November blocker is resolved. No Android rebuild needed:
  the pilot build (0.9.3, version code 15) already renders this state correctly.
- `registrationOpen` is still false **by design** (separate work, see section 4).
- Service: systemd unit `mireli-app` on EC2 `i-097df027e02b0708f` (EIP 13.53.183.149,
  eu-north-1), Cloudflare proxied -> Caddy -> 127.0.0.1:3000. Deployed image tag
  `d30cbc9-nov08ui` (locally built, no registry digest).

## 2. What was wrong and what was fixed

- `MireliRuntimeSecret` (Secrets Manager,
  `arn:aws:secretsmanager:eu-north-1:036834403673:secret:MireliRuntimeSecret-ZFKumq6omzVM-ynOsf3`)
  contained only the three POSTGRES keys. The Brevo and driver-auth values existed only in the
  retired Vercel project.
- Fixed by merging four keys into the existing secret object (nothing was replaced):
  `BREVO_API_KEY`, `BREVO_SENDER_EMAIL` (mirelisgr001@gmail.com), `BREVO_SENDER_NAME`
  ("Mi-Reli SGR Bookings"), and `DRIVER_AUTH_SECRET` (48-char alphanumeric, distinct from
  `SESSION_SECRET`).
- The live `/usr/local/bin/mireli-start` allowlist already contained `BREVO_API_KEY` and
  `DRIVER_AUTH_SECRET` (verified by grep, count 1 each). No script change was needed.
- One restart failure occurred and was fixed: the first secret write carried a UTF-8 BOM,
  which broke `jq` parsing in `mireli-start` (service crash-looped with `jq: parse error`).
  Rewrote the JSON without BOM, re-put, restarted clean.

## 3. How to operate the VM (SSM, no SSH)

Port 22 is closed. All access is through AWS SSM Run Command as the VM owner. From a machine
with an admin AWS session (`aws login`):

```bash
# Read-only checks (safe, no approval needed)
aws ssm send-command --instance-ids i-097df027e02b0708f \
  --document-name "AWS-RunShellScript" --comment "checks" \
  --parameters "file://<params.json>" --query "Command.CommandId" --output text

aws ssm get-command-invocation --command-id <ID> --instance-id i-097df027e02b0708f \
  --query "{status:Status,stdout:StandardOutputContent,stderr:StandardErrorContent}" --output json
```

- `params.json` format: `{"commands": ["sudo systemctl status mireli-app", ...]}`.
- On Windows/PowerShell, write params files with `[IO.File]::WriteAllText` and UTF-8 **without
  BOM**; a BOM breaks `jq` when the same technique is used on secret JSON.
- Useful commands inside the VM:
  - `sudo systemctl is-active mireli-app`
  - `curl -fsS http://127.0.0.1:3000/api/health`
  - `curl -fsS http://127.0.0.1:3000/api/v1/driver/status`
  - `sudo journalctl -u mireli-app -n 60`
  - `sudo docker ps -a` / `sudo docker inspect mireli`
- Never print secret values, `/etc/mireli/runtime.env`, or `/etc/mireli/bootstrap.env`.
- The VM's instance role can **read** but not **write** the runtime secret. Secret writes go
  through the admin session (`aws secretsmanager put-secret-value`), merged into the existing
  JSON object — never replace the object, or POSTGRES credentials are lost.
- AWS session expiry: `aws login` re-authenticates via browser. The 15-minute credential
  rotation can drop mid-task; just re-run `aws login`.

## 4. What is still closed (deliberate, not regressions)

- **Registration** needs `DRIVER_ONBOARDING_ENABLED=true`, `STAFF_AUTH_SECRET` (32+),
  `STAFF_MFA_ENCRYPTION_KEY`, `MIRELI_STAFF_EMAILS`, `DRIVER_SCAN_MODE`,
  `DRIVER_DOCUMENT_BUCKET`, `DRIVER_POLICY_VERSION`, HTTPS `DRIVER_PRIVACY_URL` and
  `DRIVER_TERMS_URL`, and reviewed staff auth/audit.
- **In-app routing** needs `VALHALLA_URL` and `VALHALLA_API_TOKEN`.
- **Payments** stay closed until Daraja collection, callbacks and a verified B2C beneficiary
  are proven.

## 5. End-to-end sign-in proof still to run

The backend gate is open but the full email-code flow has not been exercised end to end yet.
From an owner-controlled address, against the live origin:

1. `POST /api/v1/driver/auth/email-challenges` -> expect `challengeId` + `cooldownSeconds`,
   no code in the response.
2. Confirm the email lands in the real inbox (Brevo log alone is not proof).
3. `POST /api/v1/driver/auth/sessions` with the code -> expect `token`, `expiresAt`,
   `simulation: false`.
4. Replay the same `challengeId` + code -> rejected.
5. `DELETE /api/v1/driver/session`, then confirm the token is refused by `GET /me`.

If any step fails, capture the driver-facing error code — Android should map it.

## 6. CI/CD status

- `verify.yml` runs on every push: tests, typecheck, lint, build, container builds (AMD64 +
  ARM64), CloudFormation lint + CIS Guard.
- `deploy-aws-vm.yml` triggers only after verify succeeds on main, builds the ARM64 image,
  pushes to ECR, deploys via SSM with API readiness checks and automatic rollback.
- The deploy gate is the repo variable `MIRELI_AWS_DEPLOY_ENABLED` (must be `true`) plus an
  OIDC deploy role (`AWS_DEPLOY_ROLE_ARN`). These live in GitHub repo settings; verify them
  before expecting auto-deploys.
- Note: the currently running image (`d30cbc9-nov08ui`) predates this pipeline; the next
  verified push to main will replace it.

## 7. PWA icon fix (this repo, uncommitted)

The install icon showed an old train illustration instead of the current Mireli "M" logo.
All five files in `public/icons/` were regenerated from `public/mireli-logo.jpeg`:
`icon-192.png`, `icon-512.png`, `icon-maskable-192.png`, `icon-maskable-512.png`,
`apple-touch-icon.png` (180px). Maskable variants place the logo inside the 80% safe zone.
Manifest (`src/app/manifest.ts`) and layout icons were already correct — only the PNGs were
stale. Users who already installed the PWA may need to re-install (or clear the app
registration) to see the new icon; Android caches install icons aggressively.
