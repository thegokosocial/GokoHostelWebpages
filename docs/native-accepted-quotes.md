# Durable native accepted quotes — internal scope

## What is implemented

Migration `0060_native_accepted_quotes.sql`, `src/lib/nativeAcceptedQuote.ts` and `nativeAcceptedQuotes` schema bind one protected accepted quote to one physical inventory hold. This closes quote snapshot persistence at the internal service layer. It does not create a provisional PMS booking, verify capture, fulfil a reservation, submit a refund, update Accounts/Aiosell or enable guest checkout.

New acceptance requires `GOKO_NATIVE_HOLD_INTERNAL_ENABLED=true`, cloud runtime, authenticated original hold ownership, all six hold guards and all three quote guards. No public/staff route or permission key is added. No production or Pi migration has been run. The table is absent from sync allowlists; Pi is rejected before database access.

## Acceptance workflow

1. A trusted server caller supplies the original request key/owner token and authoritative server rates plus published accepted policy/version. These rate/policy sources still need implementation; never pass guest-submitted prices/policy directly into this service.
2. Verify ownership through the existing hold recovery service. Recalculate and canonicalize the quote using the validated quote calculator.
3. Recover an existing accepted quote before checking creation opt-in or current physical configuration. Identical retries return the original ID/time/snapshot. Changed accepted terms return 409; neither release/expiry nor disabling new work can reprice the contract.
4. For new work, verify hold and quote schema/guard installations. Dates must match the original hold. The quote's unit keys must exactly cover the held physical IDs using the existing sellable-unit grouping; require complete Double pairs. Missing guard/schema/bed lookup failures return sanitized 503 outcomes.
5. Insert one accepted JSON snapshot with a unique hold FK. The SQL insert trigger checks the same hold is still active and unexpired using database time and that snapshot dates match. Release/expiry after application preflight cannot permit new acceptance. Concurrent acceptance deduplicates at the unique hold key; different winning terms conflict.
6. SQL update/delete guards prevent rewriting or discarding accepted evidence. The FK retains its referenced hold. Retention is deliberate; any future archive/purge policy must preserve required evidence and explicitly review these guards.
7. If insertion loses its response, query the original hold's quote before reporting an unknown result. Matching committed evidence is recovered without another record; absent evidence returns 503 (or a definite closed-hold conflict when SQL proves closure). Call `getNativeAcceptedQuote` with the original identity before retrying/replacing any request.

## Read-only recovery

`getNativeAcceptedQuote` verifies original hold ownership, reads the accepted row and revalidates/recalculates its copied evidence. Stored computed totals/currency must match recalculation; malformed/tampered evidence returns sanitized 503/manual review rather than activating Checkout. Recovery survives disable, release and expiry but returns `nativeCheckoutReady: false`. Recoverable accepted evidence does not mean inventory is still held, a payment is captured or a booking is confirmed.

## Storage and evidence boundary

`native_accepted_quotes`: `id` (non-null UUID PK), `hold_id` (non-null unique FK), `quote_json` (non-null JSON object), `accepted_at` (non-null epoch seconds). Raw owner tokens, payment credentials and guest/card PII are not stored by this service. Column/trigger presence checks detect incomplete migration setup, not arbitrary altered trigger bodies/constraints; migration integrity remains an operational prerequisite.

The unit mapping is checked in application preflight, while active-hold/date matching is atomic in SQL. Physical bed reconfiguration, aggregate category/online quotas and separate Pi writers remain unsolved release gates. No full guest/API contract or immutable provisional booking exists yet.

## Tests and remaining work

Final local validation (17 September 2026): **98 files / 1,624 tests passed**, including 18 accepted-quote and 10 local D1/workerd tests. Post-build TypeScript, source lint, production build and diff checks passed. Existing unrelated hook/image warnings and legacy ESLint configuration deprecation remain. Nothing committed, pushed, deployed or charged; migrations were applied only to disposable test databases.

Eighteen code-backed SQLite cases cover immutable original terms, 20-way identical/competing acceptance, changed policies, owner/Pi/default gates, date/unit mismatches, release/database-clock expiry, missing schema/guards, retained evidence, corrupt totals, committed-insert response loss and fresh-wrapper recovery. Local D1 executes the exact 0060 migration and verifies concurrent acceptance, SQL immutability and recovery after release/disable. Picker/rate inputs and Razorpay remain fixture/mocked data; this is not merchant/browser/deployed-D1 certification.

Remaining: server policy publishing/rate-plan loading, shared quota/Pi coordination, guest page/APIs and secure status capabilities, provisional PMS booking and atomic hold transfer, guest-bound verified payment attempts, production refund claims/submission/recovery, scheduled recovery/durable notifications/Aiosell delivery, settlements and permissioned operational review. Live checkout remains disabled. See [release gates](review-payment-production-readiness-2026-09-17.md).
