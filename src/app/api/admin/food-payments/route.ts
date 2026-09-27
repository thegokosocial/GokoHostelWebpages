import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authenticateUser } from "@/lib/auth";
import { isPiRuntime } from "@/lib/runtime";
import { readGatewayBody } from "@/lib/gatewayRequestBody";
import { actionAllowed, permissionDeniedPayload, type ActionPerm } from "@/lib/actionPermissions";
import {
  FoodQrError,
  listFoodQrAttempts,
  reconcileFoodQrAttempt,
  ensureActiveFoodQrForOrders,
  getFoodQrAttempt,
  closeActiveFoodQrAttempt,
} from "@/lib/foodQrPayment";
import { RazorpayError } from "@/lib/razorpay";

const credentials = { password: z.string().max(1024), username: z.string().max(100).optional() };
const id = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const bodySchema = z.discriminatedUnion("action", [
  z.object({
    ...credentials,
    action: z.literal("listFoodQrAttempts"),
    page: z.number().int().min(1).optional(),
    query: z.string().trim().max(120).optional(),
    fromDate: isoDate.optional(),
    toDate: isoDate.optional(),
  }).strict(),
  z.object({ ...credentials, action: z.literal("getFoodQrAttempt"), attemptId: id }).strict(),
  z.object({ ...credentials, action: z.literal("reconcileFoodQrAttempt"), attemptId: id }).strict(),
  z.object({ ...credentials, action: z.literal("closeActiveFoodQr"), attemptId: id }).strict(),
  z.object({
    ...credentials,
    action: z.literal("ensureFoodQr"),
    requestKey: id,
    orderIds: z.array(z.number().int().positive()).min(1).max(50),
  }).strict(),
]);

const ACTION_PERMISSIONS: Record<string, ActionPerm> = {
  listFoodQrAttempts: "admin_only",
  getFoodQrAttempt: "admin_only",
  reconcileFoodQrAttempt: ["canGenerateFoodBills", "canMarkPaid", "canViewFoodOrders"],
  closeActiveFoodQr: ["canGenerateFoodBills", "canMarkPaid", "canViewFoodOrders"],
  ensureFoodQr: ["canGenerateFoodBills", "canMarkPaid", "canViewFoodOrders"],
};

const headers = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };

export async function POST(req: NextRequest) {
  if (isPiRuntime()) {
    return NextResponse.json({ error: "Food QR payments are unavailable on Pi" }, { status: 403, headers });
  }
  try {
    let value: unknown;
    try {
      value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await readGatewayBody(req, 8192)));
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400, headers });
    }
    const parsed = bodySchema.safeParse(value);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400, headers });
    }
    const auth = await authenticateUser(parsed.data.password, parsed.data.username);
    if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers });

    const required = ACTION_PERMISSIONS[parsed.data.action];
    const gate = actionAllowed(auth.role, auth.permissions || {}, required);
    if (gate !== "allowed") {
      return NextResponse.json(permissionDeniedPayload(required), { status: 403, headers });
    }

    switch (parsed.data.action) {
      case "listFoodQrAttempts":
        return NextResponse.json(await listFoodQrAttempts({
          page: parsed.data.page,
          query: parsed.data.query,
          fromDate: parsed.data.fromDate,
          toDate: parsed.data.toDate,
        }), { headers });
      case "getFoodQrAttempt":
        return NextResponse.json({ attempt: await getFoodQrAttempt(parsed.data.attemptId) }, { headers });
      case "reconcileFoodQrAttempt":
        return NextResponse.json({ attempt: await reconcileFoodQrAttempt(parsed.data.attemptId) }, { headers });
      case "closeActiveFoodQr":
        return NextResponse.json({
          releasedAttemptIds: (await closeActiveFoodQrAttempt(parsed.data.attemptId)).releasedAttemptIds,
        }, { headers });
      case "ensureFoodQr":
        return NextResponse.json({
          attempt: await ensureActiveFoodQrForOrders({
            requestKey: parsed.data.requestKey,
            orderIds: parsed.data.orderIds,
            createdBy: auth.username || "admin",
          }),
        }, { headers });
      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400, headers });
    }
  } catch (error) {
    if (error instanceof FoodQrError) {
      return NextResponse.json({ error: error.message }, { status: error.status, headers });
    }
    if (error instanceof RazorpayError) {
      return NextResponse.json({ error: error.message }, { status: error.httpStatus || 503, headers });
    }
    console.error("food-payments error:", error);
    return NextResponse.json({ error: "Food payment request failed" }, { status: 500, headers });
  }
}
