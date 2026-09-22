import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db";
import { pushSubscriptions } from "@/db/schema";
import { eq } from "drizzle-orm";
import { sendPushToAll } from "@/lib/pushNotify";
import { isOfflineMode } from "@/lib/runtime";

import { authenticateSimple } from "@/lib/auth";

async function authenticate(password: string, username?: string): Promise<boolean> {
  return authenticateSimple(password, username);
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

    // Admin clients clear the password after login; authenticateSimple falls
    // back to the current HttpOnly session when the password is empty.
    if (!await authenticate(authPassword, authUsername)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    switch (action) {
      case "subscribe": {
        const { subscription, userLabel } = rest;
        if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
          return NextResponse.json({ error: "Invalid subscription" }, { status: 400 });
        }

        const db = getDb();
        const existing = await db.select({ id: pushSubscriptions.id })
          .from(pushSubscriptions)
          .where(eq(pushSubscriptions.endpoint, subscription.endpoint))
          .limit(1);

        if (existing.length > 0) {
          await db.update(pushSubscriptions).set({
            keyP256dh: subscription.keys.p256dh,
            keyAuth: subscription.keys.auth,
            userLabel: username || userLabel || "admin",
          }).where(eq(pushSubscriptions.endpoint, subscription.endpoint));
        } else {
          await db.insert(pushSubscriptions).values({
            endpoint: subscription.endpoint,
            keyP256dh: subscription.keys.p256dh,
            keyAuth: subscription.keys.auth,
            userLabel: username || userLabel || "admin",
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
        await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint));
        return NextResponse.json({ success: true });
      }

      case "test": {
        const delivery = await sendPushToAll({
          title: "Test Notification",
          body: "Goko notifications are working correctly.",
          eventId: `test-${Date.now()}`,
          category: "test",
          url: "/admin?section=dashboard",
        });

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
