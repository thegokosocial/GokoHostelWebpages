import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const panel = readFileSync("src/components/booking/BookingHeroPanel.tsx", "utf8");
const ribbon = readFileSync("src/components/layout/PageRibbon.tsx", "utf8");
const home = readFileSync("src/components/sections/HomeHeroPremium.tsx", "utf8");
const css = readFileSync("src/app/globals.css", "utf8");

// Source-level layout contracts; actual dimensions/interaction are checked in-browser.
describe("Mobile-first booking layout contracts", () => {
  it("retains 48px fields, 16px input text, dual-month date picker and phone keyboards", () => {
    expect(panel).toMatch(/const field = "[^"]*min-h-12[^"]*min-w-0[^"]*text-base/);
    expect(panel).toContain("DateRangePicker");
    expect(panel).toContain("maxNights={30}");
    expect(readFileSync("src/components/dates/DateRangePicker.tsx", "utf8")).toContain("min={minNights}");
    expect(readFileSync("src/components/dates/DateRangePicker.tsx", "utf8")).toContain("max={maxNights ?? undefined}");
    expect(panel).toContain('type="tel"');
    expect(panel).toContain('inputMode="numeric"'); expect(panel).toContain('autoComplete="one-time-code"');
  });
  it("keeps date picker full-width on narrow screens and mobile search full-width", () => {
    expect(panel).toContain("col-span-2 min-w-0 text-sm font-semibold lg:col-span-2");
    expect(panel).not.toContain("min-[360px]:col-span-1");
    expect(panel).toContain('col-span-2 lg:col-span-1');
    const picker = readFileSync("src/components/dates/DateRangePicker.tsx", "utf8");
    expect(picker).toContain("max-w-[calc(100vw-2rem)]");
    expect(readFileSync("src/components/ui/calendar.tsx", "utf8")).toContain("flex-1");
  });
  it("keeps the mobile summary safe-area-aware without a fixed overlay", () => {
    expect(panel).toContain('data-booking-summary');
    expect(panel).toContain('sticky bottom-[max(0.5rem,env(safe-area-inset-bottom))]');
    expect(panel).toContain('xl:top-24 xl:bottom-auto'); expect(ribbon).toContain('children ? "overflow-clip"');
    expect(home).toContain('items-end overflow-clip');
    expect(ribbon).toContain('goko-hero-title');
    expect(home).toContain('goko-hero-title');
  });
  it("temporarily suppresses overlapping floats only on phones, and cleans up observation", () => {
    expect(css).toMatch(/@media \(max-width: 767px\)\s*\{\s*body:has\(\[data-booking-in-view="true"\]\) \.goko-floating-bottom\s*\{\s*display: none/);
    expect(panel).toContain('setInView(entry.isIntersecting)'); expect(panel).toContain('observer.disconnect()');
    expect(panel).toContain('Contact Goko');
  });
  it("moves focus to review without enabling payment or changing privacy", () => {
    expect(panel).toContain('focus({ preventScroll: true })'); expect(panel).toContain('scroll-mt-24');
    expect(panel).toMatch(/<button type="button" className=\{action\} disabled>Payment unavailable/);
    expect(panel).toContain('These details stay in this page only.');
  });
  it("blocks search until both stay dates are chosen", () => {
    expect(panel).toContain("stayReady");
    expect(panel).toContain("disabled={busy || !stayReady}");
    expect(panel).toContain("Choose your check-in and check-out dates.");
  });
  it("searches with dates only, shows nightly prices and uses a configured limit", () => {
    expect(panel).not.toContain('stay.guests');
    expect(panel).toContain('maxSelectedBeds'); expect(panel).toContain('Maximum {maxSelectedBeds} beds reached');
    expect(panel).not.toContain('Choose up to'); expect(panel).not.toContain('Availability is advisory');
    expect(panel).toContain('/ bed / night'); expect(panel).toContain('per bed for {rate.nightlyRates.length} nights');
    expect(panel).not.toContain('stay.units'); expect(panel).not.toContain('Beds / units');
    expect(panel).toContain('useState<GuestRoom[] | null>(null)');
    expect(panel).toContain('<ImageCarousel'); expect(panel).toContain('Representative dorm photos');
    expect(panel).toContain('Switch rate'); expect(panel).toContain('canAddGuestRoom(rooms || [], current');
  });
  it("fetches actual configured data in preview instead of injecting sample rates", () => {
    const previewPage = readFileSync("src/app/(marketing)/book/preview/page.tsx", "utf8");
    const searchBody = panel.slice(panel.indexOf('async function search('), panel.indexOf('async function lookup('));
    expect(searchBody).toContain('fetch(`/api/guest-booking/availability?${new URLSearchParams(stay)}');
    expect(searchBody).not.toContain('if (preview)');
    expect(searchBody).toContain('setMaxSelectedBeds(data.maxSelectedBeds)');
    expect(previewPage).not.toContain('subtotalRupees'); expect(previewPage).not.toContain('rooms:');
    expect(panel).not.toContain('Sample rate'); expect(panel).not.toContain('preview?.taxPercent');
    expect(panel).toContain('Booking lookup and email sending are disabled in this preview.');
  });
});
