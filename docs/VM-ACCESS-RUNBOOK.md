# VM Access Runbook — Mireli production web (mireli.online)

**Last verified in-session:** 8 November 2026 (every command below was run successfully on this date).
**Region:** `eu-north-1` — this is the project's assigned Region; all regional resources live there and cannot be moved.

---

## 1. Topology — how requests actually reach the app

```
Browser / curl (world)
   │  https://mireli.online
   ▼
Cloudflare (proxied, Strict SSL, "Always Use HTTPS")
   zone ebd776716e48413c7af1e87e2dd0c1f9
     A     @    13.53.183.149   proxied
     CNAME www  mireli.online   proxied
   ▼
EC2 instance  i-097df027e02b0708f  ("mireli-sgr-pilot-web")
   t4g.small · public IP 13.53.183.149 · Amazon Linux 2023
   inbound SG `mireli-sgr-pilot-AppSecurityGroup-kw0hxbESHjlX`:
     80/443 open to 0.0.0.0/0 — **port 22 is NOT open (no SSH)**
   ▼
Caddy (reverse proxy + ACME TLS) on :80/:443   [admin API on 127.0.0.1:2019]
   ▼
docker-proxy  127.0.0.1:3000
   ▼
Next.js container "mireli"  (image ECR repo
   036834403673.dkr.ecr.eu-north-1.amazonaws.com/mireli-sgr-pilot-appimagerepository-juxctzu7badb)
```

Because Cloudflare proxies the zone, the public IP matters only as the Cloudflare origin target; the instance itself is reached for administration through **SSM (Session Manager)** — you never SSH in.

## 2. One-time step before anything: authenticate

From any PowerShell window on the laptop:

```powershell
aws login --region eu-north-1 --profile default
```

- This opens the default browser for the social sign-in ("Trying to open your default browser...").
- Approve it; the terminal then prints
  `Updated profile default to use arn:aws:sts::036834403673:assumed-role/AccountFullAccessRole/...`
- The session **expires after roughly 24–36 h**. If any `aws` call answers
  `Your session has expired. Please reauthenticate using 'aws login'.` — just rerun the login command.
- Confirm you are in:

```powershell
aws sts get-caller-identity --query Account --output text
# → 036834403673
```

Timeout note: the `aws login` shell command can appear to "hang" after the browser approval completes; the credentials are usually written anyway. Open a new terminal and run the `sts` check — do not assume the visible command finishing is required.

## 3. Reach the VM from the AWS Console (mouse-and-browser path)

1. Open the instance page directly:
   `https://eu-north-1.console.aws.amazon.com/ec2/home?region=eu-north-1#InstanceDetails:instanceId=i-097df027e02b0708f`
2. Use the button **Connect** → **Session Manager** → **Connect**. A browser terminal opens as `ssm-user` on the instance. For commands needing root access, prefix with `sudo` (default SSM user may run most root things via sudo).
3. Quick sanity checks inside that shell:

```bash
systemctl is-active mireli-app          # "active" means the app runs
docker ps                                # shows container "mireli" + its IMAGE_TAG
curl -s http://127.0.0.1:3000/api/health # → {"status":"ok"}
```

## 4. Reach the VM by CLI (SSM Run Command — the scripted path used in every release)

Send actual work with `aws ssm send-command` + document `AWS-RunShellScript` targeting `i-097df027e02b0708f`.

**Critical gotcha (verified twice):** from PowerShell, the plugin output of
`get-command-invocation --query 'CommandPlugins[0].Output'` often comes back `None` even when the command succeeded. The reliable pattern is therefore: **tee the script output to `/tmp/<name>.txt` inside the VM, and `aws s3 cp` that file to the diagnostics prefix, then download it locally.** The instance role (`AppInstanceProfile mireli-sgr-pilot-AppInstanceProfile-dqfW7OaoQlbY`, policy `AppRuntimePolicy-apKHoOPOrgEQ`) can only write under
`s3://mireli-sgr-pilot-036834403673-db-backups-eu-north-1/mireli-sgr-pilot/database/*`.

Minimal reusable example (health check end-to-end):

```powershell
$nl = [char]10
$cmd = 'exec > >(tee /tmp/check.txt) 2>&1' + $nl +
  'systemctl is-active mireli-app' + $nl +
  'curl -s http://127.0.0.1:3000/api/health' + $nl +
  'aws s3 cp /tmp/check.txt s3://mireli-sgr-pilot-036834403673-db-backups-eu-north-1/mireli-sgr-pilot/database/diagnostics/check.txt --region eu-north-1'
$json = @{ commands = @($cmd) } | ConvertTo-Json -Depth 4
[IO.File]::WriteAllText("$env:TEMP\opencode\ssm-check.json", $json)
$resp = aws ssm send-command --region eu-north-1 --profile default `
  --document-name "AWS-RunShellScript" --instance-ids i-097df027e02b0708f `
  --timeout-seconds 300 `
  --parameters file://"$env:TEMP\opencode\ssm-check.json" --output json
$id = ($resp | ConvertFrom-Json).Command.CommandId
do { Start-Sleep 8
  $st = aws ssm get-command-invocation --region eu-north-1 --profile default `
    --command-id $id --instance-id i-097df027e02b0708f --query Status --output text
} while ($st -match "Pending|InProgress|Delayed")
"status=$st"
aws s3 cp "s3://mireli-sgr-pilot-036834403673-db-backups-eu-north-1/mireli-sgr-pilot/database/diagnostics/check.txt" "$env:TEMP\opencode\check.txt" --region eu-north-1
Get-Content "$env:TEMP\opencode\check.txt"
```

Long jobs (builds) may take 30+ minutes: set `--timeout-seconds 5400` and poll `Status` until it is no longer `Pending|InProgress|Delayed`, then fetch the diagnostic file.

## 5. Files on the VM you will touch (and one you must not read)

| Path | Purpose |
| --- | --- |
| `/etc/mireli/bootstrap.env` (root, 0600) | **Release config.** `IMAGE_TAG` (currently `d30cbc9-nov08ui`), `DRIVER_TERMS_URL=https://mireli.online/terms`, `DRIVER_PRIVACY_URL=https://mireli.online/privacy`, plus `ECR_URI`, `DB_SECRET_ARN`, `SESSION_SECRET_ARN`, `PUBLIC_HOSTNAME`, `AWS_REGION`, `BACKUP_*`. Releasing = swap `IMAGE_TAG` here and `systemctl restart mireli-app`. |
| `/etc/mireli/runtime.env` (root, 0600) | **Secrets + runtime flags.** Contains `POSTGRES_*`, `SESSION_SECRET`, `MIRELI_*`, `TZ`, `NODE_OPTIONS`. **Never cat / upload / paste contents** — check key **names only** with `grep -o "^[A-Z_]*=" /etc/mireli/runtime.env`. Today it contains no `BREVO_*`, `AT_*`, or `DARAJA_*` keys; when the owner supplies them they belong here. |
| `/mireli-swap` (2 GB swapfile) | Present and mounted — needed only so `docker build` does not OOM on the t4g.small. Safe to remove when idle: `sudo swapoff /mireli-swap && sudo rm /mireli-swap`. Re-create per the release script in §6. |
| `/tmp/mireli-build/` | Scratch build tree from the last release (safe to `rm -rf`). |

## 6. Deploy a new release (the exact procedure used on 6 & 8 Nov)

1. **Commit and push to `main`** (deploy pulls from `git archive`, so repo = source of truth).
2. **Build the source archive locally and stage it in S3** under the path the instance role can read (`database/build/`):

```powershell
git archive --format=zip --output="$env:TEMP\opencode\mireli-src-<SHA>.zip" <SHA>
aws s3 cp "$env:TEMP\opencode\mireli-src-<SHA>.zip" `
  s3://mireli-sgr-pilot-036834403673-db-backups-eu-north-1/mireli-sgr-pilot/database/build/mireli-src-<SHA>.zip `
  --region eu-north-1
```

3. **Write the release script.** Start from `$env:TEMP\opencode\release-d30cbc9.sh` (exists on this machine) and change exactly three lines: `s3uri=` (new zip), `tag=` (`<SHA>-novMMui`), and nothing else — it already: creates the 2 GB swap, logs into ECR, unzips, `docker build --target runner`, `docker push`, optionally adds new `/etc/mireli/bootstrap.env` keys, swaps `IMAGE_TAG`, `systemctl restart mireli-app`, then runs the 9-check readniness gate (health, routes `pointCount` int, trains list, stages shape, driver-supply bool, `/terms` 200, `/privacy` 200, sitemap `urlset`, pay-options gate) and **auto-rolls back to the previous tag on failure**.
4. **Send it over SSM** with the §4 pattern plus an `EXIT` trap that uploads its own log; poll to completion; download the log from `database/diagnostics/<name>.txt`. Successful tail lines look like:

```
build-ok
push-ok
Release d30cbc9-nov08ui is healthy.
```

5. **Verify from outside AWS** (public, through Cloudflare):

```
curl https://mireli.online/api/health
# {"status":"ok"}
```

## 7. Emergency actions

- **Roll back a bad release:** `sudo sed -i "s|^IMAGE_TAG=.*|IMAGE_TAG=<'old' tag>|" /etc/mireli/bootstrap.env && sudo systemctl restart mireli-app` — old images are retained in ECR, so restart-only rollback works instantly.
- **App stuck / unhealthy:** `docker ps` to see the container state, `docker logs mireli --tail 100` for the error (logs contain no secret values).
- **Full health sweep** (all gates in one go): the `app_ready()` curl block inside the release script in §6.
- **Instance down:** state `running` expected; if `stopped`, start it in the console — Cloudflare will 5xx meanwhile. Never re-create in another Region; this project is pinned to `eu-north-1`.

## 8. Standing rules (owner-agreed)

1. Regions: **only `eu-north-1`** for regional resources; Cloudflare/CloudFront-global exceptions aside, no exceptions.
2. Never print or archive secret **values** (`SESSION_SECRET`, DB passwords, API keys). Presence-only checks (`grep -o` key names) are the standard.
3. Every SSM script must tee to `/tmp` and upload to `database/diagnostics/` — SSM's own stdout is unreliable through PowerShell.
4. Release rule: new tag only after the readiness gate passes from *both* inside the VM and outside AWS; closed-state flags stay closed and no fake data is ever seeded.
