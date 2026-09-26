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
    expect(picker).toContain("DUAL_MONTH_MIN_WIDTH");
    expect(picker).toContain("ResizeObserver");
    expect(picker).not.toContain("overflow-x-auto");
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
    expect(panel).not.toContain("Need help? Send an enquiry");
    expect(panel).not.toContain(">Contact Goko<");
  });
  it("moves focus to review without enabling payment or changing privacy", () => {
    expect(panel).toContain('focus({ preventScroll: true })'); expect(panel).toContain('scroll-mt-24');
    expect(panel).toContain("function openReview()");
    expect(panel).toContain("onClick={openReview}");
    expect(panel).toContain("setReview(true) is a no-op when already open");
    expect(panel).toMatch(/<button type="button" className=\{action\} disabled>Payment unavailable/);
    expect(panel).toContain('These details stay in this page only until online checkout is ready.');
    expect(panel).toContain("Guest name <span className=\"text-brand-red\" aria-hidden=\"true\">*</span>");
    expect(panel).toContain("Email <span className=\"text-brand-red\" aria-hidden=\"true\">*</span>");
    expect(panel).toContain("Phone <span className=\"text-brand-red\" aria-hidden=\"true\">*</span>");
    expect(panel).toContain("Guests <span className=\"text-brand-red\" aria-hidden=\"true\">*</span>");
    expect(panel).toContain("guestDetailsComplete");
    expect(panel).toContain("Fill in guest name, email, phone and guests to enable Pay now");
    expect(panel).toContain("Your selection sleeps up to {capacity}");
    expect(panel).toContain("Add beds for {guestsShortfall} more");
    expect(panel).not.toContain("or lower Guests");
    expect(panel).not.toContain("Live payments — real money");
    expect(panel).not.toContain("Test-mode payments only");
    expect(panel).not.toContain("Ask Goko on WhatsApp");
  });
  it("uses large payment radio targets and stores only guestAccessToken", () => {
    expect(panel).toContain('min-h-12 cursor-pointer items-center gap-3');
    expect(panel).toContain('has-[:checked]:border-brand-green');
    expect(panel).toContain('retry: { enabled: false }');
    expect(panel).toContain("function goToConfirmation(ref: string, guestAccessToken?: string | null)");
    expect(panel).toContain("sessionStorage.setItem(`goko_booking_${ref}`, JSON.stringify({ guestAccessToken }))");
    expect(panel).toContain("location.replace(`/booking/${encodeURIComponent(ref)}`)");
    expect(panel).not.toMatch(/sessionStorage\.setItem\([^)]*ownerToken/);
    const confirmation = readFileSync("src/app/(marketing)/booking/[reference]/page.tsx", "utf8");
    expect(confirmation).toContain('pb-[max(2.5rem,env(safe-area-inset-bottom))]');
    expect(confirmation).toContain('guestAccessToken');
    expect(confirmation).not.toContain('ownerToken');
  });
  it("blocks search until both stay dates are chosen", () => {
    expect(panel).toContain("stayReady");
    expect(panel).toContain("disabled={busy || !stayReady}");
    expect(panel).toContain("Choose your check-in and check-out dates.");
  });
  it("gently scrolls the first available result into view", () => {
    expect(panel).toContain("firstAvailabilityCardRef");
    expect(panel).toContain("window.requestAnimationFrame");
    expect(panel).toContain('window.matchMedia("(prefers-reduced-motion: reduce)")');
    expect(panel).toContain('block: "start", behavior');
    expect(panel).toContain('className="scroll-mt-24');
    expect(panel).toContain("if (!rooms?.length) return;");
  });
  it("searches with dates only, shows nightly prices and uses a configured limit", () => {
    expect(panel).not.toContain('stay.guests');
    expect(panel).toContain('maxSelectedBeds'); expect(panel).toContain('Maximum {maxSelectedBeds} beds reached');
    expect(panel).not.toContain('Choose up to'); expect(panel).not.toContain('Availability is advisory');
    expect(panel).toContain('/ bed / night'); expect(panel).toContain('per bed for {rate.nightlyRates.length} nights');
    expect(panel).not.toContain('stay.units'); expect(panel).not.toContain('Beds / units');
    expect(panel).toContain('useState<GuestRoom[] | null>(null)');
    expect(panel).toContain('<ImageCarousel'); expect(panel).toContain('controls="overlay"'); expect(panel).toContain('Representative dorm photos');
    expect(panel).toContain('resolveRoomGallery');
    expect(panel).toContain('Switch rate'); expect(panel).toContain('canAddGuestRoom(rooms || [], current');
  });
  it("fetches actual configured data in preview instead of injecting sample rates", () => {
    const previewPage = readFileSync("src/app/(marketing)/book/preview/page.tsx", "utf8");
    expect(panel).toContain("async function runAvailabilitySearch");
    expect(panel).toContain('fetch(`/api/guest-booking/availability?${new URLSearchParams(next)}');
    expect(panel).toContain("setMaxSelectedBeds(data.maxSelectedBeds)");
    const searchBody = panel.slice(panel.indexOf("async function search("), panel.indexOf("async function lookup("));
    expect(searchBody).not.toContain("if (preview)");
    expect(searchBody).toContain('window.location.pathname === "/"');
    expect(searchBody).toContain('window.location.assign(`/book?${q}`)');
    expect(searchBody).toContain("await runAvailabilitySearch(stay)");
    expect(previewPage).not.toContain("subtotalRupees"); expect(previewPage).not.toContain("rooms:");
    expect(panel).not.toContain("Sample rate"); expect(panel).not.toContain("preview?.taxPercent");
    expect(panel).toContain("Booking lookup and email sending are disabled in this preview.");
  });

  it("hands homepage Check availability off to /book with dates and auto-searches", () => {
    expect(panel).toContain('window.location.pathname === "/"');
    expect(panel).toContain("checkinDate: stay.checkinDate, checkoutDate: stay.checkoutDate");
    expect(panel).toContain('window.location.assign(`/book?${q}`)');
    expect(panel).toContain('window.location.pathname !== "/book"');
    expect(panel).toContain('params.get("checkinDate")');
    expect(panel).toContain('params.get("checkoutDate")');
    expect(panel).toContain("autoSearchStarted");
    expect(panel).toContain("void runAvailabilitySearch({ checkinDate, checkoutDate })");
  });

  it("declutters hero CTAs and booking panel copy; Find my booking notes website-only", () => {
    expect(home).not.toContain("BookNowButton");
    expect(home).not.toContain("Explore rooms");
    expect(panel).not.toContain("Find your bed by the beach");
    expect(panel).toContain("Find my booking");
    expect(panel).not.toContain('"My booking"');
    expect(panel).toContain("Currently we only support finding bookings made through the Goko website.");
  });

  it("shows strikethrough compare-at prices when direct-booking discount applies", () => {
    expect(panel).toContain("function DiscountPrice(");
    expect(panel).toContain("standardSubtotalRupees");
    expect(panel).toContain("hasDirectDiscount");
    expect(panel).toContain("standardTotals");
    expect(panel).toContain("bookingTotals(standardSubtotal");
    expect(panel).toContain("line-through decoration-2");
    expect(panel).toContain("<DiscountPrice");
    expect(panel).toContain("standard={standardLine}");
    expect(panel).toContain("standard={standardSubtotal}");
    expect(panel).toContain("standard={standardTotals?.total");
    expect(panel).toContain("tone=\"dark\"");
    expect(panel).toContain("size=\"lg\"");
    expect(panel).toContain("You save ${money(standardSubtotal - subtotal)}");
  });

  it("starts Guests empty so party size is entered deliberately", () => {
    expect(panel).toContain('const [persons, setPersons] = useState("")');
    expect(panel).not.toContain('const [persons, setPersons] = useState("1")');
    expect(panel).toContain("persons !== \"\" && Number.isInteger(Number(persons))");
  });

  it("uses a frosted glass outer shell with solid nested surfaces and sticky estimate", () => {
    expect(panel).toContain("goko-glass-panel");
    expect(panel).toMatch(/className="goko-glass-panel min-w-0 rounded-2xl/);
    expect(panel).not.toMatch(/data-booking-in-view=\{inView\} className="[^"]*bg-white/);
    expect(panel).toContain('rounded-2xl border border-brand-green/20 bg-white');
    expect(panel).toContain("bg-brand-green-dark");
    expect(css).toContain(".goko-glass-panel");
    expect(css).toContain("backdrop-filter: blur(20px) saturate(160%)");
    expect(css).toContain("-webkit-backdrop-filter: blur(20px) saturate(160%)");
    expect(css).toContain("prefers-reduced-transparency: reduce");
    expect(css).toMatch(/@supports \(\(backdrop-filter: blur\(1px\)\) or \(-webkit-backdrop-filter: blur\(1px\)\)\)/);
  });
});
