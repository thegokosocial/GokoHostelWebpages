import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { normalizePhone } from "@/lib/phoneUtils";

const route = readFileSync("src/app/api/admin/bookings/route.ts", "utf8");
const queries = readFileSync("src/db/queries.ts", "utf8");
const panel = readFileSync("src/components/admin/booking-dashboard/BookingDetailPanel.tsx", "utf8");
const migration = readFileSync("migrations/0073_booking_contact_methods.sql", "utf8");

describe("booking contact methods", () => {
  it("normalizes Indian phone variants to one duplicate key", () => {
    expect(normalizePhone("+91 98336 24363")).toBe("9833624363");
    expect(normalizePhone("9833624363")).toBe("9833624363");
  });

  it("keeps contact writes behind the dedicated action and permission", () => {
    expect(route).toContain('saveBookingContacts: "canManageBookingContacts"');
    expect(route).toContain('action === "saveBookingContacts"');
    expect(queries).toContain("PMS contacts cannot be edited");
    expect(queries).toContain("Maximum 5 ${type}s allowed");
    expect(queries).toContain("Duplicate contact values are not allowed");
  });

  it("uses D1 batch writes instead of BEGIN for the save path", () => {
    const savePath = queries.match(/export async function saveBookingContactMethods[\s\S]*?\n}\n\nexport async function updateBookingStatus/)?.[0] || "";
    expect(savePath).toContain('typeof db.batch === "function"');
    expect(savePath).toContain("await db.batch(writes)");
    expect(savePath).toContain("await db.transaction(async (tx: any)");
    expect(savePath).not.toMatch(/return db\.transaction\(async \(tx\)/);
  });

  it("renders per-number actions and section-level save/cancel editing", () => {
    expect(panel).toContain("Edit guest contacts");
    expect(panel).toContain("saveBookingContacts");
    expect(panel).toContain("Send WhatsApp message");
    expect(panel).toContain("mailto:");
    expect(panel).toContain("Cancel");
  });

  it("backfills both phone and email values and includes sync metadata", () => {
    expect(migration).toContain("INSERT INTO booking_contact_methods");
    expect(migration).toContain("FROM bookings");
    expect(migration).toContain("sync_id");
    expect(migration).toContain("source IN ('channel_manager', 'email')");
  });
});
