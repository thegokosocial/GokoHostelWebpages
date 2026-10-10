import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/db/queries", () => ({ getSetting: vi.fn().mockResolvedValue("") }));

const originalEnv = { ...process.env };

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  process.env = { ...originalEnv };
});

describe("Drive upload sharing", () => {
  it("fails instead of returning a private link when public sharing is rejected", async () => {
    process.env.GOOGLE_OAUTH_CLIENT_ID = "client";
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = "secret";
    process.env.GOOGLE_OAUTH_REFRESH_TOKEN = "refresh";
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "token" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "file-id" }), { status: 200 }))
      .mockResolvedValueOnce(new Response("blocked", { status: 403 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 })));

    const { driveUploadFile } = await import("@/lib/googleApiFetch");
    await expect(driveUploadFile("id.jpg", "image/jpeg", new ArrayBuffer(1))).rejects.toThrow("Drive sharing failed (403)");
    expect(fetch).toHaveBeenLastCalledWith(expect.stringContaining("/files/file-id"), expect.objectContaining({ method: "DELETE" }));
  });
});
