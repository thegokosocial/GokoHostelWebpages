/**
 * Guest payment amount spoof matrix (DevTools / API injection).
 * Authoritative amounts must come from server rates/menu/order snapshots — never browser totals.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { z } from "zod";

const bookingCheckout = readFileSync("src/lib/nativeGuestCheckout.ts", "utf8");
const bookingUi = readFileSync("src/components/booking/BookingHeroPanel.tsx", "utf8");
const bookingRoute = readFileSync("src/app/api/guest-booking/checkout/route.ts", "utf8");
const foodQrRoute = readFileSync("src/app/api/food/bills/qr/route.ts", "utf8");
const foodQrLib = readFileSync("src/lib/foodQrPayment.ts", "utf8");
const foodOrderRoute = readFileSync("src/app/api/food/order/route.ts", "utf8");
const razorpayLib = readFileSync("src/lib/razorpay.ts", "utf8");

describe("guest booking amount spoof contracts", () => {
  it("checkout selection schema is strict and has no money fields", () => {
    expect(bookingCheckout).toMatch(/const selectionSchema = z\.object\(\{[\s\S]*?\}\)\.strict\(\)/);
    const schemaBlock = bookingCheckout.slice(
      bookingCheckout.indexOf("const selectionSchema"),
      bookingCheckout.indexOf("const amendSelectionSchema"),
    );
    for (const field of ["amount", "dueNowPaise", "subtotal", "total", "amountPaise", "dueNow"]) {
      expect(schemaBlock).not.toMatch(new RegExp(`\\b${field}\\s*:`));
    }
  });

  it("Pay now posts dates/rooms/guests only — not the sticky estimate", () => {
    expect(bookingUi).toContain("const payload = {");
    expect(bookingUi).toMatch(/rooms:\s*rooms\.filter/);
    expect(bookingUi).toContain("paymentChoice");
    expect(bookingUi).toContain("persons: Number(persons)");
    const payloadStart = bookingUi.indexOf("const payload = {");
    const payloadBlock = bookingUi.slice(payloadStart, bookingUi.indexOf("JSON.stringify(payload)", payloadStart));
    expect(payloadBlock).not.toMatch(/\bamount\b/);
    expect(payloadBlock).not.toMatch(/dueNowPaise|subtotal|totals\.|bookingTotals/);
  });

  it("Razorpay order amount is quote.dueNowPaise; verify rejects evidence mismatch", () => {
    expect(bookingCheckout).toContain("amountPaise: quote.dueNowPaise");
    expect(bookingCheckout).toContain("evidence.amount !== row.dueNowPaise");
    expect(bookingCheckout).toContain("order.amount !== row.dueNowPaise");
    expect(razorpayLib).toContain("amount: input.amountPaise");
    expect(bookingRoute).toContain("prepareGuestCheckout");
  });
});

describe("food payment amount spoof contracts", () => {
  it("guest QR body is strict and never accepts client amount", () => {
    expect(foodQrRoute).toContain("}).strict()");
    expect(foodQrRoute).toContain("ensureActiveFoodQrForOrders");
    expect(foodQrRoute).not.toMatch(/amountPaise.*body|body\.amount|raw\.data\.amount/);
    const schemaBlock = foodQrRoute.slice(
      foodQrRoute.indexOf("const bodySchema"),
      foodQrRoute.indexOf("export async function POST"),
    );
    expect(schemaBlock).not.toMatch(/\bamount\b/);
    expect(schemaBlock).not.toMatch(/duePaise|payment_amount/);
  });

  it("QR create uses snapshot due; capture rejects underpay", () => {
    expect(foodQrLib).toContain("snapshotTotalDuePaise");
    expect(foodQrLib).toContain("amountPaise: totalDuePaise");
    expect(foodQrLib).toContain("evidence.amount < snapshotTotal");
  });

  it("food order prices come from menu DB, not client line price", () => {
    expect(foodOrderRoute).toContain("menuItem.price");
    expect(foodOrderRoute).toContain("itemPrice: menuItem.priceOnRequest === 1 ? 0 : menuItem.price");
    expect(foodOrderRoute).toMatch(/for \(const item of items\)/);
    expect(foodOrderRoute).toContain("item.menuItemId");
    expect(foodOrderRoute).toContain("item.quantity");
    // Client may send price in JSON; handler must not read it for line totals.
    expect(foodOrderRoute).not.toMatch(/item\.price\b|item\.itemPrice\b|item\.lineTotal\b/);
  });

  it("strict Zod rejects injected amount on the guest QR shape", () => {
    const bodySchema = z.object({
      requestKey: z.string().uuid(),
      orderIds: z.array(z.number().int().positive()).min(1).max(50),
      token: z.string().min(8).max(40),
      attemptId: z.string().uuid().optional(),
      action: z.enum(["ensure", "status"]).default("ensure"),
    }).strict();
    const base = {
      requestKey: "11111111-1111-4111-8111-111111111111",
      orderIds: [1],
      token: "share-token-ok",
      action: "ensure" as const,
    };
    expect(bodySchema.safeParse(base).success).toBe(true);
    expect(bodySchema.safeParse({ ...base, amount: 0 }).success).toBe(false);
    expect(bodySchema.safeParse({ ...base, amountPaise: 1 }).success).toBe(false);
    expect(bodySchema.safeParse({ ...base, dueNowPaise: 0 }).success).toBe(false);
  });
});
