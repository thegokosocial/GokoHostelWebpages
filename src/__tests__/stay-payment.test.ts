import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  stayDueAtHotel,
  cashCollected,
  onlineCollected,
  cashRefunded,
  onlineRefunded,
  mergeStayCollect,
  occupiedForRoomRevenue,
  stayRefundCap,
  stayRefundWrite,
  coerceStayMethod,
  prepaidCheckInWrite,
  prepaidCheckInRollback,
} from "@/lib/stayPayment";

describe("stayDueAtHotel", () => {
  it("prepaid is never hotel-due", () => {
    expect(stayDueAtHotel("prepaid", 31500, 0)).toBe(0);
  });
  it("Later unpaid is full total", () => {
    expect(stayDueAtHotel("pay_at_hotel", 12600000, 0)).toBe(12600000);
  });
  it("collected is 0 due", () => {
    expect(stayDueAtHotel("paid", 94500, 94500)).toBe(0);
  });
  it("price-up remainder is still due", () => {
    expect(stayDueAtHotel("paid", 120000, 100000)).toBe(20000);
  });
});

describe("cash / online split portions", () => {
  it("split 44 cash + 40 online", () => {
    expect(cashCollected("split", 8400, 4400)).toBe(4400);
    expect(onlineCollected("split", 8400, 4400)).toBe(4000);
  });
  it("cash method uses amountPaid not tender", () => {
    expect(cashCollected("cash", 94500, 100000)).toBe(94500);
    expect(onlineCollected("cash", 94500, 100000)).toBe(0);
  });
  it("refund split nets", () => {
    expect(cashRefunded("split", 50000, 20000)).toBe(20000);
    expect(onlineRefunded("split", 50000, 20000)).toBe(30000);
    expect(94500 - 50000).toBe(44500);
  });
});

describe("mergeStayCollect", () => {
  it("first collect cash", () => {
    expect(mergeStayCollect({
      amountTotal: 8400,
      newMethod: "cash",
      newCashReceived: 8400,
      newChangeGiven: 0,
    })).toMatchObject({ amountPaid: 8400, paymentStatus: "paid", paymentMethod: "cash" });
  });
  it("remainder online after cash becomes split", () => {
    const m = mergeStayCollect({
      existingMethod: "cash",
      existingPaid: 100000,
      amountTotal: 120000,
      newMethod: "online",
      newCashReceived: 0,
      newChangeGiven: 0,
    });
    expect(m.paymentMethod).toBe("split");
    expect(m.cashReceived).toBe(100000);
    expect(m.amountPaid).toBe(120000);
  });
  it("split cash above the bill coerces to cash", () => {
    const m = mergeStayCollect({
      amountTotal: 8400,
      newMethod: "split",
      newCashReceived: 99999,
      newChangeGiven: 0,
    });
    expect(m.paymentMethod).toBe("cash");
    expect(m.cashReceived).toBe(8400);
  });
  it("split cash of 0 coerces to online", () => {
    const m = mergeStayCollect({
      amountTotal: 8400,
      newMethod: "split",
      newCashReceived: 0,
      newChangeGiven: 0,
    });
    expect(m.paymentMethod).toBe("online");
    expect(m.cashReceived).toBe(0);
  });
  it("same-method cash remainder keeps prior cashReceived plus new tender", () => {
    const m = mergeStayCollect({
      existingMethod: "cash",
      existingCashReceived: 100000,
      existingPaid: 100000,
      amountTotal: 120000,
      newMethod: "cash",
      newCashReceived: 20000,
      newChangeGiven: 0,
    });
    expect(m.paymentMethod).toBe("cash");
    expect(m.cashReceived).toBe(120000);
    expect(m.amountPaid).toBe(120000);
  });
  it("same-method cash remainder keeps prior changeGiven", () => {
    const m = mergeStayCollect({
      existingMethod: "cash",
      existingCashReceived: 10000,
      existingChangeGiven: 1600,
      existingPaid: 8400,
      amountTotal: 12000,
      newMethod: "cash",
      newCashReceived: 3600,
      newChangeGiven: 0,
    });
    expect(m.cashReceived).toBe(13600);
    expect(m.changeGiven).toBe(1600);
    expect(m.amountPaid).toBe(12000);
    expect(m.cashReceived - m.changeGiven).toBe(12000);
  });
  it("prior paid with empty method is not a first collect", () => {
    const m = mergeStayCollect({
      existingMethod: "",
      existingPaid: 100000,
      amountTotal: 120000,
      newMethod: "online",
      newCashReceived: 0,
      newChangeGiven: 0,
    });
    expect(m.amountPaid).toBe(120000);
    expect(m.paymentMethod).toBe("online");
  });
});

describe("stayRefundCap / coerce / write", () => {
  it("prepaid and Later unpaid cannot refund from Goko till", () => {
    expect(stayRefundCap(0)).toBe(0);
  });
  it("prepaid after check-in can refund the recorded amountPaid", () => {
    expect(stayRefundCap(31500)).toBe(31500);
  });
  it("collected refunds at most amountPaid, including overpay after price-down", () => {
    expect(stayRefundCap(100000)).toBe(100000);
    expect(stayRefundCap(94500)).toBe(94500);
  });
  it("split refund cash above amount becomes cash", () => {
    expect(stayRefundWrite("split", 50000, 99999)).toEqual({ refundMethod: "cash", refundCash: 50000 });
  });
  it("online refund stores 0 cash", () => {
    expect(stayRefundWrite("online", 50000, 123)).toEqual({ refundMethod: "online", refundCash: 0 });
  });
  it("coerceStayMethod keeps a real split", () => {
    expect(coerceStayMethod("split", 4400, 8400)).toEqual({ method: "split", cashReceived: 4400 });
  });
});

describe("prepaid check-in write / rollback", () => {
  it("records prepaid total as online and leaves non-prepaid alone", () => {
    expect(prepaidCheckInWrite("prepaid", 31500, 0)).toEqual({
      amountPaid: 31500, paymentMethod: "online", cashReceived: 0, changeGiven: 0,
    });
    expect(prepaidCheckInWrite("pay_at_hotel", 31500, 0)).toBeNull();
    expect(prepaidCheckInWrite("prepaid", 0, 0)).toBeNull();
    expect(prepaidCheckInWrite("prepaid", 31500, 1000)).toBeNull();
  });
  it("rollback only reverses a full online prepaid recording", () => {
    expect(prepaidCheckInRollback({
      paymentStatus: "prepaid", paymentMethod: "online", amountTotal: 31500, amountPaid: 31500,
    })).toEqual({ amountPaid: 0, paymentMethod: "", cashReceived: 0, changeGiven: 0 });
    expect(prepaidCheckInRollback({
      paymentStatus: "paid", paymentMethod: "online", amountTotal: 31500, amountPaid: 31500,
    })).toBeNull();
    expect(prepaidCheckInRollback({
      paymentStatus: "prepaid", paymentMethod: "cash", amountTotal: 31500, amountPaid: 31500,
    })).toBeNull();
  });
});

describe("occupiedForRoomRevenue", () => {
  it("includes cancelled only after check-in", () => {
    expect(occupiedForRoomRevenue("cancelled", "")).toBe(false);
    expect(occupiedForRoomRevenue("cancelled", "2026-08-31T10:00:00.000Z")).toBe(true);
    expect(occupiedForRoomRevenue("no_show", "x")).toBe(false);
    expect(occupiedForRoomRevenue("checked_out")).toBe(true);
  });
});

describe("layout / extract", () => {
  it("RecordPaymentModal is flex-centered with overflow, not left-1/2", () => {
    const src = readFileSync("src/components/admin/RecordPaymentModal.tsx", "utf8");
    expect(src).toContain("flex items-center justify-center");
    expect(src).toContain("overflow-y-auto");
    expect(src).toContain("Record Refund");
    expect(src).not.toContain("left-1/2");
    expect(src).toContain('amountUnit = "paise"');
    expect(src).toContain("readOnly");
  });
  it("stay surfaces pass rupees into the food paise modal", () => {
    const popup = readFileSync("src/components/admin/booking-dashboard/CheckInPopup.tsx", "utf8");
    const panel = readFileSync("src/components/admin/booking-dashboard/BookingDetailPanel.tsx", "utf8");
    const dash = readFileSync("src/components/admin/AdminDashboard.tsx", "utf8");
    const room = readFileSync("src/components/admin/AdminRoomRevenue.tsx", "utf8");
    const dashApi = readFileSync("src/app/api/admin/checkins/route.ts", "utf8");
    expect(popup).toContain('amountUnit="rupees"');
    expect(popup).toContain("Adds to stay revenue on check-in");
    expect(panel).toContain('amountUnit="rupees"');
    expect(dash).toContain('amountUnit="rupees"');
    expect(dash).toContain("s.due.toLocaleString");
    expect(dash).not.toContain("s.due / 100");
    expect(room).toContain('toLocaleString("en-IN")');
    expect(room).not.toContain("/ 100");
    expect(dashApi).toContain('eq(bookings.status, "checked_in")');
    expect(dashApi).toContain('eq(bookings.status, "checked_out")');
    expect(dashApi).toContain("addCalendarDays(todayIST(), -14)");
    expect(dash).toContain("showError");
    const bookingsApi = readFileSync("src/app/api/admin/bookings/route.ts", "utf8");
    expect(bookingsApi).toContain("prepaidCheckInWrite");
    expect(bookingsApi).toContain("prepaidCheckInRollback");
    expect(bookingsApi).not.toContain("refundPaise / 100");
  });
  it("food orders import the shared modal", () => {
    const src = readFileSync("src/components/admin/AdminFoodOrders.tsx", "utf8");
    const modal = readFileSync("src/components/admin/RecordPaymentModal.tsx", "utf8");
    const accountsApi = readFileSync("src/app/api/admin/account-settings/route.ts", "utf8");
    expect(src).toContain("RecordPaymentModal");
    expect(src).not.toContain("function PaymentModal");
    expect(modal).toContain('payload.action = roomAccountList ? "getRoomReceiptAccounts" : "getFoodReceiptAccounts"');
    expect(modal).toContain('if (!receiptKind) return;');
    expect(modal).toContain('password: password || ""');
    expect(modal).not.toContain('if (!password || !receiptKind) return;');
    expect(accountsApi).toContain('getFoodReceiptAccounts: "canMarkPaid"');
    expect(accountsApi).toContain('getSetting("food_online_receipt_account_id")');
  });
});
