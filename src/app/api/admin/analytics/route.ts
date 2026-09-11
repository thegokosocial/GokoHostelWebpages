import { NextRequest, NextResponse } from "next/server";
import { and, eq, gte, lt, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { authenticateUser } from "@/lib/auth";
import {
  bedBlocks,
  beds,
  bookingBedAssignments,
  bookings,
  expenses,
  foodOrderItems,
  foodOrders,
  menuCategories,
  menuItems,
  guestReceipts,
} from "@/db/schema";
import { todayIST } from "@/lib/utils";
import { parseGokoWalkin } from "@/lib/bookingPricing";

const ACTIVE_STAY_STATUSES = sql`${bookings.status} IN ('confirmed', 'checked_in', 'checked_out')`;
const EXPECTED_ROOM_STATUSES = sql`${bookings.status} IN ('received', 'confirmed', 'checked_in', 'checked_out')`;

function utcStart(date: string) {
  return new Date(`${date}T00:00:00.000+05:30`).toISOString();
}

function utcExclusiveEnd(date: string) {
  const value = new Date(`${date}T00:00:00.000+05:30`);
  value.setTime(value.getTime() + 86400000);
  return value.toISOString();
}

function nextDate(date: string) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + 1);
  return value.toISOString().slice(0, 10);
}

function nextMonth(date: string) {
  const value = new Date(`${date.slice(0, 7)}-01T00:00:00Z`);
  value.setUTCMonth(value.getUTCMonth() + 1);
  return value.toISOString().slice(0, 10);
}

function parseDate(value: unknown, fallback: string) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return fallback;
  const parsed = new Date(`${value}T00:00:00Z`);
  return parsed.toISOString().slice(0, 10) === value ? value : fallback;
}

function daysBetween(from: string, to: string) {
  return Math.max(1, Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000) + 1);
}

function dateOnly(value: string) {
  return value.slice(0, 10);
}

function number(value: unknown) {
  return Number(value || 0);
}

function dateRange(from: string, to: string) {
  const result: string[] = [];
  for (let current = from; current <= to; current = nextDate(current)) result.push(current);
  return result;
}

function leadBucketSql() {
  return sql`CASE
    WHEN julianday(${bookings.checkinDate}) - julianday(date(${bookings.createdAt}, '+05:30')) <= 1 THEN '0–1 days'
    WHEN julianday(${bookings.checkinDate}) - julianday(date(${bookings.createdAt}, '+05:30')) <= 3 THEN '2–3 days'
    WHEN julianday(${bookings.checkinDate}) - julianday(date(${bookings.createdAt}, '+05:30')) <= 7 THEN '4–7 days'
    WHEN julianday(${bookings.checkinDate}) - julianday(date(${bookings.createdAt}, '+05:30')) <= 14 THEN '8–14 days'
    WHEN julianday(${bookings.checkinDate}) - julianday(date(${bookings.createdAt}, '+05:30')) <= 30 THEN '15–30 days'
    ELSE '31+ days'
  END`;
}

function roomClassSql() {
  return sql`CASE
    WHEN lower(COALESCE(${bookings.roomType}, '')) LIKE '%dorm%'
      OR lower(COALESCE(${bookings.roomType}, '')) LIKE '%hostel%'
      OR lower(COALESCE(${bookings.roomType}, '')) LIKE '%bed%' THEN 'dorm/bed'
    WHEN lower(COALESCE(${bookings.roomType}, '')) LIKE '%single%'
      OR lower(COALESCE(${bookings.roomType}, '')) LIKE '%-s-%' THEN 'single'
    WHEN lower(COALESCE(${bookings.roomType}, '')) LIKE '%double%'
      OR lower(COALESCE(${bookings.roomType}, '')) LIKE '%twin%'
      OR lower(COALESCE(${bookings.roomType}, '')) LIKE '%-d-%' THEN 'double'
    ELSE 'other'
  END`;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const auth = await authenticateUser(body.password, body.username);
    if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (auth.role !== "admin" && auth.role !== "manager" && !auth.permissions.canViewAnalytics) {
      return NextResponse.json({ error: "Manager access required" }, { status: 403 });
    }

    const today = todayIST();
    if (body.fromDate !== undefined && parseDate(body.fromDate, "") !== body.fromDate) return NextResponse.json({ error: "Invalid fromDate" }, { status: 400 });
    if (body.toDate !== undefined && parseDate(body.toDate, "") !== body.toDate) return NextResponse.json({ error: "Invalid toDate" }, { status: 400 });
    const fromDate = parseDate(body.fromDate, `${today.slice(0, 8)}01`);
    const toDate = parseDate(body.toDate, today);
    if (fromDate > toDate) return NextResponse.json({ error: "fromDate must be before toDate" }, { status: 400 });
    const days = daysBetween(fromDate, toDate);
    if (days > 366) return NextResponse.json({ error: "Analytics range cannot exceed 366 days" }, { status: 400 });

    const from = utcStart(fromDate);
    const to = utcExclusiveEnd(toDate);
    const stayToExclusive = nextDate(toDate);
    const monthStart = `${toDate.slice(0, 8)}01`;
    const monthEndExclusive = nextMonth(toDate);
    const monthDays = Math.round((Date.parse(`${monthEndExclusive}T00:00:00Z`) - Date.parse(`${monthStart}T00:00:00Z`)) / 86400000);
    const db = getDb();
    const bookingWhere = [gte(bookings.createdAt, from), lt(bookings.createdAt, to)];
    const stayWhere = [gte(bookings.checkinDate, fromDate), lt(bookings.checkinDate, stayToExclusive)];
    const foodWhere = [gte(foodOrders.createdAt, from), lt(foodOrders.createdAt, to)];
    const expenseWhere = [gte(expenses.createdAt, from), lt(expenses.createdAt, to)];
    const assignmentWhere = [
      eq(bookingBedAssignments.status, "assigned"),
      lt(bookingBedAssignments.checkinDate, stayToExclusive),
      sql`${bookingBedAssignments.checkoutDate} > ${fromDate}`,
    ];
    const getBlockRows = async () => {
      try {
        return await db.select({ bedId: bedBlocks.bedId, startDate: bedBlocks.startDate, endDate: bedBlocks.endDate }).from(bedBlocks).where(and(eq(bedBlocks.isActive, 1), lt(bedBlocks.startDate, stayToExclusive), sql`${bedBlocks.endDate} > ${fromDate}`));
      } catch {
        // Older local databases may predate date-specific bed blocks. Occupancy still works from bed assignments.
        return [] as { bedId: number; startDate: string; endDate: string }[];
      }
    };

    const [
      bookingSummary,
      bookingByDay,
      bookingByHour,
      bookingByWeekday,
      bookingByWeekdayHour,
      stayByWeekday,
      channelRows,
      bookingPaymentRows,
      bookingWindowRows,
      staySummary,
      stayByDay,
      stayByRoomType,
      expectedRoomRevenue,
      bookingFinanceRows,
      stayRefundRows,
      foodRefundRows,
      stayEvents,
      checkInByHour,
      checkOutByHour,
      foodSummary,
      foodByDay,
      foodByHour,
      foodItems,
      foodByCategory,
      foodByGuestType,
      foodByPaymentMethod,
      expenseSummary,
      expenseByCategory,
      expenseByMonth,
      expenseByDay,
      bedRows,
      assignmentRows,
      blockRows,
    ] = await Promise.all([
      db.select({
        total: sql<number>`COUNT(*)`,
        confirmed: sql<number>`SUM(CASE WHEN ${ACTIVE_STAY_STATUSES} THEN 1 ELSE 0 END)`,
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
      db.select({ weekday: sql<number>`CAST(strftime('%w', ${bookings.createdAt}, '+05:30') AS INTEGER)`, hour: sql<number>`CAST(strftime('%H', ${bookings.createdAt}, '+05:30') AS INTEGER)`, count: sql<number>`COUNT(*)` })
        .from(bookings).where(and(...bookingWhere)).groupBy(sql`strftime('%w', ${bookings.createdAt}, '+05:30')`, sql`strftime('%H', ${bookings.createdAt}, '+05:30')`).orderBy(sql`strftime('%w', ${bookings.createdAt}, '+05:30')`, sql`strftime('%H', ${bookings.createdAt}, '+05:30')`),
      db.select({ weekday: sql<number>`CAST(strftime('%w', ${bookings.checkinDate}) AS INTEGER)`, count: sql<number>`COUNT(*)` })
        .from(bookings).where(and(...stayWhere, ACTIVE_STAY_STATUSES)).groupBy(sql`strftime('%w', ${bookings.checkinDate})`).orderBy(sql`strftime('%w', ${bookings.checkinDate})`),
      db.select({
        channel: sql<string>`COALESCE(NULLIF(${bookings.platform}, ''), 'unknown')`,
        count: sql<number>`SUM(CASE WHEN ${bookings.status} != 'cancelled' THEN 1 ELSE 0 END)`,
        revenue: sql<number>`COALESCE(SUM(CASE WHEN ${bookings.status} != 'cancelled' THEN ${bookings.amountTotal} ELSE 0 END), 0)`,
        guests: sql<number>`COALESCE(SUM(CASE WHEN ${bookings.status} != 'cancelled' THEN ${bookings.persons} ELSE 0 END), 0)`,
      }).from(bookings).where(and(...bookingWhere)).groupBy(sql`COALESCE(NULLIF(${bookings.platform}, ''), 'unknown')`).orderBy(sql`SUM(CASE WHEN ${bookings.status} != 'cancelled' THEN 1 ELSE 0 END) DESC`),
      db.select({
        payment: sql<string>`CASE
          WHEN lower(COALESCE(${bookings.paymentStatus}, '')) IN ('paid', 'prepaid', 'online') THEN 'prepaid'
          WHEN lower(COALESCE(${bookings.paymentStatus}, '')) IN ('partial', 'partially_paid') THEN 'partial'
          WHEN lower(COALESCE(${bookings.paymentStatus}, '')) IN ('pay_at_property', 'postpaid', 'pending', 'unpaid') THEN 'postpaid'
          ELSE 'unknown'
        END`,
        count: sql<number>`COUNT(*)`,
        value: sql<number>`COALESCE(SUM(${bookings.amountTotal}), 0)`,
      }).from(bookings).where(and(...bookingWhere, sql`${bookings.status} != 'cancelled'`)).groupBy(sql`CASE
        WHEN lower(COALESCE(${bookings.paymentStatus}, '')) IN ('paid', 'prepaid', 'online') THEN 'prepaid'
        WHEN lower(COALESCE(${bookings.paymentStatus}, '')) IN ('partial', 'partially_paid') THEN 'partial'
        WHEN lower(COALESCE(${bookings.paymentStatus}, '')) IN ('pay_at_property', 'postpaid', 'pending', 'unpaid') THEN 'postpaid'
        ELSE 'unknown'
      END`).orderBy(sql`COUNT(*) DESC`),
      db.select({ bucket: leadBucketSql(), count: sql<number>`COUNT(*)` })
        .from(bookings).where(and(...bookingWhere, sql`${bookings.status} != 'cancelled'`)).groupBy(leadBucketSql()).orderBy(sql`MIN(julianday(${bookings.checkinDate}) - julianday(date(${bookings.createdAt}, '+05:30'))) ASC`),
      db.select({
        stays: sql<number>`COUNT(*)`,
        guests: sql<number>`COALESCE(SUM(${bookings.persons}), 0)`,
        revenue: sql<number>`COALESCE(SUM(${bookings.amountTotal} * (MAX(0, MIN(julianday(${bookings.checkoutDate}), julianday(${stayToExclusive})) - MAX(julianday(${bookings.checkinDate}), julianday(${fromDate})))) / MAX(1, julianday(${bookings.checkoutDate}) - julianday(${bookings.checkinDate}))), 0)`,
        obtainedRevenue: sql<number>`COALESCE(SUM(${bookings.amountPaid}), 0)`,
        nights: sql<number>`COALESCE(SUM(MAX(0, MIN(julianday(${bookings.checkoutDate}), julianday(${stayToExclusive})) - MAX(julianday(${bookings.checkinDate}), julianday(${fromDate})))), 0)`,
        leadDays: sql<number>`COALESCE(SUM(MAX(0, julianday(${bookings.checkinDate}) - julianday(date(${bookings.createdAt}, '+05:30')))), 0)`,
      }).from(bookings).where(and(...stayWhere, ACTIVE_STAY_STATUSES, sql`${bookings.checkoutDate} > ${bookings.checkinDate}`)),
      db.select({ date: bookings.checkinDate, arrivals: sql<number>`COUNT(*)`, guests: sql<number>`COALESCE(SUM(${bookings.persons}), 0)`, revenue: sql<number>`COALESCE(SUM(${bookings.amountTotal}), 0)` })
        .from(bookings).where(and(...stayWhere, ACTIVE_STAY_STATUSES, sql`${bookings.checkoutDate} > ${bookings.checkinDate}`)).groupBy(bookings.checkinDate).orderBy(bookings.checkinDate),
      db.select({
        roomType: sql<string>`COALESCE(NULLIF(${bookings.roomType}, ''), 'unspecified')`,
        roomClass: roomClassSql(),
        stays: sql<number>`COUNT(*)`,
        guests: sql<number>`COALESCE(SUM(${bookings.persons}), 0)`,
        nights: sql<number>`COALESCE(SUM(MAX(0, MIN(julianday(${bookings.checkoutDate}), julianday(${stayToExclusive})) - MAX(julianday(${bookings.checkinDate}), julianday(${fromDate})))), 0)`,
        revenue: sql<number>`COALESCE(SUM(${bookings.amountTotal} * (MAX(0, MIN(julianday(${bookings.checkoutDate}), julianday(${stayToExclusive})) - MAX(julianday(${bookings.checkinDate}), julianday(${fromDate})))) / MAX(1, julianday(${bookings.checkoutDate}) - julianday(${bookings.checkinDate}))), 0)`,
      }).from(bookings).where(and(...stayWhere, EXPECTED_ROOM_STATUSES, sql`${bookings.checkoutDate} > ${bookings.checkinDate}`))
        .groupBy(sql`COALESCE(NULLIF(${bookings.roomType}, ''), 'unspecified')`, roomClassSql()).orderBy(sql`COUNT(*) DESC`),
      db.select({
        stays: sql<number>`COUNT(*)`,
        nights: sql<number>`COALESCE(SUM(MAX(0, MIN(julianday(${bookings.checkoutDate}), julianday(${monthEndExclusive})) - MAX(julianday(${bookings.checkinDate}), julianday(${monthStart})))), 0)`,
        revenue: sql<number>`COALESCE(SUM(${bookings.amountTotal} * (MAX(0, MIN(julianday(${bookings.checkoutDate}), julianday(${monthEndExclusive})) - MAX(julianday(${bookings.checkinDate}), julianday(${monthStart})))) / MAX(1, julianday(${bookings.checkoutDate}) - julianday(${bookings.checkinDate}))), 0)`,
        obtainedRevenue: sql<number>`COALESCE(SUM(${bookings.amountPaid}), 0)`,
      }).from(bookings).where(and(
        lt(bookings.checkinDate, monthEndExclusive),
        sql`${bookings.checkoutDate} > ${monthStart}`,
        lt(bookings.createdAt, to),
        EXPECTED_ROOM_STATUSES,
        sql`${bookings.checkoutDate} > ${bookings.checkinDate}`,
      )),
      db.select({ rawData: bookings.rawData, status: bookings.status }).from(bookings).where(and(...bookingWhere, sql`${bookings.status} != 'cancelled'`)),
      db.select({ amount: bookings.amountRefunded }).from(bookings).where(and(gte(bookings.refundedAt, from), lt(bookings.refundedAt, to), sql`${bookings.amountRefunded} > 0`)),
      db.select({ amount: guestReceipts.amount }).from(guestReceipts).where(and(
        gte(guestReceipts.businessDate, fromDate),
        lt(guestReceipts.businessDate, stayToExclusive),
        eq(guestReceipts.sourceType, "food_order"),
        eq(guestReceipts.kind, "refund"),
        sql`${guestReceipts.amount} < 0`,
      )),
      db.select({ checkIns: sql<number>`SUM(CASE WHEN ${bookings.checkedInAt} >= ${from} AND ${bookings.checkedInAt} < ${to} THEN 1 ELSE 0 END)`, checkOuts: sql<number>`SUM(CASE WHEN ${bookings.checkedOutAt} >= ${from} AND ${bookings.checkedOutAt} < ${to} THEN 1 ELSE 0 END)` }).from(bookings),
      db.select({ hour: sql<number>`CAST(strftime('%H', ${bookings.checkedInAt}, '+05:30') AS INTEGER)`, count: sql<number>`COUNT(*)` })
        .from(bookings).where(and(gte(bookings.checkedInAt, from), lt(bookings.checkedInAt, to))).groupBy(sql`strftime('%H', ${bookings.checkedInAt}, '+05:30')`).orderBy(sql`strftime('%H', ${bookings.checkedInAt}, '+05:30')`),
      db.select({ hour: sql<number>`CAST(strftime('%H', ${bookings.checkedOutAt}, '+05:30') AS INTEGER)`, count: sql<number>`COUNT(*)` })
        .from(bookings).where(and(gte(bookings.checkedOutAt, from), lt(bookings.checkedOutAt, to))).groupBy(sql`strftime('%H', ${bookings.checkedOutAt}, '+05:30')`).orderBy(sql`strftime('%H', ${bookings.checkedOutAt}, '+05:30')`),
      db.select({ orders: sql<number>`COUNT(*)`, gross: sql<number>`COALESCE(SUM(${foodOrders.total}), 0)`, discounts: sql<number>`COALESCE(SUM(${foodOrders.discount}), 0)`, paid: sql<number>`COALESCE(SUM(CASE WHEN ${foodOrders.paymentStatus} = 'paid' THEN ${foodOrders.total} ELSE 0 END), 0)`, pending: sql<number>`COALESCE(SUM(CASE WHEN ${foodOrders.paymentStatus} != 'paid' THEN ${foodOrders.total} ELSE 0 END), 0)` }).from(foodOrders).where(and(...foodWhere, sql`${foodOrders.status} != 'cancelled'`)),
      db.select({ date: sql<string>`date(${foodOrders.createdAt}, '+05:30')`, orders: sql<number>`COUNT(*)`, revenue: sql<number>`COALESCE(SUM(${foodOrders.total}), 0)` })
        .from(foodOrders).where(and(...foodWhere, sql`${foodOrders.status} != 'cancelled'`)).groupBy(sql`date(${foodOrders.createdAt}, '+05:30')`).orderBy(sql`date(${foodOrders.createdAt}, '+05:30')`),
      db.select({ hour: sql<number>`CAST(strftime('%H', ${foodOrders.createdAt}, '+05:30') AS INTEGER)`, orders: sql<number>`COUNT(*)`, revenue: sql<number>`COALESCE(SUM(${foodOrders.total}), 0)` })
        .from(foodOrders).where(and(...foodWhere, sql`${foodOrders.status} != 'cancelled'`)).groupBy(sql`strftime('%H', ${foodOrders.createdAt}, '+05:30')`).orderBy(sql`strftime('%H', ${foodOrders.createdAt}, '+05:30')`),
      db.select({ item: foodOrderItems.itemName, quantity: sql<number>`COALESCE(SUM(${foodOrderItems.quantity}), 0)`, revenue: sql<number>`COALESCE(SUM(${foodOrderItems.lineTotal}), 0)` })
        .from(foodOrderItems).innerJoin(foodOrders, eq(foodOrderItems.orderId, foodOrders.id)).where(and(...foodWhere, sql`${foodOrders.status} != 'cancelled'`, eq(foodOrderItems.status, "active"))).groupBy(foodOrderItems.itemName).orderBy(sql`SUM(${foodOrderItems.quantity}) DESC`).limit(20),
      db.select({ category: sql<string>`COALESCE(NULLIF(${menuCategories.name}, ''), 'uncategorized')`, quantity: sql<number>`COALESCE(SUM(${foodOrderItems.quantity}), 0)`, revenue: sql<number>`COALESCE(SUM(${foodOrderItems.lineTotal}), 0)` })
        .from(foodOrderItems).innerJoin(foodOrders, eq(foodOrderItems.orderId, foodOrders.id)).leftJoin(menuItems, eq(foodOrderItems.menuItemId, menuItems.id)).leftJoin(menuCategories, eq(menuItems.categoryId, menuCategories.id)).where(and(...foodWhere, sql`${foodOrders.status} != 'cancelled'`, eq(foodOrderItems.status, "active"))).groupBy(sql`COALESCE(NULLIF(${menuCategories.name}, ''), 'uncategorized')`).orderBy(sql`SUM(${foodOrderItems.lineTotal}) DESC`),
      db.select({ guestType: sql<string>`COALESCE(NULLIF(${foodOrders.guestType}, ''), 'unknown')`, orders: sql<number>`COUNT(*)`, revenue: sql<number>`COALESCE(SUM(${foodOrders.total}), 0)` }).from(foodOrders).where(and(...foodWhere, sql`${foodOrders.status} != 'cancelled'`)).groupBy(sql`COALESCE(NULLIF(${foodOrders.guestType}, ''), 'unknown')`).orderBy(sql`SUM(${foodOrders.total}) DESC`),
      db.select({ paymentMethod: sql<string>`COALESCE(NULLIF(${foodOrders.paymentMethod}, ''), CASE WHEN ${foodOrders.paymentStatus} = 'paid' THEN 'unspecified paid' ELSE 'unpaid' END)`, orders: sql<number>`COUNT(*)`, revenue: sql<number>`COALESCE(SUM(${foodOrders.total}), 0)` }).from(foodOrders).where(and(...foodWhere, sql`${foodOrders.status} != 'cancelled'`)).groupBy(sql`COALESCE(NULLIF(${foodOrders.paymentMethod}, ''), CASE WHEN ${foodOrders.paymentStatus} = 'paid' THEN 'unspecified paid' ELSE 'unpaid' END)`).orderBy(sql`SUM(${foodOrders.total}) DESC`),
      db.select({ expenses: sql<number>`COUNT(*)`, total: sql<number>`COALESCE(SUM(${expenses.amount}), 0)` }).from(expenses).where(and(...expenseWhere)),
      db.select({ category: sql<string>`COALESCE(NULLIF(${expenses.subCategory}, ''), NULLIF(${expenses.category}, ''), 'unknown')`, total: sql<number>`COALESCE(SUM(${expenses.amount}), 0)`, count: sql<number>`COUNT(*)` }).from(expenses).where(and(...expenseWhere)).groupBy(sql`COALESCE(NULLIF(${expenses.subCategory}, ''), NULLIF(${expenses.category}, ''), 'unknown')`).orderBy(sql`SUM(${expenses.amount}) DESC`),
      db.select({ month: sql<string>`strftime('%Y-%m', ${expenses.createdAt}, '+05:30')`, total: sql<number>`COALESCE(SUM(${expenses.amount}), 0)`, count: sql<number>`COUNT(*)` }).from(expenses).where(and(...expenseWhere)).groupBy(sql`strftime('%Y-%m', ${expenses.createdAt}, '+05:30')`).orderBy(sql`strftime('%Y-%m', ${expenses.createdAt}, '+05:30')`),
      db.select({ date: sql<string>`date(${expenses.createdAt}, '+05:30')`, total: sql<number>`COALESCE(SUM(${expenses.amount}), 0)` }).from(expenses).where(and(...expenseWhere)).groupBy(sql`date(${expenses.createdAt}, '+05:30')`).orderBy(sql`date(${expenses.createdAt}, '+05:30')`),
      db.select({ id: beds.id, isBlocked: beds.isBlocked }).from(beds),
      db.select({ bedId: bookingBedAssignments.bedId, checkinDate: bookingBedAssignments.checkinDate, checkoutDate: bookingBedAssignments.checkoutDate }).from(bookingBedAssignments).innerJoin(bookings, eq(bookingBedAssignments.bookingId, bookings.id)).where(and(...assignmentWhere, sql`${bookings.status} NOT IN ('cancelled', 'no_show')`)),
      getBlockRows(),
    ]);

    const dates = dateRange(fromDate, toDate);
    const bedIds = bedRows.filter((row) => !row.isBlocked).map((row) => row.id);
    const bedIdSet = new Set(bedIds);
    const occupancyByDate = dates.map((date) => {
      const occupied = new Set(assignmentRows.filter((row) => bedIdSet.has(row.bedId) && row.checkinDate <= date && row.checkoutDate > date).map((row) => row.bedId));
      const blocked = new Set(blockRows.filter((row) => row.startDate <= date && row.endDate > date && bedIdSet.has(row.bedId)).map((row) => row.bedId));
      const available = Math.max(0, bedIds.length - blocked.size);
      const occupiedCount = [...occupied].filter((id) => !blocked.has(id)).length;
      return { date, occupiedBeds: occupiedCount, availableBeds: available, occupancy: available ? (occupiedCount / available) * 100 : null };
    });

    const bookingByDate = new Map(bookingByDay.map((row) => [dateOnly(String(row.date)), number(row.count)]));
    const arrivalsByDate = new Map(stayByDay.map((row) => [row.date, { arrivals: number(row.arrivals), guests: number(row.guests), revenue: number(row.revenue) }]));
    const foodByDate = new Map(foodByDay.map((row) => [dateOnly(String(row.date)), { orders: number(row.orders), revenue: number(row.revenue) }]));
    const expensesByDate = new Map(expenseByDay.map((row) => [dateOnly(String(row.date)), number(row.total)]));
    const trend = dates.map((date, index) => ({
      date,
      bookings: bookingByDate.get(date) || 0,
      arrivals: arrivalsByDate.get(date)?.arrivals || 0,
      guests: arrivalsByDate.get(date)?.guests || 0,
      stayRevenue: arrivalsByDate.get(date)?.revenue || 0,
      foodOrders: foodByDate.get(date)?.orders || 0,
      foodRevenue: foodByDate.get(date)?.revenue || 0,
      expenses: expensesByDate.get(date) || 0,
      occupiedBedNights: occupancyByDate[index].occupiedBeds,
      availableBedNights: occupancyByDate[index].availableBeds,
      occupancy: occupancyByDate[index].occupancy,
    }));

    const bookingResult = bookingSummary[0] || { total: 0, confirmed: 0, cancelled: 0, noShow: 0, revenue: 0 };
    const stayResult = staySummary[0] || { stays: 0, guests: 0, revenue: 0, obtainedRevenue: 0, nights: 0, leadDays: 0 };
    const foodResult = foodSummary[0] || { orders: 0, gross: 0, discounts: 0, paid: 0, pending: 0 };
    const expenseResult = expenseSummary[0] || { expenses: 0, total: 0 };
    const expectedRoom = expectedRoomRevenue[0] || { stays: 0, nights: 0, revenue: 0, obtainedRevenue: 0 };
    const bookedStayValue = number(stayResult.revenue);
    const foodRevenue = number(foodResult.gross);
    const obtainedRoomRevenue = number(stayResult.obtainedRevenue);
    const stayDiscounts = bookingFinanceRows.reduce((sum, row) => sum + (parseGokoWalkin(row.rawData)?.discount || 0), 0);
    const stayRefunds = stayRefundRows.reduce((sum, row) => sum + number(row.amount), 0);
    const foodRefunds = foodRefundRows.reduce((sum, row) => sum + Math.abs(number(row.amount)), 0);
    const availableBedNights = occupancyByDate.reduce((sum, row) => sum + row.availableBeds, 0);
    const occupiedBedNights = occupancyByDate.reduce((sum, row) => sum + row.occupiedBeds, 0);
    // Booking amounts are stored in rupees; food and expenses are stored in paise.
    // Keep stay KPIs in rupees and convert only the combined activity view to paise.
    const totalRevenue = (bookedStayValue * 100) + foodRevenue;
    const stayCount = number(stayResult.stays);
    const nights = number(stayResult.nights);
    const averageLeadDays = stayCount ? number(stayResult.leadDays) / stayCount : 0;
    const adr = nights ? bookedStayValue / nights : 0;
    const revpar = availableBedNights ? bookedStayValue / availableBedNights : 0;
    const averageStayLength = stayCount ? nights / stayCount : 0;
    const roomClassTotals = new Map<string, { stays: number; guests: number; nights: number; revenue: number }>();
    for (const row of stayByRoomType) {
      const roomClass = String(row.roomClass || "other");
      const current = roomClassTotals.get(roomClass) || { stays: 0, guests: 0, nights: 0, revenue: 0 };
      current.stays += number(row.stays);
      current.guests += number(row.guests);
      current.nights += number(row.nights);
      current.revenue += number(row.revenue);
      roomClassTotals.set(roomClass, current);
    }
    const byRoomClass = [...roomClassTotals.entries()]
      .sort(([, a], [, b]) => b.stays - a.stays)
      .map(([roomClass, row]) => ({ roomClass, ...row, adr: row.nights ? row.revenue / row.nights : 0 }));

    return NextResponse.json({
      range: { fromDate, toDate, days, timezone: "Asia/Kolkata" },
      summary: {
        bookings: number(bookingResult.total), plannedStays: stayCount,
        actualCheckIns: number(stayEvents[0]?.checkIns), actualCheckOuts: number(stayEvents[0]?.checkOuts), guests: number(stayResult.guests),
        cancellations: number(bookingResult.cancelled), noShows: number(bookingResult.noShow), completedBookings: number(stayEvents[0]?.checkIns), bookedStayValue, obtainedRoomRevenue, foodRevenue, totalRevenue,
        expenses: number(expenseResult.total), activityBalance: totalRevenue - number(expenseResult.total), foodOrders: number(foodResult.orders), foodPaid: number(foodResult.paid), foodPending: number(foodResult.pending),
        expectedRoomRevenue: number(expectedRoom.revenue), expectedRoomObtainedRevenue: number(expectedRoom.obtainedRevenue), expectedRoomStays: number(expectedRoom.stays), expectedRoomNights: number(expectedRoom.nights), expectedRoomMonth: monthStart.slice(0, 7), expectedRoomMonthDays: monthDays,
        stayRefunds, foodRefunds, stayDiscounts, foodDiscounts: number(foodResult.discounts),
        averageDailyBookings: number(bookingResult.total) / days, averageDailyCompletedBookings: number(stayEvents[0]?.checkIns) / days, averageDailyRoomValue: obtainedRoomRevenue / days, averageDailyFoodSales: foodRevenue / days, averageDailyExpenses: number(expenseResult.total) / days,
        occupiedBedNights: bedIds.length ? occupiedBedNights : null, availableBedNights: bedIds.length ? availableBedNights : null,
        occupancy: availableBedNights ? (occupiedBedNights / availableBedNights) * 100 : null, adr, revpar, averageStayLength, averageLeadDays,
      },
      trend,
      bookings: {
        byDay: bookingByDay.map((row) => ({ date: dateOnly(String(row.date)), count: number(row.count) })),
        byHour: bookingByHour.map((row) => ({ hour: number(row.hour), count: number(row.count) })),
        byWeekday: bookingByWeekday.map((row) => ({ weekday: number(row.weekday), count: number(row.count) })),
        byWeekdayHour: bookingByWeekdayHour.map((row) => ({ weekday: number(row.weekday), hour: number(row.hour), count: number(row.count) })),
        stayByWeekday: stayByWeekday.map((row) => ({ weekday: number(row.weekday), count: number(row.count) })),
        byChannel: channelRows.map((row) => ({ channel: row.channel || "unknown", count: number(row.count), revenue: number(row.revenue), guests: number(row.guests) })),
        byPayment: bookingPaymentRows.map((row) => ({ payment: row.payment, count: number(row.count), value: number(row.value) })),
        byBookingWindow: bookingWindowRows.map((row) => ({ bucket: row.bucket, count: number(row.count) })),
        checkInsByHour: checkInByHour.map((row) => ({ hour: number(row.hour), count: number(row.count) })),
        checkOutsByHour: checkOutByHour.map((row) => ({ hour: number(row.hour), count: number(row.count) })),
      },
      stays: {
        stays: stayCount, guests: number(stayResult.guests), revenue: number(stayResult.revenue), nights, adr, revpar, averageStayLength, averageLeadDays,
        byRoomClass,
        byRoomType: stayByRoomType.map((row) => {
          const nights = number(row.nights);
          const revenue = number(row.revenue);
          return { roomType: row.roomType, roomClass: row.roomClass, stays: number(row.stays), guests: number(row.guests), nights, revenue, adr: nights ? revenue / nights : 0 };
        }),
      },
      occupancy: { byDate: occupancyByDate, totalBeds: bedIds.length, blockedBedNights: occupancyByDate.reduce((sum, row) => sum + (bedIds.length - row.availableBeds), 0) },
      food: {
        byDay: foodByDay.map((row) => ({ date: dateOnly(String(row.date)), orders: number(row.orders), revenue: number(row.revenue) })),
        byHour: foodByHour.map((row) => ({ hour: number(row.hour), orders: number(row.orders), revenue: number(row.revenue) })),
        topItems: foodItems.map((row) => ({ item: row.item, quantity: number(row.quantity), revenue: number(row.revenue) })),
        byCategory: foodByCategory.map((row) => ({ category: row.category, quantity: number(row.quantity), revenue: number(row.revenue) })),
        byGuestType: foodByGuestType.map((row) => ({ guestType: row.guestType, orders: number(row.orders), revenue: number(row.revenue) })),
        byPaymentMethod: foodByPaymentMethod.map((row) => ({ paymentMethod: row.paymentMethod, orders: number(row.orders), revenue: number(row.revenue) })),
      },
      finance: {
        byCategory: expenseByCategory.map((row) => ({ category: row.category, count: number(row.count), total: number(row.total) })),
        byMonth: expenseByMonth.map((row) => ({ month: row.month, count: number(row.count), total: number(row.total) })),
        byDay: expenseByDay.map((row) => ({ date: dateOnly(String(row.date)), total: number(row.total) })), entries: number(expenseResult.expenses),
      },
      dataQuality: { occupancy: bedIds.length > 0, actualFoodPrepTimes: false, otaCommission: false, expenseBusinessDate: false },
      definitions: {
        bookedStayValue: "Prorated booking totals by overlapping stay nights; not cash collected or earned revenue",
        foodSales: "Non-cancelled food order totals, grouped by order time",
        occupancy: "Assigned bed-nights divided by sellable bed-nights; permanently blocked beds and active date blocks are excluded",
        adr: "Booked stay value divided by occupied bed-nights", revpar: "Booked stay value divided by available bed-nights",
        activityBalance: "Booked stay value plus food sales minus recorded expenses; not cash, profit, or accrual revenue",
        receivedDate: "Bookings, food orders, and expenses use their created/recorded timestamp in Asia/Kolkata",
        stayDate: "Stay metrics use guest check-in/check-out dates; checkout date is not a consumed night",
        bookingWindow: "Calendar days between booking creation date and check-in date",
        dailyAverages: "Daily values divided by the selected elapsed date range, including the end date",
        expectedRoomRevenue: "Booked room value from received/confirmed/completed bookings recorded by the report end date, prorated to the selected report month; cancelled and no-show bookings are excluded",
        obtainedRoomRevenue: "Amount paid so far on non-cancelled room bookings; room values are stored in rupees",
        refundsAndDiscounts: "Refunds use issued/receipt date; discounts use the booking/order recorded range because separate discount-event timestamps are not stored",
      },
      generatedAt: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error("Analytics API error:", error?.message || error);
    return NextResponse.json({ error: "Unable to load analytics" }, { status: 500 });
  }
}
