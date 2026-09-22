# Conventions (when you modify the project)

**Git-safe.**

## `useAdminApi`

Only `POST /api/admin/checkins` with `{ password, username?, ...body }`, one retry if the response is not JSON. Food/expenses/bookings/CMS/inventory **must not** use this helper (`fetchWithRetry` to their own URL is fine).

## API

```ts
export async function POST(req: NextRequest) {
  const { password, username, action, ...rest } = await req.json();
  const auth = await authenticateUser(password, username);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const gate = actionAllowed(auth.role, auth.permissions, ACTION_PERMISSIONS[action]);
  // ...
}
```

Uploads: multipart, not JSON. Admin password in FormData too.

## Money / dates

Paise integers for food, expenses, ledger, salary. `Math.round(parseFloat(rupees) * 100)`. Display `/ 100`. **Bookings / Room Revenue are rupees** — pass `amountUnit="rupees"` into `RecordPaymentModal`; do not divide by 100. Tax settings: **`0` is 0%** (`foodTaxPercent` / `bookingTaxPercent`), never `Number(x) || 5`. Dates ISO or `YYYY-MM-DD`. Months `JUNE-2026`.

## Auth

Client sends **raw** `ADMIN_PASSWORD` (or DB user password). Server hashes DB users with suffix `goko-salt-2026`. Never hash on the client and send the hash as the password.

## React admin

Named exports. `useCallback` for fetch used in effects. `AbortController` cleanup. `useRef` for double-submit. Tabs: inline arrays + `useTabWithHistory`. Brand: `brand-green`, `brand-sand`, `brand-mist`. Lucide icons.

## DB

No `db.transaction()` wrapping `queries.ts` (`getDb()` inside breaks D1). Stock: SQL arithmetic. New tables that sync: add to `syncEngine` lists + FK remap.

## Marketing

Keep `force-static`. Live CMS via `/api/site` only.

## Local handbook

Any behavior/API/schema/auth change → update `docs/` in the same turn (`.cursor/rules/goko-local-docs.mdc`). Secrets → only `docs/secrets-and-access.md` (gitignored). Never commit that file or `MAINTAINER.local.md`.

## Tests

Every behavior change needs a focused regression test in the same turn. Use Vitest for logic/API/auth/data behavior and Playwright for critical cross-page user workflows. Extend an existing suite before creating a new one. Touch RBAC / stock / inventory / CMS → update the matching `src/__tests__/*`.

Every behavior, API, schema, auth, permission, page, or workflow change also requires matching committed maintainer documentation; source-only changes are not ready for handoff.
