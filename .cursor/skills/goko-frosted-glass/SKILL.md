---
name: goko-frosted-glass
description: >-
  Applies Goko’s frosted glass materials (panel / chip / ink) over video or
  imagery using existing globals.css utilities. Use when the user asks for
  frosted glass, glassmorphism, translucent glass, Apple glass, liquid glass
  look, or to frost UI shells/cards/sticky bars on marketing pages.
---

# Goko frosted glass

Reuse the shipped CSS materials. Do **not** add npm Liquid Glass packages, Figma kit imports, or SVG refraction filters.

## Source of truth

Classes live in [`src/app/globals.css`](src/app/globals.css):

| Class | Role | Supported fill | Blur / saturate |
|-------|------|----------------|-----------------|
| `.goko-glass-panel` | Large outer shell | white **0.42** | **24px** / **170%** |
| `.goko-glass-chip` | Nested cards, inactive tabs, controls | white **0.50** | **14px** / **150%** |
| `.goko-glass-ink` | Dark sticky / floating bars | brand-green-dark **0.58** (`26 61 42`) | **16px** / **140%** |

Each class has:
1. Near-opaque fallback (no blur support).
2. `@supports ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px)))` upgrade (set `-webkit-` first).
3. `@media (prefers-reduced-transparency: reduce)` → solid fill, filters off.

**Chip borders:** CSS sets fill/blur only. Put Tailwind `border …` on the element so outlines (e.g. `border-2 border-brand-green`) are not overridden.

## When to use which

```
Over hero video / ribbon image?
  ├─ Outer wrapper → goko-glass-panel (replace solid bg-white)
  ├─ Inner cards / inactive chrome → goko-glass-chip
  ├─ Dark sticky summary / floating bar → goko-glass-ink + light text
  └─ Stay solid:
       • Primary CTAs (bg-brand-red)
       • Selected / active tab (bg-brand-green)
       • Text inputs (bg-white) for typing contrast
```

Prefer glass only where a colorful backdrop (video, photo, gradient) sits behind the element. On flat sand/admin pages, solid surfaces usually win.

## Apply workflow

1. Confirm backdrop content will show through (z-order: media behind the glass node).
2. Remove opaque `bg-white` / `bg-brand-green-dark` from the target; add the matching `goko-glass-*` class.
3. Keep nested typing fields and primary buttons solid.
4. Cap nested blur: one panel + a few chips + at most one ink bar. Do not frost every pill/badge.
5. Shared components (e.g. `DateRangePicker`): add an explicit opt-in (`surface="glass"`) so admin/sand callers stay solid — do not change global defaults to glass.
6. Update handbook for the page (`docs/guest-booking-ui.md` or `docs/pages-and-ui.md`) and a focused Vitest source contract that asserts the class names + CSS tokens if the surface is user-visible marketing UI.
7. Run the touched Vitest file(s) + `npx tsc --noEmit`.

## Do not

- Import Figma iOS Liquid Glass kits or `liquidglass-tailwind`-style deps.
- Glassify primary red CTAs or selected tabs.
- Put `border:` on `.goko-glass-chip` in CSS.
- Stack dozens of `backdrop-filter` nodes over looping video.
- Claim true Apple Liquid Glass refraction — web target is frosted glass only.

## Reference implementation

- Shell + chips + ink: [`src/components/booking/BookingHeroPanel.tsx`](src/components/booking/BookingHeroPanel.tsx)
- Opt-in date trigger: [`src/components/dates/DateRangePicker.tsx`](src/components/dates/DateRangePicker.tsx) (`surface="glass"`)
- Contracts: [`src/__tests__/guest-booking-mobile.test.ts`](src/__tests__/guest-booking-mobile.test.ts)
- Product copy: [`docs/guest-booking-ui.md`](docs/guest-booking-ui.md)

## Tweaking opacity later

If a surface is too washed on `/book` (still image) but fine on home (video), raise **chip** fill slightly (e.g. 0.50 → 0.55) before raising the shell. Keep panel more open than chips so layering reads.
