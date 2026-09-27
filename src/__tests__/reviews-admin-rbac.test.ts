import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const q = vi.hoisted(() => ({
  authenticateUser: vi.fn(),
  getSetting: vi.fn(),
  setSetting: vi.fn(),
  getReviewRequestByCheckinId: vi.fn(),
  createReviewRequest: vi.fn(),
  recordWhatsAppSent: vi.fn(),
  getReviewFeedbackList: vi.fn(),
  getReviewAnalytics: vi.fn(),
  getDb: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ authenticateUser: q.authenticateUser }));
vi.mock("@/db/queries", () => ({
  getSetting: q.getSetting,
  setSetting: q.setSetting,
  getReviewRequestByCheckinId: q.getReviewRequestByCheckinId,
  createReviewRequest: q.createReviewRequest,
  recordWhatsAppSent: q.recordWhatsAppSent,
  getReviewFeedbackList: q.getReviewFeedbackList,
  getReviewAnalytics: q.getReviewAnalytics,
  getReviewRequestsForAdmin: vi.fn(async () => []),
}));
vi.mock("@/db", () => ({ getDb: q.getDb }));

import { POST } from "@/app/api/admin/reviews/route";

function req(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/admin/reviews", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: "pw", username: "staff1", ...body }),
  });
}

beforeEach(() => {
  for (const fn of Object.values(q)) fn.mockReset();
  q.getSetting.mockResolvedValue("");
  q.setSetting.mockResolvedValue(undefined);
  q.getReviewFeedbackList.mockResolvedValue([]);
  q.getReviewAnalytics.mockResolvedValue({ total: 0 });
  q.getDb.mockReturnValue({
    select: () => ({ from: () => ({ where: async () => [], orderBy: async () => [] }) }),
    update: () => ({ set: () => ({ where: async () => undefined }) }),
    delete: () => ({ where: async () => undefined }),
  });
});

describe("Reviews admin action RBAC and settings", () => {
  it("requires canViewReviews for any reviews action", async () => {
    q.authenticateUser.mockResolvedValue({ role: "staff", displayName: "No", permissions: {} });
    expect((await POST(req({ action: "getSettings" }))).status).toBe(403);
    expect((await POST(req({ action: "listResponses" }))).status).toBe(403);
  });

  it("canViewReviews alone can read but cannot send, edit, reset, or update settings", async () => {
    q.authenticateUser.mockResolvedValue({
      role: "staff", displayName: "Viewer", permissions: { canViewReviews: true },
    });
    expect((await POST(req({ action: "getSettings" }))).status).toBe(200);
    expect((await POST(req({ action: "listResponses" }))).status).toBe(200);
    expect((await POST(req({ action: "getAnalytics" }))).status).toBe(200);

    expect((await POST(req({
      action: "updateSettings", settings: { review_google_url: "https://g.page/x" },
    }))).status).toBe(403);
    expect(q.setSetting).not.toHaveBeenCalled();

    expect((await POST(req({
      action: "sendWhatsApp", checkinId: 1, guestName: "Ada", guestContact: "+44 7700 900123",
    }))).status).toBe(403);
    expect((await POST(req({ action: "editReviewRequest", reviewRequestId: 3, rating: 5 }))).status).toBe(403);
    expect((await POST(req({ action: "resetReviewRequest", checkinId: 1 }))).status).toBe(403);
  });

  it("dedicated manage/send/edit keys still require the canViewReviews entry gate", async () => {
    q.authenticateUser.mockResolvedValue({
      role: "staff",
      displayName: "NoView",
      permissions: { canManageReviewSettings: true, canSendReviewRequests: true, canEditReviewRequests: true },
    });
    expect((await POST(req({
      action: "updateSettings", settings: { review_google_url: "https://g.page/x" },
    }))).status).toBe(403);
    expect(q.setSetting).not.toHaveBeenCalled();
  });

  it("canManageReviewSettings + canViewReviews allows updateSettings and strips non-review keys", async () => {
    q.authenticateUser.mockResolvedValue({
      role: "staff",
      displayName: "Settings",
      permissions: { canViewReviews: true, canManageReviewSettings: true },
    });
    const res = await POST(req({
      action: "updateSettings",
      settings: { review_google_url: "https://g.page/x", food_tax_rate: "99", review_send_delay: "1d" },
    }));
    expect(res.status).toBe(200);
    expect(q.setSetting).toHaveBeenCalledWith("review_google_url", "https://g.page/x");
    expect(q.setSetting).toHaveBeenCalledWith("review_send_delay", "1d");
    expect(q.setSetting).not.toHaveBeenCalledWith("food_tax_rate", expect.anything());
  });

  it("rejects invalid updateSettings payload", async () => {
    q.authenticateUser.mockResolvedValue({
      role: "admin", displayName: "Admin", permissions: {},
    });
    expect((await POST(req({ action: "updateSettings", settings: null }))).status).toBe(400);
    expect(q.setSetting).not.toHaveBeenCalled();
  });

  it("canEditReviewRequests + canViewReviews allows edit and reset", async () => {
    q.authenticateUser.mockResolvedValue({
      role: "staff",
      displayName: "Editor",
      permissions: { canViewReviews: true, canEditReviewRequests: true },
    });
    expect((await POST(req({ action: "editReviewRequest", reviewRequestId: 3, rating: 5 }))).status).toBe(200);
    expect((await POST(req({ action: "resetReviewRequest", checkinId: 12 }))).status).toBe(200);
  });

  it("editReviewRequest requires reviewRequestId; reset requires checkinId", async () => {
    q.authenticateUser.mockResolvedValue({ role: "admin", displayName: "Admin", permissions: {} });
    expect((await POST(req({ action: "editReviewRequest", rating: 4 }))).status).toBe(400);
    expect((await POST(req({ action: "resetReviewRequest" }))).status).toBe(400);
  });

  it("canSendReviewRequests + canViewReviews allows sendWhatsApp", async () => {
    q.authenticateUser.mockResolvedValue({
      role: "staff",
      displayName: "Sender",
      permissions: { canViewReviews: true, canSendReviewRequests: true },
    });
    q.getReviewRequestByCheckinId.mockResolvedValue({ id: 8, token: "tok", whatsappSentCount: 2 });
    const res = await POST(req({
      action: "sendWhatsApp",
      checkinId: 7,
      guestName: "Ada",
      guestContact: "+44 7700 900123",
    }));
    expect(res.status).toBe(200);
    expect(q.recordWhatsAppSent).toHaveBeenCalledWith(8);
  });
});
