import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import {
  FOOD_RAZORPAY_RECEIPT_NICKNAME,
  formatFoodBillSettledMethods,
  formatFoodPaymentMethodLabel,
  isFoodOrderAlreadySettledError,
  isRazorpayFoodPaymentMethod,
  pickFoodOnlineAccountId,
  shouldNotifyFoodQrPaid,
} from "@/lib/foodBillQrUi";

describe("food QR paid UX — pure helpers", () => {
  it("notifies onPaid only once per paid lifecycle", () => {
    expect(shouldNotifyFoodQrPaid(false, "paid")).toBe(true);
    expect(shouldNotifyFoodQrPaid(true, "paid")).toBe(false);
    expect(shouldNotifyFoodQrPaid(false, "active")).toBe(false);
    expect(shouldNotifyFoodQrPaid(false, "loading")).toBe(false);
    expect(shouldNotifyFoodQrPaid(false, "error")).toBe(false);
  });

  it("formats Settled methods without duplicating Razorpay wording", () => {
    expect(formatFoodBillSettledMethods([])).toBe("");
    expect(formatFoodBillSettledMethods([null, "", undefined])).toBe("");
    expect(formatFoodBillSettledMethods(["razorpay"])).toBe(" · Razorpay");
    expect(formatFoodBillSettledMethods(["razorpay_test", "razorpay"])).toBe(" · Razorpay");
    expect(formatFoodBillSettledMethods(["razorpay", "online"])).toBe(" · Razorpay, online");
    expect(formatFoodBillSettledMethods([" online ", "cash", "cash"])).toBe(" · online, cash");
    expect(formatFoodPaymentMethodLabel("razorpay")).toBe("Razorpay");
  });

  it("classifies capture methods and settled 409 copy", () => {
    expect(isRazorpayFoodPaymentMethod("razorpay")).toBe(true);
    expect(isRazorpayFoodPaymentMethod("razorpay_test")).toBe(true);
    expect(isRazorpayFoodPaymentMethod("cash")).toBe(false);
    expect(isRazorpayFoodPaymentMethod(null)).toBe(false);
    expect(isFoodOrderAlreadySettledError(
      "Every selected order must have an outstanding balance",
    )).toBe(true);
    expect(isFoodOrderAlreadySettledError(
      "every selected order must have an outstanding balance",
    )).toBe(true);
    expect(isFoodOrderAlreadySettledError("A Razorpay payment was already captured")).toBe(false);
  });

  it("pickFoodOnlineAccountId covers prefer / default / missing / whitespace edges", () => {
    // trim match: padded nickname still matches
    expect(pickFoodOnlineAccountId({
      accounts: [{ id: 2, nickname: `  ${FOOD_RAZORPAY_RECEIPT_NICKNAME}  ` }],
      preferRazorpay: true,
    })).toBe("2");
    expect(pickFoodOnlineAccountId({
      accounts: [{ id: 1, nickname: "Sunny" }],
      preferRazorpay: true,
      foodOnlineReceiptAccountId: 1,
    })).toBe("1");
    expect(pickFoodOnlineAccountId({
      accounts: [
        { id: 1, nickname: "Sunny" },
        { id: 9, nickname: FOOD_RAZORPAY_RECEIPT_NICKNAME },
      ],
      preferRazorpay: true,
      foodOnlineReceiptAccountId: "",
    })).toBe("9");
    expect(pickFoodOnlineAccountId({
      accounts: [{ id: 1, nickname: "Sunny" }],
      preferRazorpay: false,
      foodOnlineReceiptAccountId: "  ",
    })).toBe("");
    expect(pickFoodOnlineAccountId({
      accounts: [],
      preferRazorpay: true,
      foodOnlineReceiptAccountId: 99,
    })).toBe("99");
  });
});

describe("food QR paid UX — wiring contracts", () => {
  const hook = readFileSync("src/hooks/useFoodBillDynamicQr.ts", "utf8");
  const ordersUi = readFileSync("src/components/admin/AdminFoodOrders.tsx", "utf8");
  const card = readFileSync("src/components/food/GuestFoodBillCard.tsx", "utf8");
  const myBills = readFileSync("src/app/my-bills/page.tsx", "utf8");
  const modal = readFileSync("src/components/admin/RecordPaymentModal.tsx", "utf8");
  const accountsApi = readFileSync("src/app/api/admin/account-settings/route.ts", "utf8");

  it("hook uses shouldNotifyFoodQrPaid and resets paidNotified on orderKey change", () => {
    expect(hook).toContain("shouldNotifyFoodQrPaid");
    expect(hook).toContain("paidNotifiedRef");
    expect(hook).toContain("onPaidRef");
    expect(hook).toContain("paidNotifiedRef.current = false");
    expect(hook).toContain("onPaid?: () => void");
  });

  it("hook remints on closed/expired and when remintKey changes", () => {
    expect(hook).toContain("remintKey");
    expect(hook).toContain("remintIfTerminal");
    expect(hook).toContain('state === "closed" || state === "expired"');
    expect(hook).toContain("remintingRef");
    expect(hook).toContain("ensureRef");
  });

  it("admin Bill: onPaid refresh, Pay guards, Razorpay chip, hide Pay at ₹0", () => {
    expect(ordersUi).toContain("onPaid: onFoodQrPaid");
    expect(ordersUi).toContain("refreshAfterEditRef");
    expect(ordersUi).toContain("reconcileFoodQrAttempt");
    expect(ordersUi).toContain("isFoodOrderAlreadySettledError");
    expect(ordersUi).toContain("Already paid via Razorpay");
    expect(ordersUi).toContain("isRazorpayFoodPaymentMethod(order.paymentMethod)");
    expect(ordersUi).toContain("food-order-razorpay-");
    expect(ordersUi).toContain("actualGroupPending > 0 && (");
    expect(ordersUi).toContain("preferRazorpayReceipt=");
    expect(ordersUi).toContain("showSuccess(\"Already paid via Razorpay\")");
  });

  it("My Bills onPaid refetches; bill card Settled uses formatFoodBillSettledMethods", () => {
    expect(myBills).toContain("onPaid:");
    expect(myBills).toContain("fetchBillsByToken");
    expect(card).toContain("formatFoodBillSettledMethods");
    // Settled footer no longer appends a second "Razorpay payment received" clause
    expect(card).not.toMatch(/Settled\$\{[^}]*\}[^;]*Razorpay payment received/);
    expect(card).not.toContain("· Razorpay payment received");
  });

  it("RecordPaymentModal + getFoodReceiptAccounts use Razorpay a/c overlay", () => {
    expect(modal).toContain("pickFoodOnlineAccountId");
    expect(modal).toContain("preferRazorpayReceipt");
    expect(accountsApi).toContain("FOOD_RAZORPAY_RECEIPT_NICKNAME");
    expect(FOOD_RAZORPAY_RECEIPT_NICKNAME).toBe("Razorpay a/c");
  });
});
