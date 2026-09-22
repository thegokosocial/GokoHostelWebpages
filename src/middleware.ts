import { NextRequest, NextResponse } from "next/server";

const PROTECTED_POST_PREFIXES = ["/api/admin/", "/api/food/kitchen", "/api/push", "/api/sync"];

export function middleware(req: NextRequest) {
  if (req.method !== "POST" || !PROTECTED_POST_PREFIXES.some((prefix) => req.nextUrl.pathname.startsWith(prefix))) {
    return NextResponse.next();
  }
  const origin = req.headers.get("origin");
  if (origin && origin !== req.nextUrl.origin) return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  return NextResponse.next();
}

export const config = { matcher: ["/api/:path*"] };
