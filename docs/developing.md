# Continuing development

**Git-safe.** How to pick up this repo and add work without breaking production. Project-wide agent requirements: [`AGENTS.md`](../AGENTS.md). Read [llm-onboarding.md](llm-onboarding.md) next (landmines). Secrets: gitignored [secrets-and-access.md](secrets-and-access.md). Live stamps: gitignored `MAINTAINER.local.md`.

---

## New agent / new clone — read order

1. This file + [overview.md](overview.md)
2. [llm-onboarding.md](llm-onboarding.md) — occupancy split, array APIs, RBAC mismatches
3. [architecture.md](architecture.md) + [decisions.md](decisions.md)
4. [interactions.md](interactions.md) mermaid for the area you will touch
5. The **one** flow file (guest-checkin, food, pms, accounts, splits, cms, sync, reviews)
6. The named `route.ts` + admin component
7. Secrets file only if you must run, deploy, or SSH

Trust order: **running system → secrets / MAINTAINER.local.md → `src/` → these docs → root README/ARCHITECTURE (stale).**

---

## Handoff to another agent

The handbook is enough to **continue** development. It is not a fire-and-forget autopilot: there is no OpenAPI; request JSON, SQL, and UI still come from the `route.ts` / component you are changing.

Tell the next agent:

- Trust `src/` over `docs/` when they disagree.
- Trust **local** `MAINTAINER.local.md` over docs for what is live (Worker versions, D1 stamps, R2). That file is gitignored — a fresh clone will not have it.
- Never commit `docs/secrets-and-access.md` or `MAINTAINER.local.md`. If they are missing, stop and say so; do not invent passwords.
- Never treat GitHub Actions `ci.yml` as a Worker deploy. Cloudflare **Workers Builds** on `goko-hostel-latest-webpage` **does** deploy on push to `main`.
- Read [llm-onboarding.md](llm-onboarding.md) landmines **before** touching bookings, food tab, or money.

---

## What this product is (one paragraph)

One Next.js 15.5 App Router monolith: marketing site, guest check-in/food, kitchen, admin PMS (beds + calendar bookings + Aiosell), accounts, splits IOUs, Events/Community CMS. Cloudflare Workers (OpenNext) + D1 + R2. Optional Pi SQLite copy for front desk (`GOKO_RUNTIME=pi`). Public Book now is Stayflexi; inventory/rates are Aiosell. ID photos go to Google Drive, CMS stills to R2.

---

## Change a thing — where it goes

| Kind | Files |
|------|--------|
| Marketing copy | `src/content/*.ts` — keep `force-static` on `(marketing)` pages |
| Events/Community live | CMS admin + D1 `site_*`; public hydrate `GET /api/site` |
| Admin tab | `src/components/admin/X.tsx`, lazy import in `admin/page.tsx`, `adminNav.ts` |
| Management sub-tab | `AdminManagement.tsx` `TABS` |
| Admin API | existing `src/app/api/admin/*/route.ts` `action` + `ACTION_PERMISSIONS` |
| Guest API | `src/app/api/<area>/route.ts` |
| Column / table | `src/db/schema.ts` **and** `migrations/00NN_name.sql` |
| Query | `queries.ts` (CMS `siteQueries.ts`, splits `splitQueries.ts`) |
| Synced table | also `syncEngine.ts` lists + FK remap |
| CMS / splits | Cloudflare only — **not** `syncEngine`; Pi migrator skips `0035` / `0041` |
| Money | integer paise (food/ledger) or rupees (`bookings`) |
| Permission | `ManagementUsers.tsx` **and** the route map (they diverge — see onboarding §4) |
| Handbook | matching `docs/*.md` same turn. Secrets → `secrets-and-access.md` only |

Do **not**:

- SSR `/events` or `/community-area`
- Wrap `queries.ts` in `db.transaction()` (`getDb()` inside breaks D1)
- Use `useAdminApi` for anything except `/api/admin/checkins`
- Mix calendar occupancy with `beds.status`
- Run `next build` / `deploy:cf` in the same tree as `next dev`
- Commit `docs/secrets-and-access.md` or `MAINTAINER.local.md`
- Treat GitHub Actions `ci.yml` as a Worker deploy (it is not). Dashboard **Workers Builds** on `goko-hostel-latest-webpage` **does** deploy on push to `main`

---

## Local loop

```bash
npm install
npm run dev                 # http://localhost:3000 — no D1 unless OpenNext flags
npm test
npx tsc --noEmit            # required before push; Vitest does not typecheck
npm run lint
```

Admin login values: [secrets-and-access.md](secrets-and-access.md). Plain `next dev` uses `.env.local`; it does **not** load Wrangler D1.

---

## Tests to touch when you change an area

| Area | `src/__tests__/` |
|------|------------------|
| RBAC | `rbac.test.ts` |
| Food stock | `stock-operations.test.ts` |
| Splits | `splits.test.ts`, `splits-wiring.test.ts` |
| CMS | `site-cms.test.ts`, `website-cms-api.test.ts` |
| Aiosell / calendar PMS | `aiosell-*.ts`, `booking-*.ts`, `pms-*.ts`, `channel-wf-*.ts`, `inventory-*.ts`, `cpu-bookings-rates.test.ts`, `stay-payment.test.ts` |
| Food tab at checkout | `food-tab*.test.ts` |
| Sync FKs | `sync-fk-remap.test.ts` |
| Worker CPU / chrome | `worker-cpu.test.ts`, `cpu-*.test.ts` |

Full table: [testing-and-ci.md](testing-and-ci.md).

---

## Deploy (no secrets here)

1. `npx tsc --noEmit` then push `main` → Cloudflare Workers Builds (`npm run cf:build` + `wrangler deploy`).
2. Fallback: git worktree + `npm run deploy:cf` (never against a live `next dev` `.next`).
3. New SQL: `CI=true npm run db:migrate:prod` around the same time. Stamp `d1_migrations` if the column already exists.
4. Pi ops: `db:migrate:pi` (skips CMS + splits SQL) + `build:pi` + `pm2 restart`. Commands with passwords: secrets file.

Worker name / D1 / R2 bindings: committed `wrangler.jsonc`. Version stamps: `MAINTAINER.local.md`.

---

## Adding a synced table (checklist)

1. Columns in `schema.ts` including `syncColumnsWithDelete` if mutating.
2. `migrations/00NN_*.sql`
3. Queries in `queries.ts`
4. `syncEngine.ts` table list + FK remap if it references other synced PKs
5. Docs: `data-model.md`, `schema-columns.md`, `relationships.md`, `flows-sync.md`

Do not add `site_*` or `split_*` to sync.

---

## Adding an admin `action` (checklist)

1. Switch case in the existing route (prefer not a new god-file).
2. `ACTION_PERMISSIONS` entry — `admin_only` or a real key that exists in `ManagementUsers.tsx` if staff should get it.
3. UI `fetch` to **that** URL (not `useAdminApi` unless checkins).
4. Vitest if RBAC/money/PMS.
5. `docs/api-map.md` + `auth-rbac.md` if the map changed.
