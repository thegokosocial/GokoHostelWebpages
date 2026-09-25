import { buildPushHTTPRequest } from "@pushforge/builder";
import { getDb } from "@/db";
import { pushSubscriptions, users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { isOfflineMode } from "@/lib/runtime";
import { allowedNotificationCategories, notificationCategoryFor, parseMutedNotificationTypes, type NotificationType } from "@/lib/notificationCatalog";

type PushPayload = {
  notificationType: NotificationType;
  title: string;
  body: string;
  url?: string;
  tag?: string;
  eventId?: string;
  renotify?: boolean;
};

export type PushDeliverySummary = {
  attempted: number;
  delivered: number;
  expired: number;
  failed: number;
  suppressed: number;
};

type PushRecipient = { role: string; permissions: Record<string, boolean> };

export function pushSubscriptionTargetsUser(subscription: { userLabel?: string | null }, usernames?: Set<string>) {
  return !usernames || usernames.has(subscription.userLabel || "admin");
}

export function pushSubscriptionEligible(
  subscription: { userLabel?: string | null; mutedNotificationTypes?: string | null },
  notificationType: NotificationType,
  recipients: Map<string, PushRecipient>,
  allowedRoles?: string[],
) {
  const recipient = recipients.get(subscription.userLabel || "admin");
  if (!recipient || allowedRoles && !allowedRoles.includes(recipient.role)) return false;
  if (notificationType === "system.test") return true;
  const category = notificationCategoryFor(notificationType);
  return category !== "test"
    && allowedNotificationCategories(recipient.role, recipient.permissions).includes(category)
    && !parseMutedNotificationTypes(subscription.mutedNotificationTypes).includes(notificationType);
}

function clean(value: unknown, max: number) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

export function notificationFirstName(name?: string | null) {
  return clean(name || "Guest", 80).split(/\s+/)[0] || "Guest";
}

export function notificationDate(date?: string | null) {
  if (!date) return "Unknown date";
  const parsed = new Date(`${date.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(parsed.getTime())
    ? clean(date, 40)
    : new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "UTC" }).format(parsed);
}

export function notificationStayDates(checkin?: string | null, checkout?: string | null) {
  return `${notificationDate(checkin)} → ${notificationDate(checkout)}`;
}

export function notificationReconciliationBody(date: string, pendingAccountCount: number) {
  return `${notificationDate(date)} has not been reconciled. ${pendingAccountCount} account${pendingAccountCount === 1 ? " is" : "s are"} still pending.`;
}

export function notificationFoodItems(items: Array<{ itemName: string; quantity: number }>) {
  return items.map((item) => `${item.quantity}× ${clean(item.itemName, 60)}`).join(", ");
}

export function notificationFoodBody(name: string | null | undefined, items: Array<{ itemName: string; quantity: number }>, location: string | null | undefined, total: number, approval = false) {
  const itemText = notificationFoodItems(items);
  return [notificationFirstName(name), itemText.length > 160 ? `${itemText.slice(0, 157)}…` : itemText,
    clean(location, 160), `₹${(total / 100).toFixed(0)}`, approval ? "Approval needed" : ""].filter(Boolean).join(" · ");
}

export function buildPushPayload(payload: PushPayload) {
  const configuredCategory = notificationCategoryFor(payload.notificationType);
  const category = configuredCategory === "attention" || configuredCategory === "reminder" ? "operations" : configuredCategory;
  const eventId = clean(payload.eventId, 120) || clean(payload.tag, 120) || crypto.randomUUID();
  return {
    title: clean(payload.title || "Goko", 80) || "Goko",
    body: clean(payload.body || "You have a new update", 1000) || "You have a new update",
    icon: "/icons/icon-192.png",
    badge: "/icons/notification-badge.png",
    url: typeof payload.url === "string" && /^\/admin(?:[?#]|$)/.test(payload.url) && !payload.url.includes("\\") && !/[\u0000-\u0020]/.test(payload.url) ? payload.url : "/admin",
    tag: clean(payload.tag, 120) || `${category}-${eventId}`,
    category,
    eventId,
    renotify: payload.renotify ?? category !== "operations",
    timestamp: Date.now(),
  };
}

async function sendPush(payload: PushPayload, allowedRoles?: Array<"admin" | "manager" | "staff">, endpoint?: string, usernames?: Set<string>): Promise<PushDeliverySummary> {
  const summary: PushDeliverySummary = { attempted: 0, delivered: 0, expired: 0, failed: 0, suppressed: 0 };
  if (isOfflineMode()) return summary;

  const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;
  if (!vapidPrivateKey) return summary;

  let privateJWK: object;
  try {
    privateJWK = JSON.parse(vapidPrivateKey);
  } catch {
    console.error("Push delivery disabled: VAPID_PRIVATE_KEY is not valid JSON");
    return summary;
  }

  const db = getDb();
  let subs = await db.select().from(pushSubscriptions);
  if (endpoint) subs = subs.filter((sub) => sub.endpoint === endpoint);
  subs = subs.filter((sub) => pushSubscriptionTargetsUser(sub, usernames));
  if (subs.length === 0) return summary;
  const userRows = await db.select({ username: users.username, role: users.role, permissions: users.permissions, deletedAt: users.deletedAt }).from(users);
  const recipients = new Map<string, PushRecipient>(userRows.filter((user) => !user.deletedAt).map((user) => {
    let permissions: Record<string, boolean> = {};
    try { permissions = JSON.parse(user.permissions || "{}"); } catch {}
    return [user.username, { role: user.role, permissions }];
  }));
  if (!recipients.has("admin")) recipients.set("admin", { role: "admin", permissions: {} });
  if (!recipients.has("manager")) recipients.set("manager", { role: "manager", permissions: {} });
  const beforePreferences = subs.length;
  subs = subs.filter((sub) => pushSubscriptionEligible(sub, payload.notificationType, recipients, allowedRoles));
  summary.suppressed = beforePreferences - subs.length;
  summary.attempted = subs.length;
  if (subs.length === 0) return summary;

  const pushPayload = buildPushPayload(payload);

  await Promise.allSettled(
    subs.map(async (sub) => {
      try {
        const subscription = {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.keyP256dh, auth: sub.keyAuth },
        };

        const { endpoint, headers, body } = await buildPushHTTPRequest({
          privateJWK,
          subscription,
          message: {
            payload: pushPayload,
            adminContact: "mailto:admin@gokohostel.com",
            options: { urgency: "high" },
          },
        });

        const res = await fetch(endpoint, { method: "POST", headers, body });

        if (res.status === 410 || res.status === 404) {
          await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, sub.endpoint));
          summary.expired++;
          return;
        }

        if (res.ok || res.status === 201) {
          summary.delivered++;
        } else {
          summary.failed++;
          console.error(`Push delivery failed: ${res.status} ${res.statusText}`);
        }
      } catch (err) {
        summary.failed++;
        console.error("Push send error:", err instanceof Error ? err.message : err);
      }
    })
  );

  return summary;
}

export function sendPushToAll(payload: PushPayload): Promise<PushDeliverySummary> {
  return sendPush(payload);
}

export function sendPushToRoles(
  payload: PushPayload,
  roles: Array<"admin" | "manager" | "staff">,
): Promise<PushDeliverySummary> {
  return sendPush(payload, roles);
}

export function sendPushToEndpoint(payload: PushPayload, endpoint: string): Promise<PushDeliverySummary> {
  return sendPush(payload, undefined, endpoint);
}

export function sendPushToUsers(payload: PushPayload, usernames: string[]): Promise<PushDeliverySummary> {
  return sendPush(payload, undefined, undefined, new Set(usernames));
}

async function deferPush(delivery: Promise<PushDeliverySummary>) {
  const safeDelivery = delivery.catch((error) => {
    console.error("Push dispatch failed:", error instanceof Error ? error.message : error);
    return { attempted: 0, delivered: 0, expired: 0, failed: 1, suppressed: 0 };
  });
  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    getCloudflareContext().ctx.waitUntil(safeDelivery);
  } catch {
    await safeDelivery;
  }
}

/** Keep Cloudflare requests fast without letting the Worker terminate delivery. */
export async function dispatchPush(payload: PushPayload) {
  await deferPush(sendPushToAll(payload));
}

export async function dispatchPushToUsers(payload: PushPayload, usernames: string[]) {
  if (usernames.length === 0) return;
  await deferPush(sendPushToUsers(payload, usernames));
}
