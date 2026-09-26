---
name: goko-local-docs
description: Keep GokoWeb handbook docs and regression tests synchronized with feature, API, schema, auth, UI, PMS, food, CMS, sync, deploy, and workflow changes. Secrets stay in gitignored secrets-and-access.md.
---

# Goko handbook

Committed `docs/` is the knowledge base. Never `git add docs/secrets-and-access.md` or `MAINTAINER.local.md`.

## Steps

1. Read `docs/README.md` then `docs/llm-onboarding.md` (landmines).
2. Diff the change against **source** (`src/`, `migrations/`, `wrangler.jsonc`). Do not trust an older handbook paragraph if the route disagrees.
3. Identify the smallest meaningful regression test: Vitest for logic/API/auth/data behavior; Playwright for cross-page or user-visible workflows. Extend an existing suite before creating a new one.
4. Add or update the regression test in the same turn as every feature or behavior change. A behavior change is not ready to commit without matching test coverage. Cover success plus the relevant authorization, boundary, duplicate/retry, and failure behavior; for money, payment, receipt, audit, inventory, or workflow changes, assert the side effects as well as the response. Do not add browser coverage for pure logic that is already well covered by Vitest.
5. Patch every matching file in the table below. Keep mermaid diagrams accurate.
6. Secrets/passwords/live IDs → only `docs/secrets-and-access.md` and `MAINTAINER.local.md`.
7. Production stamps (Worker version, D1 applied list, R2) → `MAINTAINER.local.md`.
8. If those gitignored files are missing, say so; never invent live values.

## Production schema-change gate

Any table, column, index, constraint, default, or data-shape change must ship as a complete production release, not as source code alone:

1. Add one ordered migration in `migrations/` using the repository's migration conventions. Make it safe for the current production state: account for existing rows, backfills, defaults, nullability, indexes, and retry behavior. Do not edit an applied migration.
2. Update the schema/data-model handbook entries and add a disposable SQLite/D1 regression test for the migration and affected behavior. Cover fresh data, existing/legacy rows, backfill/default behavior, and a failed or repeated migration where relevant.
3. Before deploying, inspect remote migration status and apply the migration with `npm run db:migrate:prod`. Investigate schema drift, duplicate-object errors, or partial application; never force a migration or mark it complete manually.
4. Deploy the Worker after the schema is ready with `npm run deploy:cf` (or verify the Workers Build commit). Confirm the deployed version and traffic state, then verify that remote D1 has no pending migrations and that the affected schema exists with a read-only `PRAGMA table_info(...)` or safe `SELECT`.
5. Update the local-only production stamps in `MAINTAINER.local.md`. Do not report completion while migration, deployment, or post-deploy verification is failing.

Live validation is read-only by default. Never create real orders, bookings, payments, cancellations, or other customer/financial records merely to smoke-test production. Exercise mutations against disposable/local D1 or deterministic Playwright fixtures; run a live mutation only with an explicitly approved, isolated test record and a documented cleanup/audit plan.

## Commit gate

Before every commit, inspect both the working-tree and staged diffs. Every feature or behavior update must have its focused regression test added or updated before the commit, and the matching maintainer/handbook documentation must be included in that same commit. Never commit source-only behavior, RBAC, API, page, workflow, payment, receipt, or audit changes. Confirm the permission catalog, UI gates, server action maps, tests, `docs/pages-and-ui.md`, `docs/auth-rbac.md`, `docs/api-map.md`, and relevant flow/onboarding docs are synchronized. Run `git diff --cached --check` plus the applicable tests/typecheck/build before pushing. If a change is intentionally test-exempt because it is non-behavioral, record that rationale in the handoff.

## Test-layer choice

- Vitest: pure logic, parsers, money/date rules, permissions, API routes, error contracts, retries, idempotency, and disposable-database workflows.
- Playwright: critical navigation and cross-component journeys, responsive behavior, and user-visible loading/empty/unauthorized states. Use deterministic mocked APIs; never production credentials or live mutable data.
- Reuse existing helpers and suites. Add shared fixtures only when multiple tests need the same setup.

## File map

| Change | Files |
|--------|--------|
| New/removed table or column | `data-model.md`, `schema-columns.md`, `relationships.md` |
| New route or `action` | `api-map.md`; permission maps → `auth-rbac.md` |
| Guest check-in / Vision / Drive | `flows-guest-checkin.md`, `interactions.md` |
| Food order / kitchen / stock / food settings keys | `flows-food-kitchen.md` |
| Beds, calendar bookings, inventory math, Aiosell | `flows-pms.md` |
| Expenses, ledger, salary | `flows-accounts.md` |
| Staff/volunteer IOUs | `flows-splits.md` |
| Events/Community CMS, R2, `/api/site` | `flows-cms.md` |
| Pi sync, failover, `SYNC_SECRET` | `flows-sync.md` |
| Review funnel, Form C, FRRO | `flows-reviews-formc.md` |
| Login, RBAC keys, env vs DB users | `auth-rbac.md` |
| Passwords, Google, Cloudflare tokens | `secrets-and-access.md` (gitignored) |
| Env names only | `env-vars.md` |
| How to run/deploy | `maintain.md` |
| npm scripts, tests, CI | `testing-and-ci.md`, `directory.md` |
| Why we built it this way | `decisions.md` |
| Landmines / wire formats / UI≠API | `llm-onboarding.md` |
| Pages / admin components | `pages-and-ui.md` |
| Frosted glass / glassmorphism materials | `frosted-glass.md` |
| Guest booking UI workflows | `guest-booking-ui.md` |
| How to continue work | `developing.md` |

## Style

- First line after title: `**Git-safe.**` unless the file is secrets-only (`**LOCAL ONLY. Never commit.**`).
- Setting keys and `action` names must match code exactly (e.g. `food_kannada_kitchen_print`, not a guessed alias).
- Note real code drift when you find it (example: `syncEngine` still syncs `food_kannada_labels` while the UI uses print/display keys).
- No passwords, SSH, API tokens, or live Worker version IDs in committed markdown.

## Done when

Handbook and focused regression tests match the diff. Stale sentences that contradict `src/` are gone. Secrets file remains gitignored. A behavior change without a test or matching docs update is not ready for handoff.
