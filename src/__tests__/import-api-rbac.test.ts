import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const auth = vi.hoisted(() => ({ authenticateUser: vi.fn() }));

vi.mock("@/lib/auth", () => ({ authenticateUser: auth.authenticateUser }));
vi.mock("@/db", () => ({ getDb: vi.fn() }));
vi.mock("@/db/queries", () => ({
  getMonthKey: vi.fn(() => "SEPTEMBER-2026"),
  addSystemLog: vi.fn(),
}));

import { POST } from "@/app/api/admin/import/route";

function templateReq() {
  return new NextRequest("http://localhost/api/admin/import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "template", username: "staff1" }),
  });
}

beforeEach(() => {
  auth.authenticateUser.mockReset();
});

describe("Check-in import template RBAC", () => {
  it("401 without session", async () => {
    auth.authenticateUser.mockResolvedValue(null);
    expect((await POST(templateReq())).status).toBe(401);
  });

  it("403 without canAddCheckin", async () => {
    auth.authenticateUser.mockResolvedValue({
      role: "staff",
      displayName: "Viewer",
      permissions: { canViewRecords: true },
    });
    const res = await POST(templateReq());
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "Insufficient permissions" });
  });

  it("returns xlsx template with canAddCheckin", async () => {
    auth.authenticateUser.mockResolvedValue({
      role: "staff",
      displayName: "Importer",
      permissions: { canAddCheckin: true },
    });
    const res = await POST(templateReq());
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toMatch(/spreadsheetml/);
  });
});
