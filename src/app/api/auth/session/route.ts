import { NextRequest, NextResponse } from "next/server";
import { getAuthSession, type AuthScope } from "@/lib/authSession";

export async function GET(req: NextRequest) {
  const scope: AuthScope = req.nextUrl.searchParams.get("scope") === "kitchen" ? "kitchen" : "admin";
  const auth = await getAuthSession(scope);
  if (!auth) return NextResponse.json({ authenticated: false }, { status: 401, headers: { "Cache-Control": "no-store" } });
  return NextResponse.json({ authenticated: true, role: auth.role, displayName: auth.displayName, username: auth.username, permissions: auth.permissions }, { headers: { "Cache-Control": "no-store" } });
}
