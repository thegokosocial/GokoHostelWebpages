# GokoWeb project-wide maintenance rule

This rule applies to every agent/chat working in this repository.

## Keep code, permissions, tests, and docs synchronized

For every behavior, page, API action, schema, authentication, authorization, or workflow change, update the matching documentation in the same turn. Do not leave documentation work for later.

Use the source files as the authority:

- `src/lib/permissionCatalog.ts` — active permission keys shown to administrators.
- `src/lib/actionPermissions.ts` — permission aliases and shared authorization behavior.
- `src/lib/adminNav.ts` — top-level admin page access.
- `src/components/admin/AdminManagement.tsx` — Management tab access.
- `src/app/api/admin/**/route.ts` — server-side action permission maps.
- `docs/pages-and-ui.md` — page and Management-tab permission matrix.
- `docs/auth-rbac.md` — authentication, permission catalog, and action-level RBAC matrix.
- `docs/api-map.md` — API action inventory.
- `docs/permission-debt.md` — intentionally retired or compatibility-only permission keys.

When changing a permission or page:

1. Add or remove the key in `permissionCatalog.ts` and the Users UI through the shared catalog; do not create a second permission list.
2. Update the relevant page/tab gate and server-side action map. UI hiding is not authorization.
3. Separate view, create, edit, delete, payment, workflow, and destructive actions where the product needs different access.
4. Preserve deliberate compatibility aliases/fallbacks unless the user explicitly requests their removal. Record retired keys in `docs/permission-debt.md`.
5. Update `docs/pages-and-ui.md`, `docs/auth-rbac.md`, `docs/api-map.md`, and the relevant flow/onboarding document when applicable.
6. Add or update focused Vitest coverage for the changed permission matrix or workflow.

For every non-trivial code change, validate proportionally. At minimum for RBAC/API/UI changes, run `npx vitest run`, `npx tsc --noEmit`, `git diff --check`, and `npm run build`. Do not claim completion if a check fails; report unrelated pre-existing warnings separately.

Before every commit, inspect both staged and unstaged diffs. The commit must contain the matching code, permission maps, tests, and handbook updates for the behavior changed in that commit. Do not commit source-only RBAC/API/page changes. Run `git diff --cached --check` and the applicable validation commands before pushing.

## Production schema release gate

- A migration file being committed is not evidence that production D1 has it. For any change under `migrations/`, read the local maintainer instructions, run `CI=true npm run db:migrate:prod`, and then run `npm run db:verify:prod`.
- `npm run cf:build` and `npm run deploy:cf` enforce the same production migration check and must fail closed when D1 is unreachable or has pending migrations. Do not bypass that failure or claim the Worker is released until the check passes.
- Migration tests use disposable/local databases and cannot certify live D1. Live migration status must be verified separately and recorded in the ignored maintainer state file.

## Production release integrity

- A local commit is not released until its exact commit SHA is present on `origin/main` and the corresponding Cloudflare Worker deployment is confirmed at 100% traffic.
- Before pushing, inspect staged and unstaged changes and deploy only the intended commit from an isolated worktree when the checkout contains unrelated edits or a running dev server.
- After pushing, verify the remote ref explicitly with `git ls-remote origin refs/heads/main` and confirm it matches the intended commit; do not infer success from a local `git push` message alone.
- After a Workers Builds push, poll the Cloudflare deployment list and verify the deployed build/version identifies the intended commit. If no matching deployment appears within the bounded release window, stop waiting and use the documented `npm run deploy:cf` fallback from the exact pushed commit.
- Never call a release complete based only on GitHub or only on a Cloudflare version UUID. The final handoff must include the commit SHA, Worker version, traffic percentage, migration-gate result, and any unresolved validation failure.
- If the deployed build cannot be matched to a commit, treat the release as unverified and do not claim production success; improve or use the build/version health signal before the next release.

## Current RBAC expectations

- `admin` bypasses permission maps.
- DB `manager` and `staff` users receive only the keys stored in their `users.permissions` JSON.
- The page permission is only the entry gate; action permissions control mutations inside the page.
- Menu permissions are `canViewMenu`, `canManageMenuCategories`, `canManageMenuItems`, `canToggleMenuAvailability`, `canManageInventory`, and `canManageFoodSettings`.
- Timeline uses `canViewTimeline` for viewing; assign/change/unassign uses `canAssignBed`, checkout uses `canCheckout`, and cleaning uses `canMarkClean`.
- Existing compatibility fallbacks must be treated as intentional unless explicitly removed.
- `canSyncBookings` and `canAccessKitchen` are retired from the active catalog. Keep old stored JSON keys only during the documented compatibility window.
- Check-in identity rule: Indian guests may use Aadhaar, Driving Licence, or Passport; any non-Indian nationality defaults to and permits only Passport, requires a visa upload, and must be enforced by self-check-in/Admin Records APIs too.

## Secrets and local live state

Never commit passwords, tokens, SSH details, or live deployment stamps. Keep them in gitignored `docs/secrets-and-access.md` and/or `MAINTAINER.local.md`. Do not edit or expose those files unless the task explicitly requires local live-state maintenance.

Before deploy, D1 migration, Pi work, Website CMS, or R2 work, read the local maintainer instructions and secrets files if present. If they are missing, say so; never invent live values.

## Required handoff

The final response must summarize code changes, documentation changes, validation results, and any remaining limitation or compatibility caveat.
