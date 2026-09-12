import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("check-in deletion references", () => {
  it("detaches nullable bed and food-order references before deleting the parent", () => {
    const source = readFileSync(resolve(process.cwd(), "src/db/queries.ts"), "utf8");
    const start = source.indexOf("export async function deleteCheckin");
    const end = source.indexOf("export async function getLatestCheckinByContact", start);
    const implementation = source.slice(start, end);

    expect(implementation).toContain("db.update(beds).set({ checkinId: null })");
    expect(implementation).toContain("db.update(foodOrders).set({ checkinId: null })");
    expect(implementation.indexOf("db.delete(checkins)")).toBeGreaterThan(implementation.indexOf("db.update(foodOrders)"));
  });

  it("exposes food-order details for the pre-delete warning", () => {
    const source = readFileSync(resolve(process.cwd(), "src/db/queries.ts"), "utf8");
    const start = source.indexOf("export async function getCheckinDeleteInfo");
    const end = source.indexOf("export async function getFoodOrderHistory", start);
    const implementation = source.slice(start, end);

    expect(implementation).toContain("getGuestAllFoodOrders(checkinId)");
    expect(implementation).toContain("orderNumber: order.orderNumber");
    expect(implementation).toContain("total: order.total");
  });
});
