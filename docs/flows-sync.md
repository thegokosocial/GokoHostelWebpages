# Cloudflare ↔ Pi sync and failover

**Git-safe.** Auth: `ADMIN_PASSWORD` or `SYNC_SECRET`. Pi tunnel `https://pi.gokohostel.com`. SSH: [secrets-and-access.md](secrets-and-access.md). Worker secret `PI_PUBLIC_URL`. Optional `SYNC_SECRET` (sync also accepts admin password).

Code: `src/app/api/sync/route.ts`, `src/lib/syncEngine.ts`. UI: Management → Server Sync.

---

## Auth

`ADMIN_PASSWORD` **or** `SYNC_SECRET`. Pi remote: `CLOUDFLARE_SITE_URL` default `https://www.gokohostel.com`. Cloudflare remote: `PI_PUBLIC_URL`.

---

## What syncs

**With soft-delete:** checkins, dorms, beds, bookings, menu_categories, menu_items, food_orders, accounts, vendors, employees, expenses, daily_income, users, tasks, platform_payment_profiles. Task follower usernames and notes/shopping JSON travel inside the task row, so they use the same last-write-wins task conflict behavior and require no separate relation remapping.

**Append-only:** bed_history, food_order_items, order_modifications, salary_payments, daily_ledger, qr_history, booking_cycle_snapshots, booking_payment_events, guest_receipts, cash_payment_events, platform_receivable_entries, platform_settlements, platform_settlement_allocations. OTA and ordinary cash payment events merge by stable event/sync identity rather than last-write-wins. Cash-event polymorphic food/booking source IDs are remapped after their parent rows. After OTA event sync and FK remapping, both runtimes rebuild the affected booking-cycle projections. Journal-backed receipts resolve their booking through the stable payment-event link; older booking receipts still use booking sync-ID mapping. Website native checkout/payment tables and `gateway_settlement_allocations` are Cloudflare-only and omitted from Pi sync.

Payment events and cycle snapshots use the booking's existing `sync_id` to stay identical across runtimes. Before using OTA postpaid collection, ensure the booking has completed the normal Server Sync **Backfill Sync IDs** workflow and the identities are synchronized. A missing identity returns a recoverable conflict; the payment path does not invent a runtime-local ID. `0069_ota_postpaid_booking_payments.sql` seeds legacy payment openings only for rows with explicit pay-at-hotel terms, explicit INR, and an existing stable booking identity.

**Settings keys only:** `image_validation`, `guest_min_age`, `guest_max_age`, `show_dob_in_records`, `log_level`, `food_tax_rate`, `booking_tax_rate`, `food_kitchen_hours`, `food_tab_limit`, `food_kitchen_busy`, `food_confirm_with_guest`, `food_kannada_labels`, `food_cafe_tables`, `primary_server`, `food_online_receipt_account_id`, `room_online_receipt_account_id`.

**Drift:** live Kannada flags are `food_kannada_kitchen_print` and `food_kannada_kitchen_display`. Sync still uses the old key `food_kannada_labels`. Those print/display keys do **not** sync.

**Never:** CMS `site_*`, **split_***, audit/system logs, api_stats, rate_scrapes, push, reviews, channel manager, inventory/rates/blocks, sync meta tables, **R2 objects**. Drive URLs on checkin and task rows *do* sync (files stay in Google). Task status/text works offline; attachment uploads require network access.

Pi migrator stamps `0035_site_cms.sql`, `0041_splits.sql`, `0081_split_expense_idempotency.sql`, and `0064_food_bill_share_tokens.sql` without applying SQL (Cloudflare-only). It **does** apply `0042_booking_stay_payments.sql` and `0069_ota_postpaid_booking_payments.sql` (booking payment terms/currency, journal, and cycle snapshots are part of the synced booking finance path). Splits nav is hidden on Pi.

Integer PKs remapped via `sync_id` UUID + `sync_id_map`. FK remap table in `syncEngine.ts`. Conflicts → `sync_conflicts`.

```mermaid
sequenceDiagram
  participant Pi
  participant CF as Worker
  Pi->>CF: pull since cursor
  CF-->>Pi: bundles
  Pi->>Pi: apply + remap FKs
  Pi->>CF: push local changes
  CF-->>Pi: idMappings / conflicts
```

Pull page size default 200. Heartbeat timeout 8s.

---

## Failover (LAN)

When hostel WAN dies, Pi dnsmasq can make `gokohostel.com` resolve to the Pi. Router DHCP primary DNS = `192.168.0.80`. Toggle: Server Sync → Local DNS Failover. Self-signed cert → browser warning. Log `/var/log/goko-failover.log`.

**Public internet** still hits the Worker, not the Pi. Tunnel is for **you** to reach the Pi from anywhere (`pi.gokohostel.com`).

---

## Pi app update

```bash
# SSH: secrets-and-access.md
ssh goko@goko-server.local
cd /home/goko/goko-web
git pull && npm run db:migrate:pi && npm run build:pi && pm2 restart goko
```

`db:migrate:pi` skips 0035 CMS. `NEXT_PUBLIC_GOKO_RUNTIME` must be set at **build** time.
