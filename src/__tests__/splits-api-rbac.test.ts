import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const q = vi.hoisted(() => ({
  authenticateUser: vi.fn(),
  isPiRuntime: vi.fn(() => false),
  getSplitMembers: vi.fn(async () => []),
  getSplitMemberById: vi.fn(),
  addSplitMember: vi.fn(async () => 11),
  updateSplitMember: vi.fn(),
  deactivateSplitMember: vi.fn(),
  getSplitGroups: vi.fn(async () => []),
  addAuditEntry: vi.fn(),
  getUserById: vi.fn(),
  getUserByUsername: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ authenticateUser: q.authenticateUser }));
vi.mock("@/lib/runtime", () => ({ isPiRuntime: q.isPiRuntime }));
vi.mock("@/db/queries", () => ({
  addAuditEntry: q.addAuditEntry,
  getUserById: q.getUserById,
  getUserByUsername: q.getUserByUsername,
}));
vi.mock("@/db/splitQueries", () => ({
  getSplitMembers: q.getSplitMembers,
  getSplitMemberById: q.getSplitMemberById,
  addSplitMember: q.addSplitMember,
  updateSplitMember: q.updateSplitMember,
  deactivateSplitMember: q.deactivateSplitMember,
  getSplitGroups: q.getSplitGroups,
  getSplitGroupById: vi.fn(),
  addSplitGroup: vi.fn(),
  updateSplitGroup: vi.fn(),
  setSplitGroupMembers: vi.fn(),
  deleteSplitGroup: vi.fn(),
  getSplitGroupMemberIds: vi.fn(async () => []),
  loadGroupLedger: vi.fn(async () => ({ expenseEvents: [], settlementEvents: [] })),
  getSplitExpenseById: vi.fn(),
  getSplitExpenseByClientRequestId: vi.fn(),
  addSplitExpense: vi.fn(),
  updateSplitExpense: vi.fn(),
  softDeleteSplitExpense: vi.fn(),
  insertShares: vi.fn(),
  replaceShares: vi.fn(),
  getSharesForExpense: vi.fn(async () => []),
  countLiveHumanSettlements: vi.fn(async () => 0),
  countLiveSettlements: vi.fn(async () => 0),
  addSplitSettlement: vi.fn(),
  softDeleteSplitSettlement: vi.fn(),
  getSplitSettlementById: vi.fn(),
  listSplitActivity: vi.fn(async () => []),
  hostelExpenseIsLinked: vi.fn(async () => false),
  listSplitReimbursements: vi.fn(async () => []),
  postHostelExpenseForSplit: vi.fn(),
  payGokoReimbursement: vi.fn(),
}));

import { POST } from "@/app/api/admin/splits/route";

function req(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/admin/splits", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: "pw", username: "ada", ...body }),
  });
}

beforeEach(() => {
  for (const fn of Object.values(q)) fn.mockReset();
  q.isPiRuntime.mockReturnValue(false);
  q.getSplitMembers.mockResolvedValue([]);
  q.addSplitMember.mockResolvedValue(11);
});

describe("Splits API Pi / RBAC / house guards", () => {
  it("rejects all splits actions on Pi before auth", async () => {
    q.isPiRuntime.mockReturnValue(true);
    const res = await POST(req({ action: "listMembers" }));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: expect.stringMatching(/live site/i) });
    expect(q.authenticateUser).not.toHaveBeenCalled();
  });

  it("requires canViewSplits for staff entry", async () => {
    q.authenticateUser.mockResolvedValue({ role: "staff", displayName: "No", permissions: {} });
    expect((await POST(req({ action: "listMembers" }))).status).toBe(403);
  });

  it("canViewSplits alone allows list but not addMember", async () => {
    q.authenticateUser.mockResolvedValue({
      role: "staff", displayName: "Viewer", permissions: { canViewSplits: true },
    });
    expect((await POST(req({ action: "listMembers" }))).status).toBe(200);
    expect((await POST(req({ action: "addMember", name: "Bina", kind: "volunteer" }))).status).toBe(403);
    expect(q.addSplitMember).not.toHaveBeenCalled();
  });

  it("canManageSplits can add a human member", async () => {
    q.authenticateUser.mockResolvedValue({
      role: "staff",
      displayName: "Mgr",
      permissions: { canViewSplits: true, canManageSplits: true },
    });
    const res = await POST(req({ action: "addMember", name: "Bina", kind: "volunteer" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, id: 11 });
    expect(q.addSplitMember).toHaveBeenCalled();
  });

  it("rejects creating a house member via isHouse flag", async () => {
    q.authenticateUser.mockResolvedValue({ role: "admin", displayName: "Admin", permissions: {} });
    const res = await POST(req({ action: "addMember", name: "Goko", kind: "other", isHouse: 1 }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.stringMatching(/house member/i) });
    expect(q.addSplitMember).not.toHaveBeenCalled();
  });

  it("cannot rename, clear, or deactivate the house member", async () => {
    q.authenticateUser.mockResolvedValue({ role: "admin", displayName: "Admin", permissions: {} });
    q.getSplitMemberById.mockResolvedValue({
      id: 1, name: "Goko Hostel", isHouse: 1, isActive: 1, kind: "other",
    });

    expect((await POST(req({ action: "updateMember", id: 1, name: "Not Goko" }))).status).toBe(400);
    expect((await POST(req({ action: "updateMember", id: 1, isHouse: 0 }))).status).toBe(400);
    expect((await POST(req({ action: "updateMember", id: 1, isActive: 0 }))).status).toBe(400);
    expect((await POST(req({ action: "deactivateMember", id: 1 }))).status).toBe(400);
    expect(q.updateSplitMember).not.toHaveBeenCalled();
    expect(q.deactivateSplitMember).not.toHaveBeenCalled();
  });

  it("canAddSplitExpense alone cannot manage members", async () => {
    q.authenticateUser.mockResolvedValue({
      role: "staff",
      displayName: "Expense",
      permissions: { canViewSplits: true, canAddSplitExpense: true },
    });
    expect((await POST(req({ action: "addMember", name: "X", kind: "staff" }))).status).toBe(403);
  });

  it("rejects unknown actions", async () => {
    q.authenticateUser.mockResolvedValue({ role: "admin", displayName: "Admin", permissions: {} });
    expect((await POST(req({ action: "wipeAll" }))).status).toBe(400);
  });
});
