# Relationships — how the pieces connect

**Git-safe.** Table columns: [schema-columns.md](schema-columns.md). Sequences: [interactions.md](interactions.md). This file is the module/ER map.

---

## System context

```mermaid
flowchart TB
  subgraph users [People]
    G[Guest]
    S[Staff]
    K[Kitchen]
    A[Admin]
  end
  subgraph app [GokoWeb Next.js]
    WEB[Marketing + CMS hydrate]
    OPS[Guest ops pages]
    ADM[Admin SPA]
    API[API routes]
  end
  subgraph data [Data]
    D1[(D1 / SQLite)]
    DR[Google Drive]
    R2[(R2)]
  end
  subgraph ext [External]
    VIS[Vision]
    GML[Gmail]
    AIO[Aiosell]
    SF[Stayflexi]
    FRRO[FRRO portal]
    WA[WhatsApp wa.me]
  end
  G --> WEB
  G --> OPS
  G --> SF
  S --> ADM
  K --> OPS
  A --> ADM
  WEB --> API
  OPS --> API
  ADM --> API
  API --> D1
  API --> DR
  API --> R2
  API --> VIS
  API --> GML
  API --> AIO
  ADM --> FRRO
  OPS --> WA
```

---

## Module graph (code)

```mermaid
flowchart LR
  subgraph pages [src/app]
    MKT["(marketing) pages"]
    GUEST[self-checkin food kitchen admin]
    RTE[api/*/route.ts]
  end
  subgraph ui [src/components]
    ADM[admin/*]
    FOOD[food/* kitchen/*]
    LAY[layout/*]
  end
  subgraph core [src/lib]
    AUTH[auth.ts]
    PERM[actionPermissions.ts]
    INV[inventoryAvailability.ts]
    AIO[aiosell.ts aiosellSync.ts]
    OTA[platformReceivables.ts]
    SYN[syncEngine.ts]
    GOOG[googleApiFetch.ts]
    CMS[siteContent.ts mediaR2.ts]
  end
  subgraph db [src/db]
    SCH[schema.ts]
    Q[queries.ts]
    IDX[index.ts getDb]
  end
  MKT --> LAY
  MKT --> CMS
  GUEST --> ADM
  GUEST --> FOOD
  ADM --> RTE
  FOOD --> RTE
  RTE --> AUTH
  RTE --> PERM
  RTE --> Q
  RTE --> AIO
  RTE --> OTA
  RTE --> SYN
  RTE --> GOOG
  Q --> IDX
  IDX --> SCH
```

**Rule of thumb:** pages and admin components do not import Drizzle. They POST JSON. Routes call `queries.ts`. New SQL columns: `schema.ts` + `migrations/NNNN_name.sql` together.

---

## Guest stay — entity relationships

```mermaid
erDiagram
  dorms ||--o{ beds : contains
  beds ||--o{ booking_bed_assignments : assigned
  bookings ||--o{ booking_bed_assignments : uses
  bookings ||--o{ booking_history : audit
  checkins ||--o{ food_orders : tab
  checkins ||--o{ review_requests : funnel
  review_requests ||--o{ review_feedback : if_low_rating
  dorms ||--o{ room_type_mapping : channel_code
  room_type_mapping ||--o{ rate_plan_mapping : plans
  rate_plan_mapping ||--o{ daily_rates : per_night
  dorms ||--o{ bed_blocks : ooo
  dorms ||--o{ inventory_overrides : ceiling
  beds ||--o{ bed_history : events
  users ||--o{ tasks : assigned
  tasks ||--o| expenses : purchase_expense
```

**Two occupancy models exist at once:**

1. **Physical bed row** (`beds.status` = available | occupied | cleanup) — walk-in / same-day map in Beds + Timeline.
2. **Date-range assignment** (`booking_bed_assignments`) — calendar PMS + OTA inventory.

Aiosell availability prefers date-aware assignment + blocks + overrides (`getDateAwareAvailability`), not only “is this bed occupied right now.”

Hostel food tabs attach to **`checkins`**, not `bookings`. Checkout lookup is phone-normalized against active check-ins (`getPendingFoodTab`). Cafe walk-in orders with no `checkin_id` are not matched.

---

## Food — entity relationships

```mermaid
erDiagram
  menu_categories ||--o{ menu_items : contains
  food_orders ||--o{ food_order_items : lines
  food_orders ||--o{ order_modifications : audit
  menu_items ||--o{ food_order_items : snapshot_name_price
  checkins ||--o{ food_orders : hostel_guest
```

Line items snapshot `itemName` / `itemPrice` so menu edits do not rewrite history. Stock lives on `menu_items.stock_quantity` when `track_inventory` is on.

---

## Accounts — entity relationships

```mermaid
erDiagram
  accounts ||--o{ expenses : paid_from
  tasks ||--o| expenses : linked_purchase
  accounts ||--o{ daily_income : received
  accounts ||--o{ daily_ledger : one_row_per_day
  accounts ||--o{ salary_payments : paid_from
  accounts ||--o{ platform_payment_profiles : virtual_account
  accounts ||--o{ platform_settlements : bank_payout
  bookings ||--o{ platform_receivable_entries : booking_cycle_events
  bookings ||--o{ platform_settlement_allocations : booking_cycle_allocations
  platform_settlements ||--o{ platform_settlement_allocations : allocates
  vendors ||--o{ expenses : optional
  employees ||--o{ salary_payments : paid
```

Salary creates **two** rows: `salary_payments` + an `expenses` row (category Salary). Ledger unique on `(date, account_id)`.

---

## Channel manager — entity relationships

```mermaid
erDiagram
  channel_config ||--|| aiosell : credentials
  dorms ||--o{ room_type_mapping : maps_to_room_code
  room_type_mapping ||--o{ rate_plan_mapping : rate_plans
  rate_plan_mapping ||--o{ daily_rates : dates
  rate_plan_mapping ||--o{ channel_rates : per_channel
  channels ||--o{ channel_rates : OTA
  channel_sync_log ||--o{ http : audit
  inventory_dirty ||--o{ dorms : pending_push
```

Credentials sit in D1 `channel_config` (not env), edited under Management → Channel Manager. Sandbox defaults exist in `aiosell.ts` for empty config; **production hotel/password is in D1**.

---

## CMS — entity relationships

```mermaid
erDiagram
  site_page_copy ||--|| events_or_community : JSON_blob
  site_events ||--o{ photos_json : gallery
  site_community_spaces ||--o{ photos_json : gallery
```

No FK to R2. URLs are strings (`/api/media/...` or `/images/...`). GC counts URL refs with SQL `instr` before deleting R2 objects.

---

## Splits — entity relationships (Cloudflare D1 only)

```mermaid
erDiagram
  split_groups ||--o{ split_group_members : roster
  split_members ||--o{ split_group_members : member
  split_groups ||--o{ split_expenses : bills
  split_expenses ||--o{ split_expense_shares : paid_owed
  split_members ||--o{ split_expense_shares : person
  split_groups ||--o{ split_settlements : transfers
  split_members ||--o{ split_settlements : from_or_to
  expenses ||--o| split_expenses : hostel_expense_id
  expenses ||--o| split_settlements : hostel_expense_id
```

App FKs are integers, not Drizzle `references()`. Unique `hostel_expense_id` where not null. Unique one house member (`is_house = 1`). Not in `syncEngine`.

---

## Call graph — inventory push (Goko-originated)

```mermaid
flowchart TD
  A[assignBed / checkout / createBooking / inventory UI] --> B[triggerInventoryPush or pushIfOtaChanged]
  B --> C[markInventoryDirty]
  C --> D{channel_config.isActive and autoPushInventory?}
  D -->|no| E[stop]
  D -->|yes| F[getDateAwareAvailability per dorm/date]
  F --> G[aiosell.pushInventory]
  G --> H[channel_sync_log]
```

Webhook path (`/api/aiosell/reservations`) creates/updates `bookings` + assignments and **must not** blindly echo a push that re-tells Aiosell what it just sent.

---

## Call graph — admin UI → API

| UI | Route |
|----|--------|
| Records, Dashboard, Beds, Timeline, Users, Audit, Backup, Settings, Gmail bookings list (legacy actions) | `/api/admin/checkins` |
| Booking calendar | `/api/admin/bookings` |
| Inventory / rates grid | `/api/admin/inventory` |
| Food orders / tabs / pay | `/api/admin/food-orders` |
| Menu CRUD | `/api/admin/food` |
| Expenses / ledger | `/api/admin/expenses` |
| Tasks / task uploads | `/api/admin/tasks` + `/api/admin/tasks/upload` |
| Splits | `/api/admin/splits` |
| Accounts / vendors / employees | `/api/admin/account-settings` |
| Website CMS | `/api/admin/website` + `/upload` |
| Channel manager config | `/api/admin/channel-manager` |
| Reviews admin | `/api/admin/reviews` |
| QR history | `/api/admin/qr-history` |
| Check-in XLSX | `/api/admin/import` |
| Expense/income XLSX | `/api/admin/bulk-import-accounts` |
| Drive upload (manual records) | `/api/admin/upload` |
| Server sync UI | `/api/sync` |
| Kitchen (also used embedded in Food Orders) | `/api/food/kitchen` |

---

## Auth relationship

```mermaid
flowchart TD
  P[password + optional username] --> AUTH[authenticateUser]
  AUTH -->|match ADMIN_PASSWORD| AD[role admin permissions empty bypass]
  AUTH -->|match MANAGER_PASSWORD| MG[role manager permissions empty]
  AUTH -->|users table hash| DB[role + JSON permissions]
  MG --> GATE[actionAllowed]
  DB --> GATE
  AD --> OK[skip gate]
  GATE -->|forbidden| 403
  GATE -->|admin_required| 403
  GATE -->|allowed| HANDLER
```

Env manager **fails** gated actions. That is not a bug; DB managers need permission keys. See [auth-rbac.md](auth-rbac.md).

---

## What is **not** related (on purpose)

| A | B | Why disconnected |
|---|---|------------------|
| `site_events` | Pi SQLite | CMS Cloudflare-only |
| R2 objects | `/api/sync` | Photos stay on CF; IDs are Drive URLs on checkin rows |
| Stayflexi | Aiosell client | Book now is a link; inventory is Aiosell |
| `qr_history` | Food order URLs | Staff paste URLs by hand |
| `rate_scrapes` | `daily_rates` | Competitor scrape is research, not live selling rates |
| `api_stats` | Billing | Internal Vision/Drive counters only |
