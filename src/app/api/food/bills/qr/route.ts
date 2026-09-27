import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isPiRuntime } from "@/lib/runtime";
import { normalizePhone } from "@/lib/phoneUtils";
import { getValidFoodBillShareToken, getSetting, getFoodOrdersByIds } from "@/db/queries";
import { foodDue } from "@/lib/foodPaymentBalance";
import { BILL_QR_MODE_KEY, parseBillQrMode, effectiveMode, environmentFromMode } from "@/lib/foodBillQrMode";
import { workerEnv } from "@/lib/razorpay";
import {
  FoodQrError,
  ensureActiveFoodQrForOrders,
  getFoodQrAttempt,
  reconcileFoodQrAttempt,
} from "@/lib/foodQrPayment";
import { normalizeWalkinGuestName } from "@/lib/foodWalkinIdentity";

const headers = { "Cache-Control": "no-store" };

const bodySchema = z.object({
  requestKey: z.string().uuid(),
  orderIds: z.array(z.number().int().positive()).min(1).max(50),
  /** Guest ensure/status requires the WhatsApp share token — phone-only mint is not allowed. */
  token: z.string().min(8).max(40),
  attemptId: z.string().uuid().optional(),
  action: z.enum(["ensure", "status"]).default("ensure"),
});

/**
 * Guest-facing: ensure/status a dynamic Razorpay QR for unpaid bill orders.
 * Auth: opaque share token only (menu phone lookup never mints).
 */
export async function POST(req: NextRequest) {
  if (isPiRuntime()) {
    return NextResponse.json({ error: "Unavailable" }, { status: 403, headers });
  }
  try {
    const raw = bodySchema.safeParse(await req.json());
    if (!raw.success) return NextResponse.json({ error: "Invalid request" }, { status: 400, headers });

    const mode = effectiveMode(parseBillQrMode(await getSetting(BILL_QR_MODE_KEY)), workerEnv());
    if (!environmentFromMode(mode)) {
      return NextResponse.json({ error: "Dynamic Razorpay QR is not enabled", mode: "static" }, { status: 400, headers });
    }

    const row = await getValidFoodBillShareToken(raw.data.token.trim());
    if (!row) return NextResponse.json({ error: "Invalid or expired bill link" }, { status: 404, headers });
    if (!row.checkinId && !row.walkinNameKey) {
      return NextResponse.json({ error: "This bill link is no longer valid" }, { status: 404, headers });
    }
    const authorizedPhone = row.phone;

    const orders = await getFoodOrdersByIds(raw.data.orderIds);
    if (!orders.length) return NextResponse.json({ error: "Orders not found" }, { status: 404, headers });

    const inScope = orders.every((o) => {
      if (normalizePhone(o.guestPhone || "") !== authorizedPhone) return false;
      if (row.checkinId) return o.checkinId === row.checkinId;
      return normalizeWalkinGuestName(o.guestName) === row.walkinNameKey;
    });
    if (!inScope) return NextResponse.json({ error: "Orders do not match this bill" }, { status: 403, headers });

    if (raw.data.action === "status" && raw.data.attemptId) {
      const snapshot = await getFoodQrAttempt(raw.data.attemptId);
      let attemptOrderIds: number[] = [];
      try {
        attemptOrderIds = (JSON.parse(String(snapshot.foodOrderIds || "[]")) as number[])
          .filter((n) => Number.isFinite(n));
      } catch { /* ignore */ }
      const ownedIds = new Set(orders.map((o) => o.id));
      if (!attemptOrderIds.length || !attemptOrderIds.every((id) => ownedIds.has(id))) {
        return NextResponse.json({ error: "Payment attempt does not match this bill" }, { status: 403, headers });
      }
      if (normalizePhone(snapshot.guestPhone || "") !== authorizedPhone) {
        return NextResponse.json({ error: "Payment attempt does not match this bill" }, { status: 403, headers });
      }
      const attempt = await reconcileFoodQrAttempt(raw.data.attemptId);
      return NextResponse.json({ attempt }, { headers });
    }

    const unpaidIds = orders.filter((o) => o.status !== "cancelled" && foodDue(o) > 0).map((o) => o.id);
    if (!unpaidIds.length) {
      return NextResponse.json({ error: "Nothing unpaid on these orders", paid: true }, { status: 409, headers });
    }

    const attempt = await ensureActiveFoodQrForOrders({
      requestKey: raw.data.requestKey,
      orderIds: unpaidIds,
      createdBy: `guest:${authorizedPhone}`,
    });
    return NextResponse.json({ attempt }, { headers });
  } catch (error) {
    if (error instanceof FoodQrError) {
      return NextResponse.json({ error: error.message }, { status: error.status, headers });
    }
    console.error("food bills qr error:", error);
    return NextResponse.json({ error: "Could not prepare payment QR" }, { status: 500, headers });
  }
}
