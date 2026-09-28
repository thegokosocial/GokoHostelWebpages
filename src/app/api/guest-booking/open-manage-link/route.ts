import { NextRequest, NextResponse } from "next/server";
import { ZodError, z } from "zod";
import { ManageLinkError, openGuestManageLink } from "@/lib/guestManageLink";
import {
  assertGuestOrigin, guestApiHeaders, guestBookingRateLimit, readGuestJsonBody,
} from "@/lib/guestBookingRateLimit";
import { isPiRuntime } from "@/lib/runtime";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  reference: z.string().trim().min(1).max(120).regex(/^[A-Za-z0-9_-]+$/),
  magic: z.string().trim().min(10).max(200),
}).strict();

/** Exchange emailed `{MANAGE_URL}` magic for guestAccessToken + booking status. */
export async function POST(req: NextRequest) {
  const headers = guestApiHeaders();
  if (isPiRuntime()) return NextResponse.json({ error: "Please use the Goko website." }, { status: 403, headers });
  try {
    assertGuestOrigin(req);
    const ip = req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for") || "unknown";
    if (!guestBookingRateLimit(ip, 30)) {
      return NextResponse.json({ error: "Too many requests. Please wait a minute." }, { status: 429, headers });
    }
    const raw = await readGuestJsonBody(req, 4096);
    const body = bodySchema.parse(raw);
    return NextResponse.json(await openGuestManageLink(body.reference, body.magic), { headers });
  } catch (error) {
    if (error instanceof ManageLinkError) {
      return NextResponse.json({ error: error.message }, { status: error.status, headers });
    }
    if (error instanceof ZodError || error instanceof SyntaxError) {
      return NextResponse.json(
        { error: "This manage link is invalid or expired. Use Find my booking on /book." },
        { status: 400, headers },
      );
    }
    const status = typeof error === "object" && error && "status" in error
      ? Number((error as { status: number }).status)
      : 0;
    if (status === 403 || status === 413 || status === 400) {
      return NextResponse.json(
        { error: status === 413 ? "Request too large" : status === 403 ? "Invalid request origin" : "Missing request" },
        { status, headers },
      );
    }
    return NextResponse.json({ error: "Unable to open booking. Use Find my booking on /book." }, { status: 503, headers });
  }
}
