import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const route = readFileSync("src/app/api/admin/expenses/route.ts", "utf8");
const activity = readFileSync("src/components/admin/AccountActivity.tsx", "utf8");
const foodPayments = readFileSync("src/app/api/admin/food-orders/route.ts", "utf8");

describe("account activity provenance", () => {
  it("returns the authenticated creator for income, receipts, expenses, and virtual ledger rows", () => {
    expect(route).toContain("COALESCE(created_by, '') AS addedBy");
    expect(route).toContain("COALESCE(gr.created_by, '') AS addedBy");
    expect(route).toContain('addedBy: row.createdBy || "System"');
    expect(route).toContain("gr.source_type = 'food_order'");
    expect(route).toContain("fo.order_number");
  });

  it("shows who added each entry on desktop and mobile and does not trust a client-supplied food payer name", () => {
    expect(activity).toContain('"Added by"');
    expect(activity).toContain("Added by {row.addedBy || \"System\"}");
    expect(foodPayments).toContain("paidBy: actorName");
    expect(foodPayments).toContain("createdBy: actorName");
    expect(foodPayments).not.toContain("paidBy || actorName");
  });
});
