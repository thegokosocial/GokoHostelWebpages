# Admin regression matrix

**Git-safe.**

This is the maintainer map for expanding Admin regression coverage. The surface contract test catches missing inventory/auth/docs wiring, and `admin-route-smoke.test.ts` automatically exercises every discovered POST route/action through the authentication boundary. Domain suites below hold the behavior assertions. Every new Admin page, API action, permission, or workflow must add a focused success/validation/failure test to the closest domain suite in the same change.

| Admin surface | Main API/domain | Existing coverage | Required regression cases when changed |
|---|---|---|---|
| Dashboard, Records, Beds, Timeline | `checkins`, attendance, tasks | `booking-dashboard`, `walkin-booking-resolution`, `tasks-api`, `rbac` | page access, role matrix, date/identity boundaries, mutation audit, failure/retry |
| Bookings | `bookings`, booking payments/settings | `booking-scenarios`, `booking-payment-journal`, `booking-message-templates`, `rbac` | create/edit/cancel/check-in/out, payment/refund, stale revision, duplicate/idempotency, audit |
| Inventory | `inventory`, Aiosell sync | `inventory-grid`, `inventory-availability`, `rate-autopush`, channel workflow suites | range edges, bulk mutation, sync acceptance/failure, retry, role access |
| Food Orders | `food-orders`, food menu/settings | `food-tab-api-workflows`, `food-payment-allocation`, `food-payment-balance`, `food-walkin-identity`, `bill-share`, `food-order-editing-migration`, `food-market-pricing-admin`, `food-bill-api`, `food-payment-d1.integration`, kitchen suites | place/edit/void/discount/pay/revert, one-save batched edits, idempotent retries, preserve gross collection through additions/removals, exact audited refunds, stale payment-status recovery, normalized walk-in name+phone separation across summary/history/accounts/Combined Bill, ambiguous public bill selection without pre-selection order disclosure, scoped/legacy bill links, all unpaid hostel/walk-in Combined Bill options, partial vs full payment, oldest-first bill allocation, bank account selection, kitchen status, audit, role access |
| Expenditure and Accounts | `expenses`, `account-settings` | `reconciliation-*`, `income-enhancements`, `account-categories` | CRUD, validation, account scope, reconciliation, duplicate submission, audit, role access |
| Splits | `splits` | `splits`, `splits-wiring`, `rbac` | group/member/expense/settlement lifecycle, balance math, delete guards, Pi behavior, role access |
| Reviews | `reviews` | review and WhatsApp suites | list/send/edit/reset, invalid phone, rate limits, settings, role access |
| Management: Menu/Food/Bill settings | `food` | food/menu suites | CRUD, availability, upload/branding, validation, role access |
| Management: CMS/Quick Links/QR | `website`, `quick-links`, `qr-history` | `website-cms-api`, `site-cms`, `qr-history-api` | auth/RBAC, CRUD, upload validation, public rendering, safe deletion |
| Management: Channel/Booking/Razorpay | channel-manager, booking-settings/payments | Aiosell, `booking-settings-api`, and native payment suites | admin-only gate, stale config, provider failure, retry/idempotency, audit |
| Management: Users/Audit/Logs/Health/Backup/Attendance/Tasks | checkins, attendance, tasks, admin settings | `rbac`, `tasks-api`, audit/log suites | admin/manager/staff matrix, ownership, destructive confirmation, retention, failure states |

## Minimum test shape for a new action

At minimum, cover the successful operation, unauthenticated `401`, unauthorized role/permission `403`, invalid input `400`/`422`, duplicate or replay behavior for non-idempotent mutations, and the representative database/provider failure. For destructive or financial actions also assert the audit/event record and that a failed request does not partially mutate data. Add a Playwright journey only when the behavior crosses pages or depends on responsive/user-visible navigation.
