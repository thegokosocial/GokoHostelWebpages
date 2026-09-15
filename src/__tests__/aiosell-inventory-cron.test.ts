import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const retryDirtyInventory = vi.hoisted(() => vi.fn());

vi.mock("@/lib/aiosellSync", () => ({ retryDirtyInventory }));

import { POST } from "@/app/api/cron/aiosell-inventory/route";

describe("scheduled Aiosell inventory retry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = "test-secret";
    retryDirtyInventory.mockResolvedValue({ attempted: true, accepted: true });
  });

  it("rejects requests without the cron secret", async () => {
    const response = await POST(new NextRequest("http://localhost/api/cron/aiosell-inventory"));
    expect(response.status).toBe(401);
    expect(retryDirtyInventory).not.toHaveBeenCalled();
  });

  it("runs the dirty inventory retry for an authorized request", async () => {
    const response = await POST(new NextRequest("http://localhost/api/cron/aiosell-inventory", {
      headers: { authorization: "Bearer test-secret" },
    }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, sync: { attempted: true, accepted: true } });
    expect(retryDirtyInventory).toHaveBeenCalledOnce();
  });
});
