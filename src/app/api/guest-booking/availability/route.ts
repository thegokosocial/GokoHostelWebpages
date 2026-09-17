import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { searchGuestRooms } from "@/lib/guestBookingSearch";
import { isPiRuntime } from "@/lib/runtime";
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  const headers = { "Cache-Control": "no-store" };
  if (isPiRuntime()) return NextResponse.json({ error: "Please use the Goko website for availability." }, { status: 403, headers });
  try {
    const entries = [...req.nextUrl.searchParams.entries()];
    if (new Set(entries.map(([key]) => key)).size !== entries.length) return NextResponse.json({ error: "Duplicate search fields" }, { status: 400, headers });
    return NextResponse.json(await searchGuestRooms(Object.fromEntries(entries)), { headers });
  } catch (error) {
    return NextResponse.json({ error: error instanceof ZodError ? error.issues[0]?.message : "Could not load availability. Please try again." }, { status: error instanceof ZodError ? 400 : 503, headers });
  }
}
