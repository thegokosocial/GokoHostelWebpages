import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import * as fs from "fs";

const q = vi.hoisted(() => ({
  authenticateUser: vi.fn(),
  addCheckin: vi.fn(),
  getCheckinByIdempotencyKey: vi.fn(),
  getActiveCheckins: vi.fn(),
  getMonthKey: vi.fn(() => "2026-09"),
  addAuditEntry: vi.fn(),
  addSystemLog: vi.fn(),
  dispatchPush: vi.fn(),
  getDb: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  authenticateUser: q.authenticateUser,
  hashPassword: vi.fn(),
  verifyPassword: vi.fn(),
}));
vi.mock("@/db/queries", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/queries")>();
  return {
    ...actual,
    addCheckin: q.addCheckin,
    getCheckinByIdempotencyKey: q.getCheckinByIdempotencyKey,
    getActiveCheckins: q.getActiveCheckins,
    getMonthKey: q.getMonthKey,
    addAuditEntry: q.addAuditEntry,
    addSystemLog: q.addSystemLog,
  };
});
vi.mock("@/db", () => ({ getDb: q.getDb }));
vi.mock("@/lib/pushNotify", () => ({
  dispatchPush: q.dispatchPush,
  notificationFirstName: (n: string) => n,
}));
vi.mock("@/lib/runtime", () => ({ isOfflineMode: () => true, isPiRuntime: () => false }));

import { POST as adminPost } from "@/app/api/admin/checkins/route";
import { POST as selfPost } from "@/app/api/checkin/route";

const KEY = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

beforeEach(() => {
  for (const fn of Object.values(q)) fn.mockReset();
  q.authenticateUser.mockResolvedValue({ role: "admin", displayName: "Admin", permissions: {} });
  q.getCheckinByIdempotencyKey.mockResolvedValue(null);
  q.getActiveCheckins.mockResolvedValue([]);
  q.addCheckin.mockResolvedValue([{ id: 101 }]);
  q.addAuditEntry.mockResolvedValue(undefined);
  q.addSystemLog.mockResolvedValue(undefined);
  q.dispatchPush.mockResolvedValue(undefined);
  q.getMonthKey.mockReturnValue("2026-09");
});

describe("check-in create idempotency", () => {
  it("admin add returns duplicate without insert", async () => {
    q.getCheckinByIdempotencyKey.mockResolvedValue({ id: 50, name: "Ada" });
    const res = await adminPost(new NextRequest("http://localhost/api/admin/checkins", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        password: "pw",
        action: "add",
        idempotencyKey: KEY,
        entry: ["2026-09-26T10:00:00.000Z", "2026-09-26", "10:00", "Ada Lovelace", "1", "9000000000", "2", "BLR", "Indian", "", "", "", "", "aadhaar", "http://id", "", "pending"],
      }),
    }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, checkinId: 50, duplicate: true });
    expect(q.addCheckin).not.toHaveBeenCalled();
  });

  it("admin add requires idempotencyKey", async () => {
    const res = await adminPost(new NextRequest("http://localhost/api/admin/checkins", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        password: "pw",
        action: "add",
        entry: ["2026-09-26T10:00:00.000Z", "2026-09-26", "10:00", "Ada", "1", "9000000000", "2", "BLR", "Indian", "", "", "", "", "aadhaar", "http://id", "", "pending"],
      }),
    }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "idempotencyKey required" });
  });

  it("self-check-in returns duplicate on key hit before soft visit scan", async () => {
    q.getCheckinByIdempotencyKey.mockResolvedValue({ id: 77 });
    const form = new FormData();
    form.set("name", "Ada Lovelace");
    form.set("contactNumber", "9000000000");
    form.set("nationality", "Indian");
    form.set("idType", "aadhaar");
    form.set("arrivalDate", "2026-09-26");
    form.set("arrivalTime", "10:00");
    form.set("stayingDays", "2");
    form.set("comingFrom", "BLR");
    form.set("numberOfPersons", "1");
    form.set("emergencyName", "");
    form.set("emergencyPhone", "");
    form.set("bookingPlatform", "Walk-in");
    form.set("idempotencyKey", KEY);
    form.set("prevIdCardLink", "https://drive.example/id");
    const res = await selfPost(new NextRequest("http://localhost/api/checkin", { method: "POST", body: form }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, duplicate: true, checkinId: 77 });
    expect(q.getActiveCheckins).not.toHaveBeenCalled();
    expect(q.addCheckin).not.toHaveBeenCalled();
  });

  it("clients send a stable create key", () => {
    const records = fs.readFileSync("src/components/admin/AdminRecords.tsx", "utf8");
    const self = fs.readFileSync("src/components/forms/SelfCheckinForm.tsx", "utf8");
    expect(records).toMatch(/addIdempotencyKey/);
    expect(records).toMatch(/pastIdempotencyKey/);
    expect(self).toMatch(/formData\.append\("idempotencyKey"/);
    expect(self).toMatch(/useState\(\(\) => crypto\.randomUUID\(\)\)/);
  });
});
