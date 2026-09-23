import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const foodOrders = readFileSync("src/app/api/admin/food-orders/route.ts", "utf8");

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

});
