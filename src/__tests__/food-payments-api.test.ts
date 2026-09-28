import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";

describe("admin food-payments + guest bill QR routes", () => {
  const adminRoute = readFileSync("src/app/api/admin/food-payments/route.ts", "utf8");
  const guestRoute = readFileSync("src/app/api/food/bills/qr/route.ts", "utf8");
  const billsRoute = readFileSync("src/app/api/food/bills/route.ts", "utf8");
  const hook = readFileSync("src/hooks/useFoodBillDynamicQr.ts", "utf8");
  const card = readFileSync("src/components/food/GuestFoodBillCard.tsx", "utf8");
  const ledger = readFileSync("src/components/admin/FoodPaymentsLedger.tsx", "utf8");
  const ordersUi = readFileSync("src/components/admin/AdminFoodOrders.tsx", "utf8");
  const myBills = readFileSync("src/app/my-bills/page.tsx", "utf8");

  it("admin ledger is admin-only; ensure/reconcile/close allow bill staff permissions", () => {
    expect(adminRoute).toContain('listFoodQrAttempts: "admin_only"');
    expect(adminRoute).toContain("ensureFoodQr");
    expect(adminRoute).toContain("reconcileFoodQrAttempt");
    expect(adminRoute).toContain("closeActiveFoodQr");
    expect(adminRoute).toContain("closeActiveFoodQrAttempt");
    expect(adminRoute).toContain("canGenerateFoodBills");
    expect(adminRoute).toContain("ensureActiveFoodQrForOrders");
    expect(adminRoute).toContain("isPiRuntime");
    expect(adminRoute).toContain("fromDate: isoDate.optional()");
    expect(adminRoute).toContain("toDate: isoDate.optional()");
    expect(adminRoute).toContain("query: z.string().trim().max(120).optional()");
    expect(adminRoute).toContain("page: z.number().int().min(1).optional()");
  });

  it("guest QR route is share-token only with checkin/walk-in scope and never trusts client amount", () => {
    expect(guestRoute).toContain("ensureActiveFoodQrForOrders");
    expect(guestRoute).toContain("getValidFoodBillShareToken");
    expect(guestRoute).toContain("token: z.string().min(8).max(40)");
    expect(guestRoute).toContain("phone-only mint is not allowed");
    expect(guestRoute).toContain("Orders do not match this bill");
    expect(guestRoute).toContain("Payment attempt does not match this bill");
    expect(guestRoute).toContain("normalizeWalkinGuestName");
    expect(guestRoute).not.toMatch(/amountPaise.*body|body\.amount/);
    expect(guestRoute).toContain("}).strict()");
    expect(guestRoute).toContain('action: z.enum(["ensure", "status"])');
    expect(hook).toContain("Missing bill share token");
    expect(hook).not.toMatch(/phone: opts\.phone/);
    expect(hook).not.toContain("Missing admin credentials");
    expect(hook).toContain('password: opts.password || ""');
  });

  it("public bills payload includes order ids and effective qrMode", () => {
    expect(billsRoute).toContain("id: o.id");
    expect(billsRoute).toContain("amountPaid: o.amountPaid");
    expect(billsRoute).toContain("effectiveMode");
    expect(billsRoute).toContain("qrMode");
  });

  it("pay QR only on share-token My Bills + admin Bill drawer; menu items hide payment", () => {
    expect(myBills).toContain("useFoodBillDynamicQr");
    expect(myBills).toContain("myBillsShowsPayQr");
    expect(myBills).toContain("myBillsHidePayment");
    expect(myBills).toContain("shouldEnsureDynamicFoodQr");
    expect(myBills).toContain("hidePayment={hidePayment}");
    expect(myBills).toContain("onPaid");
    expect(myBills).toContain("fetchBillsByToken");
    expect(myBills).toContain("remintKey: unpaidRemintKey");
    expect(myBills).not.toContain("Total Spent");
    expect(myBills).not.toMatch(/variant=\"paid\"/);
    expect(ordersUi).toContain("useFoodBillDynamicQr");
    expect(ordersUi).toContain("onPaid: onFoodQrPaid");
    expect(ordersUi).toContain("remintKey: unpaidBillRemintKey");
    expect(ordersUi).not.toContain("Open Razorpay bill QR");
    expect(ordersUi).not.toContain("Retire QR");
    expect(ordersUi).toContain("isFoodOrderAlreadySettledError");
    expect(ordersUi).toContain("Already paid via Razorpay");
    expect(ordersUi).toContain("preferRazorpayReceipt");
    expect(ordersUi).toContain("isRazorpayFoodPaymentMethod");
    expect(ordersUi).toContain("food-order-razorpay-");
    expect(ordersUi).toContain("actualGroupPending > 0");
    expect(ordersUi).not.toContain("Share image");
    expect(ordersUi).not.toContain("shareBillImage");
    expect(card).toContain("hidePayment");
    expect(card).toContain("Razorpay payment received");
    expect(card).toContain("upiIntent");
    expect(hook).toContain("ensureFoodQr");
    expect(hook).toContain("onPaid");
    expect(hook).toContain("paidNotifiedRef");
    expect(hook).toContain("remintIfTerminal");
    expect(ledger).toContain("listFoodQrAttempts");
    expect(ledger).toContain("DateRangePicker");
    expect(ledger).toContain("fromDate");
    expect(ledger).toContain("reconcileFoodQrAttempt");
    expect(ledger).toContain("closeActiveFoodQr");
    expect(ledger).toContain("foodQrAttemptOutcome");
    expect(ledger).toContain("Retire QR");
  });
});
