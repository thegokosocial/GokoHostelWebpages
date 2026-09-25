import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db";
import { pushSubscriptions } from "@/db/schema";
import { eq } from "drizzle-orm";
import { sendPushToEndpoint } from "@/lib/pushNotify";
import { isOfflineMode } from "@/lib/runtime";
import { allowedNotificationCategories, NOTIFICATION_CATEGORIES, NOTIFICATION_TYPE_IDS, parseMutedNotificationTypes } from "@/lib/notificationCatalog";

import { authenticateUser, type AuthResult } from "@/lib/auth";
import { getUserByUsername } from "@/db/queries";

async function notificationAccess(auth: AuthResult) {
  if (auth.role === "admin" || auth.username === "admin" || auth.username === "manager") {
    return NOTIFICATION_CATEGORIES.map((category) => category.id);
  }
  const user = auth.username ? await getUserByUsername(auth.username) : null;
  if (!user) return null;
  let permissions: Record<string, boolean> = {};
  try { permissions = JSON.parse(user.permissions || "{}"); } catch {}
  return allowedNotificationCategories(user.role, permissions);
}

export async function GET() {
  return NextResponse.json(
    { publicKey: process.env["NEXT_PUBLIC_VAPID_PUBLIC_KEY"] || "" },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(req: NextRequest) {
  if (isOfflineMode()) {
    return NextResponse.json({ error: "Push notifications require internet" }, { status: 503 });
  }

  try {
    const body = await req.json();
    const { action, password, username, ...rest } = body;
    const authPassword = typeof password === "string" ? password : "";
    const authUsername = typeof username === "string" ? username : undefined;

    // Admin clients clear the password after login; authenticateUser falls
    // back to the current HttpOnly session when the password is empty.
    const auth = await authenticateUser(authPassword, authUsername);
    if (!auth?.username) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const owner = auth.username;

    switch (action) {
      case "subscribe": {
        const { subscription } = rest;
        if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
          return NextResponse.json({ error: "Invalid subscription" }, { status: 400 });
        }

        const db = getDb();
        const existing = await db.select({ id: pushSubscriptions.id, userLabel: pushSubscriptions.userLabel })
          .from(pushSubscriptions)
          .where(eq(pushSubscriptions.endpoint, subscription.endpoint))
          .limit(1);

        if (existing.length > 0) {
          await db.update(pushSubscriptions).set({
            keyP256dh: subscription.keys.p256dh,
            keyAuth: subscription.keys.auth,
            userLabel: owner,
            ...((existing[0].userLabel || "admin") !== owner ? { mutedNotificationTypes: "[]" } : {}),
          }).where(eq(pushSubscriptions.endpoint, subscription.endpoint));
        } else {
          await db.insert(pushSubscriptions).values({
            endpoint: subscription.endpoint,
            keyP256dh: subscription.keys.p256dh,
            keyAuth: subscription.keys.auth,
            userLabel: owner,
            mutedNotificationTypes: "[]",
            createdAt: new Date().toISOString(),
          });
        }

        return NextResponse.json({ success: true });
      }

      case "unsubscribe": {
        const { endpoint } = rest;
        if (!endpoint) {
          return NextResponse.json({ error: "endpoint required" }, { status: 400 });
        }

        const db = getDb();
        const existing = await db.select({ userLabel: pushSubscriptions.userLabel }).from(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint)).limit(1);
        if (!existing[0] || (existing[0].userLabel || "admin") !== owner) return NextResponse.json({ error: "Subscription not found" }, { status: 404 });
        await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint));
        return NextResponse.json({ success: true });
      }

      case "getPreferences": {
        const endpoint = typeof rest.endpoint === "string" ? rest.endpoint : "";
        if (!endpoint) return NextResponse.json({ error: "endpoint required" }, { status: 400 });
        const db = getDb();
        const rows = await db.select({ userLabel: pushSubscriptions.userLabel, mutedNotificationTypes: pushSubscriptions.mutedNotificationTypes })
          .from(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint)).limit(1);
        if (!rows[0] || (rows[0].userLabel || "admin") !== owner) return NextResponse.json({ error: "Subscription not found" }, { status: 404 });
        const allowedCategories = await notificationAccess(auth);
        if (!allowedCategories) return NextResponse.json({ error: "User no longer exists" }, { status: 403 });
        return NextResponse.json({ allowedCategories, mutedNotificationTypes: parseMutedNotificationTypes(rows[0].mutedNotificationTypes) });
      }

      case "updatePreferences": {
        const endpoint = typeof rest.endpoint === "string" ? rest.endpoint : "";
        if (!endpoint || !Array.isArray(rest.mutedNotificationTypes)) return NextResponse.json({ error: "Invalid preferences" }, { status: 400 });
        if (rest.mutedNotificationTypes.some((value: unknown) => typeof value !== "string" || !NOTIFICATION_TYPE_IDS.includes(value as never))) {
          return NextResponse.json({ error: "Unknown notification type" }, { status: 400 });
        }
        const db = getDb();
        const rows = await db.select({ userLabel: pushSubscriptions.userLabel, mutedNotificationTypes: pushSubscriptions.mutedNotificationTypes })
          .from(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint)).limit(1);
        if (!rows[0] || (rows[0].userLabel || "admin") !== owner) return NextResponse.json({ error: "Subscription not found" }, { status: 404 });
        const allowedCategories = await notificationAccess(auth);
        if (!allowedCategories) return NextResponse.json({ error: "User no longer exists" }, { status: 403 });
        const allowedTypes = new Set(NOTIFICATION_CATEGORIES.filter((category) => allowedCategories.includes(category.id)).flatMap((category) => category.events.map(([id]) => id)));
        const requested = new Set(parseMutedNotificationTypes(rest.mutedNotificationTypes));
        const preserved = parseMutedNotificationTypes(rows[0].mutedNotificationTypes).filter((type) => !allowedTypes.has(type));
        const mutedNotificationTypes = [...new Set([...preserved, ...[...requested].filter((type) => allowedTypes.has(type))])];
        await db.update(pushSubscriptions).set({ mutedNotificationTypes: JSON.stringify(mutedNotificationTypes) }).where(eq(pushSubscriptions.endpoint, endpoint));
        return NextResponse.json({ success: true, allowedCategories, mutedNotificationTypes });
      }

      case "test": {
        const endpoint = typeof rest.endpoint === "string" ? rest.endpoint : "";
        if (!endpoint) return NextResponse.json({ error: "endpoint required" }, { status: 400 });
        const db = getDb();
        const rows = await db.select({ userLabel: pushSubscriptions.userLabel }).from(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint)).limit(1);
        if (!rows[0] || (rows[0].userLabel || "admin") !== owner) return NextResponse.json({ error: "Subscription not found" }, { status: 404 });
        const delivery = await sendPushToEndpoint({
          notificationType: "system.test",
          title: "Test Notification",
          body: "Goko notifications are working correctly.",
          eventId: `test-${Date.now()}`,
          url: "/admin?section=dashboard",
        }, endpoint);

        return NextResponse.json({ success: true, delivery });
      }

      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
