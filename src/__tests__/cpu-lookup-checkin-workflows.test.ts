import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import * as fs from "fs";
import * as path from "path";

const q = vi.hoisted(() => ({
  getActiveCheckins: vi.fn(),
  getAllBeds: vi.fn(),
  getRecentlyCheckedOutGuests: vi.fn(),
  getLatestCheckinByNormalizedPhone: vi.fn(),
  getSetting: vi.fn(),
  addCheckin: vi.fn(),
  incrementStat: vi.fn(),
  getMonthKey: vi.fn(() => "2026-08"),
  addAuditEntry: vi.fn(),
  addSystemLog: vi.fn(),
}));

vi.mock("@/db/queries", () => ({
  getActiveCheckins: q.getActiveCheckins,
  getAllBeds: q.getAllBeds,
  getRecentlyCheckedOutGuests: q.getRecentlyCheckedOutGuests,
  getLatestCheckinByNormalizedPhone: q.getLatestCheckinByNormalizedPhone,
  getSetting: q.getSetting,
  addCheckin: q.addCheckin,
  incrementStat: q.incrementStat,
  getMonthKey: q.getMonthKey,
  addAuditEntry: q.addAuditEntry,
  addSystemLog: q.addSystemLog,
}));

vi.mock("@/lib/googleApiFetch", () => ({
  driveUploadFile: vi.fn(),
  driveGetOrCreateFolder: vi.fn(),
  visionAnalyze: vi.fn(),
}));
vi.mock("@/lib/pushNotify", () => ({ dispatchPush: vi.fn() }));
vi.mock("@/lib/runtime", () => ({ isOfflineMode: () => true }));

import { GET as lookupGET } from "@/app/api/food/lookup/route";
import { POST as checkinPOST } from "@/app/api/checkin/route";
import { foodTaxPercent, parseFoodCheckoutGraceDays } from "@/lib/foodLookup";

const ROOT = path.resolve(__dirname, "../..");

describe("parseFoodCheckoutGraceDays", () => {
  it("keeps 0 and defaults invalid values to 10", () => {
    expect(parseFoodCheckoutGraceDays("0")).toBe(0);
    expect(parseFoodCheckoutGraceDays("10")).toBe(10);
    expect(parseFoodCheckoutGraceDays(null)).toBe(10);
    expect(parseFoodCheckoutGraceDays("")).toBe(10);
    expect(parseFoodCheckoutGraceDays("nope")).toBe(10);
  });
});

describe("foodTaxPercent", () => {
  it("keeps 0% and defaults empty/invalid to 5", () => {
    expect(foodTaxPercent(undefined)).toBe(5);
    expect(foodTaxPercent("")).toBe(5);
    expect(foodTaxPercent("nope")).toBe(5);
    expect(foodTaxPercent("0")).toBe(0);
    expect(foodTaxPercent(0)).toBe(0);
    expect(foodTaxPercent("12")).toBe(12);
  });
});

function lookupReq(phone?: string) {
  const url =
    phone === undefined
      ? "http://localhost/api/food/lookup"
      : `http://localhost/api/food/lookup?phone=${encodeURIComponent(phone)}`;
  return new NextRequest(url);
}

function checkinReq(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return new NextRequest("http://localhost/api/checkin", { method: "POST", body: fd });
}

function checkinReqWithFiles(fields: Record<string, string>, visa = false) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  fd.append("idImages", new File(["passport"], "passport.jpg", { type: "image/jpeg" }));
  if (visa) fd.append("visaImages", new File(["visa"], "visa.jpg", { type: "image/jpeg" }));
  return new NextRequest("http://localhost/api/checkin", { method: "POST", body: fd });
}

describe("GET /api/food/lookup", () => {
  beforeEach(() => {
    for (const fn of Object.values(q)) fn.mockReset();
    q.getMonthKey.mockReturnValue("2026-08");
    q.getLatestCheckinByNormalizedPhone.mockResolvedValue(null);
  });

  it("returns found false for empty or invalid phone without querying", async () => {
    for (const phone of [undefined, "", "12", "abc"]) {
      const res = await lookupGET(lookupReq(phone));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ found: false, guests: [] });
    }
    expect(q.getSetting).not.toHaveBeenCalled();
    expect(q.getActiveCheckins).not.toHaveBeenCalled();
    expect(q.getAllBeds).not.toHaveBeenCalled();
    expect(q.getRecentlyCheckedOutGuests).not.toHaveBeenCalled();
    expect(q.getLatestCheckinByNormalizedPhone).not.toHaveBeenCalled();
  });

  it("matches an active checkin via real buildFoodLookupGuests", async () => {
    q.getSetting.mockResolvedValue("10");
    q.getActiveCheckins.mockResolvedValue([{ id: 1, name: "In House", contact: "+919876543210" }]);
    q.getAllBeds.mockResolvedValue([{ guestContact: "9876543210", dormName: "Palm", bedId: "A1" }]);
    q.getRecentlyCheckedOutGuests.mockResolvedValue([{ id: 2, name: "Left", contact: "9876543210" }]);

    const res = await lookupGET(lookupReq("+91 98765 43210"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      found: true,
      guests: [
        { checkinId: 1, name: "In House", phone: "9876543210", roomInfo: "Palm - Bed A1", checkedOut: false },
        { checkinId: 2, name: "Left", phone: "9876543210", roomInfo: "", checkedOut: true },
      ],
    });
    expect(q.getRecentlyCheckedOutGuests).toHaveBeenCalledWith(10);
    expect(q.getLatestCheckinByNormalizedPhone).not.toHaveBeenCalled();
  });

  it("skips getRecentlyCheckedOutGuests when grace days is 0", async () => {
    q.getSetting.mockResolvedValue("0");
    q.getActiveCheckins.mockResolvedValue([{ id: 1, name: "In House", contact: "9876543210" }]);
    q.getAllBeds.mockResolvedValue([]);
    q.getRecentlyCheckedOutGuests.mockResolvedValue([{ id: 9, name: "Should not appear", contact: "9876543210" }]);

    const res = await lookupGET(lookupReq("9876543210"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      found: true,
      guests: [{ checkinId: 1, name: "In House", phone: "9876543210", roomInfo: "", checkedOut: false }],
    });
    expect(q.getRecentlyCheckedOutGuests).not.toHaveBeenCalled();
  });

  it("defaults grace to 10 for null, blank, and NaN settings", async () => {
    q.getActiveCheckins.mockResolvedValue([]);
    q.getAllBeds.mockResolvedValue([]);
    q.getRecentlyCheckedOutGuests.mockResolvedValue([]);
    for (const value of [null, "", "nope"]) {
      q.getSetting.mockResolvedValue(value);
      await lookupGET(lookupReq("9876543210"));
      expect(q.getRecentlyCheckedOutGuests).toHaveBeenLastCalledWith(10);
    }
  });

  it("returns displayName from a past check-in when no active or grace-period guest matches", async () => {
    q.getSetting.mockResolvedValue("10");
    q.getActiveCheckins.mockResolvedValue([]);
    q.getAllBeds.mockResolvedValue([]);
    q.getRecentlyCheckedOutGuests.mockResolvedValue([]);
    q.getLatestCheckinByNormalizedPhone.mockResolvedValue({ id: 42, name: "Pawan", contact: "9876543210" });

    const res = await lookupGET(lookupReq("9876543210"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      found: false,
      guests: [],
      displayName: "Pawan",
    });
    expect(q.getLatestCheckinByNormalizedPhone).toHaveBeenCalledWith("9876543210");
  });

  it("returns found false when a query throws", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    q.getSetting.mockResolvedValue("10");
    q.getActiveCheckins.mockRejectedValue(new Error("d1 down"));
    q.getAllBeds.mockResolvedValue([]);
    q.getRecentlyCheckedOutGuests.mockResolvedValue([]);

    const res = await lookupGET(lookupReq("9876543210"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ found: false, guests: [] });
    err.mockRestore();
  });
});

describe("POST /api/checkin required fields", () => {
  beforeEach(() => {
    for (const fn of Object.values(q)) fn.mockReset();
    q.getMonthKey.mockReturnValue("2026-08");
  });

  it("400s when name or contact is missing", async () => {
    const empty = await checkinPOST(checkinReq({}));
    expect(empty.status).toBe(400);
    expect(await empty.json()).toEqual({ error: "Missing required fields" });

    const noName = await checkinPOST(checkinReq({ contactNumber: "9876543210" }));
    expect(noName.status).toBe(400);
    expect(await noName.json()).toEqual({ error: "Missing required fields" });

    const noContact = await checkinPOST(checkinReq({ name: "Ada" }));
    expect(noContact.status).toBe(400);
    expect(await noContact.json()).toEqual({ error: "Missing required fields" });

    expect(q.addCheckin).not.toHaveBeenCalled();
  });

  it("rejects a foreign check-in without a visa at the API boundary", async () => {
    const res = await checkinPOST(checkinReqWithFiles({
      name: "Jean Dupont",
      contactNumber: "9876543210",
      nationality: "France",
      idType: "passport",
      arrivalDate: "2026-09-11",
      stayingDays: "2",
      comingFrom: "Paris",
      numberOfPersons: "1",
    }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "Visa document is required for non-Indian nationals",
      field: "visaImages",
    });
    expect(q.addCheckin).not.toHaveBeenCalled();
  });
});

describe("Self-checkin, robots, sitemap, my-bills, bare routes", () => {
  const BARE_ROUTES = ["/admin", "/self-checkin", "/food-order", "/kitchen", "/my-bills", "/review"];
  function isBare(pathname: string) {
    return BARE_ROUTES.some((r) => pathname === r || pathname.startsWith(r + "/"));
  }

  it("keeps booking platform required while showing booking ID as optional", () => {
    const form = fs.readFileSync(path.join(ROOT, "src/components/forms/SelfCheckinForm.tsx"), "utf-8");
    const schema = fs.readFileSync(path.join(ROOT, "src/lib/checkinSchema.ts"), "utf-8");
    expect(form).toContain("Booking ID <span className=\"text-xs font-normal text-muted-foreground\">(optional)</span>");
    expect(form).not.toContain("Booking ID <span className=\"text-brand-red\">*</span>");
    expect(schema).not.toContain("Booking ID is required for this platform");
  });

  it("shows returning guests a usable previous ID preview", () => {
    const form = fs.readFileSync(path.join(ROOT, "src/components/forms/SelfCheckinForm.tsx"), "utf-8");
    expect(form).toContain("function driveFileId");
    expect(form).toContain('url.searchParams.get("id")');
    expect(form).toContain("PreviousDocumentPreview");
    expect(form).toContain("previewAttempt < 2");
    expect(form).toContain("Math.min(attempt + 1, 2)");
    expect(form).toContain('target="_blank"');
    expect(form).toContain('Preview unavailable');
    expect(form).toContain("setPrevIdCardLink(d.idCardLink || \"\")");
    expect(form).toContain("setPrevVisaLink(d.visaLink || \"\")");
  });

  it("keeps the Welcome heading on the server page and ssr:false on the island only", () => {
    const page = fs.readFileSync(path.join(ROOT, "src/app/self-checkin/page.tsx"), "utf-8");
    const island = fs.readFileSync(path.join(ROOT, "src/components/forms/SelfCheckinFormIsland.tsx"), "utf-8");
    expect(page).toContain("Welcome to Goko Hostel");
    expect(page).toContain("SelfCheckinFormIsland");
    expect(page).not.toContain("ssr: false");
    expect(island).toContain("ssr: false");
  });

  it("disallows /review in robots and lists /reviews in the sitemap", () => {
    const robots = fs.readFileSync(path.join(ROOT, "src/app/robots.ts"), "utf-8");
    const sitemap = fs.readFileSync(path.join(ROOT, "src/app/sitemap.ts"), "utf-8");
    expect(robots).toContain('"/review/"');
    expect(robots).not.toMatch(/"\/review"(?!\/)/);
    expect(robots).not.toMatch(/"\/reviews"/);
    expect(sitemap).toMatch(/"\/reviews"/);
    expect(sitemap).not.toMatch(/"\/review"(?!s)/);
  });

  it("marks my-bills layout force-static", () => {
    expect(fs.readFileSync(path.join(ROOT, "src/app/my-bills/layout.tsx"), "utf-8")).toContain(
      'export const dynamic = "force-static"',
    );
  });

  it("treats /reviews as chrome and /review/x as bare without importing ShellWrapper", () => {
    const wrapper = fs.readFileSync(path.join(ROOT, "src/components/layout/ShellWrapper.tsx"), "utf-8");
    expect(wrapper).toContain(
      'const BARE_ROUTES = ["/admin", "/self-checkin", "/food-order", "/kitchen", "/my-bills", "/review"]',
    );
    expect(isBare("/reviews")).toBe(false);
    expect(isBare("/review/x")).toBe(true);
  });
});
