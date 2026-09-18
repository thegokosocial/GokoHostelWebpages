import { describe, expect, it } from "vitest";
import {
  brandingFromSettings,
  formatGstRateLabel,
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
