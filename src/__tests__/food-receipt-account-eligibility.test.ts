import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import {
  isEligibleReceiptAccount,
  RAZORPAY_WEBSITE_PLATFORM_KEY,
} from "@/lib/guestReceipts";

describe("isEligibleReceiptAccount (food Received-in money gate)", () => {
  const bank = { isActive: 1, isVirtual: 0, platformKey: null };
  const razorpayVirtual = {
    isActive: 1,
    isVirtual: 1,
    platformKey: RAZORPAY_WEBSITE_PLATFORM_KEY,
  };
  const otherVirtual = { isActive: 1, isVirtual: 1, platformKey: "booking-com" };
  const inactiveBank = { isActive: 0, isVirtual: 0, platformKey: null };
  const inactiveRazorpay = {
    isActive: 0,
    isVirtual: 1,
    platformKey: RAZORPAY_WEBSITE_PLATFORM_KEY,
  };

  it("allows ordinary active banks for food and room", () => {
    expect(isEligibleReceiptAccount(bank, "food")).toBe(true);
    expect(isEligibleReceiptAccount(bank, "room")).toBe(true);
  });

  it("allows Razorpay Website virtual only for food", () => {
    expect(isEligibleReceiptAccount(razorpayVirtual, "food")).toBe(true);
    expect(isEligibleReceiptAccount(razorpayVirtual, "room")).toBe(false);
  });

  it("rejects other virtuals and inactive accounts", () => {
    expect(isEligibleReceiptAccount(otherVirtual, "food")).toBe(false);
    expect(isEligibleReceiptAccount(otherVirtual, "room")).toBe(false);
    expect(isEligibleReceiptAccount(inactiveBank, "food")).toBe(false);
    expect(isEligibleReceiptAccount(inactiveRazorpay, "food")).toBe(false);
  });

  it("treats boolean-ish active/virtual flags", () => {
    expect(isEligibleReceiptAccount({ isActive: true, isVirtual: false }, "food")).toBe(true);
    expect(isEligibleReceiptAccount({
      isActive: true,
      isVirtual: true,
      platformKey: RAZORPAY_WEBSITE_PLATFORM_KEY,
    }, "food")).toBe(true);
  });
});

describe("food receipt account wiring contracts", () => {
  const guestReceipts = readFileSync("src/lib/guestReceipts.ts", "utf8");
  const accountSettings = readFileSync("src/app/api/admin/account-settings/route.ts", "utf8");
  const platform = readFileSync("src/lib/platformReceivables.ts", "utf8");

  it("resolveReceiptAccount passes kind into requireActiveReceiptAccount", () => {
    expect(guestReceipts).toContain('return requireActiveReceiptAccount(configured, kind)');
    expect(guestReceipts).toContain('RAZORPAY_WEBSITE_PLATFORM_KEY = "razorpay-website"');
  });

  it("getFoodReceiptAccounts ensures Razorpay Website and includes the virtual", () => {
    expect(accountSettings).toContain('ensurePlatformProfile("Razorpay Website")');
    expect(accountSettings).toContain("RAZORPAY_WEBSITE_PLATFORM_KEY");
    expect(accountSettings).toContain("Website / Razorpay");
    expect(accountSettings).toContain("getFoodReceiptAccounts");
  });

  it("saveReceiptDefaults still rejects virtual defaults", () => {
    expect(accountSettings).toMatch(/saveReceiptDefaults:[\s\S]*?isVirtual, 0/);
  });

  it("platform ensure uses the same razorpay-website key", () => {
    expect(platform).toContain("function cleanPlatformKey");
    expect(platform).toContain("isVirtual: 1");
    expect(platform).toContain("platformKey");
  });
});
