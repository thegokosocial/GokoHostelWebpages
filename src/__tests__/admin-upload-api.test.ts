import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const q = vi.hoisted(() => ({
  authenticateUser: vi.fn(),
  isOfflineMode: vi.fn(() => false),
  driveUploadFile: vi.fn(async () => "https://drive.example/file"),
  driveGetOrCreateFolder: vi.fn(async () => "folder"),
  incrementStat: vi.fn(async () => undefined),
  addSystemLog: vi.fn(async () => undefined),
  getMonthKey: vi.fn(() => "SEPTEMBER-2026"),
}));

vi.mock("@/lib/auth", () => ({ authenticateUser: q.authenticateUser }));
vi.mock("@/lib/runtime", () => ({ isOfflineMode: () => q.isOfflineMode() }));
vi.mock("@/lib/googleApiFetch", () => ({
  driveUploadFile: q.driveUploadFile,
  driveGetOrCreateFolder: q.driveGetOrCreateFolder,
}));
vi.mock("@/db/queries", () => ({
  getMonthKey: q.getMonthKey,
  incrementStat: q.incrementStat,
  addSystemLog: q.addSystemLog,
}));

import { POST } from "@/app/api/admin/upload/route";

function uploadReq(opts: {
  authUser?: string;
  file?: File | null;
  name?: string;
  type?: string;
} = {}) {
  const fd = new FormData();
  if (opts.authUser) fd.set("username", opts.authUser);
  fd.set("name", opts.name || "Guest");
  fd.set("type", opts.type || "id");
  if (opts.file !== null) {
    fd.set("file", opts.file || new File([new Uint8Array([0xff, 0xd8, 0xff])], "id.jpg", { type: "image/jpeg" }));
  }
  return new NextRequest("http://localhost/api/admin/upload", { method: "POST", body: fd });
}

beforeEach(() => {
  for (const fn of Object.values(q)) {
    if (typeof fn.mockReset === "function") fn.mockReset();
  }
  q.isOfflineMode.mockReturnValue(false);
  q.driveUploadFile.mockResolvedValue("https://drive.example/file");
  q.driveGetOrCreateFolder.mockResolvedValue("folder");
  delete process.env.GOOGLE_DRIVE_FOLDER_ID;
});

describe("Admin Drive upload API", () => {
  it("503 when offline before auth", async () => {
    q.isOfflineMode.mockReturnValue(true);
    expect((await POST(uploadReq())).status).toBe(503);
    expect(q.authenticateUser).not.toHaveBeenCalled();
  });

  it("401 without session", async () => {
    q.authenticateUser.mockResolvedValue(null);
    expect((await POST(uploadReq({ authUser: "x" }))).status).toBe(401);
  });

  it("403 without canAddCheckin or canEditRecords", async () => {
    q.authenticateUser.mockResolvedValue({
      role: "staff",
      displayName: "Viewer",
      permissions: { canViewRecords: true },
    });
    expect((await POST(uploadReq({ authUser: "viewer" }))).status).toBe(403);
    expect(q.driveUploadFile).not.toHaveBeenCalled();
  });

  it("canAddCheckin alone can upload jpeg", async () => {
    q.authenticateUser.mockResolvedValue({
      role: "staff",
      displayName: "Adder",
      permissions: { canAddCheckin: true },
    });
    const res = await POST(uploadReq({ authUser: "adder" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ link: "https://drive.example/file" });
    expect(q.driveUploadFile).toHaveBeenCalled();
  });

  it("canEditRecords alone can upload", async () => {
    q.authenticateUser.mockResolvedValue({
      role: "staff",
      displayName: "Editor",
      permissions: { canEditRecords: true },
    });
    expect((await POST(uploadReq({ authUser: "editor" }))).status).toBe(200);
  });

  it("rejects unsupported mime and empty file", async () => {
    q.authenticateUser.mockResolvedValue({
      role: "staff",
      displayName: "Adder",
      permissions: { canAddCheckin: true },
    });
    const bad = await POST(uploadReq({
      authUser: "adder",
      file: new File([new Uint8Array([1])], "x.txt", { type: "text/plain" }),
    }));
    expect(bad.status).toBe(400);

    const empty = await POST(uploadReq({ authUser: "adder", file: null }));
    expect(empty.status).toBe(400);
  });
});
