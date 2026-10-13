import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ runAutomaticNoShows: vi.fn(), getSetting: vi.fn() }));
vi.mock("@/lib/autoNoShow", () => ({ runAutomaticNoShows: mocks.runAutomaticNoShows }));
vi.mock("@/db/queries", () => ({ getSetting: mocks.getSetting }));

import { POST } from "@/app/api/cron/auto-no-show/route";

describe("scheduled automatic no-shows", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = "test-secret";
    mocks.getSetting.mockResolvedValue(null);
    mocks.runAutomaticNoShows.mockResolvedValue({ scanned: 2, marked: 1, skipped: 1 });
  });

  it("rejects requests without the cron secret", async () => {
    expect((await POST(new NextRequest("http://localhost/api/cron/auto-no-show"))).status).toBe(401);
    expect(mocks.runAutomaticNoShows).not.toHaveBeenCalled();
  });

  it("does nothing until an administrator enables the setting", async () => {
    const response = await POST(new NextRequest("http://localhost/api/cron/auto-no-show", { headers: { authorization: "Bearer test-secret" } }));
    expect(await response.json()).toMatchObject({ success: true, enabled: false, marked: 0 });
    expect(mocks.runAutomaticNoShows).not.toHaveBeenCalled();
  });

  it("runs eligible released stays when enabled", async () => {
    mocks.getSetting.mockResolvedValue(JSON.stringify({ autoMarkReleasedNoShows: true }));
    const response = await POST(new NextRequest("http://localhost/api/cron/auto-no-show", { headers: { authorization: "Bearer test-secret" } }));
    expect(await response.json()).toMatchObject({ success: true, enabled: true, marked: 1 });
    expect(mocks.runAutomaticNoShows).toHaveBeenCalledOnce();
  });
});
