import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const q = vi.hoisted(() => ({
  authenticateUser: vi.fn(),
  getBookingTableData: vi.fn(async () => ({ bookings: [], total: 0 })),
  getBookingById: vi.fn(),
  getSetting: vi.fn(async () => ""),
}));

vi.mock("@/lib/auth", () => ({ authenticateUser: q.authenticateUser }));
vi.mock("@/lib/runtime", () => ({ isPiRuntime: () => false, isOfflineMode: () => false }));
vi.mock("@/lib/aiosellSync", () => ({
  triggerInventoryPush: vi.fn(),
  pushIfOtaChanged: vi.fn(),
  pushIfGokoOccupancy: vi.fn(),
}));
vi.mock("@/db/queries", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/queries")>();
  return {
    ...actual,
    getBookingTableData: q.getBookingTableData,
    getBookingById: q.getBookingById,
    getSetting: q.getSetting,
    addAuditEntry: vi.fn(),
    addSystemLog: vi.fn(),
  };
});
vi.mock("@/db", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => [],
          orderBy: async () => [],
        }),
        orderBy: async () => [],
      }),
    }),
  }),
}));

import { POST } from "@/app/api/admin/bookings/route";

function req(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/admin/bookings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: "pw", username: "book", ...body }),
  });
}

beforeEach(() => {
  for (const fn of Object.values(q)) {
    if (typeof fn.mockReset === "function") fn.mockReset();
  }
  q.getBookingTableData.mockResolvedValue({ bookings: [], total: 0 });
  q.getSetting.mockResolvedValue("");
});

describe("Bookings API RBAC landmines", () => {
  it("canViewBookings can list; cannot create or rollback", async () => {
    q.authenticateUser.mockResolvedValue({
      role: "staff",
      displayName: "Viewer",
      permissions: { canViewBookings: true },
    });
    expect((await POST(req({
      action: "getAllBookings",
      startDate: "2026-09-01",
      endDate: "2026-09-30",
    }))).status).toBe(200);
    expect((await POST(req({
      action: "createBooking",
      guestName: "Ada",
      checkinDate: "2026-09-27",
      checkoutDate: "2026-09-28",
      persons: 1,
    }))).status).toBe(403);
    expect((await POST(req({ action: "rollbackCheckIn", bookingId: 1 }))).status).toBe(403);
  });

  it("rollbackCheckIn / rollbackCheckOut are admin_only", async () => {
    q.authenticateUser.mockResolvedValue({
      role: "manager",
      displayName: "Mgr",
      permissions: { canViewBookings: true, canAddBooking: true, canCheckIn: true, canCheckOut: true },
    });
    expect((await POST(req({ action: "rollbackCheckIn", bookingId: 1 }))).status).toBe(403);
    expect((await POST(req({ action: "rollbackCheckOut", bookingId: 1 }))).status).toBe(403);
  });

  it("collectOtaBookingPayment needs canRecordBookingPayments AND canViewBookings", async () => {
    q.authenticateUser.mockResolvedValue({
      role: "staff",
      displayName: "Pay",
      permissions: { canRecordBookingPayments: true },
    });
    const res = await POST(req({
      action: "collectOtaBookingPayment",
      bookingId: 1,
      amount: 100,
      paymentMethod: "cash",
    }));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: expect.stringMatching(/view access/i) });
  });

  it("env manager without canDeleteBooking still passes cancelBooking gate (compat)", async () => {
    q.authenticateUser.mockResolvedValue({
      role: "manager",
      displayName: "EnvMgr",
      permissions: {},
    });
    // Gate opens; handler may 400/404 without a real booking — must not be permission 403.
    const res = await POST(req({ action: "cancelBooking", bookingId: 99999 }));
    expect(res.status).not.toBe(403);
  });

  it("staff without canDeleteBooking cannot cancelBooking", async () => {
    q.authenticateUser.mockResolvedValue({
      role: "staff",
      displayName: "Staff",
      permissions: { canViewBookings: true },
    });
    expect((await POST(req({ action: "cancelBooking", bookingId: 1 }))).status).toBe(403);
  });

  it("unknown action is 400", async () => {
    q.authenticateUser.mockResolvedValue({ role: "admin", displayName: "Admin", permissions: {} });
    expect((await POST(req({ action: "nope" }))).status).toBe(400);
  });
});
