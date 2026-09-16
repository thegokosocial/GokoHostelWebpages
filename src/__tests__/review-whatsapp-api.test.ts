import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(), get: vi.fn(), create: vi.fn(), count: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ authenticateUser: mocks.auth }));
vi.mock("@/db/queries", () => ({
  getReviewRequestByCheckinId: mocks.get, createReviewRequest: mocks.create,
  recordWhatsAppSent: mocks.count,
}));
import { POST } from "@/app/api/admin/reviews/route";

function send(contact: unknown = "+44 7700 900123") {
  return POST(new NextRequest("https://goko.test/api/admin/reviews", {
    method: "POST", body: JSON.stringify({ action: "sendWhatsApp", password: "test", username: "admin", checkinId: 7, guestName: "Ada", guestContact: contact }),
  }));
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue({ role: "admin", permissions: {} });
  mocks.get.mockResolvedValue({ id: 1, token: "review-token", whatsappSentCount: 1 });
});
describe("review message preparation API", () => {
  it.each(["123", "not a number", 1234567890])("rejects invalid contact %s before mutation", async (contact) => {
    expect((await send(contact)).status).toBe(400);
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.count).not.toHaveBeenCalled();
  });
  it("reuses the token and retains the compatibility response", async () => {
    const response = await send();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, token: "review-token", sentCount: 1 });
    expect(mocks.count).toHaveBeenCalledExactlyOnceWith(1);
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("creates a review token before counting a first preparation", async () => {
    mocks.get.mockResolvedValueOnce(null).mockResolvedValue({ id: 2, token: "new-token", whatsappSentCount: 1 });
    expect((await send()).status).toBe(200);
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.count).toHaveBeenCalledExactlyOnceWith(2);
  });
  it("preserves authentication and review permissions", async () => {
    mocks.auth.mockResolvedValueOnce(null);
    expect((await send()).status).toBe(401);
    mocks.auth.mockResolvedValueOnce({ role: "staff", permissions: {} });
    expect((await send()).status).toBe(403);
    expect(mocks.count).not.toHaveBeenCalled();
  });
});
