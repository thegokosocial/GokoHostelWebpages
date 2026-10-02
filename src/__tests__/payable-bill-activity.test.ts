import { describe, expect, it } from "vitest";
import { payableBillActivity } from "@/lib/payableBillActivity";

describe("payable bill activity", () => {
  it("merges every event newest first and preserves reversed payments and their invoices", () => {
    const events = payableBillActivity({
      notes: [{ id: 2, createdAt: "2026-10-02T10:00:00Z", authorUsername: "staff", body: "Delivered" }],
      adjustments: [{ id: 1, createdAt: "2026-10-02T09:00:00Z", createdBy: "admin", reason: "Extra tiles", amount: 500 }],
      payments: [{ id: 3, createdAt: "2026-10-02T11:00:00Z", createdBy: "cashier", purpose: "Deposit", amount: 100, expenseDate: "2026-10-01", paymentMethod: "cash", accountName: "Cash", deletedAt: "2026-10-03", billImageLink: "https://drive.google.com/file/d/test" }],
    });
    expect(events.map(event => event.kind)).toEqual(["payment", "note", "adjustment"]);
    expect(events[0]).toMatchObject({ reversed: true, actor: "cashier", text: "Deposit", date: "2026-10-01", links: "https://drive.google.com/file/d/test" });
  });
  it("handles empty and legacy histories and orders timestamp ties deterministically", () => {
    expect(payableBillActivity({})).toEqual([]);
    const notes = [2, 10].map(id => ({ id, createdAt: "", authorUsername: "", body: "Legacy" }));
    expect(payableBillActivity({ notes }).map(event => event.key)).toEqual(["note-10", "note-2"]);
    expect(payableBillActivity({ notes: notes.reverse() }).map(event => event.key)).toEqual(["note-10", "note-2"]);
  });
});
