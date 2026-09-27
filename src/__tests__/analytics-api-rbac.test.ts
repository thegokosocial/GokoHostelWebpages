import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const auth = vi.hoisted(() => ({ authenticateUser: vi.fn() }));
const getDb = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth", () => ({ authenticateUser: auth.authenticateUser }));
vi.mock("@/db", () => ({ getDb }));

import { POST } from "@/app/api/admin/analytics/route";

function req(extra: Record<string, unknown> = {}) {
  return new NextRequest("http://localhost/api/admin/analytics", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      password: "pw",
      fromDate: "2026-09-01",
      toDate: "2026-09-07",
      ...extra,
    }),
  });
}

/** Minimal thenable select chain so the handler can progress past auth into queries or fail later. */
function emptyDb() {
  const rows: unknown[] = [];
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  chain.from = self;
  chain.where = self;
  chain.leftJoin = self;
  chain.innerJoin = self;
  chain.groupBy = self;
  chain.orderBy = self;
  chain.limit = async () => rows;
  chain.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(rows).then(resolve, reject);
  return {
    select: () => chain,
    all: async () => rows,
  };
}

beforeEach(() => {
  auth.authenticateUser.mockReset();
  getDb.mockReset();
  getDb.mockReturnValue(emptyDb());
});

describe("Analytics API access gate", () => {
  it("staff without canViewAnalytics is 403", async () => {
    auth.authenticateUser.mockResolvedValue({
      role: "staff",
      displayName: "No",
      permissions: { canViewManagement: true },
    });
    expect((await POST(req())).status).toBe(403);
  });

  it("staff with canViewAnalytics passes the gate (not 401/403)", async () => {
    auth.authenticateUser.mockResolvedValue({
      role: "staff",
      displayName: "Analyst",
      permissions: { canViewAnalytics: true },
    });
    const res = await POST(req());
    // Empty mock DB may 200 or 500; authorization must not be the failure mode.
    expect([200, 500]).toContain(res.status);
    expect(res.status).not.toBe(403);
  });

  it("manager role bypasses canViewAnalytics (compatibility)", async () => {
    auth.authenticateUser.mockResolvedValue({
      role: "manager",
      displayName: "Mgr",
      permissions: {},
    });
    const res = await POST(req());
    expect(res.status).not.toBe(403);
    expect(res.status).not.toBe(401);
  });

  it("rejects ranges over 366 days", async () => {
    auth.authenticateUser.mockResolvedValue({
      role: "admin",
      displayName: "Admin",
      permissions: {},
    });
    const res = await POST(req({ fromDate: "2025-01-01", toDate: "2026-12-31" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.stringMatching(/366/i) });
  });
});
