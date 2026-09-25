# Directory — where to put code

**Git-safe.** Repo: `thegokosocial/GokoHostelWebpages`.

```
GokoWeb/
├── docs/                         # handbook (secrets-and-access.md gitignored)
├── MAINTAINER.local.md           # gitignored live stamps
├── .env.local                    # gitignored secrets
├── src/app/(marketing)/          # Public pages + GTM + SiteShell, force-static
├── src/app/admin|self-checkin|food-order|kitchen|my-bills|review/
├── src/app/api/                  # 42 route.ts files
├── src/components/admin|dates|food|kitchen|forms|layout|sections|ui|booking|faq|media|motion/
├── src/content/                  # Marketing seed + CMS fallback
├── src/db/                       # schema.ts queries.ts siteQueries.ts splitQueries.ts index.ts cloudflare.ts pi.ts syncMeta.ts
├── src/lib/                      # see table below
├── src/hooks/                    # useTabWithHistory, usePanelHistory, useDarkMode
├── src/__tests__/                # Vitest
├── migrations/                   # Wrangler D1 production SQL (0001–0042)
├── drizzle/                      # stale kit output — not prod
├── scripts/                      # Pi, FRRO, Drive token, scrape, backup-pi.sh
├── public/                       # images, videos/hero, icons, manifest
├── wrangler.jsonc
└── .github/workflows/            # ci.yml + scrape-rates.yml (no deploy)
```

Live marketing routes are `src/app/(marketing)/` (`force-static`). Do not add SSR to `/events` or `/community-area`.

## `src/lib/`

| File | Role |
|------|------|
| `auth.ts` / `actionPermissions.ts` / `adminNav.ts` | Login + RBAC + admin tabs |
| `runtime.ts` | Pi vs Cloudflare |
| `googleApiFetch.ts` / `validateIdDocument.ts` / `parsePassportData.ts` / `parseDob.ts` | Google + OCR |
| `aiosell.ts` / `aiosellSync.ts` / `channelMapping.ts` / `channelAutoAssign.ts` / `inventoryAvailability.ts` / `bookingPricing.ts` / `adminBookingRates.ts` / `stayPayment.ts` / `platformReceivables.ts` / `websiteGatewayFees.ts` / `pmsLog.ts` / `pmsLogSummary.ts` / `logRetention.ts` / `logExport.ts` / `sqliteWriteCount.ts` | Channel manager + walk-in tax/discount + admin multi-night stay rate suggestions (`adminStayRateForStay`) + stay collect/refund math + OTA/website platform receivables and Razorpay fee refresh. Log **cards** import `pmsLogSummary` only (client). `pmsLog` writes D1. `logRetention` is 30-day prune + pager math (client-safe). `logExport` is JSON/PDF download text (client; dynamic `jspdf`). |
| `syncEngine.ts` | Pi ↔ CF |
| `siteContent.ts` / `siteCopy.ts` / `mediaR2.ts` / `mediaKeys.ts` / `processSiteImage.ts` / `cropRect.ts` | CMS |
| `kitchenHours.ts` / `foodLookup.ts` / `foodTab.ts` / `foodTabDb.ts` / `orderStatus.ts` / `thermalPrint.ts` | Food. **`foodTab.ts` is client-safe copy/guards.** **`foodTabDb.ts` is server-only** (`getDb`). Admin UI must not import `foodTabDb` or the Worker bundle pulls `better-sqlite3`. |
| `splits.ts` | Splitwise kernel (paise, FIFO Goko attribution) |
| `checkinSchema.ts` / `checkinLookup.ts` / `phoneUtils.ts` | Check-in |
| `otaEmailParser.ts` | Gmail bookings |
| `pushNotify.ts` | Web push |
| `dbRetry.ts` | D1 retry helper |
| `site.ts` / `seo.ts` / `utils.ts` / `format.ts` / `stayGallery.ts` / `animations.ts` | Site chrome |

## Scripts

`migrate-pi.ts` (skips 0035 and 0041), `seed-pi.ts`, `setup-pi.sh`, `check-and-deploy.sh`, `backup-pi.sh`, `get-drive-token.js`, `migrate-sheets-to-d1.ts`, `frro-server.ts`, `scrape-booking-rates.js`, `test-checkin-validation.ts`, `test-ocr-parsing.ts`, `regen-how-to-reach-gifs.sh`.

| New thing | File |
|-----------|------|
| Paired date range UI | `components/dates/DateRangePicker.tsx` + `lib/dateRangePicker.ts`; shadcn `ui/calendar.tsx`, `ui/popover.tsx` |
| Admin section | `components/admin/X.tsx` + `admin/page.tsx` + `adminNav.ts` |
| Management tab | `AdminManagement.tsx` `TABS` |
| Admin action | existing `api/admin/*/route.ts` + `ACTION_PERMISSIONS` |
| Column | `schema.ts` + `migrations/00NN_name.sql` |
| Query | `queries.ts` (CMS → `siteQueries.ts`, Splits → `splitQueries.ts`) |
| CMS | Cloudflare only; not `syncEngine` |
| Handbook | `docs/` same turn as the code; secrets only in `secrets-and-access.md` |

No barrel files except `qr-generator/index.ts`. Admin is `"use client"`.
