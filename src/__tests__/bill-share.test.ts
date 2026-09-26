import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import Database from "better-sqlite3";
import {
  billShareExpiresAt,
  buildBillWhatsAppDraft,
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
    expect(buildBillWhatsAppDraft({ guestPhone: "9876543210", guestName: "Ada", shareUrl })).toEqual({ phone: "919876543210", message: `Hi Ada, here is your Goko food bill:\n${shareUrl}` });
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
    expect(route).toMatch(/requiresGuestSelection/);
    expect(route).toMatch(/walkinNameKey/);
    expect(route).toMatch(/This bill link is no longer valid/);
  });

  it("Order Summary + Combined Bill mint share links through the shared staff launcher", () => {
    const ui = readFileSync("src/components/admin/AdminFoodOrders.tsx", "utf8");
    expect(ui).toMatch(/createBillShareLink/);
    expect(ui).toMatch(/buildBillWhatsAppDraft/);
    expect(ui.match(/prepareWhatsApp\(draft\.phone, draft\.message, "foodOrders"\)/g)).toHaveLength(2);
    expect(ui).toMatch(/function CombinedBill/);
    expect(ui).toMatch(/GuestFoodBillCard/);
    expect(ui).toMatch(/embedQr:\s*false/);
    expect(ui).toMatch(/WhatsApp/);
    expect(ui).toMatch(/guestName: g\.guestName/);
  });

  it("Combined Bill exposes permission-gated pay and discount actions for all preview orders", () => {
    const ui = readFileSync("src/components/admin/AdminFoodOrders.tsx", "utf8");
    const route = readFileSync("src/app/api/admin/food-orders/route.ts", "utf8");
    expect(ui).toContain("canCombinedPay");
    expect(ui).toContain("canCombinedDiscount");
    expect(ui).toContain('action: "markOrderPaid", orderIds: combinedOrderIds');
    expect(ui).toContain("handleCombinedPayment(method, cashReceived, changeGiven, onlineAccountId, receiptId)");
    expect(ui).toContain('action: "applyDiscount", orderIds: combinedApplyOrderIds');
    expect(ui).toContain('action: "removeDiscount", orderIds: combinedRemoveOrderIds');
    expect(ui).toContain("isFoodDiscountRemovable");
    expect(ui).toContain("combinedApplyOrderIds");
    expect(ui).toContain("combinedRemoveOrderIds");
    expect(route).toContain("allocateFoodPayment");
    expect(route).toContain("const operationId = String(receiptId || crypto.randomUUID())");
    expect(route).toContain("receiptId: `${operationId}:food:${allocation.orderId}`");
    expect(route).toContain("await db.transaction");
  });

  it("HTML bill open skips QR data-URL; PDF/print still embed", () => {
    const branding = readFileSync("src/lib/loadBillBranding.ts", "utf8");
    expect(branding).toMatch(/embedQr/);
    expect(branding).toMatch(/embedQr !== false/);
    const ui = readFileSync("src/components/admin/AdminFoodOrders.tsx", "utf8");
    expect(ui).toMatch(/openBillView[\s\S]*embedQr:\s*false/);
    expect(ui).toMatch(/embedQr:\s*true/);
  });

  it("bill-share migrations + schema + Pi skips are Cloudflare-only", () => {
    const sql = readFileSync("migrations/0064_food_bill_share_tokens.sql", "utf8");
    expect(sql).toMatch(/CREATE TABLE food_bill_share_tokens/);
    const schema = readFileSync("src/db/schema.ts", "utf8");
    expect(schema).toMatch(/foodBillShareTokens/);
    const pi = readFileSync("scripts/migrate-pi.ts", "utf8");
    expect(pi).toMatch(/0064_food_bill_share_tokens\.sql/);
    expect(pi).toMatch(/0077_food_bill_walkin_identity\.sql/);
    expect(pi).toMatch(/Cloudflare-only/);
    const identitySql = readFileSync("migrations/0077_food_bill_walkin_identity.sql", "utf8");
    expect(identitySql).toMatch(/ADD COLUMN walkin_name_key/);
    expect(identitySql).toMatch(/WHERE checkin_id IS NULL/);
    expect(identitySql).toMatch(/1970-01-01T00:00:00\.000Z/);
  });

  it("expires legacy walk-in links while preserving scoped hostel links", () => {
    const db = new Database(":memory:");
    db.exec(readFileSync("migrations/0064_food_bill_share_tokens.sql", "utf8"));
    const insert = db.prepare("INSERT INTO food_bill_share_tokens (token, phone, checkin_id, expires_at, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)");
    insert.run("walkin", "1234567890", null, "2099-01-01T00:00:00.000Z", "staff", "2026-09-25T00:00:00.000Z");
    insert.run("hostel", "9876543210", 42, "2099-01-01T00:00:00.000Z", "staff", "2026-09-25T00:00:00.000Z");
    db.exec(readFileSync("migrations/0077_food_bill_walkin_identity.sql", "utf8"));
    expect(db.prepare("SELECT expires_at, walkin_name_key FROM food_bill_share_tokens WHERE token = 'walkin'").get()).toEqual({
      expires_at: "1970-01-01T00:00:00.000Z", walkin_name_key: null,
    });
    expect(db.prepare("SELECT expires_at, walkin_name_key FROM food_bill_share_tokens WHERE token = 'hostel'").get()).toEqual({
      expires_at: "2099-01-01T00:00:00.000Z", walkin_name_key: null,
    });
    db.close();
  });

  it("getCombinedBill backfills guestPhone from checkins when order phone empty", () => {
    const route = readFileSync("src/app/api/admin/food-orders/route.ts", "utf8");
    expect(route).toMatch(/case "getCombinedBill"/);
    expect(route).toMatch(/missingPhoneIds/);
    expect(route).toMatch(/guestPhone = contactById/);
  });

  it("keeps hostel grouping on checkinId and applies name+phone only in walk-in branches", () => {
    const adminRoute = readFileSync("src/app/api/admin/food-orders/route.ts", "utf8");
    const adminUi = readFileSync("src/components/admin/AdminFoodOrders.tsx", "utf8");
    const expenses = readFileSync("src/app/api/admin/expenses/route.ts", "utf8");
    const publicBills = readFileSync("src/app/api/food/bills/route.ts", "utf8");

    expect(adminRoute).toContain('if (order.guestType === "hostel" && order.checkinId)');
    expect(adminRoute).toContain('o.checkinId ? `hostel_${o.checkinId}` : `walkin_${walkinOrderGroupKey(o)}`');
    expect(adminUi).toContain('if (order.guestType === "hostel" && order.checkinId)');
    expect(adminUi).toContain('`hostel_${o.checkinId}`');
    expect(expenses).toContain('order.checkinId\n            ? `checkin:${order.checkinId}`');
    expect(publicBills).toContain('eq(foodOrders.guestType, "walkin")');
    expect(publicBills).toContain('getGuestAllFoodOrders(selectedCheckinId)');
  });
});
