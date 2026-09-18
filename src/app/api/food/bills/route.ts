import { NextRequest, NextResponse } from "next/server";
import { getActiveCheckins, getGuestAllFoodOrders, getFoodOrderItemsBatch, getSetting } from "@/db/queries";
import { normalizePhone, phonesMatch } from "@/lib/phoneUtils";
import { getDb } from "@/db/index";
import { foodOrders, checkins } from "@/db/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { brandingFromSettings, publicBillBranding, BILL_SETTINGS_KEYS } from "@/lib/foodBillFormat";
import { foodTaxPercent } from "@/lib/foodLookup";

export async function GET(req: NextRequest) {
  const phone = req.nextUrl.searchParams.get("phone") || "";

  if (!phone) {
    return NextResponse.json({ error: "Missing phone" }, { status: 400 });
  }

  const normalized = normalizePhone(phone);
  if (!normalized) {
    return NextResponse.json({ error: "Invalid phone" }, { status: 400 });
  }

  try {
    const orderMap = new Map<number, true>();
    const allOrders: Array<{
      id: number;
      orderNumber: string;
      status: string;
      guestType: string;
      guestName: string;
      roomInfo: string | null;
      subtotal: number;
      tax: number;
      total: number;
      discount: number;
      paymentStatus: string;
      paymentMethod: string | null;
      createdAt: string;
      checkinId: number | null;
    }> = [];

    // 1) Hostel guest orders — current/latest stay only
    const db = getDb();
    const allCheckinRows = await db.select().from(checkins).where(eq(checkins.contact, normalized));
    const activeCheckinsList = await getActiveCheckins();
    const matchedCheckins: Array<{ id: number; status: string; arrivalDate: string }> = [];
    const seen = new Set<number>();
    for (const c of allCheckinRows) { matchedCheckins.push({ id: c.id, status: c.status, arrivalDate: c.arrivalDate }); seen.add(c.id); }
    for (const c of activeCheckinsList) {
      if (phonesMatch(c.contact, normalized) && !seen.has(c.id))
        matchedCheckins.push({ id: c.id, status: c.status, arrivalDate: c.arrivalDate });
    }

    // Find latest checkin (active preferred, then most recent by arrival date)
    let latestCheckinId: number | null = null;
    let latestDate = "";
    for (const c of matchedCheckins) {
      if (c.status === "active") { latestCheckinId = c.id; break; }
      if (c.arrivalDate > latestDate) { latestDate = c.arrivalDate; latestCheckinId = c.id; }
    }

    if (latestCheckinId) {
      const orders = await getGuestAllFoodOrders(latestCheckinId);
      for (const o of orders) {
        orderMap.set(o.id, true);
        allOrders.push({
          id: o.id,
          orderNumber: o.orderNumber,
          status: o.status,
          guestType: o.guestType,
          guestName: o.guestName,
          roomInfo: o.roomInfo,
          subtotal: o.subtotal,
          tax: o.tax,
          total: o.total,
          discount: o.discount,
          paymentStatus: o.paymentStatus,
          paymentMethod: o.paymentMethod,
          createdAt: o.createdAt,
          checkinId: o.checkinId,
        });
      }
    }

    // 2) Walk-in orders by phone match (exact normalized match, with suffix fallback for legacy data)
    const walkinRows = await db
      .select()
      .from(foodOrders)
      .where(and(
        eq(foodOrders.guestType, "walkin"),
        normalized.length === 10
          ? sql`(${foodOrders.guestPhone} = ${normalized} OR ${foodOrders.guestPhone} LIKE ${"%" + normalized})`
          : eq(foodOrders.guestPhone, normalized),
      ))
      .orderBy(desc(foodOrders.createdAt));

    for (const o of walkinRows) {
      if (orderMap.has(o.id)) continue;
      orderMap.set(o.id, true);
      allOrders.push({
        id: o.id,
        orderNumber: o.orderNumber,
        status: o.status,
        guestType: o.guestType,
        guestName: o.guestName,
        roomInfo: o.roomInfo,
        subtotal: o.subtotal,
        tax: o.tax,
        total: o.total,
        discount: o.discount,
        paymentStatus: o.paymentStatus,
        paymentMethod: o.paymentMethod,
        createdAt: o.createdAt,
        checkinId: null,
      });
    }

    const itemsMap = await getFoodOrderItemsBatch(allOrders.map((o) => o.id));
    const ordersWithItems = allOrders.map((o) => {
      const items = itemsMap.get(o.id) || [];
      return {
        orderNumber: o.orderNumber,
        status: o.status,
        guestType: o.guestType,
        guestName: o.guestName,
        roomInfo: o.roomInfo,
        subtotal: o.subtotal,
        tax: o.tax,
        total: o.total,
        discount: o.discount,
        paymentStatus: o.paymentStatus,
        paymentMethod: o.paymentMethod,
        createdAt: o.createdAt,
        checkinId: o.checkinId,
        items: items
          .filter((i) => i.quantity > 0 && i.status !== "voided")
          .map((i) => ({
            menuItemId: i.menuItemId,
            name: i.itemName,
            quantity: i.quantity,
            price: i.itemPrice,
            lineTotal: i.lineTotal,
            pricingStatus: i.pricingStatus,
            notes: i.notes,
          })),
      };
    });

    const unpaidOrders = ordersWithItems.filter(
      (o) => o.paymentStatus !== "paid" && o.status !== "cancelled"
    );
    const paidOrders = ordersWithItems.filter(
      (o) => o.paymentStatus === "paid" && o.status !== "cancelled"
    );

    const billSettings: Record<string, string> = {};
    for (const key of BILL_SETTINGS_KEYS) {
      billSettings[key] = (await getSetting(key)) ?? "";
    }
    const taxRate = foodTaxPercent(await getSetting("food_tax_rate"));
    const billBranding = {
      ...publicBillBranding(brandingFromSettings(billSettings)),
      taxRate,
    };

    return NextResponse.json({ unpaidOrders, paidOrders, latestCheckinId, billBranding });
  } catch (error: any) {
    console.error("Bills API error:", error?.message || error);
    return NextResponse.json({ error: "Failed to fetch bills" }, { status: 500 });
  }
}
