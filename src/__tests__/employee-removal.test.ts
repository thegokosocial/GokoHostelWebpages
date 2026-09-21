import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import { readFileSync } from "node:fs";

const mocks = vi.hoisted(() => ({ authenticateUser: vi.fn(), getDb: vi.fn() }));

vi.mock("@/lib/auth", () => ({ authenticateUser: mocks.authenticateUser }));
vi.mock("@/db", () => ({ getDb: mocks.getDb }));
vi.mock("@/db/queries", () => ({}));

import { POST } from "@/app/api/admin/account-settings/route";

function request(action: string, extra: Record<string, unknown> = {}) {
  return new NextRequest("http://localhost/api/admin/account-settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: "pw", action, ...extra }),
  });
}

describe("inactive employee removal", () => {
  beforeEach(() => {
    mocks.authenticateUser.mockReset().mockResolvedValue({ role: "admin", displayName: "Admin", permissions: {} });
    mocks.getDb.mockReset();
  });

  it("tombstones an inactive employee and retains linked history", async () => {
    const employee = { id: 6, name: "Synthetic Employee", isActive: 0, deletedAt: null };
    const limit = vi.fn().mockResolvedValue([employee]);
    const where = vi.fn().mockReturnValue({ limit });
    const from = vi.fn().mockReturnValue({ where });
    const select = vi.fn().mockReturnValue({ from });
    const updateWhere = vi.fn().mockResolvedValue(undefined);
    const set = vi.fn().mockReturnValue({ where: updateWhere });
    const update = vi.fn().mockReturnValue({ set });
    mocks.getDb.mockReturnValue({ select, update });

    const response = await POST(request("removeEmployee", { id: 6 }));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, historyRetained: true });
    expect(set).toHaveBeenCalledWith(expect.objectContaining({ deletedAt: expect.any(String) }));
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("refuses to remove an active employee", async () => {
    const limit = vi.fn().mockResolvedValue([{ id: 6, isActive: 1, deletedAt: null }]);
    const where = vi.fn().mockReturnValue({ limit });
    const from = vi.fn().mockReturnValue({ where });
    const select = vi.fn().mockReturnValue({ from });
    const update = vi.fn();
    mocks.getDb.mockReturnValue({ select, update });

    const response = await POST(request("removeEmployee", { id: 6 }));

    expect(response.status).toBe(409);
    expect((await response.json()).error).toMatch(/deactivate/i);
    expect(update).not.toHaveBeenCalled();
  });

  it("allows an employee manager to use the removal action", async () => {
    mocks.authenticateUser.mockResolvedValueOnce({ role: "staff", displayName: "Manager", permissions: { canManageEmployees: true } });
    const limit = vi.fn().mockResolvedValue([{ id: 6, isActive: 0, deletedAt: null }]);
    const where = vi.fn().mockReturnValue({ limit });
    const from = vi.fn().mockReturnValue({ where });
    const select = vi.fn().mockReturnValue({ from });
    const updateWhere = vi.fn().mockResolvedValue(undefined);
    const set = vi.fn().mockReturnValue({ where: updateWhere });
    const update = vi.fn().mockReturnValue({ set });
    mocks.getDb.mockReturnValue({ select, update });

    const response = await POST(request("removeEmployee", { id: 6 }));

    expect(response.status).toBe(200);
  });

  it("does not return removed employees in the roster", async () => {
    const orderBy = vi.fn().mockResolvedValue([]);
    const where = vi.fn().mockReturnValue({ orderBy });
    const from = vi.fn().mockReturnValue({ where });
    const select = vi.fn().mockReturnValue({ from });
    mocks.getDb.mockReturnValue({ select });

    const response = await POST(request("listEmployees"));

    expect(response.status).toBe(200);
    const query = new SQLiteSyncDialect().sqlToQuery(where.mock.calls[0][0]);
    expect(query.sql.toLowerCase()).toContain("deleted_at");
    expect(query.sql.toLowerCase()).toContain("is null");
  });

  it("shows an explicit remove control on inactive employees", () => {
    const source = readFileSync("src/components/admin/AccountSettings.tsx", "utf8");
    expect(source).toContain('title="Remove employee from list (history retained)"');
    expect(source).toContain("onClick={() => removeEmployee(e)}");
  });
});
