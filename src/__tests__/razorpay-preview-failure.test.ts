import { describe, expect, it } from "vitest";
import { formatPreviewPaymentFailure, paymentFailureHint } from "@/lib/razorpayPreviewFailure";

describe("Razorpay preview failure messaging", () => {
  it("guides authentication failures toward the test card runbook", () => {
    expect(formatPreviewPaymentFailure({ code: "BAD_REQUEST_ERROR", reason: "authentication_failed",
      description: "Payment was unsuccessful as customer entered incorrect OTP" })).toContain("OTP 1234");
  });
  it("maps gateway errors to a fresh-test retry", () => {
    expect(formatPreviewPaymentFailure({ code: "GATEWAY_ERROR", description: "Temporary outage" })).toContain("fresh ₹1 test");
  });
  it("returns a payment failure hint only for failed payments", () => {
    expect(paymentFailureHint({ status: "failed", errorReason: "authentication_failed" })).toContain("authentication failed");
    expect(paymentFailureHint({ status: "captured" })).toBeNull();
  });
});
