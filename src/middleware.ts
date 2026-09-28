import { NextRequest, NextResponse } from "next/server";

const PROTECTED_POST_PREFIXES = ["/api/admin/", "/api/food/kitchen", "/api/push", "/api/sync"];

/** Website media upload is excluded from the matcher so Next does not clone multi-MB bodies (default 10MB). */
export const WEBSITE_UPLOAD_PATH = "/api/admin/website/upload";

export function middleware(req: NextRequest) {
  if (req.nextUrl.pathname === WEBSITE_UPLOAD_PATH || req.nextUrl.pathname.startsWith(`${WEBSITE_UPLOAD_PATH}/`)) {
    return NextResponse.next();
  }
  if (req.method !== "POST" || !PROTECTED_POST_PREFIXES.some((prefix) => req.nextUrl.pathname.startsWith(prefix))) {
    return NextResponse.next();
  }
  const origin = req.headers.get("origin");
  if (origin && origin !== req.nextUrl.origin) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }
  return NextResponse.next();
}

// Negative lookahead: skip website upload so OpenNext/Next middleware body clone (10MB default) never touches hero MP4s.
export const config = {
  matcher: ["/api/((?!admin/website/upload$).*)"],
};
