import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { isWeekend, getNights, platformLogo, stayOverlapsVisible, rangeCoveringStay, computeTilePlacements, getDatesArray, collectionCopy, displayedStayPayment, formatCurrency } from "@/components/admin/booking-dashboard/utils";
import { sqliteWriteCount } from "@/lib/sqliteWriteCount";
import { isRetryableAdminResponse } from "@/components/admin/useAdminApi";
import { isTransientError } from "@/lib/dbRetry";

const ROOT = path.resolve(__dirname, "../..");

function readFile(relativePath: string): string {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf-8");
}

describe("Booking Dashboard: Query Logic Verification", () => {
  describe("checkBedAvailability", () => {
    const queriesCode = readFile("src/db/queries.ts");

    it("has correct overlap condition: checkin_date < checkoutDate AND checkout_date > checkinDate", () => {
      const fnMatch = queriesCode.match(
        /export async function checkBedAvailability[\s\S]*?return \(blocked\[0\]/
      );
      expect(fnMatch).not.toBeNull();
      const fn = fnMatch![0];

      expect(fn).toContain("checkinDate} < ${checkoutDate}");
      expect(fn).toContain("checkoutDate} > ${checkinDate}");
      expect(fn).toContain("checkoutDate} > ${bookingBedAssignments.checkinDate}");
    });

    it("filters only 'assigned' status", () => {
      const fnMatch = queriesCode.match(
        /export async function checkBedAvailability[\s\S]*?return \(blocked\[0\]/
      );
      const fn = fnMatch![0];
      expect(fn).toContain('eq(bookingBedAssignments.status, "assigned")');
    });

    it("supports excludeBookingId to ignore current booking's own assignments", () => {
      const fnMatch = queriesCode.match(
        /export async function checkBedAvailability[\s\S]*?return \(blocked\[0\]/
      );
      const fn = fnMatch![0];
      expect(fn).toContain("excludeBookingId");
      expect(fn).toContain("bookingId} != ${excludeBookingId}");
    });

    it("returns false when an assignment conflicts, else checks bed_blocks", () => {
      const fnMatch = queriesCode.match(
        /export async function checkBedAvailability[\s\S]*?return \(blocked\[0\][\s\S]*?\n\}/
      );
      expect(fnMatch).not.toBeNull();
      const fn = fnMatch![0];
      expect(fn).toContain("=== 0");
      expect(fn).toContain("bedBlocks");
    });
  });

  describe("assignBedToBooking", () => {
    const queriesCode = readFile("src/db/queries.ts");
    const fn = queriesCode.match(
      /export async function assignBedToBooking[\s\S]*?\nexport async function unassignBookingBeds/
    )![0];

    it("uses INSERT ... WHERE NOT EXISTS pattern for atomic conflict check", () => {
      expect(fn).toContain("INSERT INTO booking_bed_assignments");
      expect(fn).toContain("WHERE NOT EXISTS");
      expect(fn).toContain("SELECT 1 FROM booking_bed_assignments");
    });

    it("conflict check uses same overlap logic (checkin_date < checkoutDate AND checkout_date > checkinDate)", () => {
      expect(fn).toContain("checkin_date < ${data.checkoutDate}");
      expect(fn).toContain("checkout_date > ${data.checkinDate}");
      expect(fn).toContain("checkout_date > checkin_date");
    });

    it("returns true when a row is written, or when this stay+bed already exists after a D1 retry", () => {
      expect(fn).toContain("sqliteWriteCount");
      expect(fn).toContain("> 0");
      expect(fn).toContain("idempotentWrite: true");
      expect(fn).toContain("own.length > 0");
      expect(fn).toContain("eq(bookingBedAssignments.bookingId, data.bookingId)");
      expect(fn).toContain("eq(bookingBedAssignments.bedId, data.bedId)");
    });

    it("only blocks against 'assigned' status conflicts", () => {
      expect(fn).toContain("status = 'assigned'");
    });
  });
});

describe("Booking Dashboard: modifyCheckin Scenarios", () => {
  const routeCode = readFile("src/app/api/admin/bookings/route.ts");

  it("handles CI-1: late check-in (new > old, new < checkout) — updates assignments to shorter range", () => {
    const modifySection = routeCode.match(
      /action === "modifyCheckin"[\s\S]*?action === "modifyCheckout"/
    );
    expect(modifySection).not.toBeNull();
    const section = modifySection![0];

    expect(section).toContain("isEarlier = newCheckinDate < oldCheckin");
    expect(section).toContain("Late check-in");
    expect(section).toContain("reassignSameBeds(bookingId, currentAssignments, newCheckinDate, oldCheckout");
    expect(routeCode).toContain("await unassignBookingBeds(bookingId)");
  });

  it("handles CI-2: late check-in where new >= checkout — returns 400 error", () => {
    const modifySection = routeCode.match(
      /action === "modifyCheckin"[\s\S]*?action === "modifyCheckout"/
    );
    const section = modifySection![0];

    expect(section).toContain("newCheckinDate >= oldCheckout");
    expect(section).toContain("New check-in date must be before check-out date");
    expect(section).toContain("status: 400");
  });

  it("handles CI-3: early check-in (new < old), same bed available — extends with payment recalc", () => {
    const modifySection = routeCode.match(
      /action === "modifyCheckin"[\s\S]*?action === "modifyCheckout"/
    );
    const section = modifySection![0];

    expect(section).toContain("isEarlier = newCheckinDate < oldCheckin");
    expect(section).toContain("checkBedAvailability(a.bedId, newCheckinDate");
    expect(section).toContain("allAvailable");
    expect(section).toContain("nightlyRate * nights * bedsCount");
    expect(section).toContain("stayAmounts(");
    expect(section).toContain("loadBookingTaxPercent");
  });

  it("handles CI-4: early check-in, same bed NOT available — returns needsSelection with available beds", () => {
    const modifySection = routeCode.match(
      /action === "modifyCheckin"[\s\S]*?action === "modifyCheckout"/
    );
    const section = modifySection![0];

    expect(section).toContain("!allAvailable && !confirmed");
    expect(section).toContain("needsSelection: true");
    expect(section).toContain("availableBeds");
    expect(section).toContain("getAvailableBedsForRange(newCheckinDate");
  });

  it("always recalculates amountBeforeTax, amountTax, amountTotal on date change", () => {
    const modifySection = routeCode.match(
      /action === "modifyCheckin"[\s\S]*?action === "modifyCheckout"/
    );
    const section = modifySection![0];

    expect(section).toContain("updateBookingFull(bookingId, {");
    expect(section).toContain("amountBeforeTax: totalBeforeTax");
    expect(section).toContain("amountTax: tax");
    expect(section).toContain("amountTotal: totalBeforeTax + tax");
    expect(section).toContain("checkoutDate: oldCheckout");
  });
});

describe("Booking Dashboard: cancelBooking Logic", () => {
  const routeCode = readFile("src/app/api/admin/bookings/route.ts");

  describe("Full cancellation (no assignmentIds)", () => {
    it("sets status to 'cancelled'", () => {
      const cancelSection = routeCode.match(
        /action === "cancelBooking"[\s\S]*?action === "markNoShow"/
      );
      expect(cancelSection).not.toBeNull();
      const section = cancelSection![0];

      expect(section).toContain('status: "cancelled"');
    });

    it("sets cancelledAt and cancelledBy", () => {
      const cancelSection = routeCode.match(
        /action === "cancelBooking"[\s\S]*?action === "markNoShow"/
      );
      const section = cancelSection![0];

      expect(section).toContain("cancelledAt: now");
      expect(section).toContain("cancelledBy: actingUser");
    });

    it("unassigns all bed assignments via unassignBookingBeds", () => {
      const cancelSection = routeCode.match(
        /action === "cancelBooking"[\s\S]*?action === "markNoShow"/
      );
      const section = cancelSection![0];

      expect(section).toContain("unassignBookingBeds(bookingId)");
    });

    it("triggers inventory push", () => {
      const cancelSection = routeCode.match(
        /action === "cancelBooking"[\s\S]*?action === "markNoShow"/
      );
      const section = cancelSection![0];

      expect(section).toContain("pushIfOtaChanged(before, dormIds, cancelDates)");
    });
  });

  describe("Partial cancellation (with assignmentIds)", () => {
    it("uses cancelBedAssignments with specific IDs", () => {
      const cancelSection = routeCode.match(
        /action === "cancelBooking"[\s\S]*?action === "markNoShow"/
      );
      const section = cancelSection![0];

      expect(section).toContain("cancelBedAssignments(ownIds, bookingId)");
    });

    it("does NOT set booking status to cancelled", () => {
      const cancelSection = routeCode.match(
        /action === "cancelBooking"[\s\S]*?action === "markNoShow"/
      );
      const section = cancelSection![0];

      const partialBlock = section.match(
        /assignmentIds && Array\.isArray[\s\S]*?} else/
      );
      expect(partialBlock).not.toBeNull();
      expect(partialBlock![0]).not.toContain('status: "cancelled"');
    });

    it("logs partial cancellation in history", () => {
      const cancelSection = routeCode.match(
        /action === "cancelBooking"[\s\S]*?action === "markNoShow"/
      );
      const section = cancelSection![0];

      expect(section).toContain("Partial Cancellation");
      expect(section).toContain("assignmentIds.length");
    });
  });
});

describe("Booking Dashboard: markNoShow Logic", () => {
  const routeCode = readFile("src/app/api/admin/bookings/route.ts");

  it("sets status to 'no_show'", () => {
    const noShowSection = routeCode.match(
      /action === "markNoShow"[\s\S]*?action === "unassign"/
    );
    expect(noShowSection).not.toBeNull();
    const section = noShowSection![0];

    expect(section).toContain('status: "no_show"');
  });

  it("calls pushNoShow for Booking.com channel ids stored as booking.com or booking_com", () => {
    const noShowSection = routeCode.match(
      /action === "markNoShow"[\s\S]*?action === "unassign"/
    );
    const section = noShowSection![0];

    expect(section).toContain("syncBookingNoShow(bookingId, detail.booking)");
  });

  it("triggers inventory push", () => {
    const noShowSection = routeCode.match(
      /action === "markNoShow"[\s\S]*?action === "unassign"/
    );
    const section = noShowSection![0];

    expect(section).toContain("pushIfOtaChanged(before, dormIds, dates)");
  });
});

describe("Dashboard booking activity", () => {
  const dashboardRoute = readFile("src/app/api/admin/checkins/route.ts");
  const dashboard = readFile("src/components/admin/AdminDashboard.tsx");
  const bookingDashboard = readFile("src/components/admin/booking-dashboard/index.tsx");

  it("uses IST day boundaries and counts only explicit cancellation events", () => {
    expect(dashboardRoute).toContain('T00:00:00+05:30');
    expect(dashboardRoute).toContain('sql`${bookings.createdAt} >= ${todayStart}`');
    expect(dashboardRoute).toContain('sql`${bookings.createdAt} < ${tomorrowStart}`');
    expect(dashboardRoute).toContain('["Cancelled", "Cancelled from Channel", "Partial Cancellation"]');
    expect(dashboardRoute).not.toMatch(/inArray\(bookingHistory\.action,[\s\S]{0,120}"Beds Unassigned"/);
  });

  it("links dashboard rows to direct booking details outside the calendar range", () => {
    expect(dashboard).toContain('onNavigate("bookings", { bookingId: booking.id })');
    expect(bookingDashboard).toContain('action: "getDetail", bookingId');
    expect(bookingDashboard).toContain('externalDetail?.booking.id === selectedBookingId');
    expect(bookingDashboard).toContain('setExternalDetail({ booking: detail.booking, assignments: detail.assignments || [] })');
  });
});

describe("Booking Dashboard: moveRoom assigns the new bed before releasing the old one", () => {
  const routeCode = readFile("src/app/api/admin/bookings/route.ts");

  it("keeps the guest on the old bed if the new bed cannot be assigned", () => {
    const section = routeCode.match(/action === "moveRoom"[\s\S]*?action === "assignGuest"/)![0];
    const rejectAt = section.indexOf("Assignment not found on this booking");
    const assignAt = section.indexOf("assignTaggedBeds(bookingId, [newBedId]");
    const cancelAt = section.indexOf("cancelBedAssignments([oldAssignmentId], bookingId)");
    expect(rejectAt).toBeGreaterThan(0);
    expect(assignAt).toBeGreaterThan(rejectAt);
    expect(cancelAt).toBeGreaterThan(assignAt);
  });
});

describe("Booking Calendar: inclusive last night", () => {
  const queriesCode = readFile("src/db/queries.ts");

  function occupiesInclusiveRange(checkin: string, checkout: string, start: string, end: string) {
    return checkin <= end && checkout > start;
  }

  it("treats the calendar end date as the last visible night, not an exclusive checkout", () => {
    const fn = queriesCode.match(/export async function getBookingCalendarData[\s\S]*?return \{ bookings/ )![0];
    expect(fn).toContain("checkinDate} <= ${endDate}");
    expect(fn).toContain("checkoutDate} > ${startDate}");
    expect(fn).toContain("checkoutDate} > ${bookingBedAssignments.checkinDate}");
    expect(fn).toContain("inArray(bookings.id, missing)");
    expect(fn).not.toMatch(/checkinDate\} < \$\{endDate\}/);
    expect(fn).toContain("assignments.map((a) => a.bookingId)");
  });

  it("includes a 6 Sep stay on the default 10-day view that ends 6 Sep", () => {
    // 29 Aug → range Aug 28 .. Sep 6 (yesterday through yesterday+9)
    expect(occupiesInclusiveRange("2026-09-06", "2026-09-07", "2026-08-28", "2026-09-06")).toBe(true);
    expect("2026-09-06" < "2026-09-06").toBe(false);
  });
});

describe("Booking Calendar: sticky dates and row colour", () => {
  const grid = readFile("src/components/admin/booking-dashboard/BookingCalendarGrid.tsx");
  const dashboard = readFile("src/components/admin/booking-dashboard/index.tsx");
  const adminPage = readFile("src/app/admin/page.tsx");
  const utils = readFile("src/components/admin/booking-dashboard/utils.ts");

  it("scrolls inside overflow-auto so sticky top is not cancelled by overflow-x-auto alone", () => {
    const open = grid.indexOf('<div className="isolate');
    const slice = grid.slice(open, open + 400);
    expect(slice).toMatch(/overflow-auto/);
    expect(slice).not.toMatch(/className="overflow-x-auto/);
    expect(grid).toMatch(/sticky top-0 z-20/);
    expect(grid).toMatch(/sticky top-0 left-0 z-30/);
    expect(grid).toMatch(/sticky left-0 z-20/);
  });

  it("fills leftover viewport and skips y-transform on the bookings tab", () => {
    expect(dashboard).toMatch(/flex h-full min-h-0 flex-1 flex-col gap-4/);
    expect(adminPage).toMatch(/fillViewport = section === "inventory" \|\| section === "bookings"/);
    expect(adminPage).toMatch(/fillViewport && "flex h-full min-h-0 flex-1 flex-col"/);
    expect(adminPage).not.toMatch(/framer-motion/);
  });

  it("includes actionable diagnostics when the calendar API fails", () => {
    const dashboard = readFile("src/components/admin/booking-dashboard/index.tsx");
    const route = readFile("src/app/api/admin/bookings/route.ts");
    const toast = readFile("src/components/admin/AdminToast.tsx");

    expect(dashboard).toContain('apiErrorDetails(calRes, data, "getCalendarData")');
    expect(route).toContain('stage = "calculate nightly availability"');
    expect(route).toContain('"x-goko-request-id": requestId');
    expect(route).toContain("serverTime: new Date().toISOString()");
    expect(toast).toContain("Report ID:");
    expect(toast).toContain("Network:");
    expect(toast).toContain("Timezone:");
  });

  it("does not force a 1-day tile when exclusive checkout equals check-in", () => {
    expect(utils).toContain("if (endIdx <= startIdx) continue");
    expect(utils).not.toContain("Math.max(1, endIdx - startIdx)");
    expect(grid).toContain("computeTilePlacements");
  });

  it("tints weekends, today, dorm groups, and blocked beds", () => {
    expect(utils).toContain("export function isWeekend");
    expect(utils).toContain("getUTCDay()");
    expect(grid).toContain("isWeekend(date)");
    expect(grid).toContain("bg-emerald-50");
    expect(grid).toContain("bg-sky-50");
    expect(grid).toContain("bg-brand-sand");
    expect(grid).toContain("bg-amber-50/90");
    expect(grid).toContain("bg-orange-50");
    expect(grid).toContain("bed.availability?.[date]");
    expect(grid).not.toContain("bed.isBlocked");
    expect(isWeekend("2026-08-29")).toBe(true);
    expect(isWeekend("2026-08-30")).toBe(true);
    expect(isWeekend("2026-08-31")).toBe(false);
  });
});

describe("Booking API: calendar enrich and rates batch", () => {
  const route = readFile("src/app/api/admin/bookings/route.ts");

  it("maps beds by id instead of find-per-assignment", () => {
    const section = route.match(/action === "getCalendarData"[\s\S]*?action === "getDetail"/)![0];
    expect(section).toContain("new Map(allBeds.map");
    expect(section).toContain("bedById.get(a.bedId)");
    expect(section).not.toContain("allBeds.find");
  });

  it("loads check-in-day rates once via getAllDailyRates", () => {
    const section = route.match(/action === "getAvailableBeds"[\s\S]*?action === "getBookingHistory"/)![0];
    expect(section).toContain("getAllDailyRates(checkinDate, checkinDate)");
    expect(section).toContain("getAvailableBedsForRange(checkinDate, checkoutDate, undefined, bookingId)");
    expect(section).not.toMatch(/await getDailyRates\(/);
    expect(section).toContain("adult1Rate ?? rate.rate");
    expect(section).toContain("pool: b.pool");
    expect(section).toMatch(/if \(rate\) \{\s*dormRates\[mapping\.dormId\] = rate\.adult1Rate \?\? rate\.rate;/);
  });
});

describe("Booking calendar UI permissions match the API keys", () => {
  const dashboard = readFile("src/components/admin/booking-dashboard/index.tsx");
  const panel = readFile("src/components/admin/booking-dashboard/BookingDetailPanel.tsx");

  it("uses grantable canAddBooking / canDeleteBooking, not orphan UI-only keys", () => {
    expect(dashboard).toContain('hasPermission(role, permissions, "canAddBooking")');
    expect(dashboard).not.toContain("canCreateBooking");
    expect(dashboard).toContain("canAssign={hasPermission(role, permissions, \"canAddBooking\")}");
    expect(panel).toContain("canAddBooking");
    expect(panel).toContain("Promise<boolean | void>");
    expect(panel).toContain("canDeleteBooking");
    expect(panel).toContain("canCancelStay");
    expect(panel).not.toContain("canCancelBooking");
    expect(panel).not.toContain("canMarkNoShow");
  });

  it("shows Goko Booking ID, falling back to #id for walk-in rows with an empty gokoBookingId", () => {
    expect(panel).toContain('label="Goko Booking ID"');
    expect(panel).toContain('booking.source === "manual" ? `#${booking.id}`');
    expect(panel).toContain("walkinDiscountOnGross");
    expect(panel).toContain("parseGokoWalkin");
  });

  it("walk-in New Booking has percent and amount discount tabs; tax is not hardcoded 12%", () => {
    const modal = readFile("src/components/admin/booking-dashboard/CreateBookingModal.tsx");
    expect(modal).toContain("% discount");
    expect(modal).toContain("Amount discount");
    expect(modal).toContain('platform === "walkin"');
    expect(modal).toContain("bookingTaxPercent(data.taxRate)");
    expect(modal).not.toContain("Tax (12%)");
    const cm = readFile("src/components/admin/ChannelManager.tsx");
    expect(cm).toContain("bookingTaxRate");
    expect(cm).toContain("Walk-in / offline GST");
    expect(cm).toContain("bookingTaxPercent(res.bookingTaxRate)");
    expect(cm).toContain('e.target.value === "" ? 0');
  });

  it("lets the guest count be empty while editing and validates before create", () => {
    const modal = readFile("src/components/admin/booking-dashboard/CreateBookingModal.tsx");
    expect(modal).toContain('const [persons, setPersons] = useState("1")');
    expect(modal).toContain('onChange={(e) => setPersons(e.target.value)}');
    expect(modal).toContain('const personCount = persons === "" ? NaN : Number(persons)');
    expect(modal).toContain("validPersonCount");
    expect(modal).toContain('Enter at least 1 guest');
  });

  it("loads Unassigned from getUnassigned, not the visible calendar range", () => {
    expect(dashboard).toContain('action: "getUnassigned"');
    expect(dashboard).toContain("setUnassignedBookings");
    expect(dashboard).toContain("Promise.allSettled");
    expect(dashboard).not.toContain("assignedIds.has(b.id)");
    const queries = readFile("src/db/queries.ts");
    const fn = queries.match(/export async function getUnassignedBookings\(\)[\s\S]*?\n\}/)?.[0] ?? "";
    expect(fn).toContain("NOT EXISTS");
    expect(fn).toContain("status} = 'assigned'");
  });

  it("jumps the calendar after Unassigned assign when the stay is off-screen", () => {
    expect(dashboard).toContain("rangeCoveringStay");
    expect(dashboard).toContain("setShowUnassigned(false)");
    expect(dashboard).toContain("setDateRange(next)");
    expect(dashboard).toContain("collapsed: !assignedDormIds.has(d.id)");
    expect(dashboard).toContain("handleBookingAction(\"assignBeds\", bookingId, { bedIds }, !jumping)");
    const unassigned = readFile("src/components/admin/booking-dashboard/UnassignedBookings.tsx");
    expect(unassigned).toContain("Off this calendar");
    expect(unassigned).toContain("stayOverlapsVisible");
    expect(unassigned).toContain("dateRange,");
    expect(unassigned).toContain("Requested:");
    expect(unassigned).toContain("A double unit can hold up to two guests");
    expect(unassigned).toContain("Reject");
    expect(unassigned).toContain("Reject removes this stay from Goko only");
    expect(unassigned).toContain("requestedNeedLabels");
    expect(unassigned).toContain("requestedDormIds");
    expect(dashboard).toContain('canReject={role === "admin" || role === "manager"}');
    expect(dashboard).toContain("handleBookingAction(\"cancelBooking\", bookingId)");
    expect(unassigned).toContain('action: "getAvailableBeds", checkinDate, checkoutDate }');
    expect(unassigned).not.toContain("bookingId: booking.id");
    const selector = readFile("src/components/admin/booking-dashboard/DateRangeSelector.tsx");
    expect(selector).toContain("[dateRange.startDate, dateRange.endDate]");
  });
});

describe("Booking calendar: off-screen stays after Unassigned assign", () => {
  const sepView = { startDate: "2026-09-02", endDate: "2026-09-28", mode: "30days" as const };

  it("does not treat an August night as overlapping a September calendar", () => {
    expect(stayOverlapsVisible("2026-08-25", "2026-08-26", sepView.startDate, sepView.endDate)).toBe(false);
    expect(stayOverlapsVisible("2026-09-05", "2026-09-06", sepView.startDate, sepView.endDate)).toBe(true);
    expect(stayOverlapsVisible("2026-09-01", "2026-09-03", sepView.startDate, sepView.endDate)).toBe(true);
    expect(stayOverlapsVisible("2026-09-28", "2026-09-29", sepView.startDate, sepView.endDate)).toBe(true);
    expect(stayOverlapsVisible("2026-09-29", "2026-09-30", sepView.startDate, sepView.endDate)).toBe(false);
  });

  it("keeps the current window when the stay already paints on it", () => {
    expect(rangeCoveringStay("2026-09-05", "2026-09-06", sepView)).toEqual(sepView);
  });

  it("shifts to check-in with the same span when the stay is off-screen", () => {
    const next = rangeCoveringStay("2026-08-25", "2026-08-26", sepView);
    expect(next.startDate).toBe("2026-08-25");
    expect(next.mode).toBe("custom");
    expect(stayOverlapsVisible("2026-08-25", "2026-08-26", next.startDate, next.endDate)).toBe(true);
    expect(next.endDate).not.toBe(sepView.endDate);
  });

  it("paints a tile after assign only once the calendar covers the stay", () => {
    const bookingId = 146;
    const bedId = 12;
    const assignment = {
      bedId,
      bookingId,
      checkinDate: "2026-08-25",
      checkoutDate: "2026-08-26",
      status: "assigned",
    };
    const bookingIds = new Set([bookingId]);
    const none = new Set<number>();

    const hiddenDates = getDatesArray(sepView.startDate, sepView.endDate);
    expect(computeTilePlacements(bedId, [assignment], hiddenDates, bookingIds, none)).toEqual([]);

    const shown = rangeCoveringStay(assignment.checkinDate, assignment.checkoutDate, sepView);
    const shownDates = getDatesArray(shown.startDate, shown.endDate);
    expect(computeTilePlacements(bedId, [assignment], shownDates, bookingIds, none)).toEqual([
      { bookingId, startCol: 0, spanCols: 1, isMultiBed: false },
    ]);
  });

  it("paints an in-window 1-night stay on the check-in column without jumping", () => {
    const current = { startDate: "2026-09-02", endDate: "2026-09-28", mode: "30days" as const };
    expect(rangeCoveringStay("2026-09-05", "2026-09-06", current)).toEqual(current);
    const dates = getDatesArray(current.startDate, current.endDate);
    const tiles = computeTilePlacements(
      7,
      [{ bedId: 7, bookingId: 99, checkinDate: "2026-09-05", checkoutDate: "2026-09-06", status: "assigned" }],
      dates,
      new Set([99]),
      new Set(),
    );
    expect(tiles).toEqual([{ bookingId: 99, startCol: dates.indexOf("2026-09-05"), spanCols: 1, isMultiBed: false }]);
  });

  it("skips a tile when the booking row is missing from the calendar payload", () => {
    const dates = getDatesArray("2026-08-25", "2026-09-03");
    expect(computeTilePlacements(
      7,
      [{ bedId: 7, bookingId: 1, checkinDate: "2026-08-25", checkoutDate: "2026-08-26", status: "assigned" }],
      dates,
      new Set(),
      new Set(),
    )).toEqual([]);
  });
});

describe("Unassigned bookings: same availability as New Booking", () => {
  const unassigned = readFile("src/components/admin/booking-dashboard/UnassignedBookings.tsx");
  const create = readFile("src/components/admin/booking-dashboard/CreateBookingModal.tsx");
  const route = readFile("src/app/api/admin/bookings/route.ts");

  it("loads beds for the booking stay via getAvailableBeds, not calendar occupancy", () => {
    expect(unassigned).toContain('action: "getAvailableBeds"');
    expect(unassigned).not.toContain("bookingId: booking.id");
    expect(unassigned).toContain("exclusiveEndDate");
    expect(unassigned).not.toContain("!bed.isBlocked");
    expect(unassigned).toContain("bedsError");
    expect(unassigned).toContain("Failed to load beds");
    expect(create).toContain('action: "getAvailableBeds"');
    expect(create).toContain("addCalendarDays(start, 1)");
    expect(create).toContain("addCalendarDays(checkinDate, 1)");
    expect(create).toContain("cancelled = true");
    expect(create).toContain("setAvailableUnits([])");
  });

  it("assignBeds / date mutations coerce missing checkout via stayCheckout", () => {
    expect(route).toContain("function stayCheckout");
    const assign = route.match(/action === "assignBeds"[\s\S]*?action === "checkIn"/)![0];
    expect(assign).toContain("stayCheckout(checkinDate, detail.booking.checkoutDate)");
    expect(assign).toContain("channelSource(detail.booking.source)");
    expect(assign).toContain("pushIfGokoOccupancy");
    expect(assign).toContain("rawBedIds.map((id: unknown) => Number(id))");
    expect(assign).not.toContain("checkoutDate || checkinDate");
    expect(route).toContain('source === "channel_manager"');
    expect(route).toContain('action === "modifyCheckin"');
    expect(route).toContain('action === "modifyCheckout"');
    expect(route).toContain('action === "editReservation"');
    expect(route).toContain('action === "moveRoom"');
    expect(route.split("stayCheckout(").length).toBeGreaterThan(5);
    expect(route).not.toContain("checkoutDate || checkinDate");
    expect(route).not.toContain("checkoutDate || oldCheckin");
  });

  it("detail nights treat missing checkout as one night, not NaN", () => {
    expect(getNights("2026-09-01", "2026-09-02")).toBe(1);
    expect(getNights("2026-09-01", "2026-09-03")).toBe(2);
    expect(getNights("2026-09-01", "")).toBe(1);
    expect(getNights("2026-09-01")).toBe(1);
    expect(Number.isNaN(getNights("2026-09-01", ""))).toBe(false);
  });
});

describe("sqliteWriteCount (D1 vs better-sqlite3)", () => {
  it("counts a D1 insert from meta.changes, not a missing top-level rowsWritten", () => {
    expect(sqliteWriteCount({ success: true, meta: { changes: 1, rows_written: 1 } })).toBe(1);
    expect(sqliteWriteCount({ success: true, meta: { changes: 0, rows_written: 0 } })).toBe(0);
    expect(sqliteWriteCount({ success: true, meta: { duration: 2 } })).toBe(0);
    expect(sqliteWriteCount({ rowsWritten: undefined, changes: undefined })).toBe(0);
    expect(sqliteWriteCount({ rowsAffected: 3 })).toBe(3);
    expect(sqliteWriteCount({ meta: { rowsAffected: 2 } })).toBe(2);
  });

  it("counts better-sqlite3 changes", () => {
    expect(sqliteWriteCount({ changes: 1 })).toBe(1);
  });
});

describe("platformLogo", () => {
  it("maps Aiosell channel names like Direct and booking.com", () => {
    expect(platformLogo("Direct")?.label).toBe("Direct");
    expect(platformLogo("booking.com")?.label).toBe("Booking.com");
    expect(platformLogo("booking_com")?.abbr).toBe("B");
  });
});

describe("Mock workflows: assign + admin retry", () => {
  const route = readFile("src/app/api/admin/bookings/route.ts");
  const dashboard = readFile("src/components/admin/booking-dashboard/index.tsx");
  const adminApi = readFile("src/components/admin/useAdminApi.ts");

  it("assignBeds coerces string bed ids and drops junk", () => {
    const coerce = (raw: unknown) =>
      Array.isArray(raw)
        ? raw.map((id: unknown) => Number(id)).filter((id: number) => Number.isInteger(id) && id > 0)
        : [];
    expect(coerce(["77", 78, "x", 0, -1, 1.5, null])).toEqual([77, 78]);
    expect(coerce(undefined)).toEqual([]);
    expect(route).toContain("rawBedIds.map((id: unknown) => Number(id))");
  });

  it("calendar and Unassigned booking POSTs use fetchWithRetry, not a bare fetch", () => {
    expect(dashboard).toContain('fetchWithRetry("/api/admin/bookings"');
    expect(dashboard).not.toMatch(/await fetch\("\/api\/admin\/bookings"/);
    expect(dashboard).toContain('retryServerError: body.action !== "createBooking"');
    expect(adminApi).toContain("export async function fetchWithRetry");
    expect(adminApi).toContain("retries: retriesOrOpts?.retries ?? 2");
  });

  it("retries 429/502/503 and HTML 5xx; JSON 500 only when opted in; never auth or 409", () => {
    const json = (status: number) =>
      new Response("{}", { status, headers: { "content-type": "application/json" } });
    expect(isRetryableAdminResponse(json(503))).toBe(true);
    expect(isRetryableAdminResponse(json(429))).toBe(true);
    expect(isRetryableAdminResponse(json(500))).toBe(false);
    expect(isRetryableAdminResponse(json(500), true)).toBe(true);
    expect(isRetryableAdminResponse(new Response("oops", { status: 500, headers: { "content-type": "text/html" } }))).toBe(true);
    expect(isRetryableAdminResponse(json(409), true)).toBe(false);
    expect(isRetryableAdminResponse(json(401), true)).toBe(false);
    expect(isRetryableAdminResponse(json(400), true)).toBe(false);
  });

  it("treats D1 errors as transient regardless of case, never unique/syntax", () => {
    expect(isTransientError("d1_error: failed query")).toBe(true);
    expect(isTransientError("SQLITE_BUSY")).toBe(true);
    expect(isTransientError("Unique constraint failed")).toBe(false);
    expect(isTransientError("syntax error near INSERT")).toBe(false);
  });
});

describe("collectionCopy / check-in payment labels", () => {
  it("shows Collect payment for pay-at-hotel with a remaining balance", () => {
    expect(collectionCopy("pay_at_hotel", 31500)).toEqual({
      label: "Collect payment",
      value: formatCurrency(31500),
      due: true,
    });
    expect(collectionCopy("pay_at_property", 100)).toMatchObject({ label: "Collect payment", due: true });
  });

  it("shows Payment done for prepaid, paid, and settled hotel-collect", () => {
    expect(collectionCopy("prepaid", 31500)).toEqual({ label: "Payment done", value: "Prepaid", due: false });
    expect(collectionCopy("paid", 0)).toEqual({ label: "Payment done", value: "Collected", due: false });
    expect(collectionCopy("pay_at_hotel", 0)).toEqual({ label: "Payment done", value: "Collected", due: false });
    expect(collectionCopy("paid", 2000)).toEqual({
      label: "Collect remaining",
      value: formatCurrency(2000),
      due: true,
    });
  });

  it("prepaid card shows OTA total as Paid and ₹0 Balance without writing amountPaid", () => {
    expect(displayedStayPayment("prepaid", 31500, 0)).toEqual({ paid: 31500, balance: 0 });
    expect(displayedStayPayment("pay_at_hotel", 31500, 0)).toEqual({ paid: 0, balance: 31500 });
    expect(displayedStayPayment("paid", 31500, 31500)).toEqual({ paid: 31500, balance: 0 });
    expect(displayedStayPayment("unknown", 5000, 0)).toEqual({ paid: 0, balance: 5000 });
  });

  it("omits the row for unknown / partial so walk-in still uses the rupee balance", () => {
    expect(collectionCopy("unknown", 5000)).toBeNull();
    expect(collectionCopy("partial", 5000)).toBeNull();
    expect(collectionCopy("", 5000)).toBeNull();
  });

  it("detail panel paints Balance red for hotel-due or unknown unpaid, not prepaid", () => {
    const panel = readFile("src/components/admin/booking-dashboard/BookingDetailPanel.tsx");
    expect(panel).toContain("stayDueAtHotel(booking.paymentStatus, booking.amountTotal, booking.amountPaid)");
    expect(panel).toContain("displayedStayPayment(booking.paymentStatus, booking.amountTotal, booking.amountPaid)");
    expect(panel).toContain("formatCurrency(shownPay.paid)");
    expect(panel).toContain("formatCurrency(shownPay.balance)");
    expect(panel).not.toContain('label="Paid" value={formatCurrency(booking.amountPaid)}');
    expect(panel).toContain("highlight={dueAtHotel}");
    expect(panel).not.toContain("highlight={booking.balance > 0}");
    const due = (status: string, balance: number) => {
      const copy = collectionCopy(status, balance);
      return copy ? copy.due : balance > 0;
    };
    expect(due("prepaid", 31500)).toBe(false);
    expect(due("pay_at_hotel", 31500)).toBe(true);
    expect(due("unknown", 5000)).toBe(true);
    expect(due("unknown", 0)).toBe(false);
    expect(due("paid", 0)).toBe(false);
    expect(due("paid", 2000)).toBe(true);
  });

  it("CheckInPopup skips Collected for prepaid and still offers it when due at hotel or unknown with balance", () => {
    const popup = readFile("src/components/admin/booking-dashboard/CheckInPopup.tsx");
    expect(popup).toContain("stayDueAtHotel(booking.paymentStatus, booking.amountTotal, booking.amountPaid)");
    expect(popup).toContain("const offerCollect = due > 0");
    expect(popup).toContain("{offerCollect && (");
    expect(popup).toContain("Collected");
    expect(popup).toContain("onConfirm(false)");
    expect(popup).toContain("Adds to stay revenue on check-in");
    expect(popup).toContain('amountUnit="rupees"');
    expect(popup).toContain("flex items-center justify-center");
    expect(popup).toContain("p-4");
    expect(popup).toContain("overflow-y-auto");
    expect(popup).not.toContain("left-1/2");
    expect(popup).not.toContain("-translate-x-1/2");
  });

  it("checked-in detail has Collect and Cancel with refund amount", () => {
    const panel = readFile("src/components/admin/booking-dashboard/BookingDetailPanel.tsx");
    expect(panel).toContain("canCollectStay");
    expect(panel).toContain("collectStayPayment");
    expect(panel).toContain("stayRefundCap(booking.amountPaid)");
    expect(panel).toContain('amountUnit="rupees"');
    expect(panel).toContain('mode="refund"');
    expect(panel).toContain("flex items-center justify-center");
    expect(panel).not.toContain("left-1/2");
  });

  it("ConfirmDialog and CheckInPopup center in a padded overlay so Framer scale/y cannot un-center them on mobile", () => {
    const confirm = readFile("src/components/admin/booking-dashboard/ConfirmDialog.tsx");
    expect(confirm).toContain("flex items-center justify-center");
    expect(confirm).toContain("p-4");
    expect(confirm).toContain("min-w-0 max-w-sm");
    expect(confirm).toContain("overflow-y-auto");
    expect(confirm).not.toContain("left-1/2");
    expect(confirm).not.toContain("-translate-x-1/2");
    const anim = readFile("src/lib/animations.ts");
    expect(anim).toContain("Do not also put Tailwind");
    const beds = readFile("src/components/admin/AdminBeds.tsx");
    expect(beds).not.toMatch(/mx-4 w-full max-w-sm/);
  });

  it("checkIn collectPayment writes paymentStatus paid so the label flips after desk cash", () => {
    const route = readFile("src/app/api/admin/bookings/route.ts");
    const checkIn = route.match(/action === "checkIn"[\s\S]*?action === "checkOut"/);
    expect(checkIn).not.toBeNull();
    const section = checkIn![0];
    expect(section).toContain("if (collectPayment && dueAtCheckIn > 0)");
    expect(section).toContain("mergeStayCollect");
    expect(section).toContain("isStayPayMethod(paymentMethod)");
    expect(section).toContain("Object.assign(updateData, merged)");
    expect(section).toContain("prepaidCheckInWrite");
    expect(section).toContain("collectStayPayment");
  });
});
