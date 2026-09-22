import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ authenticateUser: vi.fn(), getDb: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authenticateUser: mocks.authenticateUser }));
vi.mock("@/db", () => ({ getDb: mocks.getDb }));

import { POST } from "@/app/api/admin/quick-links/route";

const admin = { role: "admin" as const, displayName: "Admin", permissions: {} };
const viewer = { role: "staff" as const, displayName: "Viewer", permissions: { canViewQuickLinks: true } };

function request(body: unknown) {
  return new NextRequest("http://localhost/api/admin/quick-links", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function selectBuilder(result: unknown) {
  return {
    from: vi.fn(() => ({
      orderBy: vi.fn().mockResolvedValue(result),
      where: vi.fn(() => ({ limit: vi.fn().mockResolvedValue(result) })),
    })),
  };
}

describe("Admin Quick Links API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authenticateUser.mockResolvedValue(admin);
    mocks.getDb.mockReturnValue({ select: vi.fn(() => selectBuilder([])), insert: vi.fn(() => ({ values: vi.fn().mockResolvedValue(undefined) })), delete: vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) })) });
  });

  it("allows a permitted viewer to list but not mutate", async () => {
    mocks.authenticateUser.mockResolvedValue(viewer);
    const list = await POST(request({ action: "list", password: "pw" }));
    expect(list.status).toBe(200);
    const save = await POST(request({ action: "saveSection", password: "pw", name: "Useful" }));
    expect(save.status).toBe(403);
  });

  it("rejects malformed section and item inputs before database writes", async () => {
    const saveSection = await POST(request({ action: "saveSection", password: "pw", name: "  " }));
    expect(saveSection.status).toBe(400);
    const saveItem = await POST(request({ action: "saveItem", password: "pw", sectionId: 0, title: "Food" }));
    expect(saveItem.status).toBe(400);
  });

  it("rejects unsafe URLs and missing sections", async () => {
    const missingSection = await POST(request({ action: "saveItem", password: "pw", sectionId: 9, title: "Food", url: "https://goko.test" }));
    expect(missingSection.status).toBe(404);

    const select = vi.fn()
      .mockReturnValueOnce({ from: vi.fn(() => ({ where: vi.fn(() => ({ limit: vi.fn().mockResolvedValue([{ id: 9 }]) })) })) })
      .mockReturnValueOnce({ from: vi.fn(() => ({ where: vi.fn().mockResolvedValue([]) })) });
    mocks.getDb.mockReturnValue({ select, insert: vi.fn(() => ({ values: vi.fn().mockResolvedValue(undefined) })) });
    const unsafe = await POST(request({ action: "saveItem", password: "pw", sectionId: 9, title: "Food", url: "javascript:alert(1)" }));
    expect(unsafe.status).toBe(400);
  });

  it("saves a valid section", async () => {
    const insert = vi.fn(() => ({ values: vi.fn().mockResolvedValue(undefined) }));
    const select = vi.fn(() => ({ from: vi.fn(() => Promise.resolve([])) }));
    mocks.getDb.mockReturnValue({ select, insert });
    const response = await POST(request({ action: "saveSection", password: "pw", name: "Useful", description: "Guest links" }));
    expect(response.status).toBe(200);
    expect(insert).toHaveBeenCalledOnce();
  });
});
