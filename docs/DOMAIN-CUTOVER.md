# Mireli.online domain cutover

Updated 1 November 2026. The production origin changes from the legacy
`mirelisgr.duckdns.org` to the owner-registered `mireli.online` (Namecheap).
The legacy DuckDNS hostname is retired; its token was previously exposed and
must not be reused.

- VM (unchanged): `i-097df027e02b0708f`, Elastic IP `13.53.183.149`, `eu-north-1`.
- Public target: `https://mireli.online` with `https://www.mireli.online`
  redirected to the apex.
- TLS: Caddy on the VM issues and automatically renews Let's Encrypt
  certificates per hostname once public DNS resolves to the EIP. No manual
  certificate handling is required.

## 1. Namecheap DNS records (owner action)

In the Namecheap dashboard → Domain List → `mireli.online` → **Advanced DNS**:

| Type | Host | Value | TTL |
| ---- | ---- | ----- | --- |
| A Record | `@` | `13.53.183.149` | Automatic (or 5 min) |
| CNAME Record | `www` | `mireli.online.` | Automatic (or 5 min) |

Delete the Namecheap parking/parkingpage records for `@` and `www` first.
Verify from a workstation:

```powershell
Resolve-DnsName mireli.online -Server 1.1.1.1 -Type A   # expect 13.53.183.149
Resolve-DnsName www.mireli.online -Server 1.1.1.1 -Type CNAME | Select NameHost # expect mireli.online
```

## 2. VM host configuration (deployer action, via SSM)

Before or immediately after DNS cutover, on the VM (root, via SSM session;
never print `bootstrap.env`/`runtime.env` values):

1. Update `/etc/caddy/Caddyfile` so the site block serves both hostnames and
   redirects `www` to the apex, keeping the same upstream and headers:

   ```
   mireli.online {
     encode zstd gzip
     header {
       X-Content-Type-Options nosniff
       Referrer-Policy strict-origin-when-cross-origin
       X-Frame-Options DENY
     }
     reverse_proxy 127.0.0.1:3000
   }

   www.mireli.online {
     encode zstd gzip
     redir https://mireli.online{uri} permanent
   }
   ```

   Back up the previous file first; run `caddy validate --config
   /etc/caddy/Caddyfile` before `systemctl reload caddy`; restore the backup if
   validation or a reload fails.

2. Change `MIRELI_PUBLIC_ORIGIN` in `/etc/mireli/bootstrap.env` to
   `https://mireli.online` (keep quoting style; leave every other line
   untouched), then `systemctl restart mireli-app`.

3. The legacy DuckDNS block should be removed from the Caddyfile only after
   `https://mireli.online/api/health` passes publicly.

## 3. Post-cutover verification (public, from outside AWS)

- `https://mireli.online/api/health` → `{"status":"ok"}` with a valid
  certificate for `mireli.online`.
- `https://www.mireli.online` → 301 to the apex.
- `/sitemap.xml` lists `https://mireli.online/`; `/robots.txt` references the
  same origin and keeps `/admin`, `/api`, `/bookings`, `/credits`, `/login`
  disallowed; the favicon resolves.
- Check both endpoints again over a mobile network before telling customers.

## 4. Search engines and downstream consumers

- Submit `https://mireli.online/sitemap.xml` in Google Search Console
  (domain/property verification is an owner choice); do not submit while still
  serving another hostname.
- Re-register Safaricom Daraja callback URLs
  (`/api/pay/mpesa/callback`, `/timeout`, `/c2b`, `/b2c/result`) with the new
  origin when live payment credentials are configured; the callback base is
  the stable public HTTPS origin.
- Update any parked bookmarks/copy that still references the Vercel URL or
  DuckDNS hostname; Vercel is retired as a hosting target — AWS EC2 is the
  only runtime (see `docs/AWS-MIGRATION.md`).
