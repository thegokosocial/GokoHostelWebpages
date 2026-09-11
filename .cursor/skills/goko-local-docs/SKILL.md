---
name: goko-local-docs
description: Review and update the GokoWeb handbook in docs/ (architecture, flows, API map). Secrets stay in gitignored secrets-and-access.md. Use when changing APIs, schema, auth, PMS, food, CMS, sync, deploy, or secrets; when the user asks to update docs; or after a feature lands.
---

# Goko handbook

Committed `docs/` is the knowledge base. Never `git add docs/secrets-and-access.md` or `MAINTAINER.local.md`.

## Steps

1. Read `docs/README.md` then `docs/llm-onboarding.md` (landmines).
2. Diff the change against **source** (`src/`, `migrations/`, `wrangler.jsonc`). Do not trust an older handbook paragraph if the route disagrees.
3. Patch every matching file in the table below. Keep mermaid diagrams accurate.
4. Secrets/passwords/live IDs → only `docs/secrets-and-access.md` and `MAINTAINER.local.md`.
5. Production stamps (Worker version, D1 applied list, R2) → `MAINTAINER.local.md`.
6. If those gitignored files are missing, stop and say so.

## Commit gate

Before committing, inspect both the working-tree and staged diffs. A commit that changes product behavior must also include the matching handbook updates in the same commit; do not commit source-only RBAC/API/page changes. Confirm the permission catalog, UI gates, server action maps, tests, `docs/pages-and-ui.md`, `docs/auth-rbac.md`, `docs/api-map.md`, and relevant flow/onboarding docs are synchronized. Run `git diff --cached --check` plus the applicable tests/typecheck/build before pushing.

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
| How to continue work | `developing.md` |

## Style

- First line after title: `**Git-safe.**` unless the file is secrets-only (`**LOCAL ONLY. Never commit.**`).
- Setting keys and `action` names must match code exactly (e.g. `food_kannada_kitchen_print`, not a guessed alias).
- Note real code drift when you find it (example: `syncEngine` still syncs `food_kannada_labels` while the UI uses print/display keys).
- No passwords, SSH, API tokens, or live Worker version IDs in committed markdown.

## Done when

Handbook matches the diff. Stale sentences that contradict `src/` are gone. Secrets file still gitignored.
