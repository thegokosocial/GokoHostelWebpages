import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SQLite from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { getTableConfig } from "drizzle-orm/sqlite-core";
import { NextRequest } from "next/server";
import { createHash } from "node:crypto";
import * as schema from "@/db/schema";
import { WEBSITE_BOOKING_SETTINGS_KEY } from "@/lib/websiteBookingSettings";

const state = vi.hoisted(() => ({ db: undefined as unknown, role: "admin", pi: false }));
vi.mock("@/db/index", () => ({ getDb: () => state.db }));
vi.mock("@/lib/auth", () => ({ authenticateUser: async () => ({ role: state.role, permissions: {} }) }));
vi.mock("@/lib/runtime", () => ({ isPiRuntime: () => state.pi }));

// Unlike the foundation unit tests, queries below are real Drizzle queries on
// disposable SQLite. Authentication is stubbed; no production database is used.
import { getSetting, setSetting, upsertChannelConfig } from "@/db/queries";
import { POST as settingsApi } from "@/app/api/admin/booking-settings/route";
import { compareAndSetWebsiteSettings } from "@/lib/websiteBookingSettingsStore";
import { GET as configApi } from "@/app/api/booking/config/route";
import { GET as destinationApi } from "@/app/api/booking/destination/route";

let sqlite: SQLite.Database;
function request(action: string, settings?: unknown, suppliedRevision?: string) {
  const raw = sqlite.open ? (sqlite.prepare("SELECT value FROM settings WHERE key=?").get(WEBSITE_BOOKING_SETTINGS_KEY) as { value: string } | undefined)?.value ?? null : null;
  const revision = suppliedRevision ?? createHash("sha256").update(raw === null ? "missing" : `saved:${raw}`).digest("hex");
  return new NextRequest("https://review.invalid/api/admin/booking-settings", {
    method: "POST", body: JSON.stringify({ password: "DUMMY_REVIEW_AUTH", action, settings, revision }),
    headers: { "Content-Type": "application/json" },
  });
}
async function configure(url: string) {
  await upsertChannelConfig({ hotelCode: "DUMMY", pmsId: "review", apiBaseUrl: "https://api.example", apiUsername: "review", apiPassword: "DUMMY_PRIVATE_API", webhookSecret: "DUMMY_PRIVATE_HOOK", bookingEngineUrl: url, isActive: 0 });
}

beforeEach(() => {
  state.role = "admin"; state.pi = false;
  sqlite = new SQLite(":memory:");
  // Generate minimal disposable tables from the actual source column definitions.
  // No migration or data change occurs outside this in-memory database.
  for (const table of [schema.settings, schema.channelConfig]) {
    const config = getTableConfig(table);
    const columns = config.columns.map((column) => `"${column.name}" ${column.getSQLType()}${column.primary ? " PRIMARY KEY" : ""}${column.notNull ? " NOT NULL" : ""}`);
    sqlite.exec(`CREATE TABLE "${config.name}" (${columns.join(", ")})`);
  }
  state.db = drizzle(sqlite, { schema });
  vi.stubEnv("RAZORPAY_LIVE_KEY_ID", "rzp_live_DUMMY_PUBLIC");
  vi.stubEnv("RAZORPAY_LIVE_KEY_SECRET", "DUMMY_PRIVATE_KEY");
  vi.stubEnv("RAZORPAY_LIVE_WEBHOOK_SECRET", "DUMMY_PRIVATE_GATEWAY_HOOK");
});
afterEach(() => { if (sqlite.open) sqlite.close(); vi.unstubAllEnvs(); });

describe("Real SQLite website booking foundation workflows", () => {
  it("rejects a stale administrator edit without losing the first editor's changes", async () => {
    const loaded = await (await settingsApi(request("getSettings"))).json();
    expect(loaded.revision).toMatch(/^[a-f0-9]{64}$/);
    expect((await settingsApi(request("saveSettings", { advancePercent: 75 }, loaded.revision))).status).toBe(200);
    const response = await settingsApi(request("saveSettings", { advancePercent: 20 }, loaded.revision));
    expect(response.status).toBe(409); expect(await response.json()).toMatchObject({ code: "BOOKING_SETTINGS_CONFLICT" });
    expect(JSON.parse((await getSetting(WEBSITE_BOOKING_SETTINGS_KEY))!).advancePercent).toBe(75);
  });
  it("requires a supplied revision for old save clients instead of silently overwriting a policy", async () => {
    const response = await settingsApi(new NextRequest("https://review.invalid/api/admin/booking-settings", {
      method: "POST", body: JSON.stringify({ password: "DUMMY_REVIEW_AUTH", action: "saveSettings", settings: {} }),
    }));
    expect(response.status).toBe(409); expect(await getSetting(WEBSITE_BOOKING_SETTINGS_KEY)).toBeNull();
  });
  it("single-statement compare-and-set rejects an intervening create or update", async () => {
    expect(await compareAndSetWebsiteSettings(null, '{"advancePercent":75}')).toBe(true);
    expect(await compareAndSetWebsiteSettings(null, '{"advancePercent":10}')).toBe(false);
    const previous = await getSetting(WEBSITE_BOOKING_SETTINGS_KEY);
    expect(await compareAndSetWebsiteSettings(previous, '{"advancePercent":50}')).toBe(true);
    expect(await compareAndSetWebsiteSettings(previous, '{"advancePercent":20}')).toBe(false);
    expect(await getSetting(WEBSITE_BOOKING_SETTINGS_KEY)).toBe('{"advancePercent":50}');
  });
  it("concurrent administrators using the same revision cannot save different drafts", async () => {
    const loaded = await (await settingsApi(request("getSettings"))).json();
    const edits = [25, 50, 75].map((advancePercent) => request("saveSettings", { advancePercent }, loaded.revision));
    const responses = await Promise.all(edits.map((r) => settingsApi(r)));
    expect(responses.filter((r) => r.status === 200)).toHaveLength(1);
    expect(responses.filter((r) => r.status === 409)).toHaveLength(2);
  });
  it("round-trips draft policy and environment through the actual API and query layer", async () => {
    expect((await settingsApi(request("saveSettings", { advancePercent: 75, gatewayEnvironment: "live", policyText: "Reviewed draft only" }))).status).toBe(200);
    const saved = JSON.parse((await getSetting(WEBSITE_BOOKING_SETTINGS_KEY))!);
    expect(saved).toMatchObject({ advancePercent: 75, gatewayEnvironment: "live", policyText: "Reviewed draft only" });
    const result = await (await settingsApi(request("getSettings"))).json();
    expect(result.settings).toEqual(saved);
    expect(result.gateway.credentialsConfigured).toBe(true);
    expect(result.gateway.nativeCheckoutReady).toBe(false);
    expect(JSON.stringify(result)).not.toContain("DUMMY_PRIVATE");
  });
  it("retries an identical saved draft without creating a second settings row", async () => {
    for (let retry = 0; retry < 5; retry++) expect((await settingsApi(request("saveSettings", { advancePercent: 100 }))).status).toBe(200);
    expect(sqlite.prepare("SELECT count(*) n FROM settings WHERE key = ?").get(WEBSITE_BOOKING_SETTINGS_KEY)).toEqual({ n: 1 });
  });
  it("preserves unrelated settings when a booking draft changes", async () => {
    await setSetting("booking_tax_rate", "12");
    await settingsApi(request("saveSettings", { advancePercent: 20 }));
    expect(await getSetting("booking_tax_rate")).toBe("12");
  });
  it("preserves other policy fields during a partial settings update", async () => {
    await settingsApi(request("saveSettings", { advancePercent: 75, gatewayEnvironment: "live", policyText: "Custom policy", allowPayAtProperty: false }));
    await settingsApi(request("saveSettings", { advancePercent: 25 }));
    expect(JSON.parse((await getSetting(WEBSITE_BOOKING_SETTINGS_KEY))!)).toMatchObject({ advancePercent: 25, gatewayEnvironment: "live", policyText: "Custom policy", allowPayAtProperty: false });
  });
  it.each(["", "not-json", "null", "[]", '{"advancePercent":101}', '{"keySecret":"DUMMY_PRIVATE"}'])("fails closed on invalid persisted draft %s without overwriting it", async (raw) => {
    await setSetting(WEBSITE_BOOKING_SETTINGS_KEY, raw);
    for (const action of ["getSettings", "checkGatewayReadiness", "saveSettings"]) {
      const response = await settingsApi(request(action, {}));
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ code: "BOOKING_SETTINGS_INVALID" });
      expect(await getSetting(WEBSITE_BOOKING_SETTINGS_KEY)).toBe(raw);
    }
  });
  it.each([null, [], "invalid", 42])("rejects malformed update payload %s without saving", async (settings) => {
    expect((await settingsApi(request("saveSettings", settings))).status).toBe(400);
    expect(await getSetting(WEBSITE_BOOKING_SETTINGS_KEY)).toBeNull();
  });
  it("rejects invalid updates and leaves the previously saved policy unchanged", async () => {
    await settingsApi(request("saveSettings", { advancePercent: 75 }));
    const original = await getSetting(WEBSITE_BOOKING_SETTINGS_KEY);
    expect((await settingsApi(request("saveSettings", { advancePercent: 101 }))).status).toBe(400);
    expect(await getSetting(WEBSITE_BOOKING_SETTINGS_KEY)).toBe(original);
  });
  it("stores policy text using parameter binding, not SQL execution", async () => {
    const policyText = "'; DROP TABLE settings; --";
    expect((await settingsApi(request("saveSettings", { policyText }))).status).toBe(200);
    expect(JSON.parse((await getSetting(WEBSITE_BOOKING_SETTINGS_KEY))!).policyText).toBe(policyText);
    expect(sqlite.prepare("SELECT count(*) n FROM settings").get()).toEqual({ n: 1 });
  });
  it("enforces manager and Pi denial before a settings write", async () => {
    state.role = "manager";
    expect((await settingsApi(request("saveSettings", {}))).status).toBe(403);
    state.role = "admin"; state.pi = true;
    expect((await settingsApi(request("saveSettings", {}))).status).toBe(403);
    expect(sqlite.prepare("SELECT count(*) n FROM settings").get()).toEqual({ n: 0 });
  });
  it("switches external → native → blank using actual persisted channel configuration", async () => {
    for (const [saved, mode, expected] of [
      ["https://guest.example/book?hotel=goko", "external", "https://guest.example/book?hotel=goko"],
      ["/book", "native", "https://www.gokohostel.com/book"],
      ["", "enquiry", "https://www.gokohostel.com/booking-enquiry"],
    ]) {
      await configure(saved);
      const config = await (await configApi()).json();
      expect(config.mode).toBe(mode);
      expect(config.nativeCheckoutReady).toBe(false);
      expect(JSON.stringify(config)).not.toContain("DUMMY_PRIVATE");
      expect((await destinationApi()).headers.get("location")).toBe(expected);
    }
    expect(sqlite.prepare("SELECT count(*) n FROM channel_config").get()).toEqual({ n: 1 });
  });
  it("historically saved unsafe URLs fail closed on public reads", async () => {
    await configure("javascript:alert(1)");
    expect((await configApi()).status).toBe(503);
    expect((await destinationApi()).headers.get("location")).toBe("https://www.gokohostel.com/booking-enquiry");
  });
  it("public configuration SQL does not select integration passwords or webhook secrets", async () => {
    await configure("/book");
    const spy = vi.spyOn(sqlite, "prepare");
    try {
      expect((await configApi()).status).toBe(200);
      const queries = spy.mock.calls.map(([sql]) => sql).join("\n");
      expect(queries).toContain('"booking_engine_url"');
      expect(queries).not.toContain('"api_password"');
      expect(queries).not.toContain('"webhook_secret"');
    } finally { spy.mockRestore(); }
  });
  it("actual storage failures cannot report a successful save", async () => {
    sqlite.close();
    expect((await settingsApi(request("saveSettings", {}))).status).toBe(500);
    expect((await configApi()).status).toBe(503);
    expect((await destinationApi()).headers.get("location")).toBe("https://www.gokohostel.com/booking-enquiry");
  });
});
