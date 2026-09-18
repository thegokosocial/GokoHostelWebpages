import { describe, expect, it } from "vitest";
import {
  brandingFromSettings,
  formatGstRateLabel,
  mergeBillLineItems,
  parseAccentHex,
  splitGstPaise,
  splitGstRate,
  billPaymentStatusLabel,
  DEFAULT_BILL_BRANDING,
} from "@/lib/foodBillFormat";
import { sanitizeBillPaymentQrUrl } from "@/lib/mediaKeys";

describe("splitGstPaise", () => {
  it("splits even tax evenly", () => {
    expect(splitGstPaise(100)).toEqual({ cgst: 50, sgst: 50 });
  });

  it("gives odd paise to CGST", () => {
    expect(splitGstPaise(101)).toEqual({ cgst: 51, sgst: 50 });
  });

  it("handles zero", () => {
    expect(splitGstPaise(0)).toEqual({ cgst: 0, sgst: 0 });
  });
});

describe("splitGstRate", () => {
  it("halves the tax percent", () => {
    expect(splitGstRate(5)).toEqual({ cgstRate: 2.5, sgstRate: 2.5 });
    expect(splitGstRate(0)).toEqual({ cgstRate: 0, sgstRate: 0 });
  });
});

describe("formatGstRateLabel", () => {
  it("formats integer and half rates", () => {
    expect(formatGstRateLabel(5)).toBe("5");
    expect(formatGstRateLabel(2.5)).toBe("2.5");
  });
});

describe("bill branding helpers", () => {
  it("falls back accent and defaults", () => {
    expect(parseAccentHex("nope")).toBe(DEFAULT_BILL_BRANDING.accent);
    expect(parseAccentHex("#abc")).toBe(DEFAULT_BILL_BRANDING.accent);
    expect(parseAccentHex("#e67e22")).toBe("#E67E22");
    const b = brandingFromSettings({});
    expect(b.hostelName).toBe("Goko Hostel");
    expect(b.location).toBe("Gokarna, Karnataka");
  });

  it("maps payment status labels", () => {
    expect(billPaymentStatusLabel("paid")).toBe("Paid");
    expect(billPaymentStatusLabel("on_tab")).toBe("Open tab");
    expect(billPaymentStatusLabel("pending")).toBe("Pending");
  });
});

describe("sanitizeBillPaymentQrUrl", () => {
  it("allows only bills/ media URLs", () => {
    expect(sanitizeBillPaymentQrUrl("/api/media/bills/2026-01-01-x.png")).toBe("/api/media/bills/2026-01-01-x.png");
    expect(sanitizeBillPaymentQrUrl("/api/media/menu/x.jpg")).toBe("");
    expect(sanitizeBillPaymentQrUrl("https://evil.com/x.png")).toBe("");
  });
});

describe("mergeBillLineItems", () => {
  it("coalesces same name and unit price and skips voided", () => {
    const merged = mergeBillLineItems([
      { itemName: "Chapati", quantity: 2, itemPrice: 1900, lineTotal: 3800 },
      { name: "Chapati", quantity: 3, price: 1900, lineTotal: 5700 },
      { itemName: "Bacardi", quantity: 1, itemPrice: 120000, lineTotal: 120000, status: "voided" },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ itemName: "Chapati", quantity: 5, lineTotal: 9500 });
  });

  it("matches live jayabhargav open-tab coalesce (4 lines → 3)", () => {
    const merged = mergeBillLineItems([
      { name: "Bacard", quantity: 1, price: 20000, lineTotal: 20000 },
      { name: "Bacard", quantity: 1, price: 20000, lineTotal: 20000 },
      { name: "Food Order Outside Split", quantity: 1, price: 16700, lineTotal: 16700 },
      { name: "Food Order Outside Split", quantity: 1, price: 16300, lineTotal: 16300 },
    ]);
    expect(merged).toHaveLength(3);
    expect(merged.find((i) => i.itemName === "Bacard")).toMatchObject({ quantity: 2, lineTotal: 40000 });
    expect(merged.reduce((s, i) => s + i.lineTotal, 0)).toBe(73000);
  });
});
