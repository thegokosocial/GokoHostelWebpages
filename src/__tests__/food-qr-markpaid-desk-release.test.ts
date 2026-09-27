import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const q = vi.hoisted(() => ({
  authenticateUser: vi.fn(),
  getFoodOrderById: vi.fn(),
  getFoodOrderItemsBatch: vi.fn(),
  resolveReceiptAccount: vi.fn(),
  getDb: vi.fn(),
  releaseFoodQrForDeskPayment: vi.fn(),
  hasActiveFoodQrClaim: vi.fn(async () => false),
  FoodQrError: class FoodQrError extends Error {
    status: number;
    constructor(message: string, status = 409) {
      super(message);
      this.name = "FoodQrError";
      this.status = status;
    }
  },
}));

vi.mock("@/lib/auth", () => ({ authenticateUser: q.authenticateUser }));
vi.mock("@/db/queries", () => ({
  getFoodOrderById: q.getFoodOrderById,
  getFoodOrderItemsBatch: q.getFoodOrderItemsBatch,
}));
vi.mock("@/lib/guestReceipts", () => ({
  resolveReceiptAccount: q.resolveReceiptAccount,
  receiptBusinessDate: vi.fn(() => "2026-09-22"),
}));
vi.mock("@/db", () => ({ getDb: q.getDb }));
vi.mock("@/lib/cashPaymentJournal", () => ({
  assertCashDateOpen: vi.fn(async () => undefined),
}));
vi.mock("@/lib/foodQrPayment", () => ({
  hasActiveFoodQrClaim: q.hasActiveFoodQrClaim,
  releaseFoodQrForDeskPayment: q.releaseFoodQrForDeskPayment,
  FoodQrError: q.FoodQrError,
}));

import { POST } from "@/app/api/admin/food-orders/route";

describe("markOrderPaid desk-release API mapping", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    q.authenticateUser.mockResolvedValue({ role: "admin", permissions: {}, username: "admin" });
    q.releaseFoodQrForDeskPayment.mockResolvedValue({ releasedAttemptIds: ["att-1"] });
    q.resolveReceiptAccount.mockResolvedValue(7);
    q.getFoodOrderById.mockResolvedValue({
      id: 10,
      orderNumber: "F-10",
      status: "placed",
      paymentStatus: "pending",
      paymentMethod: "",
      amountPaid: 0,
      amountRefunded: 0,
      total: 10000,
      cashReceived: 0,
      changeGiven: 0,
      guestName: "Ada",
      paidBy: "",
    });
    q.getFoodOrderItemsBatch.mockResolvedValue(new Map([[10, []]]));
    const batch = vi.fn(async (writes: unknown[]) => writes);
    q.getDb.mockReturnValue({
      batch,
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(async () => [{
            id: 10,
            status: "placed",
            paymentStatus: "pending",
            amountPaid: 0,
            amountRefunded: 0,
            total: 10000,
          }]),
        })),
      })),
      update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(async () => undefined) })) })),
      insert: vi.fn(() => ({ values: vi.fn(async () => undefined) })),
    });
  });

  function req(body: Record<string, unknown>) {
    return new NextRequest("http://localhost/api/admin/food-orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "pw", action: "markOrderPaid", ...body }),
    });
  }

  it("calls releaseFoodQrForDeskPayment before resolving the food receipt account", async () => {
    await POST(req({
      orderIds: [10],
      paymentMethod: "online",
      onlineAccountId: 7,
      cashReceived: 0,
      changeGiven: 0,
    }));
    expect(q.releaseFoodQrForDeskPayment).toHaveBeenCalledWith([10]);
    expect(q.releaseFoodQrForDeskPayment).toHaveBeenCalledBefore(q.resolveReceiptAccount as ReturnType<typeof vi.fn>);
  });

  it("returns 409 when desk release aborts because Razorpay already captured", async () => {
    q.releaseFoodQrForDeskPayment.mockRejectedValueOnce(
      new q.FoodQrError("A Razorpay payment was already captured for this bill. Refresh before recording desk payment.", 409),
    );
    const res = await POST(req({
      orderIds: [10],
      paymentMethod: "cash",
      cashReceived: 10000,
      changeGiven: 0,
    }));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toMatch(/already captured/i);
    expect(q.resolveReceiptAccount).not.toHaveBeenCalled();
    expect(q.getDb).not.toHaveBeenCalled();
  });

  it("requires explicit Received-in after closing a dynamic QR (no silent default bank)", async () => {
    const res = await POST(req({
      orderIds: [10],
      paymentMethod: "online",
      cashReceived: 0,
      changeGiven: 0,
    }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/Select Received-in/i);
    expect(q.resolveReceiptAccount).not.toHaveBeenCalled();
  });

  it("allows cash Mark Paid after QR release without a bank account", async () => {
    const res = await POST(req({
      orderIds: [10],
      paymentMethod: "cash",
      cashReceived: 10000,
      changeGiven: 0,
    }));
    expect(q.releaseFoodQrForDeskPayment).toHaveBeenCalledWith([10]);
    expect(q.resolveReceiptAccount).not.toHaveBeenCalled();
    // batch mock may or may not complete; must not 400 for missing Received-in
    expect(res.status).not.toBe(400);
  });
});
