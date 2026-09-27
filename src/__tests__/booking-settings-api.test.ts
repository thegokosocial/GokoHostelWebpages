import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { DEFAULT_BOOKING_EMAIL_TEMPLATES } from "@/lib/bookingEmailTemplates";

const mocks = vi.hoisted(() => ({
  authenticateUser: vi.fn(),
  isPiRuntime: vi.fn(),
  getSetting: vi.fn(),
  setSetting: vi.fn(),
  compareAndSetWebsiteSettings: vi.fn(),
  evaluateNativeCheckoutReadiness: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ authenticateUser: mocks.authenticateUser }));
vi.mock("@/lib/runtime", () => ({ isPiRuntime: mocks.isPiRuntime }));
vi.mock("@/db/queries", () => ({ getSetting: mocks.getSetting, setSetting: mocks.setSetting }));
vi.mock("@/lib/websiteBookingSettingsStore", () => ({ compareAndSetWebsiteSettings: mocks.compareAndSetWebsiteSettings }));
vi.mock("@/lib/nativeCheckoutReadiness", () => ({ evaluateNativeCheckoutReadiness: mocks.evaluateNativeCheckoutReadiness }));
vi.mock("@/lib/site", () => ({ site: { url: "https://goko.test" } }));

import { POST } from "@/app/api/admin/booking-settings/route";

const admin = { role: "admin" as const, displayName: "Admin", permissions: {} };
const manager = { role: "manager" as const, displayName: "Manager", permissions: {} };

function request(body: unknown, raw = false) {
  return new NextRequest("http://localhost/api/admin/booking-settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: raw ? String(body) : JSON.stringify(body),
  });
}

describe("Booking Settings API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authenticateUser.mockResolvedValue(admin);
    mocks.isPiRuntime.mockReturnValue(false);
    mocks.getSetting.mockResolvedValue("");
    mocks.setSetting.mockResolvedValue(undefined);
    mocks.compareAndSetWebsiteSettings.mockResolvedValue(true);
    mocks.evaluateNativeCheckoutReadiness.mockResolvedValue({ gateway: "test", nativeCheckoutReady: false, blockerMessages: [] });
  });

  it("rejects malformed JSON and unauthenticated requests", async () => {
    expect((await POST(request("not-json", true))).status).toBe(400);
    mocks.authenticateUser.mockResolvedValue(null);
    expect((await POST(request({ action: "getEmailTemplates", password: "bad" }))).status).toBe(401);
  });

  it("keeps booking settings administrator-only", async () => {
    mocks.authenticateUser.mockResolvedValue(manager);
    const response = await POST(request({ action: "getEmailTemplates", password: "pw" }));
    expect(response.status).toBe(403);
  });

  it("validates email templates before saving", async () => {
    const response = await POST(request({ action: "saveEmailTemplates", password: "pw", templates: { confirmation: {} } }));
    expect(response.status).toBe(400);
    expect(mocks.setSetting).not.toHaveBeenCalled();
  });

  it("saves complete email templates and returns normalized data", async () => {
    const templates = {
      ...DEFAULT_BOOKING_EMAIL_TEMPLATES,
      confirmation: { subject: " Confirmed ", body: " Hello {GUEST_NAME} " },
    };
    const response = await POST(request({ action: "saveEmailTemplates", password: "pw", templates }));
    expect(response.status).toBe(200);
    expect((await response.json()).templates.confirmation).toEqual({ subject: "Confirmed", body: "Hello {GUEST_NAME}" });
    expect(mocks.setSetting).toHaveBeenCalledOnce();
  });

  it("rejects Pi runtime before reading settings", async () => {
    mocks.isPiRuntime.mockReturnValue(true);
    const response = await POST(request({ action: "getEmailTemplates", password: "pw" }));
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: expect.stringMatching(/Cloudflare/i) });
    expect(mocks.getSetting).not.toHaveBeenCalled();
  });

  it("returns 409 BOOKING_SETTINGS_CONFLICT when revision is stale", async () => {
    mocks.getSetting.mockResolvedValue("{}");
    mocks.compareAndSetWebsiteSettings.mockResolvedValue(false);
    // Force revision mismatch path: supply wrong revision string
    const { websiteBookingSettingsRevision } = await import("@/lib/websiteBookingSettings");
    const current = await websiteBookingSettingsRevision("{}");
    const response = await POST(request({
      action: "saveSettings",
      password: "pw",
      settings: { enabled: false },
      revision: "stale-not-" + current,
    }));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "BOOKING_SETTINGS_CONFLICT" });
    expect(mocks.compareAndSetWebsiteSettings).not.toHaveBeenCalled();
  });
});
