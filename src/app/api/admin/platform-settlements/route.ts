import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { accounts, bookings, platformSettlements } from "@/db/schema";
import { authenticateUser } from "@/lib/auth";
import { actionAllowed } from "@/lib/actionPermissions";
import {
  allocatePlatformSettlement,
  bookingAmountsFromRaw,
  createPlatformSettlement,
  getPlatformReceivableSummary,
  parsePlatformAmounts,
  recordPlatformAdjustment,
  rupeesToPaise,
} from "@/lib/platformReceivables";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { password, username, action, ...rest } = body;
    const auth = await authenticateUser(password, username);
    if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const permission = action === "list" ? "canViewAccounts" : action === "adjust" ? "canAdjustPlatformReceivables" : "canSettlePlatformPayments";
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
      return NextResponse.json({ receivables, bankAccounts, settlements });
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
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Platform finance action failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
