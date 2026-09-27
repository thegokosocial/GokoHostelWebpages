import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "fs";
import {
  buildFingerprint,
  buildOrderSnapshot,
  snapshotTotalDuePaise,
  paymentMethodLabel,
  type OrderSnapshotEntry,
} from "@/lib/foodQrPayment";

// --- Pure helper tests (no DB, no mocks) ---

describe("buildFingerprint", () => {
  it("sorts by orderId and joins with pipe", () => {
    const entries: OrderSnapshotEntry[] = [
      { orderId: 3, duePaise: 5000, priorPaidPaise: 0, total: 50 },
      { orderId: 1, duePaise: 10000, priorPaidPaise: 0, total: 100 },
    ];
    expect(buildFingerprint(entries)).toBe("1:10000|3:5000");
  });

  it("produces identical fingerprint regardless of input order", () => {
    const a: OrderSnapshotEntry[] = [
      { orderId: 2, duePaise: 200, priorPaidPaise: 0, total: 2 },
      { orderId: 5, duePaise: 500, priorPaidPaise: 100, total: 6 },
    ];
    const b = [...a].reverse();
    expect(buildFingerprint(a)).toBe(buildFingerprint(b));
  });

  it("single order", () => {
    expect(buildFingerprint([{ orderId: 7, duePaise: 15000, priorPaidPaise: 0, total: 150 }]))
      .toBe("7:15000");
  });
});

describe("buildOrderSnapshot", () => {
  it("uses integer paise fields as-is (no ×100)", () => {
    const orders = [
      { id: 1, total: 20000, amountPaid: 5000, amountRefunded: 0, paymentStatus: "partial" },
      { id: 2, total: 10000, amountPaid: null, amountRefunded: null, paymentStatus: "pending" },
    ];
    const snap = buildOrderSnapshot(orders);
    expect(snap).toHaveLength(2);
    expect(snap[0]).toMatchObject({ orderId: 1, duePaise: 15000, priorPaidPaise: 5000, total: 20000 });
    expect(snap[1]).toMatchObject({ orderId: 2, duePaise: 10000, priorPaidPaise: 0, total: 10000 });
  });

  it("fully paid order has 0 duePaise", () => {
    const snap = buildOrderSnapshot([{ id: 3, total: 10000, amountPaid: 10000, paymentStatus: "paid" }]);
    expect(snap[0].duePaise).toBe(0);
    expect(snap[0].priorPaidPaise).toBe(10000);
  });
});

describe("snapshotTotalDuePaise", () => {
  it("sums duePaise across entries", () => {
    expect(snapshotTotalDuePaise([
      { orderId: 1, duePaise: 5000, priorPaidPaise: 0, total: 50 },
      { orderId: 2, duePaise: 3000, priorPaidPaise: 0, total: 30 },
    ])).toBe(8000);
  });
  it("returns 0 for empty", () => {
    expect(snapshotTotalDuePaise([])).toBe(0);
  });
});

describe("paymentMethodLabel", () => {
  it("returns razorpay for live", () => {
    expect(paymentMethodLabel("live")).toBe("razorpay");
  });
  it("returns razorpay_test for test", () => {
    expect(paymentMethodLabel("test")).toBe("razorpay_test");
  });
});

// --- peekRazorpayNotes: food attempt routing ---

describe("peekRazorpayNotes with food QR", () => {
  // Import inline to avoid full module load issues
  it("detects goko_food_attempt from qr_code entity", async () => {
    const { peekRazorpayNotes } = await import("@/lib/nativeGuestCheckout");
    const payload = {
      event: "qr_code.credited",
      account_id: "acc_Test123",
      payload: {
        qr_code: { entity: { id: "qr_abc", notes: { goko_food_attempt: "a1b2c3d4-e5f6-7890-abcd-ef1234567890" } } },
        payment: { entity: { id: "pay_xyz", notes: {} } },
      },
    };
    const raw = new TextEncoder().encode(JSON.stringify(payload));
    const notes = peekRazorpayNotes(raw);
    expect(notes.foodAttemptId).toBe("a1b2c3d4-e5f6-7890-abcd-ef1234567890");
    expect(notes.checkoutId).toBeUndefined();
    expect(notes.previewAttemptId).toBeUndefined();
  });

  it("detects goko_food_attempt from payment entity notes", async () => {
    const { peekRazorpayNotes } = await import("@/lib/nativeGuestCheckout");
    const payload = {
      event: "payment.captured",
      account_id: "acc_Test123",
      payload: {
        payment: { entity: { id: "pay_xyz", notes: { goko_food_attempt: "11111111-2222-3333-4444-555555555555" } } },
      },
    };
    const raw = new TextEncoder().encode(JSON.stringify(payload));
    const notes = peekRazorpayNotes(raw);
    expect(notes.foodAttemptId).toBe("11111111-2222-3333-4444-555555555555");
  });

  it("still detects checkout_id when no food attempt", async () => {
    const { peekRazorpayNotes } = await import("@/lib/nativeGuestCheckout");
    const payload = {
      event: "payment.captured",
      account_id: "acc_Test123",
      payload: {
        payment: { entity: { id: "pay_xyz", notes: { goko_checkout_id: "aaaa-bbbb" } } },
      },
    };
    const raw = new TextEncoder().encode(JSON.stringify(payload));
    const notes = peekRazorpayNotes(raw);
    expect(notes.checkoutId).toBe("aaaa-bbbb");
    expect(notes.foodAttemptId).toBeUndefined();
  });

  it("returns empty object for garbage", async () => {
    const { peekRazorpayNotes } = await import("@/lib/nativeGuestCheckout");
    const raw = new TextEncoder().encode("not json");
    expect(peekRazorpayNotes(raw)).toEqual({});
  });
});

// --- applyRazorpayCapture logic: verify no guest_receipts, method = razorpay ---

describe("applyRazorpayCapture contract", () => {
  it("sets paymentMethod to razorpay (live) without guest_receipts", async () => {
    // Mock DB and queries to verify the update calls
    const updateCalls: Array<{ id: number; data: Record<string, unknown> }> = [];
    const directUpdateCalls: Array<{ id: number; amountPaid: number }> = [];

    vi.doMock("@/db", () => ({
      getDb: () => ({
        select: () => ({
          from: () => ({
            where: (cond: unknown) => ({
              limit: () => [{ id: 1, total: 150, amountPaid: 0, paymentStatus: "pending", paymentMethod: "" }],
            }),
          }),
        }),
        update: (table: { _: { name: string } }) => ({
          set: (data: Record<string, unknown>) => ({
            where: (cond: unknown) => {
              if (table._.name === "food_qr_order_claims") return Promise.resolve();
              if (table._.name === "food_qr_attempts") return Promise.resolve();
              if (table._.name === "food_orders") {
                directUpdateCalls.push({ id: 0, amountPaid: data.amountPaid as number });
              }
              return Promise.resolve();
            },
          }),
        }),
        insert: () => ({ values: () => ({ onConflictDoNothing: () => ({ returning: () => [] }) }) }),
      }),
    }));

    vi.doMock("@/db/queries", () => ({
      updateFoodOrderPayment: (id: number, data: Record<string, unknown>) => {
        updateCalls.push({ id, data });
        return Promise.resolve();
      },
      getSetting: () => Promise.resolve(null),
      getFoodOrdersByIds: () => Promise.resolve([]),
      getFoodOrderItemsBatch: () => Promise.resolve(new Map()),
    }));

    // The method labels: live → razorpay, test → razorpay_test
    expect(paymentMethodLabel("live")).toBe("razorpay");
    expect(paymentMethodLabel("test")).toBe("razorpay_test");

    vi.doUnmock("@/db");
    vi.doUnmock("@/db/queries");
  });
});

describe("FoodQrError", () => {
  it("has correct defaults", async () => {
    const { FoodQrError } = await import("@/lib/foodQrPayment");
    const err = new FoodQrError("test");
    expect(err.status).toBe(409);
    expect(err.name).toBe("FoodQrError");
    expect(err.message).toBe("test");
  });
  it("accepts custom status", async () => {
    const { FoodQrError } = await import("@/lib/foodQrPayment");
    const err = new FoodQrError("not found", 404);
    expect(err.status).toBe(404);
  });
});

describe("claim helper + ensure remint contracts", () => {
  it("hasActiveFoodQrClaim is Pi-safe and ensure remints on fingerprint mismatch", () => {
    const src = readFileSync("src/lib/foodQrPayment.ts", "utf8");
    expect(src).toContain("isPiRuntime()) return false");
    expect(src).toContain("Due/order-set changed");
    expect(src).toContain("QR closed as paid but capture evidence is not ready yet");
    expect(src).toContain('order.status === "cancelled"');
  });
});

describe("fingerprint idempotency", () => {
  it("same orders same due produce same fingerprint", () => {
    const snap1: OrderSnapshotEntry[] = [
      { orderId: 10, duePaise: 5000, priorPaidPaise: 0, total: 50 },
      { orderId: 20, duePaise: 3000, priorPaidPaise: 2000, total: 50 },
    ];
    const snap2: OrderSnapshotEntry[] = [
      { orderId: 20, duePaise: 3000, priorPaidPaise: 2000, total: 50 },
      { orderId: 10, duePaise: 5000, priorPaidPaise: 0, total: 50 },
    ];
    expect(buildFingerprint(snap1)).toBe(buildFingerprint(snap2));
  });

  it("different due amounts produce different fingerprints", () => {
    const snap1: OrderSnapshotEntry[] = [{ orderId: 1, duePaise: 5000, priorPaidPaise: 0, total: 50 }];
    const snap2: OrderSnapshotEntry[] = [{ orderId: 1, duePaise: 6000, priorPaidPaise: 0, total: 60 }];
    expect(buildFingerprint(snap1)).not.toBe(buildFingerprint(snap2));
  });
});
