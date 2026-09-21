# Daily maintain / modify / deploy

**Git-safe.** Commands without passwords. Values: [secrets-and-access.md](secrets-and-access.md). Live stamps: `MAINTAINER.local.md`. After you change the product, update `docs/` (rule `goko-local-docs`).

Project-wide agent rule: [`AGENTS.md`](../AGENTS.md). It applies to every chat/agent working in this repository and requires code, permission maps, tests, and matching handbook pages to be updated in the same turn.

### Error diagnostics

When staff report a failure, collect the copyable Goko Error Report, especially its `Request ID`, action, endpoint, status, error code, and stage. Search Management → Logs by request ID, then use the PMS/channel log for full Aiosell request/response details when the stage is a PMS operation. Reports are sanitized for sharing: never request or paste passwords, tokens, identity-document contents, or payment credentials. A friendly message may say a local write completed while a PMS sync failed; use the indicated retry action rather than repeating an unsafe mutation.

## Permission and page maintenance

The permission system has two levels: a page/tab entry permission and separate action permissions inside that page. Never document a page as merely “view” when it also has mutations.

| Source / document | Responsibility |
|---|---|
| `src/lib/permissionCatalog.ts` | Single active permission catalog used by Management → Users |
| `src/lib/actionPermissions.ts` | Shared admin bypass and compatibility aliases |
| `src/lib/adminNav.ts` | Top-level admin page gates |
| `src/components/admin/AdminManagement.tsx` | Management tab gates |
| `src/app/api/admin/**/route.ts` | Server-side action enforcement; security-critical |
| `docs/pages-and-ui.md` | Page/tab → view and action permission matrix |
| `docs/auth-rbac.md` | Full authentication and API action RBAC matrix |
| `docs/api-map.md` | Route and action inventory |
| `docs/permission-debt.md` | Retired keys and compatibility cleanup dates |

Current menu permissions are `canViewMenu`, `canManageMenuCategories`, `canManageMenuItems`, `canToggleMenuAvailability`, `canManageInventory`, and `canManageFoodSettings`. Timeline viewing uses `canViewTimeline`; assign/change/unassign, checkout, and mark-clean remain separate operations using `canAssignBed`, `canCheckout`, and `canMarkClean`. Admin bypasses all maps. Existing compatibility fallbacks are intentional and must be preserved unless explicitly removed.

When a page or action changes, update the source catalog/map, the UI gate, focused RBAC tests, and the matching handbook tables in the same turn. Run `npx vitest run`, `npx tsc --noEmit`, `git diff --check`, and `npm run build` for RBAC/API/UI changes.

**Expense and receivables schema:** `0054_expense_date.sql` added the accounting date for expenses. Repository migrations `0066_gateway_receivables.sql`, `0067_account_activity_indexes.sql`, and `0068_gateway_settlement_allocations.sql` add provider fee evidence, website payout allocations, and account/date indexes; these repository changes do not imply the migrations have been applied remotely. Production Worker rollout remains through the configured Workers Build; verify the live stamp in `MAINTAINER.local.md` after deployment.

---

## Local dev

```bash
cd /Users/pawandhiran/Downloads/GokoWeb
npm install
npm run dev                 # http://localhost:3000
# login /admin — password in secrets-and-access.md
```

`.env.local` is already on this Mac (Google + admin + D1 token). Do not run `next build` / `deploy:cf` in this checkout while `next dev` is running (shared `.next`). Use `npm run dev:clean` if chunks go missing.

```bash
npm test
npx tsc --noEmit
npm run lint
```

OpenNext preview (Workers runtime locally) needs `.dev.vars` from `.dev.vars.example`:

```bash
cp .dev.vars.example .dev.vars
npm run preview:cf
```

---

## Change the code (normal loop)

1. Edit `src/` (and `migrations/NNNN_name.sql` + `src/db/schema.ts` if schema).
2. `npm test` for auth/stock/CMS/PMS; `npx tsc --noEmit`.
3. Commit on `main` if you want history. GitHub CI tests/lints/`next build` and **does not ship**. Cloudflare **Workers Builds** on `goko-hostel-latest-webpage` **does** ship on push to `main` (`npm run cf:build` then `npx wrangler deploy`). Run `npx tsc --noEmit` first — a type error aborts that build (seen `4e62b55a` / `5b466f0`: `mode` used before assigned).
4. Local Wrangler from a **worktree** (below) still works if Builds is red or you need a stamp without waiting.
5. If new SQL: `CI=true npm run db:migrate:prod` around the same time.
6. If Pi should get ops changes: pull/build on Pi (`npm run db:migrate:pi` skips CMS `0035` and splits `0041`; it **does** apply stay-payment `0042`).

Do **not** run `drizzle-kit generate` expecting production SQL. Write `migrations/` by hand.

### Analytics

Analytics is a lazy-loaded Management sub-tab at `/admin?section=management&tab=analytics`. It uses the read-only `POST /api/admin/analytics` endpoint. Admins and all authenticated managers can open it; Beds and Timeline remain separate sections, so their assignment and redirect flows are not part of Analytics.

The dashboard has a switchable unified daily trend for bookings, arrivals, booked stay value, food sales, expenses, and occupancy, followed by booking creation weekday/hour heatmaps, actual check-in/checkout hours, booking window, channel/end-point mix, prepaid/postpaid/partial/unknown mix, stay and room-type mix (including single, double, dorm/bed, and other classifications with stays, guests, nights, booked value, and ADR), assigned bed occupancy/availability, food timing/items/categories/guest type/payment method, and expense categories/months. Daily averages use only the selected elapsed days, with completed bookings and obtained room revenue shown separately from received bookings and expected booked room value. Stay/food refunds and discounts are also shown; refund totals use their issued/receipt date, while discounts use the booking/order recorded range because no separate discount-event timestamp is stored. The room-revenue outlook uses non-cancelled bookings received by the report end date. It is intentionally combined across properties because food orders and expenses are not property-tagged.

Analytics uses IST boundaries, separate received-date and stay-date lenses, server-side SQL aggregation, a dependency-free SVG chart UI, bounded 366-day ranges, and CSV export. The management and review analytics layouts adapt their cards, filters, summaries, and charts to narrow screens; dense heatmaps and tables scroll within their own panels without widening the page. “Booked stay value” is prorated by overlapping nights; ADR is booked value per occupied bed-night; RevPAR is booked value per available bed-night; “Activity balance” is not cash flow, profit, or accrual revenue. Occupancy is based on current bed inventory plus assigned bed history; date-specific bed blocks are included when the table exists.

Bulk availability is managed from Management → Rates → Bulk Update → Availability. It changes only the default OTA/PMS remaining-inventory override for selected dorms/rooms and dates; it does not block physical beds or alter bookings, assignments, check-ins, rates, or restrictions. Set values are capped to the night’s safe availability so assigned online beds and unassigned OTA holds remain protected. Mapped rooms trigger one consolidated PMS inventory push; unmapped rooms are local-only, and failed or unaccepted pushes remain retryable through the modal and durable dirty inventory tracking. Bulk writes use bounded D1 batches, persist dirty rows before the request waits on the PMS call, and use a 15-second outbound timeout; a protected five-minute cron retries rows left dirty. Dirty-row cleanup is performed in bind-safe batches after an accepted push, so large full-sync queues do not fail on SQLite/D1 variable limits. If remote acceptance succeeds but local cleanup fails, the push remains successful and cleanup stays retryable. The modal reports `Updating…`, then the actual PMS acceptance; on failure it keeps the modal open with `Saved locally, but PMS sync failed` and a PMS-only retry. Block, unblock, Set Rates, Adjust Rates, and Restrictions use the same acceptance and retry behavior. Inventory `offline` means walk-in sales allocation; it is separate from the Cloud/Pi connectivity badge.

The dashboard follows common hotel/hostel PMS reporting patterns: occupancy, ADR, RevPAR, booking window, daily demand trends, channel performance, and separate accommodation/F&B revenue. Keep the timestamp indexes in `schema.ts` and `migrations/0048_analytics_indexes.sql` aligned. Do not add property filters until food orders and expenses have a trustworthy property dimension.

---

## Deploy production Worker

Dashboard Workers Builds ships `main` automatically. Local Wrangler from a worktree is the fallback:

```bash
git worktree add /tmp/goko-cf-deploy HEAD
cd /tmp/goko-cf-deploy
npm ci
npm run deploy:cf          # opennextjs-cloudflare build && deploy
cd /Users/pawandhiran/Downloads/GokoWeb
git worktree remove /tmp/goko-cf-deploy --force
```

Worker: `goko-hostel-latest-webpage` (`wrangler.jsonc`). Account ID: secrets file / `wrangler whoami`.

```bash
npx wrangler whoami
npx wrangler deployments list
npx wrangler secret list
```

After deploy, spot-check:

- https://www.gokohostel.com/
- https://www.gokohostel.com/events
- https://www.gokohostel.com/community-area
- https://www.gokohostel.com/admin (password in secrets-and-access.md)

`/events` and `/community-area` must stay static (`x-nextjs-prerender: 1`). A **1102** means something SSR’d those pages.

---

## D1 migrations

```bash
npx wrangler d1 migrations list goko-hostel-db --remote
CI=true npm run db:migrate:prod
npx wrangler d1 execute goko-hostel-db --remote --command "SELECT name FROM d1_migrations ORDER BY name"
```

If Wrangler says pending but the column already exists: **stamp**, do not re-ALTER. Example:

```bash
npx wrangler d1 execute goko-hostel-db --remote --command "PRAGMA table_info(the_table)"
npx wrangler d1 execute goko-hostel-db --remote --command "INSERT INTO d1_migrations (name, applied_at) VALUES ('00XX_name.sql', datetime('now'))"
```

**Trigger migrations (`0059`, `0060`):** `wrangler d1 migrations apply --remote` can fail with `incomplete input: SQLITE_ERROR` because D1’s remote `/query` splitter mishandles `CREATE TRIGGER … BEGIN …; … END;` bodies. The SQL is valid — apply each file with the import path, then stamp:

```bash
npx wrangler d1 execute goko-hostel-db --remote --file migrations/0059_native_inventory_hold_primitive.sql
npx wrangler d1 execute goko-hostel-db --remote --command "INSERT INTO d1_migrations (name, applied_at) VALUES ('0059_native_inventory_hold_primitive.sql', datetime('now'))"
```

Repeat per file. Keep `migrations/*.sql` LF (`/.gitattributes`). `0061_guest_booking_lookup.sql` applies normally via `migrations apply`.

Local Wrangler D1: `npm run db:migrate:local`.

D1 HTTP from this Mac (seed/scripts): set `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_DATABASE_ID`, `CLOUDFLARE_D1_TOKEN` from [secrets-and-access.md](secrets-and-access.md). Do not put the token in git.

---

## R2 (CMS images)

Bucket `goko-media`, binding `MEDIA`. Do not strip `r2_buckets` on deploy.

```bash
npx wrangler r2 bucket list
npx wrangler r2 object put goko-media/events/example.jpg --file ./example.jpg --content-type image/jpeg --remote
```

CLI defaults to **local** R2 unless `--remote`.

Staff: `/admin` → Management → Website → JPEG upload. Public GET: `/api/media/{key}`.

If deploy fails with **10042**, enable R2 in the dashboard first.

---

## Raspberry Pi update

Prefer tunnel, not LAN:

```bash
# SSH credentials: secrets-and-access.md (LAN only; prefer tunnel)
ssh goko@goko-server.local
cd /home/goko/goko-web
git pull origin main
npm install                   # if lockfile changed
npm run db:migrate:pi
npm run build:pi
pm2 restart goko
```

Or Management → Server Sync → Deploy Now (if that path is healthy).

Seed Pi from D1 once:

```bash
# Tokens from secrets-and-access.md
CLOUDFLARE_ACCOUNT_ID=... \
CLOUDFLARE_D1_TOKEN=... \
CLOUDFLARE_DATABASE_ID=... \
  npm run seed:pi
```

Mac backup of Pi:

```bash
bash scripts/backup-pi.sh
# PI_PASS from secrets-and-access.md  →  ~/goko-pi-backups/YYYY-MM-DD/
```

---

## Rotate admin password

1. `npx wrangler secret put ADMIN_PASSWORD` → new value.
2. Pi `.env.local` `ADMIN_PASSWORD=`.
3. Mac `.env.local`.
4. This handbook `docs/secrets-and-access.md`.
5. `MAINTAINER.local.md` if it quotes the password.
6. Anyone using kitchen/admin on phones.

DB users are independent (hashed). Env admin is the break-glass account.

---

## Add a feature (where to put code)

| Kind | Put it here |
|------|-------------|
| Admin UI tab | `src/components/admin/`, lazy import in `admin/page.tsx` or `AdminManagement.tsx` |
| Admin API action | existing `src/app/api/admin/*/route.ts` `action` switch, plus permission key |
| Guest page | `src/app/<path>/page.tsx` |
| Marketing | `src/app/(marketing)/`, keep `force-static` |
| Query | `src/db/queries.ts` |
| Table | `schema.ts` + `migrations/` |
| CMS | Cloudflare only; never add to `syncEngine` table lists |
| Money | paise integers except bookings (rupees) |

Conventions: [conventions.md](conventions.md).

---

## Gotchas (will waste your day)

1. `.next` clash — worktree for deploy.
2. Stamp D1 instead of re-ALTER.
3. Empty CMS (0 rows) is empty, not seed fallback. Throw → seed.
4. Env manager cannot pass RBAC gates (`permissions: {}`).
5. `db.transaction()` + `getDb()` inside = food-order 500s.
6. `drizzle-kit generate` ≠ Wrangler `migrations/`.
7. Pi hostname live `goko-server`, setup script says `goko`.
8. Form C fallback secret if `ADMIN_PASSWORD` unset.
9. R2 GET always JPEG.
10. GitHub CI `next build` is not a Worker deploy.
