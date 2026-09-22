import { NextResponse } from "next/server";
import { revokeAuthSession, type AuthScope } from "@/lib/authSession";
import type { NextRequest } from "next/server";

export async function POST(request: NextRequest) {
  const scope: AuthScope = request.nextUrl.searchParams.get("scope") === "kitchen" ? "kitchen" : "admin";
  await revokeAuthSession(scope);
  return NextResponse.json({ success: true });
}
