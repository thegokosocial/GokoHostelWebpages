import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const q = vi.hoisted(() => ({
  authenticateUser: vi.fn(),
  isOfflineMode: vi.fn(() => false),
  getTaskById: vi.fn(),
  getUserByUsername: vi.fn(),
  updateTask: vi.fn(),
  addAuditEntry: vi.fn(),
  getMonthKey: vi.fn(() => "SEPTEMBER-2026"),
  driveGetOrCreateFolder: vi.fn(async (_root: string, name: string) => `folder:${name}`),
  driveUploadFile: vi.fn(async () => "https://drive.example/task"),
}));

vi.mock("@/lib/auth", () => ({ authenticateUser: q.authenticateUser }));
vi.mock("@/lib/runtime", () => ({ isOfflineMode: () => q.isOfflineMode() }));
vi.mock("@/lib/googleApiFetch", () => ({
  driveGetOrCreateFolder: q.driveGetOrCreateFolder,
  driveUploadFile: q.driveUploadFile,
}));
vi.mock("@/db/queries", () => ({
  getTaskById: q.getTaskById,
  getUserByUsername: q.getUserByUsername,
  updateTask: q.updateTask,
  addAuditEntry: q.addAuditEntry,
  getMonthKey: q.getMonthKey,
}));

import { POST } from "@/app/api/admin/tasks/upload/route";

function upload(extra: Record<string, string | File> = {}) {
  const fd = new FormData();
  fd.set("password", "pw");
  fd.set("username", "staff1");
  fd.set("taskId", "10");
  fd.set("file", new File([new Uint8Array([0xff, 0xd8, 0xff])], "bill.jpg", { type: "image/jpeg" }));
  for (const [k, v] of Object.entries(extra)) fd.set(k, v);
  return new NextRequest("http://localhost/api/admin/tasks/upload", { method: "POST", body: fd });
}

beforeEach(() => {
  for (const fn of Object.values(q)) {
    if (typeof fn.mockReset === "function") fn.mockReset();
  }
  q.isOfflineMode.mockReturnValue(false);
  q.getTaskById.mockResolvedValue({
    tasks: { id: 10, deletedAt: null, assigneeUserId: 5, attachments: "[]" },
  });
  q.getUserByUsername.mockResolvedValue({ id: 5, username: "staff1" });
  q.updateTask.mockResolvedValue(undefined);
  q.addAuditEntry.mockResolvedValue(undefined);
  q.driveUploadFile.mockResolvedValue("https://drive.example/task");
  process.env.GOOGLE_DRIVE_FOLDER_ID = "root-folder";
});

describe("Tasks upload API RBAC / ownership", () => {
  it("403 without canViewTasks or canManageTasks", async () => {
    q.authenticateUser.mockResolvedValue({
      role: "staff",
      displayName: "No",
      permissions: {},
    });
    expect((await POST(upload())).status).toBe(403);
    expect(q.getTaskById).not.toHaveBeenCalled();
  });

  it("assignee with canViewTasks can upload", async () => {
    q.authenticateUser.mockResolvedValue({
      role: "staff",
      displayName: "Staff",
      permissions: { canViewTasks: true },
    });
    const res = await POST(upload());
    expect(res.status).toBe(200);
    expect(q.driveUploadFile).toHaveBeenCalled();
    expect(q.updateTask).toHaveBeenCalled();
  });

  it("viewer who is not assignee cannot upload", async () => {
    q.authenticateUser.mockResolvedValue({
      role: "staff",
      displayName: "Other",
      permissions: { canViewTasks: true },
    });
    q.getUserByUsername.mockResolvedValue({ id: 99, username: "staff1" });
    expect((await POST(upload())).status).toBe(403);
    expect(q.driveUploadFile).not.toHaveBeenCalled();
  });

  it("canManageTasks can upload for any assignee", async () => {
    q.authenticateUser.mockResolvedValue({
      role: "manager",
      displayName: "Mgr",
      permissions: { canManageTasks: true },
    });
    q.getUserByUsername.mockResolvedValue({ id: 1, username: "staff1" });
    expect((await POST(upload())).status).toBe(200);
  });

  it("503 offline after auth and validation", async () => {
    q.authenticateUser.mockResolvedValue({
      role: "staff",
      displayName: "Staff",
      permissions: { canViewTasks: true },
    });
    q.isOfflineMode.mockReturnValue(true);
    expect((await POST(upload())).status).toBe(503);
  });

  it("rejects bad mime and caps at five attachments", async () => {
    q.authenticateUser.mockResolvedValue({
      role: "staff",
      displayName: "Staff",
      permissions: { canViewTasks: true },
    });
    const mime = await POST(upload({
      file: new File([new Uint8Array([1])], "x.gif", { type: "image/gif" }),
    }));
    expect(mime.status).toBe(400);

    q.getTaskById.mockResolvedValue({
      tasks: {
        id: 10,
        deletedAt: null,
        assigneeUserId: 5,
        attachments: JSON.stringify(Array.from({ length: 5 }, (_, i) => ({
          name: `f${i}.jpg`, mime: "image/jpeg", link: `https://x/${i}`, uploadedBy: "a", uploadedAt: "t",
        }))),
      },
    });
    expect((await POST(upload())).status).toBe(400);
  });
});
