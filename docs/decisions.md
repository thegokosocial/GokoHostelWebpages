# Decisions (why it is this way)

**Git-safe.** These are the load-bearing choices. Changing one without the others usually creates a second system.


These are the load-bearing choices. Changing one without the others usually creates a second system.

---

## ADR-1 — One Next.js monolith, not 5 SaaS products

**Choice:** Marketing, check-in, food, accounts, PMS, CMS in one repo and one Worker.

**Why:** 3–5 staff. One login surface. One deploy. No “which dashboard is truth?”

**Cost:** God routes (`/api/admin/checkins` is huge). Admin JS is lazy-split by tab, not by micro-frontends.

**Do not:** Split into a “marketing” Pages project and a “PMS” Worker unless staff actually need that isolation.

---

## ADR-2 — Cloudflare Workers + D1, not Vercel + Postgres

**Choice:** `@opennextjs/cloudflare` + D1 SQLite.

**Why:** Edge latency for guests worldwide. SQLite matches a single-property write rate. Cost is near-zero on the free/paid Worker plans used here. Same SQL dialect as the Pi.

**Cost:** Worker CPU/time limits. No real `db.transaction()` across `getDb()` helpers. D1 HTTP vs local Wrangler D1 vs Pi file are three environments to keep in sync via migrations.

**Do not:** Assume GitHub **Actions** deploys the Worker (`ci.yml` does not). Dashboard **Workers Builds** on this Worker **does** deploy on push to `main`.

---

## ADR-3 — Dual runtime (Cloudflare + Pi)

**Choice:** Same app, `GOKO_RUNTIME=pi` switches DB driver and hides CMS.

**Why:** Hostel internet dies. Front desk still needs beds, check-in, food. Pi SQLite + nginx + optional DNS failover.

**Cost:** Sync engine, ID remapping, conflict table, settings subset. CMS is Cloudflare-only so Pi events pages stay on git content.

**Do not:** Sync `site_*` tables or R2 objects. Do not apply `0035_site_cms.sql` as a real schema change on Pi (migrator skips it).

---

## ADR-4 — Action-based POST, not REST

**Choice:** `POST /api/admin/foo` with `{ action, password, ... }`.

**Why:** One auth gate. 40+ check-in ops without 40 files. Same contract for a future Android wrapper.

**Cost:** Not cacheable. Easy to grow a 1000-line route. Unknown `action` must 400.

**Do not:** Introduce GET with password in query string for admin mutations.

---

## ADR-5 — Password-per-request, not JWT/sessions

**Choice:** Client sends raw password every admin POST. Server hashes as `SHA-256(password + "goko-salt-2026")` for DB users. Env admin/manager compare plaintext env vars.

**Why:** Tiny staff set. Works from curl. No refresh tokens. Kitchen uses `sessionStorage`.

**Cost:** Password sits in React state (and optional localStorage “remember”). HTTPS required. Env **manager** with empty `permissions: {}` is blocked by RBAC (intentional after server-side enforcement).

**Do not:** Hash on the client and send the hash as the password. The server hashes DB users itself.

---

## ADR-6 — Amounts in paise (integers)

**Choice:** food / expenses / ledger / salary store ₹500.50 as `50050`. Display divides by 100.

**Exception:** `bookings` amounts are **rupees** (walk-in nightly rate 500, Aiosell `amountAfterTax` as-is). Stay UI must pass `amountUnit="rupees"` into the shared food `RecordPaymentModal`.

**Why:** IEEE 754. Same as Stripe/Razorpay for the paise tables.

**Cost:** Every food/ledger form must `Math.round(parseFloat(x) * 100)`. Mixing stay rupees with food paise without `amountUnit` makes reports 100× wrong.

---

## ADR-7 — Google Drive for PII photos, R2 for CMS JPEGs

**Choice:** IDs/visas/bills → Drive. Event/community/hero stills → R2.

**Why:** Drive is how staff already look at IDs. R2 is public, cacheable, not Pi-synced. Mixing PII into a public media bucket is the wrong default.

**Cost:** Two upload pipelines. Drive OAuth tokens. R2 must be enabled in the dashboard (error 10042 if not).

---

## ADR-8 — Google Vision for ID checks, not a custom model

**Choice:** Label + OCR + type scoring + name match + SafeSearch (`validateIdDocument.ts`). Passport MRZ + visa OCR in `parsePassportData.ts` (multiple European languages).

**Why:** Aadhaar/DL/passport/visa variety. No training set. Pay-per-use.

**Cost:** Setting `image_validation` can turn it off. Vision outage still allows check-in with `verified: pending`. Stats in `api_stats`.

---

## ADR-9 — Kitchen polling, not WebSockets

**Choice:** Kitchen ~5s, guest status ~10s.

**Why:** Workers do not persist WS without Durable Objects. A 20-cover cafe does not need them.

**Cost:** Sub-second kitchen updates will never happen this way.

---

## ADR-10 — Aiosell as channel manager, Stayflexi as booking engine

**Choice (updated 17 September 2026):** Public Book now → administrator-saved `channel_config.bookingEngineUrl` through sanitized public configuration/redirect routes. Blank/unavailable → Booking Enquiry; `/book` currently offers an enquiry entry, not active native checkout. External providers, including StayFlexi/Aiosell guest engines, handle their own checkout. Inventory/rates/restrictions/no-show → Aiosell HTTP. Inbound reservations → `POST /api/aiosell/reservations`. See [Website booking foundation](flows-website-booking.md).

**Why:** Those are the vendors the property already uses. GokoWeb owns occupancy truth and pushes **Goko-originated** changes only.

**Golden rule** (`aiosellSync.ts`): do **not** push inventory back when the change came from an Aiosell webhook (loop). `pushIfOtaChanged` fingerprints availability before/after.

---

## ADR-11 — Online vs offline inventory pool

**Choice:** `booking_bed_assignments.inventory_pool` = `online` | `offline` | `block`. Availability = beds − blocks − assignments, then split by OTA ceiling (`inventory_overrides`).

**Why:** Walk-in beds should not all vanish from Booking.com, and OTA oversell is worse than a walk-in waitlist.

**Source of truth for math:** `src/lib/inventoryAvailability.ts` + tests.

---

## ADR-12 — Soft-delete + sync IDs

**Choice:** Synced mutating tables have `deleted_at` and `sync_id` (UUID). Pi and CF remap FKs via `sync_id_map`.

**Why:** Two databases, integer PKs would collide.

**Cost:** Every new synced table needs engine config + FK remap. CMS tables are deliberately **not** synced.

---

## ADR-13 — Static marketing + client CMS fetch

**Choice:** `force-static` Events/Community; live data from `/api/site`.

**Why:** Worker CPU. Empty D1 result ≠ TypeScript fallback (0 rows is empty CMS). Throw/unavailable → seed content.

---

## ADR-14 — Tests exist; they are not the whole QA story

**Choice:** Vitest on RBAC, stock, inventory, CMS, Aiosell parse, CPU-ish workflows. CI runs them.

**Why:** Overview.mdc claiming “no tests” is stale. The hostel is still one property — tests cover money, auth, and PMS math first.

**Cost:** Little UI/e2e. `next build` still required for typecheck of pages.

---

## ADR-15 — XLSX bulk import, not CSV

**Choice:** `xlsx` templates for check-ins, expenses, income.

**Why:** Phone leading zeros, Excel serial dates.

---

## ADR-16 — Splits IOUs vs Accounts cash

**Choice:** Staff/volunteer Splitwise is its own admin section and `split_*` tables. Hostel P&L updates only when cash actually leaves (`expenses` via Goko-as-payer or Pay via Accounts).

**Why:** Posting Goko's share at add-expense time double-counted Daily Ledger when reimbursing later.

**Do not:** Default-check Goko on equal splits. Use `paySalary`. Reimburse from group nets. `useAdminApi` for this UI. Sync `split_*` to Pi. Infer Include-Goko as `"grid"` on equal-with-Goko edit (drops hostel share). Mutate Accounts amounts from a split edit after `hostelExpenseId` is set. Delete a settled expense while live settlements remain.

---

## Rejected or deferred

| Idea | Status |
|------|--------|
| Auto-deploy Worker on git push | **Rejected in practice.** CI does not deploy. Local `deploy:cf`. |
| JWT for admin | Deferred until a native mobile app needs it |
| Durable Objects for kitchen WS | Deferred |
| `db.transaction()` around query helpers | **Tried, broke food orders on D1** |
| Drizzle `db.transaction()` BEGIN/COMMIT for OTA payment journal on Workers | **Tried pattern; D1 rejects interactive BEGIN — use `db.batch()`** |
| CMS on Pi | Explicitly out of scope |
| Splits on Pi | Explicitly out of scope (skip `0041`, hide nav) |
| R2 for ID photos | Out of scope (PII + staff Drive habit) |

### Food-order edit persistence (2026-09-23)

`saveOrderEdits` uses D1 `batch()` for all writes. The existing edit-batch `order_id NOT NULL` constraint is deliberately used by bounded CASE guards to abort the batch when the prepared order/items or stock availability changed. A zero-row conditional update is not sufficient to roll back D1. Pi executes the same prepared statements in a synchronous SQLite transaction callback. Production regression coverage runs actual local workerd D1; no new schema or dependency is required.
