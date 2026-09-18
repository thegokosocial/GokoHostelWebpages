import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  billShareExpiresAt,
  buildBillWhatsAppHref,
  generateBillShareToken,
  publicBillShareUrl,
  whatsAppPhoneDigits,
} from "@/lib/billShare";
import { actionAllowed } from "@/lib/actionPermissions";

describe("billShare helpers", () => {
  it("mints opaque tokens of fixed length", () => {
    const a = generateBillShareToken();
    const b = generateBillShareToken();
    expect(a).toHaveLength(24);
    expect(b).toHaveLength(24);
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[a-z0-9]+$/);
  });

  it("expires about 7 days from now (ISO)", () => {
    const before = Date.now();
    const expires = billShareExpiresAt(7);
    const after = Date.now();
    const t = Date.parse(expires);
    expect(t).toBeGreaterThan(before + 6.5 * 24 * 60 * 60 * 1000);
    expect(t).toBeLessThan(after + 7.5 * 24 * 60 * 60 * 1000);
  });

  it("builds wa.me href with opaque share URL (no raw phone query)", () => {
    const shareUrl = publicBillShareUrl("https://goko.example", "abc123tokenxyzabcdefghijk");
    expect(shareUrl).toBe("https://goko.example/my-bills?t=abc123tokenxyzabcdefghijk");
    expect(shareUrl).not.toMatch(/phone=/);

    const href = buildBillWhatsAppHref({
      guestPhone: "9876543210",
      guestName: "Ada",
      shareUrl,
    });
    expect(href).toMatch(/^https:\/\/wa\.me\/919876543210\?text=/);
    const text = decodeURIComponent(href!.split("text=")[1]);
    expect(text).toContain("Ada");
    expect(text).toContain(shareUrl);
    expect(text).not.toMatch(/phone=\d/);
  });

  it("rejects non-10-digit India mobiles for WhatsApp", () => {
    expect(whatsAppPhoneDigits("12345")).toBeNull();
    expect(whatsAppPhoneDigits("+91 98765 43210")).toBe("919876543210");
    expect(buildBillWhatsAppHref({ guestPhone: "123", guestName: "X", shareUrl: "https://x" })).toBeNull();
  });
});

describe("createBillShareLink RBAC", () => {
  const gate: ["canGenerateFoodBills", "canMarkPaid", "canViewFoodOrders"] = [
    "canGenerateFoodBills",
    "canMarkPaid",
    "canViewFoodOrders",
  ];

  it("allows staff with any of the OR keys", () => {
    expect(actionAllowed("staff", { canGenerateFoodBills: true }, gate)).toBe("allowed");
    expect(actionAllowed("staff", { canMarkPaid: true }, gate)).toBe("allowed");
    expect(actionAllowed("staff", { canViewFoodOrders: true }, gate)).toBe("allowed");
  });

  it("denies staff without any OR key", () => {
    expect(actionAllowed("staff", { canViewFoodTabs: true }, gate)).toBe("forbidden");
  });
});

describe("mock workflows (source contracts)", () => {
  it("My Bills resolves opaque ?t= without exposing phone in UI chrome", () => {
    const page = readFileSync("src/app/my-bills/page.tsx", "utf8");
    expect(page).toMatch(/searchParams\.get\("t"\)/);
    expect(page).toMatch(/\/api\/food\/bills\?t=/);
    expect(page).toMatch(/Shared bill link/);
    expect(page).toMatch(/viaToken/);
  });

  it("bills API accepts token, hides phone when viaToken", () => {
    const route = readFileSync("src/app/api/food/bills/route.ts", "utf8");
    expect(route).toMatch(/getValidFoodBillShareToken/);
    expect(route).toMatch(/viaToken/);
    expect(route).toMatch(/phone: viaToken \? undefined : normalized/);
  });

  it("Order Summary + Combined Bill mint share links and open WhatsApp", () => {
    const ui = readFileSync("src/components/admin/AdminFoodOrders.tsx", "utf8");
    expect(ui).toMatch(/createBillShareLink/);
    expect(ui).toMatch(/buildBillWhatsAppHref/);
    expect(ui).toMatch(/function CombinedBill/);
    expect(ui).toMatch(/GuestFoodBillCard/);
    expect(ui).toMatch(/embedQr:\s*false/);
    expect(ui).toMatch(/WhatsApp/);
  });

  it("HTML bill open skips QR data-URL; PDF/print still embed", () => {
    const branding = readFileSync("src/lib/loadBillBranding.ts", "utf8");
    expect(branding).toMatch(/embedQr/);
    expect(branding).toMatch(/embedQr !== false/);
    const ui = readFileSync("src/components/admin/AdminFoodOrders.tsx", "utf8");
    expect(ui).toMatch(/openBillView[\s\S]*embedQr:\s*false/);
    expect(ui).toMatch(/embedQr:\s*true/);
  });

  it("migration 0064 + schema + Pi skip are Cloudflare-only", () => {
    const sql = readFileSync("migrations/0064_food_bill_share_tokens.sql", "utf8");
    expect(sql).toMatch(/CREATE TABLE food_bill_share_tokens/);
    const schema = readFileSync("src/db/schema.ts", "utf8");
    expect(schema).toMatch(/foodBillShareTokens/);
    const pi = readFileSync("scripts/migrate-pi.ts", "utf8");
    expect(pi).toMatch(/0064_food_bill_share_tokens\.sql/);
    expect(pi).toMatch(/Cloudflare-only/);
  });

  it("getCombinedBill backfills guestPhone from checkins when order phone empty", () => {
    const route = readFileSync("src/app/api/admin/food-orders/route.ts", "utf8");
    expect(route).toMatch(/case "getCombinedBill"/);
    expect(route).toMatch(/missingPhoneIds/);
    expect(route).toMatch(/guestPhone = contactById/);
  });
});
