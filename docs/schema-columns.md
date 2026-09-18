# Schema columns

**Git-safe.** Generated from `src/db/schema.ts`. Money columns are integer **paise**, except `bookings` amounts which are **rupees**. Sync extras (`sync_id`, `sync_updated_at`, `sync_source`, often `deleted_at`) are listed when the table spreads `syncColumns` / `syncColumnsWithDelete`.

Source of truth if this file lags: `src/db/schema.ts`. Role of each table: [data-model.md](data-model.md). FKs: [relationships.md](relationships.md).

| Table | Columns |
|-------|---------|
| `checkins` | 33 |
| `dorms` | 7 |
| `beds` | 17 |
| `bed_history` | 10 |
| `settings` | 4 |
| `api_stats` | 6 |
| `users` | 13 |
| `tasks` | 21 |
| `audit_log` | 8 |
| `system_logs` | 7 |
| `rate_scrapes` | 9 |
| `bookings` | 46 |
| `menu_categories` | 13 |
| `menu_items` | 19 |
| `food_orders` | 31 |
| `food_order_items` | 11 |
| `food_bill_share_tokens` | 6 |
| `order_modifications` | 12 |
| `qr_history` | 9 |
| `accounts` | 15 |
| `vendors` | 11 |
| `employees` | 13 |
| `salary_payments` | 12 |
| `daily_income` | 15 |
| `daily_ledger` | 15 |
| `expenses` | 21 |
| `push_subscriptions` | 6 |
| `sync_log` | 10 |
| `sync_conflicts` | 13 |
| `review_requests` | 17 |
| `review_feedback` | 10 |
| `sync_id_map` | 5 |
| `channel_config` | 16 |
| `room_type_mapping` | 6 |
| `rate_plan_mapping` | 5 |
| `daily_rates` | 19 |
| `channel_sync_log` | 13 |
| `booking_bed_assignments` | 10 |
| `booking_history` | 6 |
| `bed_type_config` | 6 |
| `channels` | 5 |
| `channel_rates` | 11 |
| `bed_blocks` | 11 |
| `inventory_overrides` | 8 |
| `inventory_dirty` | 4 |
| `site_events` | 10 |
| `site_community_spaces` | 8 |
| `site_page_copy` | 3 |
| `split_members` | 10 |
| `split_groups` | 4 |
| `split_group_members` | 3 |
| `split_expenses` | 11 |
| `split_expense_shares` | 5 |
| `split_settlements` | 12 |

## `checkins`

| SQL column | Type | Notes |
|------------|------|-------|
| `id` | integer | PK |
| `submitted_at` | text | NOT NULL |
| `arrival_date` | text | NOT NULL |
| `arrival_time` | text |  |
| `name` | text | NOT NULL |
| `persons` | text |  |
| `contact` | text | NOT NULL |
| `staying_days` | text |  |
| `coming_from` | text |  |
| `nationality` | text |  |
| `emergency_name` | text |  |
| `emergency_phone` | text |  |
| `id_type` | text |  |
| `id_card_link` | text |  |
| `visa_link` | text |  |
| `verified` | text | default "pending" |
| `status` | text | NOT NULL default "active" |
| `checked_out_at` | text | default "" |
| `form_c_data` | text | default "" |
| `booking_platform` | text | default "" |
| `booking_id` | text | default "" |
| `booking_resolution` | text | default "pending" |
| `booking_linked_ref` | text | default "" |
| `booking_resolution_at` | text | default "" |
| `booking_resolution_by` | text | default "" |
| `dob` | text | default "" |
| `dob_from_id` | text | default "" |
| `vibe_matched` | integer | NOT NULL default 0 |
| `created_month` | text | NOT NULL |
| `sync_id` | text |  |
| `sync_updated_at` | text |  |
| `sync_source` | text | default cloudflare |
| `deleted_at` | text |  |

## Platform receivables tables

`platform_payment_profiles` stores the platform key, virtual account, currency, tax treatment, deduction policy, and active flag. `platform_receivable_entries` stores immutable booking-cycle event amounts in paise (`gross_paise`, `tax_charged_paise`, `tax_withheld_paise`, `commission_paise`, `tds_paise`, `tcs_paise`, `other_deductions_paise`, `expected_net_paise`). `platform_settlements` stores the real bank account, receipt id, payout date, and actual amount in paise. `platform_settlement_allocations` stores each booking-cycle allocation and variance. All four tables carry sync metadata; the profile is soft-deletable and the financial journals are append-only.

## `dorms`

| SQL column | Type | Notes |
|------------|------|-------|
| `id` | integer | PK |
| `name` | text | NOT NULL |
| `created_at` | text | NOT NULL |
| `sync_id` | text |  |
| `sync_updated_at` | text |  |
| `sync_source` | text | default cloudflare |
| `deleted_at` | text |  |

## `beds`

| SQL column | Type | Notes |
|------------|------|-------|
| `id` | integer | PK |
| `dorm_id` | integer | NOT NULL FK |
| `dorm_name` | text | NOT NULL |
| `bed_id` | text | NOT NULL |
| `position` | text | NOT NULL default "Lower" |
| `type` | text | NOT NULL default "Bunk" |
| `status` | text | NOT NULL default "available" |
| `guest_name` | text | default "" |
| `guest_contact` | text | default "" |
| `checkin_date` | text | default "" |
| `expected_checkout` | text | default "" |
| `staying_days` | text | default "" |
| `is_blocked` | integer | NOT NULL default 0 |
| `sync_id` | text |  |
| `sync_updated_at` | text |  |
| `sync_source` | text | default cloudflare |
| `deleted_at` | text |  |

## `bed_history`

| SQL column | Type | Notes |
|------------|------|-------|
| `id` | integer | PK |
| `bed_id_label` | text | NOT NULL |
| `dorm_name` | text | NOT NULL |
| `action` | text | NOT NULL |
| `guest_name` | text | default "" |
| `guest_contact` | text | default "" |
| `created_at` | text | NOT NULL |
| `sync_id` | text |  |
| `sync_updated_at` | text |  |
| `sync_source` | text | default cloudflare |

## `settings`

| SQL column | Type | Notes |
|------------|------|-------|
| `key` | text | PK |
| `value` | text | NOT NULL |
| `sync_updated_at` | text |  |
| `sync_source` | text | default "cloudflare" |

## `api_stats`

| SQL column | Type | Notes |
|------------|------|-------|
| `id` | integer | PK |
| `month` | text | NOT NULL |
| `vision` | integer | NOT NULL default 0 |
| `sheets` | integer | NOT NULL default 0 |
| `drive` | integer | NOT NULL default 0 |
| `total` | integer | NOT NULL default 0 |

## `users`

| SQL column | Type | Notes |
|------------|------|-------|
| `id` | integer | PK |
| `username` | text | NOT NULL |
| `password_hash` | text | NOT NULL |
| `display_name` | text | NOT NULL |
| `role` | text | NOT NULL default "staff" |
| `permissions` | text | NOT NULL default "{}" |
| `created_at` | text | NOT NULL |
| `created_by` | text | default "" |
| `is_system` | integer | NOT NULL default 0 |
| `sync_id` | text |  |
| `sync_updated_at` | text |  |
| `sync_source` | text | default cloudflare |
| `deleted_at` | text |  |

## `tasks`

| SQL column | Type | Notes |
|------------|------|-------|
| `id` | integer | PK |
| `title` | text | NOT NULL |
| `description` | text | NOT NULL default "" |
| `task_type` | text | general or purchase |
| `category` | text | Optional free-text category |
| `priority` | text | low / normal / high / urgent |
| `due_date` | text | Optional YYYY-MM-DD |
| `assignee_user_id` | integer | Optional FK to `users`; null means unassigned |
| `status` | text | todo / in_progress / blocked / done |
| `note` | text | Current shared note |
| `attachments` | text | JSON Drive attachment metadata |
| `completed_at` | text | Completion timestamp |
| `completed_by` | text | Completion actor |
| `created_by` | text | Actor username/display name |
| `updated_by` | text | Actor username/display name |
| `created_at` | text | NOT NULL |
| `updated_at` | text | NOT NULL |
| `sync_id` | text |  |
| `sync_updated_at` | text |  |
| `sync_source` | text | default cloudflare |
| `deleted_at` | text | Soft archive timestamp |

## `audit_log`

| SQL column | Type | Notes |
|------------|------|-------|
| `id` | integer | PK |
| `timestamp` | text | NOT NULL |
| `user_id` | integer |  |
| `username` | text | NOT NULL |
| `action` | text | NOT NULL |
| `target` | text | default "" |
| `details` | text | default "" |
| `ip_address` | text | default "" |

## `system_logs`

| SQL column | Type | Notes |
|------------|------|-------|
| `id` | integer | PK |
| `timestamp` | text | NOT NULL |
| `level` | text | NOT NULL |
| `source` | text | default "" |
| `message` | text | NOT NULL |
| `details` | text | default "" |
| `request_id` | text | default "" |

## `rate_scrapes`

| SQL column | Type | Notes |
|------------|------|-------|
| `id` | integer | PK |
| `city` | text | NOT NULL |
| `start_date` | text | NOT NULL |
| `end_date` | text | NOT NULL |
| `property_type` | text | default "hostels" |
| `status` | text | NOT NULL default "pending" |
| `results` | text | default "" |
| `created_at` | text | NOT NULL |
| `completed_at` | text | default "" |

## `bookings`

| SQL column | Type | Notes |
|------------|------|-------|
| `id` | integer | PK |
| `guest_name` | text | NOT NULL |
| `contact` | text | default "" |
| `platform` | text | NOT NULL |
| `booking_ref` | text | default "" |
| `checkin_date` | text | NOT NULL |
| `checkout_date` | text | default "" |
| `room_type` | text | default "" |
| `persons` | integer | NOT NULL default 1 |
| `payment_status` | text | default "unknown" |
| `special_requests` | text | default "" |
| `status` | text | NOT NULL default "received" |
| `source` | text | default "manual" |
| `property` | text | default "goko_hostel" |
| `raw_data` | text | default "" |
| `created_at` | text | NOT NULL |
| `synced_at` | text | default "" |
| `amount_before_tax` | integer | default 0 |
| `amount_tax` | integer | default 0 |
| `amount_total` | integer | default 0 |
| `amount_paid` | integer | default 0 — rupees; prepaid ingest 0, calendar check-in copies total as online |
| `payment_method` | text | NOT NULL default "" — cash / online / split |
| `cash_received` | integer | NOT NULL default 0 — split cash rupees, or cash-tab tender |
| `change_given` | integer | NOT NULL default 0 |
| `amount_refunded` | integer | NOT NULL default 0 — cancel-after-check-in; does not reduce `amount_paid` |
| `refund_method` | text | NOT NULL default "" |
| `refund_cash` | integer | NOT NULL default 0 |
| `refunded_at` | text | NOT NULL default "" |
| `refunded_by` | text | NOT NULL default "" |
| `nightly_rate` | integer | default 0 |
| `currency` | text | default "INR" |
| `email` | text | default "" |
| `cm_booking_id` | text | default "" |
| `goko_booking_id` | text | default "" |
| `rate_plan` | text | default "" |
| `hold_expires_at` | text | default "" |
| `cancelled_at` | text | default "" |
| `cancelled_by` | text | default "" |
| `checked_in_at` | text | default "" |
| `checked_in_by` | text | default "" |
| `checked_out_at` | text | default "" |
| `checked_out_by` | text | default "" |
| `sync_id` | text |  |
| `sync_updated_at` | text |  |
| `sync_source` | text | default cloudflare |
| `deleted_at` | text |  |

## `menu_categories`

| SQL column | Type | Notes |
|------------|------|-------|
| `id` | integer | PK |
| `name` | text | NOT NULL |
| `name_kannada` | text | default "" |
| `icon` | text | NOT NULL default "🍽️" |
| `description` | text | default "" |
| `display_order` | integer | NOT NULL default 0 |
| `is_active` | integer | NOT NULL default 1 |
| `track_inventory_default` | integer | NOT NULL default 0 |
| `discount_exempt` | integer | NOT NULL default 0 |
| `sync_id` | text |  |
| `sync_updated_at` | text |  |
| `sync_source` | text | default cloudflare |
| `deleted_at` | text |  |

## `menu_items`

| SQL column | Type | Notes |
|------------|------|-------|
| `id` | integer | PK |
| `category_id` | integer | NOT NULL FK |
| `name` | text | NOT NULL |
| `name_kannada` | text | default "" |
| `description` | text | default "" |
| `price` | integer | NOT NULL default 0 |
| `price_text` | text | default "" |
| `tags` | text | NOT NULL default "[]" |
| `ingredients` | text | NOT NULL default "[]" |
| `image_url` | text | default "" |
| `is_available` | integer | NOT NULL default 1 |
| `display_order` | integer | NOT NULL default 0 |
| `track_inventory` | integer | NOT NULL default 0 |
| `stock_quantity` | integer | NOT NULL default 0 |
| `low_stock_threshold` | integer | NOT NULL default 5 |
| `sync_id` | text |  |
| `sync_updated_at` | text |  |
| `sync_source` | text | default cloudflare |
| `deleted_at` | text |  |

## `food_orders`

| SQL column | Type | Notes |
|------------|------|-------|
| `id` | integer | PK |
| `order_number` | text | NOT NULL |
| `idempotency_key` | text |  |
| `guest_type` | text | NOT NULL default "walkin" |
| `checkin_id` | integer | FK |
| `guest_name` | text | NOT NULL |
| `guest_phone` | text | NOT NULL default "" |
| `room_info` | text | default "" |
| `table_number` | text | default "" |
| `special_instructions` | text | default "" |
| `subtotal` | integer | NOT NULL default 0 |
| `tax` | integer | NOT NULL default 0 |
| `total` | integer | NOT NULL default 0 |
| `status` | text | NOT NULL default "placed" |
| `payment_status` | text | NOT NULL default "pending" |
| `payment_method` | text | default "" |
| `paid_by` | text | default "" |
| `cash_received` | integer | default 0 |
| `change_given` | integer | default 0 |
| `discount` | integer | NOT NULL default 0 |
| `discount_reason` | text | default "" |
| `discount_by` | text | default "" |
| `cancelled_reason` | text | default "" |
| `cancelled_at` | text | default "" |
| `created_by` | text | NOT NULL default "guest" |
| `created_at` | text | NOT NULL |
| `updated_at` | text | NOT NULL |
| `sync_id` | text |  |
| `sync_updated_at` | text |  |
| `sync_source` | text | default cloudflare |
| `deleted_at` | text |  |

## `food_order_items`

| SQL column | Type | Notes |
|------------|------|-------|
| `id` | integer | PK |
| `order_id` | integer | NOT NULL FK |
| `menu_item_id` | integer | NOT NULL FK |
| `item_name` | text | NOT NULL |
| `item_price` | integer | NOT NULL default 0 |
| `quantity` | integer | NOT NULL default 1 |
| `line_total` | integer | NOT NULL default 0 |
| `pricing_status` | text | NOT NULL default "fixed" (`fixed` / `pending`) |
| `notes` | text | NOT NULL default ""; optional Set-price custom badge (max 24) |
| `status` | text | NOT NULL default "active" |
| `sync_id` | text |  |
| `sync_updated_at` | text |  |
| `sync_source` | text | default cloudflare |

## `food_bill_share_tokens`

Cloudflare-only (migration 0064). Not Pi-synced; Pi migrator stamps the filename without applying SQL.

| SQL column | Type | Notes |
|------------|------|-------|
| `token` | text | PK |
| `phone` | text | NOT NULL (normalized) |
| `checkin_id` | integer | optional |
| `expires_at` | text | NOT NULL ISO |
| `created_by` | text | NOT NULL default "" |
| `created_at` | text | NOT NULL |

## `order_modifications`

| SQL column | Type | Notes |
|------------|------|-------|
| `id` | integer | PK |
| `order_id` | integer | NOT NULL FK |
| `action` | text | NOT NULL |
| `item_id` | integer |  |
| `old_value` | text | default "" |
| `new_value` | text | default "" |
| `reason` | text | default "" |
| `modified_by` | text | NOT NULL |
| `created_at` | text | NOT NULL |
| `sync_id` | text |  |
| `sync_updated_at` | text |  |
| `sync_source` | text | default cloudflare |

## `qr_history`

| SQL column | Type | Notes |
|------------|------|-------|
| `id` | integer | PK |
| `name` | text | NOT NULL |
| `config` | text | NOT NULL |
| `preview_data_url` | text | default "" |
| `created_by` | text | default "" |
| `created_at` | text | NOT NULL |
| `sync_id` | text |  |
| `sync_updated_at` | text |  |
| `sync_source` | text | default cloudflare |

## `accounts`

| SQL column | Type | Notes |
|------------|------|-------|
| `id` | integer | PK |
| `name` | text | NOT NULL |
| `nickname` | text | default "" |
| `bank_name` | text | default "" |
| `account_type` | text | NOT NULL default "savings" |
| `account_number` | text | default "" |
| `ifsc_code` | text | default "" |
| `is_default` | integer | NOT NULL default 0 |
| `is_active` | integer | NOT NULL default 1 |
| `opening_balance` | integer | NOT NULL default 0 |
| `created_at` | text | NOT NULL |
| `sync_id` | text |  |
| `sync_updated_at` | text |  |
| `sync_source` | text | default cloudflare |
| `deleted_at` | text |  |

## `vendors`

| SQL column | Type | Notes |
|------------|------|-------|
| `id` | integer | PK |
| `name` | text | NOT NULL |
| `category` | text | default "" |
| `contact_phone` | text | default "" |
| `notes` | text | default "" |
| `is_active` | integer | NOT NULL default 1 |
| `created_at` | text | NOT NULL |
| `sync_id` | text |  |
| `sync_updated_at` | text |  |
| `sync_source` | text | default cloudflare |
| `deleted_at` | text |  |

## `employees`

| SQL column | Type | Notes |
|------------|------|-------|
| `id` | integer | PK |
| `name` | text | NOT NULL |
| `role` | text | default "" |
| `phone` | text | default "" |
| `salary` | integer | NOT NULL default 0 |
| `salary_frequency` | text | NOT NULL default "monthly" |
| `bank_account` | text | default "" |
| `is_active` | integer | NOT NULL default 1 |
| `created_at` | text | NOT NULL |
| `sync_id` | text |  |
| `sync_updated_at` | text |  |
| `sync_source` | text | default cloudflare |
| `deleted_at` | text |  |

## `salary_payments`

| SQL column | Type | Notes |
|------------|------|-------|
| `id` | integer | PK |
| `employee_id` | integer | NOT NULL FK |
| `amount` | integer | NOT NULL |
| `month` | text | NOT NULL |
| `account_id` | integer | FK |
| `payment_method` | text | NOT NULL default "cash" |
| `paid_at` | text | NOT NULL |
| `notes` | text | default "" |
| `created_by` | text | NOT NULL |
| `sync_id` | text |  |
| `sync_updated_at` | text |  |
| `sync_source` | text | default cloudflare |

## `daily_income`

| SQL column | Type | Notes |
|------------|------|-------|
| `id` | integer | PK |
| `date` | text | NOT NULL |
| `account_id` | integer | FK |
| `type` | text | NOT NULL default "cash" |
| `amount` | integer | NOT NULL |
| `source` | text | NOT NULL default "stay" |
| `source_detail` | text | default "" |
| `description` | text | default "" |
| `food_revenue_auto` | integer | NOT NULL default 0 |
| `created_by` | text | NOT NULL |
| `created_at` | text | NOT NULL |
| `sync_id` | text |  |
| `sync_updated_at` | text |  |
| `sync_source` | text | default cloudflare |
| `deleted_at` | text |  |

## `daily_ledger`

| SQL column | Type | Notes |
|------------|------|-------|
| `id` | integer | PK |
| `date` | text | NOT NULL |
| `account_id` | integer | FK |
| `opening_balance` | integer | NOT NULL default 0 |
| `total_income` | integer | NOT NULL default 0 |
| `total_expense` | integer | NOT NULL default 0 |
| `expected_closing` | integer | NOT NULL default 0 |
| `actual_closing` | integer |  |
| `is_reconciled` | integer | NOT NULL default 0 |
| `reconciled_by` | text | default "" |
| `reconciled_at` | text | default "" |
| `notes` | text | default "" |
| `sync_id` | text |  |
| `sync_updated_at` | text |  |
| `sync_source` | text | default cloudflare |

## `expenses`

| SQL column | Type | Notes |
|------------|------|-------|
| `id` | integer | PK |
| `amount` | integer | NOT NULL |
| `category` | text | NOT NULL |
| `custom_category` | text | default "" |
| `purpose` | text | NOT NULL default "" |
| `bill_image_link` | text | default "" |
| `vendor_id` | integer |  |
| `account_id` | integer |  |
| `task_id` | integer | Optional FK to `tasks`; unique when present |
| `payment_method` | text | default "cash" |
| `main_category` | text | default "stay_expense" |
| `sub_category` | text | default "" |
| `created_by` | text | NOT NULL |
| `updated_by` | text | default "" |
| `created_at` | text | NOT NULL |
| `updated_at` | text | default "" |
| `created_month` | text | NOT NULL |
| `sync_id` | text |  |
| `sync_updated_at` | text |  |
| `sync_source` | text | default cloudflare |
| `deleted_at` | text |  |

## `push_subscriptions`

| SQL column | Type | Notes |
|------------|------|-------|
| `id` | integer | PK |
| `endpoint` | text | NOT NULL |
| `key_p256dh` | text | NOT NULL |
| `key_auth` | text | NOT NULL |
| `user_label` | text | default "" |
| `created_at` | text | NOT NULL |

## `sync_log`

| SQL column | Type | Notes |
|------------|------|-------|
| `id` | integer | PK |
| `direction` | text | NOT NULL |
| `status` | text | NOT NULL default "started" |
| `records_pulled` | integer | NOT NULL default 0 |
| `records_pushed` | integer | NOT NULL default 0 |
| `conflicts_found` | integer | NOT NULL default 0 |
| `error_message` | text | default "" |
| `started_at` | text | NOT NULL |
| `completed_at` | text | default "" |
| `details` | text | default "" |

## `sync_conflicts`

| SQL column | Type | Notes |
|------------|------|-------|
| `id` | integer | PK |
| `table_name` | text | NOT NULL |
| `sync_id` | text | NOT NULL |
| `conflict_type` | text | NOT NULL default "update_update" |
| `cloud_data` | text | NOT NULL default "{}" |
| `pi_data` | text | NOT NULL default "{}" |
| `cloud_updated_at` | text | default "" |
| `pi_updated_at` | text | default "" |
| `resolved` | integer | NOT NULL default 0 |
| `resolution` | text | default "" |
| `resolved_at` | text | default "" |
| `resolved_by` | text | default "" |
| `created_at` | text | NOT NULL |

## `review_requests`

| SQL column | Type | Notes |
|------------|------|-------|
| `id` | integer | PK |
| `token` | text | NOT NULL |
| `checkin_id` | integer | NOT NULL |
| `guest_name` | text | NOT NULL |
| `guest_contact` | text | NOT NULL |
| `property_id` | text | default "goko_hostel" |
| `booking_id` | text | default "" |
| `whatsapp_sent_count` | integer | default 0 |
| `whatsapp_last_sent_at` | text |  |
| `rating` | integer |  |
| `rated_at` | text |  |
| `redirected_to_google` | integer | default 0 |
| `created_at` | text | NOT NULL |
| `sync_id` | text |  |
| `sync_updated_at` | text |  |
| `sync_source` | text | default cloudflare |
| `deleted_at` | text |  |

## `review_feedback`

| SQL column | Type | Notes |
|------------|------|-------|
| `id` | integer | PK |
| `review_request_id` | integer | NOT NULL FK |
| `rating` | integer | NOT NULL |
| `improvement_areas` | text | NOT NULL default "[]" |
| `comments` | text | default "" |
| `submitted_at` | text | NOT NULL |
| `sync_id` | text |  |
| `sync_updated_at` | text |  |
| `sync_source` | text | default cloudflare |
| `deleted_at` | text |  |

## `sync_id_map`

| SQL column | Type | Notes |
|------------|------|-------|
| `id` | integer | PK |
| `table_name` | text | NOT NULL |
| `sync_id` | text | NOT NULL |
| `local_id` | integer | NOT NULL |
| `remote_id` | integer |  |

## `channel_config`

| SQL column | Type | Notes |
|------------|------|-------|
| `id` | integer | PK |
| `provider` | text | NOT NULL default "aiosell" |
| `hotel_code` | text | NOT NULL |
| `pms_id` | text | NOT NULL |
| `api_base_url` | text | NOT NULL |
| `api_username` | text | NOT NULL |
| `api_password` | text | NOT NULL |
| `webhook_secret` | text | default "" |
| `booking_engine_url` | text | default "" |
| `is_active` | integer | NOT NULL default 0 |
| `auto_push_inventory` | integer | NOT NULL default 1 |
| `auto_push_rates` | integer | NOT NULL default 0 |
| `auto_push_rate_restrictions` | integer | NOT NULL default 0 |
| `auto_push_inv_restrictions` | integer | NOT NULL default 0 |
| `last_sync_at` | text | default "" |
| `created_at` | text | NOT NULL |

## `room_type_mapping`

| SQL column | Type | Notes |
|------------|------|-------|
| `id` | integer | PK |
| `dorm_id` | integer | NOT NULL FK |
| `dorm_name` | text | NOT NULL |
| `channel_room_code` | text | NOT NULL |
| `total_inventory` | integer | NOT NULL |
| `is_active` | integer | NOT NULL default 1 |

## `rate_plan_mapping`

| SQL column | Type | Notes |
|------------|------|-------|
| `id` | integer | PK |
| `room_mapping_id` | integer | NOT NULL FK |
| `rate_plan_code` | text | NOT NULL |
| `rate_plan_name` | text | NOT NULL |
| `is_active` | integer | NOT NULL default 1 |

## `daily_rates`

| SQL column | Type | Notes |
|------------|------|-------|
| `id` | integer | PK |
| `rate_plan_id` | integer | NOT NULL FK |
| `date` | text | NOT NULL |
| `rate` | integer | NOT NULL |
| `stop_sell` | integer | NOT NULL default 0 |
| `minimum_stay` | integer | NOT NULL default 1 |
| `maximum_stay` | integer |  |
| `close_on_arrival` | integer | NOT NULL default 0 |
| `close_on_departure` | integer | NOT NULL default 0 |
| `minimum_advance_reservation` | integer |  |
| `maximum_advance_reservation` | integer |  |
| `adult1_rate` | integer |  |
| `adult2_rate` | integer |  |
| `child_rate` | integer |  |
| `infant_rate` | integer |  |
| `extra_person_rate` | integer |  |
| `updated_by` | text | default "" |
| `updated_at` | text | NOT NULL |
| `synced_at` | text | default "" |

## `channel_sync_log`

| SQL column | Type | Notes |
|------------|------|-------|
| `id` | integer | PK |
| `direction` | text | NOT NULL |
| `type` | text | NOT NULL |
| `status` | text | NOT NULL |
| `request_payload` | text | default "" |
| `response_payload` | text | default "" |
| `error_message` | text | default "" |
| `records_affected` | integer | default 0 |
| `created_at` | text | NOT NULL |
| `http_method` | text | default "" |
| `url` | text | default "" |
| `http_status` | integer |  |
| `duration_ms` | integer |  |

## `booking_bed_assignments`

| SQL column | Type | Notes |
|------------|------|-------|
| `id` | integer | PK |
| `booking_id` | integer | NOT NULL FK |
| `bed_id` | integer | NOT NULL FK |
| `dorm_id` | integer | NOT NULL FK |
| `checkin_date` | text | NOT NULL |
| `checkout_date` | text | NOT NULL |
| `status` | text | NOT NULL default "assigned" |
| `assigned_by` | text | default "" |
| `assigned_at` | text | NOT NULL |
| `inventory_pool` | text | NOT NULL default "online" |

## `booking_history`

| SQL column | Type | Notes |
|------------|------|-------|
| `id` | integer | PK |
| `booking_id` | integer | NOT NULL FK |
| `action` | text | NOT NULL |
| `details` | text | default "" |
| `performed_by` | text | NOT NULL |
| `performed_at` | text | NOT NULL |

## `bed_type_config`

| SQL column | Type | Notes |
|------------|------|-------|
| `id` | integer | PK |
| `dorm_id` | integer | NOT NULL FK |
| `bed_type` | text | NOT NULL default "Bunk" |
| `max_occupancy` | integer | NOT NULL default 1 |
| `extra_person_allowed` | integer | NOT NULL default 0 |
| `created_at` | text | NOT NULL |

## `channels`

| SQL column | Type | Notes |
|------------|------|-------|
| `id` | integer | PK |
| `name` | text | NOT NULL |
| `code` | text | NOT NULL |
| `is_active` | integer | NOT NULL default 1 |
| `created_at` | text | NOT NULL |

## `channel_rates`

| SQL column | Type | Notes |
|------------|------|-------|
| `id` | integer | PK |
| `rate_plan_id` | integer | NOT NULL FK |
| `channel_id` | integer | NOT NULL FK |
| `date` | text | NOT NULL |
| `adult1_rate` | integer |  |
| `adult2_rate` | integer |  |
| `child_rate` | integer |  |
| `infant_rate` | integer |  |
| `extra_person_rate` | integer |  |
| `updated_by` | text | default "" |
| `updated_at` | text | NOT NULL |

## `bed_blocks`

| SQL column | Type | Notes |
|------------|------|-------|
| `id` | integer | PK |
| `bed_id` | integer | NOT NULL FK |
| `dorm_id` | integer | NOT NULL FK |
| `start_date` | text | NOT NULL |
| `end_date` | text | NOT NULL |
| `reason` | text | default "" |
| `blocked_by` | text | default "" |
| `blocked_at` | text | NOT NULL |
| `unblocked_by` | text |  |
| `unblocked_at` | text |  |
| `is_active` | integer | NOT NULL default 1 |

## `inventory_overrides`

| SQL column | Type | Notes |
|------------|------|-------|
| `id` | integer | PK |
| `dorm_id` | integer | NOT NULL FK |
| `channel_id` | integer | FK |
| `date` | text | NOT NULL |
| `online_available` | integer |  |
| `offline_available` | integer |  |
| `overridden_by` | text | default "" |
| `overridden_at` | text | NOT NULL |

## `inventory_dirty`

| SQL column | Type | Notes |
|------------|------|-------|
| `id` | integer | PK |
| `dorm_id` | integer | NOT NULL |
| `date` | text | NOT NULL |
| `created_at` | text | NOT NULL |

## `site_events`

| SQL column | Type | Notes |
|------------|------|-------|
| `id` | integer | PK |
| `date` | text | NOT NULL default "" |
| `title` | text | NOT NULL |
| `description` | text | NOT NULL default "" |
| `tags` | text | NOT NULL default "[]" |
| `is_past` | integer | NOT NULL default 0 |
| `cover_url` | text | NOT NULL default "" |
| `photos` | text | NOT NULL default "[]" |
| `display_order` | integer | NOT NULL default 0 |
| `updated_at` | text | NOT NULL default "" |

## `site_community_spaces`

| SQL column | Type | Notes |
|------------|------|-------|
| `id` | integer | PK |
| `title` | text | NOT NULL |
| `icon` | text | NOT NULL default "sofa" |
| `description` | text | NOT NULL default "" |
| `image_url` | text | NOT NULL default "" |
| `photos` | text | NOT NULL default "[]" |
| `display_order` | integer | NOT NULL default 0 |
| `updated_at` | text | NOT NULL default "" |

## `site_page_copy`

| SQL column | Type | Notes |
|------------|------|-------|
| `page` | text | PK |
| `content` | text | NOT NULL default "{}" |
| `updated_at` | text | NOT NULL default "" |

## `split_members`

| SQL column | Type | Notes |
|------------|------|-------|
| `id` | integer | PK |
| `name` | text | NOT NULL |
| `phone` | text | NOT NULL default "" |
| `notes` | text | NOT NULL default "" |
| `kind` | text | NOT NULL default "staff" |
| `user_id` | integer |  |
| `employee_id` | integer |  |
| `is_house` | integer | NOT NULL default 0 |
| `is_active` | integer | NOT NULL default 1 |
| `created_at` | text | NOT NULL |

## `split_groups`

| SQL column | Type | Notes |
|------------|------|-------|
| `id` | integer | PK |
| `name` | text | NOT NULL |
| `created_by` | text | NOT NULL default "" |
| `created_at` | text | NOT NULL |

## `split_group_members`

| SQL column | Type | Notes |
|------------|------|-------|
| `id` | integer | PK |
| `group_id` | integer | NOT NULL |
| `member_id` | integer | NOT NULL |

## `split_expenses`

| SQL column | Type | Notes |
|------------|------|-------|
| `id` | integer | PK |
| `group_id` | integer | NOT NULL |
| `description` | text | NOT NULL |
| `total_amount` | integer | NOT NULL |
| `expense_date` | text | NOT NULL |
| `split_method` | text | NOT NULL default "equal" |
| `notes` | text | NOT NULL default "" |
| `created_by` | text | NOT NULL default "" |
| `created_at` | text | NOT NULL |
| `hostel_expense_id` | integer |  |
| `deleted_at` | text |  |

## `split_expense_shares`

| SQL column | Type | Notes |
|------------|------|-------|
| `id` | integer | PK |
| `expense_id` | integer | NOT NULL |
| `member_id` | integer | NOT NULL |
| `paid_amount` | integer | NOT NULL default 0 |
| `owed_amount` | integer | NOT NULL default 0 |

## Razorpay test preview columns

All four tables below are isolated test evidence from `0057_razorpay_test_preview.sql`, with exact webhook refund identity added by `0058_razorpay_webhook_refund_id.sql`; they are not synchronized. Source and SQL checks constrain environment/amount/state. They do not replace booking or accounting tables.

### `gateway_preview_attempts`

| SQL column | Type | Notes |
|------------|------|-------|
| `id` | text | PK, NOT NULL; local UUID |
| `request_key` | text | NOT NULL, unique browser idempotency UUID |
| `environment` | text | NOT NULL default `test`; CHECK test-only |
| `key_id` | text | NOT NULL; original public test key; CHECK test prefix |
| `receipt` | text | NOT NULL, unique remote recovery receipt |
| `amount_paise` | integer | NOT NULL default 100; CHECK exactly 100 |
| `order_id` | text | nullable unique provider ID |
| `state` | text | NOT NULL default `creating`; CHECK creating/order_unknown/created |
| `checkout_started_at` | text | nullable; atomically claimed once |
| `created_by` | text | NOT NULL; administrator display name |
| `created_at` | text | NOT NULL, ISO |
| `updated_at` | text | NOT NULL, ISO |

### `gateway_preview_payments`

| SQL column | Type | Notes |
|------------|------|-------|
| `id` | text | PK, NOT NULL; provider payment ID |
| `attempt_id` | text | NOT NULL FK → test attempts |
| `amount_paise` | integer | NOT NULL, CHECK exactly 100 |
| `status` | text | NOT NULL, CHECK created/authorized/captured/refunded/failed |
| `captured` | integer | NOT NULL default 0; CHECK 0/1; verified capture latch |
| `refunded_paise` | integer | NOT NULL default 0; CHECK 0–100; provider-observed monotonic amount |
| `verified_at` | text | NOT NULL, ISO |

### `gateway_preview_refunds`

| SQL column | Type | Notes |
|------------|------|-------|
| `payment_id` | text | PK, NOT NULL FK → test payments; one full reservation |
| `id` | text | NOT NULL, unique local UUID |
| `receipt` | text | NOT NULL, unique recovery receipt |
| `provider_id` | text | nullable unique refund ID |
| `state` | text | NOT NULL default `submitting`; CHECK submitting/unknown/pending/processed/failed |
| `created_by` | text | NOT NULL; administrator display name |
| `updated_at` | text | NOT NULL, ISO |

### `gateway_preview_webhooks`

| SQL column | Type | Notes |
|------------|------|-------|
| `event_id` | text | PK, NOT NULL; provider event header |
| `payload_hash` | text | NOT NULL; SHA-256 of authenticated exact bytes |
| `event_type` | text | NOT NULL |
| `order_id` | text | nullable recovery ID |
| `payment_id` | text | nullable recovery ID |
| `attempt_id` | text | nullable local recovery note UUID |
| `state` | text | NOT NULL default `received`; CHECK received/retry/processed/ignored |
| `received_at` | text | NOT NULL, ISO |
| `updated_at` | text | NOT NULL, ISO |
| `refund_id` | text | nullable exact provider refund ID; migration 0058; required for refund-event API verification |

## `split_settlements`

| SQL column | Type | Notes |
|------------|------|-------|
| `id` | integer | PK |
| `group_id` | integer | NOT NULL |
| `from_member_id` | integer | NOT NULL |
| `to_member_id` | integer | NOT NULL |
| `amount` | integer | NOT NULL |
| `method` | text | NOT NULL default "other" |
| `notes` | text | NOT NULL default "" |
| `created_by` | text | NOT NULL default "" |
| `created_at` | text | NOT NULL |
| `hostel_expense_id` | integer |  |
| `split_expense_id` | integer |  |
| `deleted_at` | text |  |
# `native_inventory_holds` — internal foundation, migration 0059

## `native_accepted_quotes` — internal owner-bound snapshots, migration 0060

| SQL column | Type | Notes |
|------------|------|-------|
| `id` | text | Non-null primary key UUID |
| `hold_id` | text | Non-null unique FK to native inventory hold |
| `quote_json` | text | Non-null JSON object; validated canonical quote and copied policy |
| `accepted_at` | integer | Non-null epoch seconds |

Insert guard requires active unexpired hold/date matching using database time. Update/delete guards protect retained original evidence; the FK retains its hold. No sync columns/allowlist entry or guest endpoint. New acceptance preflights hold and quote columns/expected-table trigger installations. Recovery revalidates computed totals against the stored input and fails closed on corruption. This is not a PMS booking, capture/settlement record or atomic refund claim. See [workflow](native-accepted-quotes.md).

## Native inventory hold columns

Read-only recovery filters request UUID plus owner hash; internal advisory selection filters active state, database-clock expiry and exclusive stay overlap. New creation/selection requires column and expected-table trigger presence checks. This service extension adds no columns or migration and does not certify trigger-body integrity, category quotas or Pi coordination.

| SQL column | Type | Notes |
|------------|------|-------|
| `id` | text | Non-null primary key UUID |
| `request_key` | text | Unique non-null request UUID; never renewed on retry |
| `request_hash` | text | Non-null canonical selection SHA-256 |
| `owner_hash` | text | Non-null SHA-256 of caller's random 256-bit token; raw token never stored |
| `bed_ids` | text | Non-null JSON array, 1–4 physical integer IDs; insert trigger requires existing distinct IDs |
| `checkin_date` | text | Non-null inclusive arrival; service validates real calendar date |
| `checkout_date` | text | Non-null exclusive departure, later than arrival |
| `expires_at` | integer | Non-null epoch seconds; after creation and at most 900 seconds later |
| `state` | text | Non-null `held` (default) or `released`; expiration derived from database time |
| `created_at` | integer | Non-null epoch seconds |

Index: state/arrival/departure/expiry. Triggers enforce same-database hold/assignment/active-block exclusion on overlapping nights and immutable allocation/ownership/expiry; released rows cannot be revived. Assignment and block insert/update guards protect against independent writers. No sync columns/allowlist entry. No aggregate quota, Pi coordination, public endpoint or payment fulfilment yet; default-disabled internal service. See [workflow and limitations](native-inventory-hold-foundation.md).
# guest_booking_lookup_challenges (migration 0061)

Settings JSON extension (not a new SQL column): `website_booking_settings_v1.maxSelectedBeds`, integer 1–100, default 4 for absent fields; stock and combined whole-bed count constrain advisory guest selection. No SQL migration required for this field.

`id` text PK; `request_key` text unique digest; `booking_id` integer FK bookings; `code_hash` text; `expires_at` epoch seconds; `attempts` integer default 0 constrained 0–5; `used` integer default 0 constrained 0/1. Cloud-only ephemeral verification; no sync columns/contact/plaintext OTP. Runtime secret and delivery binding are not database columns.

# Native guest checkout (migration 0062)

Cloudflare-only; excluded from Pi sync allowlist by omission.

### `native_booking_checkouts`

| Column | Notes |
|--------|-------|
| `id` | UUID PK |
| `request_key` | Unique idempotency key |
| `request_hash` / `owner_hash` / `guest_access_hash` | SHA-256 fingerprints (tokens never stored) |
| `booking_id` / `hold_id` / `accepted_quote_id` | FKs |
| `payment_choice` | `advance` \| `full` \| `property` |
| `environment` | `test` \| `live` (v1 uses test) |
| `state` | `preparing`…`fulfilled` / `captured_unfulfilled` / `cancelled` / `expired` |
| `razorpay_order_id` / `razorpay_key_id` / `receipt` | Order linkage; test key prefix CHECK |
| `due_now_paise` | 0 or ≥100 |
| `checkout_started_at` | One-use Checkout claim |
| `closure_reason` | `guest_cancelled` \| `hold_expired` \| `cannot_fulfil` |
| `guest_name` / `guest_email` / `guest_phone` | Guest contact on the checkout row |
| `amends_checkout_id` | Nullable FK to prior checkout (0063); set on guest self-serve amend checkouts |

### `native_inventory_holds` (amend column, migration 0063)

| Column | Notes |
|--------|-------|
| `exclude_booking_id` | Nullable; when set, hold insert may overlap that booking’s own `booking_bed_assignments` so amend can re-hold the guest’s current beds |

### `native_booking_payments` / `native_booking_refunds` / `native_booking_webhooks`

Mirror preview recovery semantics with **variable** amounts (≥100 paise). Webhook inbox keyed by `event_id`; route via `notes.goko_checkout_id`.
