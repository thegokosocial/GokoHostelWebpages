# Website booking deep review — 17 September 2026

## Follow-up fix/review status

All six findings from the initial review below have been corrected in their respective scopes. Application fixes reject trailing-dot destination hosts and normalize the API host comparison, fail closed on corrupt saved drafts (409, no overwrite), preserve unrelated preferences on partial updates, refresh/retry admin metadata safely, and use a public query that never selects integration credentials.

The independent payment **model**, not a live gateway implementation, now binds refund reservations to each captured payment, incrementally reserves excess/full operational refunds, revalidates retry capacity, rejects conflicting replay payloads, calculates targets in integer paise, bounds unknown holds relative to creation, blocks unresolved desk collection, and never reopens a booking after an operational refund decision.

Follow-up validation: **92 files / 1,433 Vitest tests passed**, including 94 focused foundation/persistence tests; original 66 model scenarios passed; **19 adversarial groups passed, zero findings**. The repeated-capture group exercises 20 distinct captures plus replay for each fulfilled/cancelled/unfulfilled path, checking per-payment capacities after every event. TypeScript, diff checks and the production build passed after the final query optimization. Existing unrelated lint warnings remain.

No deployment, migration or real payment/refund occurred. Native checkout is still missing and disabled, so the release verdict remains **not approved for native money handling**. An invalid persisted draft requires reviewed maintenance repair; automatic reset is intentionally unavailable. A subsequent implementation now includes multi-admin revision/CAS protection and an isolated admin-only Razorpay test preview with durable recovery; [scope and checks](integrations-razorpay.md). Actual native D1/provider/UI end-to-end verification remains release work. The rest of this document preserves the **initial review snapshot**, not current unresolved defects.

## Verdict

**Not approved for native booking/payment launch.** Only the configuration/enquiry foundation is implemented. Native checkout, availability/pricing/atomic holds, provisional reservations, verified Razorpay captures, durable webhooks/reconciliation, refunds and bank-settlement accounting do not yet exist. There is no implemented payment flow to certify as safe under internet failure, money debited without capture, lost success responses, duplicate callbacks or late captures.

The ordinary regression suite and original specification model pass, but deeper adversarial probes reproduce six findings. The model is not production payment code; its refund defects do not imply that this foundation has refunded or lost real money. They do invalidate using the original 66 passing model scenarios as a sufficient safety argument.

## Findings: actual application helpers

### 1. Goko trailing-dot host bypasses the destination classification/path guard

Location: `src/lib/bookingDestination.ts`, canonical hostname comparison around line 40.

`bookingDestination('https://www.gokohostel.com./admin')` is accepted as an external engine. The absolute DNS hostname variant is not recognized as a Goko hostname, so the intended rejection of non-booking Goko paths is bypassed. This is an administrator configuration guard defect, **not** a public authentication bypass. Reject these variants or normalize hostnames consistently for classification without accepting arbitrary Goko paths.

### 2. API base trailing-dot host bypasses the guest-engine check

Location: `src/lib/bookingDestination.ts`, API base comparison around line 31.

`bookingDestination('https://live.aiosell.com./', 'https://live.aiosell.com')` is accepted as an external guest engine. Normalize/reject trailing-dot host variants consistently before comparing the saved destination with the API endpoint. Otherwise guests can be routed to an integration endpoint rather than a booking engine despite the guard/help text.

### 3. Invalid persisted draft silently becomes defaults

Location: `src/lib/websiteBookingSettings.ts`, lines 22–24; `getSettings` in the Booking Settings API.

Reading `{"advancePercent":101,"policyText":"saved custom policy"}` returns a 50% default advance and empty policy text instead of reporting invalid stored configuration. The administrator cannot distinguish a missing record from a corrupt/incompatible saved draft. The database record is not immediately deleted, but a subsequent save can overwrite it with the displayed defaults. This currently affects drafts only; it must not become the behavior for published financial policies. Default only a genuinely absent record; surface validation failure and prevent readiness until reviewed.

## Findings: specification model only

### 4. Third distinct full capture is under-refunded

Location: `scripts/mock-website-booking-plan.mjs`, excess refund call around line 139 and existing-key return at line 144.

Three distinct ₹2,000 captures on a ₹2,000 stay produce ₹6,000 paid. The excess claim remains ₹2,000 from the second capture instead of ₹4,000. A single fixed `excess` key cannot represent new excess from additional captures. The future implementation needs per-capture refund ownership/reservations and reconciliation of incremental excess, not this model shortcut.

### 5. Second unfulfillable late capture is not fully reserved for refund

Location: model `confirm()` operational refund and the existing-key return in `refund()`.

Expire the original hold, sell its inventory to another booking, then receive two distinct ₹1,000 captures for the original booking. Paid becomes ₹2,000, but the operational refund claim stays ₹1,000. Each captured payment that cannot be fulfilled needs its own full operational refund claim.

### 6. Failed refund retry can over-reserve captured money

Location: model `retryFailedRefund()`, lines 156–159.

Fail the original ₹1,000 refund, reserve a replacement ₹1,000 operation, then retry the original failed operation. Both become pending, claiming ₹2,000 against ₹1,000 captured. Retry must atomically revalidate remaining capture ownership/capacity and cannot revive an operation whose funds are already reserved elsewhere.

## Executed checks

| Check | Result | What it proves |
| --- | --- | --- |
| `npx vitest run` | 92 files / 1,415 tests passed | Repository regression coverage, including 67 foundation unit/action tests and 9 new real-SQLite persistence workflows |
| `node scripts/mock-website-booking-plan.mjs` | 66 scenarios passed | Original independent in-memory specification scenarios only |
| `node scripts/review-website-booking.mjs` | **Exit 1: 4 probe groups passed, 6 findings** | Actual helper edge cases plus previously untested sequences against the exact existing model |
| `npx tsc --noEmit` | Passed | Type check, including the new persistence tests |
| `npm run build` | Passed; existing unrelated hook/image lint warnings remain | Production compilation/static generation, not payment certification |
| `git diff --check` / `git diff --cached --check` | Passed | Whitespace/diff integrity |

A successful build is not a payment certification. The build emitted no new warnings in the booking foundation/review test files.

The new SQLite tests use the actual schema columns, Drizzle queries and application API handlers on disposable `:memory:` databases. They exercise draft round trips, repeated identical saves, unrelated-setting preservation, rejection without mutation, SQL-bound policy text, manager/Pi denial, persisted external → native → blank routing, historically unsafe URLs, and actual storage failure. Authentication is stubbed with dummy data, so they do not certify real credential verification. They do not test D1 concurrency, native reservations, provider callbacks or real payments.

Adversarial passing groups cover ASCII control-character URLs, scheme/credential attacks, test/live credential-presence combinations without secret serialization or checkout activation, and percentage boundaries/non-finite inputs. The extra payment probes load the existing specification model in memory; they neither fix it nor replace it with a new payment implementation.

## Scope and release gates

- No production behavior fixes were applied in this review-only request. The two added executable review/test files and this report provide reproducible evidence.
- No live configuration, deployment, migration, real charge/refund, external message, or production database was touched. `.DS_Store` was left alone.
- Internal redirect destinations currently use the canonical production origin by design. Local/staging redirect tests must not be mistaken for isolated Razorpay test-mode checkout; no authenticated native payment preview exists yet.
- No new browser end-to-end payment check was performed; the earlier foundation browser smoke check cannot exercise a payment flow that is absent.
- Before launch: fix the actual helper findings and strengthen the model; implement the remaining plan; then test the real SQLite/D1 lifecycle and payment-provider sandbox with duplicate/out-of-order events, lost responses, late captures, competing inventory writers, per-payment refund caps and settlement uniqueness. Keep native payments disabled until those checks pass.
