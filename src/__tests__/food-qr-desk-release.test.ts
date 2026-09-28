import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { foodQrBlocksDeskPayment } from "@/lib/foodQrPayment";

describe("foodQrBlocksDeskPayment", () => {
  it("blocks when attempt is paid or a capture row exists", () => {
    expect(foodQrBlocksDeskPayment("paid", false)).toBe(true);
    expect(foodQrBlocksDeskPayment("active", true)).toBe(true);
    expect(foodQrBlocksDeskPayment("paid", true)).toBe(true);
  });

  it("allows desk supersede only when unpaid and no capture", () => {
    expect(foodQrBlocksDeskPayment("active", false)).toBe(false);
    expect(foodQrBlocksDeskPayment("creating", false)).toBe(false);
    expect(foodQrBlocksDeskPayment("qr_unknown", false)).toBe(false);
    expect(foodQrBlocksDeskPayment("closed", false)).toBe(false);
    expect(foodQrBlocksDeskPayment("expired", false)).toBe(false);
  });
});

describe("desk-release source contracts (money safety)", () => {
  const engine = readFileSync("src/lib/foodQrPayment.ts", "utf8");
  const foodOrders = readFileSync("src/app/api/admin/food-orders/route.ts", "utf8");
  const modal = readFileSync("src/components/admin/RecordPaymentModal.tsx", "utf8");
  const adminFood = readFileSync("src/components/admin/AdminFoodOrders.tsx", "utf8");

  it("exports releaseFoodQrForDeskPayment with finalize (reconcile → close → local capture check → release)", () => {
    expect(engine).toContain("export async function releaseFoodQrForDeskPayment");
    expect(engine).toContain("finalizeOpenFoodQrAttempt");
    expect(engine).toContain("assertFoodQrUnpaidForRelease");
    expect(engine).toContain("assertLocalCaptureBlocksDesk");
    expect(engine).toContain("closeRazorpayFoodQr");
    expect(engine).toContain("releaseClaims(attemptId)");
    expect(engine).toContain('state: terminal');
    expect(engine).toContain("A Razorpay payment was already captured for this bill");
    expect(engine).toContain("hasUpiIntent: Boolean(upiIntent)");
    expect(engine).toContain("foodQrBlocksDeskPayment");
    expect(engine).toContain("OPEN_FOOD_QR_STATES");
    // Post-close path must not call a second full reconcile (speed).
    const finalizeBlock = engine.slice(
      engine.indexOf("async function finalizeOpenFoodQrAttempt"),
      engine.indexOf("export async function retireAllOpenFoodQrAttempts"),
    );
    expect(finalizeBlock).toContain("assertLocalCaptureBlocksDesk");
    expect(finalizeBlock.match(/assertFoodQrUnpaidForRelease/g)?.length).toBe(1);
  });

  it("markOrderPaid and all mutators release open QR via releaseFoodQrOrConflict", () => {
    const markPaidBlock = foodOrders.slice(
      foodOrders.indexOf('case "markOrderPaid"'),
      foodOrders.indexOf('case "saveOrderEdits"'),
    );
    expect(markPaidBlock).toContain("releaseFoodQrOrConflict");
    expect(markPaidBlock).toContain("releasedFoodQrAttemptIds");
    expect(markPaidBlock).toContain("Select Received-in");
    expect(foodOrders).toContain("releaseFoodQrOrConflict");
    expect(foodOrders).not.toContain("rejectIfActiveFoodQr");
    expect(foodOrders.match(/releaseFoodQrOrConflict/g)?.length).toBeGreaterThanOrEqual(10);
  });

  it("Mark Paid never auto-assigns razorpay paymentMethod from desk path", () => {
    const markPaidBlock = foodOrders.slice(
      foodOrders.indexOf('case "markOrderPaid"'),
      foodOrders.indexOf('case "saveOrderEdits"'),
    );
    expect(markPaidBlock).toMatch(/\["cash", "online", "split"\]/);
    expect(markPaidBlock).not.toContain('paymentMethod: "razorpay"');
  });

  it("RecordPaymentModal supports requireAccountPick without silent default", () => {
    expect(modal).toContain("requireAccountPick");
    expect(modal).toContain("accountPickHint");
    expect(modal).toContain("if (requireAccountPick)");
    expect(modal).toContain('setOnlineAccountId("")');
  });

  it("Order Summary Bill Pay forces Received-in when dynamic QR is open", () => {
    expect(adminFood).toContain("requireAccountPick=");
    expect(adminFood).toContain('drawerQrState.status === "active"');
    expect(adminFood).toContain("Saving closes any open Razorpay bill QR");
  });
});
