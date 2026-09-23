import { NextRequest, NextResponse } from "next/server";
import { authenticateKitchen, authenticateUser } from "@/lib/auth";
import { createAuthSession } from "@/lib/authSession";
import { guestBookingRateLimit } from "@/lib/guestBookingRateLimit";

export async function POST(req: NextRequest) {
  try {
    const ip = req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for") || "unknown";
    if (!guestBookingRateLimit(`login:${ip}`, 10, 10 * 60_000)) return NextResponse.json({ error: "Too many login attempts" }, { status: 429 });
    const body = await req.json() as { password?: unknown; username?: unknown; scope?: unknown; rememberMe?: unknown };
    const password = typeof body.password === "string" ? body.password : "";
    const scope = body.scope === "kitchen" ? "kitchen" : "admin";
    if (!password || password.length > 1024) return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
    const auth = scope === "kitchen"
      ? await authenticateKitchen(password)
      : await authenticateUser(password, typeof body.username === "string" ? body.username : undefined);
    if (!auth) return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
    await createAuthSession(auth, scope, body.rememberMe === true);
    return NextResponse.json({ role: auth.role, displayName: auth.displayName, username: "username" in auth ? auth.username : undefined, permissions: "permissions" in auth ? auth.permissions : {} });
  } catch {
    return NextResponse.json({ error: "Unable to sign in" }, { status: 503 });
  }
}
