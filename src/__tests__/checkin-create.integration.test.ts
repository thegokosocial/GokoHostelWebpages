import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SQLite from "better-sqlite3";
import { readdirSync, readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import { drizzle } from "drizzle-orm/better-sqlite3";
import type { Database } from "@/db";
import * as schema from "@/db/schema";
import { CHECKIN_LOOKUP_DATA_KEYS } from "@/lib/checkinLookup";

const state = vi.hoisted(() => ({
  db: null as Database | null,
  offline: true,
  rateLimitOk: true,
  driveUpload: vi.fn(async (..._args: unknown[]) => "https://drive.example/id"),
  driveFolder: vi.fn(async (..._args: unknown[]) => "folder"),
}));

vi.mock("@/db", () => ({ getDb: () => state.db }));
vi.mock("@/lib/runtime", () => ({
  isOfflineMode: () => state.offline,
  isPiRuntime: () => false,
}));
vi.mock("@/lib/guestBookingRateLimit", () => ({
  guestBookingRateLimit: () => state.rateLimitOk,
  assertGuestOrigin: () => undefined,
}));
vi.mock("@/lib/googleApiFetch", () => ({
  driveUploadFile: (...args: unknown[]) => state.driveUpload(...args),
  driveGetOrCreateFolder: (...args: unknown[]) => state.driveFolder(...args),
  visionAnalyze: vi.fn(),
}));
vi.mock("@/lib/pushNotify", () => ({
  dispatchPush: vi.fn(async () => undefined),
  notificationFirstName: (name: string) => name.split(/\s+/)[0] || name,
}));

import { POST as checkinPOST } from "@/app/api/checkin/route";
import { GET as lookupGET } from "@/app/api/checkin/lookup/route";

const skippedMigrations = new Set([
  "0035_site_cms.sql",
  "0041_splits.sql",
  "0081_split_expense_idempotency.sql",
  "0064_food_bill_share_tokens.sql",
  "0077_food_bill_walkin_identity.sql",
  "0066_gateway_receivables.sql",
  "0068_gateway_settlement_allocations.sql",
  "0079_site_hero_videos.sql",
]);

let sqlite: SQLite.Database;

function uuid(seed: string): string {
  // Valid UUID v4-shaped key accepted by parseCreateIdempotencyKey
  return `aaaaaaaa-aaaa-4aaa-8aaa-${seed.padStart(12, "0").slice(0, 12)}`;
}

function idFile(name = "id.jpg") {
  return new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], name, { type: "image/jpeg" });
}

function buildForm(fields: Record<string, string>, files: { idImages?: File[]; visaImages?: File[] } = {}) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  for (const f of files.idImages || [idFile()]) fd.append("idImages", f);
  for (const f of files.visaImages || []) fd.append("visaImages", f);
  return fd;
}

function indiaFields(over: Record<string, string> = {}) {
  return {
    arrivalDate: "2026-09-27",
    arrivalTime: "14:00",
    name: "Test Guest",
    numberOfPersons: "1",
    contactNumber: "9876543210",
    stayingDays: "2",
    comingFrom: "Bangalore",
    nationality: "India",
    emergencyName: "Friend",
    emergencyPhone: "9000000000",
    idType: "aadhaar",
    bookingPlatform: "Walk-in",
    clientIdValidation: "verified",
    idempotencyKey: uuid("111111111111"),
    ...over,
  };
}

function foreignFields(over: Record<string, string> = {}) {
  return indiaFields({
    name: "Foreign Guest",
    contactNumber: "9123456780",
    nationality: "France",
    idType: "passport",
    idempotencyKey: uuid("222222222222"),
    ...over,
  });
}

function postCheckin(form: FormData) {
  return checkinPOST(
    new NextRequest("http://localhost/api/checkin", {
      method: "POST",
      body: form,
      headers: { "cf-connecting-ip": "203.0.113.10" },
    }),
  );
}

function countCheckins() {
  return (sqlite.prepare("SELECT COUNT(*) AS n FROM checkins").get() as { n: number }).n;
}

beforeEach(() => {
  state.offline = true;
  state.rateLimitOk = true;
  state.driveUpload.mockReset();
  state.driveUpload.mockResolvedValue("https://drive.example/id");
  state.driveFolder.mockReset();
  state.driveFolder.mockImplementation(async (...args: unknown[]) => `folder-${args[1] ?? "month"}`);

  sqlite = new SQLite(":memory:");
  sqlite.pragma("foreign_keys = ON");
  for (const file of readdirSync("migrations").filter((name) => name.endsWith(".sql")).sort()) {
    if (!skippedMigrations.has(file)) sqlite.exec(readFileSync(`migrations/${file}`, "utf8"));
  }
  state.db = drizzle(sqlite, { schema }) as unknown as Database;
});

afterEach(() => {
  state.db = null;
  sqlite.close();
});

describe("self check-in create (disposable SQLite)", () => {
  it("inserts an India guest with expected identity fields", async () => {
    const res = await postCheckin(buildForm(indiaFields()));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    expect(countCheckins()).toBe(1);
    const row = sqlite.prepare(
      "SELECT name, contact, nationality, id_type, id_card_link, status, idempotency_key FROM checkins",
    ).get() as Record<string, string>;
    expect(row).toMatchObject({
      name: "Test Guest",
      contact: "9876543210",
      nationality: "India",
      id_type: "aadhaar",
      id_card_link: "offline-pending",
      status: "active",
      idempotency_key: uuid("111111111111"),
    });
  });

  it("preserves the Goko Hostel Website source without creating a manual booking ID", async () => {
    const res = await postCheckin(buildForm(indiaFields({
      bookingPlatform: "Goko Hostel Website",
      bookingId: "",
      idempotencyKey: uuid("121212121212"),
    })));

    expect(res.status).toBe(200);
    const row = sqlite.prepare("SELECT booking_platform, booking_id FROM checkins").get() as Record<string, string>;
    expect(row).toEqual({ booking_platform: "Goko Hostel Website", booking_id: "" });
  });

  it("inserts foreign + passport + visa and rejects foreign without visa", async () => {
    const ok = await postCheckin(
      buildForm(foreignFields(), { idImages: [idFile("pp.jpg")], visaImages: [idFile("visa.jpg")] }),
    );
    expect(ok.status).toBe(200);
    expect(countCheckins()).toBe(1);
    const row = sqlite.prepare("SELECT nationality, id_type, visa_link FROM checkins").get() as Record<string, string>;
    expect(row).toMatchObject({
      nationality: "France",
      id_type: "passport",
      visa_link: "offline-pending",
    });

    const denied = await postCheckin(
      buildForm(foreignFields({ idempotencyKey: uuid("333333333333"), contactNumber: "9123456781" })),
    );
    expect(denied.status).toBe(400);
    expect(await denied.json()).toMatchObject({
      error: "Visa document is required for non-Indian nationals",
      field: "visaImages",
    });
    expect(countCheckins()).toBe(1);
  });

  it("returns duplicate for the same idempotency key without a second row", async () => {
    const key = uuid("444444444444");
    const first = await postCheckin(buildForm(indiaFields({ idempotencyKey: key, contactNumber: "9000000001" })));
    expect(first.status).toBe(200);
    const second = await postCheckin(buildForm(indiaFields({
      idempotencyKey: key,
      contactNumber: "9000000001",
      name: "Retry Guest",
    })));
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({ success: true, duplicate: true });
    expect(countCheckins()).toBe(1);
  });

  it("parallel double-submit of the same key yields one row", async () => {
    const key = uuid("555555555555");
    const formA = buildForm(indiaFields({ idempotencyKey: key, contactNumber: "9000000002", name: "Race A" }));
    const formB = buildForm(indiaFields({ idempotencyKey: key, contactNumber: "9000000002", name: "Race A" }));
    const [a, b] = await Promise.all([postCheckin(formA), postCheckin(formB)]);
    expect([a.status, b.status].every((s) => s === 200)).toBe(true);
    const bodies = await Promise.all([a.json(), b.json()]);
    expect(bodies.every((body) => body.success === true)).toBe(true);
    expect(bodies.some((body) => body.duplicate === true)).toBe(true);
    expect(countCheckins()).toBe(1);
  });

  it("soft-allows a same visit (name+contact+arrival) without a second active row", async () => {
    const first = await postCheckin(buildForm(indiaFields({
      idempotencyKey: uuid("666666666666"),
      contactNumber: "9000000003",
      name: "Soft Visit",
      arrivalDate: "2026-09-27",
    })));
    expect(first.status).toBe(200);
    const second = await postCheckin(buildForm(indiaFields({
      idempotencyKey: uuid("777777777777"),
      contactNumber: "9000000003",
      name: "Soft Visit",
      arrivalDate: "2026-09-27",
    })));
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({ success: true, duplicate: true });
    expect(countCheckins()).toBe(1);
  });

  it("still inserts when Drive upload throws on the online path", async () => {
    state.offline = false;
    state.driveUpload.mockRejectedValue(new Error("Drive unavailable"));
    process.env.GOOGLE_DRIVE_FOLDER_ID = "root-folder";

    const res = await postCheckin(buildForm(indiaFields({
      idempotencyKey: uuid("888888888888"),
      contactNumber: "9000000004",
      name: "Drive Fail Guest",
      clientIdValidation: "verified",
    })));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    expect(countCheckins()).toBe(1);
    const row = sqlite.prepare("SELECT id_card_link, name FROM checkins").get() as { id_card_link: string; name: string };
    expect(row.name).toBe("Drive Fail Guest");
    expect(row.id_card_link).toBe("Upload failed");
  });

  it("rejects missing or invalid idempotency keys", async () => {
    const missing = await postCheckin(buildForm(indiaFields({ idempotencyKey: "" })));
    // empty string fails parse as required
    expect(missing.status).toBe(400);
    expect(await missing.json()).toMatchObject({ error: "idempotencyKey required" });

    const invalid = await postCheckin(buildForm(indiaFields({ idempotencyKey: "not-a-uuid" })));
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({ error: "idempotencyKey must be a UUID" });
    expect(countCheckins()).toBe(0);
  });

  it("returns 429 when the guest rate limit blocks", async () => {
    state.rateLimitOk = false;
    const res = await postCheckin(buildForm(indiaFields({ idempotencyKey: uuid("999999999999") })));
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "Too many submissions. Please try again later." });
    expect(countCheckins()).toBe(0);
  });
});

describe("GET /api/checkin/lookup", () => {
  it("returns found + checkinLookupData keys for a seeded contact", async () => {
    sqlite.exec(`
      INSERT INTO checkins (
        submitted_at, arrival_date, arrival_time, name, persons, contact, staying_days,
        coming_from, nationality, emergency_name, emergency_phone, id_type, id_card_link,
        visa_link, verified, status, created_month
      ) VALUES (
        '2026-09-27T10:00:00.000Z', '2026-09-27', '10:00', 'Lookup Guest', '1', '9888877777', '2',
        'Mysore', 'India', 'Em', '9111111111', 'aadhaar', 'https://drive/id',
        '', 'yes', 'active', '2026-09'
      );
    `);
    const res = await lookupGET(
      new NextRequest("http://localhost/api/checkin/lookup?phone=9888877777"),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.found).toBe(true);
    expect(Object.keys(body.data).sort()).toEqual([...CHECKIN_LOOKUP_DATA_KEYS].sort());
    expect(body.data).toMatchObject({
      name: "Lookup Guest",
      contactNumber: "9888877777",
      comingFrom: "Mysore",
      nationality: "India",
      idType: "aadhaar",
      idCardLink: "https://drive/id",
    });
  });

  it("returns found:false for short/missing phone and unknown contact", async () => {
    const short = await lookupGET(new NextRequest("http://localhost/api/checkin/lookup?phone=123"));
    expect(await short.json()).toEqual({ found: false });
    const missing = await lookupGET(new NextRequest("http://localhost/api/checkin/lookup"));
    expect(await missing.json()).toEqual({ found: false });
    const unknown = await lookupGET(
      new NextRequest("http://localhost/api/checkin/lookup?phone=9000011111"),
    );
    expect(await unknown.json()).toEqual({ found: false });
  });

  it("returns found:false when the DB throws (no 500 leak)", async () => {
    state.db = null;
    const res = await lookupGET(
      new NextRequest("http://localhost/api/checkin/lookup?phone=9888877777"),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ found: false });
  });
});
