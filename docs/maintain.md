# Daily maintain / modify / deploy

**Git-safe.** Commands without passwords. Values: [secrets-and-access.md](secrets-and-access.md). Live stamps: `MAINTAINER.local.md`. After you change the product, update `docs/` (rule `goko-local-docs`).

Project-wide agent rule: [`AGENTS.md`](../AGENTS.md). It applies to every chat/agent working in this repository and requires code, permission maps, tests, and matching handbook pages to be updated in the same turn.

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

**Current schema line:** migrations `0047_daily_ledger_opening_adjusted.sql` and `0048_analytics_indexes.sql` are applied on the remote D1 as of 11 Sep 2026. `0048` adds timestamp indexes for booking and expense analytics. The repository’s latest migration is `0048_analytics_indexes.sql`; apply new migrations to D1 before using their dependent code in production. Analytics implementation commit `5b9d49b` is pushed to `main`; production Worker rollout is through the configured Workers Build.

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

Analytics uses IST boundaries, separate received-date and stay-date lenses, server-side SQL aggregation, a dependency-free SVG chart UI, bounded 366-day ranges, and CSV export. “Booked stay value” is prorated by overlapping nights; ADR is booked value per occupied bed-night; RevPAR is booked value per available bed-night; “Activity balance” is not cash flow, profit, or accrual revenue. Occupancy is based on current bed inventory plus assigned bed history; date-specific bed blocks are included when the table exists.

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
