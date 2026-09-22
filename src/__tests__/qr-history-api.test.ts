import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/auth", () => ({ authenticateUser: vi.fn() }));
vi.mock("@/db", () => ({ getDb: vi.fn() }));
vi.mock("drizzle-orm", () => ({ eq: vi.fn(), desc: vi.fn() }));

import { authenticateUser } from "@/lib/auth";
import { getDb } from "@/db";
import { POST } from "@/app/api/admin/qr-history/route";

const admin = { role: "admin" as const, displayName: "Admin", permissions: {} };
const staff = { role: "staff" as const, displayName: "Staff", permissions: {} };

function request(body: unknown) {
  return new NextRequest("http://localhost/api/admin/qr-history", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/admin/qr-history", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(authenticateUser).mockResolvedValue(admin);
    const db = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          orderBy: vi.fn(() => ({ limit: vi.fn().mockResolvedValue([]) })),
        })),
      })),
      insert: vi.fn(() => ({ values: vi.fn().mockResolvedValue(undefined) })),
      delete: vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) })),
    };
    vi.mocked(getDb).mockReturnValue(db as never);
  });

  it("rejects unauthenticated requests", async () => {
    vi.mocked(authenticateUser).mockResolvedValue(null);
    expect((await POST(request({ action: "list", password: "bad" }))).status).toBe(401);
  });

  it("enforces the QR-generator permission for non-admin users", async () => {
    vi.mocked(authenticateUser).mockResolvedValue(staff);
    const response = await POST(request({ action: "list", password: "staff", username: "staff" }));
    expect(response.status).toBe(403);
  });

  it("allows a permitted staff user to read QR history", async () => {
    vi.mocked(authenticateUser).mockResolvedValue({ ...staff, permissions: { canUseQRGenerator: true } });
    const response = await POST(request({ action: "list", password: "staff", username: "staff" }));
    expect(response.status).toBe(200);
  });

  it("allows an admin to list saved QR configurations", async () => {
    const response = await POST(request({ action: "list", password: "admin" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ items: [] });
  });

  it("preserves validation for save and delete actions", async () => {
    expect((await POST(request({ action: "save", password: "admin" }))).status).toBe(400);
    expect((await POST(request({ action: "delete", password: "admin" }))).status).toBe(400);
  });

  it("persists valid save and delete actions after authorization", async () => {
    const response = await POST(request({
      action: "save", password: "admin", username: "admin", name: "Food", config: "{}",
    }));
    expect(response.status).toBe(200);
    const db = vi.mocked(getDb).mock.results[0]?.value as { insert: ReturnType<typeof vi.fn>; delete: ReturnType<typeof vi.fn> };
    expect(db.insert).toHaveBeenCalled();

    const deleted = await POST(request({ action: "delete", password: "admin", id: 7 }));
    expect(deleted.status).toBe(200);
    expect(db.delete).toHaveBeenCalled();
  });

  it("rejects unknown actions", async () => {
    expect((await POST(request({ action: "dropTables", password: "admin" }))).status).toBe(400);
  });
});
