# UI improvement plan — page-by-page delivery

**Status:** complete — safe mobile-first improvements are implemented and the final regression gate passed on 4 October 2026.
**Last reviewed:** 4 October 2026.
**Evidence:** source review; 390 px, 768 px, and 1280 px browser checks; focused workflow suites; full Vitest; focused Playwright public/admin coverage; TypeScript; diff validation; and a production build.

## Implementation ledger

| Surface | Completed safe changes | Preserved behavior |
|---|---|---|
| Shared hero, booking, food | Contrast-safe hero copy, visible initial CTA, content-shaped loaders, inline retry/recovery, form semantics | Booking/payment/session payloads, cart persistence, phone privacy, polling |
| Guest check-in, bills, kitchen, review | Touch-safe inputs/actions, announced errors/progress, keyboard/screen-reader state | Identity/visa rules, tokens, bill access/payment, separate kitchen session |
| Public information pages | Mobile target sizing, explicit external destinations, CMS seed fallback/retry, phone-first room sheet | Existing copy/data sources, URLs, SEO and external-link safety |
| Admin workspace | URL-backed mobile orientation, 44px operational controls, announced deferred/loading states | RBAC, action maps, destructive confirmations, accounting/inventory/check-in semantics |

## Completion record

| Plan rows | Result |
|---|---|
| Foundation 1–4 | Completed with the existing token system and primitives; no new visual dependency or data contract. |
| Public 1–14 | Completed or retained where the audited route already met the mobile contract. Changed routes receive contrast, action-size, recovery, semantic, or CMS-fallback improvements without changing destinations or SEO. |
| Guest/staff 15–20 | Completed with input/error/status improvements only; identity, order, bill, session, review-token, and payment behavior are unchanged. |
| Admin 21 and rollout slices | Completed incrementally through navigation, loading/status, touch-target, and selected-state improvements. Existing page/action permission gates and confirmations are unchanged. |

Final validation: `npx vitest run` (235 files, 3,386 tests), `npx playwright test e2e/public-navigation.spec.ts e2e/admin-navigation.spec.ts` (18 tests), `npx tsc --noEmit`, `git diff --check`, and `npm run build` all pass. The build retains pre-existing Next configuration and lint warnings; none were introduced or suppressed by this work.

## UI Atelier design contract

**Design read:** a mobile-first, trust-first hostel and guest-service redesign for travellers and operational staff, with a calm coastal brand language, leaning toward the existing Tailwind, Base UI, Motion, and Goko token system.

**Redesign mode:** targeted evolution. Preserve the route tree, navigation labels, logo, existing photography, page copy, structured data, booking behaviour, analytics-facing field names, and accessibility wins. The current design already has a deliberate brand system, reduced-motion support, a solid transparency fallback, reusable primitives, and real property imagery. Do not replace it with a new system or generated visual assets merely for novelty.

**UI Atelier dials:** marketing routes use variance 4, motion 3, density 4. This means calm, left-led hierarchy where the content permits it, no experimental desktop composition that collapses poorly on phones, and only purposeful transitions for state feedback or content entry. Operational routes use their existing high-information-density patterns, with mobile cards/sheets for detail instead of decorative marketing treatment.

**Atelier scope:** apply the full visual and content rules to public marketing pages. For multi-step forms and dense admin data, apply Atelier’s existing-brand, accessibility, state-design, performance, and verification rules, while retaining the app’s established form and data patterns rather than forcing landing-page layouts onto operational screens.

## Product direction and guardrails

Goko is a trust-first hostel service for travellers and staff. Keep the existing green/sand/red identity, real hostel photography, compact all-caps CTA treatment, and restrained movement. It does **not** need a new design system, new dependency, or visual rebrand.

**Mobile is the product baseline (95%).** Design, implement, and accept every route at a 390 px-wide touch viewport before looking at tablet or desktop. Tablet and desktop (the remaining 5%) must be responsive extensions of the mobile task flow—not a separate, richer experience. On a phone, each screen must present one obvious next action, keep its critical action in the thumb-reachable lower half where practical, account for safe-area insets, and avoid hover-only meaning.

Mobile non-negotiables for every row:

- single-column reading and action order first; use progressive disclosure, drawers, sheets, or details instead of shrinking dense desktop tables into unreadable columns;
- minimum 44 × 44 px actionable targets, visible pressed/focus/disabled states, no interaction that depends on hover, and no essential horizontal swipe;
- preserve the current fixed booking/help controls only when they do not cover form submission, cart checkout, dialog buttons, or focused fields; apply existing safe-area utilities;
- prevent text clipping with long names, prices, dates, locations, validation messages, and translated browser text; never block zoom or the mobile keyboard;
- use touch-safe inputs (`tel`, numeric input mode, date controls), readable line length, adequate vertical rhythm, and scroll-contained overlays that retain a reachable close button.

The visible hero video presently competes with the homepage and booking copy; fix its legibility before adding any visual decoration. Standardize the existing treatment instead of creating a second one:

- use the shared `Container`, `SectionHeader`, `Button`, `Card`, `Dialog`, `PageRibbon`, `ActionProgressProvider`, and Goko design tokens;
- give hero copy and booking panels an opaque-enough mobile-first scrim/surface, retain the still/reduced-motion fallback, and never rely on the video itself for readable text;
- use native buttons, links, labels, dialogs, tables, and lists before ARIA; every async result is inline plus `role=status`/`role=alert` where appropriate;
- keep only navigable, non-sensitive state in URLs; preserve current booking, payment, authentication, RBAC, API, and database semantics;
- do not add a dependency or a generic page-builder. Extract a component only after the same state layout is needed by three or more routes.

### Required design checks per implementation

- Preserve the existing light/dark token strategy and test both modes. Use the Goko green as the primary visual anchor and the existing red only for CTA/destructive emphasis. Do not introduce a second accent, neon glow, generic purple gradient, arbitrary new radii, a random font, or a second icon family.
- Keep glass only where it protects foreground content over real media. It must retain a solid, contrast-safe fallback under reduced transparency. Do not add glass to tables, forms, cards, or dashboards that do not sit over media.
- Every modified visual state must cover loading, success, empty, retryable error, disabled, pressed, focus-visible, and reduced-motion behavior as applicable. Skeletons match the final geometry; transient toasts never become the only error message.
- Keep hero content within the initial phone viewport: one eyebrow at most, one headline, concise supporting text, and no more than one primary plus one secondary action. The booking module is the conversion control, not another competing CTA.
- Use real existing Goko images and videos. Generate a replacement asset only if an existing asset cannot support an essential composition after crop, scrim, and typography adjustments. Never substitute fake screenshots, hand-drawn decorative SVGs, or generic stock imagery.
- Perform a final plain-language copy review. User-facing copy must be factual, direct, locally appropriate, free of invented numbers, decorative labels, and em-dashes.

## Shared foundation — implement first

1. **Hero and shell legibility** — tune `HomeHeroPremium` and `PageRibbon` to use one contrast-safe overlay rule; preserve the current reduced-motion and reduced-transparency behavior. Keep the hero to its core message and booking conversion task. Confirm the primary CTA, title, subtitle, and booking panel are readable and not covered at 390 px before checking tablet/desktop.
2. **Status-state pattern** — add the smallest reusable presentation only if it serves at least three routes: content-shaped loading, inline retryable error, empty state, and success/status copy. Ensure each mobile state has one immediate recovery action. Do not centralize route-specific recovery actions.
3. **Form and focus baseline** — use `focus-visible`, input `name`/`autocomplete`/input mode, inline errors connected to their controls, error focus on failed submit, explicit busy labels, and keyboard-safe form spacing. Do not change schemas or payloads.
4. **Admin panel convention** — use the existing URL-backed `section`/`tab` behavior and shared `Button`/`Dialog`; standardize panel title/action/empty/error and mobile data-card presentation without changing permissions or action maps. Enhance horizontal tables only at tablet/desktop when a card view would lose essential comparison context.

## Public pages

| # | Route | Safe improvement | Definition of done |
|---|---|---|---|
| 1 | `/` | Make the hero message and booking panel readable over all video frames; reduce visual competition from the background wordmark; maintain one clear primary booking action. | At 390 px, hero copy, date control, CTA, and floating actions never overlap; then verify the expanded desktop layout. Reduced motion shows the intended still hierarchy. |
| 2 | `/book` | Use the same contrast-safe booking hero; show a content-shaped handoff/loading state and a clear enquiry fallback if the booking destination cannot load. | Existing destination routing and Find my booking behavior are unchanged; fallback has a direct, labelled next action. |
| 3 | `/book/preview` | Treat as a preview-only booking surface; align its loading/error/empty states with `/book` and avoid preview-only controls leaking into live booking. | Preview cannot change booking data; live booking behavior remains untouched. |
| 4 | `/booking-enquiry` | Improve input semantics and field-error focus; make WhatsApp versus email outcomes and popup failure recovery unmistakable. | Keyboard submission, invalid email/phone/date cases, network failure, and successful email/WhatsApp paths are announced without changing the payload. |
| 5 | `/booking/[reference]` | Replace plain confirmation loading text with a confirmation-shaped skeleton; make a missing device session explain the safe recovery path and route to Find my booking. | Magic-link token removal, session storage, status fetch, and cancellation confirmation keep their present behavior. |
| 6 | `/stay` | Make room selection native and keyboard accessible; give every room detail view a consistent Book action and close/return behavior. | Room cards stay single-column and gallery controls remain thumb-reachable at 390 px; keyboard users can open/close details and reach booking. |
| 7 | `/story` | Remove decorative emoji from the H1, strengthen chronology and image/text rhythm, and retain all current story content. | One descriptive H1, sensible heading order, no copy or route changes. |
| 8 | `/things-to-do` | Remove decorative emoji from the H1; label outbound recommendations and add clear external-destination affordances. | Every outgoing action identifies its destination; cards remain readable with long venue names. |
| 9 | `/how-to-reach` | Lead with the recommended arrival path, then modes; make maps and phone actions visually scannable and retain the legacy-contact caution beside each contact. | On a phone, directions and call actions are 44 px targets and the recommended route appears before optional detail; no contact data is changed. |
| 10 | `/faqs` | Improve accordion orientation and open-state feedback; retain native keyboard behavior and schema.org FAQ data. | Tab, Enter, Space, screen-reader labels, and deep-page mobile scanning work without changing answers. |
| 11 | `/reviews` | Improve testimonial scanning with consistent quote treatment and clear source context; retain external review and booking routes. | Long reviews do not create awkward card density or overlap; external links stay safe (`noopener`). |
| 12 | `/community-area` | Keep CMS content live but make unavailable/partial CMS data recoverable and distinguish a valid empty list from a failed refresh. | Seed content remains visible during refresh failure; an empty spaces list has a helpful, non-broken state. |
| 13 | `/events` | Separate current/upcoming event information from evergreen venue information and make CMS empty/failure states explicit. | No invented event dates; unavailable CMS data does not erase the static seed experience. |
| 14 | `/quick-links` | Use one main landmark, group services by urgency (arrival, stay, food, payment), and clarify destination context for QR/actions. | One logical keyboard order, no duplicate main landmark, and all actions keep their current URLs. |

## Guest and staff service pages

| # | Route | Safe improvement | Definition of done |
|---|---|---|---|
| 15 | `/self-checkin` | Preserve the identity rules; strengthen step context, field errors, upload guidance, progress feedback, and retry copy over the hero surface. | Indian versus foreign document/visa requirements, duplicate protection, and Form C draft handling are unchanged; all failure states tell the guest what to do next. |
| 16 | `/food-order` | Replace the blank/ambiguous initial state with a menu-shaped loader; clarify phone → menu → cart state, kitchen closed/busy states, and retryable menu load failure. | Cart/session persistence, phone privacy, stock checks, checkout payload, and browser-back behavior are unchanged. |
| 17 | `/food-order/status` | Use an order-status skeleton rather than spinner-only waiting; make missing phone/order recovery and polling freshness clear. | The 10-second polling and visibility rule remain unchanged; no order data is exposed without the present phone requirement. |
| 18 | `/my-bills` | Improve phone lookup semantics and bill-card information hierarchy; distinguish open, paid, and payable amounts visually and in text. | Guest access and payment semantics remain unchanged; empty/error state links safely return to food ordering. |
| 19 | `/kitchen` | Keep standalone kitchen authentication; add password form semantics, a labelled error region, visible focus, and a concise remembered-session explanation. | Kitchen and admin sessions remain separate; no password, scope, or cookie behavior changes. |
| 20 | `/review/[token]` | Make stars and improvement choices keyboard/screen-reader operable, replace emoji-only meaning with labels, and announce asynchronous transitions/errors. | Token validation, already-rated handling, Google redirect behavior, and feedback payload are unchanged. |
| 21 | `/admin` | Improve the authenticated workspace incrementally by section: current-section orientation, URL-backed navigation only, predictable panel headers, content-shaped status states, mobile table-to-card presentation, and consistent destructive/payment/sync confirmation language. | Every operation is usable one-handed at 390 px, including long sheets/dialogs and confirmation actions; all existing page gates, action permissions, compatibility fallbacks, and API maps stay intact. |

## Admin rollout order

`/admin` is one protected route with many operational sections. Do not undertake a risky “all tabs” rewrite. Apply the shared convention in these slices and ship each slice separately:

1. navigation and dashboard orientation, including the phone drawer and safe action placement;
2. bookings, beds, timeline, inventory, and records, using cards/detail sheets before retaining a wide table;
3. food orders, kitchen-facing operations, bills, and payments, keeping primary status/action/payment information within the first phone viewport;
4. accounts, expenditure, splits, reports, and analytics, exposing totals and filters before optional detail;
5. reviews, website/CMS, management, tasks, backups, logs, and sync, with dangerous controls separated from routine actions.

For each slice, preserve its route permission and action permissions, use existing mobile table/card patterns, retain confirmation for destructive actions, and update `docs/pages-and-ui.md`, `docs/auth-rbac.md`, and `docs/api-map.md` if a rendered action, page gate, or API workflow changes.

## Delivery protocol for every item

Before implementing a row, trace the exact component, API, authorization, persisted state, provider boundary, and existing tests. Write the row’s compact risk matrix before editing:

| Surface | Required cases |
|---|---|
| Static marketing/content | 390 px first: action reachability, no overlap/overflow, reduced motion, long copy, missing image/content fallback. Then keyboard focus/order plus 768 px and 1280 px expansion checks. |
| Guest form or lookup | 390 px first: mobile keyboard, success, invalid/empty input, first-error focus, duplicate/stale response, and network retry. Then keyboard-only and larger-viewport checks. |
| Booking, food, bill, payment | 390 px first: success, validation, unavailable/stale state, retry/idempotency, provider failure, no unintended disclosure, and checkout/submit never obscured by fixed UI or keyboard. Then tablet/desktop expansion. |
| Admin operation | 390 px first: allowed user, denied permission, loading/empty/error, cancellation/destructive confirmation, modal/sheet scrolling, and stale/retry behavior. Then desktop table/comparison checks. |

Add the smallest durable coverage required by the change: pure UI branching in Vitest, API/authorization coverage when a route is involved, and deterministic Playwright coverage for every changed user-visible flow. Run focused tests, the focused Playwright spec, `npx vitest run`, `npx tsc --noEmit`, `git diff --check`, and `npm run build` before committing. For UI Atelier acceptance, capture browser screenshots and accessibility snapshots at 390 px first, then 768 px and 1280 px, and check both light and dark modes. Update the matching flow and page/RBAC/API handbook files in that same commit.

## Explicit non-goals

- No new design framework, font CDN, icon library, animation system, or CMS/data-model redesign.
- No hero video replacement unless an existing video cannot meet the contrast requirements after overlay and typography adjustments.
- No changes to prices, booking destinations, food ordering, payments, document acceptance, login/session behavior, roles, permissions, API schemas, or database migrations as part of this UI plan.
