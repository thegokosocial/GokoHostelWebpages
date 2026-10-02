import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const sync = readFileSync("src/lib/syncEngine.ts", "utf8");
const reseed = readFileSync("src/app/api/sync/route.ts", "utf8");
const ui = readFileSync("src/components/admin/AdminPayableBills.tsx", "utf8");

describe("payable bills sync and mobile wiring", () => {
  it("syncs the parent before expenses and remaps every payable-bill foreign key", () => {
    expect(sync).toMatch(/"payable_bills", "expenses"/);
    expect(sync).toContain('payableBillId: "payable_bills"');
    expect(sync).toContain('payable_bill_adjustments: { payableBillId: "payable_bills" }');
    expect(sync).toContain('payable_bill_notes: { payableBillId: "payable_bills" }');
    expect(reseed).toMatch(/"expenses", "payable_bill_adjustments", "payable_bill_notes", "payable_bills"/);
  });

  it("keeps the mobile payment workflow available with conditional online account input and receipt upload", () => {
    expect(ui).toContain('Make payment');
    expect(ui).toContain('payment.paymentMethod === "online"');
    expect(ui).toContain('Payment receipt (optional)');
    expect(ui).toContain('overflow-y-auto');
    expect(ui).toContain('Payment note *');
    expect(ui).toContain('Total ₹{(selected.total / 100).toFixed(2)}');
    expect(ui).toContain('New total (₹)');
    expect(ui).toContain('No files selected');
    expect(ui).toContain('Add invoice files');
    expect(ui).not.toContain('prompt("Add a note")');
  });
});
