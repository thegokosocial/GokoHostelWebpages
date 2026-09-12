import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { accounts } from "@/db/schema";
import { authenticateUser } from "@/lib/auth";
import { actionAllowed, type ActionPerm } from "@/lib/actionPermissions";
import { otaFingerprint, pushIfOtaChanged, type InventorySyncResult } from "@/lib/aiosellSync";
import { occupiedNights, exclusiveEndDate, sellableUnits, type InventoryPool } from "@/lib/inventoryAvailability";
import {
  channelBedNeeds,
  channelNeedsAreMapped,
  enrichUnassignedBooking,
  requestedDormsForCodes,
  roomCodesFromChannelBooking,
} from "@/lib/channelAutoAssign";
import { pushNoShow } from "@/lib/aiosell";
import {
  getCalendarAvailability, getBookingCalendarData, getBookingTableData, getBookingDetail, searchBookings, getUnassignedBookings,
  checkBedAvailability, getAvailableBedsForRange, validateBedsForRange, assignBedToBooking, unassignBookingBeds,
  unassignBookingBedsByBedIds,
  cancelBedAssignments, addBookingHistoryEntry, getBookingHistoryEntries, getBookingAuditEntries,
  addBooking, updateBookingFull, transitionBookingStatus, getAllDorms, getAllBeds, getBedById,
  getChannelConfig, getSetting, setSetting,
  getRoomTypeMappings, getRatePlanMappings, getAllDailyRates,
  deactivateBedBlocksByBedIds, shortenAssignedCheckout,
} from "@/db/queries";
import { todayIST } from "@/lib/utils";
import { isStayPayMethod, stayDueAtHotel, mergeStayCollect, stayRefundCap, stayRefundWrite, prepaidCheckInWrite, prepaidCheckInRollback } from "@/lib/stayPayment";
import { createGuestReceipt, latestReceiptAccount, resolveReceiptAccount } from "@/lib/guestReceipts";
import { getPendingFoodTab } from "@/lib/foodTabDb";
import { dispatchPush, notificationFirstName, notificationDate, notificationStayDates } from "@/lib/pushNotify";
import {
  BOOKING_TAX_SETTING,
  bookingDiscountRupees,
  bookingTaxPercent,
  bookingTotals,
  parseGokoWalkin,
  stringifyGokoWalkin,
  walkinDiscountOnGross,
  nextGokoWalkinRaw,
} from "@/lib/bookingPricing";
import {
  BOOKING_WHATSAPP_SETTING,
  parseBookingWhatsAppTemplates,
  validateBookingWhatsAppTemplates,
} from "@/lib/bookingWhatsApp";

function bookingDateRange(checkinDate: string, checkoutDate?: string | null): string[] {
  return occupiedNights(checkinDate, checkoutDate);
}

function stayCheckout(checkinDate: string, checkoutDate?: string | null): string | null {
  return exclusiveEndDate(checkinDate, checkoutDate);
}

function stayClosed(status?: string | null): boolean {
  return status === "checked_out" || status === "no_show" || status === "cancelled";
}

function isBookingDotCom(platform?: string | null): boolean {
  return (platform || "").toLowerCase().replace(/[._\s-]/g, "") === "bookingcom";
}

function activeAssignmentDormIds(assignments: { dormId: number; status?: string }[] | undefined): number[] {
  return (assignments ?? [])
    .filter((a) => (a.status ?? "assigned") === "assigned")
    .map((a) => a.dormId);
}

function channelSource(source?: string | null): boolean {
  return source === "channel_manager";
}

function generateGokoBookingId(): string {
  const dateStr = todayIST().replace(/-/g, "");
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let random = "";
  for (let i = 0; i < 6; i++) random += chars[Math.floor(Math.random() * chars.length)];
  return `GOKO${dateStr}${random}`;
}

async function loadBookingTaxPercent(): Promise<number> {
  return bookingTaxPercent(await getSetting(BOOKING_TAX_SETTING));
}

function stayAmounts(gross: number, rawData: string | null | undefined, taxPercent: number) {
  const walkin = parseGokoWalkin(rawData);
  const priced = bookingTotals(gross, {
    discount: walkinDiscountOnGross(gross, walkin),
    taxPercent,
  });
  const totalBeforeTax = priced.beforeTax;
  const tax = priced.tax;
  return { totalBeforeTax, tax, total: totalBeforeTax + tax, discount: priced.discount, walkin };
}

function assignmentPool(existing?: string | null): InventoryPool {
  if (existing === "offline" || existing === "block" || existing === "online") return existing;
  return "online";
}

async function reassignSameBeds(
  bookingId: number,
  assignments: Array<{ bedId: number; dormId: number; inventoryPool?: string | null }>,
  checkinDate: string,
  checkoutDate: string,
  actingUser: string,
): Promise<boolean> {
  await unassignBookingBeds(bookingId);
  for (const a of assignments) {
    const ok = await assignBedToBooking({
      bookingId,
      bedId: a.bedId,
      dormId: a.dormId,
      checkinDate,
      checkoutDate,
      assignedBy: actingUser,
      inventoryPool: assignmentPool(a.inventoryPool),
    });
    if (!ok) {
      await unassignBookingBeds(bookingId);
      return false;
    }
  }
  return true;
}

async function pushIfGokoOccupancy(
  source: string | null | undefined,
  before: string,
  dormIds: number[],
  dates: string[],
) {
  if (channelSource(source) || !before) return;
  await pushIfOtaChanged(before, dormIds, dates).catch(async () => {
    await dispatchPush({
      title: "Inventory Sync Failed",
      body: "A booking changed availability · Open Management logs",
      url: "/admin?section=management",
      eventId: `inventory-sync-${dormIds.sort().join("-")}-${dates[0] || "unknown"}`,
      tag: "inventory-sync-failure",
      category: "operations",
    });
  });
}

async function affectedDormIds(
  detail: Awaited<ReturnType<typeof getBookingDetail>> | null | undefined,
  assignmentIds?: number[],
): Promise<number[]> {
  const assignments = detail?.assignments ?? [];
  const assigned = assignmentIds?.length
    ? assignments.filter((a) => assignmentIds.includes(a.id))
    : assignments.filter((a) => a.status === "assigned");
  const dormIds = assigned.map((a) => a.dormId);
  if (dormIds.length || !channelSource(detail?.booking.source)) return dormIds;
  const mappings = (await getRoomTypeMappings()) || [];
  const codes = roomCodesFromChannelBooking(null, detail!.booking.roomType, detail!.booking.rawData);
  return requestedDormsForCodes(codes, mappings).dormIds;
}

function inventoryWarning(result: InventorySyncResult | void): string | undefined {
  if (!result) return;
  return result.accepted ? undefined : result.message || "Aiosell did not confirm the inventory update";
}

async function syncBookingNoShow(bookingId: number, booking: { platform?: string | null; cmBookingId?: string | null }): Promise<string | undefined> {
  const attemptedAt = new Date().toISOString();
  if (!isBookingDotCom(booking.platform) || !booking.cmBookingId) {
    await updateBookingFull(bookingId, { noShowPmsStatus: "not_required", noShowPmsError: "", noShowPmsAttemptedAt: attemptedAt });
    return;
  }
  try {
    const config = await getChannelConfig();
    if (!config || !config.isActive) throw new Error("Aiosell channel manager is not active");
    const result = await pushNoShow({
      hotelCode: config.hotelCode,
      pmsId: config.pmsId,
      apiBaseUrl: config.apiBaseUrl,
      apiUsername: config.apiUsername,
      apiPassword: config.apiPassword,
    }, booking.cmBookingId);
    if (!result.success) throw new Error(result.message || "Aiosell rejected the no-show update");
    await updateBookingFull(bookingId, { noShowPmsStatus: "sent", noShowPmsError: "", noShowPmsAttemptedAt: attemptedAt });
    return;
  } catch (error: any) {
    const message = error?.message || "Aiosell no-show update failed";
    await updateBookingFull(bookingId, { noShowPmsStatus: "failed", noShowPmsError: message, noShowPmsAttemptedAt: attemptedAt });
    return message;
  }
}

async function assignTaggedBeds(
  bookingId: number,
  bedIds: number[],
  checkinDate: string,
  checkoutDate: string,
  actingUser: string,
): Promise<{ labels: string[]; pools: InventoryPool[]; dormIds: number[] }> {
  const tagged = await getAvailableBedsForRange(checkinDate, checkoutDate, undefined, bookingId);
  const byId = new Map(tagged.map((b) => [b.id, b]));
  const prepared: { bedId: number; dormId: number; dormName: string; bedLabel: string; pool: InventoryPool; tagPool: InventoryPool }[] = [];
  for (const bedId of bedIds) {
    const tag = byId.get(bedId);
    const bed = await getBedById(bedId);
    if (!bed || !tag) return { labels: [], pools: [], dormIds: [] };
    prepared.push({
      bedId,
      dormId: bed.dormId,
      dormName: bed.dormName,
      bedLabel: bed.bedId,
      pool: tag.pool,
      tagPool: tag.pool,
    });
  }
  const labels: string[] = [];
  const pools: InventoryPool[] = [];
  const dormIds: number[] = [];
  const written: number[] = [];
  for (const p of prepared) {
    const ok = await assignBedToBooking({
      bookingId,
      bedId: p.bedId,
      dormId: p.dormId,
      checkinDate,
      checkoutDate,
      assignedBy: actingUser,
      inventoryPool: p.pool,
    });
    if (!ok) {
      await unassignBookingBedsByBedIds(bookingId, written);
      return { labels: [], pools: [], dormIds: [] };
    }
    if (p.tagPool === "block") {
      await deactivateBedBlocksByBedIds([p.bedId], checkinDate, checkoutDate, actingUser);
    }
    written.push(p.bedId);
    labels.push(`${p.dormName}/${p.bedLabel}`);
    pools.push(p.pool);
    dormIds.push(p.dormId);
  }
  return { labels, pools, dormIds };
}

function assignFailed(requested: number[], labels: string[]): string | null {
  if (labels.length === requested.length) return null;
  return labels.length === 0
    ? "No beds could be assigned (conflicts exist)"
    : "Could not assign all selected beds";
}

function diffDays(start: string, end: string): number {
  return occupiedNights(start, end).length;
}

const ACTION_PERMISSIONS: Record<string, ActionPerm> = {
  getCalendarData: "canViewBookings",
  getAllBookings: "canViewBookings",
  getDetail: "canViewBookings",
  search: "canViewBookings",
  getUnassigned: "canViewBookings",
  checkAvailability: "canViewBookings",
  getAvailableBeds: "canViewBookings",
  getRoomReceiptAccounts: ["canAddBooking", "canCheckIn"],
  getBookingHistory: "canViewBookings",
  getBookingAuditLog: "canViewBookings",
  getWhatsAppTemplates: "canViewBookings",
  saveWhatsAppTemplates: ["canManageBookingTemplates", "canViewBookings"],
  createBooking: "canAddBooking",
  assignBeds: "canAddBooking",
  checkIn: ["canCheckIn", "canAddBooking"],
  collectStayPayment: ["canCheckIn", "canAddBooking"],
  checkOut: ["canCheckOut", "canAddBooking"],
  getPendingFoodTab: ["canCheckOut", "canAddBooking"],
  modifyCheckin: "canAddBooking",
  modifyCheckout: "canAddBooking",
  editReservation: "canAddBooking",
  moveRoom: "canAddBooking",
  assignGuest: "canAddBooking",
  cancelBooking: "canDeleteBooking",
  markNoShow: "canDeleteBooking",
  retryNoShow: "canDeleteBooking",
  hold: "canDeleteBooking",
  unassign: "canDeleteBooking",
  rollbackCheckIn: "admin_only",
  rollbackCheckOut: "admin_only",
};

export async function POST(req: NextRequest) {
  const requestId = req.headers.get("cf-ray") || crypto.randomUUID();
  let action = "unknown";
  let stage = "read request";
  try {
    const body = await req.json();
    const { password, username } = body;
    action = typeof body.action === "string" ? body.action : "unknown";

    stage = "authenticate user";
    const authResult = await authenticateUser(password, username);
    if (!authResult) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const { role, permissions } = authResult;
    const actingUser = username || role;

    const requiredPerm = ACTION_PERMISSIONS[action];
    if (!requiredPerm) {
      return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
    let gate = actionAllowed(role, permissions, requiredPerm);
    // Env manager has no permission keys; still allow Unassigned Reject (handler blocks assigned cancel).
    if (gate === "forbidden" && action === "cancelBooking" && role === "manager") {
      gate = "allowed";
    }
    if (gate === "forbidden" && role === "manager" && (action === "getWhatsAppTemplates" || action === "saveWhatsAppTemplates")) {
      gate = "allowed";
    }
    if (gate === "admin_required") {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }
    if (gate === "forbidden") {
      return NextResponse.json({ error: "You don't have permission to perform this action" }, { status: 403 });
    }

    // --- View Actions ---

    if (action === "getRoomReceiptAccounts") {
      const [items, defaultId] = await Promise.all([
        getDb().select({ id: accounts.id, name: accounts.name, nickname: accounts.nickname })
          .from(accounts).where(eq(accounts.isActive, 1)),
        getSetting("room_online_receipt_account_id"),
      ]);
      return NextResponse.json({ accounts: items, roomOnlineReceiptAccountId: defaultId });
    }

    if (action === "getAllBookings") {
      const { startDate, endDate, page, pageSize, status, query } = body;
      if (!startDate || !endDate) return NextResponse.json({ error: "startDate and endDate required" }, { status: 400 });
      const validStatuses = new Set(["received", "checked_in", "checked_out", "hold", "no_show", "cancelled", "modified"]);
      const requestedStatus = typeof status === "string" && status !== "all" ? status : undefined;
      if (requestedStatus && !validStatuses.has(requestedStatus)) {
        return NextResponse.json({ error: "Invalid booking status" }, { status: 400 });
      }

      stage = "load all booking rows";
      const result = await getBookingTableData(startDate, endDate, {
        page: Number.isFinite(Number(page)) ? Number(page) : 0,
        pageSize: Number.isFinite(Number(pageSize)) ? Number(pageSize) : 50,
        status: requestedStatus,
        query: typeof query === "string" ? query : undefined,
      });
      const bookings = result.bookings.map((b) => {
        const checkout = stayCheckout(b.checkinDate, b.checkoutDate);
        const nights = checkout ? diffDays(b.checkinDate, checkout) : 0;
        return { ...b, nights, balance: (b.amountTotal ?? 0) - (b.amountPaid ?? 0) };
      });
      return NextResponse.json({ ...result, bookings, role, permissions });
    }

    if (action === "getWhatsAppTemplates") {
      const templates = parseBookingWhatsAppTemplates(await getSetting(BOOKING_WHATSAPP_SETTING));
      return NextResponse.json({ templates });
    }

    if (action === "saveWhatsAppTemplates") {
      if (role !== "admin" && role !== "manager" && !permissions.canManageBookingTemplates) {
        return NextResponse.json({ error: "Admin or manager access required" }, { status: 403 });
      }
      const templates = validateBookingWhatsAppTemplates(body.templates);
      if (!templates) return NextResponse.json({ error: "Invalid templates (maximum 10)" }, { status: 400 });
      await setSetting(BOOKING_WHATSAPP_SETTING, JSON.stringify(templates));
      return NextResponse.json({ success: true, templates });
    }

    if (action === "getCalendarData") {
      const { startDate, endDate } = body;
      if (!startDate || !endDate) return NextResponse.json({ error: "startDate and endDate required" }, { status: 400 });

      stage = "load calendar bookings";
      const calendarData = await getBookingCalendarData(startDate, endDate);
      stage = "load dorms";
      const allDorms = await getAllDorms();
      stage = "load beds";
      const allBeds = await getAllBeds();
      stage = "calculate nightly availability";
      const availability = await getCalendarAvailability(startDate, endDate);
      const units = sellableUnits(allBeds);
      const unitByBed = new Map(units.flatMap((u) => u.beds.map((b) => [b.id, u] as const)));

      const dormsWithBeds = allDorms.map((d) => ({
        id: d.id,
        name: d.name,
        availability: availability.dorms[d.id] ?? {},
        beds: units
          .filter((u) => u.dormId === d.id)
          .map((u) => ({ id: u.beds[0].id, bedId: u.label, dormId: u.dormId, dormName: u.beds[0].dormName, availability: availability.beds[u.beds[0].id] ?? {}, type: u.type, capacity: u.capacity, physicalBedIds: u.beds.map((b) => b.id) })),
      }));

      const enrichedBookings = calendarData.bookings.map((b) => {
        const checkout = stayCheckout(b.checkinDate, b.checkoutDate);
        const nights = checkout ? diffDays(b.checkinDate, checkout) : 0;
        // Ledger, not the detail card. Prepaid check-in copies amountPaid; until then this is the OTA total.
        const balance = (b.amountTotal ?? 0) - (b.amountPaid ?? 0);
        return { ...b, nights, balance };
      });

      const bedById = new Map(allBeds.map((b) => [b.id, b]));
      const seenCalendarUnits = new Set<string>();
      const enrichedAssignments = calendarData.assignments.flatMap((a) => {
        const bed = bedById.get(a.bedId);
        const unit = unitByBed.get(a.bedId);
        const key = `${a.bookingId}:${unit?.key || a.bedId}`;
        if (seenCalendarUnits.has(key)) return [];
        seenCalendarUnits.add(key);
        return [{
          ...a,
          bedId: unit?.beds[0].id || a.bedId,
          dormName: bed?.dormName || "",
          bedLabel: unit?.label || bed?.bedId || "",
        }];
      });

      return NextResponse.json({
        bookings: enrichedBookings,
        assignments: enrichedAssignments,
        dorms: dormsWithBeds,
        role,
        permissions,
      });
    }

    if (action === "getDetail") {
      const { bookingId } = body;
      if (!bookingId) return NextResponse.json({ error: "bookingId required" }, { status: 400 });
      const detail = await getBookingDetail(bookingId);
      if (!detail) return NextResponse.json({ error: "Booking not found" }, { status: 404 });
      const allBeds = await getAllBeds();
      const bedById = new Map(allBeds.map((b) => [b.id, b]));
      const unitByBed = new Map(sellableUnits(allBeds).flatMap((u) => u.beds.map((b) => [b.id, u] as const)));
      const seenAssignmentUnits = new Set<string>();
      const checkout = stayCheckout(detail.booking.checkinDate, detail.booking.checkoutDate);
      const nights = checkout ? diffDays(detail.booking.checkinDate, checkout) : 0;
      return NextResponse.json({
        ...detail,
        booking: {
          ...detail.booking,
          nights,
          balance: (detail.booking.amountTotal ?? 0) - (detail.booking.amountPaid ?? 0),
        },
        assignments: detail.assignments.filter((assignment) => assignment.status === "assigned").flatMap((assignment) => {
          const bed = bedById.get(assignment.bedId);
          const unit = unitByBed.get(assignment.bedId);
          const key = `${assignment.status}:${assignment.checkinDate}:${assignment.checkoutDate}:${unit?.key || assignment.bedId}`;
          if (seenAssignmentUnits.has(key)) return [];
          seenAssignmentUnits.add(key);
          return [{
            ...assignment,
            dormName: bed?.dormName || "",
            bedLabel: unit?.label || bed?.bedId || "",
          }];
        }),
      });
    }

    if (action === "getPendingFoodTab") {
      const { bookingId, checkinId, contact: rawContact } = body;
      let contact = typeof rawContact === "string" ? rawContact : "";
      if (bookingId) {
        const detail = await getBookingDetail(bookingId);
        if (!detail) return NextResponse.json({ error: "Booking not found" }, { status: 404 });
        contact = detail.booking.contact || contact;
      }
      const tab = await getPendingFoodTab({
        checkinId: typeof checkinId === "number" ? checkinId : parseInt(checkinId, 10) || undefined,
        contact,
      });
      return NextResponse.json(tab);
    }

    if (action === "search") {
      const { query } = body;
      if (!query || query.length < 4) return NextResponse.json({ error: "Query must be at least 4 characters" }, { status: 400 });
      const results = await searchBookings(query);
      return NextResponse.json({ bookings: results });
    }

    if (action === "getUnassigned") {
      const results = await getUnassignedBookings();
      const mappings = await getRoomTypeMappings();
      const units = sellableUnits((await getAllBeds()) || []);
      const doubleDormIds = new Set(units.filter((unit) => unit.type === "Double").map((unit) => unit.dormId));
      return NextResponse.json({
        bookings: results.map((b) => enrichUnassignedBooking(b, mappings, doubleDormIds)),
      });
    }

    if (action === "checkAvailability") {
      const { checkinDate, checkoutDate, dormId } = body;
      if (!checkinDate || !checkoutDate) return NextResponse.json({ error: "checkinDate and checkoutDate required" }, { status: 400 });
      const available = await getAvailableBedsForRange(checkinDate, checkoutDate, dormId);
      const allDorms = await getAllDorms();
      const result = allDorms.map((d) => ({
        id: d.id,
        name: d.name,
        beds: available.filter((b) => b.dormId === d.id).map((b) => ({
          id: b.id,
          bedId: b.bedId,
          dormId: b.dormId,
          pool: b.pool,
        })),
      }));
      return NextResponse.json({ dorms: result });
    }

    if (action === "getAvailableBeds") {
      const { checkinDate, checkoutDate, bookingId } = body;
      if (!checkinDate || !checkoutDate) return NextResponse.json({ error: "checkinDate and checkoutDate required" }, { status: 400 });
      const available = await getAvailableBedsForRange(checkinDate, checkoutDate, undefined, bookingId);
      const beds = available.map((b) => ({ id: b.id, bedId: b.bedId, dormId: b.dormId, dormName: b.dormName, type: b.type, pool: b.pool }));
      const availableIds = new Set(available.map((b) => b.id));
      const allInventoryBeds = (await getAllBeds()) || [];
      const units = sellableUnits(allInventoryBeds.length > 0 ? allInventoryBeds : available)
        .filter((u) => u.beds.every((b) => availableIds.has(b.id)))
        .map((u) => ({ key: u.key, label: u.label, dormId: u.dormId, dormName: u.beds[0]?.dormName || "", type: u.type, capacity: u.capacity, bedIds: u.beds.map((b) => b.id), pool: available.find((b) => b.id === u.beds[0]?.id)?.pool || "online" }));
      const slots = available.map((b) => ({ key: `slot:${b.id}`, label: b.bedId, dormId: b.dormId, dormName: b.dormName, type: "Bed" as const, capacity: 1, bedIds: [b.id], pool: b.pool || "online" }));
      const dormRates: Record<number, number> = {};
      const mappings = await getRoomTypeMappings();
      const ratePlans = await getRatePlanMappings();
      const dayRates = await getAllDailyRates(checkinDate, checkinDate);
      const ratesByPlan = new Map<number, (typeof dayRates)[number]>();
      for (const row of dayRates) {
        if (!ratesByPlan.has(row.ratePlanId)) ratesByPlan.set(row.ratePlanId, row);
      }
      for (const mapping of mappings) {
        const plans = ratePlans.filter((rp) => rp.roomMappingId === mapping.id && rp.isActive);
        if (plans.length === 0) continue;
        const rate = ratesByPlan.get(plans[0].id);
        if (rate) {
          dormRates[mapping.dormId] = rate.adult1Rate ?? rate.rate;
        }
      }
      const taxRate = await loadBookingTaxPercent();
      return NextResponse.json({ beds, units, slots, dormRates, taxRate });
    }

    if (action === "getBookingHistory") {
      const { bookingId } = body;
      if (!bookingId) return NextResponse.json({ error: "bookingId required" }, { status: 400 });
      const history = await getBookingHistoryEntries(bookingId);
      return NextResponse.json({ history });
    }

    if (action === "getBookingAuditLog") {
      const history = await getBookingAuditEntries();
      const entries = history.map((entry) => {
        const reference = entry.gokoBookingId || entry.bookingRef || `Booking #${entry.bookingId}`;
        const target = `${reference} · ${entry.guestName || "Unknown guest"}`;
        const stay = entry.checkinDate
          ? `Stay ${entry.checkinDate}${entry.checkoutDate ? ` → ${entry.checkoutDate}` : ""}`
          : "";
        const context = [entry.platform, stay].filter(Boolean).join(" · ");
        return {
          id: entry.id,
          timestamp: entry.performedAt,
          username: entry.performedBy || "system",
          action: entry.action,
          target,
          details: [entry.details, context].filter(Boolean).join(" · "),
        };
      });
      return NextResponse.json({ entries });
    }

    // --- Create ---

    if (action === "createBooking") {
      const { guestName, contact, email, checkinDate, checkoutDate, platform, nightlyRate, specialRequests, bedIds, persons, unitRates, discountPercent, discountAmount, discountReason, advanceAmount, advancePaymentMethod, advanceOnlineAccountId } = body;
      if (!guestName || !checkinDate || !checkoutDate) {
        return NextResponse.json({ error: "guestName, checkinDate, checkoutDate required" }, { status: 400 });
      }
      if (checkoutDate <= checkinDate) {
        return NextResponse.json({ error: "checkoutDate must be after checkinDate" }, { status: 400 });
      }

      const nights = diffDays(checkinDate, checkoutDate);
      const selectedIds = Array.isArray(bedIds) ? [...new Set((bedIds as unknown[]).map(Number).filter(Number.isInteger))] : [];
      let allPhysicalBeds = (await getAllBeds()) || [];
      if (allPhysicalBeds.length === 0) {
        allPhysicalBeds = (await Promise.all(selectedIds.map((id) => getBedById(id)))).filter(Boolean) as typeof allPhysicalBeds;
      }
      const selectedIdSet = new Set(selectedIds);
      const selectedUnits = sellableUnits(allPhysicalBeds).filter((u) => u.beds.some((b) => selectedIdSet.has(b.id)));
      const unitsCount = selectedUnits.length || 1;
      const guestCount = Math.max(1, Number(persons) || selectedIds.length || unitsCount);
      const allowPartialDouble = guestCount === 1
        && selectedIds.length === 1
        && selectedUnits.length === 1
        && selectedUnits[0].type === "Double";
      if (!allowPartialDouble && selectedUnits.some((u) => !u.beds.every((b) => selectedIdSet.has(b.id)))) {
        return NextResponse.json({ error: "A double bed must be reserved as one complete room" }, { status: 400 });
      }
      if (!allowPartialDouble && selectedUnits.flatMap((u) => u.beds).length !== selectedIds.length) {
        return NextResponse.json({ error: "Invalid bed selection" }, { status: 400 });
      }
      const explicitUnitPricing = persons != null || (unitRates && typeof unitRates === "object");
      const capacity = selectedUnits.reduce((sum, u) => sum + u.capacity, 0);
      if (selectedUnits.length > 0 && guestCount > capacity) {
        return NextResponse.json({ error: `Selected rooms hold at most ${capacity} guest(s)` }, { status: 400 });
      }
      if (selectedUnits.some((unit) => capacity - unit.capacity >= guestCount)) {
        return NextResponse.json({ error: `Select only the units needed for ${guestCount} guest(s)` }, { status: 400 });
      }
      if (bedIds && Array.isArray(bedIds) && bedIds.length > 0) {
        const selectionError = await validateBedsForRange(selectedIds, checkinDate, checkoutDate, undefined, allowPartialDouble);
        if (selectionError) return NextResponse.json({ error: selectionError }, { status: 400 });
      }
      const src = platform || "walkin";
      const taxPercent = await loadBookingTaxPercent();
      const gross = (nightlyRate || 0) * nights * (explicitUnitPricing ? 1 : unitsCount);
      const discount = src === "walkin"
        ? bookingDiscountRupees(gross, { percent: discountPercent, amount: discountAmount })
        : 0;
      const priced = bookingTotals(gross, { discount, taxPercent });
      const totalBeforeTax = priced.beforeTax;
      const tax = priced.tax;
      const total = totalBeforeTax + tax;
      const reason = typeof discountReason === "string" ? discountReason.trim() : "";
      const hasAdvanceInput = advanceAmount !== undefined || advancePaymentMethod !== undefined || advanceOnlineAccountId !== undefined;
      if (hasAdvanceInput && src !== "walkin") {
        return NextResponse.json({ error: "Advance payment is available for walk-in bookings only" }, { status: 400 });
      }
      const advance = advanceAmount === undefined || advanceAmount === "" ? 0 : Number(advanceAmount);
      if (advanceAmount === null || (typeof advanceAmount === "string" && advanceAmount !== "" && advanceAmount.trim() === "") || !Number.isInteger(advance) || advance < 0 || advance > total) {
        return NextResponse.json({ error: "Advance payment must be a whole amount between ₹0 and the booking total" }, { status: 400 });
      }
      if (advance > 0 && advancePaymentMethod !== "cash" && advancePaymentMethod !== "online") {
        return NextResponse.json({ error: "Advance payment method must be cash or online" }, { status: 400 });
      }
      let advanceAccountId: number | undefined;
      if (advance > 0 && advancePaymentMethod === "online") {
        advanceAccountId = await resolveReceiptAccount("room", advanceOnlineAccountId);
      }

      const newBookingId = await addBooking({
        guestName,
        contact: contact || "",
        email: email || "",
        platform: src,
        checkinDate,
        checkoutDate,
        persons: guestCount,
        nightlyRate: nightlyRate || 0,
        amountBeforeTax: totalBeforeTax,
        amountTax: tax,
        amountTotal: total,
        amountPaid: advance,
        paymentStatus: advance > 0 ? "paid" : undefined,
        paymentMethod: advance > 0 ? advancePaymentMethod : undefined,
        cashReceived: advancePaymentMethod === "cash" ? advance : 0,
        changeGiven: 0,
        specialRequests: specialRequests || "",
        source: "manual",
        status: "received",
        gokoBookingId: generateGokoBookingId(),
        rawData: src === "walkin"
          ? stringifyGokoWalkin({
              discount,
              discountPercent: discount > 0 && Number(discountPercent) > 0 ? Number(discountPercent) : undefined,
              discountAmount: discount > 0 && !(Number(discountPercent) > 0) && Number(discountAmount) > 0 ? Number(discountAmount) : undefined,
              discountReason: discount > 0 ? reason : undefined,
              taxPercent,
              unitPricing: explicitUnitPricing || selectedUnits.some((u) => u.type === "Double"),
              units: selectedUnits.map((u) => ({ key: u.key, dormId: u.dormId, rate: Math.max(0, Number(unitRates?.[u.key]) || 0) })),
            })
          : undefined,
      });

      if (!newBookingId) {
        return NextResponse.json({ error: "Failed to create booking" }, { status: 500 });
      }

      if (bedIds && Array.isArray(bedIds) && bedIds.length > 0) {
        const dates = bookingDateRange(checkinDate, checkoutDate);
        const dormIds: number[] = [];
        for (const bedId of selectedIds) {
          const bed = await getBedById(bedId);
          if (bed) dormIds.push(bed.dormId);
        }
        const before = await otaFingerprint(dormIds, dates);
        const { labels } = await assignTaggedBeds(newBookingId, selectedIds, checkinDate, checkoutDate, actingUser);
        const failed = assignFailed(selectedIds, labels);
        if (failed) {
          await unassignBookingBeds(newBookingId);
          await updateBookingFull(newBookingId, {
            status: "cancelled",
            cancelledAt: new Date().toISOString(),
            cancelledBy: actingUser,
          });
          return NextResponse.json({ error: failed, bookingId: newBookingId }, { status: 409 });
        }
        await pushIfOtaChanged(before, dormIds, dates).catch(() => {});
      }

      if (advance > 0 && advancePaymentMethod === "online" && advanceAccountId) {
        await createGuestReceipt({
          receiptId: crypto.randomUUID(),
          sourceType: "booking",
          sourceId: newBookingId,
          kind: "stay",
          accountId: advanceAccountId,
          amount: advance,
          createdBy: actingUser,
          notes: `Advance stay payment for ${guestName}`,
        });
      }

      if (newBookingId) {
        await addBookingHistoryEntry({
          bookingId: newBookingId,
          action: "Created",
          details: `Manual booking by ${actingUser}. ${unitsCount} unit(s), ${guestCount} guest(s), ${nights} night(s).${discount > 0 ? ` Discount ₹${discount}${reason ? ` (${reason})` : ""}.` : ""}${advance > 0 ? ` Advance ₹${advance} (${advancePaymentMethod}); balance ₹${Math.max(0, total - advance)}.` : ""}`,
          performedBy: actingUser,
        });
        await dispatchPush({
          title: "New Booking",
          body: `${notificationFirstName(guestName)} · ${notificationStayDates(checkinDate, checkoutDate)} · ${guestCount} ${guestCount === 1 ? "guest" : "guests"}`,
          url: "/admin?section=bookings",
          eventId: `booking-created-${newBookingId}`,
          category: "booking",
        });
      }

      return NextResponse.json({ success: true, bookingId: newBookingId });
    }

    // --- Assign Beds ---

    if (action === "assignBeds") {
      const { bookingId, bedIds: rawBedIds } = body;
      const bedIds = Array.isArray(rawBedIds)
        ? rawBedIds.map((id: unknown) => Number(id)).filter((id: number) => Number.isInteger(id) && id > 0)
        : [];
      if (!bookingId || bedIds.length === 0) {
        return NextResponse.json({ error: "bookingId and bedIds[] required" }, { status: 400 });
      }

      const detail = await getBookingDetail(bookingId);
      if (!detail) return NextResponse.json({ error: "Booking not found" }, { status: 404 });
      if (stayClosed(detail.booking.status)) {
        return NextResponse.json({ error: "Cannot assign beds on a closed booking" }, { status: 409 });
      }

      const checkinDate = detail.booking.checkinDate;
      const checkoutDate = stayCheckout(checkinDate, detail.booking.checkoutDate);
      if (!checkoutDate) return NextResponse.json({ error: "Invalid booking dates" }, { status: 400 });
      const mappings = (await getRoomTypeMappings()) || [];
      const enriched = enrichUnassignedBooking(detail.booking, mappings);
      const currentAssigned = (detail.assignments || []).filter((a) => a.status === "assigned").length;
      if (currentAssigned === 0 && enriched.requestedBedCount > 0) {
        const selected = [];
        for (const bedId of bedIds) {
          const bed = await getBedById(bedId);
          if (bed) selected.push(bed);
        }
        const selectedIds = new Set(selected.map((b) => b.id));
        const allAssignmentBeds = (await getAllBeds()) || [];
        const allUnits = sellableUnits(allAssignmentBeds.length > 0 ? allAssignmentBeds : selected);
        const selectedUnits = allUnits.filter((u) => u.beds.some((b) => selectedIds.has(b.id)));
        const doubleDormIds = new Set(selectedUnits.filter((unit) => unit.type === "Double").map((unit) => unit.dormId));
        const allowPartialDouble = detail.booking.persons === 1 && selected.length === 1 && selectedUnits.length === 1 && selectedUnits[0].type === "Double";
        if (!allowPartialDouble && selectedUnits.some((u) => !u.beds.every((b) => selectedIds.has(b.id)))) {
          return NextResponse.json({ error: "Select the complete double room, not one internal slot" }, { status: 400 });
        }
        if (selectedUnits.reduce((sum, u) => sum + u.capacity, 0) < detail.booking.persons) {
          return NextResponse.json({ error: `Selected units do not hold ${detail.booking.persons} guest(s)` }, { status: 400 });
        }
        const selectedCapacity = selectedUnits.reduce((sum, u) => sum + u.capacity, 0);
        if (selectedUnits.some((unit) => selectedCapacity - unit.capacity >= detail.booking.persons)) {
          return NextResponse.json({ error: `Select only the units needed for ${detail.booking.persons} guest(s)` }, { status: 400 });
        }
        const needs = channelBedNeeds({
          roomType: detail.booking.roomType,
          rawData: detail.booking.rawData,
          persons: detail.booking.persons,
        });
        const overflow = enriched.requestedDormIds.length > 0
          && selected.some((bed) => !enriched.requestedDormIds.includes(bed.dormId));
        const unitMismatch = (enriched.requestedNeeds || []).some((need) =>
          selectedUnits.filter((u) => u.dormId === need.dormId).length
            !== (doubleDormIds.has(need.dormId) ? (need.units ?? need.count) : need.count),
        );
        if (!overflow && channelNeedsAreMapped(needs, mappings) && unitMismatch) {
          return NextResponse.json(
            { error: `Assign the reserved room type: ${enriched.requestedNeedLabels}` },
            { status: 400 },
          );
        }
      } else if (currentAssigned > 0 && currentAssigned + bedIds.length > enriched.requestedBedCount) {
        return NextResponse.json({ error: `Booking already has ${currentAssigned} of ${enriched.requestedBedCount} beds; assign one per person` }, { status: 400 });
      }
      const allowPartialDouble = detail.booking.persons === 1 && bedIds.length === 1;
      const selectionError = await validateBedsForRange(bedIds, checkinDate, checkoutDate, bookingId, allowPartialDouble);
      if (selectionError) return NextResponse.json({ error: selectionError }, { status: 400 });

      const fromChannel = channelSource(detail.booking.source);
      const dates = bookingDateRange(checkinDate, checkoutDate);
      const dormIds: number[] = [];
      for (const bedId of bedIds) {
        const bed = await getBedById(bedId);
        if (bed) dormIds.push(bed.dormId);
      }
      const before = fromChannel ? "" : await otaFingerprint(dormIds, dates);
      const { labels } = await assignTaggedBeds(
        bookingId, bedIds, checkinDate, checkoutDate, actingUser,
      );

      const failed = assignFailed(bedIds, labels);
      if (failed) {
        return NextResponse.json({ error: failed, assigned: labels }, { status: 409 });
      }

      await addBookingHistoryEntry({
        bookingId,
        action: "Beds Assigned",
        details: `Assigned: ${labels.join(", ")}`,
        performedBy: actingUser,
      });

      await pushIfGokoOccupancy(detail.booking.source, before, dormIds, dates);
      return NextResponse.json({ success: true, assigned: labels });
    }

    // --- Check In ---

    if (action === "checkIn") {
      const { bookingId, collectPayment } = body;
      if (!bookingId) return NextResponse.json({ error: "bookingId required" }, { status: 400 });

      const detail = await getBookingDetail(bookingId);
      if (!detail) return NextResponse.json({ error: "Booking not found" }, { status: 404 });
      if (stayClosed(detail.booking.status)) {
        return NextResponse.json({ error: "Roll back checkout before checking in" }, { status: 409 });
      }

      const now = new Date().toISOString();
      const updateData: Record<string, any> = {
        status: "checked_in",
        checkedInAt: now,
        checkedInBy: actingUser,
      };

      // Desk collect when due. Prepaid is never due; check-in records it as online stay revenue below.
      const dueAtCheckIn = stayDueAtHotel(detail.booking.paymentStatus, detail.booking.amountTotal, detail.booking.amountPaid);
      let collectedAtCheckIn = false;
      let collectedMethod = "";
      let prepaidRecorded = 0;
      let receiptData: { receiptId: string; kind: "stay" | "ota_prepaid"; accountId: number; amount: number; notes: string } | null = null;
      if (collectPayment && dueAtCheckIn > 0) {
        const { paymentMethod, cashReceived, changeGiven, onlineAccountId, receiptId } = body;
        if (!isStayPayMethod(paymentMethod)) {
          return NextResponse.json({ error: "paymentMethod required (cash, online, or split)" }, { status: 400 });
        }
        const merged = mergeStayCollect({
          existingMethod: detail.booking.paymentMethod,
          existingCashReceived: detail.booking.cashReceived,
          existingPaid: detail.booking.amountPaid,
          existingChangeGiven: detail.booking.changeGiven,
          amountTotal: detail.booking.amountTotal ?? 0,
          newMethod: paymentMethod,
          newCashReceived: Number(cashReceived) || 0,
          newChangeGiven: Number(changeGiven) || 0,
        });
        Object.assign(updateData, merged);
        const onlineAmount = paymentMethod === "online" ? dueAtCheckIn : paymentMethod === "split" ? Math.max(0, dueAtCheckIn - (Number(cashReceived) || 0)) : 0;
        if (onlineAmount > 0) {
          const accountId = await resolveReceiptAccount("room", onlineAccountId);
          receiptData = { receiptId: receiptId || crypto.randomUUID(), kind: "stay", accountId, amount: onlineAmount, notes: `Stay payment for ${detail.booking.guestName}` };
        }
        collectedAtCheckIn = true;
        collectedMethod = merged.paymentMethod;
      } else {
        const prepaid = prepaidCheckInWrite(
          detail.booking.paymentStatus,
          detail.booking.amountTotal,
          detail.booking.amountPaid,
        );
        if (prepaid) {
          Object.assign(updateData, prepaid);
          prepaidRecorded = prepaid.amountPaid;
          const accountId = await resolveReceiptAccount("room", body.onlineAccountId);
          receiptData = { receiptId: body.receiptId || `ota-prepaid-${bookingId}`, kind: "ota_prepaid", accountId, amount: prepaid.amountPaid, notes: `OTA prepaid stay for ${detail.booking.guestName}` };
        }
      }

      await updateBookingFull(bookingId, updateData);
      if (receiptData) await createGuestReceipt({ ...receiptData, sourceType: "booking", sourceId: bookingId, createdBy: actingUser });
      await addBookingHistoryEntry({
        bookingId,
        action: "Checked In",
        details: collectedAtCheckIn
          ? `Payment collected at check-in (${collectedMethod}) by ${actingUser}`
          : prepaidRecorded > 0
            ? `Checked in — OTA prepaid ₹${prepaidRecorded} recorded as stay revenue by ${actingUser}`
            : `Checked in by ${actingUser}`,
        performedBy: actingUser,
      });
      await dispatchPush({
        title: "Guest Checked In",
        body: `${notificationFirstName(detail.booking.guestName)} · Booking ${detail.booking.gokoBookingId || detail.booking.bookingRef || `#${bookingId}`}`,
        url: "/admin?section=bookings",
        eventId: `booking-checkin-${bookingId}-${now}`,
        category: "checkin",
      });

      return NextResponse.json({ success: true });
    }

    // --- Collect stay payment (after Later, or remaining due) ---

    if (action === "collectStayPayment") {
      const { bookingId, paymentMethod, cashReceived, changeGiven, onlineAccountId, receiptId } = body;
      if (!bookingId) return NextResponse.json({ error: "bookingId required" }, { status: 400 });
      if (!isStayPayMethod(paymentMethod)) {
        return NextResponse.json({ error: "paymentMethod required (cash, online, or split)" }, { status: 400 });
      }

      const detail = await getBookingDetail(bookingId);
      if (!detail) return NextResponse.json({ error: "Booking not found" }, { status: 404 });
      const st = detail.booking.status;
      if (st !== "checked_in" && st !== "checked_out") {
        return NextResponse.json({ error: "Collect is only for checked-in or checked-out stays" }, { status: 409 });
      }
      const due = stayDueAtHotel(detail.booking.paymentStatus, detail.booking.amountTotal, detail.booking.amountPaid);
      if (due <= 0) {
        return NextResponse.json({ error: "Nothing due" }, { status: 400 });
      }

      const merged = mergeStayCollect({
        existingMethod: detail.booking.paymentMethod,
        existingCashReceived: detail.booking.cashReceived,
        existingPaid: detail.booking.amountPaid,
        existingChangeGiven: detail.booking.changeGiven,
        amountTotal: detail.booking.amountTotal ?? 0,
        newMethod: paymentMethod,
        newCashReceived: Number(cashReceived) || 0,
        newChangeGiven: Number(changeGiven) || 0,
      });
      const onlineAmount = paymentMethod === "online" ? due : paymentMethod === "split" ? Math.max(0, due - (Number(cashReceived) || 0)) : 0;
      let receiptData: { receiptId: string; accountId: number; amount: number } | null = null;
      if (onlineAmount > 0) {
        const accountId = await resolveReceiptAccount("room", onlineAccountId);
        receiptData = { receiptId: receiptId || crypto.randomUUID(), accountId, amount: onlineAmount };
      }
      await updateBookingFull(bookingId, merged);
      if (receiptData) await createGuestReceipt({ ...receiptData, sourceType: "booking", sourceId: bookingId, kind: "stay", createdBy: actingUser, notes: `Stay payment for ${detail.booking.guestName}` });
      await addBookingHistoryEntry({
        bookingId,
        action: "Payment Collected",
        details: `Stay payment collected (${merged.paymentMethod}) by ${actingUser}`,
        performedBy: actingUser,
      });
      return NextResponse.json({ success: true });
    }

    // --- Check Out ---

    if (action === "checkOut") {
      const { bookingId } = body;
      if (!bookingId) return NextResponse.json({ error: "bookingId required" }, { status: 400 });

      const detail = await getBookingDetail(bookingId);
      if (!detail) return NextResponse.json({ error: "Booking not found" }, { status: 404 });
      if (stayClosed(detail.booking.status)) {
        return NextResponse.json({ error: "Booking is already closed" }, { status: 409 });
      }

      const now = new Date().toISOString();
      const today = todayIST();
      const oldCheckout = stayCheckout(detail.booking.checkinDate, detail.booking.checkoutDate);
      const dates = oldCheckout ? bookingDateRange(detail.booking.checkinDate, oldCheckout) : [];
      const dormIds = [...activeAssignmentDormIds(detail.assignments)];
      const before = dormIds.length && dates.length ? await otaFingerprint(dormIds, dates) : "";

      const updates: Record<string, string> = {
        status: "checked_out",
        checkedOutAt: now,
        checkedOutBy: actingUser,
      };
      if (oldCheckout && today < oldCheckout) {
        const cut = today <= detail.booking.checkinDate ? detail.booking.checkinDate : today;
        await shortenAssignedCheckout(bookingId, cut);
      }
      await updateBookingFull(bookingId, updates);
      await addBookingHistoryEntry({
        bookingId,
        action: "Checked Out",
        details: `Checked out by ${actingUser}`,
        performedBy: actingUser,
      });
      await pushIfGokoOccupancy(detail.booking.source, before, dormIds, dates);

      return NextResponse.json({ success: true });
    }

    // --- Rollback Check In (admin only) ---

    if (action === "rollbackCheckIn") {
      const { bookingId } = body;
      if (!bookingId) return NextResponse.json({ error: "bookingId required" }, { status: 400 });

      const detail = await getBookingDetail(bookingId);
      const updateData: Record<string, any> = {
        status: "received",
        checkedInAt: "",
        checkedInBy: "",
      };
      const reversePrepaid = prepaidCheckInRollback(detail?.booking);
      if (reversePrepaid) Object.assign(updateData, reversePrepaid);
      await updateBookingFull(bookingId, updateData);
      if (reversePrepaid && detail?.booking) {
        const accountId = await latestReceiptAccount("booking", bookingId);
        if (accountId) await createGuestReceipt({
          receiptId: `ota-prepaid-rollback-${bookingId}-${detail.booking.checkedInAt || "original"}`,
          sourceType: "booking", sourceId: bookingId, kind: "reversal", accountId,
          amount: -reversePrepaid.amountPaid, createdBy: actingUser,
          notes: `Rolled back OTA prepaid stay for ${detail.booking.guestName}`,
        });
      }
      await addBookingHistoryEntry({
        bookingId,
        action: "Check-in Rolled Back",
        details: `Rolled back by ${actingUser}`,
        performedBy: actingUser,
      });

      return NextResponse.json({ success: true });
    }

    // --- Rollback Check Out (admin only) ---

    if (action === "rollbackCheckOut") {
      const { bookingId } = body;
      if (!bookingId) return NextResponse.json({ error: "bookingId required" }, { status: 400 });

      const detail = await getBookingDetail(bookingId);
      if (!detail) return NextResponse.json({ error: "Booking not found" }, { status: 404 });
      const restoreCheckout = stayCheckout(detail.booking.checkinDate, detail.booking.checkoutDate);
      const assigned = detail.assignments.filter((a) => a.status === "assigned");
      const dates = restoreCheckout ? bookingDateRange(detail.booking.checkinDate, restoreCheckout) : [];
      const dormIds = [...activeAssignmentDormIds(assigned)];
      const before = dormIds.length && dates.length ? await otaFingerprint(dormIds, dates) : "";

      if (restoreCheckout && assigned.length > 0) {
        for (const a of assigned) {
          const from = a.checkoutDate || detail.booking.checkinDate;
          if (from >= restoreCheckout) continue;
          if (!(await checkBedAvailability(a.bedId, from, restoreCheckout, bookingId))) {
            return NextResponse.json({ error: "Beds no longer available for remaining nights" }, { status: 409 });
          }
        }
        await shortenAssignedCheckout(bookingId, restoreCheckout);
      }

      await updateBookingFull(bookingId, {
        status: "checked_in",
        checkedOutAt: "",
        checkedOutBy: "",
      });
      await addBookingHistoryEntry({
        bookingId,
        action: "Check-out Rolled Back",
        details: `Rolled back by ${actingUser}`,
        performedBy: actingUser,
      });
      await pushIfGokoOccupancy(detail.booking.source, before, dormIds, dates);

      return NextResponse.json({ success: true });
    }

    // --- Hold ---

    if (action === "hold") {
      const { bookingId, holdExpiresAt } = body;
      if (!bookingId) return NextResponse.json({ error: "bookingId required" }, { status: 400 });

      await updateBookingFull(bookingId, {
        status: "hold",
        holdExpiresAt: holdExpiresAt || "",
      });
      await addBookingHistoryEntry({
        bookingId,
        action: "Put on Hold",
        details: holdExpiresAt ? `Hold expires at ${holdExpiresAt}` : "Indefinite hold",
        performedBy: actingUser,
      });

      return NextResponse.json({ success: true });
    }

    // --- Cancel Booking ---

    if (action === "cancelBooking") {
      const { bookingId, assignmentIds, refundAmount, refundMethod, refundCash, onlineAccountId, receiptId } = body;
      if (!bookingId) return NextResponse.json({ error: "bookingId required" }, { status: 400 });

      const detail = await getBookingDetail(bookingId);
      const fullCancel = !(Array.isArray(assignmentIds) && assignmentIds.length > 0);
      const assigned = (detail?.assignments ?? []).filter((a) => a.status === "assigned");
      const lead = role === "admin" || role === "manager";
      if (fullCancel && assigned.length === 0) {
        if (!lead) {
          return NextResponse.json({ error: "Admin or manager access required" }, { status: 403 });
        }
      } else if (role !== "admin" && !permissions.canDeleteBooking) {
        return NextResponse.json({ error: "You don't have permission to perform this action" }, { status: 403 });
      }
      const now = new Date().toISOString();
      const cancelDates = detail ? bookingDateRange(detail.booking.checkinDate, detail.booking.checkoutDate) : [];
      const selectedAssignmentIds = assignmentIds && Array.isArray(assignmentIds) && assignmentIds.length > 0 ? assignmentIds : undefined;
      const dormIds = await affectedDormIds(detail, selectedAssignmentIds);
      const before = await otaFingerprint(dormIds, cancelDates);

      if (assignmentIds && Array.isArray(assignmentIds) && assignmentIds.length > 0) {
        const ownIds = (detail?.assignments ?? [])
          .filter((a) => assignmentIds.includes(a.id))
          .map((a) => a.id);
        if (ownIds.length === 0) {
          return NextResponse.json({ error: "No matching bed assignments on this booking" }, { status: 400 });
        }
        if (!(await cancelBedAssignments(ownIds, bookingId))) {
          return NextResponse.json({ error: "These bed assignments were already cancelled" }, { status: 409 });
        }
        await addBookingHistoryEntry({
          bookingId,
          action: "Partial Cancellation",
          details: `Cancelled ${ownIds.length} bed assignment(s) by ${actingUser}`,
          performedBy: actingUser,
        });
      } else {
        const cancelUpdate: Record<string, any> = {
          status: "cancelled",
          cancelledAt: now,
          cancelledBy: actingUser,
        };
        let refundNote = "";
        if (detail?.booking.status === "checked_in") {
          const cap = stayRefundCap(detail.booking.amountPaid);
          const refundAmt = Math.max(0, Math.min(Number(refundAmount) || 0, cap));
          if (refundAmt > 0) {
            if (!isStayPayMethod(refundMethod)) {
              return NextResponse.json({ error: "refundMethod required (cash, online, or split)" }, { status: 400 });
            }
            const written = stayRefundWrite(refundMethod, refundAmt, Number(refundCash) || 0);
            cancelUpdate.amountRefunded = refundAmt;
            cancelUpdate.refundMethod = written.refundMethod;
            cancelUpdate.refundCash = written.refundCash;
            cancelUpdate.refundedAt = now;
            cancelUpdate.refundedBy = actingUser;
            refundNote = `, refund ₹${refundAmt} ${written.refundMethod}`;
            const onlineRefund = written.refundMethod === "online" ? refundAmt : written.refundMethod === "split" ? Math.max(0, refundAmt - written.refundCash) : 0;
            if (onlineRefund > 0) {
              const previousAccount = await latestReceiptAccount("booking", bookingId);
              const accountId = await resolveReceiptAccount("room", onlineAccountId ?? previousAccount);
              await createGuestReceipt({ receiptId: receiptId || crypto.randomUUID(), sourceType: "booking", sourceId: bookingId, kind: "refund", accountId, amount: -onlineRefund, createdBy: actingUser, notes: `Stay refund for ${detail.booking.guestName}` });
            }
          }
        }
        const cancelled = await transitionBookingStatus(bookingId, ["received", "hold", "checked_in"], cancelUpdate);
        if (!cancelled) return NextResponse.json({ error: "Booking was already closed or changed by another user" }, { status: 409 });
        await unassignBookingBeds(bookingId);
        await addBookingHistoryEntry({
          bookingId,
          action: "Cancelled",
          details: `Full cancellation by ${actingUser}${refundNote}`,
          performedBy: actingUser,
        });
      }

      const inventory = await pushIfOtaChanged(before, dormIds, cancelDates).catch((error) => ({ attempted: true, accepted: false, message: error?.message || "Aiosell inventory push failed" }));
      if (inventoryWarning(inventory)) await dispatchPush({
        title: "Inventory Sync Failed",
        body: "Cancellation saved, but channel availability needs attention",
        url: "/admin?section=management",
        eventId: `inventory-cancel-${bookingId}`,
        tag: "inventory-sync-failure",
        category: "operations",
      });
      if (detail) await dispatchPush({
        title: fullCancel ? "Booking Cancelled" : "Booking Partially Cancelled",
        body: `${notificationFirstName(detail.booking.guestName)} · ${notificationStayDates(detail.booking.checkinDate, detail.booking.checkoutDate)}`,
        url: "/admin?section=bookings",
        eventId: `booking-cancel-${bookingId}-${fullCancel ? "full" : selectedAssignmentIds?.join("-")}`,
        category: "booking",
      });
      return NextResponse.json({ success: true, warning: inventoryWarning(inventory) });
    }

    // --- No Show ---

    if (action === "retryNoShow") {
      const { bookingId } = body;
      if (!bookingId) return NextResponse.json({ error: "bookingId required" }, { status: 400 });
      const detail = await getBookingDetail(bookingId);
      if (!detail || detail.booking.status !== "no_show" || detail.booking.noShowPmsStatus !== "failed" || !isBookingDotCom(detail.booking.platform) || !detail.booking.cmBookingId) {
        return NextResponse.json({ error: "No failed Booking.com no-show update to retry" }, { status: 409 });
      }
      const warning = await syncBookingNoShow(bookingId, detail.booking);
      return NextResponse.json({ success: true, message: warning ? "No-show remains pending" : "Aiosell no-show updated", warning });
    }

    if (action === "markNoShow") {
      const { bookingId } = body;
      if (!bookingId) return NextResponse.json({ error: "bookingId required" }, { status: 400 });

      const detail = await getBookingDetail(bookingId);
      if (!detail) return NextResponse.json({ error: "Booking not found" }, { status: 404 });
      if ((detail.booking.status || "received") !== "received") return NextResponse.json({ error: "Only received bookings can be marked no-show" }, { status: 409 });
      if (detail.booking.checkinDate > todayIST()) return NextResponse.json({ error: "A booking can be marked no-show on its check-in date or later" }, { status: 409 });

      const dates = bookingDateRange(detail.booking.checkinDate, detail.booking.checkoutDate);
      const dormIds = await affectedDormIds(detail);
      const before = await otaFingerprint(dormIds, dates);

      const claimed = await transitionBookingStatus(bookingId, ["received"], { status: "no_show" });
      if (!claimed) return NextResponse.json({ error: "Booking was already changed by another user" }, { status: 409 });
      await unassignBookingBeds(bookingId);
      const noShowWarning = await syncBookingNoShow(bookingId, detail.booking);

      await addBookingHistoryEntry({
        bookingId,
        action: "Marked No-Show",
        details: `Marked as no-show by ${actingUser}`,
        performedBy: actingUser,
      });
      await dispatchPush({
        title: "Booking Marked No-show",
        body: `${notificationFirstName(detail.booking.guestName)} · Check-in ${notificationDate(detail.booking.checkinDate)}`,
        url: "/admin?section=bookings",
        eventId: `booking-no-show-${bookingId}`,
        category: "operations",
      });

      const inventory = await pushIfOtaChanged(before, dormIds, dates).catch((error) => ({ attempted: true, accepted: false, message: error?.message || "Aiosell inventory push failed" }));
      if (inventoryWarning(inventory)) await dispatchPush({
        title: "Inventory Sync Failed",
        body: "No-show saved, but channel availability needs attention",
        url: "/admin?section=management",
        eventId: `inventory-no-show-${bookingId}`,
        tag: "inventory-sync-failure",
        category: "operations",
      });
      const warning = [noShowWarning, inventoryWarning(inventory)].filter(Boolean).join(". ");
      return NextResponse.json({ success: true, message: "Marked no-show", warning: warning || undefined });
    }

    // --- Unassign ---

    if (action === "unassign") {
      const { bookingId } = body;
      if (!bookingId) return NextResponse.json({ error: "bookingId required" }, { status: 400 });

      const detail = await getBookingDetail(bookingId);
      const dates = detail ? bookingDateRange(detail.booking.checkinDate, detail.booking.checkoutDate) : [];
      const dormIds = activeAssignmentDormIds(detail?.assignments);
      const before = await otaFingerprint(dormIds, dates);
      await unassignBookingBeds(bookingId);
      await addBookingHistoryEntry({
        bookingId,
        action: "Beds Unassigned",
        details: `All beds unassigned by ${actingUser}`,
        performedBy: actingUser,
      });

      await pushIfGokoOccupancy(detail?.booking.source, before, dormIds, dates);
      return NextResponse.json({ success: true });
    }

    // --- Modify Check-in Date ---

    if (action === "modifyCheckin") {
      const { bookingId, newCheckinDate, confirmed, selectedBedIds } = body;
      if (!bookingId || !newCheckinDate) return NextResponse.json({ error: "bookingId and newCheckinDate required" }, { status: 400 });

      const detail = await getBookingDetail(bookingId);
      if (!detail) return NextResponse.json({ error: "Booking not found" }, { status: 404 });
      if (stayClosed(detail.booking.status)) {
        return NextResponse.json({ error: "Roll back checkout before changing dates" }, { status: 409 });
      }

      const oldCheckin = detail.booking.checkinDate;
      const oldCheckout = stayCheckout(oldCheckin, detail.booking.checkoutDate);
      if (!oldCheckout) return NextResponse.json({ error: "Invalid booking dates" }, { status: 400 });
      const currentAssignments = detail.assignments.filter((a) => a.status === "assigned");

      if (confirmed && Array.isArray(selectedBedIds) && selectedBedIds.length > 0) {
        const selectionError = await validateBedsForRange(selectedBedIds, newCheckinDate, oldCheckout, bookingId);
        if (selectionError) return NextResponse.json({ error: selectionError }, { status: 400 });
      }

      if (newCheckinDate === oldCheckin) return NextResponse.json({ error: "New date same as current" }, { status: 400 });

      const isEarlier = newCheckinDate < oldCheckin;
      const dates = [...bookingDateRange(oldCheckin, oldCheckout), ...bookingDateRange(newCheckinDate, oldCheckout)];
      const dormIds = [...activeAssignmentDormIds(currentAssignments)];
      if (selectedBedIds && Array.isArray(selectedBedIds)) {
        for (const bedId of selectedBedIds) {
          const bed = await getBedById(bedId);
          if (bed) dormIds.push(bed.dormId);
        }
      }
      const before = await otaFingerprint(dormIds, dates);

      if (isEarlier) {
        // CI-1: Early check-in — extend assignments backward
        if (currentAssignments.length === 0) {
          // No assignments — just update dates
          if (!confirmed) {
            const available = await getAvailableBedsForRange(newCheckinDate, oldCheckout, undefined, bookingId);
            return NextResponse.json({ needsSelection: true, availableBeds: available, scenario: "CI-1-no-beds" });
          }
          // Confirmed with selected beds
          if (selectedBedIds && selectedBedIds.length > 0) {
            const { labels } = await assignTaggedBeds(bookingId, selectedBedIds, newCheckinDate, oldCheckout, actingUser);
            const failed = assignFailed(selectedBedIds, labels);
            if (failed) return NextResponse.json({ error: failed }, { status: 409 });
          }
        } else {
          // Check if current beds are available for the extended range
          let allAvailable = true;
          for (const a of currentAssignments) {
            const available = await checkBedAvailability(a.bedId, newCheckinDate, a.checkinDate, bookingId);
            if (!available) { allAvailable = false; break; }
          }

          if (!allAvailable && !confirmed) {
            const available = await getAvailableBedsForRange(newCheckinDate, oldCheckout, undefined, bookingId);
            return NextResponse.json({ needsSelection: true, availableBeds: available, scenario: "CI-1-conflict" });
          }

          if (allAvailable) {
            if (!(await reassignSameBeds(bookingId, currentAssignments, newCheckinDate, oldCheckout, actingUser))) {
              return NextResponse.json({ error: "Could not re-assign beds for the new dates" }, { status: 409 });
            }
          } else if (confirmed && selectedBedIds?.length > 0) {
            await unassignBookingBeds(bookingId);
            const { labels } = await assignTaggedBeds(bookingId, selectedBedIds, newCheckinDate, oldCheckout, actingUser);
            const failed = assignFailed(selectedBedIds, labels);
            if (failed) return NextResponse.json({ error: failed }, { status: 409 });
          } else if (confirmed) {
            return NextResponse.json({ error: "Select at least one bed" }, { status: 400 });
          }
        }
      } else {
        // CI-2/3/4: Late check-in — shorten from the start
        if (newCheckinDate >= oldCheckout) {
          return NextResponse.json({ error: "New check-in date must be before check-out date" }, { status: 400 });
        }

        // Simply shorten: cancel old assignments and re-assign with new start date
        if (currentAssignments.length > 0) {
          if (!(await reassignSameBeds(bookingId, currentAssignments, newCheckinDate, oldCheckout, actingUser))) {
            return NextResponse.json({ error: "Could not re-assign beds for the new dates" }, { status: 409 });
          }
        }
      }

      // Update booking dates and recalculate amounts
      const nights = diffDays(newCheckinDate, oldCheckout);
      const nightlyRate = detail.booking.nightlyRate ?? 0;
      const bedsCount = parseGokoWalkin(detail.booking.rawData)?.unitPricing ? 1 : Math.max(1, selectedBedIds?.length || currentAssignments.length);
      const taxPercent = await loadBookingTaxPercent();
      const { totalBeforeTax, tax, discount } = stayAmounts(
        nightlyRate * nights * bedsCount,
        detail.booking.rawData,
        taxPercent,
      );
      const walkinRaw = nextGokoWalkinRaw(
        detail.booking.rawData,
        detail.booking.source,
        discount,
        taxPercent,
      );

      await updateBookingFull(bookingId, {
        checkinDate: newCheckinDate,
        checkoutDate: oldCheckout,
        amountBeforeTax: totalBeforeTax,
        amountTax: tax,
        amountTotal: totalBeforeTax + tax,
        ...(walkinRaw ? { rawData: walkinRaw } : {}),
      });

      await addBookingHistoryEntry({
        bookingId,
        action: "Check-in Modified",
        details: `${oldCheckin} → ${newCheckinDate} by ${actingUser}`,
        performedBy: actingUser,
      });

      await pushIfGokoOccupancy(detail.booking.source, before, dormIds, dates);
      await dispatchPush({
        title: "Booking Dates Changed",
        body: `${notificationFirstName(detail.booking.guestName)} · Check-in ${notificationDate(oldCheckin)} → ${notificationDate(newCheckinDate)}`,
        url: "/admin?section=bookings",
        eventId: `booking-checkin-date-${bookingId}-${newCheckinDate}`,
        category: "booking",
      });
      return NextResponse.json({ success: true });
    }

    // --- Modify Check-out Date ---

    if (action === "modifyCheckout") {
      const { bookingId, newCheckoutDate, confirmed, selectedBedIds } = body;
      if (!bookingId || !newCheckoutDate) return NextResponse.json({ error: "bookingId and newCheckoutDate required" }, { status: 400 });

      const detail = await getBookingDetail(bookingId);
      if (!detail) return NextResponse.json({ error: "Booking not found" }, { status: 404 });
      if (stayClosed(detail.booking.status)) {
        return NextResponse.json({ error: "Roll back checkout before changing dates" }, { status: 409 });
      }

      const oldCheckin = detail.booking.checkinDate;
      const oldCheckout = stayCheckout(oldCheckin, detail.booking.checkoutDate);
      if (!oldCheckout) return NextResponse.json({ error: "Invalid booking dates" }, { status: 400 });
      const currentAssignments = detail.assignments.filter((a) => a.status === "assigned");

      if (confirmed && Array.isArray(selectedBedIds) && selectedBedIds.length > 0) {
        const selectionError = await validateBedsForRange(selectedBedIds, oldCheckin, newCheckoutDate, bookingId);
        if (selectionError) return NextResponse.json({ error: selectionError }, { status: 400 });
      }

      if (newCheckoutDate === oldCheckout) return NextResponse.json({ error: "New date same as current" }, { status: 400 });
      if (newCheckoutDate <= oldCheckin) return NextResponse.json({ error: "Check-out must be after check-in" }, { status: 400 });

      const isExtending = newCheckoutDate > oldCheckout;
      const dates = [...bookingDateRange(oldCheckin, oldCheckout), ...bookingDateRange(oldCheckin, newCheckoutDate)];
      const dormIds = [...activeAssignmentDormIds(currentAssignments)];
      if (selectedBedIds && Array.isArray(selectedBedIds)) {
        for (const bedId of selectedBedIds) {
          const bed = await getBedById(bedId);
          if (bed) dormIds.push(bed.dormId);
        }
      }
      const before = await otaFingerprint(dormIds, dates);

      if (isExtending) {
        // CO-1: Extend stay — check if current beds are available
        if (currentAssignments.length > 0) {
          let allAvailable = true;
          for (const a of currentAssignments) {
            const available = await checkBedAvailability(a.bedId, oldCheckout, newCheckoutDate, bookingId);
            if (!available) { allAvailable = false; break; }
          }

          if (!allAvailable && !confirmed) {
            const available = await getAvailableBedsForRange(oldCheckin, newCheckoutDate, undefined, bookingId);
            return NextResponse.json({ needsSelection: true, availableBeds: available, scenario: "CO-1-conflict" });
          }

          if (allAvailable) {
            const stayStart = currentAssignments[0]?.checkinDate || oldCheckin;
            if (!(await reassignSameBeds(bookingId, currentAssignments, stayStart, newCheckoutDate, actingUser))) {
              return NextResponse.json({ error: "Could not re-assign beds for the new dates" }, { status: 409 });
            }
          } else if (confirmed && selectedBedIds?.length > 0) {
            await unassignBookingBeds(bookingId);
            const { labels } = await assignTaggedBeds(bookingId, selectedBedIds, oldCheckin, newCheckoutDate, actingUser);
            const failed = assignFailed(selectedBedIds, labels);
            if (failed) return NextResponse.json({ error: failed }, { status: 409 });
          } else if (confirmed) {
            return NextResponse.json({ error: "Select at least one bed" }, { status: 400 });
          }
        } else if (!confirmed) {
          const available = await getAvailableBedsForRange(oldCheckin, newCheckoutDate, undefined, bookingId);
          return NextResponse.json({ needsSelection: true, availableBeds: available, scenario: "CO-1-no-beds" });
        } else if (confirmed && selectedBedIds?.length > 0) {
          const { labels } = await assignTaggedBeds(bookingId, selectedBedIds, oldCheckin, newCheckoutDate, actingUser);
          const failed = assignFailed(selectedBedIds, labels);
          if (failed) return NextResponse.json({ error: failed }, { status: 409 });
        } else if (confirmed) {
          return NextResponse.json({ error: "Select at least one bed" }, { status: 400 });
        }
      } else {
        // CO-2/3: Shorten stay — just shorten assignments
        if (currentAssignments.length > 0) {
          const stayStart = currentAssignments[0]?.checkinDate || oldCheckin;
          if (!(await reassignSameBeds(bookingId, currentAssignments, stayStart, newCheckoutDate, actingUser))) {
            return NextResponse.json({ error: "Could not re-assign beds for the new dates" }, { status: 409 });
          }
        }
      }

      // Update booking dates and recalculate
      const nights = diffDays(oldCheckin, newCheckoutDate);
      const nightlyRate = detail.booking.nightlyRate ?? 0;
      const bedsCount = parseGokoWalkin(detail.booking.rawData)?.unitPricing ? 1 : Math.max(1, selectedBedIds?.length || currentAssignments.length);
      const taxPercent = await loadBookingTaxPercent();
      const { totalBeforeTax, tax, discount } = stayAmounts(
        nightlyRate * nights * bedsCount,
        detail.booking.rawData,
        taxPercent,
      );
      const walkinRaw = nextGokoWalkinRaw(
        detail.booking.rawData,
        detail.booking.source,
        discount,
        taxPercent,
      );

      await updateBookingFull(bookingId, {
        checkoutDate: newCheckoutDate,
        amountBeforeTax: totalBeforeTax,
        amountTax: tax,
        amountTotal: totalBeforeTax + tax,
        ...(walkinRaw ? { rawData: walkinRaw } : {}),
      });

      await addBookingHistoryEntry({
        bookingId,
        action: "Check-out Modified",
        details: `${oldCheckout} → ${newCheckoutDate} by ${actingUser}`,
        performedBy: actingUser,
      });

      await pushIfGokoOccupancy(detail.booking.source, before, dormIds, dates);
      await dispatchPush({
        title: "Booking Dates Changed",
        body: `${notificationFirstName(detail.booking.guestName)} · Check-out ${notificationDate(oldCheckout)} → ${notificationDate(newCheckoutDate)}`,
        url: "/admin?section=bookings",
        eventId: `booking-checkout-date-${bookingId}-${newCheckoutDate}`,
        category: "booking",
      });
      return NextResponse.json({ success: true });
    }

    // --- Edit Reservation (prices / add-remove beds) ---

    if (action === "editReservation") {
      const { bookingId, guestName, contact, email, specialRequests, persons, checkinDate: requestedCheckin, checkoutDate: requestedCheckout, nightlyRate, amountBeforeTax, amountTax, amountTotal, amountPaid, paymentAdjustment, paymentMethod, cashReceived, changeGiven, refundMethod, refundCash, onlineAccountId, receiptId, addBedIds, removeBedIds, taxMode } = body;
      if (!bookingId) return NextResponse.json({ error: "bookingId required" }, { status: 400 });

      const detail = await getBookingDetail(bookingId);
      if (!detail) return NextResponse.json({ error: "Booking not found" }, { status: 404 });
      const bedsChanged = (removeBedIds && removeBedIds.length > 0) || (addBedIds && addBedIds.length > 0);
      if (bedsChanged && stayClosed(detail.booking.status)) {
        return NextResponse.json({ error: "Cannot change beds on a closed booking" }, { status: 409 });
      }
      const checkinDate = requestedCheckin ?? detail.booking.checkinDate;
      const checkoutDate = stayCheckout(checkinDate, requestedCheckout ?? detail.booking.checkoutDate);
      if (!checkinDate || !checkoutDate || checkoutDate <= checkinDate) return NextResponse.json({ error: "Check-out must be after check-in" }, { status: 400 });
      const datesChanged = checkinDate !== detail.booking.checkinDate || checkoutDate !== stayCheckout(detail.booking.checkinDate, detail.booking.checkoutDate);
      const nightlyRateChanged = nightlyRate !== undefined && Number(nightlyRate) !== Number(detail.booking.nightlyRate ?? 0);
      if (datesChanged && bedsChanged) return NextResponse.json({ error: "Save date changes and bed changes separately" }, { status: 400 });
      if (persons !== undefined && (!Number.isInteger(Number(persons)) || Number(persons) < 1)) return NextResponse.json({ error: "Persons must be at least 1" }, { status: 400 });
      if (nightlyRate !== undefined && (!Number.isInteger(Number(nightlyRate)) || Number(nightlyRate) < 0)) return NextResponse.json({ error: "Nightly rate must be a non-negative whole number" }, { status: 400 });

      const updates: Record<string, any> = {};
      const changes: string[] = [];

      if (guestName !== undefined) {
        if (typeof guestName !== "string" || !guestName.trim()) return NextResponse.json({ error: "Guest name is required" }, { status: 400 });
        updates.guestName = guestName.trim();
        if (updates.guestName !== detail.booking.guestName) changes.push(`Guest name → ${updates.guestName}`);
      }
      if (contact !== undefined) {
        if (typeof contact !== "string") return NextResponse.json({ error: "Contact must be text" }, { status: 400 });
        updates.contact = contact.trim();
        if (updates.contact !== (detail.booking.contact || "")) changes.push("Contact updated");
      }
      if (email !== undefined) {
        if (typeof email !== "string") return NextResponse.json({ error: "Email must be text" }, { status: 400 });
        updates.email = email.trim();
        if (updates.email !== (detail.booking.email || "")) changes.push("Email updated");
      }
      if (specialRequests !== undefined) {
        if (typeof specialRequests !== "string") return NextResponse.json({ error: "Special requests must be text" }, { status: 400 });
        updates.specialRequests = specialRequests.trim();
        if (updates.specialRequests !== (detail.booking.specialRequests || "")) changes.push("Special requests updated");
      }
      if (persons !== undefined && Number(persons) !== detail.booking.persons) {
        updates.persons = Number(persons);
        changes.push(`Persons → ${updates.persons}`);
      }
      if (datesChanged) {
        const currentAssignments = detail.assignments.filter((a) => a.status === "assigned");
        if (!stayClosed(detail.booking.status) && currentAssignments.length > 0) {
          const selectionError = await validateBedsForRange(currentAssignments.map((a) => a.bedId), checkinDate, checkoutDate, bookingId);
          if (selectionError) return NextResponse.json({ error: selectionError }, { status: 400 });
          if (!(await reassignSameBeds(bookingId, currentAssignments, checkinDate, checkoutDate, actingUser))) {
            return NextResponse.json({ error: "Could not re-assign beds for the new dates" }, { status: 409 });
          }
        }
        updates.checkinDate = checkinDate;
        updates.checkoutDate = checkoutDate;
        changes.push(`Dates → ${checkinDate} to ${checkoutDate}`);
      }

      // Price updates
      if (nightlyRateChanged) {
        updates.nightlyRate = nightlyRate;
        changes.push(`Nightly rate → ${nightlyRate}`);
      }
      if (taxMode === "inclusive" && amountTotal !== undefined) {
        const taxPercent = await loadBookingTaxPercent();
        const total = amountTotal;
        const beforeTax = Math.round(total / (1 + taxPercent / 100));
        const taxAmt = total - beforeTax;
        updates.amountBeforeTax = beforeTax;
        updates.amountTax = taxAmt;
        updates.amountTotal = total;
        changes.push(`Total (incl. tax) → ${total}`);
        const cleared = nextGokoWalkinRaw(detail.booking.rawData, detail.booking.source, 0, taxPercent, true);
        if (cleared) updates.rawData = cleared;
      } else if (taxMode === "exclusive" && amountBeforeTax !== undefined) {
        const taxPercent = await loadBookingTaxPercent();
        const taxAmt = Math.round((amountBeforeTax * taxPercent) / 100);
        updates.amountBeforeTax = amountBeforeTax;
        updates.amountTax = taxAmt;
        updates.amountTotal = amountBeforeTax + taxAmt;
        changes.push(`Amount before tax → ${amountBeforeTax}`);
        const cleared = nextGokoWalkinRaw(detail.booking.rawData, detail.booking.source, 0, taxPercent, true);
        if (cleared) updates.rawData = cleared;
      } else {
        if (amountBeforeTax !== undefined) updates.amountBeforeTax = amountBeforeTax;
        if (amountTax !== undefined) updates.amountTax = amountTax;
        if (amountTotal !== undefined) updates.amountTotal = amountTotal;
        if (amountBeforeTax !== undefined || amountTax !== undefined || amountTotal !== undefined) {
          const taxPercent = await loadBookingTaxPercent();
          const cleared = nextGokoWalkinRaw(detail.booking.rawData, detail.booking.source, 0, taxPercent, true);
          if (cleared) updates.rawData = cleared;
        }
      }
      if (Object.keys(updates).length > 0 && nightlyRateChanged && amountBeforeTax === undefined && amountTotal === undefined) {
        const nights = diffDays(checkinDate, checkoutDate);
        const bedsCount = parseGokoWalkin(detail.booking.rawData)?.unitPricing ? 1 : Math.max(1, detail.assignments.filter((a) => a.status === "assigned").length);
        const taxPercent = await loadBookingTaxPercent();
        const priced = stayAmounts(Number(nightlyRate) * nights * bedsCount, detail.booking.rawData, taxPercent);
        updates.amountBeforeTax = priced.totalBeforeTax;
        updates.amountTax = priced.tax;
        updates.amountTotal = priced.totalBeforeTax + priced.tax;
      }
      let paymentReceipt: { receiptId: string; accountId: number; amount: number; kind: "stay" | "refund" } | null = null;
      if (amountPaid !== undefined) {
        if (detail.booking.source !== "manual") return NextResponse.json({ error: "Collected payment can only be edited for manual bookings" }, { status: 400 });
        const nextPaid = Number(amountPaid);
        const oldPaid = Number(detail.booking.amountPaid || 0);
        const total = Number(updates.amountTotal ?? detail.booking.amountTotal ?? 0);
        if (!Number.isInteger(nextPaid) || nextPaid < 0 || nextPaid > total) {
          return NextResponse.json({ error: "Amount received must be a whole amount between ₹0 and the booking total" }, { status: 400 });
        }
        if (nextPaid === oldPaid) return NextResponse.json({ error: "No payment amount change" }, { status: 400 });
        if (nextPaid > oldPaid) {
          if (paymentAdjustment !== "payment" || !isStayPayMethod(paymentMethod)) {
            return NextResponse.json({ error: "Payment details are required for an increased amount received" }, { status: 400 });
          }
          const merged = mergeStayCollect({
            existingMethod: detail.booking.paymentMethod,
            existingCashReceived: detail.booking.cashReceived,
            existingPaid: oldPaid,
            existingChangeGiven: detail.booking.changeGiven,
            amountTotal: nextPaid,
            newMethod: paymentMethod,
            newCashReceived: Number(cashReceived) || 0,
            newChangeGiven: Number(changeGiven) || 0,
          });
          Object.assign(updates, merged);
          const delta = nextPaid - oldPaid;
          const onlineAmount = paymentMethod === "online" ? delta : paymentMethod === "split" ? Math.max(0, delta - (Number(cashReceived) || 0)) : 0;
          if (onlineAmount > 0) paymentReceipt = { receiptId: receiptId || crypto.randomUUID(), accountId: await resolveReceiptAccount("room", onlineAccountId), amount: onlineAmount, kind: "stay" };
          changes.push(`Amount received → ₹${nextPaid}`);
        } else {
          const difference = oldPaid - nextPaid;
          if (paymentAdjustment !== "correction" && paymentAdjustment !== "refund") {
            return NextResponse.json({ error: "Choose whether to correct the amount or refund the difference" }, { status: 400 });
          }
          if (paymentAdjustment === "refund") {
            if (!isStayPayMethod(refundMethod)) return NextResponse.json({ error: "Refund method required (cash, online, or split)" }, { status: 400 });
            const written = stayRefundWrite(refundMethod, difference, Number(refundCash) || 0);
            updates.amountRefunded = Number(detail.booking.amountRefunded || 0) + difference;
            updates.refundMethod = written.refundMethod;
            updates.refundCash = written.refundCash;
            updates.refundedAt = new Date().toISOString();
            updates.refundedBy = actingUser;
            const onlineAmount = written.refundMethod === "online" ? difference : written.refundMethod === "split" ? Math.max(0, difference - written.refundCash) : 0;
            if (onlineAmount > 0) paymentReceipt = { receiptId: receiptId || crypto.randomUUID(), accountId: await resolveReceiptAccount("room", onlineAccountId), amount: -onlineAmount, kind: "refund" };
            changes.push(`Refunded ₹${difference} (${written.refundMethod}); amount received → ₹${nextPaid}`);
          } else {
            changes.push(`Corrected amount received → ₹${nextPaid}`);
          }
          updates.amountPaid = nextPaid;
          updates.paymentStatus = nextPaid > 0 ? "paid" : "unknown";
          if (nextPaid === 0) {
            updates.paymentMethod = "";
            updates.cashReceived = 0;
            updates.changeGiven = 0;
          } else if (detail.booking.paymentMethod === "cash") {
            updates.cashReceived = nextPaid;
            updates.changeGiven = 0;
          } else if (detail.booking.paymentMethod === "online") {
            updates.cashReceived = 0;
            updates.changeGiven = 0;
          } else {
            updates.cashReceived = Math.min(Number(detail.booking.cashReceived || 0), nextPaid);
            updates.changeGiven = 0;
          }
        }
      }
      const finalAmountPaid = amountPaid !== undefined ? Number(amountPaid) : Number(detail.booking.amountPaid || 0);
      if (Number(updates.amountTotal ?? detail.booking.amountTotal ?? 0) < finalAmountPaid) {
        return NextResponse.json({ error: "Booking total cannot be less than the amount already collected" }, { status: 400 });
      }

      if (Array.isArray(addBedIds) && addBedIds.length > 0) {
        const selectionError = await validateBedsForRange(addBedIds, checkinDate, checkoutDate, bookingId);
        if (selectionError) return NextResponse.json({ error: selectionError }, { status: 400 });
      }
      if (persons !== undefined) {
        const requestedBedIds = new Set(detail.assignments.filter((a) => a.status === "assigned").map((a) => a.bedId));
        for (const bedId of (Array.isArray(removeBedIds) ? removeBedIds : [])) requestedBedIds.delete(Number(bedId));
        for (const bedId of (Array.isArray(addBedIds) ? addBedIds : [])) requestedBedIds.add(Number(bedId));
        const units = sellableUnits((await getAllBeds()) || []);
        const selectedUnits = units.filter((unit) => unit.beds.some((bed) => bed.id != null && requestedBedIds.has(bed.id)));
        const capacity = selectedUnits.reduce((sum, unit) => sum + unit.capacity, 0);
        if (capacity > 0 && Number(persons) > capacity) return NextResponse.json({ error: `Selected rooms hold at most ${capacity} guest(s)` }, { status: 400 });
      }
      const oldDates = bookingDateRange(detail.booking.checkinDate, stayCheckout(detail.booking.checkinDate, detail.booking.checkoutDate));
      const newDates = bookingDateRange(checkinDate, checkoutDate);
      const dates = [...new Set([...oldDates, ...newDates])];
      const dormIds = [...activeAssignmentDormIds(detail.assignments)];
      if (addBedIds && Array.isArray(addBedIds)) {
        for (const bedId of addBedIds) {
          const bed = await getBedById(bedId);
          if (bed) dormIds.push(bed.dormId);
        }
      }
      // Date changes also alter occupancy: release the old nights and publish the new nights.
      // Closed bookings have no active inventory to publish.
      const inventoryChanged = bedsChanged || (datesChanged && !stayClosed(detail.booking.status));
      const before = inventoryChanged ? await otaFingerprint(dormIds, dates) : "";

      // Add beds first so a conflict cannot drop the existing assignment.
      if (addBedIds && Array.isArray(addBedIds) && addBedIds.length > 0) {
        const { labels } = await assignTaggedBeds(bookingId, addBedIds, checkinDate, checkoutDate, actingUser);
        const failed = assignFailed(addBedIds, labels);
        if (failed) {
          return NextResponse.json({ error: failed }, { status: 409 });
        }
        for (const label of labels) changes.push(`Added bed ${label}`);
      }

      if (removeBedIds && Array.isArray(removeBedIds) && removeBedIds.length > 0) {
        const assigned = detail.assignments.filter((a) => a.status === "assigned");
        const requested = new Set(removeBedIds.map(Number));
        const targetBedIds = new Set(assigned
          .filter((a) => requested.has(a.id) || requested.has(a.bedId))
          .map((a) => a.bedId));
        for (const unit of sellableUnits((await getAllBeds()) || [])) {
          if (unit.beds.some((bed) => bed.id != null && targetBedIds.has(bed.id))) {
            for (const bed of unit.beds) if (bed.id != null) targetBedIds.add(bed.id);
          }
        }
        const assignmentIds = assigned.filter((a) => targetBedIds.has(a.bedId)).map((a) => a.id);
        if (assignmentIds.length > 0) await cancelBedAssignments(assignmentIds, bookingId);
        changes.push(`Removed ${assignmentIds.length} physical bed assignment(s)`);
      }

      if (Object.keys(updates).length > 0) {
        await updateBookingFull(bookingId, updates);
      }

      if (paymentReceipt) await createGuestReceipt({
        receiptId: paymentReceipt.receiptId,
        sourceType: "booking",
        sourceId: bookingId,
        kind: paymentReceipt.kind,
        accountId: paymentReceipt.accountId,
        amount: paymentReceipt.amount,
        createdBy: actingUser,
        notes: paymentReceipt.kind === "refund" ? `Booking payment refund for ${detail.booking.guestName}` : `Booking payment adjustment for ${detail.booking.guestName}`,
      });

      if (changes.length > 0) {
        await addBookingHistoryEntry({
          bookingId,
          action: "Reservation Edited",
          details: changes.join("; "),
          performedBy: actingUser,
        });
      }

      if (inventoryChanged) await pushIfGokoOccupancy(detail.booking.source, before, dormIds, dates);
      if (changes.length > 0) await dispatchPush({
        title: "Booking Modified",
        body: `${notificationFirstName(detail.booking.guestName)} · ${changes.join("; ")}`,
        url: "/admin?section=bookings",
        eventId: `booking-edit-${bookingId}-${Date.now()}`,
        category: "booking",
      });
      return NextResponse.json({ success: true });
    }

    // --- Move Room ---

    if (action === "moveRoom") {
      const { bookingId, oldAssignmentId, newBedId } = body;
      if (!bookingId || !newBedId) return NextResponse.json({ error: "bookingId and newBedId required" }, { status: 400 });

      const detail = await getBookingDetail(bookingId);
      if (!detail) return NextResponse.json({ error: "Booking not found" }, { status: 404 });
      if (stayClosed(detail.booking.status)) {
        return NextResponse.json({ error: "Cannot move rooms on a closed booking" }, { status: 409 });
      }

      const checkinDate = detail.booking.checkinDate;
      const checkoutDate = stayCheckout(checkinDate, detail.booking.checkoutDate);
      if (!checkoutDate) return NextResponse.json({ error: "Invalid booking dates" }, { status: 400 });
      const dates = bookingDateRange(checkinDate, checkoutDate);
      const newBed = await getBedById(newBedId);
      if (!newBed) return NextResponse.json({ error: "Bed not found" }, { status: 404 });

      const dormIds = [
        ...activeAssignmentDormIds(detail.assignments),
        newBed.dormId,
      ];
      const before = await otaFingerprint(dormIds, dates);

      if (oldAssignmentId) {
        const own = detail.assignments.find((a) => a.id === oldAssignmentId && a.status === "assigned");
        if (!own) return NextResponse.json({ error: "Assignment not found on this booking" }, { status: 400 });
      }

      const { labels } = await assignTaggedBeds(bookingId, [newBedId], checkinDate, checkoutDate, actingUser);
      const failed = assignFailed([newBedId], labels);
      if (failed) {
        return NextResponse.json({ error: failed === "No beds could be assigned (conflicts exist)" ? "Cannot assign bed — conflict exists" : failed }, { status: 409 });
      }

      if (oldAssignmentId) {
        await cancelBedAssignments([oldAssignmentId], bookingId);
      }

      await addBookingHistoryEntry({
        bookingId,
        action: "Room Moved",
        details: `Moved to ${newBed.dormName}/${newBed.bedId} by ${actingUser}`,
        performedBy: actingUser,
      });

      await pushIfGokoOccupancy(detail.booking.source, before, dormIds, dates);
      return NextResponse.json({ success: true });
    }

    // --- Assign Guest (link checkin record) ---

    if (action === "assignGuest") {
      const { bookingId, checkinId } = body;
      if (!bookingId) return NextResponse.json({ error: "bookingId required" }, { status: 400 });

      const detail = await getBookingDetail(bookingId);
      if (!detail) return NextResponse.json({ error: "Booking not found" }, { status: 404 });
      const existingCmId = detail.booking.cmBookingId || "";
      if (existingCmId && !/^\d+$/.test(existingCmId)) {
        await addBookingHistoryEntry({
          bookingId,
          action: "Guest Linked",
          details: checkinId
            ? `Check-in #${checkinId} noted; channel id ${existingCmId} kept`
            : `Channel id ${existingCmId} kept`,
          performedBy: actingUser,
        });
        return NextResponse.json({ success: true });
      }

      await updateBookingFull(bookingId, { cmBookingId: checkinId ? String(checkinId) : "" });
      await addBookingHistoryEntry({
        bookingId,
        action: "Guest Linked",
        details: checkinId ? `Linked to checkin #${checkinId}` : "Guest link removed",
        performedBy: actingUser,
      });

      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e: any) {
    console.error("Booking API error:", { requestId, action, stage, error: e });
    const raw = e?.message || "Internal server error";
    if (/Receiving bank|Selected receiving bank/.test(raw)) return NextResponse.json({ error: raw }, { status: 400 });
    const databaseError = /D1|Failed query|SQLITE_/i.test(raw);
    const msg = databaseError ? "Database temporarily unavailable. Please try again." : "Internal server error";
    return NextResponse.json({
      error: msg,
      debug: {
        requestId,
        action,
        stage,
        type: databaseError ? "database" : (e?.name || "server"),
        serverTime: new Date().toISOString(),
      },
    }, { status: 500, headers: { "x-goko-request-id": requestId } });
  }
}
