import { NextRequest, NextResponse } from "next/server";
import { getActiveCheckins, getGuestAllFoodOrders, getFoodOrderItemsBatch, getSetting, getValidFoodBillShareToken } from "@/db/queries";
import { normalizePhone, phonesMatch } from "@/lib/phoneUtils";
import { getDb } from "@/db/index";
import { foodOrders, checkins } from "@/db/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { brandingFromSettings, publicBillBranding, BILL_SETTINGS_KEYS } from "@/lib/foodBillFormat";
import { foodTaxPercent } from "@/lib/foodLookup";
import { foodAmountPaid, foodDue } from "@/lib/foodPaymentBalance";
import { latestWalkinOrder, normalizeWalkinGuestName, walkinOrderGroupKey } from "@/lib/foodWalkinIdentity";

type BillSelection = { scope?: "hostel" | "walkin"; walkinNameKey?: string; checkinId?: number | null };

async function loadBillsForPhone(normalized: string, requested: BillSelection = {}) {
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
    amountPaid: number;
    amountDue?: number;
    discount: number;
    paymentStatus: string;
    paymentMethod: string | null;
    createdAt: string;
    checkinId: number | null;
  }> = [];

  const db = getDb();
  const allCheckinRows = await db.select().from(checkins).where(eq(checkins.contact, normalized));
  const activeCheckinsList = await getActiveCheckins();
  const matchedCheckins: Array<{ id: number; status: string; arrivalDate: string; name: string }> = [];
  const seen = new Set<number>();
  for (const c of allCheckinRows) { matchedCheckins.push({ id: c.id, status: c.status, arrivalDate: c.arrivalDate, name: c.name }); seen.add(c.id); }
  for (const c of activeCheckinsList) {
    if (phonesMatch(c.contact, normalized) && !seen.has(c.id))
      matchedCheckins.push({ id: c.id, status: c.status, arrivalDate: c.arrivalDate, name: c.name });
  }

  let latestCheckinId: number | null = null;
  let latestCheckinName = "";
  let latestDate = "";
  for (const c of matchedCheckins) {
    if (c.status === "active") { latestCheckinId = c.id; latestCheckinName = c.name; break; }
    if (c.arrivalDate > latestDate) { latestDate = c.arrivalDate; latestCheckinId = c.id; latestCheckinName = c.name; }
  }

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

  const walkinGroups = new Map<string, typeof walkinRows>();
  for (const order of walkinRows.filter((row) => row.status !== "cancelled")) {
    const key = walkinOrderGroupKey(order);
    if (key.startsWith("table_") || key.startsWith("_no_identity_")) continue;
    const group = walkinGroups.get(key) || [];
    group.push(order);
    walkinGroups.set(key, group);
  }

  const choices = [
    ...(latestCheckinId ? [{ scope: "hostel" as const, name: latestCheckinName || "Hostel guest" }] : []),
    ...[...walkinGroups.entries()].map(([key, orders]) => ({
      scope: "walkin" as const,
      name: latestWalkinOrder(orders).guestName,
      nameKey: key.slice(key.indexOf("|") + 1),
    })),
  ];

  let selection = requested;
  if (!selection.scope) {
    if (choices.length > 1) return { requiresGuestSelection: true as const, guestChoices: choices };
    if (choices.length === 1) selection = {
      scope: choices[0].scope,
      walkinNameKey: choices[0].scope === "walkin" ? choices[0].nameKey : undefined,
    };
  }

  const selectedCheckinId = selection.scope === "hostel"
    ? (selection.checkinId || latestCheckinId)
    : null;
  if (selectedCheckinId) {
    const orders = await getGuestAllFoodOrders(selectedCheckinId);
    for (const o of orders) {
      orderMap.set(o.id, true);
      allOrders.push({
        id: o.id, orderNumber: o.orderNumber, status: o.status, guestType: o.guestType,
        guestName: o.guestName, roomInfo: o.roomInfo, subtotal: o.subtotal, tax: o.tax,
        total: o.total, amountPaid: foodAmountPaid(o), discount: o.discount,
        paymentStatus: o.paymentStatus, paymentMethod: o.paymentMethod, createdAt: o.createdAt,
        checkinId: o.checkinId,
      });
    }
  }

  const selectedWalkinNameKey = selection.scope === "walkin" ? selection.walkinNameKey : "";
  for (const o of walkinRows) {
    if (!selectedWalkinNameKey || normalizeWalkinGuestName(o.guestName) !== selectedWalkinNameKey) continue;
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
      amountPaid: foodAmountPaid(o),
      amountDue: foodDue(o),
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
    (o) => foodDue(o) > 0 && o.status !== "cancelled"
  );
  const paidOrders = ordersWithItems.filter(
    (o) => foodDue(o) <= 0 && o.status !== "cancelled"
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

  return { unpaidOrders, paidOrders, latestCheckinId: selectedCheckinId, billBranding };
}

export async function GET(req: NextRequest) {
  const phoneParam = req.nextUrl.searchParams.get("phone") || "";
  const tokenParam = req.nextUrl.searchParams.get("t") || req.nextUrl.searchParams.get("token") || "";
  const scopeParam = req.nextUrl.searchParams.get("scope") || "";
  const guestParam = req.nextUrl.searchParams.get("guest") || "";

  try {
    let normalized = "";
    let viaToken = false;
    let selection: BillSelection = {};

    if (tokenParam) {
      const row = await getValidFoodBillShareToken(tokenParam.trim());
      if (!row) {
        return NextResponse.json({ error: "This bill link is invalid or has expired" }, { status: 404 });
      }
      normalized = row.phone;
      viaToken = true;
      selection = row.checkinId
        ? { scope: "hostel", checkinId: row.checkinId }
        : row.walkinNameKey
          ? { scope: "walkin", walkinNameKey: row.walkinNameKey }
          : {};
    } else if (phoneParam) {
      normalized = normalizePhone(phoneParam);
      if (!normalized) {
        return NextResponse.json({ error: "Invalid phone" }, { status: 400 });
      }
      if (scopeParam === "hostel") selection = { scope: "hostel" };
      if (scopeParam === "walkin" && guestParam) selection = { scope: "walkin", walkinNameKey: normalizeWalkinGuestName(guestParam) };
    } else {
      return NextResponse.json({ error: "Missing phone or share token" }, { status: 400 });
    }

    if (viaToken && !selection.scope) {
      return NextResponse.json({ error: "This bill link is no longer valid" }, { status: 404 });
    }
    const payload = await loadBillsForPhone(normalized, selection);
    return NextResponse.json({
      ...payload,
      viaToken,
      // Hide phone when opened via opaque token
      phone: viaToken ? undefined : normalized,
    });
  } catch (error: any) {
    console.error("Bills API error:", error?.message || error);
    return NextResponse.json({ error: "Failed to fetch bills" }, { status: 500 });
  }
}
