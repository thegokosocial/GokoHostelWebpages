import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SQLite from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { guestBookingLookup, lookupSchema } from "@/lib/guestBookingLookup";

const mocks = vi.hoisted(() => ({ db: null as any }));
vi.mock("@/db", () => ({ getDb: () => mocks.db }));

let sqlite: SQLite.Database;
const request = { reference: "EXT-42", lastName: "Lovelace" };

beforeEach(() => {
  sqlite = new SQLite(":memory:");
  sqlite.exec(`CREATE TABLE bookings(
    id INTEGER PRIMARY KEY, goko_booking_id TEXT, booking_ref TEXT, cm_booking_id TEXT, guest_name TEXT,
    checkin_date TEXT, checkout_date TEXT, room_type TEXT, deleted_at TEXT
  );
  INSERT INTO bookings VALUES(1, 'GOKO-42', 'EXT-42', 'CM-42', 'Ada Lovelace', '2026-10-01', '2026-10-03', 'Mixed', NULL);`);
  mocks.db = drizzle(sqlite);
});
afterEach(() => sqlite.close());

describe("Low-trust guest booking lookup", () => {
  it("returns only a minimal snapshot for each stored reference", async () => {
    for (const reference of ["GOKO-42", "EXT-42", "CM-42"]) {
      await expect(guestBookingLookup({ reference, lastName: "  LOVELACE " })).resolves.toEqual({ booking: {
        reference: "GOKO-42", checkinDate: "2026-10-01", checkoutDate: "2026-10-03", roomType: "Mixed",
      } });
    }
  });

  it("supports single-word guest names but refuses unknown guest placeholders", async () => {
    sqlite.exec("UPDATE bookings SET guest_name='Madonna'");
    await expect(guestBookingLookup({ reference: "EXT-42", lastName: "madonna" })).resolves.toHaveProperty("booking");
    sqlite.exec("UPDATE bookings SET guest_name='Unknown Guest'");
    await expect(guestBookingLookup(request)).resolves.not.toHaveProperty("booking");
  });

  it("does not disclose missing, deleted, duplicate, or wrong-name bookings", async () => {
    for (const change of [{ lastName: "Byron" }, { reference: "MISSING" }]) {
      const result = await guestBookingLookup({ ...request, ...change });
      expect(result).toEqual({ message: expect.any(String) });
    }
    sqlite.exec("UPDATE bookings SET deleted_at='deleted'");
    await expect(guestBookingLookup(request)).resolves.toEqual({ message: expect.any(String) });
    sqlite.exec("UPDATE bookings SET deleted_at=NULL; INSERT INTO bookings VALUES(2, 'OTHER', 'OTHER-42', 'CM-42', 'Ada Lovelace', '2026-10-01', '2026-10-03', 'Mixed', NULL)");
    await expect(guestBookingLookup({ reference: "CM-42", lastName: "Lovelace" })).resolves.toEqual({ message: expect.any(String) });
  });

  it("rejects invalid request shapes", () => {
    expect(lookupSchema.safeParse({ ...request, email: "ada@example.com" }).success).toBe(false);
    expect(lookupSchema.safeParse({ reference: "<script>", lastName: "Lovelace" }).success).toBe(false);
    expect(lookupSchema.safeParse({ reference: "EXT-42", lastName: "" }).success).toBe(false);
  });
});
