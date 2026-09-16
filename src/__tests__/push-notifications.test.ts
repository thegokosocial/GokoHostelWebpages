import { describe, expect, it, vi } from "vitest";
import { runInNewContext } from "node:vm";
import * as fs from "fs";
import * as path from "path";
import { buildPushPayload, notificationDate, notificationFirstName, notificationFoodBody, notificationFoodItems, notificationStayDates } from "@/lib/pushNotify";

const ROOT = path.resolve(__dirname, "../..");

function worker() {
  const handlers: Record<string, (event: any) => void> = {};
  const showNotification = vi.fn().mockResolvedValue(undefined);
  const openWindow = vi.fn().mockResolvedValue(undefined);
  const matchAll = vi.fn().mockResolvedValue([]);
  const error = vi.fn();
  runInNewContext(fs.readFileSync(path.join(ROOT, "public/sw.js"), "utf8"), {
    self: { location: { origin: "https://gokohostel.com" }, registration: { showNotification },
      clients: { matchAll, openWindow }, addEventListener: (type: string, handler: any) => { handlers[type] = handler; } },
    URL, crypto, Date, console: { error }, setInterval, clearInterval,
  });
  return { showNotification, openWindow, matchAll, error, async emit(type: string, data: any) {
    let task: Promise<unknown> | undefined;
    handlers[type]({ ...data, waitUntil: (promise: Promise<unknown>) => { task = promise; } });
    await task;
  } };
}

describe("push notification payloads", () => {
  it("keeps useful content, safe admin links, and unique event identity", () => {
    const payload = buildPushPayload({
      title: "  New   Booking ",
      body: "Ada · 2026-09-05–2026-09-08",
      url: "/admin?section=bookings",
      eventId: "booking-42",
      category: "booking",
    });

    expect(payload).toMatchObject({
      title: "New Booking",
      body: "Ada · 2026-09-05–2026-09-08",
      url: "/admin?section=bookings",
      tag: "booking-booking-42",
      eventId: "booking-42",
      renotify: true,
      badge: "/icons/notification-badge.png",
    });
  });

  it("falls back safely and keeps recurring operational alerts quiet", () => {
    const payload = buildPushPayload({
      title: " ", body: " ", url: "https://example.com", tag: "channel-failure",
      category: "operations",
    });
    expect(payload.title).toBe("Goko");
    expect(payload.body).toBe("You have a new update");
    expect(payload.url).toBe("/admin");
    expect(payload.renotify).toBe(false);
  });

  it("limits lock-screen names to a first name", () => {
    expect(notificationFirstName("Ada Lovelace")).toBe("Ada");
    expect(notificationFirstName("")).toBe("Guest");
  });

  it.each(["Dorm 1 · Bed DOR-3", "Table 4", ""])("includes the name alongside location %s", (location) => {
    expect(notificationFoodBody("Ada Lovelace", [{ itemName: "Chai", quantity: 2 }], location, 60000, true))
      .toBe(["Ada", "2× Chai", location, "₹600", "Approval needed"].filter(Boolean).join(" · "));
    const long = notificationFoodBody(null, Array.from({ length: 20 }, () => ({ itemName: "x".repeat(60), quantity: 1 })), location, 60000);
    expect(long).toMatch(/^Guest · /);
    expect(long).toContain("…");
    expect(long).toContain("₹600");
  });

  it.each(["/administrator", "//evil.com/admin", "/admin\\evil", "/admin?x=\n"])("rejects unsafe sender link %s", (url) => {
    expect(buildPushPayload({ title: "Order", body: "Update", url }).url).toBe("/admin");
  });

  it("executes normalization and preserves distinct legacy identities", async () => {
    const sw = worker();
    const data = { json: () => ({ title: "   ", body: {}, timestamp: -1, url: "https://evil.com/admin" }) };
    await sw.emit("push", { data });
    await sw.emit("push", { data });
    const [title, options] = sw.showNotification.mock.calls[0];
    expect(title).toBe("Goko");
    expect(options).toMatchObject({ body: "You have a new update", data: { url: "/admin" }, icon: "/icons/icon-192.png" });
    expect(options.timestamp).toBeGreaterThan(0);
    expect(options.tag).not.toBe(sw.showNotification.mock.calls[1][1].tag);
  });

  it("supports malformed plain-text and empty pushes", async () => {
    const sw = worker();
    await sw.emit("push", { data: { json: () => { throw new Error(); }, text: () => "  Kitchen   update " } });
    expect(sw.showNotification.mock.calls[0][1].body).toBe("Kitchen update");
    await sw.emit("push", {});
    expect(sw.showNotification.mock.calls[1][1].body).toBe("You have a new update");
  });

  it("keeps branding before minimal fallback and catches terminal display failure", async () => {
    const sw = worker();
    sw.showNotification.mockRejectedValue(new Error("unsupported"));
    await sw.emit("push", { data: { json: () => ({ title: "Order", body: "Ada", tag: "food-42" }) } });
    expect(sw.showNotification).toHaveBeenCalledTimes(3);
    expect(sw.showNotification.mock.calls[1][1]).toMatchObject({ icon: "/icons/icon-192.png", tag: "food-42" });
    expect(sw.showNotification.mock.calls[1][1]).not.toHaveProperty("vibrate");
    expect(sw.showNotification.mock.calls[2][1]).toEqual({ body: "Ada", data: { url: "/admin" } });
    expect(sw.error).toHaveBeenCalledWith("Goko notification display failed");
  });

  it("revalidates click URLs and focuses only same-origin admin windows", async () => {
    const sw = worker();
    const focus = vi.fn();
    const navigate = vi.fn();
    sw.matchAll.mockResolvedValue([{ url: "https://evil.com/admin", focus }, { url: "https://gokohostel.com/admin", focus, navigate }]);
    await sw.emit("notificationclick", { notification: { close: vi.fn(), data: { url: "https://evil.com" } } });
    expect(navigate).toHaveBeenCalledWith("/admin");
    expect(focus).toHaveBeenCalledTimes(1);
    sw.matchAll.mockResolvedValue([]);
    await sw.emit("notificationclick", { notification: { close: vi.fn(), data: { url: "/admin?section=foodOrders" } } });
    expect(sw.openWindow).toHaveBeenCalledWith("/admin?section=foodOrders");
  });

  it("formats operational details for a small lock screen", () => {
    expect(notificationFoodItems([
      { itemName: "Masala Dosa", quantity: 2 },
      { itemName: "Chai", quantity: 1 },
    ])).toBe("2× Masala Dosa, 1× Chai");
    expect(notificationDate("2026-09-03")).toBe("3 Sept");
    expect(notificationStayDates("2026-09-03", "2026-09-04")).toBe("3 Sept → 4 Sept");
    expect(buildPushPayload({ title: "Order", body: "x".repeat(500) }).body).toHaveLength(500);
  });

  it("notifies for admin-created food orders and retries portable display options", () => {
    const adminOrders = fs.readFileSync(path.join(ROOT, "src/app/api/admin/food-orders/route.ts"), "utf8");
    const worker = fs.readFileSync(path.join(ROOT, "public/sw.js"), "utf8");
    expect(adminOrders).toContain('eventId: `admin-food-order-${order.id}`');
    expect(adminOrders).toContain('title: "New Food Order"');
    expect(worker).toContain("await self.registration.showNotification(title, { body, data: { url } })");
  });
});
