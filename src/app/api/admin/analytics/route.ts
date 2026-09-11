import { NextRequest, NextResponse } from "next/server";
import { and, eq, gte, lt, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { authenticateUser } from "@/lib/auth";
import { actionAllowed } from "@/lib/actionPermissions";
import { bookings, expenses, foodOrderItems, foodOrders } from "@/db/schema";
import { todayIST } from "@/lib/utils";

function utcStart(date: string) {
  const value = new Date(`${date}T00:00:00.000+05:30`);
  return value.toISOString();
}

function utcExclusiveEnd(date: string) {
  const value = new Date(`${date}T00:00:00.000+05:30`);
  value.setTime(value.getTime() + 86400000);
  return value.toISOString();
}

function dateOnly(value: string) {
  return value.slice(0, 10);
}

function parseDate(value: unknown, fallback: string) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return fallback;
  const parsed = new Date(`${value}T00:00:00Z`);
  return parsed.toISOString().slice(0, 10) === value ? value : fallback;
}

function daysBetween(from: string, to: string) {
  return Math.max(1, Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000) + 1);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const auth = await authenticateUser(body.password, body.username);
    if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const gate = actionAllowed(auth.role, auth.permissions, "canViewAnalytics");
    if (gate === "admin_required") return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    if (gate === "forbidden") return NextResponse.json({ error: "You don't have permission to view analytics" }, { status: 403 });

    const today = todayIST();
    if (body.fromDate !== undefined && parseDate(body.fromDate, "") !== body.fromDate) return NextResponse.json({ error: "Invalid fromDate" }, { status: 400 });
    if (body.toDate !== undefined && parseDate(body.toDate, "") !== body.toDate) return NextResponse.json({ error: "Invalid toDate" }, { status: 400 });
    const fromDate = parseDate(body.fromDate, today.slice(0, 8) + "01");
    const toDate = parseDate(body.toDate, today);
    if (fromDate > toDate) return NextResponse.json({ error: "fromDate must be before toDate" }, { status: 400 });
    const from = utcStart(fromDate);
    const to = utcExclusiveEnd(toDate);
    const db = getDb();

    const bookingWhere = [gte(bookings.createdAt, from), lt(bookings.createdAt, to)];
    const stayWhere = [gte(bookings.checkinDate, fromDate), sql`${bookings.checkinDate} <= ${toDate}`];
    const foodWhere = [gte(foodOrders.createdAt, from), lt(foodOrders.createdAt, to)];
    const expenseWhere = [gte(expenses.createdAt, from), lt(expenses.createdAt, to)];
    const [bookingSummary, bookingByDay, bookingByHour, bookingByWeekday, channelRows, staySummary, stayEvents, foodSummary, foodByHour, foodItems, expenseSummary, expenseByCategory] = await Promise.all([
      db.select({
        total: sql<number>`COUNT(*)`,
        confirmed: sql<number>`SUM(CASE WHEN ${bookings.status} IN ('confirmed', 'checked_in', 'checked_out') THEN 1 ELSE 0 END)`,
        cancelled: sql<number>`SUM(CASE WHEN ${bookings.status} = 'cancelled' THEN 1 ELSE 0 END)`,
        noShow: sql<number>`SUM(CASE WHEN ${bookings.status} = 'no_show' THEN 1 ELSE 0 END)`,
        revenue: sql<number>`COALESCE(SUM(CASE WHEN ${bookings.status} != 'cancelled' THEN ${bookings.amountTotal} ELSE 0 END), 0)`,
      }).from(bookings).where(and(...bookingWhere)),
      db.select({ date: sql<string>`date(${bookings.createdAt}, '+05:30')`, count: sql<number>`COUNT(*)` })
        .from(bookings).where(and(...bookingWhere)).groupBy(sql`date(${bookings.createdAt}, '+05:30')`).orderBy(sql`date(${bookings.createdAt}, '+05:30')`),
      db.select({ hour: sql<number>`CAST(strftime('%H', ${bookings.createdAt}, '+05:30') AS INTEGER)`, count: sql<number>`COUNT(*)` })
        .from(bookings).where(and(...bookingWhere)).groupBy(sql`strftime('%H', ${bookings.createdAt}, '+05:30')`).orderBy(sql`strftime('%H', ${bookings.createdAt}, '+05:30')`),
      db.select({ weekday: sql<number>`CAST(strftime('%w', ${bookings.createdAt}, '+05:30') AS INTEGER)`, count: sql<number>`COUNT(*)` })
        .from(bookings).where(and(...bookingWhere)).groupBy(sql`strftime('%w', ${bookings.createdAt}, '+05:30')`).orderBy(sql`strftime('%w', ${bookings.createdAt}, '+05:30')`),
      db.select({ channel: bookings.platform, count: sql<number>`COUNT(*)`, revenue: sql<number>`COALESCE(SUM(CASE WHEN ${bookings.status} != 'cancelled' THEN ${bookings.amountTotal} ELSE 0 END), 0)` })
        .from(bookings).where(and(...bookingWhere)).groupBy(bookings.platform).orderBy(sql`COUNT(*) DESC`),
      db.select({
        stays: sql<number>`COUNT(*)`,
        guests: sql<number>`COALESCE(SUM(${bookings.persons}), 0)`,
        revenue: sql<number>`COALESCE(SUM(CASE WHEN ${bookings.status} IN ('confirmed', 'checked_in', 'checked_out') THEN ${bookings.amountTotal} * (MAX(0, MIN(julianday(${bookings.checkoutDate}), julianday(${toDate} || '+1 day')) - MAX(julianday(${bookings.checkinDate}), julianday(${fromDate})))) / MAX(1, julianday(${bookings.checkoutDate}) - julianday(${bookings.checkinDate})) ELSE 0 END), 0)`,
      }).from(bookings).where(and(...stayWhere, sql`${bookings.status} IN ('confirmed', 'checked_in', 'checked_out')`, sql`${bookings.checkoutDate} > ${bookings.checkinDate}`)),
      db.select({
        checkIns: sql<number>`SUM(CASE WHEN ${bookings.checkedInAt} >= ${from} AND ${bookings.checkedInAt} < ${to} THEN 1 ELSE 0 END)`,
        checkOuts: sql<number>`SUM(CASE WHEN ${bookings.checkedOutAt} >= ${from} AND ${bookings.checkedOutAt} < ${to} THEN 1 ELSE 0 END)`,
      }).from(bookings),
      db.select({
        orders: sql<number>`COUNT(*)`,
        gross: sql<number>`COALESCE(SUM(${foodOrders.total}), 0)`,
        paid: sql<number>`COALESCE(SUM(CASE WHEN ${foodOrders.paymentStatus} = 'paid' THEN ${foodOrders.total} ELSE 0 END), 0)`,
        pending: sql<number>`COALESCE(SUM(CASE WHEN ${foodOrders.paymentStatus} != 'paid' THEN ${foodOrders.total} ELSE 0 END), 0)`,
      }).from(foodOrders).where(and(...foodWhere, sql`${foodOrders.status} != 'cancelled'`)),
      db.select({ hour: sql<number>`CAST(strftime('%H', ${foodOrders.createdAt}, '+05:30') AS INTEGER)`, orders: sql<number>`COUNT(*)`, revenue: sql<number>`COALESCE(SUM(${foodOrders.total}), 0)` })
        .from(foodOrders).where(and(...foodWhere, sql`${foodOrders.status} != 'cancelled'`)).groupBy(sql`strftime('%H', ${foodOrders.createdAt}, '+05:30')`).orderBy(sql`strftime('%H', ${foodOrders.createdAt}, '+05:30')`),
      db.select({ item: foodOrderItems.itemName, quantity: sql<number>`COALESCE(SUM(${foodOrderItems.quantity}), 0)`, revenue: sql<number>`COALESCE(SUM(${foodOrderItems.lineTotal}), 0)` })
        .from(foodOrderItems).innerJoin(foodOrders, eq(foodOrderItems.orderId, foodOrders.id)).where(and(...foodWhere, sql`${foodOrders.status} != 'cancelled'`, sql`${foodOrderItems.status} = 'active'`)).groupBy(foodOrderItems.itemName).orderBy(sql`SUM(${foodOrderItems.quantity}) DESC`).limit(15),
      db.select({ expenses: sql<number>`COUNT(*)`, total: sql<number>`COALESCE(SUM(${expenses.amount}), 0)` }).from(expenses).where(and(...expenseWhere)),
      db.select({ category: sql<string>`COALESCE(NULLIF(${expenses.subCategory}, ''), NULLIF(${expenses.category}, ''), 'Unknown')`, total: sql<number>`COALESCE(SUM(${expenses.amount}), 0)`, count: sql<number>`COUNT(*)` })
        .from(expenses).where(and(...expenseWhere)).groupBy(sql`COALESCE(NULLIF(${expenses.subCategory}, ''), NULLIF(${expenses.category}, ''), 'Unknown')`).orderBy(sql`SUM(${expenses.amount}) DESC`),
    ]);

    const food = foodSummary[0] || { orders: 0, gross: 0, paid: 0, pending: 0 };
    const bookingsResult = bookingSummary[0] || { total: 0, confirmed: 0, cancelled: 0, noShow: 0, revenue: 0 };
    const stays = staySummary[0] || { stays: 0, guests: 0, revenue: 0 };
    const finance = expenseSummary[0] || { expenses: 0, total: 0 };
    const availableBedNights = null;
    const occupiedBedNights = null;
    const bookedStayValue = Number(stays.revenue || 0);
    const totalRevenue = bookedStayValue + Number(food.gross || 0);

    return NextResponse.json({
      range: { fromDate, toDate, days: daysBetween(fromDate, toDate), timezone: "Asia/Kolkata" },
      summary: {
        bookings: Number(bookingsResult.total || 0), plannedStays: Number(stays.stays || 0), actualCheckIns: Number(stayEvents[0]?.checkIns || 0), actualCheckOuts: Number(stayEvents[0]?.checkOuts || 0), guests: Number(stays.guests || 0),
        cancellations: Number(bookingsResult.cancelled || 0), noShows: Number(bookingsResult.noShow || 0),
        bookedStayValue, foodRevenue: Number(food.gross || 0), totalRevenue, expenses: Number(finance.total || 0),
        activityBalance: totalRevenue - Number(finance.total || 0), foodOrders: Number(food.orders || 0), foodPaid: Number(food.paid || 0), foodPending: Number(food.pending || 0),
        availableBedNights, occupiedBedNights,
      },
      bookings: {
        byDay: bookingByDay.map((r) => ({ date: dateOnly(String(r.date)), count: Number(r.count || 0) })),
        byHour: bookingByHour.map((r) => ({ hour: Number(r.hour || 0), count: Number(r.count || 0) })),
        byWeekday: bookingByWeekday.map((r) => ({ weekday: Number(r.weekday || 0), count: Number(r.count || 0) })),
        byChannel: channelRows.map((r) => ({ channel: r.channel || "Unknown", count: Number(r.count || 0), revenue: Number(r.revenue || 0) })),
      },
      stays: { ...stays, bookedStayValue, adr: Number(stays.stays || 0) ? bookedStayValue / Number(stays.stays) : 0 },
      food: { byHour: foodByHour.map((r) => ({ hour: Number(r.hour || 0), orders: Number(r.orders || 0), revenue: Number(r.revenue || 0) })), topItems: foodItems.map((r) => ({ item: r.item, quantity: Number(r.quantity || 0), revenue: Number(r.revenue || 0) })) },
      finance: { byCategory: expenseByCategory.map((r) => ({ category: r.category, count: Number(r.count || 0), total: Number(r.total || 0) })) },
      dataQuality: { availableBedNights: false, actualFoodPrepTimes: false, otaCommission: false, expenseBusinessDate: false },
      definitions: { bookedStayValue: "Prorated booking totals by overlapping stay nights; not cash collected or earned revenue", foodSales: "Non-cancelled food order totals", activityBalance: "Booked stay value plus food sales minus recorded expenses; not cash, profit, or accrual revenue", bookingsByHour: "Booking created timestamp in Asia/Kolkata", plannedStays: "Confirmed or completed bookings whose check-in date falls in the selected range", actualCheckIns: "Bookings with a checked-in timestamp in the selected range" },
      generatedAt: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error("Analytics API error:", error?.message || error);
    return NextResponse.json({ error: "Unable to load analytics" }, { status: 500 });
  }
}
