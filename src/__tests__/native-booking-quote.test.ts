import { describe, expect, it } from "vitest";
import { buildNativeBookingQuote, calculateNativeCancellationRefund } from "@/lib/nativeBookingQuote";
import { DEFAULT_WEBSITE_BOOKING_SETTINGS } from "@/lib/websiteBookingSettings";

const request = () => ({ checkinDate: "2026-12-01", checkoutDate: "2026-12-03", policyVersion: "published-test-v1",
  policy: { ...DEFAULT_WEBSITE_BOOKING_SETTINGS }, taxBasisPoints: 500, paymentChoice: "advance" as const,
  units: [{ key: "unit-A", nightlyRates: [{ date: "2026-12-01", rupees: 1001 }, { date: "2026-12-02", rupees: 2002 }] }],
});
const cancellation = () => ({ checkinDate: "2026-12-01", policy: { ...DEFAULT_WEBSITE_BOOKING_SETTINGS },
  nowEpochMs: Date.parse("2026-11-29T12:00:00+05:30"), lifecycle: "received" as const, reason: "guest_cancelled" as const,
  capturedPaise: 10000, processedRefundPaise: 0, reservedRefundPaise: 0,
});
describe("Native quote and refund calculators — no gateway or booking mutation", () => {
  it("sums actual unit/night rates then rounds tax and advance according to PMS convention", () => {
    const quote = buildNativeBookingQuote(request());
    expect(quote).toMatchObject({ beforeTaxRupees: 3003, taxRupees: 150, totalRupees: 3153, dueNowPaise: 157700,
      dueAtPropertyPaise: 157600, totalPaise: 315300, nativeCheckoutReady: false, currency: "INR" });
  });
  it("retains standard-rate evidence and computes direct-booking savings", () => {
    const input = request();
    input.policy.directBookingDiscountPercent = 10;
    expect(buildNativeBookingQuote({ ...input, units: [{ ...input.units[0], standardNightlyRates: [
      { date: "2026-12-01", rupees: 1112 }, { date: "2026-12-02", rupees: 2224 },
    ] }] })).toMatchObject({ standardBeforeTaxRupees: 3336, beforeTaxRupees: 3003, savingsRupees: 333 });
  });
  it("copies accepted policy and rates rather than retaining mutable settings references", () => {
    const input = request(), quote = buildNativeBookingQuote(input);
    input.policy.advancePercent = 100; input.policy.policyText = "changed"; input.units[0].nightlyRates[0].rupees = 1;
    expect(quote.policy.advancePercent).toBe(50); expect(quote.policy.policyText).toBe("");
    expect(quote.units[0].nightlyRates[0].rupees).toBe(1001);
  });
  it.each(["full", "property"] as const)("supports explicitly offered %s choice", (paymentChoice) => {
    const quote = buildNativeBookingQuote({ ...request(), paymentChoice });
    expect(quote.dueNowPaise).toBe(paymentChoice === "full" ? quote.totalPaise : 0);
    expect(quote.dueNowPaise + quote.dueAtPropertyPaise).toBe(quote.totalPaise);
  });
  it("rejects payment choices disabled by the accepted policy, including zero advance", () => {
    const input = request();
    expect(() => buildNativeBookingQuote({ ...input, paymentChoice: "full", policy: { ...input.policy, allowFullPayment: false } })).toThrow("not offered");
    expect(() => buildNativeBookingQuote({ ...input, paymentChoice: "property", policy: { ...input.policy, allowPayAtProperty: false } })).toThrow("not offered");
    expect(() => buildNativeBookingQuote({ ...input, policy: { ...input.policy, advancePercent: 0 } })).toThrow("Zero advance");
  });
  it("rejects duplicate/missing/extraneous nights and duplicate units", () => {
    const input = request();
    for (const nightlyRates of [[input.units[0].nightlyRates[0]], [input.units[0].nightlyRates[0], input.units[0].nightlyRates[0]],
      [input.units[0].nightlyRates[0], { date: "2026-12-03", rupees: 1 }]]) {
      expect(() => buildNativeBookingQuote({ ...input, units: [{ key: "A", nightlyRates }] })).toThrow("exactly one server rate");
    }
    expect(() => buildNativeBookingQuote({ ...input, units: [input.units[0], input.units[0]] })).toThrow("Duplicate quote unit");
  });
  it.each([-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])("rejects invalid rate %s", (rupees) => {
    const input = request(); input.units[0].nightlyRates[0].rupees = rupees;
    expect(() => buildNativeBookingQuote(input)).toThrow();
  });
  it("rejects zero totals, invalid dates, fractional tax and paise overflow", () => {
    const input = request();
    expect(() => buildNativeBookingQuote({ ...input, checkinDate: "2026-02-30" })).toThrow();
    expect(() => buildNativeBookingQuote({ ...input, taxBasisPoints: 500.1 })).toThrow();
    input.units[0].nightlyRates.forEach((r) => { r.rupees = 0; }); expect(() => buildNativeBookingQuote(input)).toThrow("positive total");
    input.units[0].nightlyRates[0].rupees = Number.MAX_SAFE_INTEGER; expect(() => buildNativeBookingQuote(input)).toThrow("integer range");
  });
  it("conserves money for all 1–100 advance percentages and odd/even totals", () => {
    for (let percent = 1; percent <= 100; percent++) for (let amount = 1; amount <= 101; amount++) {
      const input = request(); input.units[0].nightlyRates.forEach((r) => { r.rupees = amount; }); input.policy.advancePercent = percent;
      const quote = buildNativeBookingQuote(input);
      expect(quote.dueNowPaise + quote.dueAtPropertyPaise).toBe(quote.totalPaise);
      expect(quote.dueNowPaise).toBe(Math.ceil(quote.totalRupees * percent / 100) * 100);
      expect(quote.dueNowPaise).toBeLessThanOrEqual(quote.totalPaise);
    }
  });
  it("uses the exact 12:00 IST deadline, including boundary eligibility", () => {
    const input = cancellation(), result = calculateNativeCancellationRefund(input);
    expect(result.deadlineEpochMs).toBe(input.nowEpochMs); expect(result.refundPaise).toBe(10000);
    expect(calculateNativeCancellationRefund({ ...input, nowEpochMs: input.nowEpochMs + 1 }).refundPaise).toBe(0);
  });
  it("reserves pending/unknown refunds and computes percentage against original capture", () => {
    const input = cancellation(); input.policy.cancellationRefundPercent = 50;
    expect(calculateNativeCancellationRefund({ ...input, processedRefundPaise: 2000, reservedRefundPaise: 1000 }).refundPaise).toBe(2000);
    expect(calculateNativeCancellationRefund({ ...input, processedRefundPaise: 5000 }).refundPaise).toBe(0);
    expect(calculateNativeCancellationRefund({ ...input, reservedRefundPaise: 5000 }).refundPaise).toBe(0);
  });
  it("returns full unclaimed capture on inability to fulfil even after the guest deadline", () => {
    const input = cancellation(); input.policy.cancellationRefundPercent = 0;
    expect(calculateNativeCancellationRefund({ ...input, reason: "cannot_fulfil", nowEpochMs: input.nowEpochMs + 1,
      processedRefundPaise: 1234, reservedRefundPaise: 2345 }).refundPaise).toBe(6421);
  });
  it.each(["checked_in", "checked_out"] as const)("requires authorized staff handling for %s", (lifecycle) => {
    expect(() => calculateNativeCancellationRefund({ ...cancellation(), lifecycle })).toThrow("staff workflow");
  });
  it("fails closed on overclaimed/invalid captured funds", () => {
    expect(() => calculateNativeCancellationRefund({ ...cancellation(), processedRefundPaise: 6000, reservedRefundPaise: 4001 })).toThrow("manual review");
    expect(() => calculateNativeCancellationRefund({ ...cancellation(), capturedPaise: -1 })).toThrow();
  });
  it("never exceeds original capture or reclaims already processed/reserved refunds", () => {
    for (let percent = 0; percent <= 100; percent++) for (let processed = 0; processed <= 17; processed++) {
      const input = cancellation(); input.policy.cancellationRefundPercent = percent;
      const result = calculateNativeCancellationRefund({ ...input, capturedPaise: 19, processedRefundPaise: processed, reservedRefundPaise: 2 });
      expect(result.refundPaise + processed + 2).toBeLessThanOrEqual(19);
      expect(result.refundPaise).toBe(Math.max(0, Math.floor(19 * percent / 100) - processed - 2));
    }
  });
});
