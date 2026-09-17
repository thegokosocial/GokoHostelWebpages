# Email (Cloudflare Email Service)

Goko uses Cloudflare **Email Sending** (outbound) and **Email Routing** (inbound) on `gokohostel.com`.

## Addresses

| Address | Role |
|---------|------|
| `info@gokohostel.com` | Public contact on the website; sends guest auto-replies |
| `admin@gokohostel.com` | Receives staff notifications (booking enquiries, internal alerts) |

Inbound mail for both addresses forwards to `thegokosocial@gmail.com` after the destination is verified in Cloudflare.

## Outbound (website)

- Wrangler binding: `EMAIL` in `wrangler.jsonc` (`send_email`).
- `POST /api/booking-enquiry` — public JSON endpoint used by `/booking-enquiry`.
- `src/lib/email.ts` — `sendBookingEnquiryEmails()`:
  1. Staff notification: `from info@` → `admin@`, `replyTo` guest email.
  2. Guest auto-reply: `from info@` → guest email.

If the binding is missing (e.g. plain `next dev` without Wrangler), the API returns **503**.

## Inbound (routing)

Configured in Cloudflare dashboard or Wrangler:

```bash
npx wrangler email routing addresses create thegokosocial@gmail.com
# verify the inbox link Cloudflare sends

npx wrangler email routing enable gokohostel.com

npx wrangler email routing rules create gokohostel.com \
  --name "Forward admin" --match-type literal --match-field to --match-value admin@gokohostel.com \
  --action-type forward --action-value thegokosocial@gmail.com

npx wrangler email routing rules create gokohostel.com \
  --name "Forward info" --match-type literal --match-field to --match-value info@gokohostel.com \
  --action-type forward --action-value thegokosocial@gmail.com
```

Routing rules require the destination address to be **verified** first.

## Replying from Gmail

Forwarded mail arrives in `thegokosocial@gmail.com`. To reply as `info@gokohostel.com`, add **Send mail as** in Gmail → Settings → Accounts (SPF/DKIM for `gokohostel.com` is already managed by Cloudflare Email Sending).

## Limits

- Email Sending is on the Workers paid plan; beta quota is **200 emails/day** (dashboard).
- Transactional use only (enquiries, confirmations) — not marketing blasts.

## Smoke tests

```bash
npx wrangler email sending send \
  --from info@gokohostel.com \
  --to thegokosocial@gmail.com \
  --subject "Test" --text "Outbound works"
```

Send a message from an external account to `info@gokohostel.com` and confirm it appears in Gmail.
