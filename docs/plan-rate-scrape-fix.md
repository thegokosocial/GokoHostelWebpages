# Booking.com rate scrape fix — reviewed and implemented

## Findings and revised approach

The reported September 16, 2026 Goko rate is ₹400 in the dashboard and ₹500 plus ₹25 taxes in the screenshot. The former parser scans every rupee amount in a card and can mistake taxes for the accommodation price. Its output for ₹2,000 plus ₹100 taxes is ₹100. It nevertheless parses the screenshot's ₹500 plus ₹25 correctly: the original discrepancy's exact cause is not established by the historical logs.

Use the displayed INR price element, excluding visually hidden and crossed-out content; never infer the price from other card amounts. Booking.com's actual visible price has `aria-hidden="true"` because it supplies separate screen-reader text. A live check caught this distinction; browser fixtures now reproduce it. Ambiguous/missing prices remain null with evidence rather than guessed values.

The comparison basis remains signed-out desktop Booking.com, one adult, zero children, one room, one night, INR, excluding separately listed taxes. Browser origin and offers can still differ between a local browser, GitHub runner, and proxy. No percentage correction or channel-manager rate change is justified.

## Implemented changes

- Dedicated DOM extractor, price readiness wait, decimal support, explicit child count, UTC date arithmetic.
- Per-date card text, displayed price text, timestamp, and source URL. Diagnostic artifacts retained for seven days; screenshots on extraction errors.
- Version 2 JSON envelope containing properties and incomplete dates; unchanged database columns and action names. API validates both new envelopes and legacy arrays.
- Partial/failed status instead of silent full success. Callback failure exits unsuccessfully. Existing valid observations survive partial failures.
- Grid columns use the saved start/end dates, not the first property's prices; exclusive checkout and UTC date labels. Missing observations do not imply sold out. Empty-city results clear, stale city responses are ignored.
- Historical results remain readable and are labelled as lacking evidence. Price hover text exposes captured card details. First-20-result coverage is disclosed.

## Validation

- `node scripts/test-booking-rate-parser.js`: 13 real Chromium DOM scenarios including ₹500/₹25, ₹550/₹28, tax ≥₹100, crossed-out and hidden prices, actual aria-hidden markup, decimals, INR/Rs, out-of-old-range prices, foreign currencies, ambiguous and absent selectors.
- `node scripts/test-rate-scrape-flow.js`: five mocked complete scraper flows covering successful aggregation and search parameters, partial dates, empty failure, ambiguous failure, and failed callback.
- `npx vitest run`: all 1,131 tests across 67 files passed. Updated the existing inventory-grid date test to assert the shared helper's checkout-exclusive behavior rather than its former source location. Coverage includes historical arrays, versioned diagnostics, invalid data, complete date ranges, and access rules.
- `npx tsc --noEmit --incremental false`, `git diff --check`, and production `npm run build`: passed. Build includes lint and type checking; unrelated existing lint warnings remain. Google Fonts required network access during the build.
- Read-only live search at 2026-09-08 05:20 UTC: corrected extractor returned Goko ₹500, with ₹25 separately listed taxes in the evidence; 11 of 11 returned cards parsed. HostelLife was not among those returned cards and is covered by the mock fixture. No production results were posted.

## Rollout and remaining verification

Deploy the API and dashboard reader before running the new scraper workflow: older UI versions cannot read version 2 envelopes. Reload open admin pages after deployment. The workflow runs parser and flow checks before scraping. No database migration or historical rewrite is required.

Then run a fresh production scrape and inspect Goko's evidence for the same dates. A GitHub/proxy response of ₹400 must be compared with its captured card and offer/context, not forced to ₹500. Local verification demonstrates correct extraction for the live local response; it does not prove historical ₹400 was a parser error or guarantee identical offers across origins. Deployment and the production scrape are not part of this local implementation.
