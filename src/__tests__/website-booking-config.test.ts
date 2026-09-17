import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createHash } from "node:crypto";
import { bookingDestination, NATIVE_BOOKING_URL } from "@/lib/bookingDestination";
import { websiteBookingSettingsSchema, gatewayConfiguration } from "@/lib/websiteBookingSettings";

const mocks = vi.hoisted(() => ({
  getChannelConfig: vi.fn(), getSetting: vi.fn(), setSetting: vi.fn(),
  upsertChannelConfig: vi.fn(),
  authenticateUser: vi.fn(), isPiRuntime: vi.fn(),
  compareAndSetWebsiteSettings: vi.fn(),
}));
vi.mock("@/lib/websiteBookingSettingsStore", () => ({ compareAndSetWebsiteSettings: mocks.compareAndSetWebsiteSettings }));
vi.mock("@/db/queries", () => ({
  getGuestBookingConfig: mocks.getChannelConfig,
  getChannelConfig: mocks.getChannelConfig, getSetting: mocks.getSetting, setSetting: mocks.setSetting,
  upsertChannelConfig: mocks.upsertChannelConfig,
}));
vi.mock("@/lib/auth", () => ({ authenticateUser: mocks.authenticateUser }));
vi.mock("@/lib/runtime", () => ({ isPiRuntime: mocks.isPiRuntime }));

import { GET as getConfig } from "@/app/api/booking/config/route";
import { GET as redirectDestination } from "@/app/api/booking/destination/route";
import { POST as bookingSettings } from "@/app/api/admin/booking-settings/route";
import { POST as channelManager } from "@/app/api/admin/channel-manager/route";

function request(body: unknown) {
  if (body && typeof body === "object" && "action" in body && body.action === "saveSettings" && !("revision" in body)) {
    body = { ...body, revision: createHash("sha256").update("missing").digest("hex") };
  }
  return new NextRequest("https://www.gokohostel.com/api/admin/booking-settings", {
    method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getChannelConfig.mockResolvedValue(null);
  mocks.getSetting.mockResolvedValue(null);
  mocks.compareAndSetWebsiteSettings.mockResolvedValue(true);
  mocks.authenticateUser.mockResolvedValue({ role: "admin", permissions: {} });
  mocks.isPiRuntime.mockReturnValue(false);
});

describe("Website booking destination", () => {
  it.each([undefined, null, "", "   "])("uses enquiry for empty configuration %s", (raw) => {
    expect(bookingDestination(raw)).toEqual({ mode: "enquiry", url: "/booking-enquiry" });
  });
  it.each(["/book", NATIVE_BOOKING_URL, ` ${NATIVE_BOOKING_URL} `])("recognizes the exact native link %s", (raw) => {
    expect(bookingDestination(raw)).toEqual({ mode: "native", url: "/book" });
  });
  it("preserves the full external guest engine URL and its hotel query", () => {
    const url = "https://bookingengine.stayflexi.com/?hotel_id=30819";
    expect(bookingDestination(url)).toEqual({ mode: "external", url });
  });
  it.each([
    "javascript:alert(1)", "data:text/html,hi", "http://provider.com/book", "//provider.com/book",
    "/admin", `${NATIVE_BOOKING_URL}?next=/admin`, `${NATIVE_BOOKING_URL}#pay`, "https://www.gokohostel.com/admin",
    "https://gokohostel.com/book", "https://www.gokohostel.com:444/book", "https://user:password@provider.com/book",
    "https://provider.com\\@evil.com", "https://provider.com\n/book", "https://localhost/book",
    "https://192.168.1.10/book", "https://[::1]/book", "https://intranet.local/book", {}, 42,
    "https://www.gokohostel.com./admin", "https://live.aiosell.com./", "https://intranet.local./book",
    "https://guest.localhost/book", "https:////provider.com/book",
  ])("rejects unsafe or ambiguous destination %s", (raw) => {
    expect(() => bookingDestination(raw)).toThrow();
  });
  it("does not trust a lookalike Goko subdomain as native", () => {
    expect(bookingDestination("https://www.gokohostel.com.evil.com/book").mode).toBe("external");
  });
  it("rejects the configured API base address as a guest booking link", () => {
    expect(() => bookingDestination("https://live.aiosell.com/?hotel=goko", "https://live.aiosell.com")).toThrow("guest booking engine");
    expect(bookingDestination("https://provider.com/guest/goko", "https://provider.com/api").mode).toBe("external");
    expect(() => bookingDestination("https://live.aiosell.com/", "https://live.aiosell.com./")).toThrow("guest booking engine");
  });
});

describe("Public configuration and redirect routes", () => {
  it("returns only public metadata, never the integration config", async () => {
    mocks.getChannelConfig.mockResolvedValue({ bookingEngineUrl: "/book", apiPassword: "private", webhookSecret: "secret", isActive: 0 });
    const response = await getConfig();
    expect(await response.json()).toEqual({ mode: "native", url: "/book", nativeCheckoutReady: false, configurationAvailable: true });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
  it("redirects to the configured destination independently of channel manager activation", async () => {
    mocks.getChannelConfig.mockResolvedValue({ bookingEngineUrl: "https://provider.com/guest?hotel=goko", isActive: 0 });
    const response = await redirectDestination();
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://provider.com/guest?hotel=goko");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  });
  it("refreshes the destination on each request after config changes", async () => {
    mocks.getChannelConfig.mockResolvedValueOnce({ bookingEngineUrl: "https://provider.com/guest" })
      .mockResolvedValueOnce({ bookingEngineUrl: "" });
    expect((await redirectDestination()).headers.get("location")).toBe("https://provider.com/guest");
    expect((await redirectDestination()).headers.get("location")).toBe("https://www.gokohostel.com/booking-enquiry");
  });
  it.each(["invalid", "javascript:alert(1)", "/admin"])("fails safely on historical invalid config %s", async (bookingEngineUrl) => {
    mocks.getChannelConfig.mockResolvedValue({ bookingEngineUrl });
    expect((await redirectDestination()).headers.get("location")).toBe("https://www.gokohostel.com/booking-enquiry");
  });
  it("uses enquiry on database failure without leaking errors", async () => {
    mocks.getChannelConfig.mockRejectedValue(new Error("database with credentials failed"));
    const response = await getConfig();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ mode: "enquiry", url: "/booking-enquiry", nativeCheckoutReady: false, configurationAvailable: false });
  });
});

describe("Channel Manager booking link mutations", () => {
  it("rejects an unsafe link before updating the integration", async () => {
    const response = await channelManager(request({ password: "test", action: "saveConfig", config: { bookingEngineUrl: "javascript:alert(1)" } }));
    expect(response.status).toBe(400);
    expect(mocks.upsertChannelConfig).not.toHaveBeenCalled();
  });
  it("rejects the configured API Base URL before updating the integration", async () => {
    const response = await channelManager(request({ password: "test", action: "saveConfig", config: { bookingEngineUrl: "https://live.aiosell.com/", apiBaseUrl: "https://live.aiosell.com" } }));
    expect(response.status).toBe(400);
    expect(mocks.upsertChannelConfig).not.toHaveBeenCalled();
  });
  it.each([[NATIVE_BOOKING_URL, "/book"], ["  ", ""], ["https://provider.com/guest?hotel=goko", "https://provider.com/guest?hotel=goko"]])("normalizes saved link %s", async (input, expected) => {
    const response = await channelManager(request({ password: "test", action: "saveConfig", config: { bookingEngineUrl: input, isActive: 0 } }));
    expect(response.status).toBe(200);
    expect(mocks.upsertChannelConfig).toHaveBeenCalledWith(expect.objectContaining({ bookingEngineUrl: expected }));
  });
  it("retains the existing Aiosell enablement guard", async () => {
    const response = await channelManager(request({ password: "test", action: "saveConfig", config: { bookingEngineUrl: "/book", isActive: 1, webhookSecret: "" } }));
    expect(response.status).toBe(400);
    expect(mocks.upsertChannelConfig).not.toHaveBeenCalled();
  });
});

describe("Draft booking settings", () => {
  it("has safe reviewed draft defaults", () => {
    expect(websiteBookingSettingsSchema.parse({})).toMatchObject({ advancePercent: 50, holdMinutes: 15, unresolvedPaymentMaxMinutes: 30, cancellationDeadlineHours: 48, cancellationRefundPercent: 100, gatewayEnvironment: "test" });
  });
  it.each([
    { advancePercent: -1 }, { advancePercent: 101 }, { advancePercent: 50.5 }, { holdMinutes: 20 },
    { unresolvedPaymentMaxMinutes: 31 }, { cancellationDeadlineHours: -1 }, { cancellationRefundPercent: 101 },
    { gatewayEnvironment: "other" }, { keySecret: "do-not-store" }, { enabled: true }, { policyPublished: true },
  ])("rejects invalid settings or credential injection %s", (settings) => {
    expect(websiteBookingSettingsSchema.safeParse(settings).success).toBe(false);
  });
  it("never leaks secrets in readiness metadata or activates checkout", () => {
    const readiness = gatewayConfiguration("live", {
      RAZORPAY_LIVE_KEY_ID: "rzp_live_public", RAZORPAY_LIVE_KEY_SECRET: "private-secret", RAZORPAY_LIVE_WEBHOOK_SECRET: "private-hook",
    });
    expect(readiness.credentialsConfigured).toBe(true);
    expect(readiness.nativeCheckoutReady).toBe(false);
    expect(JSON.stringify(readiness)).not.toContain("private");
  });
  it("does not accept test keys as a live public key", () => {
    expect(gatewayConfiguration("live", { RAZORPAY_LIVE_KEY_ID: "rzp_test_other" }).keyIdConfigured).toBe(false);
  });
  it("does not report blank secrets or malformed key IDs as configured", () => {
    for (const id of ["rzp_live_", "rzp_live_public\nsecret", "rzp_live_public secret"]) {
      expect(gatewayConfiguration("live", { RAZORPAY_LIVE_KEY_ID: id }).keyIdConfigured).toBe(false);
    }
    expect(gatewayConfiguration("live", { RAZORPAY_LIVE_KEY_ID: "rzp_live_public", RAZORPAY_LIVE_KEY_SECRET: "  ", RAZORPAY_LIVE_WEBHOOK_SECRET: "\n" }).credentialsConfigured).toBe(false);
  });
  it("saves only a validated draft in the existing settings table", async () => {
    const response = await bookingSettings(request({ password: "test", action: "saveSettings", settings: { advancePercent: 100 } }));
    expect(response.status).toBe(200);
    expect(mocks.compareAndSetWebsiteSettings).toHaveBeenCalledWith(null, expect.stringContaining('"advancePercent":100'));
    expect(await response.json()).toMatchObject({ policyStatus: "draft" });
  });
  it("rejects stored credentials before any database mutation", async () => {
    const response = await bookingSettings(request({ password: "test", action: "saveSettings", settings: { keySecret: "secret" } }));
    expect(response.status).toBe(400);
    expect(mocks.compareAndSetWebsiteSettings).not.toHaveBeenCalled();
  });
  it.each(["manager", "staff"])("denies %s even with broad legacy permissions", async (role) => {
    mocks.authenticateUser.mockResolvedValue({ role, permissions: { canManageInventory: true, canManageAccounts: true } });
    expect((await bookingSettings(request({ password: "test", action: "getSettings" }))).status).toBe(403);
    expect(mocks.getSetting).not.toHaveBeenCalled();
  });
  it("requires authentication", async () => {
    mocks.authenticateUser.mockResolvedValue(null);
    expect((await bookingSettings(request({ password: "bad", action: "getSettings" }))).status).toBe(401);
  });
  it("sanitizes authentication storage failures", async () => {
    mocks.authenticateUser.mockRejectedValue(new Error("sensitive storage failure"));
    const response = await bookingSettings(request({ password: "test", action: "getSettings" }));
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain("sensitive");
  });
  it("rejects malformed body", async () => {
    expect((await bookingSettings(request(null))).status).toBe(401);
  });
  it("rejects Pi writes", async () => {
    mocks.isPiRuntime.mockReturnValue(true);
    expect((await bookingSettings(request({ password: "test", action: "saveSettings", settings: {} }))).status).toBe(403);
    expect(mocks.compareAndSetWebsiteSettings).not.toHaveBeenCalled();
  });
  it("labels the readiness action as configuration-only, not a live gateway check", async () => {
    const response = await bookingSettings(request({ password: "test", action: "checkGatewayReadiness" }));
    expect(await response.json()).toMatchObject({ gateway: { nativeCheckoutReady: false, status: "implementation_pending" }, message: expect.stringContaining("no payment or provider request") });
  });
  it("reports a write-time settings conflict rather than successful save", async () => {
    mocks.compareAndSetWebsiteSettings.mockResolvedValue(false);
    const response = await bookingSettings(request({ password: "test", action: "saveSettings", settings: { advancePercent: 75 } }));
    expect(response.status).toBe(409); expect(await response.json()).toMatchObject({ code: "BOOKING_SETTINGS_CONFLICT" });
  });
  it("rejects unknown actions", async () => {
    expect((await bookingSettings(request({ password: "test", action: "enableCheckout" }))).status).toBe(400);
  });
  it("returns a sanitized error on settings storage failure", async () => {
    mocks.getSetting.mockRejectedValue(new Error("sensitive database internals"));
    const response = await bookingSettings(request({ password: "test", action: "getSettings" }));
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("sensitive");
  });
});
