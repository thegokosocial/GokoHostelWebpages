import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  authenticateUser: vi.fn(),
  getDb: vi.fn(),
  getSetting: vi.fn(),
  setSetting: vi.fn(),
  calculateEmployeePayroll: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ authenticateUser: mocks.authenticateUser }));
vi.mock("@/db", () => ({ getDb: mocks.getDb }));
vi.mock("@/db/queries", () => ({ getSetting: mocks.getSetting, setSetting: mocks.setSetting }));
vi.mock("@/lib/employeeAttendance", () => ({ calculateEmployeePayroll: mocks.calculateEmployeePayroll }));

import { POST } from "@/app/api/admin/account-settings/route";

function request(action: string, extra: Record<string, unknown> = {}) {
  return new NextRequest("http://localhost/api/admin/account-settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: "pw", username: "staff1", action, ...extra }),
  });
}

function selectChain(rows: unknown[] = []) {
  return {
    select: () => ({
      from: () => Object.assign(Promise.resolve(rows), {
        where: () => Object.assign(Promise.resolve(rows), {
          limit: async () => rows,
          orderBy: async () => rows,
        }),
        orderBy: async () => rows,
      }),
    }),
    insert: () => ({ values: async () => undefined }),
    update: () => ({ set: () => ({ where: async () => undefined }) }),
    delete: () => ({ where: async () => undefined }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSetting.mockResolvedValue("");
  mocks.setSetting.mockResolvedValue(undefined);
  mocks.getDb.mockReturnValue(selectChain([]));
});

describe("Account settings employees / payroll RBAC", () => {
  it("canManageEmployees can list employees but not pay salary", async () => {
    mocks.authenticateUser.mockResolvedValue({
      role: "staff",
      displayName: "HR",
      permissions: { canManageEmployees: true },
    });
    expect((await POST(request("listEmployees"))).status).toBe(200);

    const pay = await POST(request("paySalary", {
      employeeId: 1, month: "2026-09", amount: 10000, paymentMethod: "cash",
    }));
    expect(pay.status).toBe(403);
  });

  it("canManagePayroll alone cannot list employees", async () => {
    mocks.authenticateUser.mockResolvedValue({
      role: "staff",
      displayName: "Pay",
      permissions: { canManagePayroll: true },
    });
    expect((await POST(request("listEmployees"))).status).toBe(403);
  });

  it("canManageVendors cannot touch employees or payroll", async () => {
    mocks.authenticateUser.mockResolvedValue({
      role: "staff",
      displayName: "Vendors",
      permissions: { canManageVendors: true },
    });
    expect((await POST(request("listEmployees"))).status).toBe(403);
    expect((await POST(request("paySalary", { employeeId: 1, month: "2026-09" }))).status).toBe(403);
  });

  it("legacy canManageAccountSettings umbrella still unlocks employee and payroll actions", async () => {
    // Product keeps canManageAccountSettings as a route-wide compatibility bypass.
    mocks.authenticateUser.mockResolvedValue({
      role: "staff",
      displayName: "Legacy",
      permissions: { canManageAccountSettings: true },
    });
    expect((await POST(request("listEmployees"))).status).toBe(200);
    // paySalary will fail validation/DB later; auth must not 403 first
    mocks.calculateEmployeePayroll.mockResolvedValue(null);
    const pay = await POST(request("paySalary", {
      employeeId: 1, month: "2026-09", amount: 1000, paymentMethod: "cash", date: "2026-09-20",
    }));
    expect(pay.status).not.toBe(403);
  });

  it("empty staff permissions are denied across settings actions", async () => {
    mocks.authenticateUser.mockResolvedValue({
      role: "staff", displayName: "None", permissions: {},
    });
    for (const action of ["listAccounts", "listVendors", "listEmployees", "paySalary", "listCategories"] as const) {
      expect((await POST(request(action))).status, action).toBe(403);
    }
  });
});
