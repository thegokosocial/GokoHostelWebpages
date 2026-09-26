import { describe, expect, it } from "vitest";
import {
  canLookupFoodTab,
  checkinIdsMatchingContact,
  contactToCheckinIdMap,
  foodTabUncheckedMessage,
  unpaidFoodCheckoutMessage,
} from "@/lib/foodTab";
import { readFileSync } from "node:fs";

describe("pending food tab matching", () => {
  const checkins = [
    { id: 1, contact: "+91 98765 43210" },
    { id: 2, contact: "1111111111" },
    { id: 3, contact: "9876543210" },
  ];

  it("normalizes +91 vs 10-digit bed/booking phones onto the same checkin", () => {
    const map = contactToCheckinIdMap(checkins);
    expect(map.get("9876543210")).toBe(3);
    expect(checkinIdsMatchingContact(checkins, "+919876543210")).toEqual([1, 3]);
    expect(checkinIdsMatchingContact(checkins, "98 7654 3210")).toEqual([1, 3]);
  });

  it("does not match a different number", () => {
    expect(checkinIdsMatchingContact(checkins, "9999999999")).toEqual([]);
    expect(contactToCheckinIdMap(checkins).get("9999999999")).toBeUndefined();
  });

  it("checkout copy names the rupee tab and order count", () => {
    expect(unpaidFoodCheckoutMessage("Ada", 45000, 2)).toBe(
      "Ada has an unpaid food tab of ₹450 (2 unpaid orders). Check out anyway?",
    );
    expect(unpaidFoodCheckoutMessage("Ada", 10000, 1)).toBe(
      "Ada has an unpaid food tab of ₹100 (1 unpaid order). Check out anyway?",
    );
    expect(foodTabUncheckedMessage("no-phone")).toBe(
      "No phone on this guest, so the food tab could not be checked. Check out anyway?",
    );
    expect(foodTabUncheckedMessage("lookup-failed")).toBe(
      "Could not check the food tab. Check out anyway?",
    );
    expect(canLookupFoodTab({ contact: "" })).toBe(false);
    expect(canLookupFoodTab({ contact: "12" })).toBe(false);
    expect(canLookupFoodTab({ contact: "9876543210" })).toBe(true);
    expect(canLookupFoodTab({ contact: "", checkinId: 9 })).toBe(true);
  });
});

describe("checkout UIs look up the self-checkin food tab", () => {
  it("keeps an Order More guest compact while preserving the existing order payload", () => {
    const orders = readFileSync("src/components/admin/AdminFoodOrders.tsx", "utf8");
    expect(orders).toContain("lockedPrefill");
    expect(orders).toContain("applyLockedPrefill");
    expect(orders).toContain("Ordering for");
    expect(orders).toContain("Change guest");
    expect(orders).toContain("abandonPrefill");
    expect(orders).toContain('action: "placeOrderForGuest"');
    expect(orders).toContain('guestType: guestType === "table" ? "walkin" : guestType');
    expect(orders).toContain('checkinId: guestType === "hostel" ? selectedGuest?.id : undefined');
    expect(orders).toContain('guestPhone: guestType === "walkin" ? walkinPhone.trim() : guestType === "table" ? tablePhone : undefined');
  });

  it("booking Check Out Guest fetches getPendingFoodTab before confirm", () => {
    const panel = readFileSync("src/components/admin/booking-dashboard/BookingDetailPanel.tsx", "utf8");
    expect(panel).toContain("promptCheckOut");
    expect(panel).toContain('action: "getPendingFoodTab"');
    expect(panel).toContain("unpaidFoodCheckoutMessage");
    expect(panel).toContain("canLookupFoodTab");
    expect(panel).toContain('foodTabUncheckedMessage("no-phone")');
    expect(panel).toContain("Check out anyway");
  });

  it("beds and timeline checkout warn on unpaid tab", () => {
    const beds = readFileSync("src/components/admin/AdminBeds.tsx", "utf8");
    expect(beds).toContain("getPendingFoodTab");
    expect(beds).toContain("unpaidFoodCheckoutMessage");
    expect(beds).toContain("Checkout anyway");
    const timeline = readFileSync("src/components/admin/AdminTimeline.tsx", "utf8");
    expect(timeline).toContain("getPendingFoodTab");
    expect(timeline).toContain("unpaidFoodCheckoutMessage");
  });

  it("dashboard today-checkout matching uses all active checkins", () => {
    const route = readFileSync("src/app/api/admin/checkins/route.ts", "utf8");
    expect(route).toContain("checkinIdsMatchingContact");
    expect(route).toContain("getActiveCheckins");
    expect(route).toContain("getPendingFoodTab");
    expect(route).toContain("activeCheckinIdsForContact");
  });

  it("dashboard today-checkout live-looks-up the tab on click", () => {
    const dash = readFileSync("src/components/admin/AdminDashboard.tsx", "utf8");
    expect(dash).toContain('action: "getPendingFoodTab"');
    expect(dash).toContain("foodTabUncheckedMessage");
    expect(dash).toContain("checkoutModal.orderIds");
    expect(dash).toContain("if (!payRes.ok)");
  });

  it("client UIs never import foodTabDb", () => {
    for (const file of [
      "src/components/admin/AdminBeds.tsx",
      "src/components/admin/AdminTimeline.tsx",
      "src/components/admin/AdminDashboard.tsx",
      "src/components/admin/booking-dashboard/BookingDetailPanel.tsx",
    ]) {
      const src = readFileSync(file, "utf8");
      expect(src, file).not.toContain("foodTabDb");
    }
    const bookings = readFileSync("src/app/api/admin/bookings/route.ts", "utf8");
    const checkins = readFileSync("src/app/api/admin/checkins/route.ts", "utf8");
    expect(bookings).toContain('from "@/lib/foodTabDb"');
    expect(checkins).toContain('from "@/lib/foodTabDb"');
  });

  it("food and stay tax UIs do not treat 0% as the default 5%", () => {
    const orders = readFileSync("src/components/admin/AdminFoodOrders.tsx", "utf8");
    expect(orders).not.toContain("Tax (5%)");
    expect(orders).not.toContain("* 0.05");
    expect(orders).toContain("foodTaxPercent");
    const guest = readFileSync("src/app/food-order/page.tsx", "utf8");
    expect(guest).toContain("foodTaxPercent(settings?.taxRate)");
    expect(guest).not.toContain("settings?.taxRate || 5");
  });

  it("bookings route exposes getPendingFoodTab next to checkOut", () => {
    const route = readFileSync("src/app/api/admin/bookings/route.ts", "utf8");
    expect(route).toContain("getPendingFoodTab: [\"canCheckOut\", \"canAddBooking\"]");
    expect(route).toContain("action === \"getPendingFoodTab\"");
  });
});
