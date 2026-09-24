import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { accounts, bookings, platformSettlements, nativeBookingCheckouts, nativeBookingPayments, gatewaySettlementAllocations, platformSettlementAllocations } from "@/db/schema";
import { authenticateUser } from "@/lib/auth";
import { actionAllowed } from "@/lib/actionPermissions";
import { isPiRuntime } from "@/lib/runtime";
import { collectInBatches } from "@/lib/dbBatch";
import {
  allocatePlatformSettlement,
  allocatePlatformSettlementBatch,
  bookingAmountsFromRaw,
  createPlatformSettlement,
  gatewayExpectedNetPaise,
  getPlatformReceivableSummary,
  parsePlatformAmounts,
  PLATFORM_RECEIVABLE_BACKFILL_FROM,
  recognizeMissingPlatformBookings,
  recordPlatformAdjustment,
  rupeesToPaise,
} from "@/lib/platformReceivables";
import {
  refreshPendingWebsitePaymentGatewayFees,
  refreshWebsitePaymentGatewayFees,
  setWebsitePaymentGatewayFees,
  WebsiteGatewayFeeError,
} from "@/lib/websiteGatewayFees";
import { RazorpayError } from "@/lib/razorpay";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { password, username, action, ...rest } = body;
    const auth = await authenticateUser(password, username);
    if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const adjustActions = new Set(["adjust", "setWebsiteFees", "recognizeMissing"]);
    const permission = action === "list" ? "canViewAccounts"
      : adjustActions.has(action) ? "canAdjustPlatformReceivables"
      : "canSettlePlatformPayments";
    const gate = actionAllowed(auth.role, auth.permissions, permission);
    if (gate === "admin_required") return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    if (gate === "forbidden") return NextResponse.json({ error: "You don't have permission to perform this action" }, { status: 403 });
    const actor = username || auth.displayName;

    if (action === "list") {
      const db = getDb();
      const [receivables, bankAccounts, settlements] = await Promise.all([
        getPlatformReceivableSummary(),
        db.select({ id: accounts.id, name: accounts.name, nickname: accounts.nickname }).from(accounts)
          .where(and(eq(accounts.isActive, 1), eq(accounts.isVirtual, 0))).orderBy(accounts.name),
        db.select().from(platformSettlements).orderBy(platformSettlements.id),
      ]);
      let websitePayments: Array<Record<string, unknown>> = [];
      if (!isPiRuntime()) {
        const payments = await db.select({
          paymentId: nativeBookingPayments.id, checkoutId: nativeBookingPayments.checkoutId,
          amountPaise: nativeBookingPayments.amountPaise, refundedPaise: nativeBookingPayments.refundedPaise,
          feePaise: nativeBookingPayments.feePaise, taxPaise: nativeBookingPayments.taxPaise,
          verifiedAt: nativeBookingPayments.verifiedAt, paymentStatus: nativeBookingPayments.status,
          bookingId: nativeBookingCheckouts.bookingId, guestName: nativeBookingCheckouts.guestName,
          guestEmail: nativeBookingCheckouts.guestEmail, guestPhone: nativeBookingCheckouts.guestPhone,
          environment: nativeBookingCheckouts.environment, bookingRef: bookings.bookingRef,
          gokoBookingId: bookings.gokoBookingId, checkinDate: bookings.checkinDate, checkoutDate: bookings.checkoutDate,
        }).from(nativeBookingPayments)
          .innerJoin(nativeBookingCheckouts, eq(nativeBookingPayments.checkoutId, nativeBookingCheckouts.id))
          .leftJoin(bookings, eq(nativeBookingCheckouts.bookingId, bookings.id))
          .where(and(eq(nativeBookingPayments.captured, 1), sql`${nativeBookingCheckouts.environment} = 'live'`));
        const allocations = await db.select().from(gatewaySettlementAllocations);
        websitePayments = payments.map((payment) => {
          const allocatedPaise = allocations.filter((item) => item.paymentId === payment.paymentId).reduce((sum, item) => sum + item.allocatedPaise, 0);
          const expectedNetPaise = gatewayExpectedNetPaise(payment.amountPaise, payment.refundedPaise, payment.feePaise, payment.taxPaise);
          return { ...payment, platformKey: "razorpay-website", expectedNetPaise, allocatedPaise, outstandingPaise: expectedNetPaise == null ? null : expectedNetPaise - allocatedPaise };
        });
      }
      const otaAllocations = await db.select().from(platformSettlementAllocations);
      const gatewayAllocations = isPiRuntime() ? [] : await db.select().from(gatewaySettlementAllocations);
      const settlementBalances = settlements.map((settlement) => {
        const otaUsed = otaAllocations.filter((row) => row.settlementId === settlement.id).reduce((sum, row) => sum + row.allocatedPaise, 0);
        const gatewayUsed = gatewayAllocations.filter((row) => row.settlementId === settlement.id).reduce((sum, row) => sum + row.allocatedPaise, 0);
        return { ...settlement, allocatedPaise: otaUsed + gatewayUsed, unallocatedPaise: settlement.actualAmountPaise - otaUsed - gatewayUsed };
      });
      return NextResponse.json({ receivables, websitePayments, bankAccounts, settlements: settlementBalances });
    }
    if (action === "createSettlement") {
      const amountPaise = Number.isSafeInteger(rest.amountPaise) ? rest.amountPaise : rupeesToPaise(rest.amount);
      const result = await createPlatformSettlement({
        platform: String(rest.platform || ""),
        bankAccountId: rest.bankAccountId,
        payoutDate: String(rest.payoutDate || ""),
        actualAmountPaise: amountPaise,
        reference: rest.reference,
        notes: rest.notes,
        actor,
        receiptId: rest.receiptId,
      });
      return NextResponse.json({ success: true, ...result });
    }
    if (action === "allocate") {
      const result = await allocatePlatformSettlement({
        settlementId: Number(rest.settlementId),
        bookingId: Number(rest.bookingId),
        bookingCycle: Number(rest.bookingCycle || 1),
        allocatedPaise: Number.isSafeInteger(rest.allocatedPaise) ? rest.allocatedPaise : rupeesToPaise(rest.amount),
        varianceType: rest.varianceType,
        notes: rest.notes,
        actor,
      });
      return NextResponse.json({ success: true, ...result });
    }
    if (action === "allocateBatch") {
      if (!Array.isArray(rest.allocations) || rest.allocations.length === 0) return NextResponse.json({ error: "Select at least one receivable" }, { status: 400 });
      const website = rest.allocations.filter((item: any) => item?.type === "website");
      const platform = rest.allocations.filter((item: any) => item?.type !== "website");
      if (website.length && platform.length) return NextResponse.json({ error: "A payout can only be allocated to one receivable source" }, { status: 400 });
      if (website.length) {
        if (isPiRuntime()) return NextResponse.json({ error: "Website payment allocations are available on the Cloudflare runtime" }, { status: 400 });
        const db = getDb();
        const settlementId = Number(rest.settlementId);
        const settlement = await db.select().from(platformSettlements).where(eq(platformSettlements.id, settlementId)).limit(1);
        if (!settlement[0] || settlement[0].platformKey !== "razorpay-website") return NextResponse.json({ error: "Choose a Razorpay website payout" }, { status: 400 });
        const paymentIds: string[] = website.map((item: any) => String(item.paymentId || ""));
        if (new Set(paymentIds).size !== paymentIds.length || paymentIds.some((id: string) => !id)) return NextResponse.json({ error: "Website payment selections must be unique" }, { status: 400 });
        const payments = await collectInBatches(paymentIds, (batch) => db.select({ payment: nativeBookingPayments, environment: nativeBookingCheckouts.environment })
          .from(nativeBookingPayments).innerJoin(nativeBookingCheckouts, eq(nativeBookingPayments.checkoutId, nativeBookingCheckouts.id))
          .where(inArray(nativeBookingPayments.id, batch)));
        const prior = await db.select().from(gatewaySettlementAllocations).where(eq(gatewaySettlementAllocations.settlementId, settlementId));
        const existing = await collectInBatches(paymentIds, (batch) => db.select().from(gatewaySettlementAllocations).where(inArray(gatewaySettlementAllocations.paymentId, batch)));
        const requested = website.reduce((sum: number, item: any) => sum + Number(item.allocatedPaise), 0);
        const payoutUsed = prior.reduce((sum, row) => sum + row.allocatedPaise, 0);
        if (!Number.isSafeInteger(requested) || requested <= 0 || payoutUsed + requested > settlement[0].actualAmountPaise) return NextResponse.json({ error: "Allocations exceed the payout balance" }, { status: 400 });
        const paymentMap = new Map(payments.map((row) => [row.payment.id, row]));
        if (website.some((item: any) => {
          const row = paymentMap.get(String(item.paymentId));
          return !row || !row.payment.captured || row.environment !== "live" || row.payment.feePaise == null || row.payment.taxPaise == null;
        })) return NextResponse.json({ error: "Selected payments must be captured live website payments with verified gateway fee and tax data" }, { status: 400 });
        if (website.some((item: any) => {
          const payment = paymentMap.get(String(item.paymentId))!.payment;
          const net = gatewayExpectedNetPaise(payment.amountPaise, payment.refundedPaise, payment.feePaise, payment.taxPaise) || 0;
          const allocated = existing.filter((row) => row.paymentId === payment.id).reduce((sum, row) => sum + row.allocatedPaise, 0);
          const amount = Number(item.allocatedPaise);
          return !Number.isSafeInteger(amount) || amount <= 0 || allocated + amount > net;
        })) return NextResponse.json({ error: "An allocation exceeds a selected website payment's net receivable" }, { status: 400 });
        const values = website.map((item: any) => {
          const payment = paymentMap.get(String(item.paymentId))!.payment;
          const allocated = existing.filter((row) => row.paymentId === payment.id).reduce((sum, row) => sum + row.allocatedPaise, 0);
          const amount = Number(item.allocatedPaise);
          return { settlementId, paymentId: payment.id, allocationKey: `gateway-allocation:${settlementId}:${payment.id}:${crypto.randomUUID()}`, allocatedPaise: amount, notes: String(item.notes || ""), createdBy: actor, createdAt: new Date().toISOString() };
        });
        const inserted = await db.insert(gatewaySettlementAllocations).values(values).returning({ id: gatewaySettlementAllocations.id });
        return NextResponse.json({ success: true, ids: inserted.map((row) => row.id), unallocatedPaise: settlement[0].actualAmountPaise - payoutUsed - requested });
      }
      const allocations = platform.map((item: any) => ({ bookingId: Number(item.bookingId), bookingCycle: Number(item.bookingCycle || 1), allocatedPaise: Number(item.allocatedPaise), varianceType: item.varianceType, notes: item.notes }));
      const result = await allocatePlatformSettlementBatch({ settlementId: Number(rest.settlementId), allocations, actor });
      return NextResponse.json({ success: true, ...result });
    }
    if (action === "adjust") {
      const bookingId = Number(rest.bookingId);
      const db = getDb();
      const booking = await db.select().from(bookings).where(eq(bookings.id, bookingId)).limit(1);
      if (!booking[0]) return NextResponse.json({ error: "Booking not found" }, { status: 404 });
      const amounts = rest.amounts && typeof rest.amounts === "object"
        ? parsePlatformAmounts(rest.amounts)
        : bookingAmountsFromRaw(booking[0].rawData, booking[0]);
      const result = await recordPlatformAdjustment({
        bookingId,
        bookingCycle: Number(rest.bookingCycle || booking[0].bookingCycle || 1),
        platform: booking[0].platform,
        amounts,
        entryType: rest.entryType === "reversal" ? "reversal" : "adjustment",
        eventKey: String(rest.eventKey || `manual:${bookingId}:${crypto.randomUUID()}`),
        reason: String(rest.reason || "Manual platform receivable adjustment"),
        actor,
        date: rest.date,
      });
      return NextResponse.json({ success: true, ...result });
    }
    if (action === "refreshWebsiteFees") {
      if (isPiRuntime()) return NextResponse.json({ error: "Website gateway fee refresh is available on the Cloudflare runtime" }, { status: 400 });
      if (rest.paymentId) {
        const result = await refreshWebsitePaymentGatewayFees(String(rest.paymentId));
        return NextResponse.json({ success: true, ...result });
      }
      const result = await refreshPendingWebsitePaymentGatewayFees();
      return NextResponse.json({ success: true, ...result });
    }
    if (action === "setWebsiteFees") {
      if (isPiRuntime()) return NextResponse.json({ error: "Website gateway fees are available on the Cloudflare runtime" }, { status: 400 });
      const feePaise = rest.feePaise !== undefined && rest.feePaise !== null && rest.feePaise !== ""
        ? (Number.isSafeInteger(rest.feePaise) ? Number(rest.feePaise) : rupeesToPaise(rest.feePaise))
        : rest.fee !== undefined && rest.fee !== null && rest.fee !== ""
          ? rupeesToPaise(rest.fee)
          : undefined;
      const taxPaise = rest.taxPaise !== undefined && rest.taxPaise !== null && rest.taxPaise !== ""
        ? (Number.isSafeInteger(rest.taxPaise) ? Number(rest.taxPaise) : rupeesToPaise(rest.taxPaise))
        : rest.tax !== undefined && rest.tax !== null && rest.tax !== ""
          ? rupeesToPaise(rest.tax)
          : undefined;
      const result = await setWebsitePaymentGatewayFees(String(rest.paymentId || ""), { feePaise, taxPaise });
      return NextResponse.json({ success: true, ...result });
    }
    if (action === "recognizeMissing") {
      const fromDate = String(rest.fromDate || PLATFORM_RECEIVABLE_BACKFILL_FROM);
      const result = await recognizeMissingPlatformBookings(actor, fromDate);
      return NextResponse.json({ success: true, ...result });
    }
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    if (error instanceof WebsiteGatewayFeeError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof RazorpayError) return NextResponse.json({ error: error.message }, { status: error.httpStatus });
    const message = error instanceof Error ? error.message : "Platform finance action failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
