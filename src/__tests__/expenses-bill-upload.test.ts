import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  authenticateUser: vi.fn(), addExpense: vi.fn(), getExpenseByIdempotencyKey: vi.fn(), getDailyIncomeByIdempotencyKey: vi.fn(),
  getExpenseById: vi.fn(), updateExpense: vi.fn(), deleteExpense: vi.fn(), getExpensesByUser: vi.fn(), addAuditEntry: vi.fn(),
  addSystemLog: vi.fn(), getSetting: vi.fn(), getMonthKey: vi.fn(), getDb: vi.fn(), hostelExpenseIsLinked: vi.fn(),
  driveUploadFile: vi.fn(), driveGetOrCreateFolder: vi.fn(), driveDeleteFile: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ authenticateUser: mocks.authenticateUser }));
vi.mock("@/db/queries", () => ({
  addExpense: mocks.addExpense, getExpenseByIdempotencyKey: mocks.getExpenseByIdempotencyKey,
  getDailyIncomeByIdempotencyKey: mocks.getDailyIncomeByIdempotencyKey, getExpenseById: mocks.getExpenseById,
  updateExpense: mocks.updateExpense, deleteExpense: mocks.deleteExpense, getExpensesByUser: mocks.getExpensesByUser,
  addAuditEntry: mocks.addAuditEntry, addSystemLog: mocks.addSystemLog, getSetting: mocks.getSetting, getMonthKey: mocks.getMonthKey,
}));
vi.mock("@/db", () => ({ getDb: mocks.getDb }));
vi.mock("@/db/splitQueries", () => ({ hostelExpenseIsLinked: mocks.hostelExpenseIsLinked }));
vi.mock("@/lib/googleApiFetch", () => ({
  driveUploadFile: mocks.driveUploadFile, driveGetOrCreateFolder: mocks.driveGetOrCreateFolder, driveDeleteFile: mocks.driveDeleteFile,
}));
vi.mock("@/lib/runtime", () => ({ isOfflineMode: () => false, isPiRuntime: () => false }));

import { POST } from "@/app/api/admin/expenses/route";

const KEY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function request(billFiles: unknown) {
  return new NextRequest("http://localhost/api/admin/expenses", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      password: "pw", action: "addExpense", idempotencyKey: KEY, amount: 10000, category: "Supplies",
      purpose: "receipt", paymentMethod: "cash", expenseDate: "2026-09-28", billFiles,
    }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.GOOGLE_DRIVE_FOLDER_ID = "root";
  mocks.authenticateUser.mockResolvedValue({ role: "admin", displayName: "Admin", permissions: {} });
  mocks.getExpenseByIdempotencyKey.mockResolvedValue(null);
  mocks.addExpense.mockResolvedValue(91);
  mocks.addAuditEntry.mockResolvedValue(undefined);
  mocks.addSystemLog.mockResolvedValue(undefined);
  mocks.driveGetOrCreateFolder.mockResolvedValueOnce("bills").mockResolvedValueOnce("month");
  mocks.getDb.mockReturnValue({
    select: () => ({ from: () => ({ where: () => ({ orderBy: () => ({ limit: async () => [] }), limit: async () => [] }) }) }),
  });
});

describe("expense bill uploads", () => {
  it("uploads multiple photos and PDFs before creating the expense", async () => {
    mocks.driveUploadFile
      .mockResolvedValueOnce("https://drive.google.com/file/d/photo/view")
      .mockResolvedValueOnce("https://drive.google.com/file/d/pdf/view");

    const res = await POST(request([
      { data: "aW1hZ2U=", mime: "image/jpeg", name: "bill.jpg" },
      { data: "cGRm", mime: "application/pdf", name: "receipt.pdf" },
    ]));

    expect(res.status).toBe(200);
    expect(mocks.driveUploadFile).toHaveBeenCalledTimes(2);
    expect(mocks.driveUploadFile.mock.calls[0][1]).toBe("image/jpeg");
    expect(mocks.driveUploadFile.mock.calls[1][0]).toMatch(/receipt\.pdf$/);
    expect(mocks.driveUploadFile.mock.calls[1][1]).toBe("application/pdf");
    expect(mocks.addExpense).toHaveBeenCalledWith(expect.objectContaining({
      billImageLink: "https://drive.google.com/file/d/photo/view,https://drive.google.com/file/d/pdf/view",
    }));
  });

  it("rejects unsupported bill files without uploading or creating an expense", async () => {
    const res = await POST(request([{ data: "dGV4dA==", mime: "text/plain", name: "receipt.txt" }]));

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.stringMatching(/JPEG, PNG, WebP, and PDF/i) });
    expect(mocks.driveUploadFile).not.toHaveBeenCalled();
    expect(mocks.addExpense).not.toHaveBeenCalled();
  });

  it("rejects malformed attachment payloads", async () => {
    const res = await POST(request("not-an-array"));

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "Bill files must be an array" });
    expect(mocks.addExpense).not.toHaveBeenCalled();
  });

  it("cleans up completed uploads and does not save the expense after a later upload fails", async () => {
    mocks.driveUploadFile
      .mockResolvedValueOnce("https://drive.google.com/file/d/photo/view")
      .mockRejectedValueOnce(new Error("Drive unavailable"));

    const res = await POST(request([
      { data: "aW1hZ2U=", mime: "image/jpeg", name: "bill.jpg" },
      { data: "cGRm", mime: "application/pdf", name: "receipt.pdf" },
    ]));

    expect(res.status).toBe(503);
    expect(mocks.driveDeleteFile).toHaveBeenCalledWith("photo");
    expect(mocks.addExpense).not.toHaveBeenCalled();
  });
});
