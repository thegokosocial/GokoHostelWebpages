# Goko Web - Architecture & Page Layout Reference

## Site Overview

```
gokohostel.com
├── Public Website (7 pages)
├── Self Check-in (/self-checkin)
├── Admin Panel (/admin) - 6 sections
└── API Routes (5 endpoints)
```

---

## 1. Public Website Pages

### Navigation Flow
```
Header [Events | About ▾ | Stay | Community Area | Reviews | Book Now]
         │         │
         │         ├── Our Story (/story)
         │         ├── How to Reach (/how-to-reach)
         │         ├── Things to Do (/things-to-do)
         │         └── FAQs (/faqs)
         │
Footer [About | Gokarna links | Social | Book Now bar]
```

### Page Details

| Page | URL | Content | Key Components |
|------|-----|---------|----------------|
| **Home** | `/` | Hero video, intro, Goko=Gokarna, stats, rooms, neighbourhood, FAQ teaser, reviews, location, CTA | `HomeHeroPremium`, `RoomTabs`, `SectionHeader`, `Card` |
| **Events** | `/events` | Upcoming + past events with clickable photo popup | `EventCard` (from `CardWithModal`), `PageRibbon` |
| **Stay** | `/stay` | Room types with clickable galleries, amenities, booking CTA | `StayRoomCard` (from `CardWithModal`), `Icon` |
| **Community Area** | `/community-area` | Spaces, activities, weekly rhythm, special events | `CommunitySpaceCard` (from `CardWithModal`) |
| **Our Story** | `/story` | Founders, team, values with Lucide icons | `Icon`, `PageRibbon`, `Reveal` |
| **Reviews** | `/reviews` | Full guest review cards, Google/Instagram links | `Card`, `SectionHeader` |
| **FAQs** | `/faqs` | Accordion categories, WhatsApp CTA | `FaqAccordion`, `PageRibbon` |
| **How to Reach** | `/how-to-reach` | Transport modes, local contacts, walking guide | `WalkingRouteGuide`, `Card` |
| **Things to Do** | `/things-to-do` | Beaches, temples, day trips | `PageRibbon`, `Reveal` |
| **Booking Enquiry** | `/booking-enquiry` | Contact form (WhatsApp/email) | `BookingEnquiryForm` |

### Global Shell (every page)
```
SiteShell
├── Skip to content link
├── Header (sticky, scroll-aware glassmorphism)
│   ├── Logo + "Goko" text
│   ├── Desktop nav (pill links + About dropdown)
│   ├── Book Now button (opens BookingGate dialog)
│   └── Mobile: Book button + hamburger → MobileDrawer
├── <main> (page content)
├── Footer (green bg, links, social, bottom Book Now bar)
├── BackToTop (bottom-left, appears after 600px scroll)
└── WhatsAppFloat (bottom-right, links to wa.me)
```

---

## 2. Self Check-in Page

**URL:** `/self-checkin` (hidden - not in nav/sitemap/robots)

### Form Flow
```
Guest opens URL on phone
    │
    ▼
┌─────────────────────────┐
│ Welcome to Goko Hostel  │
│ Date* Time* (auto-fill) │
│ Name*                   │
│ Persons* Days*          │
│ Nationality* (dropdown) │
│ Coming from*            │
│ Contact* (+91 prefix)   │
│ Emergency name* phone*  │
│ ID type* (dropdown)     │
│ ID photos (multi-upload)│
│ [Verify document]       │  ← Calls /api/validate-id
│ Visa photos (if foreign)│
│ [Complete Check-in]     │  ← Calls /api/checkin
└─────────────────────────┘
    │
    ▼ (on submit)
┌─────────────────────────┐
│ Submitting... (spinner) │
│ Do not close this page  │
└─────────────────────────┘
    │
    ▼
┌─────────────────────────┐
│ ✓ Check-in complete!    │
│ [Submit another]        │
└─────────────────────────┘
```

### Validation Layers (Vision API)
1. **Label Detection** - Is it a document? (rejects selfies, food, landscapes)
2. **Text Detection + Patterns** - Aadhaar/DL/Passport keyword matching
3. **ID Type Cross-check** - Selected type matches detected type
4. **Name Verification** - Guest's first/last name found in document text
5. **SafeSearch** - Rejects adult/spoofed/manipulated images
6. **Aadhaar Address Check** - Prompts for back side if address not found
7. **Aadhaar Number Match** - Front and back numbers must match (multi-file)

### Data Flow
```
Form → /api/validate-id (Vision API) → validation result
Form → /api/checkin → Upload to Drive → Write to Google Sheet (monthly tab)
```

---

## 3. Admin Panel

**URL:** `/admin` (hidden - not in nav/sitemap/robots)

### Login Flow
```
Role Selection → [Admin Access] or [Staff Access]
    │
    ▼
Password Entry → Verified against env vars
    │
    ▼
Dashboard (default landing)
```

### Navigation Bar
```
[Dashboard] [Beds] [Timeline] [Records] [History] [Setup*]  ROLE [Logout]
                                                    (* admin only)
```

### Section Details

#### Dashboard (`/admin` → Dashboard tab)
```
┌──────────────────────────────────────────┐
│ Dashboard                    2026-05-17  │
│                                          │
│ [5 Check-ins] [0 Checkouts] [16 Free] [3/20 Occupied] │
│                                          │
│ ████████░░░░░░░░░░░░ 15% occupancy      │
│                                          │
│ ⚠ Checkouts due: [Guest] [Checkout btn] │
│                                          │
│ Today's Check-ins:                       │
│ ┌ Pawan Dhiran  [Main-mixed-1/MAI-U1] ┐ │
│ ┌ Sunny Masan   [Assign bed]          ┐ │
│                                          │
│ [Assign Beds] [View Records] [Dorm Setup]│
│                                          │
│ ID Validation (Vision API) [ON/OFF]      │
└──────────────────────────────────────────┘
```

#### Beds (`/admin` → Beds tab)
```
┌──────────────────────────────────────────┐
│ Bed Management                 [Refresh] │
│                                          │
│ ┌ 5 guests without bed assignment ─────┐ │
│ │ Pawan Dhiran  1d Bangalore [Assign]  │ │
│ └──────────────────────────────────────┘ │
│                                          │
│ [Assigning to: Pawan (1 day)] [Cancel]   │
│                                          │
│ Dorm Overview Cards:                     │
│ ┌──────────┐ ┌──────────┐               │
│ │ [bunk]   │ │ [bunk]   │               │
│ │ Main-1   │ │ Mixed-2  │               │
│ │ 2L+1U    │ │ 1L+1U    │               │
│ │ ████████ │ │ ████░░░░ │               │
│ │ 0/12 occ │ │ 1/8 occ  │               │
│ └──────────┘ └──────────┘               │
│                                          │
│ Click dorm → Visual Bed Map:             │
│ ┌─ Bunk 1 ──┐ ┌─ Bunk 2 ──┐            │
│ │ [U1 Free ] │ │ [U2 Occ  ] │            │
│ │  ┆ladder┆  │ │ Pawan     │            │
│ │ [LA1 Free] │ │ 2d left   │            │
│ │ [LB1 Free] │ │ [Checkout]│            │
│ └────────────┘ └───────────┘            │
└──────────────────────────────────────────┘
```

#### Timeline (`/admin` → Timeline tab)
```
┌──────────────────────────────────────────┐
│ Occupancy Timeline   [Date] [7d▾] [Today] [Refresh] │
│                                          │
│ Legend: ░Free ██Occupied █Checkout █Cleanup│
│                                          │
│ BED        | Sun 17 | Mon 18 | Tue 19 | │
│ ─ Main-mixed-1  (blue accent)  2/12     │
│ MAI-U1 Upr | ░░░░░░ | ░░░░░░ | ░░░░░░ | │
│ MAI-L1 Lwr | ██Pawan████████ | ░░░░░░ | │
│ ─ mixed-dorm-2  (purple accent)  1/8    │
│ MIX-U1 Upr | ░░░░░░ | ░░░░░░ | ░░░░░░ | │
│ MIX-L2 Lwr | ██Sunny██ | █chk | ░░░░░ | │
│                                          │
│ Click cell → popup: Assign/Checkout/Clean│
└──────────────────────────────────────────┘
```

#### Records (`/admin` → Records tab)
```
┌──────────────────────────────────────────┐
│ Check-in Records            [+Add] [Refresh] │
│                                          │
│ [MAY-2026] [APRIL-2026] ...             │
│                                          │
│ [Search...] [Sort by▾] [Clear]  5 records│
│                                          │
│ Table: Submitted | Date | Time | Name |  │
│   Persons | Contact | Days | From |      │
│   Nationality | Emergency | ID Type |    │
│   ID Card [Front][Back] | Visa |         │
│   Actions: [✏Edit] [🗑Delete] (admin)    │
│                                          │
│ [+Add] → Manual entry form               │
│ [✏Edit] → Inline edit form with file upload │
└──────────────────────────────────────────┘
```

#### History (`/admin` → History tab)
```
┌──────────────────────────────────────────┐
│ Bed History              [CSV] [Refresh] │
│                                          │
│ [Search...] [Action▾] [Dorm▾] [Clear]   │
│                                          │
│ Table: Timestamp | Bed ID | Dorm |       │
│   Action (assign/checkout/extend/swap) | │
│   Guest Name | Guest Contact             │
│                                          │
│ Actions color-coded: green=assign,       │
│   orange=checkout, blue=extend, purple=swap │
└──────────────────────────────────────────┘
```

#### Setup (`/admin` → Setup tab, admin only)
```
┌──────────────────────────────────────────┐
│ Dorm Setup                               │
│                                          │
│ Add new dorm:                            │
│ [Name] [Beds: 6] [Type: Bunk 2L+1U ▾] [+Add] │
│                                          │
│ Main-mixed-1 (12 beds, 4 bunks)  [Delete]│
│ ┌─ Bunk 1 ──┐ ┌─ Bunk 2 ──┐            │
│ │ [MAI-U1] 🗑│ │ [MAI-U2] 🗑│            │
│ │ [MAI-LA1]🗑│ │ [MAI-LA2]🗑│            │
│ │ [MAI-LB1]🗑│ │ [MAI-LB2]🗑│            │
│ └────────────┘ └───────────┘            │
└──────────────────────────────────────────┘
```

### Admin Permissions

| Action | Admin | Staff |
|--------|-------|-------|
| View dashboard | ✓ | ✓ |
| View/search records | ✓ | ✓ |
| Add manual entry | ✓ | ✓ |
| Edit entry | ✓ | ✗ |
| Delete entry + Drive files | ✓ | ✗ |
| Modify entry | ✓ | ✗ |
| Assign/checkout beds | ✓ | ✓ |
| Dorm setup (add/remove) | ✓ | ✗ |
| Toggle image validation | ✓ | ✗ |
| View bed history | ✓ | ✓ |
| Export CSV | ✓ | ✓ |

---

## 4. API Routes

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/checkin` | POST | None | Self check-in form submission. Validates ID, uploads to Drive, writes to Sheets |
| `/api/validate-id` | POST | None | Real-time ID validation (single or multi-file). Returns document type, name match, etc. |
| `/api/settings` | GET | None | Returns feature flags (image_validation on/off) |
| `/api/admin/checkins` | POST | Password | All admin actions: list, add, update, delete, getBeds, assignBed, checkoutBed, markClean, initDorms, removeDorm, removeBed, getDashboard, getBedHistory, getSetting, setSetting |
| `/api/admin/upload` | POST | Password | Upload files to Google Drive (for admin manual entries) |

---

## 5. Data Storage (Google Sheets)

| Sheet Tab | Created | Content |
|-----------|---------|---------|
| `MAY-2026` (monthly) | Auto | Check-in records (14 columns) |
| `Dorms` | Auto | Bed configuration and current occupancy (10 columns) |
| `BedHistory` | Auto | Audit log of bed assignments/checkouts (6 columns) |
| `Settings` | Auto | Key-value feature flags (image_validation, etc.) |
| `CheckIns` | Legacy | Original test data (hidden from Records UI) |

---

## 6. External Services

| Service | Purpose | Auth Method |
|---------|---------|-------------|
| Google Sheets API | Store check-in records, bed data, settings | Service Account JWT |
| Google Drive API | Upload ID card/visa images | OAuth2 refresh token |
| Google Cloud Vision API | OCR + label detection + SafeSearch for ID validation | Service Account JWT |

---

## 7. File Structure Quick Reference

```
src/
├── app/
│   ├── page.tsx                    # Home
│   ├── admin/page.tsx              # Admin panel (auth + nav shell)
│   ├── self-checkin/page.tsx       # Guest self check-in
│   ├── events/page.tsx             # Events
│   ├── stay/page.tsx               # Rooms
│   ├── story/page.tsx              # Our Story
│   ├── community-area/page.tsx     # Community
│   ├── how-to-reach/page.tsx       # Directions
│   ├── things-to-do/page.tsx       # Activities
│   ├── faqs/page.tsx               # FAQs
│   ├── reviews/page.tsx            # Reviews
│   ├── booking-enquiry/page.tsx    # Contact form
│   ├── api/
│   │   ├── checkin/route.ts        # Check-in submission
│   │   ├── validate-id/route.ts    # ID validation
│   │   ├── settings/route.ts       # Feature flags
│   │   └── admin/
│   │       ├── checkins/route.ts   # All admin actions
│   │       └── upload/route.ts     # File upload
│   ├── layout.tsx                  # Root layout
│   ├── globals.css                 # Global styles
│   ├── sitemap.ts                  # Sitemap generator
│   └── robots.ts                   # Robots.txt
├── components/
│   ├── admin/                      # Admin panel sections (8 files)
│   ├── booking/                    # BookNowButton, BookingGateProvider
│   ├── faq/                        # FaqAccordion
│   ├── forms/                      # BookingEnquiryForm, SelfCheckinForm
│   ├── layout/                     # Header, Footer, SiteShell, etc.
│   ├── media/                      # HeroBackdrop, ImageCarousel
│   ├── motion/                     # Reveal animation
│   ├── sections/                   # CardWithModal, HomeHero, RoomTabs, etc.
│   └── ui/                         # Button, Card, Input, Icon, etc. (13 files)
├── content/                        # Static content data (12 files)
└── lib/                            # Utilities (8 files)
```
