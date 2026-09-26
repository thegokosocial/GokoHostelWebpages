import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const foodOrders = readFileSync("src/app/api/admin/food-orders/route.ts", "utf8");
const otaJournal = readFileSync("src/lib/bookingPaymentJournal.ts", "utf8");
const bookingsRoute = readFileSync("src/app/api/admin/bookings/route.ts", "utf8");

function caseBody(source: string, name: string, nextCase: string) {
  return source.match(new RegExp(`case \\\"${name}\\\"[\\s\\S]*?(?=case \\\"${nextCase}\\\")`))?.[0] || "";
}

describe("D1 transaction regressions", () => {
  it("batches order edits and uses a synchronous Pi callback", () => {
    const body = caseBody(foodOrders, "saveOrderEdits", "voidItem");
    expect(body).toContain('.batch(writes)');
    expect(body).not.toContain('transaction(async');
  });
  it("uses batch for food discount mutations and keeps transaction only as the Pi fallback", () => {
    for (const body of [caseBody(foodOrders, "applyDiscount", "removeDiscount"), caseBody(foodOrders, "removeDiscount", "reassignOrder")]) {
      expect(body).toContain('typeof db.batch === "function"');
      expect(body).toContain("await db.batch(");
      expect(body).toContain("await db.transaction(async (tx: any)");
    }
  });

  it("guards the contact path against D1 BEGIN regressions", () => {
    const queries = readFileSync("src/db/queries.ts", "utf8");
    const body = queries.match(/export async function saveBookingContactMethods[\s\S]*?\n}\n\nexport async function updateBookingStatus/)?.[0] || "";
    expect(body).toContain('typeof db.batch === "function"');
    expect(body).toContain("await db.batch(writes)");
  });

  it("commits OTA payment journal on Cloudflare via db.batch, not Drizzle BEGIN/COMMIT", () => {
    expect(otaJournal).toContain("recordOtaBookingPaymentD1");
    expect(otaJournal).toContain("correctOtaBookingPaymentD1");
    expect(otaJournal).toContain("await db.batch(writes)");
    expect(otaJournal).toContain("CASE WHEN ${casPred} THEN ${finalStatus} ELSE NULL END");
    expect(otaJournal).toContain("recordOtaBookingPaymentPi");
    expect(otaJournal).toContain("correctOtaBookingPaymentPi");
    // Cloudflare entry points must not open interactive async transactions.
    const afterPiRecord = otaJournal.split("return recordOtaBookingPaymentPi")[1] || "";
    const d1Record = afterPiRecord.split("async function correctOtaBookingPayment")[0] || "";
    expect(d1Record).toContain("recordOtaBookingPaymentD1");
    expect(d1Record).not.toContain("db.transaction(async");
    const afterPiCorrect = otaJournal.split("return correctOtaBookingPaymentPi")[1] || "";
    const d1Correct = afterPiCorrect.split("/** better-sqlite3")[0] || "";
    expect(d1Correct).toContain("correctOtaBookingPaymentD1");
    expect(d1Correct).not.toContain("db.transaction(async");
  });

  it("maps only busy/locked/network blips to temporarily-unavailable on bookings", () => {
    const catchBody = bookingsRoute.match(/Booking API error:[\s\S]*?status: 500[\s\S]*?\n  \}\n\}/)?.[0] || "";
    expect(catchBody).toContain("SQLITE_BUSY|SQLITE_LOCKED|network error");
    expect(catchBody).not.toMatch(/databaseError = \/D1\|Failed query\|SQLITE_/);
  });

  it("returns safe structured diagnostics for OTA collection conflicts", () => {
    const body = bookingsRoute.match(/if \(action === "collectOtaBookingPayment"\)[\s\S]*?(?=if \(action === "refundOtaBookingPayment"\))/)?.[0] || "";
    expect(body).toContain('stage = "record OTA booking payment"');
    expect(body).toContain("apiErrorBody({");
    expect(body).toContain('code: error.status === 409 ? "CONFLICT" : "VALIDATION_ERROR"');
    expect(body).toContain('details: error.reason ? { reason: error.reason } : undefined');
    expect(body).toContain('headers: { "x-goko-request-id": requestId }');
  });
});
