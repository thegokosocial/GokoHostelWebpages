# Interaction diagrams

**Git-safe.** Sequence and state machines for how people, APIs, and stores talk. Secrets live in gitignored [secrets-and-access.md](secrets-and-access.md). Landmines: [llm-onboarding.md](llm-onboarding.md). Entity graphs: [relationships.md](relationships.md).

---

## System context

```mermaid
flowchart TB
  subgraph people [People]
    Guest
    Desk[Front desk]
    Kitchen
    Maintainer
  end
  subgraph cf [Cloudflare]
    W[OpenNext Worker]
    D1[(D1)]
    R2[(R2 CMS JPEGs)]
  end
  subgraph pi [Pi optional]
    N[next start]
    SQL[(SQLite file)]
  end
  subgraph ext [Vendors]
    Drive[Google Drive]
    Vision
    Aiosell
    Stayflexi
    FRRO
  end
  Guest --> W
  Desk --> W
  Desk --> N
  Kitchen --> W
  Maintainer --> W
  W --> D1
  W --> R2
  W --> Drive
  W --> Vision
  W --> Aiosell
  Guest --> Stayflexi
  N --> SQL
  W <-.sync.-> N
  Desk --> FRRO
```

---

## Guest self check-in

```mermaid
sequenceDiagram
  actor G as Guest
  participant P as /self-checkin
  participant L as GET /api/checkin/lookup
  participant V as POST /api/validate-id
  participant C as POST /api/checkin
  participant Vis as Vision
  participant Dr as Drive
  participant DB as D1
  G->>P: phone
  P->>L: ?phone=
  L-->>P: prior name / Drive URLs or empty
  G->>P: form + ID photos
  P->>V: multipart (if image_validation)
  V->>Vis: OCR / labels
  Vis-->>P: valid or reason
  G->>P: Complete check-in
  P->>C: multipart
  C->>Vis: re-check unless reused ID
  C->>Dr: month folder JPEG
  C->>DB: insert checkins status=active
  C-->>G: success
  Note over DB: Does NOT occupy beds or create bookings
```

Staff then assign a physical bed (`assignBed` on `/api/admin/checkins`) and/or a calendar booking (`assignBeds` on `/api/admin/bookings`).

---

## Food order → kitchen → pay

```mermaid
sequenceDiagram
  actor G as Guest
  participant FO as /food-order
  participant M as GET /api/food/menu
  participant O as POST /api/food/order
  participant K as /kitchen
  participant KA as POST /api/food/kitchen
  participant A as Admin Food Orders
  G->>FO: cart localStorage
  FO->>M: menu + hours + busy
  FO->>O: items + phone
  O-->>FO: orderNumber
  loop every ~5s
    K->>KA: listOrders
  end
  K->>KA: updateStatus placed→preparing→ready→served
  A->>A: markOrderPaid / combined bill
```

```mermaid
stateDiagram-v2
  [*] --> pending_approval: guest and food_confirm_with_guest
  [*] --> placed: else
  pending_approval --> placed: approve
  pending_approval --> cancelled: reject
  placed --> preparing
  placed --> ready: all lines trackInventory
  preparing --> ready
  ready --> served
  placed --> cancelled
  preparing --> cancelled
  ready --> cancelled
```

---

### Booking views

The admin Bookings dashboard has three presentation scopes:

- `Calendar`: uses `getCalendarData` and intentionally excludes cancelled bookings from calendar occupancy tiles.
- `Table`: shows the current calendar-range operational rows.
- `All Bookings`: uses `getAllBookings`, includes every booking status, filters by stays overlapping the selected date range, and paginates the result. Selecting a row opens the same `BookingDetailPanel` as the calendar/table views.

The All Bookings read path requires `canViewBookings` and does not change booking status, bed assignment, inventory, or calendar availability behavior.

### Manual booking editing

The booking detail panel offers a status-preserving editor for manual/offline/walk-in bookings. Name, phone, email, dates, derived nights, persons, nightly rate, special requests, and room/bed units are validated server-side. Date changes validate and reassign the existing active beds, then refresh PMS occupancy for both old and new nights. Bed changes validate conflicts, add before removing, and refresh occupancy. Date and bed changes must be saved separately; closed bookings allow guest/detail edits but retain historical assignments. Existing discount and tax rules are retained or recalculated by the server.

## Calendar PMS vs physical beds

```mermaid
flowchart LR
  subgraph physical [Beds tab]
    BEDS[beds.status]
    CI[checkins]
    CI -.->|name/contact match| BEDS
  end
  subgraph calendar [Bookings tab]
    BK[bookings]
    BBA[booking_bed_assignments]
    BK --> BBA
  end
  subgraph ota [Aiosell]
    INV[getDateAwareAvailability]
    PUSH[pushInventory]
  end
  BBA --> INV
  BLK[bed_blocks] --> INV
  OV[inventory_overrides] --> INV
  INV --> PUSH
  Note1[Calendar checkIn does not set beds.occupied]
```

```mermaid
sequenceDiagram
  participant OTA as Aiosell
  participant WH as POST /api/aiosell/reservations
  participant DB as D1
  participant AA as channelAutoAssign
  OTA->>WH: book / modify / cancel
  WH->>WH: webhookSecret
  alt book
    WH->>DB: bookings received
    WH->>AA: online beds for stay
    Note over WH: no inventory echo push
  else modify
    WH->>DB: dates / occupancy
    WH->>AA: reseat if need changed
  else cancel
    WH->>DB: unassign then cancelled
    WH->>WH: triggerInventoryPush
  end
```

Walk-in desk path: `createBooking` → Unassigned chips → `assignBeds` (offline leftover) → `checkIn` (booking status only).

---

## Stay collect, prepaid, refund (rupees)

Kernel: `src/lib/stayPayment.ts`. Shared modal: `RecordPaymentModal` with `amountUnit="rupees"` (food stays paise).

```mermaid
sequenceDiagram
  actor Desk
  participant UI as CheckInPopup / Dashboard / Detail
  participant B as POST /api/admin/bookings
  participant DB as D1 bookings
  Desk->>UI: Check In
  alt OTA prepaid
    UI->>B: checkIn
    B->>B: prepaidCheckInWrite amountPaid=total online
    Note over DB: paymentStatus stays prepaid, hotel due 0
  else Later
    UI->>B: checkIn no collect
    Note over DB: stayDueAtHotel = total − paid
  else Collected
    UI->>B: checkIn collectPayment mergeStayCollect
    Note over DB: paymentStatus paid + paymentMethod
  end
  Desk->>UI: Mark Paid / Collect remaining
  UI->>B: collectStayPayment
  Desk->>UI: Cancel after check-in
  UI->>B: cancelBooking refundAmount refundMethod
  Note over DB: amount_refunded set; amount_paid unchanged
```

Room Revenue (`getRoomRevenue`) is occupied-for-revenue stays in the check-in date range — rupees, not ledger paise.

---

## Food tab on checkout (self-check-in, not booking id)

Hostel tabs are `food_orders.checkin_id` → `checkins.id`, matched by **normalized phone**. Calendar booking id is not the tab key.

```mermaid
sequenceDiagram
  actor Desk
  participant UI as Calendar / Beds / Timeline / Dashboard
  participant Tab as getPendingFoodTab
  participant DB as food_orders + checkins
  Desk->>UI: Check Out
  UI->>Tab: contact and/or checkinId
  Tab->>DB: active checkins by phone
  Tab-->>UI: pendingTab orderIds
  alt unpaid hostel tab
    UI->>Desk: warn; Check out anyway
  else empty / bad phone / lookup fail
    UI->>Desk: could not check; proceed anyway
  end
  Note over UI: APIs do not 409 on unpaid food
  Note over Tab: cafe walk-in (no checkin_id) is not matched
```

Admin UI imports `@/lib/foodTab` only. Routes import `@/lib/foodTabDb` (never from a client component).

---

## Accounts + Splits cash bridge

```mermaid
flowchart TD
  SPLIT[split_expenses IOUs]
  EXP[expenses hostel P and L]
  LED[daily_ledger]
  SPLIT -->|Goko sole payer equal share| EXP
  SPLIT -->|payGokoReimbursement| EXP
  EXP --> LED
  SPLIT -->|personal dinner no Goko| X[no Accounts row]
```

```mermaid
sequenceDiagram
  participant UI as AdminSplits
  participant S as POST /api/admin/splits
  participant E as expenses
  UI->>S: addExpense Goko sole payer
  S->>E: insert paise UTC month
  S-->>UI: hostelExpenseId
  Note over UI: retry 500 with that id, do not double-book
  UI->>S: payGokoReimbursement splitExpenseId
  S->>E: insert then settlement from=Goko
```

---

## CMS Events / Community

```mermaid
sequenceDiagram
  participant Browser
  participant HTML as force-static /events
  participant API as GET /api/site
  participant D1
  Browser->>HTML: prerendered seed shell
  Browser->>API: page=events
  alt D1 throw
    API-->>Browser: TypeScript seed
  else 0 rows
    API-->>Browser: empty CMS
  else rows
    API-->>Browser: CMS JSON
  end
```

Admin upload: crop JPEG → `POST /api/admin/website/upload` → R2 → save JSON with `/api/media/...` URLs. Pi: tab hidden, API 403, migrator skips `0035`.

---

## Auth (every admin POST)

```mermaid
sequenceDiagram
  actor S as Staff
  participant SPA as /admin
  participant R as POST /api/admin/*
  participant AUTH as authenticateUser
  S->>SPA: password in React state
  SPA->>R: password username action
  R->>AUTH: env ADMIN/MANAGER or SHA-256 DB hash
  AUTH-->>R: role + permissions
  R->>R: actionAllowed
  alt forbidden
    R-->>SPA: 403
  else ok
    R-->>SPA: JSON
  end
```

`useAdminApi` only hits `/api/admin/checkins`. Splits / food / bookings / inventory / expenses each `fetch` their own URL.

## Mobile presentation invariants

The shared shell treats fixed controls and anchor navigation as mobile-specific presentation concerns: floating actions account for device safe-area insets, anchor jumps leave room for the sticky header, and public footer/booking controls expose touch-sized targets. These changes do not alter action payloads, navigation routes, authentication, permissions, or workflow state.

---

## Pi sync + PWA failover

```mermaid
sequenceDiagram
  participant Pi
  participant CF as Worker /api/sync
  Pi->>CF: pull since cursor
  CF-->>Pi: bundles
  Pi->>Pi: apply remap FKs via sync_id
  Pi->>CF: push local changes
  CF-->>Pi: idMappings / conflicts
```

```mermaid
sequenceDiagram
  participant SW as public/sw.js
  participant FC as GET /api/failover-config
  participant Pi as pi_local_url
  loop 60s if on else 5min
    SW->>FC: no auth
    FC-->>SW: failoverEnabled piLocalUrl
  end
  alt failover on and Pi URL set
    SW->>Pi: intercept GET/POST except /_next/
  end
```

Toggle failover is `/api/sync` `toggleFailover`, not the GET.

---

## Reviews + Form C

```mermaid
flowchart TD
  CO[checked_out checkin] --> ASK[listAskReview]
  ASK --> WA[WhatsApp token URL]
  WA --> PAGE["/review/token"]
  PAGE -->|rating >= 4| G[review_google_url]
  PAGE -->|rating <= 3| FB[review_feedback]
```

```mermaid
sequenceDiagram
  participant Admin
  participant Local as Playwright :3456
  participant API as GET /api/form-c/id
  participant FRRO as indianfrro.gov.in
  Admin->>Local: Auto-submit
  Local->>API: token = ADMIN_PASSWORD
  API-->>Local: form_c_data + photo
  Local->>FRRO: fill fields
  Note over FRRO: photo must be OS file dialog
```

---

## Request shape (admin)

Almost all staff mutations:

```
POST /api/admin/<area>
{ "password": "<ADMIN_PASSWORD>", "username"?: "...", "action": "<name>", ... }
```

Unknown `action` → 400. No auth → 401. RBAC fail → 403. Full action lists: [api-map.md](api-map.md).
