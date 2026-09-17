import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isPiRuntime } from "@/lib/runtime";
import { readGatewayBody } from "@/lib/gatewayRequestBody";
import { receivePreviewWebhook, PreviewError } from "@/lib/razorpayPreview";
import { RazorpayError } from "@/lib/razorpay";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };
/** TEST webhook only. A live URL will be added with native fulfilment, not inferred from a query/header. */
export async function POST(req: NextRequest) {
  if (isPiRuntime()) return NextResponse.json({ error: "Gateway webhooks are Cloudflare-owned" }, { status: 403, headers });
  const signature = req.headers.get("x-razorpay-signature") || "";
  const eventId = req.headers.get("x-razorpay-event-id") || "";
  if (!/^[a-fA-F0-9]{64}$/.test(signature) || !/^[A-Za-z0-9_-]{1,120}$/.test(eventId)) {
    return NextResponse.json({ error: "Missing or invalid webhook authentication" }, { status: 400, headers });
  }
  try {
    const result = await receivePreviewWebhook(await readGatewayBody(req, 65536), signature, eventId);
    return NextResponse.json(result, { headers });
  } catch (error) {
    // Non-2xx until durable processing completes; provider retry/admin replay
    // can finish after a transient DB/API failure or unmatched creation response.
    if (error instanceof z.ZodError) return NextResponse.json({ error: "Invalid webhook payload" }, { status: 400, headers });
    if (error instanceof PreviewError && [400, 409, 413].includes(error.status)) return NextResponse.json({ error: error.message }, { status: error.status, headers });
    if (error instanceof RazorpayError && error.httpStatus === 400) return NextResponse.json({ error: error.message }, { status: 400, headers });
    return NextResponse.json({ error: "Webhook processing incomplete; retry required" }, { status: 503, headers });
  }
}
