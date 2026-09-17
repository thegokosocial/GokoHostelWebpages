import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { guestBookingLookup, LookupCodeError } from "@/lib/guestBookingLookup";
import { isPiRuntime } from "@/lib/runtime";
export async function POST(req: NextRequest) {
  const headers = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };
  if (isPiRuntime()) return NextResponse.json({ error: "Booking lookup is available on the Goko website only." }, { status: 403, headers });
  if (req.headers.get("origin") && req.headers.get("origin") !== req.nextUrl.origin) return NextResponse.json({ error: "Invalid request origin" }, { status: 403, headers });
  try {
    // Limit the streamed body, not just the untrusted Content-Length header.
    const reader = req.body?.getReader();
    if (!reader) return NextResponse.json({ error: "Missing request" }, { status: 400, headers });
    const chunks: Uint8Array[] = []; let size = 0;
    for (;;) { const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength; if (size > 4096) { await reader.cancel(); return NextResponse.json({ error: "Request too large" }, { status: 413, headers }); } chunks.push(value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    chunks.forEach(chunk => { bytes.set(chunk, offset); offset += chunk.length; });
    const input = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    return NextResponse.json(await guestBookingLookup(input), { headers });
  } catch (error) {
    const invalid = error instanceof ZodError || error instanceof SyntaxError || error instanceof LookupCodeError;
    return NextResponse.json({ error: invalid ? "Check your details or request a new code after 10 minutes." : "Booking lookup is temporarily unavailable. Contact Goko for assistance." }, { status: invalid ? 400 : 503, headers });
  }
}
