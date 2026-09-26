# Frosted glass materials

**Git-safe.** Canonical guide for any human or AI working on Goko marketing UI. When handbook and `src/` disagree, trust [`src/app/globals.css`](../src/app/globals.css).

Goko uses CSS frosted glass (translucent fill + `backdrop-filter` blur/saturate + light rim + opaque a11y fallbacks). This is **not** Apple Liquid Glass refraction. Do not import Figma Liquid Glass kits or npm “liquid glass” packages.

## Materials (shipped)

Defined in `src/app/globals.css`:

| Class | Role | No-blur fallback | Supported fill | Blur / saturate |
|-------|------|------------------|----------------|-----------------|
| `.goko-glass-panel` | Large outer shell over hero video / ribbon | white ~0.94 + light rim | white **0.42** | **24px** / **170%** |
| `.goko-glass-chip` | Nested cards, inactive tabs, control chrome | white ~0.92 | white **0.50** | **14px** / **150%** |
| `.goko-glass-ink` | Dark sticky / floating bars | solid `rgb(26, 61, 42)` | **0.58** of brand-green-dark (`26 61 42`) | **16px** / **140%** |

Every material:

1. Starts with a near-opaque fallback (readable without blur).
2. Upgrades inside `@supports ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px)))` — declare `-webkit-backdrop-filter` before `backdrop-filter`.
3. Resets under `@media (prefers-reduced-transparency: reduce)` (solid fill, filters off).

**Chip borders:** `.goko-glass-chip` must **not** set `border:` in CSS. Call sites add Tailwind borders (`border`, `border-2 border-brand-green`, etc.) so outlines are not overridden.

## When to use which

Use glass only when a colorful backdrop (hero video, ribbon photo, strong gradient) sits **behind** the element in paint order. On flat sand or admin screens, prefer solid surfaces.

| Surface | Class |
|---------|--------|
| Page / section outer card | `.goko-glass-panel` (remove opaque `bg-white`) |
| Inner cards, inactive tabs, qty / secondary chrome | `.goko-glass-chip` |
| Dark sticky summary or floating bar | `.goko-glass-ink` + light text |
| Primary CTA | Keep solid `bg-brand-red` (or existing CTA) |
| Selected / active tab | Keep solid `bg-brand-green` |
| Text inputs | Keep solid `bg-white` for typing contrast |
| Small pills / badges | Usually solid sand / tint — do not frost every chip |

Layering: panel more open than chips so nested panes read as frosted layers over the media.

## Apply checklist

1. Confirm media (or gradient) is behind the glass node (z-index / DOM order).
2. Drop opaque fill classes that fight the material (`bg-white`, `bg-brand-green-dark` on the same node).
3. Add the matching `goko-glass-*` class; keep radius/shadow/padding utilities.
4. Keep nested text fields and primary buttons solid.
5. Cap nested blur: one panel + a few chips + at most one ink bar over looping video.
6. Shared components: opt in explicitly (example: `DateRangePicker` `surface="glass"`). Do not flip admin/sand defaults to glass.
7. Update this file if tokens change; update the page handbook (`guest-booking-ui.md`, `pages-and-ui.md`, etc.) for the product surface; add/extend a Vitest source contract for marketing UI.
8. Validate: touched Vitest file(s) + `npx tsc --noEmit`.

## Do not

- Claim or implement true Apple Liquid Glass refraction/specular SVG filters for booking forms.
- Glassify primary red CTAs or the selected tab.
- Put `border:` on `.goko-glass-chip` in `globals.css`.
- Stack dozens of `backdrop-filter` nodes over hero video (perf).
- Add third-party glass design-system dependencies for this look.

## Reference implementation

| Piece | Location |
|-------|----------|
| CSS materials | `src/app/globals.css` (`.goko-glass-panel` / `-chip` / `-ink`) |
| Booking shell, cards, sticky, Review | `src/components/booking/BookingHeroPanel.tsx` |
| Self check-in page hero + form shells | `src/app/self-checkin/page.tsx`, `src/components/forms/SelfCheckinForm.tsx` |
| Opt-in date trigger | `src/components/dates/DateRangePicker.tsx` (`surface="glass"`) |
| Source contracts | `src/__tests__/guest-booking-mobile.test.ts`, `src/__tests__/date-range-picker.test.ts`, `src/__tests__/cpu-lookup-checkin-workflows.test.ts` |
| Guest booking product copy | [guest-booking-ui.md](guest-booking-ui.md) |
| Guest check-in flow | [flows-guest-checkin.md](flows-guest-checkin.md) |

## Tweaking opacity

If a surface is too washed on a still-image page (e.g. `/book`) but fine over video (homepage), raise **chip** fill slightly (0.50 → 0.55) before raising the shell. Keep the panel more transparent than chips.

When changing tokens in `globals.css`, update the table in this file and any Vitest assertions that pin rgba/blur values in the same turn.

## Cursor note

A thin Cursor skill at `.cursor/skills/goko-frosted-glass/` points agents at **this** handbook. Other AI tools should read `docs/frosted-glass.md` directly (and `docs/README.md` for the handbook index).
