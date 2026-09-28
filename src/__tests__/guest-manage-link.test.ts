import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SQLite from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import {
  buildGuestManageUrl,
  manageLinkExpiryUnix,
  ManageLinkError,
  openGuestManageLink,
  signGuestManageMagic,
  verifyGuestManageMagic,
} from "@/lib/guestManageLink";

const mocks = vi.hoisted(() => ({
  db: null as ReturnType<typeof drizzle> | null,
  getGuestBookingStatus: vi.fn(),
  pi: false,
}));

vi.mock("@/db", () => ({ getDb: () => mocks.db }));
vi.mock("@/lib/nativeGuestCheckout", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/nativeGuestCheckout")>();
  return {
    ...actual,
    getGuestBookingStatus: mocks.getGuestBookingStatus,
  };
});
vi.mock("@/lib/runtime", () => ({ isPiRuntime: () => mocks.pi }));

import { POST as openManageLinkPost } from "@/app/api/guest-booking/open-manage-link/route";

let sqlite: SQLite.Database;

function seedDb() {
  if (sqlite) sqlite.close();
  sqlite = new SQLite(":memory:");
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(`CREATE TABLE bookings(
    id INTEGER PRIMARY KEY, email TEXT, goko_booking_id TEXT, booking_ref TEXT, deleted_at TEXT,
    guest_name TEXT, checkin_date TEXT, checkout_date TEXT, room_type TEXT, persons INTEGER,
    status TEXT, payment_status TEXT, amount_total INTEGER, amount_paid INTEGER, amount_refunded INTEGER
  );
  INSERT INTO bookings VALUES(1,'ada@example.com','GOKO-42','EXT-42',NULL,'Ada','2026-10-01','2026-10-03',
    'Mixed',2,'received','paid',2000,2000,0);`);
  sqlite.exec(`CREATE TABLE native_booking_checkouts (
    id TEXT PRIMARY KEY, booking_id INTEGER, guest_access_hash TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  INSERT INTO native_booking_checkouts VALUES('co-1',1,'${"a".repeat(64)}','2026-01-01T00:00:00.000Z');`);
  mocks.db = drizzle(sqlite);
}

beforeEach(() => {
  mocks.pi = false;
  seedDb();
  mocks.getGuestBookingStatus.mockReset();
  mocks.getGuestBookingStatus.mockResolvedValue({
    reference: "GOKO-42", state: "fulfilled", bookingStatus: "received", guestName: "Ada",
    checkinDate: "2026-10-01", checkoutDate: "2026-10-03", amountTotal: 2000, amountPaid: 2000,
  });
  vi.stubEnv("GUEST_BOOKING_LOOKUP_SECRET", "s".repeat(32));
});

afterEach(() => {
  sqlite.close();
  vi.unstubAllEnvs();
});

describe("guest manage magic links", () => {
  it("signs and verifies a compact ?m=exp.sig magic for a reference", async () => {
    const exp = manageLinkExpiryUnix("2026-10-03");
    expect(exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
    const magic = await signGuestManageMagic("goko-42", exp);
    expect(magic).toMatch(/^\d+\.[a-f0-9]{64}$/);
    await expect(verifyGuestManageMagic("GOKO-42", magic)).resolves.toEqual({ expUnix: exp });
  });

  it("rejects tampered, wrong-ref, expired, malformed, and missing-secret magics", async () => {
    const exp = manageLinkExpiryUnix("2026-10-03");
    const magic = await signGuestManageMagic("GOKO-42", exp);
    await expect(verifyGuestManageMagic("OTHER", magic)).rejects.toBeInstanceOf(ManageLinkError);
    await expect(verifyGuestManageMagic("GOKO-42", magic.replace(/.$/, magic.endsWith("a") ? "b" : "a")))
      .rejects.toBeInstanceOf(ManageLinkError);
    await expect(verifyGuestManageMagic("GOKO-42", magic, { nowUnix: exp + 1 }))
      .rejects.toMatchObject({ message: expect.stringContaining("expired") });
    await expect(verifyGuestManageMagic("GOKO-42", "not-a-magic")).rejects.toBeInstanceOf(ManageLinkError);
    await expect(verifyGuestManageMagic("GOKO-42", "")).rejects.toBeInstanceOf(ManageLinkError);
    vi.unstubAllEnvs();
    await expect(signGuestManageMagic("GOKO-42", exp)).rejects.toBeInstanceOf(ManageLinkError);
  });

  it("expiry uses checkout+7 days, or today+90 when checkout is missing", () => {
    const withStay = manageLinkExpiryUnix("2026-10-03", Date.parse("2026-01-01T00:00:00Z"));
    const noStay = manageLinkExpiryUnix("", Date.parse("2026-01-01T00:00:00Z"));
    expect(withStay).toBe(Math.floor(Date.parse("2026-10-10T23:59:59+05:30") / 1000));
    expect(noStay).toBe(Math.floor(Date.parse("2026-04-01T23:59:59+05:30") / 1000));
  });

  it("buildGuestManageUrl embeds a verifiable magic; empty ref falls back to /book", async () => {
    const url = await buildGuestManageUrl("GOKO-42", "2026-10-03");
    expect(url).toMatch(/^https:\/\/www\.gokohostel\.com\/booking\/GOKO-42\?m=\d+\.[a-f0-9]{64}$/);
    const magic = new URL(url).searchParams.get("m")!;
    await expect(verifyGuestManageMagic("GOKO-42", magic)).resolves.toBeTruthy();
    const relative = await buildGuestManageUrl("GOKO-42", "2026-10-03", false);
    expect(relative.startsWith("/booking/GOKO-42?m=")).toBe(true);
    expect(await buildGuestManageUrl("  ", "2026-10-03")).toBe("https://www.gokohostel.com/book");
  });

  it("openGuestManageLink mints a token, updates hash, and returns status", async () => {
    const magic = await signGuestManageMagic("GOKO-42", manageLinkExpiryUnix("2026-10-03"));
    const result = await openGuestManageLink("GOKO-42", magic) as {
      guestAccessToken: string; reference: string; guestName: string;
    };
    expect(result.guestAccessToken).toMatch(/^[a-f0-9]{64}$/);
    expect(result.reference).toBe("GOKO-42");
    expect(result.guestName).toBe("Ada");
    expect(mocks.getGuestBookingStatus).toHaveBeenCalledWith("GOKO-42", result.guestAccessToken);
    const row = sqlite.prepare("SELECT guest_access_hash FROM native_booking_checkouts WHERE id='co-1'").get() as {
      guest_access_hash: string;
    };
    expect(row.guest_access_hash).not.toBe("a".repeat(64));
    expect(row.guest_access_hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("openGuestManageLink accepts booking_ref aliases", async () => {
    const magic = await signGuestManageMagic("EXT-42", manageLinkExpiryUnix("2026-10-03"));
    const result = await openGuestManageLink("ext-42", magic) as { guestAccessToken: string };
    expect(result.guestAccessToken).toMatch(/^[a-f0-9]{64}$/);
    expect(mocks.getGuestBookingStatus).toHaveBeenCalledWith("GOKO-42", result.guestAccessToken);
  });

  it("openGuestManageLink rejects missing checkout, deleted, and unknown bookings", async () => {
    const magic = await signGuestManageMagic("GOKO-42", manageLinkExpiryUnix("2026-10-03"));
    sqlite.exec("DELETE FROM native_booking_checkouts");
    await expect(openGuestManageLink("GOKO-42", magic)).rejects.toBeInstanceOf(ManageLinkError);
    expect(mocks.getGuestBookingStatus).not.toHaveBeenCalled();

    seedDb();
    sqlite.exec("UPDATE bookings SET deleted_at='deleted'");
    await expect(openGuestManageLink("GOKO-42", magic)).rejects.toBeInstanceOf(ManageLinkError);

    const missing = await signGuestManageMagic("MISSING", manageLinkExpiryUnix("2026-10-03"));
    await expect(openGuestManageLink("MISSING", missing)).rejects.toBeInstanceOf(ManageLinkError);
  });
});

describe("POST /api/guest-booking/open-manage-link", () => {
  const post = (body: string, origin?: string) => new NextRequest(
    "https://www.gokohostel.com/api/guest-booking/open-manage-link",
    { method: "POST", body, headers: { "content-type": "application/json", ...(origin ? { origin } : {}) } },
  );

  it("returns status + token for a valid magic link", async () => {
    const magic = await signGuestManageMagic("GOKO-42", manageLinkExpiryUnix("2026-10-03"));
    const res = await openManageLinkPost(post(
      JSON.stringify({ reference: "GOKO-42", magic }),
      "https://www.gokohostel.com",
    ));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    const body = await res.json() as { guestAccessToken: string; reference: string };
    expect(body.guestAccessToken).toMatch(/^[a-f0-9]{64}$/);
    expect(body.reference).toBe("GOKO-42");
  });

  it("blocks Pi and cross-origin, rejects bad bodies, and maps invalid magic to 401", async () => {
    mocks.pi = true;
    expect((await openManageLinkPost(post("{}"))).status).toBe(403);
    mocks.pi = false;

    expect((await openManageLinkPost(post("{}", "https://evil.example"))).status).toBe(403);
    expect((await openManageLinkPost(post("not-json"))).status).toBe(400);
    expect((await openManageLinkPost(post(JSON.stringify({ reference: "GOKO-42" })))).status).toBe(400);

    const denied = await openManageLinkPost(post(JSON.stringify({
      reference: "GOKO-42",
      magic: `${manageLinkExpiryUnix("2026-10-03")}.${"c".repeat(64)}`,
    })));
    expect(denied.status).toBe(401);
    expect(await denied.json()).toMatchObject({ error: expect.stringContaining("Find my booking") });
  });
});

describe("manage link wiring contracts", () => {
  it("confirmation email builds a signed manage URL", () => {
    const email = readFileSync("src/lib/email.ts", "utf8");
    expect(email).toContain("buildGuestManageUrl");
    expect(email).not.toContain("const manageUrl = `${site.url}/booking/${encodeURIComponent(input.reference)}`");
  });

  it("confirmation page prefers emailed ?m= magic before sessionStorage", () => {
    const page = readFileSync("src/app/(marketing)/booking/[reference]/page.tsx", "utf8");
    expect(page).toContain("/api/guest-booking/open-manage-link");
    expect(page).toContain('.get("m")');
    expect(page).toContain("history.replaceState");
    expect(page).toContain("Find my booking on /book");
  });

  it("placeholder label documents direct open", () => {
    const templates = readFileSync("src/lib/bookingEmailTemplates.ts", "utf8");
    expect(templates).toContain("opens details directly");
  });
});
