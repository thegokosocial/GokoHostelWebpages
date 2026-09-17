import { z } from "zod";
import { stayNights } from "@/lib/inventoryAvailability";
import { websiteBookingSettingsSchema } from "@/lib/websiteBookingSettings";

const calendarDate = z.string().regex(/^20\d{2}-\d{2}-\d{2}$/).refine((value) => {
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, "Invalid calendar date");
const money = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const quoteInput = z.object({
  checkinDate: calendarDate, checkoutDate: calendarDate,
  policyVersion: z.string().trim().min(1).max(128), policy: websiteBookingSettingsSchema,
  taxBasisPoints: z.number().int().min(0).max(10000),
  paymentChoice: z.enum(["advance", "full", "property"]),
  units: z.array(z.object({
    key: z.string().trim().min(1).max(128),
    nightlyRates: z.array(z.object({ date: calendarDate, rupees: money }).strict()).min(1).max(30),
  }).strict()).min(1).max(4),
}).strict().refine((value) => value.checkoutDate > value.checkinDate &&
  (Date.parse(value.checkoutDate) - Date.parse(value.checkinDate)) / 86400000 <= 30, "Stay must be 1–30 nights");

function safeMoney(value: bigint) {
  if (value < BigInt(0) || value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Money amount exceeds supported integer range");
  return Number(value);
}

/** Internal calculator only: rates/published policy must come from the server, never a guest payload. */
export function buildNativeBookingQuote(input: z.input<typeof quoteInput>) {
  const parsed = quoteInput.parse(input), nights = stayNights(parsed.checkinDate, parsed.checkoutDate);
  if (new Set(parsed.units.map((unit) => unit.key)).size !== parsed.units.length) throw new Error("Duplicate quote unit");
  const units = parsed.units.map((unit) => {
    const rates = new Map(unit.nightlyRates.map((rate) => [rate.date, rate.rupees]));
    if (rates.size !== unit.nightlyRates.length || rates.size !== nights.length || nights.some((night) => !rates.has(night))) {
      throw new Error("Each selected unit requires exactly one server rate for every occupied night");
    }
    return { key: unit.key, nightlyRates: nights.map((date) => ({ date, rupees: rates.get(date)! })) };
  }).sort((a, b) => a.key.localeCompare(b.key));
  const beforeTax = units.reduce((sum, unit) => sum + unit.nightlyRates.reduce((subtotal, rate) => subtotal + BigInt(rate.rupees), BigInt(0)), BigInt(0));
  // Existing PMS convention: tax rounded once to whole rupees; deposit rounded upwards to whole rupees.
  const tax = (beforeTax * BigInt(parsed.taxBasisPoints) + BigInt(5000)) / BigInt(10000), total = beforeTax + tax;
  if (total === BigInt(0)) throw new Error("A booking quote must have a positive total");
  if (parsed.paymentChoice === "full" && !parsed.policy.allowFullPayment) throw new Error("Full payment is not offered");
  if (parsed.paymentChoice === "property" && !parsed.policy.allowPayAtProperty) throw new Error("Pay at property is not offered");
  if (parsed.paymentChoice === "advance" && parsed.policy.advancePercent === 0) throw new Error("Zero advance requires an explicitly offered property payment choice");
  const dueNow = parsed.paymentChoice === "property" ? BigInt(0) : parsed.paymentChoice === "full" ? total
    : (total * BigInt(parsed.policy.advancePercent) + BigInt(99)) / BigInt(100);
  return { ...parsed, units, currency: "INR" as const, nativeCheckoutReady: false as const,
    beforeTaxRupees: safeMoney(beforeTax), taxRupees: safeMoney(tax), totalRupees: safeMoney(total),
    dueNowPaise: safeMoney(dueNow * BigInt(100)), dueAtPropertyPaise: safeMoney((total - dueNow) * BigInt(100)),
    totalPaise: safeMoney(total * BigInt(100)),
  };
}

const cancellationInput = z.object({
  checkinDate: calendarDate, policy: websiteBookingSettingsSchema,
  nowEpochMs: z.number().int().min(0).max(8640000000000000),
  lifecycle: z.enum(["provisional", "received", "checked_in", "checked_out"]),
  reason: z.enum(["guest_cancelled", "cannot_fulfil"]),
  capturedPaise: money, processedRefundPaise: money, reservedRefundPaise: money,
}).strict();

/** Eligibility/amount only. Pending AND unknown refund claims must be included in reservedRefundPaise. */
export function calculateNativeCancellationRefund(input: z.input<typeof cancellationInput>) {
  const parsed = cancellationInput.parse(input);
  if (parsed.lifecycle === "checked_in" || parsed.lifecycle === "checked_out") throw new Error("In-house/completed stays require the authorized staff workflow");
  const captured = BigInt(parsed.capturedPaise), claimed = BigInt(parsed.processedRefundPaise) + BigInt(parsed.reservedRefundPaise);
  if (claimed > captured) throw new Error("Refund claims exceed verified captured funds; manual review required");
  const deadlineEpochMs = Date.parse(`${parsed.checkinDate}T12:00:00+05:30`) - parsed.policy.cancellationDeadlineHours * 3600000;
  const eligible = parsed.reason === "cannot_fulfil" || parsed.nowEpochMs <= deadlineEpochMs;
  // Target is based on original captured funds, not repeatedly on the remaining balance.
  const target = !eligible ? BigInt(0) : parsed.reason === "cannot_fulfil" ? captured
    : captured * BigInt(parsed.policy.cancellationRefundPercent) / BigInt(100);
  const available = captured - claimed, desired = target > claimed ? target - claimed : BigInt(0);
  return { eligible, deadlineEpochMs, refundPaise: safeMoney(desired < available ? desired : available),
    unclaimedCapturedPaise: safeMoney(available), nativeCheckoutReady: false as const };
}
