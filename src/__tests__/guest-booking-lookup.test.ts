import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import SQLite from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { readFileSync } from "node:fs";
import { guestBookingLookup, LookupCodeError, lookupSchema } from "@/lib/guestBookingLookup";
import { getSyncableTableNames } from "@/lib/syncEngine";
const mocks = vi.hoisted(() => ({ db: null as any, send: vi.fn() }));
vi.mock("@/db", () => ({ getDb: () => mocks.db }));
vi.mock("@/lib/email", () => ({ sendBookingLookupCode: mocks.send }));
let sqlite: SQLite.Database;
const request = { action: "request", reference: "GOKO-42", email: "ada@example.com" };
beforeEach(() => {
  sqlite = new SQLite(":memory:"); sqlite.pragma("foreign_keys = ON");
  sqlite.exec(`CREATE TABLE bookings(id INTEGER PRIMARY KEY, email TEXT, goko_booking_id TEXT, booking_ref TEXT, deleted_at TEXT,
    guest_name TEXT, checkin_date TEXT, checkout_date TEXT, room_type TEXT, persons INTEGER, status TEXT, payment_status TEXT,
    amount_total INTEGER, amount_paid INTEGER, amount_refunded INTEGER);
    INSERT INTO bookings VALUES(1,'ada@example.com','GOKO-42','EXT-42',NULL,'Ada','2026-10-01','2026-10-03','Mixed',2,'received','paid',2000,2000,0);`);
  sqlite.exec(readFileSync("migrations/0061_guest_booking_lookup.sql", "utf8"));
  mocks.db = drizzle(sqlite); mocks.send.mockReset(); mocks.send.mockResolvedValue(undefined);
  vi.stubEnv("GUEST_BOOKING_LOOKUP_SECRET", "s".repeat(32));
});
afterEach(() => { sqlite.close(); vi.unstubAllEnvs(); });
async function issue() {
  const result = await guestBookingLookup(request);
  return { challengeId: (result as { challengeId: string }).challengeId, code: mocks.send.mock.calls[0][1] as string };
}
describe("Private guest booking lookup", () => {
  it("returns details only after email proof and consumes the code once", async () => {
    const issued = await issue();
    expect(mocks.send).toHaveBeenCalledWith("ada@example.com", expect.stringMatching(/^\d{6}$/));
    const result = await guestBookingLookup({ action: "verify", ...issued });
    expect(result).toMatchObject({ booking: { guestName: "Ada", paid: 2000 }, currency: "INR" });
    expect(JSON.stringify(result)).not.toContain("ada@example.com");
    await expect(guestBookingLookup({ action: "verify", ...issued })).rejects.toBeInstanceOf(LookupCodeError);
    expect(getSyncableTableNames()).not.toContain("guest_booking_lookup_challenges");
  });
  it("does not enumerate missing, ambiguous, deleted or wrong-email bookings", async () => {
    for (const change of [{ email: "wrong@example.com" }, { reference: "MISSING" }]) {
      expect(await guestBookingLookup({ ...request, ...change })).toMatchObject({ challengeId: expect.any(String), message: expect.any(String) });
    }
    sqlite.exec("UPDATE bookings SET deleted_at='deleted'"); await guestBookingLookup(request);
    sqlite.exec("UPDATE bookings SET deleted_at=NULL; INSERT INTO bookings SELECT 2,email,goko_booking_id,booking_ref,deleted_at,guest_name,checkin_date,checkout_date,room_type,persons,status,payment_status,amount_total,amount_paid,amount_refunded FROM bookings WHERE id=1");
    await guestBookingLookup(request); expect(mocks.send).not.toHaveBeenCalled();
  });
  it("throttles concurrent requests and reference aliases without returning a stable enumeration signal", async () => {
    const results = await Promise.all(Array.from({ length: 20 }, () => guestBookingLookup(request)));
    await guestBookingLookup({ ...request, reference: "EXT-42" });
    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(new Set(results.map(result => (result as { challengeId: string }).challengeId)).size).toBe(20);
  });
  it("limits guesses to five and expires by database time", async () => {
    const issued = await issue(); const wrong = issued.code === "000000" ? "000001" : "000000";
    for (let i = 0; i < 5; i++) await expect(guestBookingLookup({ action: "verify", challengeId: issued.challengeId, code: wrong })).rejects.toBeInstanceOf(LookupCodeError);
    await expect(guestBookingLookup({ action: "verify", ...issued })).rejects.toBeInstanceOf(LookupCodeError);
    sqlite.exec("UPDATE guest_booking_lookup_challenges SET expires_at=0, attempts=0");
    await expect(guestBookingLookup({ action: "verify", ...issued })).rejects.toBeInstanceOf(LookupCodeError);
    await guestBookingLookup(request); expect(mocks.send).toHaveBeenCalledTimes(2);
  });
  it("allows only one concurrent successful verification", async () => {
    const issued = await issue();
    const results = await Promise.allSettled(Array.from({ length: 20 }, () => guestBookingLookup({ action: "verify", ...issued })));
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
  });
  it("retains throttle on ambiguous email delivery and fails closed without configuration or migration", async () => {
    mocks.send.mockRejectedValueOnce(new Error("unknown delivery"));
    await guestBookingLookup(request); await guestBookingLookup(request); expect(mocks.send).toHaveBeenCalledTimes(1);
    vi.stubEnv("GUEST_BOOKING_LOOKUP_SECRET", ""); await expect(guestBookingLookup(request)).rejects.toThrow();
    vi.stubEnv("GUEST_BOOKING_LOOKUP_SECRET", "s".repeat(32)); sqlite.exec("DROP TABLE guest_booking_lookup_challenges");
    await expect(guestBookingLookup(request)).rejects.toThrow();
  });
  it("rejects unrecognized fields and invalid references/codes", () => {
    expect(lookupSchema.safeParse({ ...request, amount: 1 }).success).toBe(false);
    expect(lookupSchema.safeParse({ ...request, reference: "<script>" }).success).toBe(false);
    expect(lookupSchema.safeParse({ action: "verify", challengeId: crypto.randomUUID(), code: "123" }).success).toBe(false);
  });
});
