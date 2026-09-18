import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { mergeWebsiteCheckoutRaw, parseWebsiteCheckout } from "@/lib/websiteCheckoutSnapshot";

describe("websiteCheckoutSnapshot", () => {
  it("merges Razorpay IDs without wiping other rawData keys", () => {
    const raw = mergeWebsiteCheckoutRaw('{"walkin":true}', {
      paymentChoice: "advance",
      razorpayOrderId: "order_ABC",
      paymentIds: ["pay_1"],
      gatewayEnvironment: "test",
      orphanCapture: true,
      dueNowPaise: 50000,
    });
    const parsed = JSON.parse(raw);
    expect(parsed.walkin).toBe(true);
    expect(parsed.nativeCheckout).toBe(true);
    expect(parseWebsiteCheckout(raw)).toMatchObject({
      razorpayOrderId: "order_ABC",
      paymentIds: ["pay_1"],
      orphanCapture: true,
      gatewayEnvironment: "test",
    });
  });
});

describe("checkout fail / seamless contracts", () => {
  const hero = readFileSync("src/components/booking/BookingHeroPanel.tsx", "utf8");
  const overlay = readFileSync("src/components/booking/CheckoutWaitOverlay.tsx", "utf8");
  const abandonClient = readFileSync("src/lib/guestCheckoutAbandonClient.ts", "utf8");
  const abandonRoute = readFileSync("src/app/api/guest-booking/abandon/route.ts", "utf8");
  const native = readFileSync("src/lib/nativeGuestCheckout.ts", "utf8");
  const bookingsRoute = readFileSync("src/app/api/admin/bookings/route.ts", "utf8");
  const detail = readFileSync("src/components/admin/booking-dashboard/BookingDetailPanel.tsx", "utf8");

  it("disarms leave-guard before location.replace", () => {
    expect(abandonClient).toContain("disarmCheckoutLeaveGuard");
    expect(overlay).toContain("isCheckoutLeaveGuardDisarmed");
    expect(hero).toContain("disarmCheckoutLeaveGuard()");
    expect(hero).toContain("location.replace");
    expect(hero).not.toMatch(/window\.location\.href\s*=\s*`\/booking/);
  });

  it("redirects only when fulfilled / received and mints new requestKey", () => {
    expect(hero).toContain('data.state === "fulfilled" || data.bookingStatus === "received"');
    expect(hero).toContain("crypto.randomUUID()");
    expect(hero).toContain("setCheckoutRequestKey(crypto.randomUUID())");
    expect(hero).toContain("payment.failed");
    expect(hero).toContain("Try again");
    expect(hero).toContain("releaseUncertainCheckout");
    expect(hero).toContain("uncertain: true");
  });

  it("uncertain abandon never fulfils; orphan + admin refund wired", () => {
    expect(abandonRoute).toContain("uncertain: body.uncertain === true");
    expect(native).toContain("opts: { uncertain?: boolean }");
    expect(native).toContain("uncertain: fall through to cancel without fulfil");
    expect(native).toContain("applyOrphanCaptureIfNeeded");
    expect(native).toContain("refundWebsiteOrphanCapture");
    expect(bookingsRoute).toContain('refundWebsiteOrphan: "canDeleteBooking"');
    expect(detail).toContain("Website / Razorpay");
    expect(detail).toContain("refundWebsiteOrphan");
    expect(detail).toContain("Refund orphan capture");
  });

  it("safe speed: property overlay + Razorpay preload + parallel claim", () => {
    expect(overlay).toContain("confirming_stay");
    expect(hero).toContain("confirming_stay");
    expect(hero).toContain("loadRazorpay()");
    expect(hero).toContain("Promise.all([");
    expect(hero).toContain('action: "claim"');
  });
});
