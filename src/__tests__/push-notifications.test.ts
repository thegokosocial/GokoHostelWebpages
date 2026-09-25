import { describe, expect, it, vi } from "vitest";
import { runInNewContext } from "node:vm";
import * as fs from "fs";
import * as path from "path";
import { buildPushPayload, notificationDate, notificationFirstName, notificationFoodBody, notificationFoodItems, notificationReconciliationBody, notificationStayDates, pushSubscriptionEligible, pushSubscriptionTargetsUser } from "@/lib/pushNotify";
import { allowedNotificationCategories, NOTIFICATION_CATEGORIES, NOTIFICATION_TYPE_IDS, parseMutedNotificationTypes, withDefaultNotificationPermissions } from "@/lib/notificationCatalog";

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
  it("matches PWA manifest icon sizes to the PNG assets", () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "public/manifest.webmanifest"), "utf8"));
    for (const icon of manifest.icons) {
      const image = fs.readFileSync(path.join(ROOT, "public", icon.src));
      expect(image.subarray(1, 4).toString(), icon.src).toBe("PNG");
      expect(`${image.readUInt32BE(16)}x${image.readUInt32BE(20)}`, icon.src).toBe(icon.sizes);
    }
  });

  it("keeps useful content, safe admin links, and unique event identity", () => {
    const payload = buildPushPayload({
      notificationType: "booking.new",
      title: "  New   Booking ",
      body: "Ada · 2026-09-05–2026-09-08",
      url: "/admin?section=bookings",
      eventId: "booking-42",
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
      notificationType: "operations.channel_booking_sync_failed",
      title: " ", body: " ", url: "https://example.com", tag: "channel-failure",
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
    expect(buildPushPayload({ notificationType: "food.new_order", title: "Order", body: "Update", url }).url).toBe("/admin");
  });

  it("executes normalization and preserves distinct legacy identities", async () => {
    const sw = worker();
    const data = { json: () => ({ title: "   ", body: {}, timestamp: -1, url: "https://evil.com/admin" }) };
    await sw.emit("push", { data });
    await sw.emit("push", { data });
    const [title, options] = sw.showNotification.mock.calls[0];
    expect(title).toBe("Goko");
    expect(options).toMatchObject({
      body: "You have a new update",
      data: { url: "/admin" },
      icon: "/icons/icon-192.png",
      badge: "/icons/notification-badge.png",
      vibrate: [200, 100, 200],
    });
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

  it("retains branded icon, badge, and vibration when only optional fields fail", async () => {
    const sw = worker();
    sw.showNotification.mockRejectedValueOnce(new Error("unsupported optional fields"));
    await sw.emit("push", { data: { json: () => ({ title: "Order", body: "Ada", tag: "food-42" }) } });
    expect(sw.showNotification).toHaveBeenCalledTimes(2);
    expect(sw.showNotification.mock.calls[1][1]).toMatchObject({
      icon: "/icons/icon-192.png",
      badge: "/icons/notification-badge.png",
      vibrate: [200, 100, 200],
      tag: "food-42",
    });
  });

  it("drops unsupported vibration before falling back to a branded notification", async () => {
    const sw = worker();
    sw.showNotification
      .mockRejectedValueOnce(new Error("unsupported vibration"))
      .mockRejectedValueOnce(new Error("unsupported vibration"));
    await sw.emit("push", { data: { json: () => ({ title: "Order", body: "Ada", tag: "food-42" }) } });
    expect(sw.showNotification).toHaveBeenCalledTimes(3);
    expect(sw.showNotification.mock.calls[2][1]).toMatchObject({
      icon: "/icons/icon-192.png",
      badge: "/icons/notification-badge.png",
      tag: "food-42",
    });
    expect(sw.showNotification.mock.calls[2][1]).not.toHaveProperty("vibrate");
  });

  it("keeps the main icon if a platform rejects the notification badge", async () => {
    const sw = worker();
    sw.showNotification
      .mockRejectedValueOnce(new Error("unsupported options"))
      .mockRejectedValueOnce(new Error("unsupported options"))
      .mockRejectedValueOnce(new Error("unsupported options"));
    await sw.emit("push", { data: { json: () => ({ title: "Order", body: "Ada", tag: "food-42" }) } });
    expect(sw.showNotification).toHaveBeenCalledTimes(4);
    expect(sw.showNotification.mock.calls[3][1]).toMatchObject({
      icon: "/icons/icon-192.png",
      tag: "food-42",
      data: { url: "/admin" },
    });
    expect(sw.showNotification.mock.calls[3][1]).not.toHaveProperty("badge");
  });

  it("keeps minimal fallback and catches terminal display failure", async () => {
    const sw = worker();
    sw.showNotification.mockRejectedValue(new Error("unsupported"));
    await sw.emit("push", { data: { json: () => ({ title: "Order", body: "Ada", tag: "food-42" }) } });
    expect(sw.showNotification).toHaveBeenCalledTimes(5);
    expect(sw.showNotification.mock.calls[2][1]).toMatchObject({ icon: "/icons/icon-192.png", badge: "/icons/notification-badge.png" });
    expect(sw.showNotification.mock.calls[4][1]).toEqual({ body: "Ada", data: { url: "/admin" } });
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
    expect(notificationReconciliationBody("2026-09-20", 2)).toBe("20 Sept has not been reconciled. 2 accounts are still pending.");
    expect(notificationReconciliationBody("2026-09-20", 1)).toBe("20 Sept has not been reconciled. 1 account is still pending.");
    expect(buildPushPayload({ notificationType: "food.new_order", title: "Order", body: "x".repeat(500) }).body).toHaveLength(500);
  });

  it("notifies for admin-created food orders and retries portable display options", () => {
    const adminOrders = fs.readFileSync(path.join(ROOT, "src/app/api/admin/food-orders/route.ts"), "utf8");
    const worker = fs.readFileSync(path.join(ROOT, "public/sw.js"), "utf8");
    expect(adminOrders).toContain('eventId: `admin-food-order-${order.id}`');
    expect(adminOrders).toContain('title: "New Food Order"');
    expect(worker).toContain("{ body, data: { url } }");
  });
});

describe("notification preference eligibility", () => {
  const all = new Map([["staff-a", { role: "staff", permissions: {} }]]);

  it("keeps every legacy category enabled and gives new users explicit grants", () => {
    expect(allowedNotificationCategories("staff", {})).toEqual(NOTIFICATION_CATEGORIES.map((category) => category.id));
    expect(allowedNotificationCategories("staff", null)).toEqual(NOTIFICATION_CATEGORIES.map((category) => category.id));
    const defaults = withDefaultNotificationPermissions({ canViewBookings: true });
    expect(defaults.canViewBookings).toBe(true);
    for (const category of NOTIFICATION_CATEGORIES) expect(defaults[category.permission]).toBe(true);
  });

  it("enforces admin grants before per-device choices", () => {
    const recipients = new Map([["staff-a", { role: "staff", permissions: { canReceiveBookingNotifications: true, canReceiveFoodNotifications: false } }]]);
    expect(pushSubscriptionEligible({ userLabel: "staff-a", mutedNotificationTypes: "[]" }, "booking.new", recipients)).toBe(true);
    expect(pushSubscriptionEligible({ userLabel: "staff-a", mutedNotificationTypes: "[]" }, "food.new_order", recipients)).toBe(false);
    expect(pushSubscriptionEligible({ userLabel: "staff-a", mutedNotificationTypes: '["booking.new"]' }, "booking.new", recipients)).toBe(false);
  });

  it("treats the first category key as an explicit allowlist and keeps the admin bypass", () => {
    expect(allowedNotificationCategories("staff", { canReceiveFoodNotifications: true })).toEqual(["food"]);
    expect(allowedNotificationCategories("staff", { canReceiveFoodNotifications: false })).toEqual([]);
    expect(allowedNotificationCategories("admin", { canReceiveFoodNotifications: false })).toEqual(NOTIFICATION_CATEGORIES.map((category) => category.id));
  });

  it.each([
    ["legacy all-enabled", {}, "[]", "booking.new", true],
    ["explicit booking grant", { canReceiveBookingNotifications: true, canReceiveFoodNotifications: false }, "[]", "booking.new", true],
    ["admin food denial", { canReceiveBookingNotifications: true, canReceiveFoodNotifications: false }, "[]", "food.new_order", false],
    ["device booking mute", { canReceiveBookingNotifications: true }, '["booking.new"]', "booking.new", false],
    ["unrelated device mute", { canReceiveBookingNotifications: true }, '["booking.modified"]', "booking.new", true],
  ] as const)("evaluates the %s delivery matrix", (_name, permissions, mutedNotificationTypes, type, expected) => {
    const recipients = new Map([["staff-a", { role: "staff", permissions: { ...permissions } }]]);
    expect(pushSubscriptionEligible({ userLabel: "staff-a", mutedNotificationTypes }, type, recipients)).toBe(expected);
  });

  it("combines role restrictions, ownership, and test bypass safely", () => {
    expect(pushSubscriptionEligible({ userLabel: "staff-a" }, "booking.new", all, ["admin", "manager"])).toBe(false);
    expect(pushSubscriptionEligible({ userLabel: "deleted" }, "booking.new", all)).toBe(false);
    expect(pushSubscriptionEligible({ userLabel: "staff-a", mutedNotificationTypes: JSON.stringify(NOTIFICATION_TYPE_IDS) }, "system.test", all)).toBe(true);
  });

  it("targets only subscriptions owned by the requested task recipients", () => {
    const targets = new Set(["staff-a", "manager"]);
    expect(pushSubscriptionTargetsUser({ userLabel: "staff-a" }, targets)).toBe(true);
    expect(pushSubscriptionTargetsUser({ userLabel: "staff-b" }, targets)).toBe(false);
    expect(pushSubscriptionTargetsUser({ userLabel: "staff-b" })).toBe(true);
  });

  it("maps every catalog event to its grant and device mute", () => {
    for (const category of NOTIFICATION_CATEGORIES) {
      const recipients = new Map([["staff-a", { role: "staff", permissions: { [category.permission]: true } }]]);
      for (const [type] of category.events) {
        expect(pushSubscriptionEligible({ userLabel: "staff-a", mutedNotificationTypes: "[]" }, type, recipients), type).toBe(true);
        expect(pushSubscriptionEligible({ userLabel: "staff-a", mutedNotificationTypes: JSON.stringify([type]) }, type, recipients), type).toBe(false);
      }
    }
  });

  it("keeps attention and reminder wire behavior operational while grants remain distinct", () => {
    expect(buildPushPayload({ notificationType: "attention.booking", title: "Attention", body: "x" })).toMatchObject({ category: "operations", renotify: false });
    expect(buildPushPayload({ notificationType: "reminder.reconciliation_pending", title: "Reminder", body: "x", renotify: true })).toMatchObject({ category: "operations", renotify: true });
  });

  it("fails malformed and future muted values open without accepting unknown IDs", () => {
    expect(parseMutedNotificationTypes("bad json")).toEqual([]);
    expect(parseMutedNotificationTypes('["booking.new","future.event","booking.new"]')).toEqual(["booking.new"]);
  });
});
