/** Durable website checkout fields stored on bookings.rawData for admin / Razorpay cross-check. */

export type WebsiteCheckoutSnapshot = {
  nativeCheckout: true;
  paymentChoice?: string;
  checkoutId?: string;
  checkoutState?: string;
  gatewayEnvironment?: string;
  razorpayOrderId?: string | null;
  paymentIds?: string[];
  dueNowPaise?: number;
  dueAtPropertyPaise?: number;
  capturedPaise?: number;
  orphanCapture?: boolean;
  receipt?: string | null;
  holdId?: string | null;
  acceptedQuoteId?: string | null;
  quoteSummary?: {
    nights: number;
    beforeTax: number;
    tax: number;
    total: number;
    unitsLabel?: string;
  };
};

export function parseWebsiteCheckout(raw?: string | null): WebsiteCheckoutSnapshot | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object") return null;
    if (parsed.nativeCheckout !== true && !parsed.websiteCheckout) return null;
    const nested = (parsed.websiteCheckout && typeof parsed.websiteCheckout === "object")
      ? parsed.websiteCheckout as Record<string, unknown>
      : parsed;
    return {
      nativeCheckout: true,
      paymentChoice: typeof nested.paymentChoice === "string" ? nested.paymentChoice : undefined,
      checkoutId: typeof nested.checkoutId === "string" ? nested.checkoutId : undefined,
      checkoutState: typeof nested.checkoutState === "string" ? nested.checkoutState : undefined,
      gatewayEnvironment: typeof nested.gatewayEnvironment === "string" ? nested.gatewayEnvironment : undefined,
      razorpayOrderId: typeof nested.razorpayOrderId === "string" ? nested.razorpayOrderId : nested.razorpayOrderId === null ? null : undefined,
      paymentIds: Array.isArray(nested.paymentIds)
        ? nested.paymentIds.filter((id): id is string => typeof id === "string")
        : undefined,
      dueNowPaise: typeof nested.dueNowPaise === "number" ? nested.dueNowPaise : undefined,
      dueAtPropertyPaise: typeof nested.dueAtPropertyPaise === "number" ? nested.dueAtPropertyPaise : undefined,
      capturedPaise: typeof nested.capturedPaise === "number" ? nested.capturedPaise : undefined,
      orphanCapture: nested.orphanCapture === true,
      receipt: typeof nested.receipt === "string" ? nested.receipt : nested.receipt === null ? null : undefined,
      holdId: typeof nested.holdId === "string" ? nested.holdId : nested.holdId === null ? null : undefined,
      acceptedQuoteId: typeof nested.acceptedQuoteId === "string" ? nested.acceptedQuoteId : nested.acceptedQuoteId === null ? null : undefined,
      quoteSummary: nested.quoteSummary && typeof nested.quoteSummary === "object"
        ? nested.quoteSummary as WebsiteCheckoutSnapshot["quoteSummary"]
        : undefined,
    };
  } catch {
    return null;
  }
}

/** Merge website checkout snapshot into booking rawData without wiping other keys (e.g. walk-in). */
export function mergeWebsiteCheckoutRaw(
  existingRaw: string | null | undefined,
  snapshot: Omit<WebsiteCheckoutSnapshot, "nativeCheckout"> & { nativeCheckout?: true },
): string {
  let base: Record<string, unknown> = {};
  if (existingRaw) {
    try {
      const parsed = JSON.parse(existingRaw) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) base = { ...parsed as Record<string, unknown> };
    } catch { /* replace */ }
  }
  const prev = parseWebsiteCheckout(JSON.stringify(base));
  const next: WebsiteCheckoutSnapshot = {
    nativeCheckout: true,
    ...(prev || {}),
    ...snapshot,
  };
  next.nativeCheckout = true;
  return JSON.stringify({
    ...base,
    ...next,
    websiteCheckout: next,
  });
}
