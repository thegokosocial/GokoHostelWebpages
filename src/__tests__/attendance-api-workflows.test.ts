import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { addCalendarDays } from "@/lib/inventoryAvailability";

const q = vi.hoisted(() => ({
  authenticateUser: vi.fn(),
  getDb: vi.fn(),
  getAuditRetentionCutoff: vi.fn(async () => null),
  calculateEmployeePayroll: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ authenticateUser: q.authenticateUser }));
vi.mock("@/db", () => ({ getDb: q.getDb }));
vi.mock("@/db/queries", () => ({ getAuditRetentionCutoff: q.getAuditRetentionCutoff }));
vi.mock("@/lib/employeeAttendance", () => ({ calculateEmployeePayroll: q.calculateEmployeePayroll }));

import { POST } from "@/app/api/admin/attendance/route";

function req(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/admin/attendance", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: "pw", username: "mgr", ...body }),
  });
}

function chainSelect(rows: unknown[]) {
  const limited = Object.assign(Promise.resolve(rows), {
    limit: async () => rows,
  });
  const ordered = Object.assign(Promise.resolve(rows), {
    limit: async () => rows,
    orderBy: () => limited,
  });
  return {
    from: () => Object.assign(Promise.resolve(rows), {
      where: () => ordered,
      orderBy: () => limited,
    }),
  };
}

beforeEach(() => {
  for (const fn of Object.values(q)) fn.mockReset();
  q.getAuditRetentionCutoff.mockResolvedValue(null);
  q.calculateEmployeePayroll.mockResolvedValue(null);
  q.getDb.mockReturnValue({
    select: () => chainSelect([]),
    insert: () => ({ values: async () => undefined }),
    update: () => ({ set: () => ({ where: async () => undefined }) }),
  });
});

describe("Attendance API workflows", () => {
  it("requires canManageAttendance for getMonth / setAttendance", async () => {
    q.authenticateUser.mockResolvedValue({
      role: "staff", displayName: "No", permissions: { canViewAudit: true },
    });
    expect((await POST(req({ action: "getMonth", month: "2026-09" }))).status).toBe(403);
    expect((await POST(req({
      action: "setAttendance", employeeId: 1, startDate: "2026-09-01", status: "full_day_leave",
    }))).status).toBe(403);
  });

  it("allows staff with canManageAttendance to load a month", async () => {
    q.authenticateUser.mockResolvedValue({
      role: "staff", displayName: "Att", permissions: { canManageAttendance: true },
    });
    const res = await POST(req({ action: "getMonth", month: "2026-09" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ employees: [], attendance: [] });
  });

  it("rejects getAuditHistory without canViewAudit even when attendance manage is granted", async () => {
    q.authenticateUser.mockResolvedValue({
      role: "staff", displayName: "Att", permissions: { canManageAttendance: true },
    });
    expect((await POST(req({ action: "getAuditHistory", month: "2026-09" }))).status).toBe(403);
  });

  it("allows getAuditHistory with canViewAudit alone", async () => {
    q.authenticateUser.mockResolvedValue({
      role: "staff", displayName: "Audit", permissions: { canViewAudit: true },
    });
    expect((await POST(req({ action: "getAuditHistory", month: "2026-09" }))).status).toBe(200);
  });

  it("rejects setAttendance ranges longer than 62 days before writing", async () => {
    q.authenticateUser.mockResolvedValue({
      role: "admin", displayName: "Admin", permissions: {},
    });
    const start = "2026-01-01";
    const end = addCalendarDays(start, 62); // 63 calendar days inclusive
    const insert = vi.fn(() => ({ values: async () => undefined }));
    q.getDb.mockReturnValue({
      select: () => chainSelect([{
        id: 1, attendanceStartDate: "2020-01-01", employmentEndDate: "", deletedAt: null,
      }]),
      insert,
      update: () => ({ set: () => ({ where: async () => undefined }) }),
    });
    const res = await POST(req({
      action: "setAttendance",
      employeeId: 1,
      startDate: start,
      endDate: end,
      status: "full_day_leave",
    }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.stringMatching(/62 days/i) });
    expect(insert).not.toHaveBeenCalled();
  });

  it("rejects setAttendance outside employment period", async () => {
    q.authenticateUser.mockResolvedValue({ role: "admin", displayName: "Admin", permissions: {} });
    q.getDb.mockReturnValue({
      select: () => chainSelect([{
        id: 1, attendanceStartDate: "2026-09-10", employmentEndDate: "2026-09-20", deletedAt: null,
      }]),
      insert: () => ({ values: async () => undefined }),
      update: () => ({ set: () => ({ where: async () => undefined }) }),
    });
    const res = await POST(req({
      action: "setAttendance",
      employeeId: 1,
      startDate: "2026-09-01",
      status: "full_day_leave",
    }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.stringMatching(/employment period/i) });
  });

  it("skips history when status and comment are unchanged (changed=0)", async () => {
    q.authenticateUser.mockResolvedValue({ role: "admin", displayName: "Admin", permissions: {} });
    const insert = vi.fn(() => ({ values: async () => undefined }));
    let selectCalls = 0;
    q.getDb.mockReturnValue({
      select: () => {
        selectCalls += 1;
        // first select: employee; second: existing attendance row
        if (selectCalls === 1) {
          return chainSelect([{
            id: 1, attendanceStartDate: "2026-01-01", employmentEndDate: "", deletedAt: null,
          }]);
        }
        return chainSelect([{
          id: 50, status: "full_day_leave", comment: "trip", deletedAt: null,
        }]);
      },
      insert,
      update: () => ({ set: () => ({ where: async () => undefined }) }),
    });
    const res = await POST(req({
      action: "setAttendance",
      employeeId: 1,
      startDate: "2026-09-15",
      status: "full_day_leave",
      comment: "trip",
    }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, changed: 0 });
    expect(insert).not.toHaveBeenCalled();
  });

  it("rejects invalid month on getMonth", async () => {
    q.authenticateUser.mockResolvedValue({ role: "admin", displayName: "Admin", permissions: {} });
    expect((await POST(req({ action: "getMonth", month: "09-2026" }))).status).toBe(400);
  });
});
