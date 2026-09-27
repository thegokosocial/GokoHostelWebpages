import { describe, it, expect } from "vitest";
import {
  razorpayQrCodeSchema,
  razorpayQrPaymentSchema,
  razorpayId,
} from "@/lib/razorpay";

const SAMPLE_QR_CODE = {
  entity: "qr_code" as const,
  id: "qr_HMsVL8HOpbMcjU",
  name: "Goko Food abc12345",
  usage: "single_use" as const,
  type: "upi_qr" as const,
  image_url: "https://rzp.io/i/w2CEwYmkAu",
  payment_amount: 15000,
  status: "active" as const,
  fixed_amount: true,
  payments_amount_received: 0,
  payments_count_received: 0,
  notes: { goko_food_attempt: "a1b2c3d4-e5f6-7890-abcd-ef1234567890" },
};

const SAMPLE_QR_PAYMENT = {
  entity: "payment" as const,
  id: "pay_FgR9UMzgmKDvRH",
  order_id: null,
  amount: 15000,
  currency: "INR" as const,
  status: "captured" as const,
  captured: true,
  amount_refunded: 0,
  method: "upi",
  fee: 354,
  tax: 54,
};

describe("razorpayId with qr prefix", () => {
  it("accepts valid qr_ ids", () => {
    expect(razorpayId("qr").safeParse("qr_HMsVL8HOpbMcjU").success).toBe(true);
  });
  it("rejects non-qr prefixes", () => {
    expect(razorpayId("qr").safeParse("pay_abc123").success).toBe(false);
    expect(razorpayId("qr").safeParse("order_abc123").success).toBe(false);
  });
  it("rejects empty", () => {
    expect(razorpayId("qr").safeParse("").success).toBe(false);
  });
});

describe("razorpayQrCodeSchema", () => {
  it("parses a valid active QR code", () => {
    const result = razorpayQrCodeSchema.safeParse(SAMPLE_QR_CODE);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe("qr_HMsVL8HOpbMcjU");
      expect(result.data.status).toBe("active");
      expect(result.data.fixed_amount).toBe(true);
      expect(result.data.usage).toBe("single_use");
      expect(result.data.payment_amount).toBe(15000);
    }
  });

  it("parses a closed QR code", () => {
    const closed = { ...SAMPLE_QR_CODE, status: "closed" as const, closed_at: 1700000000, close_reason: "paid" };
    expect(razorpayQrCodeSchema.safeParse(closed).success).toBe(true);
  });

  it("rejects invalid entity", () => {
    expect(razorpayQrCodeSchema.safeParse({ ...SAMPLE_QR_CODE, entity: "order" }).success).toBe(false);
  });

  it("rejects invalid id prefix", () => {
    expect(razorpayQrCodeSchema.safeParse({ ...SAMPLE_QR_CODE, id: "pay_abc" }).success).toBe(false);
  });

  it("rejects invalid status", () => {
    expect(razorpayQrCodeSchema.safeParse({ ...SAMPLE_QR_CODE, status: "pending" }).success).toBe(false);
  });

  it("accepts null payment_amount", () => {
    const noAmount = { ...SAMPLE_QR_CODE, payment_amount: null };
    expect(razorpayQrCodeSchema.safeParse(noAmount).success).toBe(true);
  });

  it("accepts missing optional fields", () => {
    const minimal = {
      entity: "qr_code" as const,
      id: "qr_Abc123",
      usage: "single_use" as const,
      image_url: "https://example.com/qr.png",
      status: "active" as const,
      fixed_amount: true,
    };
    expect(razorpayQrCodeSchema.safeParse(minimal).success).toBe(true);
  });

  it("accepts optional image_content UPI intent", () => {
    const withContent = {
      ...SAMPLE_QR_CODE,
      image_content: "upi://pay?pa=qmart.razorpay@hdfcbank&am=150.00&cu=INR",
    };
    const result = razorpayQrCodeSchema.safeParse(withContent);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.image_content).toMatch(/^upi:\/\//);
    }
  });
});

describe("razorpayQrPaymentSchema", () => {
  it("parses a captured QR payment (no order_id)", () => {
    const result = razorpayQrPaymentSchema.safeParse(SAMPLE_QR_PAYMENT);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.order_id).toBeNull();
      expect(result.data.captured).toBe(true);
      expect(result.data.method).toBe("upi");
    }
  });

  it("accepts payment with undefined order_id", () => {
    const { order_id: _, ...noOrderId } = SAMPLE_QR_PAYMENT;
    expect(razorpayQrPaymentSchema.safeParse(noOrderId).success).toBe(true);
  });

  it("accepts failed payment", () => {
    const failed = {
      ...SAMPLE_QR_PAYMENT,
      status: "failed" as const,
      captured: false,
      error_code: "BAD_REQUEST_ERROR",
      error_description: "Payment declined",
      error_reason: "payment_declined",
    };
    expect(razorpayQrPaymentSchema.safeParse(failed).success).toBe(true);
  });

  it("rejects invalid id prefix", () => {
    expect(razorpayQrPaymentSchema.safeParse({ ...SAMPLE_QR_PAYMENT, id: "qr_abc" }).success).toBe(false);
  });

  it("accepts payment with a real order_id", () => {
    const withOrder = { ...SAMPLE_QR_PAYMENT, order_id: "order_Abc123" };
    expect(razorpayQrPaymentSchema.safeParse(withOrder).success).toBe(true);
  });

  it("rejects negative amount", () => {
    expect(razorpayQrPaymentSchema.safeParse({ ...SAMPLE_QR_PAYMENT, amount: -100 }).success).toBe(false);
  });
});
