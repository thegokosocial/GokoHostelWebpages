import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authenticateUser } from "@/lib/auth";
import { isPiRuntime } from "@/lib/runtime";
import { readGatewayBody } from "@/lib/gatewayRequestBody";
import { checkRazorpayTestConnectivity, RazorpayError, razorpayId } from "@/lib/razorpay";
import { createPreviewAttempt, previewSnapshot, listPreviewAttempts, reconcilePreviewAttempt,
  verifyPreviewCallback, refundPreviewPayment, PreviewError, listPreviewWebhooks, processPreviewWebhook, claimPreviewCheckout, recoverPreviewRequest } from "@/lib/razorpayPreview";

const credentials = { password: z.string().min(1).max(1024), username: z.string().max(100).optional() };
const id = z.string().uuid();
const bodySchema = z.discriminatedUnion("action", [
  z.object({ ...credentials, action: z.literal("checkTestConnectivity") }).strict(),
  z.object({ ...credentials, action: z.literal("listTestAttempts") }).strict(),
  z.object({ ...credentials, action: z.literal("createTestAttempt"), requestKey: id }).strict(),
  z.object({ ...credentials, action: z.literal("getTestRequest"), requestKey: id }).strict(),
  z.object({ ...credentials, action: z.literal("getTestAttempt"), attemptId: id }).strict(),
  z.object({ ...credentials, action: z.literal("claimTestCheckout"), attemptId: id }).strict(),
  z.object({ ...credentials, action: z.literal("reconcileTestAttempt"), attemptId: id }).strict(),
  z.object({ ...credentials, action: z.literal("verifyTestCallback"), attemptId: id,
    paymentId: razorpayId("pay"), orderId: razorpayId("order"), signature: z.string().regex(/^[a-fA-F0-9]{64}$/),
  }).strict(),
  z.object({ ...credentials, action: z.literal("refundTestPayment"), attemptId: id, paymentId: razorpayId("pay") }).strict(),
  z.object({ ...credentials, action: z.literal("retryTestWebhook"), eventId: z.string().regex(/^[A-Za-z0-9_-]{1,120}$/) }).strict(),
]);
const headers = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };
export async function POST(req: NextRequest) {
  if (isPiRuntime()) return NextResponse.json({ error: "Gateway operations are unavailable on Pi" }, { status: 403, headers });
  try {
    let value: unknown;
    try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await readGatewayBody(req, 8192))); }
    catch (error) { if (error instanceof PreviewError) throw error; return NextResponse.json({ error: "Invalid JSON" }, { status: 400, headers }); }
    // Missing credentials retain the existing admin API's 401 semantics.
    if (!value || typeof value !== "object" || !("password" in value) || typeof value.password !== "string" || !value.password) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers });
    }
    const body = bodySchema.parse(value);
    let auth;
    try { auth = await authenticateUser(body.password, body.username); }
    catch { return NextResponse.json({ error: "Authentication unavailable" }, { status: 503, headers }); }
    if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers });
    if (auth.role !== "admin") return NextResponse.json({ error: "Gateway test preview requires an administrator" }, { status: 403, headers });
    let result;
    switch (body.action) {
      case "checkTestConnectivity": result = await checkRazorpayTestConnectivity(); break;
      case "listTestAttempts": result = { attempts: await listPreviewAttempts(), webhooks: await listPreviewWebhooks(),
        previewEnabled: process.env.RAZORPAY_TEST_PREVIEW_ENABLED === "true", nativeCheckoutReady: false }; break;
      case "createTestAttempt": result = await createPreviewAttempt(body.requestKey, auth.displayName); break;
      case "getTestRequest": result = await recoverPreviewRequest(body.requestKey); break;
      case "getTestAttempt": result = await previewSnapshot(body.attemptId); break;
      case "claimTestCheckout": result = await claimPreviewCheckout(body.attemptId); break;
      case "reconcileTestAttempt": result = await reconcilePreviewAttempt(body.attemptId); break;
      case "verifyTestCallback": result = await verifyPreviewCallback(body.attemptId, body.paymentId, body.orderId, body.signature); break;
      case "refundTestPayment": result = await refundPreviewPayment(body.attemptId, body.paymentId, auth.displayName); break;
      case "retryTestWebhook": result = await processPreviewWebhook(body.eventId); break;
    }
    return NextResponse.json(result, { headers });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "Invalid gateway test request" }, { status: 400, headers });
    if (error instanceof PreviewError) return NextResponse.json({ error: error.message }, { status: error.status, headers });
    if (error instanceof RazorpayError) return NextResponse.json({ error: error.message, code: `RAZORPAY_${error.code}` }, { status: error.httpStatus, headers });
    return NextResponse.json({ error: "Unable to access the payment ledger. Reconcile before retrying any payment." }, { status: 503, headers });
  }
}
