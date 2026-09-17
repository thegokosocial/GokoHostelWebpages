/** Sanitized Razorpay Checkout / payment failure metadata for admin test preview only. */
export type RazorpayFailureError = {
  code?: string;
  description?: string;
  reason?: string;
  source?: string;
  step?: string;
};

export function formatPreviewPaymentFailure(error?: RazorpayFailureError | null): string {
  if (!error?.code && !error?.description && !error?.reason) {
    return "Razorpay payment failed. Use the test card runbook below, then Start fresh ₹1 test.";
  }
  const reason = error.reason?.trim();
  const code = error.code?.trim();
  const description = error.description?.trim().slice(0, 240);
  if (reason === "authentication_failed" || code === "BAD_REQUEST_ERROR" ||
      description?.toLowerCase().includes("authentication")) {
    return "Razorpay card authentication failed. Use test card 4111 1111 1111 1111, OTP 1234, and click Success on the mock bank page — not Failure.";
  }
  if (code === "GATEWAY_ERROR") {
    return `Razorpay gateway error${description ? `: ${description}` : ""}. Start a fresh ₹1 test and retry.`;
  }
  const detail = [reason, code, description].filter(Boolean).join(" — ");
  return `Razorpay payment failed${detail ? `: ${detail}` : ""}. Start a fresh ₹1 test to retry.`;
}

export function paymentFailureHint(payment: {
  status: string;
  errorCode?: string | null;
  errorDescription?: string | null;
  errorReason?: string | null;
}): string | null {
  if (payment.status !== "failed") return null;
  return formatPreviewPaymentFailure({
    code: payment.errorCode ?? undefined,
    description: payment.errorDescription ?? undefined,
    reason: payment.errorReason ?? undefined,
  });
}
