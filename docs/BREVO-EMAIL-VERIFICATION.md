# Mireli transactional email

Updated 16 October 2026. Brevo sends driver sign-in codes and customer booking
tickets. All provider credentials stay on the AWS server.

## AWS configuration

The reviewed `infra/aws/mireli-vm.yaml` runtime loader has an explicit one-line
allowlist for these values. The existing EC2 host still needs that updated
loader deployed before the values take effect. Then add the string fields to
`MireliRuntimeSecret` in AWS Secrets Manager and restart `mireli-app` so it
refreshes the protected environment file:

- `BREVO_API_KEY`
- `BREVO_SENDER_EMAIL`
- Optional: `BREVO_SENDER_NAME` (defaults to `Mi-Reli SGR Bookings`)
- Optional: `MIRELI_SUPPORT_EMAIL` (defaults to the current company contact)

Never put these values in the Android app, Git, GitHub Actions variables, a
Docker image, terminal output, or this document. The VM reads only explicit
one-line keys from the secret and writes them to a root-owned mode-`0600` file.
The VM does not currently load multiline `MPESA_CERT` from this secret.

The sender must be verified in Brevo and transactional sending must be enabled.
For an address on Mireli's own domain, the domain owner must publish Brevo's
SPF/DKIM records and a DMARC policy, then verify the sender. The current
DuckDNS hostname is for web routing; it does not supply a Mireli mailbox or
replace control of a registered email domain.

## Customer booking ticket

`sendBookingTicketEmail` runs only after a booking is confirmed and its ledger
entry exists. It is called after both a successful Daraja confirmation and a
booking paid entirely with travel credit. Unpaid drafts and failed payments do
not send tickets.

The ticket contains the booking reference, route/direction, train, departure in
Africa/Nairobi time, pickup, seat/charter type, total, credit applied, M-Pesa
receipt when available, and assigned driver's name/plate. It does not include
national ID/passport details or the door address. It is a responsive HTML email
with a plain-text alternative.

`BookingTicketEmailDelivery` stores one row per booking. Delivery is claimed
atomically so duplicated payment callbacks do not send duplicates. Statuses:

- `blocked`: Brevo credentials are missing; configure the provider, then retry.
- `failed`: Brevo rejected the message; correct the sender/configuration and
  retry from the admin booking view once staff authentication is enabled.
- `uncertain`: the network or provider response timed out. Check Brevo's
  transactional log before retrying, to avoid a duplicate ticket.
- `sent`: Brevo accepted the ticket. Check its transactional log to confirm
  inbox delivery; an accepted API response alone is not proof it arrived.

The current AWS VM has not been configured with a Brevo API key or sender, and
the updated runtime loader has not yet been applied there. Do not open customer
bookings until a real booking test reaches a real mailbox and the delivery
state and retry handling have been verified.

## Driver email sign-in

The Android email flow uses `POST /api/v1/driver/auth/email-challenges` with
`{email}` and verifies the returned challenge through
`POST /api/v1/driver/auth/sessions`. Phone SMS uses Africa's Talking instead.
Driver email sign-in requires both `DRIVER_AUTH_SECRET` (at least 32
characters) and the Brevo variables above. Provider acceptance is not proof of
inbox delivery; confirm the real message and code before enabling a client
build.

Email codes expire after five minutes, are stored as HMAC hashes, and are
claimed atomically once. Requests are rate-limited per email and globally, with
a 60-second resend cooldown and five verification attempts. A provider failure
invalidates the challenge rather than allowing an unverified session.
