# Environment variable names

**Git-safe.** Names and what they do. **Values** live in gitignored [secrets-and-access.md](secrets-and-access.md), Mac `.env.local`, Pi `.env.local`, and Wrangler secrets. Do not paste passwords here.

Committed bindings (not env): `wrangler.jsonc` — Worker name, D1 `goko-hostel-db`, R2 `goko-media`, Email Sending `EMAIL`.

---

## Runtime / build

| Name | Where | Purpose |
|------|--------|---------|
| `GOKO_RUNTIME` | Pi `.env.local` / `build:pi` | `"pi"` → SQLite `src/db/pi.ts` |
| `NEXT_PUBLIC_GOKO_RUNTIME` | **build time** | Hide CMS/Splits nav; must match runtime |
| `SQLITE_PATH` | Pi | DB file, default `./goko.db` |
| `BUILD_VERSION` | `cf:build` / `build:pi` | git short SHA inlined |
| `OPENNEXT_CLOUDFLARE_DEV` / `NEXT_DEV_WRANGLER_ENV` | local | Load Wrangler in `next dev` (off by default) |
| `NEXTJS_ENV` | `.dev.vars` | OpenNext preview |

---

## Staff passwords (env, not DB)

| Name | Purpose |
|------|---------|
| `ADMIN_PASSWORD` | Admin bypass, Form C token, sync, Gmail sync, import/upload, Google OAuth start |
| `MANAGER_PASSWORD` | Env manager login; `permissions: {}` so **RBAC denies gated actions** |
| `SYNC_SECRET` | Optional sync auth; if unset, `ADMIN_PASSWORD` still works |

DB staff: `users.password_hash` = SHA-256(password + `goko-salt-2026`). Kitchen accepts env admin/manager **or any DB hash** (no username).

---

## Google

| Name | Purpose |
|------|---------|
| `GOOGLE_SERVICE_ACCOUNT_KEY` | Vision JSON |
| `GOOGLE_DRIVE_FOLDER_ID` | Root Drive folder for IDs + bills |
| `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` / `GOOGLE_OAUTH_REFRESH_TOKEN` | Drive + Gmail desktop OAuth |
| `GOOGLE_WEB_CLIENT_ID` / `GOOGLE_WEB_CLIENT_SECRET` | `/api/auth/google/*` web OAuth (often unset on Mac) |

---

## Cloudflare HTTP (scripts / seed, not the Worker binding)

| Name | Purpose |
|------|---------|
| `CLOUDFLARE_ACCOUNT_ID` | D1 HTTP API |
| `CLOUDFLARE_DATABASE_ID` | D1 UUID (also in `wrangler.jsonc`) |
| `CLOUDFLARE_D1_TOKEN` | Token for seed/scripts |

Worker itself uses bindings `DB` and `EMAIL`, not these HTTP vars. Email flow: [flows-email.md](flows-email.md).

---

## Pi ↔ Cloudflare

| Name | Purpose |
|------|---------|
| `PI_PUBLIC_URL` | Worker → Pi (tunnel URL) |
| `CLOUDFLARE_SITE_URL` | Pi → production site, default `https://www.gokohostel.com` |

---

## Other

| Name | Purpose |
|------|---------|
| `GITHUB_TOKEN` / `GITHUB_REPO` | Rate-scrape workflow dispatch (Worker). GitHub Actions also needs repo secrets `API_URL` + `API_PASSWORD` (= `ADMIN_PASSWORD`) so the scraper can write `rate_scrapes` |
| `VAPID_PRIVATE_KEY` / `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | Web push; no-op if unset |
| `CRON_SECRET` | Protects the internal scheduled reconciliation-reminder endpoint |
| `ANALYZE` | `npm run analyze` bundle |
| `GOKO_NATIVE_HOLD_INTERNAL_ENABLED` | Worker | `"true"` enables internal hold/quote creation (required for guest checkout) |
| `GOKO_NATIVE_GUEST_CHECKOUT_ENABLED` | Worker | `"true"` enables public `/api/guest-booking/checkout` when readiness passes |
| `RAZORPAY_TEST_KEY_ID` / `RAZORPAY_TEST_KEY_SECRET` | Worker secrets | Test-mode Razorpay API (must be `rzp_test_*`) |
| `RAZORPAY_TEST_WEBHOOK_SECRET` (+ optional `_PREVIOUS`) | Worker secrets | Test webhook HMAC |
| `RAZORPAY_TEST_ACCOUNT_ID` | optional | Reject webhooks from other Razorpay accounts |
| `RAZORPAY_TEST_PREVIEW_ENABLED` | Worker | Admin ₹1 preview panel new orders/claims |
| `RAZORPAY_LIVE_KEY_ID` / `RAZORPAY_LIVE_KEY_SECRET` / `RAZORPAY_LIVE_WEBHOOK_SECRET` (+ optional `_PREVIOUS`) | Worker secrets | Live guest checkout when Booking Settings `gatewayEnvironment=live` |
| `RAZORPAY_LIVE_ACCOUNT_ID` | optional | Reject webhooks from other Razorpay accounts in live |
| `GUEST_BOOKING_LOOKUP_SECRET` | Worker (≥32 chars) | OTP hashing for My booking lookup |
| `GOKO_BOOKING_UI_PREVIEW` | local | Enables `/book/preview` (404 when unset) |

Aiosell **production** hotel/password/webhook sit in D1 `channel_config`, not env. Sandbox UI defaults are in `src/lib/aiosell.ts` (already in git).

---

## Settings keys (D1 `settings` table)

Not env. Synced subset and Kannada drift: [data-model.md](data-model.md). Food keys: [flows-food-kitchen.md](flows-food-kitchen.md). Failover: `failover_enabled`, `pi_local_url`. Reviews: `review_google_url`. Booking tax: `booking_tax_rate` (default 5; **`0` is 0%** — `bookingTaxPercent`, never `Number(x) || 5`). Apply toggles `booking_tax_apply_website` / `booking_tax_apply_admin` (absent → on). When a toggle is off, that path uses 0% even if the rate is set. Same 0%-is-real rule for `food_tax_rate` (`foodTaxPercent`).
