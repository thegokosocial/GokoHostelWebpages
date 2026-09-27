import { describe, it, expect } from "vitest";
import {
  FOOD_RAZORPAY_RECEIPT_NICKNAME,
  foodBillQrStaffCaption,
  formatFoodBillSettledMethods,
  formatFoodPaymentMethodLabel,
  isFoodOrderAlreadySettledError,
  isRazorpayBillMode,
  isRazorpayFoodPaymentMethod,
  mapFoodQrAttemptToUi,
  mapFoodQrEnsureResponse,
  myBillsHidePayment,
  myBillsShowsPaidHistory,
  myBillsShowsPayQr,
  myBillsShowsSpendSummary,
  pickFoodOnlineAccountId,
  resolveFoodBillPayQrSource,
  shouldEnsureDynamicFoodQr,
  shouldNotifyFoodQrPaid,
} from "@/lib/foodBillQrUi";
import { actionAllowed } from "@/lib/actionPermissions";
import { readFileSync } from "fs";

describe("My Bills surface rules", () => {
  it("menu phone lookup never shows pay QR or payment block", () => {
    expect(myBillsShowsPayQr(false)).toBe(false);
    expect(myBillsHidePayment(false)).toBe(true);
  });

  it("share token shows pay QR and payment block", () => {
    expect(myBillsShowsPayQr(true)).toBe(true);
    expect(myBillsHidePayment(true)).toBe(false);
  });

  it("never shows paid history or spend summary on guest My Bills", () => {
    expect(myBillsShowsPaidHistory()).toBe(false);
    expect(myBillsShowsSpendSummary()).toBe(false);
  });
});

describe("shouldEnsureDynamicFoodQr", () => {
  it("requires showPayQr + unpaid + razorpay mode + ready", () => {
    expect(shouldEnsureDynamicFoodQr({
      showPayQr: true, unpaidOrderCount: 2, qrMode: "razorpay_test", ready: true,
    })).toBe(true);
    expect(shouldEnsureDynamicFoodQr({
      showPayQr: true, unpaidOrderCount: 2, qrMode: "razorpay_live", ready: true,
    })).toBe(true);
  });

  it("skips menu path even when razorpay mode", () => {
    expect(shouldEnsureDynamicFoodQr({
      showPayQr: false, unpaidOrderCount: 5, qrMode: "razorpay_live", ready: true,
    })).toBe(false);
  });

  it("skips static mode, empty unpaid, and not-ready", () => {
    expect(shouldEnsureDynamicFoodQr({
      showPayQr: true, unpaidOrderCount: 1, qrMode: "static", ready: true,
    })).toBe(false);
    expect(shouldEnsureDynamicFoodQr({
      showPayQr: true, unpaidOrderCount: 0, qrMode: "razorpay_test", ready: true,
    })).toBe(false);
    expect(shouldEnsureDynamicFoodQr({
      showPayQr: true, unpaidOrderCount: 1, qrMode: "razorpay_test", ready: false,
    })).toBe(false);
  });

  it("treats unknown mode as static", () => {
    expect(isRazorpayBillMode("nope")).toBe(false);
    expect(shouldEnsureDynamicFoodQr({
      showPayQr: true, unpaidOrderCount: 1, qrMode: "nope", ready: true,
    })).toBe(false);
  });
});

describe("foodBillQrUiLocksEdits / foodBillQrRetireAttemptId", () => {
  it("locks edits for active and loading; retire id from active or preparing", async () => {
    const { foodBillQrUiLocksEdits, foodBillQrRetireAttemptId } = await import("@/lib/foodBillQrUi");
    expect(foodBillQrUiLocksEdits("active")).toBe(true);
    expect(foodBillQrUiLocksEdits("loading")).toBe(true);
    expect(foodBillQrUiLocksEdits("paid")).toBe(false);
    expect(foodBillQrRetireAttemptId({ status: "active", attemptId: "a1", imageUrl: null, upiIntent: null, closeBy: null, amountPaise: 0, label: "x" })).toBe("a1");
    expect(foodBillQrRetireAttemptId({ status: "loading", attemptId: "a2" })).toBe("a2");
    expect(foodBillQrRetireAttemptId({ status: "loading" })).toBeNull();
    expect(foodBillQrRetireAttemptId({ status: "idle" })).toBeNull();
  });
});

describe("foodQrCreatedAtBounds", () => {
  it("maps inclusive IST days to UTC ISO bounds", async () => {
    const { foodQrCreatedAtBounds } = await import("@/lib/foodBillQrUi");
    expect(foodQrCreatedAtBounds()).toEqual({ fromIso: null, toExclusiveIso: null });
    expect(foodQrCreatedAtBounds("bad", "also-bad")).toEqual({ fromIso: null, toExclusiveIso: null });
    const bounds = foodQrCreatedAtBounds("2026-09-27", "2026-09-27");
    expect(bounds.fromIso).toBe("2026-09-26T18:30:00.000Z");
    expect(bounds.toExclusiveIso).toBe("2026-09-27T18:30:00.000Z");
  });
});

describe("foodQrAttemptCanReconcile / formatFoodQrOrderIdsPreview", () => {
  it("Reconcile only for open attempts with a gateway qrCodeId", async () => {
    const { foodQrAttemptCanReconcile } = await import("@/lib/foodBillQrUi");
    expect(foodQrAttemptCanReconcile({ state: "active", qrCodeId: "qr_x" })).toBe(true);
    expect(foodQrAttemptCanReconcile({ state: "creating", qrCodeId: "qr_x" })).toBe(true);
    expect(foodQrAttemptCanReconcile({ state: "creating", qrCodeId: null })).toBe(false);
    expect(foodQrAttemptCanReconcile({ state: "expired", qrCodeId: "qr_x" })).toBe(false);
    expect(foodQrAttemptCanReconcile({ state: "closed", qrCodeId: "qr_x" })).toBe(false);
    expect(foodQrAttemptCanReconcile({ state: "paid", qrCodeId: "qr_x" })).toBe(false);
  });

  it("collapses order ids after the first three", async () => {
    const { formatFoodQrOrderIdsPreview } = await import("@/lib/foodBillQrUi");
    expect(formatFoodQrOrderIdsPreview([1, 2])).toEqual({ visible: [1, 2], hiddenCount: 0 });
    expect(formatFoodQrOrderIdsPreview([1, 2, 3, 4, 5])).toEqual({
      visible: [1, 2, 3],
      hiddenCount: 2,
    });
    expect(formatFoodQrOrderIdsPreview([10, 11, 12, 13], { limit: 2 })).toEqual({
      visible: [10, 11],
      hiddenCount: 2,
    });
  });
});

describe("mapFoodQrAttemptToUi", () => {
  it("maps active with image", () => {
    expect(mapFoodQrAttemptToUi({
      attemptId: "a1", state: "active", imageUrl: "https://rzp.io/i/x", closeBy: "2099-01-01", amountPaise: 10000,
    })).toEqual({
      status: "active",
      attemptId: "a1",
      imageUrl: "https://rzp.io/i/x",
      upiIntent: null,
      closeBy: "2099-01-01",
      amountPaise: 10000,
      label: "Pay exact amount via UPI",
    });
  });

  it("maps active with upiIntent alone (no poster)", () => {
    expect(mapFoodQrAttemptToUi({
      attemptId: "a1",
      state: "active",
      upiIntent: "upi://pay?pa=x@ybl&am=2.00",
      amountPaise: 200,
    })).toMatchObject({
      status: "active",
      upiIntent: "upi://pay?pa=x@ybl&am=2.00",
      imageUrl: null,
    });
  });

  it("maps paid with Razorpay label", () => {
    expect(mapFoodQrAttemptToUi({
      attemptId: "a1", state: "paid", paymentMethodLabel: "razorpay_test",
    })).toEqual({ status: "paid", label: "razorpay_test" });
  });

  it("maps creating/qr_unknown to loading with attemptId (Retire while preparing)", () => {
    expect(mapFoodQrAttemptToUi({ attemptId: "a1", state: "creating" })).toEqual({
      status: "loading",
      attemptId: "a1",
    });
    expect(mapFoodQrAttemptToUi({ attemptId: "a1", state: "qr_unknown" })).toEqual({
      status: "loading",
      attemptId: "a1",
    });
  });

  it("maps expired/closed to loading without attemptId (ensure remint path)", () => {
    for (const state of ["expired", "closed"]) {
      expect(mapFoodQrAttemptToUi({ attemptId: "a1", state })).toEqual({ status: "loading" });
    }
  });

  it("maps missing attempt and active-without-image to error", () => {
    expect(mapFoodQrAttemptToUi(null).status).toBe("error");
    expect(mapFoodQrAttemptToUi({ state: "active" }).status).toBe("error");
  });

  it("accepts id alias when attemptId missing", () => {
    const ui = mapFoodQrAttemptToUi({
      id: "uuid-1", state: "active", imageUrl: "https://rzp.io/i/y", amountPaise: 100,
    });
    expect(ui).toMatchObject({ status: "active", attemptId: "uuid-1" });
  });
});

describe("mapFoodQrEnsureResponse", () => {
  it("409 paid → paid UI", () => {
    expect(mapFoodQrEnsureResponse({
      ok: false, status: 409, body: { paid: true },
    })).toEqual({ status: "paid", label: "Already paid" });
  });

  it("mode static / not enabled → static fallback", () => {
    expect(mapFoodQrEnsureResponse({
      ok: false, status: 400, body: { mode: "static", error: "Dynamic Razorpay QR is not enabled" },
    }).status).toBe("static");
    expect(mapFoodQrEnsureResponse({
      ok: false, status: 400, body: { error: "not enabled for this merchant" },
    }).status).toBe("static");
  });

  it("other errors surface message", () => {
    expect(mapFoodQrEnsureResponse({
      ok: false, status: 403, body: { error: "Orders do not match this bill" },
    })).toEqual({ status: "error", message: "Orders do not match this bill" });
  });

  it("ok with attempt maps through", () => {
    expect(mapFoodQrEnsureResponse({
      ok: true, status: 200,
      body: { attempt: { attemptId: "x", state: "active", imageUrl: "https://rzp.io/i/z", amountPaise: 500 } },
    }).status).toBe("active");
  });
});

describe("food-payments RBAC matrix", () => {
  const ensure: Parameters<typeof actionAllowed>[2] = ["canGenerateFoodBills", "canMarkPaid", "canViewFoodOrders"];
  const list: Parameters<typeof actionAllowed>[2] = "admin_only";

  it("admin bypasses all", () => {
    expect(actionAllowed("admin", {}, list)).toBe("allowed");
    expect(actionAllowed("admin", {}, ensure)).toBe("allowed");
  });

  it("staff with bill view can ensure/reconcile but not list ledger", () => {
    expect(actionAllowed("staff", { canViewFoodOrders: true }, ensure)).toBe("allowed");
    expect(actionAllowed("staff", { canGenerateFoodBills: true }, ensure)).toBe("allowed");
    expect(actionAllowed("staff", { canMarkPaid: true }, ensure)).toBe("allowed");
    expect(actionAllowed("staff", { canViewFoodOrders: true }, list)).toBe("admin_required");
  });

  it("staff without food keys denied ensure", () => {
    expect(actionAllowed("staff", { canViewMenu: true }, ensure)).toBe("forbidden");
  });
});

describe("claim guards + guest QR contracts stay wired", () => {
  const foodOrders = readFileSync("src/app/api/admin/food-orders/route.ts", "utf8");
  const guestQr = readFileSync("src/app/api/food/bills/qr/route.ts", "utf8");
  const card = readFileSync("src/components/food/GuestFoodBillCard.tsx", "utf8");
  const myBills = readFileSync("src/app/my-bills/page.tsx", "utf8");
  const engine = readFileSync("src/lib/foodQrPayment.ts", "utf8");

  it("active QR claims block total-changing mutators; Mark Paid supersedes via desk release", () => {
    expect(foodOrders).toContain("rejectIfActiveFoodQr");
    expect(foodOrders).toContain("releaseFoodQrForDeskPayment");
    expect(foodOrders.match(/rejectIfActiveFoodQr/g)?.length).toBeGreaterThanOrEqual(7);
    expect(foodOrders).toContain("cancelUnpaidOrder");
    expect(foodOrders).toContain("applyDiscount");
    expect(foodOrders).toContain("removeDiscount");
    expect(foodOrders).toContain("saveOrderEdits");
    expect(foodOrders).toContain("voidItem");
    expect(foodOrders).toContain("updateItemQuantity");
    expect(foodOrders).toContain("setFoodOrderItemPrice");
    expect(foodOrders).toContain("reassignOrder");
    expect(foodOrders).toContain("Razorpay food QR payments cannot be rewritten");
    expect(foodOrders).toContain("Razorpay food QR captures cannot be reversed");
    expect(engine).toContain("isPiRuntime()) return false");
    expect(engine).toContain("releaseFoodQrForDeskPayment");
  });

  it("guest QR is token-only with scope checks and never trusts client amount", () => {
    expect(guestQr).not.toMatch(/payment_amount|amountPaise:\s*body/);
    expect(guestQr).toContain("Orders do not match this bill");
    expect(guestQr).toContain("Nothing unpaid");
    expect(guestQr).toContain("phone-only mint is not allowed");
    expect(guestQr).toContain("Payment attempt does not match this bill");
  });

  it("GuestFoodBillCard: resolveFoodBillPayQrSource → intent / poster / static; no CORS decode", () => {
    expect(card).toContain("hidePayment");
    expect(card).toContain("resolveFoodBillPayQrSource");
    expect(card).toContain("AutoQrCode");
    expect(card).toContain("RazorpayPosterQr");
    expect(card).toContain("showPosterCrop");
    expect(card).toContain("maxPx={280}");
    expect(card).toContain("foodBillQrStaffCaption");
    expect(card).toContain("hasPosterImage");
    expect(card).toContain("formatFoodBillSettledMethods");
    expect(card).not.toContain("crossOrigin");
    expect(card).not.toContain("jsQR");
  });

  it("My Bills wires shared surface helpers", () => {
    expect(myBills).toContain("myBillsShowsPayQr");
    expect(myBills).toContain("myBillsHidePayment");
    expect(myBills).toContain("shouldEnsureDynamicFoodQr");
    expect(myBills).toContain("hidePayment={hidePayment}");
    expect(myBills).toContain("onPaid");
  });
});

describe("isRazorpayFoodPaymentMethod + Settled labels + onPaid gate", () => {
  it("recognizes live and test capture methods", () => {
    expect(isRazorpayFoodPaymentMethod("razorpay")).toBe(true);
    expect(isRazorpayFoodPaymentMethod("razorpay_test")).toBe(true);
    expect(isRazorpayFoodPaymentMethod("online")).toBe(false);
    expect(formatFoodPaymentMethodLabel("razorpay_test")).toBe("Razorpay");
    expect(formatFoodPaymentMethodLabel("online")).toBe("online");
  });

  it("Settled suffix dedupes razorpay/razorpay_test and skips empty", () => {
    expect(formatFoodBillSettledMethods(["razorpay", "razorpay_test", "online"])).toBe(" · Razorpay, online");
    expect(formatFoodBillSettledMethods([undefined, null])).toBe("");
  });

  it("shouldNotifyFoodQrPaid is once-only", () => {
    expect(shouldNotifyFoodQrPaid(false, "paid")).toBe(true);
    expect(shouldNotifyFoodQrPaid(true, "paid")).toBe(false);
  });
});

describe("isFoodOrderAlreadySettledError + pickFoodOnlineAccountId", () => {
  it("detects the outstanding-balance 409 copy", () => {
    expect(isFoodOrderAlreadySettledError("Every selected order must have an outstanding balance")).toBe(true);
    expect(isFoodOrderAlreadySettledError("Could not record payment")).toBe(false);
  });

  it("prefers Razorpay a/c when requested; empty while requireAccountPick", () => {
    const accounts = [
      { id: 3, nickname: "HDFC" },
      { id: 9, nickname: FOOD_RAZORPAY_RECEIPT_NICKNAME },
    ];
    expect(pickFoodOnlineAccountId({
      accounts, requireAccountPick: true, preferRazorpay: true, foodOnlineReceiptAccountId: 3,
    })).toBe("");
    expect(pickFoodOnlineAccountId({
      accounts, preferRazorpay: true, foodOnlineReceiptAccountId: 3,
    })).toBe("9");
    expect(pickFoodOnlineAccountId({
      accounts, preferRazorpay: false, foodOnlineReceiptAccountId: 3,
    })).toBe("3");
    expect(FOOD_RAZORPAY_RECEIPT_NICKNAME).toBe("Razorpay a/c");
  });
});

describe("resolveFoodBillPayQrSource", () => {
  const poster = "https://rzp.io/i/poster-abc";
  const intent = "upi://pay?pa=qmart.razorpay@hdfcbank&am=10.00";
  const phonepe = "https://cdn.example/phonepe.png";

  it("prefers upiIntent over poster and static", () => {
    expect(resolveFoodBillPayQrSource({
      dynamicStatus: "active",
      upiIntent: intent,
      imageUrl: poster,
      staticQrUrl: phonepe,
    })).toEqual({ kind: "intent", upiIntent: intent });
  });

  it("uses CSS-cropped poster when active without intent", () => {
    expect(resolveFoodBillPayQrSource({
      dynamicStatus: "active",
      upiIntent: null,
      imageUrl: poster,
      staticQrUrl: phonepe,
    })).toEqual({ kind: "poster", imageUrl: poster });
  });

  it("falls back to PhonePe static when active has neither intent nor poster", () => {
    expect(resolveFoodBillPayQrSource({
      dynamicStatus: "active",
      upiIntent: "  ",
      imageUrl: "",
      staticQrUrl: phonepe,
    })).toEqual({ kind: "static", qrUrl: phonepe });
  });

  it("hides QR for paid/loading/error/hidePayment; static mode uses bill QR", () => {
    expect(resolveFoodBillPayQrSource({
      dynamicStatus: "paid", imageUrl: poster, staticQrUrl: phonepe,
    }).kind).toBe("none");
    expect(resolveFoodBillPayQrSource({
      dynamicStatus: "loading", imageUrl: poster, staticQrUrl: phonepe,
    }).kind).toBe("none");
    expect(resolveFoodBillPayQrSource({
      hidePayment: true, dynamicStatus: "active", imageUrl: poster,
    }).kind).toBe("none");
    expect(resolveFoodBillPayQrSource({
      dynamicStatus: "static", staticQrUrl: phonepe,
    })).toEqual({ kind: "static", qrUrl: phonepe });
    expect(resolveFoodBillPayQrSource({
      dynamicStatus: null, staticQrUrl: phonepe,
    })).toEqual({ kind: "static", qrUrl: phonepe });
  });
});

describe("foodBillQrStaffCaption", () => {
  it("labels Razorpay (intent or poster) vs PhonePe static vs unavailable fallback", () => {
    expect(foodBillQrStaffCaption({
      dynamicStatus: "active", hasUpiIntent: true, razorpayMode: true,
    })).toEqual({ kind: "razorpay", text: "Razorpay UPI · exact amount" });
    expect(foodBillQrStaffCaption({
      dynamicStatus: "active", hasUpiIntent: false, hasPosterImage: true, razorpayMode: true,
    })).toEqual({ kind: "razorpay", text: "Razorpay UPI · exact amount" });
    expect(foodBillQrStaffCaption({
      dynamicStatus: "active", hasUpiIntent: false, hasPosterImage: false, razorpayMode: true,
    })).toEqual({ kind: "phonepe_fallback", text: "PhonePe static QR (Razorpay square unavailable)" });
    expect(foodBillQrStaffCaption({
      dynamicStatus: "static", razorpayMode: false,
    })).toEqual({ kind: "phonepe_static", text: "PhonePe static QR" });
    expect(foodBillQrStaffCaption({ dynamicStatus: "loading" })?.kind).toBe("loading");
    expect(foodBillQrStaffCaption({ hidePayment: true, dynamicStatus: "active", hasUpiIntent: true })).toBeNull();
  });

  it("hides captions for paid and error; labels pure static when no dynamic overlay", () => {
    expect(foodBillQrStaffCaption({ dynamicStatus: "paid", hasUpiIntent: true })).toBeNull();
    expect(foodBillQrStaffCaption({ dynamicStatus: "error" })).toBeNull();
    expect(foodBillQrStaffCaption({ dynamicStatus: null, razorpayMode: true })).toEqual({
      kind: "phonepe_static", text: "PhonePe static QR",
    });
    expect(foodBillQrStaffCaption({
      dynamicStatus: "loading", hidePayment: false,
    })).toEqual({ kind: "loading", text: "Preparing Razorpay QR…" });
  });
});
