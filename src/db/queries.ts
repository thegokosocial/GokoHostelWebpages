import { eq, desc, and, sql, inArray, gte, lte, lt, or, like, not } from "drizzle-orm";
import { getDb } from "./index";
import { todayIST } from "@/lib/utils";
import { calendarAvailability, addCalendarDays, bedsFitInventoryCap, countUnassignedOtaRooms, explodeUnassignedOtaHolds, pickInventoryOverride, sellableUnits, stayNights, tagBedsForPicker } from "@/lib/inventoryAvailability";
import { sqliteWriteCount } from "@/lib/sqliteWriteCount";
import { sqliteLikePrefix } from "@/lib/pmsLog";
import { clampLogOffset, clampLogPageSize, clampLogSince, LOG_DOWNLOAD_MAX, logRetentionSince } from "@/lib/logRetention";
import { checkins, dorms, beds, bedHistory, settings, apiStats, users, tasks, auditLog, systemLogs, rateScrapes, bookings, bookingContactMethods, menuCategories, menuItems, foodOrders, foodOrderItems, foodBillShareTokens, orderModifications, expenses, reviewRequests, reviewFeedback, channelConfig, roomTypeMapping, ratePlanMapping, dailyRates, channelSyncLog, bookingBedAssignments, bookingHistory, bedTypeConfig, channels, channelRates, bedBlocks, inventoryOverrides, inventoryDirty, employeeAttendanceHistory, guestReceipts, platformReceivableEntries, platformSettlementAllocations, guestBookingLookupChallenges, nativeInventoryHolds, nativeBookingCheckouts } from "./schema";
import { dbRead, dbWrite } from "@/lib/dbRetry";
import { syncInsert, syncUpdate } from "./syncMeta";
import { auditDateBounds, auditRetentionCutoff, auditRetentionParts, DEFAULT_AUDIT_RETENTION_MONTHS, normalizeAuditRetentionMonths } from "@/lib/auditRetention";
import { INVENTORY_AUDIT_ACTION_PREFIXES } from "@/lib/inventoryAudit";
import type { AuditReferenceMaps } from "@/lib/auditPresentation";
import { uniqueInBatches, collectInBatches } from "@/lib/dbBatch";
import { foodDue } from "@/lib/foodPaymentBalance";
import { normalizePhone } from "@/lib/phoneUtils";

// --- Check-ins ---

export async function getCheckinsByMonth(month: string) {
  return dbRead(() => {
    const db = getDb();
    return db.select().from(checkins).where(eq(checkins.createdMonth, month)).orderBy(desc(checkins.id));
  });
}

export async function getCheckinsByDateRange(startDate: string, endDate: string) {
  return dbRead(() => {
    const db = getDb();
    return db.select().from(checkins)
      .where(and(gte(checkins.arrivalDate, startDate), lte(checkins.arrivalDate, endDate)))
      .orderBy(desc(checkins.id));
  });
}

export async function getCheckinById(id: number) {
  const db = getDb();
  const rows = await db.select().from(checkins).where(eq(checkins.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function addCheckin(data: {
  submittedAt: string; arrivalDate: string; arrivalTime: string; name: string;
  persons: string; contact: string; stayingDays: string; comingFrom: string;
  nationality: string; emergencyName: string; emergencyPhone: string;
  idType: string; idCardLink: string; visaLink: string; verified: string;
  formCData?: string; createdMonth: string;
  bookingPlatform?: string; bookingId?: string;
  dob?: string; dobFromId?: string;
}) {
  const db = getDb();
  return db.insert(checkins).values(syncInsert(data));
}

export async function updateCheckin(id: number, data: Partial<typeof checkins.$inferInsert>) {
  return dbWrite(() => {
    const db = getDb();
    return db.update(checkins).set(syncUpdate(data)).where(eq(checkins.id, id));
  }, { idempotentWrite: true });
}

export async function markVibeMatched(id: number) {
  const db = getDb();
  return db.update(checkins).set(syncUpdate({ vibeMatched: 1 })).where(eq(checkins.id, id));
}

export async function deleteCheckin(id: number) {
  const db = getDb();
  // Preserve history while removing nullable references to the parent row.
  await db.update(beds).set({ checkinId: null }).where(eq(beds.checkinId, id));
  await db.update(foodOrders).set({ checkinId: null }).where(eq(foodOrders.checkinId, id));
  return db.delete(checkins).where(eq(checkins.id, id));
}

export async function getLatestCheckinByContact(contact: string) {
  const db = getDb();
  const rows = await db.select().from(checkins)
    .where(eq(checkins.contact, contact))
    .orderBy(desc(checkins.id))
    .limit(1);
  return rows[0] || null;
}

/** Latest check-in row for a normalized 10-digit phone (handles +91 / legacy formats). */
export async function getLatestCheckinByNormalizedPhone(normalized: string) {
  if (!normalized) return null;
  const db = getDb();
  for (const candidate of [normalized, `+91${normalized}`, `91${normalized}`]) {
    const rows = await db.select().from(checkins)
      .where(eq(checkins.contact, candidate))
      .orderBy(desc(checkins.id))
      .limit(1);
    if (rows[0]) return rows[0];
  }
  const suffixRows = await db.select().from(checkins)
    .where(sql`(${checkins.contact} = ${normalized} OR ${checkins.contact} LIKE ${"%" + normalized})`)
    .orderBy(desc(checkins.id))
    .limit(1);
  return suffixRows[0] || null;
}

export async function getCheckinMonths(): Promise<string[]> {
  return dbRead(async () => {
    const db = getDb();
    const rows = await db.selectDistinct({ month: checkins.createdMonth }).from(checkins);
    return rows.map((r) => r.month);
  });
}

// --- Dorms ---

export async function getAllDorms() {
  const db = getDb();
  return db.select().from(dorms);
}

export async function getDormByName(name: string) {
  const db = getDb();
  const rows = await db.select().from(dorms).where(eq(dorms.name, name));
  return rows[0] || null;
}

export async function addDorm(name: string) {
  const db = getDb();
  return db.insert(dorms).values(syncInsert({ name, createdAt: new Date().toISOString() }));
}

export async function deleteDormAndBeds(dormId: number) {
  const db = getDb();
  await db.delete(bookingBedAssignments).where(eq(bookingBedAssignments.dormId, dormId));
  await db.delete(bedBlocks).where(eq(bedBlocks.dormId, dormId));
  await db.delete(bedTypeConfig).where(eq(bedTypeConfig.dormId, dormId));
  await db.delete(inventoryOverrides).where(eq(inventoryOverrides.dormId, dormId));
  await db.delete(inventoryDirty).where(eq(inventoryDirty.dormId, dormId));
  const mappings = await db.select({ id: roomTypeMapping.id }).from(roomTypeMapping).where(eq(roomTypeMapping.dormId, dormId));
  for (const m of mappings) {
    await deleteRoomTypeMapping(m.id);
  }
  await db.delete(beds).where(eq(beds.dormId, dormId));
  await db.delete(dorms).where(eq(dorms.id, dormId));
}

// --- Beds ---

export async function getAllBeds() {
  return dbRead(() => {
    const db = getDb();
    return db.select({
      id: beds.id,
      dormId: beds.dormId,
      bedId: beds.bedId,
      position: beds.position,
      type: beds.type,
      status: beds.status,
      guestName: beds.guestName,
      guestContact: beds.guestContact,
      checkinDate: beds.checkinDate,
      expectedCheckout: beds.expectedCheckout,
      stayingDays: beds.stayingDays,
      checkinId: beds.checkinId,
      dormName: dorms.name,
    }).from(beds).innerJoin(dorms, eq(beds.dormId, dorms.id));
  });
}

export async function getBedById(bedId: number) {
  const db = getDb();
  const rows = await db.select({
    id: beds.id,
    dormId: beds.dormId,
    bedId: beds.bedId,
    position: beds.position,
    type: beds.type,
    status: beds.status,
    guestName: beds.guestName,
    guestContact: beds.guestContact,
    checkinDate: beds.checkinDate,
    expectedCheckout: beds.expectedCheckout,
    stayingDays: beds.stayingDays,
    checkinId: beds.checkinId,
    dormName: dorms.name,
  }).from(beds).innerJoin(dorms, eq(beds.dormId, dorms.id)).where(eq(beds.id, bedId));
  return rows[0] || null;
}

export async function updateBedStatus(bedId: number, data: {
  status: string;
  guestName?: string;
  guestContact?: string;
  checkinDate?: string;
  expectedCheckout?: string;
  stayingDays?: string;
  checkinId?: number | null;
}) {
  return dbWrite(() => {
    const db = getDb();
    return db.update(beds).set(syncUpdate(data)).where(eq(beds.id, bedId));
  }, { idempotentWrite: true });
}

export async function assignPhysicalBed(bedId: number, data: {
  guestName: string; guestContact: string; checkinDate: string; expectedCheckout: string; stayingDays: string; checkinId?: number;
}) {
  return dbWrite(async () => {
    const result = await getDb().update(beds).set(syncUpdate({
      status: "occupied", ...data,
    })).where(and(eq(beds.id, bedId), eq(beds.status, "available")));
    return sqliteWriteCount(result) > 0;
  }, { idempotentWrite: true });
}

export async function addBed(data: { dormId: number; dormName: string; bedId: string; position: string; type: string }) {
  const db = getDb();
  return db.insert(beds).values(syncInsert({ ...data, status: "available", guestName: "", guestContact: "", checkinDate: "", expectedCheckout: "", stayingDays: "" }));
}

export async function deleteBed(bedId: number) {
  const db = getDb();
  return db.delete(beds).where(eq(beds.id, bedId));
}

// --- Bed History ---

export async function logBedHistoryEntry(data: {
  bedIdLabel: string; dormName: string; action: string; guestName: string; guestContact: string;
}) {
  const db = getDb();
  return db.insert(bedHistory).values(syncInsert({ ...data, createdAt: new Date().toISOString() }));
}

export async function getBedHistoryAll() {
  const db = getDb();
  return db.select().from(bedHistory).orderBy(desc(bedHistory.id));
}

export async function deleteBedHistoryEntry(id: number) {
  const db = getDb();
  return db.delete(bedHistory).where(eq(bedHistory.id, id));
}

// --- Settings ---

export async function getSetting(key: string): Promise<string | null> {
  return dbRead(async () => {
    const db = getDb();
    const rows = await db.select().from(settings).where(eq(settings.key, key));
    return rows[0]?.value ?? null;
  });
}

export async function setSetting(key: string, value: string) {
  const db = getDb();
  await db.insert(settings).values({ key, value, ...syncUpdate({}) }).onConflictDoUpdate({
    target: settings.key,
    set: syncUpdate({ value }),
  });
}

// --- API Stats ---

export async function incrementStat(apiType: "vision" | "sheets" | "drive", count = 1) {
  const db = getDb();
  const month = getMonthKey();

  const existing = await db.select().from(apiStats).where(eq(apiStats.month, month));
  if (existing.length > 0) {
    await db.update(apiStats).set({
      vision: sql`${apiStats.vision} + ${apiType === "vision" ? count : 0}`,
      sheets: sql`${apiStats.sheets} + ${apiType === "sheets" ? count : 0}`,
      drive: sql`${apiStats.drive} + ${apiType === "drive" ? count : 0}`,
      total: sql`${apiStats.total} + ${count}`,
    }).where(eq(apiStats.month, month));
  } else {
    const vision = apiType === "vision" ? count : 0;
    const sheets = apiType === "sheets" ? count : 0;
    const drive = apiType === "drive" ? count : 0;
    await db.insert(apiStats).values({ month, vision, sheets, drive, total: vision + sheets + drive });
  }
}

export async function getAllStats() {
  const db = getDb();
  return db.select().from(apiStats).orderBy(apiStats.month);
}

// --- Helpers ---

export function getMonthKey(date?: Date): string {
  const d = date && !isNaN(date.getTime()) ? date : new Date();
  const months = ["JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE",
    "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER"];
  return `${months[d.getUTCMonth()]}-${d.getUTCFullYear()}`;
}

// --- Users ---

export async function getAllUsers() {
  return dbRead(() => {
    const db = getDb();
    return db.select().from(users).orderBy(users.id);
  });
}

export async function getUserByUsername(username: string) {
  return dbRead(async () => {
    const db = getDb();
    const rows = await db.select().from(users).where(eq(users.username, username)).limit(1);
    return rows[0] || null;
  });
}

export async function getUserById(id: number) {
  return dbRead(async () => {
    const db = getDb();
    const rows = await db.select().from(users).where(eq(users.id, id)).limit(1);
    return rows[0] || null;
  });
}

export async function createUser(data: {
  username: string; passwordHash: string; displayName: string;
  role: string; permissions: string; createdBy?: string;
}) {
  const db = getDb();
  return db.insert(users).values(syncInsert({
    ...data,
    createdAt: new Date().toISOString(),
    createdBy: data.createdBy || "",
    isSystem: 0,
  }));
}

export async function updateUser(userId: number, data: {
  displayName?: string; passwordHash?: string; role?: string; permissions?: string;
}) {
  return dbWrite(() => {
    const db = getDb();
    const updateData: any = {};
    if (data.displayName !== undefined) updateData.displayName = data.displayName;
    if (data.passwordHash !== undefined) updateData.passwordHash = data.passwordHash;
    if (data.role !== undefined) updateData.role = data.role;
    if (data.permissions !== undefined) updateData.permissions = data.permissions;
    return db.update(users).set(syncUpdate(updateData)).where(eq(users.id, userId));
  }, { idempotentWrite: true });
}

export async function deleteUser(userId: number) {
  const db = getDb();
  return db.delete(users).where(eq(users.id, userId));
}

// --- Tasks ---

export type TaskStatus = "todo" | "in_progress" | "blocked" | "done";
export type TaskPriority = "low" | "normal" | "high" | "urgent";

export async function getTaskAssignees() {
  const db = getDb();
  return db.select({
    id: users.id,
    username: users.username,
    displayName: users.displayName,
    role: users.role,
  }).from(users)
    .where(sql`${users.deletedAt} IS NULL`)
    .orderBy(users.displayName);
}

function taskWhere(includeArchived: boolean, assigneeUserId?: number) {
  const conditions = [includeArchived ? undefined : sql`${tasks.deletedAt} IS NULL`];
  if (assigneeUserId != null) conditions.push(eq(tasks.assigneeUserId, assigneeUserId));
  return and(...conditions.filter((condition): condition is NonNullable<typeof condition> => Boolean(condition)));
}

export async function getTasks(options: { includeArchived?: boolean; assigneeUserId?: number } = {}) {
  const db = getDb();
  return db.select().from(tasks)
    .leftJoin(users, eq(tasks.assigneeUserId, users.id))
    .leftJoin(expenses, and(eq(tasks.id, expenses.taskId), sql`${expenses.deletedAt} IS NULL`))
    .where(taskWhere(Boolean(options.includeArchived), options.assigneeUserId))
    .orderBy(sql`CASE WHEN ${tasks.status} = 'done' THEN 1 ELSE 0 END`, sql`CASE WHEN ${tasks.dueDate} = '' THEN 1 ELSE 0 END`, tasks.dueDate, desc(tasks.id));
}

export async function getTaskById(id: number) {
  const db = getDb();
  const rows = await db.select().from(tasks)
    .leftJoin(users, eq(tasks.assigneeUserId, users.id))
    .leftJoin(expenses, and(eq(tasks.id, expenses.taskId), sql`${expenses.deletedAt} IS NULL`))
    .where(eq(tasks.id, id)).limit(1);
  return rows[0] || null;
}

export async function createTask(data: {
  title: string; description?: string; taskType?: string; category?: string;
  priority?: TaskPriority; dueDate?: string; assigneeUserId?: number | null;
  status?: TaskStatus; note?: string; attachments?: string; createdBy: string;
  followerUsernames?: string;
  updatedBy: string;
}) {
  const db = getDb();
  const now = new Date().toISOString();
  const result = await db.insert(tasks).values(syncInsert({
    ...data,
    description: data.description || "",
    taskType: data.taskType || "general",
    category: data.category || "",
    priority: data.priority || "normal",
    dueDate: data.dueDate || "",
    status: data.status || "todo",
    note: data.note || "",
    attachments: data.attachments || "[]",
    followerUsernames: data.followerUsernames || "[]",
    createdAt: now,
    updatedAt: now,
  })).returning({ id: tasks.id });
  return result[0]?.id || null;
}

export async function updateTask(id: number, data: Partial<{
  title: string; description: string; taskType: string; category: string;
  priority: TaskPriority; dueDate: string; assigneeUserId: number | null;
  status: TaskStatus; note: string; attachments: string; completedAt: string;
  completedBy: string; updatedBy: string; followerUsernames: string;
}>) {
  return dbWrite(() => getDb().update(tasks).set(syncUpdate(data)).where(eq(tasks.id, id)), { idempotentWrite: true });
}

export async function archiveTask(id: number, updatedBy: string) {
  return dbWrite(() => getDb().update(tasks).set(syncUpdate({ deletedAt: new Date().toISOString(), updatedBy })).where(eq(tasks.id, id)), { idempotentWrite: true });
}

export async function getTaskExpense(taskId: number) {
  const db = getDb();
  const rows = await db.select().from(expenses)
    .where(and(eq(expenses.taskId, taskId), sql`${expenses.deletedAt} IS NULL`))
    .limit(1);
  return rows[0] || null;
}

// --- Audit Log ---

export async function addAuditEntry(data: {
  username: string; action: string; target?: string; details?: string; userId?: number; ipAddress?: string;
}) {
  const db = getDb();
  return db.insert(auditLog).values({
    timestamp: new Date().toISOString(),
    username: data.username,
    action: data.action,
    target: data.target || "",
    details: data.details || "",
    userId: data.userId,
    ipAddress: data.ipAddress || "",
  });
}

export async function getAuditEntries(limit = 500, dateFrom?: string, dateTo?: string) {
  const db = getDb();
  const bounds = auditDateBounds(await getAuditRetentionCutoff(), dateFrom, dateTo);
  const inventoryActionFilter = or(...INVENTORY_AUDIT_ACTION_PREFIXES.map((prefix) => like(auditLog.action, `${prefix}%`)));
  return db.select().from(auditLog).where(and(
    not(inventoryActionFilter!),
    gte(auditLog.timestamp, bounds.start),
    ...(bounds.end ? [lte(auditLog.timestamp, bounds.end)] : []),
  )).orderBy(desc(auditLog.id)).limit(limit);
}

export async function getInventoryAuditEntries(limit = 500, dateFrom?: string, dateTo?: string) {
  const db = getDb();
  const bounds = auditDateBounds(await getAuditRetentionCutoff(), dateFrom, dateTo);
  const inventoryActionFilter = or(...INVENTORY_AUDIT_ACTION_PREFIXES.map((prefix) => like(auditLog.action, `${prefix}%`)));
  return db.select().from(auditLog).where(and(
    inventoryActionFilter,
    gte(auditLog.timestamp, bounds.start),
    ...(bounds.end ? [lte(auditLog.timestamp, bounds.end)] : []),
  )).orderBy(desc(auditLog.id)).limit(limit);
}

/** Small, bounded lookup maps used to make legacy audit targets readable without N+1 queries. */
export async function getAuditPresentationContext(): Promise<AuditReferenceMaps> {
  try {
    const db = getDb();
    const [dormRows, bedRows, channelRows, ratePlanRows] = await Promise.all([
      db.select({ id: dorms.id, name: dorms.name }).from(dorms),
      db.select({ id: beds.id, bedId: beds.bedId, dormName: dorms.name }).from(beds).innerJoin(dorms, eq(beds.dormId, dorms.id)),
      db.select({ id: channels.id, name: channels.name }).from(channels),
      db.select({ id: ratePlanMapping.id, name: ratePlanMapping.ratePlanName, dormName: roomTypeMapping.dormName, code: ratePlanMapping.ratePlanCode })
        .from(ratePlanMapping)
        .innerJoin(roomTypeMapping, eq(ratePlanMapping.roomMappingId, roomTypeMapping.id)),
    ]);
    return {
      dormNames: Object.fromEntries(dormRows.map((row) => [String(row.id), row.name])),
      bedNames: Object.fromEntries(bedRows.map((row) => [String(row.id), `${row.dormName} · ${row.bedId}`])),
      channelNames: Object.fromEntries(channelRows.map((row) => [String(row.id), row.name])),
      ratePlanNames: Object.fromEntries(ratePlanRows.map((row) => [String(row.id), `${row.dormName} · ${row.name || row.code}`])),
    };
  } catch {
    return {};
  }
}

export async function getAuditEntriesBefore(cutoff: string) {
  const db = getDb();
  const general = await db.select({ id: auditLog.id }).from(auditLog).where(lt(auditLog.timestamp, cutoff));
  const bookings = await db.select({ id: bookingHistory.id }).from(bookingHistory).where(lt(bookingHistory.performedAt, cutoff));
  const attendance = await db.select({ id: employeeAttendanceHistory.id }).from(employeeAttendanceHistory).where(lt(employeeAttendanceHistory.performedAt, cutoff));
  return { auditLog: general.length, bookingHistory: bookings.length, attendanceHistory: attendance.length, total: general.length + bookings.length + attendance.length };
}

export async function deleteAuditEntriesBefore(cutoff: string) {
  const db = getDb();
  const general = await db.delete(auditLog).where(lt(auditLog.timestamp, cutoff)).returning({ id: auditLog.id });
  const bookings = await db.delete(bookingHistory).where(lt(bookingHistory.performedAt, cutoff)).returning({ id: bookingHistory.id });
  const attendance = await db.delete(employeeAttendanceHistory).where(lt(employeeAttendanceHistory.performedAt, cutoff)).returning({ id: employeeAttendanceHistory.id });
  return { auditLog: general.length, bookingHistory: bookings.length, attendanceHistory: attendance.length, total: general.length + bookings.length + attendance.length };
}

export async function getAuditRetentionCutoff() {
  const configured = await getSetting("audit_retention_months");
  return auditRetentionCutoff(normalizeAuditRetentionMonths(configured || DEFAULT_AUDIT_RETENTION_MONTHS));
}

export async function getAuditRetention() {
  const configured = await getSetting("audit_retention_months");
  const months = normalizeAuditRetentionMonths(configured || DEFAULT_AUDIT_RETENTION_MONTHS);
  const cutoff = auditRetentionCutoff(months);
  return { ...auditRetentionParts(months), cutoff, eligible: await getAuditEntriesBefore(cutoff) };
}

// --- System Logs ---

const LOG_LEVELS: Record<string, number> = { debug: 0, info: 1, warn: 2, error: 3 };

export async function addSystemLog(data: {
  level: string; source: string; message: string; details?: string; requestId?: string;
}) {
  try {
    const configuredLevel = await getSetting("log_level") || "info";
    const configuredPriority = LOG_LEVELS[configuredLevel] ?? 3;
    const messagePriority = LOG_LEVELS[data.level] ?? 0;

    if (messagePriority < configuredPriority) return;

    const db = getDb();
    await db.insert(systemLogs).values({
      timestamp: new Date().toISOString(),
      level: data.level,
      source: data.source,
      message: data.message,
      details: data.details || "",
      requestId: data.requestId || "",
    });
  } catch {
    // Fail silently — logging should never break the app
    return;
  }
  try {
    await pruneSystemLogs();
  } catch {
    // Keep the new row even if cleanup of old rows fails
  }
}

async function pruneSystemLogs() {
  const db = getDb();
  await db.delete(systemLogs).where(lt(systemLogs.timestamp, logRetentionSince()));
}

export async function getSystemLogs(
  limit = 50,
  filters?: { level?: string; source?: string; since?: string; offset?: number },
) {
  await pruneSystemLogs().catch(() => {});
  const pageSize = clampLogPageSize(limit, LOG_DOWNLOAD_MAX);
  const since = clampLogSince(filters?.since);
  const db = getDb();
  const conditions = [gte(systemLogs.timestamp, since)];
  if (filters?.level) conditions.push(eq(systemLogs.level, filters.level));
  if (filters?.source) conditions.push(eq(systemLogs.source, filters.source));
  const where = and(...conditions);
  const [countRow] = await db.select({ n: sql<number>`count(*)` }).from(systemLogs).where(where);
  const total = Number(countRow?.n ?? 0);
  const offset = clampLogOffset(total, pageSize, filters?.offset ?? 0);
  const sourceRows = await db.selectDistinct({ source: systemLogs.source })
    .from(systemLogs)
    .where(and(gte(systemLogs.timestamp, since), sql`${systemLogs.source} != ''`));
  const logs = await db.select().from(systemLogs).where(where).orderBy(desc(systemLogs.id)).limit(pageSize).offset(offset);
  return {
    logs,
    total,
    sources: sourceRows.map((r) => r.source).filter((s): s is string => Boolean(s)),
  };
}

// --- Bookings ---

export async function getAllBookings() {
  const db = getDb();
  return db.select().from(bookings).orderBy(desc(bookings.id));
}

export async function getBookingByRef(ref: string) {
  const db = getDb();
  const rows = await db.select().from(bookings).where(eq(bookings.bookingRef, ref)).limit(1);
  return rows[0] ?? null;
}

export async function getUpcomingBookings() {
  const db = getDb();
  const today = todayIST();
  return db.select().from(bookings)
    .where(and(
      eq(bookings.status, "confirmed"),
      sql`${bookings.checkinDate} >= ${today}`
    ))
    .orderBy(bookings.checkinDate);
}

export async function addBooking(data: {
  guestName: string; contact?: string; platform: string; bookingRef?: string;
  checkinDate: string; checkoutDate?: string; roomType?: string; persons?: number;
  paymentStatus?: string; specialRequests?: string; status?: string; source?: string;
  otaPaymentTerms?: string | null; otaCurrency?: string | null;
  property?: string; rawData?: string;
  amountBeforeTax?: number; amountTax?: number; amountTotal?: number;
  amountPaid?: number; nightlyRate?: number; currency?: string;
  paymentMethod?: string; cashReceived?: number; changeGiven?: number;
  email?: string; cmBookingId?: string; gokoBookingId?: string;
  ratePlan?: string;
  checkedInAt?: string; checkedInBy?: string;
  checkedOutAt?: string; checkedOutBy?: string;
}) {
  const db = getDb();
  const rows = await db.insert(bookings).values(syncInsert({
    guestName: data.guestName,
    contact: data.contact || "",
    platform: data.platform,
    bookingRef: data.bookingRef || "",
    checkinDate: data.checkinDate,
    checkoutDate: data.checkoutDate || "",
    roomType: data.roomType || "",
    persons: data.persons || 1,
    paymentStatus: data.paymentStatus || "unknown",
    otaPaymentTerms: data.otaPaymentTerms ?? null,
    otaCurrency: data.otaCurrency ?? null,
    specialRequests: data.specialRequests || "",
    status: data.status || "received",
    source: data.source || "manual",
    property: data.property || "goko_hostel",
    rawData: data.rawData || "",
    createdAt: new Date().toISOString(),
    syncedAt: "",
    amountBeforeTax: data.amountBeforeTax ?? 0,
    amountTax: data.amountTax ?? 0,
    amountTotal: data.amountTotal ?? 0,
    amountPaid: data.amountPaid ?? 0, // Channel prepaid omits this; calendar check-in copies total as online.
    paymentMethod: data.paymentMethod || "",
    cashReceived: data.cashReceived ?? 0,
    changeGiven: data.changeGiven ?? 0,
    nightlyRate: data.nightlyRate ?? 0,
    currency: data.currency || "INR",
    email: data.email || "",
    cmBookingId: data.cmBookingId || "",
    gokoBookingId: data.gokoBookingId || "",
    ratePlan: data.ratePlan || "",
    checkedInAt: data.checkedInAt || "",
    checkedInBy: data.checkedInBy || "",
    checkedOutAt: data.checkedOutAt || "",
    checkedOutBy: data.checkedOutBy || "",
  })).returning({ id: bookings.id });
  const id = rows[0]?.id ?? null;
  if (id) await syncBookingContactSnapshot(id, data.source || "manual", data.contact || "", data.email || "", "system");
  return id;
}

export type BookingContactMethod = typeof bookingContactMethods.$inferSelect;

function normalizeBookingContact(type: "phone" | "email", value: string): string {
  if (type === "phone") {
    const normalized = normalizePhone(value);
    if (!normalized) throw new Error("Enter a valid phone number");
    return normalized;
  }
  const normalized = value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) throw new Error("Enter a valid email address");
  return normalized;
}

export async function getBookingContactMethods(bookingId: number) {
  try {
    return await getDb().select().from(bookingContactMethods).where(and(eq(bookingContactMethods.bookingId, bookingId), sql`${bookingContactMethods.deletedAt} IS NULL`))
      .orderBy(bookingContactMethods.type, bookingContactMethods.position, bookingContactMethods.id);
  } catch (error) {
    if (/no such table|no such column/i.test(error instanceof Error ? error.message : String(error))) return [];
    throw error;
  }
}

/** Mirrors source/legacy booking fields without ever changing staff-added rows. */
export async function syncBookingContactSnapshot(
  bookingId: number,
  source: string,
  contact: string,
  email: string,
  actor = "system",
) {
  const db = getDb();
  try {
    await db.select({ id: bookingContactMethods.id }).from(bookingContactMethods).limit(1);
  } catch (error) {
    if (/no such table|no such column/i.test(error instanceof Error ? error.message : String(error))) return;
    throw error;
  }
  const origin = ["channel_manager", "email"].includes(source) ? "pms" : "custom";
  const values = [
    { type: "phone" as const, value: contact.trim() },
    { type: "email" as const, value: email.trim() },
  ];
  for (const item of values) {
    const existing = (await db.select().from(bookingContactMethods).where(and(
      eq(bookingContactMethods.bookingId, bookingId), eq(bookingContactMethods.type, item.type),
      eq(bookingContactMethods.origin, origin), eq(bookingContactMethods.isPrimary, 1),
      sql`${bookingContactMethods.deletedAt} IS NULL`,
    )).limit(1))[0];
    if (!item.value) {
      if (origin === "pms" && existing) {
        await db.update(bookingContactMethods).set(syncUpdate({ deletedAt: new Date().toISOString() })).where(eq(bookingContactMethods.id, existing.id));
        await addBookingHistoryEntry({ bookingId, action: "Booking Contact Updated", details: `${item.type} PMS value cleared`, performedBy: actor });
      }
      continue;
    }
    const normalized = normalizeBookingContact(item.type, item.value);
    if (!existing) {
      await db.insert(bookingContactMethods).values(syncInsert({ bookingId, type: item.type, value: item.value, normalizedValue: normalized, label: "", origin, isPrimary: 1, position: 0 }));
    } else if (origin === "pms" && (existing.value !== item.value || existing.normalizedValue !== normalized)) {
      await db.update(bookingContactMethods).set(syncUpdate({ value: item.value, normalizedValue: normalized })).where(eq(bookingContactMethods.id, existing.id));
      await addBookingHistoryEntry({ bookingId, action: "Booking Contact Updated", details: `${item.type} PMS value refreshed`, performedBy: actor });
    }
  }
}

export async function saveBookingContactMethods(
  bookingId: number,
  requested: Array<{ id?: number; type: "phone" | "email"; value: string; label?: string }>,
  performedBy: string,
) {
  const db = getDb() as any;
  const existing: BookingContactMethod[] = await db.select().from(bookingContactMethods).where(and(eq(bookingContactMethods.bookingId, bookingId), sql`${bookingContactMethods.deletedAt} IS NULL`));
  const existingById = new Map<number, BookingContactMethod>(existing.map((row) => [row.id, row]));
  const seen = new Set<string>();
  const prepared = requested.map((item, index) => {
    if (item.type !== "phone" && item.type !== "email") throw new Error("Contact type is invalid");
    const value = item.value.trim();
    const normalizedValue = normalizeBookingContact(item.type, value);
    const key = `${item.type}:${normalizedValue}`;
    if (seen.has(key)) throw new Error("Duplicate contact values are not allowed");
    seen.add(key);
    const row = item.id ? existingById.get(item.id) : undefined;
    if (item.id && !row) throw new Error("Contact row was not found; reload and try again");
    if (row?.origin === "pms" && (row.value !== value || row.label !== (item.label || ""))) throw new Error("PMS contacts cannot be edited");
    return { item, row, value, normalizedValue, label: (item.label || "").trim().slice(0, 80), position: index };
  });
  for (const type of ["phone", "email"] as const) {
    if (prepared.filter((row) => row.item.type === type).length > 5) throw new Error(`Maximum 5 ${type}s allowed`);
  }
  const requestedIds = new Set(prepared.filter((row) => row.row).map((row) => row.row!.id));
  const changes: string[] = [];
  const now = new Date().toISOString();
  const buildWrites = (client: any) => {
    const writes: any[] = [];
    for (const row of existing) {
      if (row.origin === "custom" && !requestedIds.has(row.id)) {
        writes.push(client.update(bookingContactMethods).set(syncUpdate({ deletedAt: now })).where(eq(bookingContactMethods.id, row.id)));
        changes.push(`Deleted ${row.type} ${row.label || "contact"}`);
      }
    }
    for (const row of prepared) {
      if (row.row) {
        if (row.row.origin === "pms") continue;
        if (row.row.value !== row.value || row.row.label !== row.label || row.row.position !== row.position) {
          writes.push(client.update(bookingContactMethods).set(syncUpdate({ value: row.value, normalizedValue: row.normalizedValue, label: row.label, position: row.position })).where(eq(bookingContactMethods.id, row.row.id)));
          changes.push(`Updated ${row.item.type} ${row.label || "contact"}`);
        }
      } else {
        writes.push(client.insert(bookingContactMethods).values(syncInsert({ bookingId, type: row.item.type, value: row.value, normalizedValue: row.normalizedValue, label: row.label, origin: "custom", isPrimary: 0, position: row.position })));
        changes.push(`Added ${row.item.type} ${row.label || "contact"}`);
      }
    }
    if (changes.length) writes.push(client.insert(bookingHistory).values({ bookingId, action: "Booking Contacts Changed", details: changes.join("; "), performedBy, performedAt: now }));
    return writes;
  };
  if (typeof db.batch === "function") {
    const writes = buildWrites(db);
    if (writes.length) await db.batch(writes);
  } else {
    await db.transaction(async (tx: any) => {
      for (const write of buildWrites(tx)) await write;
    });
  }
  return { changes };
}

export async function updateBookingStatus(id: number, status: string) {
  const db = getDb();
  return db.update(bookings).set(syncUpdate({ status })).where(eq(bookings.id, id));
}

export async function deleteBooking(id: number) {
  const db = getDb();
  return db.delete(bookings).where(eq(bookings.id, id));
}

/** Hard-delete a booking and booking-owned rows. Caller must enforce eligibility. */
export async function hardDeleteBookingCascade(bookingId: number): Promise<{ receiptIds: string[] }> {
  const db = getDb();
  const receipts = await db.select({ receiptId: guestReceipts.receiptId })
    .from(guestReceipts)
    .where(and(eq(guestReceipts.sourceType, "booking"), eq(guestReceipts.sourceId, bookingId)));
  await db.delete(bookingBedAssignments).where(eq(bookingBedAssignments.bookingId, bookingId));
  try {
    await db.delete(bookingContactMethods).where(eq(bookingContactMethods.bookingId, bookingId));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/no such table/i.test(message)) throw error;
  }
  await db.delete(bookingHistory).where(eq(bookingHistory.bookingId, bookingId));
  await db.delete(guestReceipts).where(and(eq(guestReceipts.sourceType, "booking"), eq(guestReceipts.sourceId, bookingId)));
  try {
    await db.delete(guestBookingLookupChallenges).where(eq(guestBookingLookupChallenges.bookingId, bookingId));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/no such table/i.test(message)) throw error;
  }
  // Detach website checkout rows so FK does not block; paid checkouts must be blocked by the caller.
  try {
    await db.update(nativeBookingCheckouts).set({ bookingId: null }).where(eq(nativeBookingCheckouts.bookingId, bookingId));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/no such table|no such column/i.test(message)) throw error;
  }
  await db.delete(bookings).where(eq(bookings.id, bookingId));
  return { receiptIds: receipts.map((r) => r.receiptId) };
}

export async function bookingHasPlatformFinance(bookingId: number): Promise<boolean> {
  const db = getDb();
  try {
    const [receivable, allocation] = await Promise.all([
      db.select({ id: platformReceivableEntries.id }).from(platformReceivableEntries).where(eq(platformReceivableEntries.bookingId, bookingId)).limit(1),
      db.select({ id: platformSettlementAllocations.id }).from(platformSettlementAllocations).where(eq(platformSettlementAllocations.bookingId, bookingId)).limit(1),
    ]);
    return Boolean(receivable[0] || allocation[0]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/no such table|no such column/i.test(message)) return false;
    throw error;
  }
}

/** Walk-in/Offline check-ins whose booking_id or booking_linked_ref matches any of the refs. */
export async function findWalkinCheckinsByBookingRefs(refs: string[]) {
  const cleaned = [...new Set(refs.map((r) => String(r || "").trim()).filter(Boolean))];
  if (cleaned.length === 0) return [];
  const db = getDb();
  return collectInBatches(cleaned, (batch) => db.select().from(checkins).where(
    and(
      or(eq(checkins.bookingPlatform, "Walk-in"), eq(checkins.bookingPlatform, "Offline booking"))!,
      or(inArray(checkins.bookingId, batch), inArray(checkins.bookingLinkedRef, batch))!,
    ),
  ));
}

/** Reopen Walk-in/Offline check-ins that were marked created/linked for this booking's refs. */
export async function reopenWalkinCheckinsForBooking(opts: {
  bookingRef?: string | null;
  gokoBookingId?: string | null;
  cmBookingId?: string | null;
  actingUser: string;
}): Promise<number[]> {
  const refs = [...new Set(
    [opts.bookingRef, opts.gokoBookingId, opts.cmBookingId]
      .map((v) => String(v || "").trim())
      .filter(Boolean),
  )];
  if (refs.length === 0) return [];
  const rows = (await findWalkinCheckinsByBookingRefs(refs)).filter(
    (row) => row.status === "active" && (row.bookingResolution === "created" || row.bookingResolution === "linked"),
  );
  const now = new Date().toISOString();
  const reopened: number[] = [];
  for (const row of rows) {
    await updateCheckin(row.id, {
      bookingResolution: "pending",
      bookingLinkedRef: "",
      bookingResolutionAt: now,
      bookingResolutionBy: opts.actingUser,
    });
    reopened.push(row.id);
  }
  return reopened;
}

export async function deleteEmailBookings() {
  const db = getDb();
  return db.delete(bookings).where(eq(bookings.source, "email"));
}

export async function updateBookingFull(id: number, data: Partial<typeof bookings.$inferInsert>) {
  const db = getDb();
  return db.update(bookings).set(syncUpdate(data)).where(eq(bookings.id, id));
}

/** Atomically claim a one-way booking transition before releasing inventory. */
export async function transitionBookingStatus(
  id: number,
  from: string[],
  data: Partial<typeof bookings.$inferInsert>,
): Promise<boolean> {
  if (from.length === 0) return false;
  const db = getDb();
  const rows = await db.update(bookings)
    .set(syncUpdate(data))
    .where(and(eq(bookings.id, id), inArray(bookings.status, from)))
    .returning({ id: bookings.id });
  return rows.length > 0;
}

export async function getActiveAssignmentCountForDorm(dormId: number, date: string): Promise<number> {
  const db = getDb();
  const rows = await db.select({ count: sql<number>`COUNT(*)` })
    .from(bookingBedAssignments)
    .where(
      and(
        eq(bookingBedAssignments.dormId, dormId),
        eq(bookingBedAssignments.status, "assigned"),
        lte(bookingBedAssignments.checkinDate, date),
        sql`${bookingBedAssignments.checkoutDate} > ${date}`
      )
    );
  return rows[0]?.count ?? 0;
}

export async function getOnlineAssignmentCountForDorm(dormId: number, date: string): Promise<number> {
  const db = getDb();
  const rows = await db.select({ count: sql<number>`COUNT(*)` })
    .from(bookingBedAssignments)
    .where(
      and(
        eq(bookingBedAssignments.dormId, dormId),
        eq(bookingBedAssignments.status, "assigned"),
        lte(bookingBedAssignments.checkinDate, date),
        sql`${bookingBedAssignments.checkoutDate} > ${date}`,
        sql`coalesce(${bookingBedAssignments.inventoryPool}, 'online') = 'online'`
      )
    );
  return rows[0]?.count ?? 0;
}

/**
 * Active native website holds for one dorm+night, as physical bed positions.
 * Callers convert to units with the same bedsPerUnit pattern as getDateAwareAvailability.
 */
export async function getActiveNativeHoldBedCountForDorm(dormId: number, date: string): Promise<number> {
  const db = getDb();
  const active = await db.select({ bedIds: nativeInventoryHolds.bedIds })
    .from(nativeInventoryHolds)
    .where(and(
      eq(nativeInventoryHolds.state, "held"),
      sql`${nativeInventoryHolds.expiresAt} > CAST(strftime('%s','now') AS INTEGER)`,
      lte(nativeInventoryHolds.checkinDate, date),
      sql`${nativeInventoryHolds.checkoutDate} > ${date}`,
    ));
  if (active.length === 0) return 0;
  const dormBedIds = new Set(
    (await db.select({ id: beds.id }).from(beds).where(eq(beds.dormId, dormId))).map((b) => b.id),
  );
  let count = 0;
  for (const row of active) {
    for (const id of JSON.parse(row.bedIds) as number[]) {
      if (dormBedIds.has(id)) count++;
    }
  }
  return count;
}

/** One bounded read-set for multi-day channel inventory calculations. */
export async function getAvailabilitySnapshot(startDate: string, endDate: string) {
  const db = getDb();
  return Promise.all([
    db.select({ id: beds.id, dormId: beds.dormId, bedId: beds.bedId, type: beds.type }).from(beds),
    db.select({
      bedId: bookingBedAssignments.bedId,
      dormId: bookingBedAssignments.dormId,
      checkinDate: bookingBedAssignments.checkinDate,
      checkoutDate: bookingBedAssignments.checkoutDate,
      inventoryPool: bookingBedAssignments.inventoryPool,
    }).from(bookingBedAssignments).where(and(
      eq(bookingBedAssignments.status, "assigned"),
      lte(bookingBedAssignments.checkinDate, endDate),
      sql`${bookingBedAssignments.checkoutDate} > ${startDate}`,
    )),
    db.select({
      dormId: bedBlocks.dormId,
      bedId: bedBlocks.bedId,
      startDate: bedBlocks.startDate,
      endDate: bedBlocks.endDate,
    }).from(bedBlocks).where(and(
      eq(bedBlocks.isActive, 1),
      lte(bedBlocks.startDate, endDate),
      sql`${bedBlocks.endDate} > ${startDate}`,
    )),
    db.select().from(inventoryOverrides).where(and(
      gte(inventoryOverrides.date, startDate),
      lte(inventoryOverrides.date, endDate),
    )),
    db.select({
      checkinDate: bookings.checkinDate,
      checkoutDate: bookings.checkoutDate,
      roomType: bookings.roomType,
      rawData: bookings.rawData,
    }).from(bookings).where(and(
      eq(bookings.source, "channel_manager"),
      sql`${bookings.status} NOT IN ('cancelled', 'checked_out', 'guest_declined', 'no_show')`,
      lte(bookings.checkinDate, endDate),
      sql`(
        CASE
          WHEN ${bookings.checkoutDate} IS NULL
            OR ${bookings.checkoutDate} = ''
            OR ${bookings.checkoutDate} <= ${bookings.checkinDate}
          THEN date(${bookings.checkinDate}, '+1 day')
          ELSE ${bookings.checkoutDate}
        END > ${startDate}
      )`,
      sql`NOT EXISTS (
        SELECT 1 FROM ${bookingBedAssignments}
        WHERE ${bookingBedAssignments.bookingId} = ${bookings.id}
          AND ${bookingBedAssignments.status} = 'assigned'
          AND coalesce(${bookingBedAssignments.inventoryPool}, 'online') = 'online'
      )`,
    )),
    db.select({
      bedIds: nativeInventoryHolds.bedIds,
      checkinDate: nativeInventoryHolds.checkinDate,
      checkoutDate: nativeInventoryHolds.checkoutDate,
    }).from(nativeInventoryHolds).where(and(
      eq(nativeInventoryHolds.state, "held"),
      sql`${nativeInventoryHolds.expiresAt} > CAST(strftime('%s','now') AS INTEGER)`,
      lte(nativeInventoryHolds.checkinDate, endDate),
      sql`${nativeInventoryHolds.checkoutDate} > ${startDate}`,
    )),
  ]);
}

// --- Rate Scrapes ---

export async function createRateScrape(data: { city: string; startDate: string; endDate: string; propertyType: string }) {
  const db = getDb();
  const result = await db.insert(rateScrapes).values({
    city: data.city,
    startDate: data.startDate,
    endDate: data.endDate,
    propertyType: data.propertyType,
    status: "pending",
    results: "",
    createdAt: new Date().toISOString(),
    completedAt: "",
  }).returning();
  return result[0];
}

export async function getLatestRateScrape(city: string) {
  const db = getDb();
  const rows = await db.select().from(rateScrapes)
    .where(eq(rateScrapes.city, city))
    .orderBy(desc(rateScrapes.id))
    .limit(1);
  return rows[0] || null;
}

export async function getRateScrapeById(id: number) {
  const db = getDb();
  const rows = await db.select().from(rateScrapes).where(eq(rateScrapes.id, id)).limit(1);
  return rows[0] || null;
}

export async function updateRateScrape(id: number, data: { status?: string; results?: string; completedAt?: string }) {
  const db = getDb();
  return db.update(rateScrapes).set(data).where(eq(rateScrapes.id, id));
}

// --- Menu Categories ---

export async function getActiveMenuCategories() {
  const db = getDb();
  return db.select().from(menuCategories)
    .where(and(eq(menuCategories.isActive, 1), sql`${menuCategories.deletedAt} IS NULL`))
    .orderBy(menuCategories.displayOrder);
}

export async function getAllMenuCategories() {
  const db = getDb();
  return db.select().from(menuCategories).where(sql`${menuCategories.deletedAt} IS NULL`).orderBy(menuCategories.displayOrder);
}

export async function addMenuCategory(data: { name: string; nameKannada?: string; icon?: string; description?: string; displayOrder?: number; discountExempt?: number }) {
  const db = getDb();
  return db.insert(menuCategories).values(syncInsert({
    name: data.name,
    nameKannada: data.nameKannada || "",
    icon: data.icon || "🍽️",
    description: data.description || "",
    displayOrder: data.displayOrder || 0,
    isActive: 1,
    discountExempt: data.discountExempt ?? 0,
  }));
}

export async function updateMenuCategory(id: number, data: Partial<typeof menuCategories.$inferInsert>) {
  const db = getDb();
  return db.update(menuCategories).set(syncUpdate(data)).where(eq(menuCategories.id, id));
}

export async function deleteMenuCategory(id: number) {
  const db = getDb();
  const deletedAt = new Date().toISOString();
  await db.update(menuItems).set(syncUpdate({ deletedAt, isAvailable: 0 })).where(eq(menuItems.categoryId, id));
  await db.update(menuCategories).set(syncUpdate({ deletedAt, isActive: 0 })).where(eq(menuCategories.id, id));
}

export async function getMenuItemCategoryExemptions(menuItemIds: number[]): Promise<Map<number, boolean>> {
  if (menuItemIds.length === 0) return new Map();
  const db = getDb();
  const rows = await collectInBatches(menuItemIds, (batch) => db
    .select({
      menuItemId: menuItems.id,
      discountExempt: menuCategories.discountExempt,
    })
    .from(menuItems)
    .innerJoin(menuCategories, eq(menuItems.categoryId, menuCategories.id))
    .where(inArray(menuItems.id, batch)));
  const result = new Map<number, boolean>();
  for (const r of rows) {
    result.set(r.menuItemId, r.discountExempt === 1);
  }
  return result;
}

// --- Menu Items ---

export async function getAvailableMenuItems() {
  const db = getDb();
  return db.select({
    id: menuItems.id,
    categoryId: menuItems.categoryId,
    name: menuItems.name,
    nameKannada: menuItems.nameKannada,
    description: menuItems.description,
    price: menuItems.price,
    priceText: menuItems.priceText,
    priceOnRequest: menuItems.priceOnRequest,
    indicativeMinPrice: menuItems.indicativeMinPrice,
    indicativeMaxPrice: menuItems.indicativeMaxPrice,
    priceBasis: menuItems.priceBasis,
    tags: menuItems.tags,
    ingredients: menuItems.ingredients,
    imageUrl: menuItems.imageUrl,
    isAvailable: menuItems.isAvailable,
    displayOrder: menuItems.displayOrder,
    trackInventory: menuItems.trackInventory,
    stockQuantity: menuItems.stockQuantity,
    lowStockThreshold: menuItems.lowStockThreshold,
  }).from(menuItems)
    .innerJoin(menuCategories, eq(menuItems.categoryId, menuCategories.id))
    .where(and(eq(menuItems.isAvailable, 1), eq(menuCategories.isActive, 1), sql`${menuItems.deletedAt} IS NULL`, sql`${menuCategories.deletedAt} IS NULL`))
    .orderBy(menuItems.displayOrder);
}

export async function getMenuItemById(id: number) {
  const db = getDb();
  const rows = await db.select().from(menuItems).where(and(eq(menuItems.id, id), sql`${menuItems.deletedAt} IS NULL`)).limit(1);
  return rows[0] || null;
}

export async function getMenuWithCategories(includeUnavailable = false) {
  const db = getDb();
  const categories = await db.select().from(menuCategories)
    .where(and(eq(menuCategories.isActive, 1), sql`${menuCategories.deletedAt} IS NULL`))
    .orderBy(menuCategories.displayOrder);
  const conditions = includeUnavailable
    ? eq(menuCategories.isActive, 1)
    : and(eq(menuItems.isAvailable, 1), eq(menuCategories.isActive, 1));
  const items = await db.select().from(menuItems)
    .innerJoin(menuCategories, eq(menuItems.categoryId, menuCategories.id))
    .where(and(conditions, sql`${menuItems.deletedAt} IS NULL`, sql`${menuCategories.deletedAt} IS NULL`))
    .orderBy(menuItems.displayOrder);
  return { categories, items: items.map(r => r.menu_items) };
}

export async function getMenuItemsByCategory(categoryId: number) {
  const db = getDb();
  return db.select().from(menuItems)
    .where(and(eq(menuItems.categoryId, categoryId), sql`${menuItems.deletedAt} IS NULL`))
    .orderBy(menuItems.displayOrder);
}

export async function getAllMenuItems() {
  const db = getDb();
  return db.select().from(menuItems).where(sql`${menuItems.deletedAt} IS NULL`).orderBy(menuItems.categoryId, menuItems.displayOrder);
}

export async function getMenuItemTagsByIds(ids: number[]): Promise<Map<number, string>> {
  const map = new Map<number, string>();
  if (ids.length === 0) return map;
  const db = getDb();
  for (const batch of uniqueInBatches(ids)) {
    const rows = await db.select({ id: menuItems.id, tags: menuItems.tags }).from(menuItems).where(inArray(menuItems.id, batch));
    for (const row of rows) map.set(row.id, row.tags || "[]");
  }
  return map;
}

export async function addMenuItem(data: {
  categoryId: number; name: string; nameKannada?: string; description?: string;
  price: number; priceText?: string; tags?: string; ingredients?: string;
  imageUrl?: string; isAvailable?: number; displayOrder?: number;
  trackInventory?: number; stockQuantity?: number; lowStockThreshold?: number;
  priceOnRequest?: number; indicativeMinPrice?: number; indicativeMaxPrice?: number; priceBasis?: string;
}) {
  const db = getDb();
  return db.insert(menuItems).values(syncInsert({
    categoryId: data.categoryId,
    name: data.name,
    nameKannada: data.nameKannada || "",
    description: data.description || "",
    price: data.price,
    priceText: data.priceText || "",
    priceOnRequest: data.priceOnRequest ?? 0,
    indicativeMinPrice: data.indicativeMinPrice ?? 0,
    indicativeMaxPrice: data.indicativeMaxPrice ?? 0,
    priceBasis: data.priceBasis || "per portion",
    tags: data.tags || "[]",
    ingredients: data.ingredients || "[]",
    imageUrl: data.imageUrl || "",
    isAvailable: data.isAvailable ?? 1,
    displayOrder: data.displayOrder || 0,
    trackInventory: data.trackInventory ?? 0,
    stockQuantity: data.stockQuantity ?? 0,
    lowStockThreshold: data.lowStockThreshold ?? 5,
  }));
}

export async function updateMenuItem(id: number, data: Partial<typeof menuItems.$inferInsert>) {
  const db = getDb();
  return db.update(menuItems).set(syncUpdate(data)).where(eq(menuItems.id, id));
}

export async function deleteMenuItem(id: number) {
  const db = getDb();
  return db.update(menuItems).set(syncUpdate({ deletedAt: new Date().toISOString(), isAvailable: 0 })).where(eq(menuItems.id, id));
}

export async function toggleMenuItemAvailability(id: number, isAvailable: number) {
  const db = getDb();
  return db.update(menuItems).set(syncUpdate({ isAvailable })).where(eq(menuItems.id, id));
}

// --- Food Orders ---

export async function createFoodOrder(data: {
  orderNumber: string; idempotencyKey?: string; guestType: string;
  checkinId?: number; guestName: string; guestPhone?: string;
  roomInfo?: string; tableNumber?: string; specialInstructions?: string;
  subtotal: number; tax: number; total: number;
  status?: string; paymentStatus?: string; createdBy?: string;
}) {
  const db = getDb();
  const now = new Date().toISOString();
  return db.insert(foodOrders).values(syncInsert({
    orderNumber: data.orderNumber,
    idempotencyKey: data.idempotencyKey || null,
    guestType: data.guestType,
    checkinId: data.checkinId,
    guestName: data.guestName,
    guestPhone: data.guestPhone || "",
    roomInfo: data.roomInfo || "",
    tableNumber: data.tableNumber || "",
    specialInstructions: data.specialInstructions || "",
    subtotal: data.subtotal,
    tax: data.tax,
    total: data.total,
    status: data.status || "placed",
    paymentStatus: data.paymentStatus || "pending",
    createdBy: data.createdBy || "guest",
    createdAt: now,
    updatedAt: now,
  })).returning();
}

export async function addFoodOrderItems(items: Array<{
  orderId: number; menuItemId: number; itemName: string;
  itemPrice: number; quantity: number; lineTotal: number; pricingStatus?: string; notes?: string;
}>) {
  const db = getDb();
  return db.insert(foodOrderItems).values(items.map((item) => syncInsert(item)));
}

export async function getFoodOrdersByStatus(status: string) {
  const db = getDb();
  return db.select().from(foodOrders)
    .where(eq(foodOrders.status, status))
    .orderBy(foodOrders.createdAt);
}

export async function getActiveFoodOrders() {
  const db = getDb();
  return db.select().from(foodOrders)
    .where(inArray(foodOrders.status, ["pending_approval", "placed", "preparing", "ready"]))
    .orderBy(foodOrders.createdAt);
}

export async function getFoodOrderById(id: number) {
  const db = getDb();
  const rows = await db.select().from(foodOrders).where(eq(foodOrders.id, id)).limit(1);
  return rows[0] || null;
}

export async function getFoodOrderByNumber(orderNumber: string) {
  const db = getDb();
  const rows = await db.select().from(foodOrders).where(eq(foodOrders.orderNumber, orderNumber)).limit(1);
  return rows[0] || null;
}

export async function getFoodOrderByIdempotencyKey(key: string) {
  const db = getDb();
  if (!key) return null;
  const rows = await db.select().from(foodOrders).where(eq(foodOrders.idempotencyKey, key)).limit(1);
  return rows[0] || null;
}

export async function getFoodOrderItems(orderId: number) {
  const db = getDb();
  return db.select().from(foodOrderItems).where(eq(foodOrderItems.orderId, orderId));
}

export async function getFoodOrderItemsBatch(orderIds: number[]) {
  if (orderIds.length === 0) return new Map<number, Awaited<ReturnType<typeof getFoodOrderItems>>>();
  const db = getDb();
  const grouped = new Map<number, Awaited<ReturnType<typeof getFoodOrderItems>>>();
  for (const batch of uniqueInBatches(orderIds)) {
    const items = await db.select().from(foodOrderItems).where(inArray(foodOrderItems.orderId, batch));
    for (const item of items) {
      const list = grouped.get(item.orderId) || [];
      list.push(item);
      grouped.set(item.orderId, list);
    }
  }
  return grouped;
}

export async function areAllOrderItemsInventory(orderId: number): Promise<boolean> {
  const db = getDb();
  const rows = await db
    .select({ trackInventory: menuItems.trackInventory })
    .from(foodOrderItems)
    .innerJoin(menuItems, eq(foodOrderItems.menuItemId, menuItems.id))
    .where(and(
      eq(foodOrderItems.orderId, orderId),
      sql`${foodOrderItems.status} != 'voided'`
    ));
  if (rows.length === 0) return false;
  return rows.every((r) => !!r.trackInventory);
}

export async function updateFoodOrderStatus(id: number, status: string, cancelledReason?: string) {
  const db = getDb();
  const data: any = { status, updatedAt: new Date().toISOString() };
  if (status === "cancelled") {
    data.cancelledAt = new Date().toISOString();
    if (cancelledReason) data.cancelledReason = cancelledReason;
  }
  return db.update(foodOrders).set(syncUpdate(data)).where(eq(foodOrders.id, id));
}

export async function updateFoodOrderPayment(id: number, data: {
  paymentStatus: string; paymentMethod?: string; paidBy?: string;
  cashReceived?: number; changeGiven?: number;
}) {
  const db = getDb();
  return db.update(foodOrders).set(syncUpdate({
    paymentStatus: data.paymentStatus,
    paymentMethod: data.paymentMethod || "",
    paidBy: data.paidBy || "",
    cashReceived: data.cashReceived ?? 0,
    changeGiven: data.changeGiven ?? 0,
    updatedAt: new Date().toISOString(),
  })).where(eq(foodOrders.id, id));
}

export async function getGuestFoodTab(checkinId: number) {
  const db = getDb();
  const rows = await db.select().from(foodOrders)
    .where(and(
      eq(foodOrders.checkinId, checkinId),
      sql`${foodOrders.status} != 'cancelled'`,
    ))
    .orderBy(foodOrders.createdAt);
  return rows.filter((order) => foodDue(order) > 0);
}

export async function getGuestAllFoodOrders(checkinId: number) {
  const db = getDb();
  return db.select().from(foodOrders)
    .where(eq(foodOrders.checkinId, checkinId))
    .orderBy(desc(foodOrders.createdAt));
}

export async function getCheckinDeleteInfo(checkinId: number) {
  const orders = await getGuestAllFoodOrders(checkinId);
  return orders.map((order) => ({
    orderNumber: order.orderNumber,
    total: order.total,
    status: order.status,
    paymentStatus: order.paymentStatus,
    createdAt: order.createdAt,
  }));
}

export async function getFoodOrderHistory(limit = 100, offset = 0) {
  const db = getDb();
  return db.select().from(foodOrders)
    .orderBy(desc(foodOrders.createdAt))
    .limit(limit)
    .offset(offset);
}

export async function getNextOrderNumber() {
  const db = getDb();
  const istDate = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
  const dayOfYear = Math.floor((istDate.getTime() - new Date(istDate.getFullYear(), 0, 0).getTime()) / 86400000);
  const prefix = `D${dayOfYear}`;

  const rows = await db.select({
    maxNum: sql<number>`COALESCE(MAX(CAST(SUBSTR(${foodOrders.orderNumber}, ${prefix.length + 2}) AS INTEGER)), 0)`
  }).from(foodOrders)
    .where(sql`${foodOrders.orderNumber} LIKE ${prefix + '-%'}`);

  const next = (rows[0]?.maxNum || 0) + 1;
  return `${prefix}-${String(next).padStart(2, "0")}`;
}

// --- Order Modifications ---

export async function addOrderModification(data: {
  orderId: number; action: string; itemId?: number;
  oldValue?: string; newValue?: string; reason?: string; modifiedBy: string;
}) {
  const db = getDb();
  return db.insert(orderModifications).values(syncInsert({
    orderId: data.orderId,
    action: data.action,
    itemId: data.itemId,
    oldValue: data.oldValue || "",
    newValue: data.newValue || "",
    reason: data.reason || "",
    modifiedBy: data.modifiedBy,
    createdAt: new Date().toISOString(),
  }));
}

export async function getOrderModifications(orderId: number) {
  const db = getDb();
  return db.select().from(orderModifications)
    .where(eq(orderModifications.orderId, orderId))
    .orderBy(desc(orderModifications.id));
}

// --- Tab Helpers ---

export async function getGuestTabTotal(checkinId: number): Promise<number> {
  const db = getDb();
  const rows = await db.select().from(foodOrders)
    .where(and(
      eq(foodOrders.checkinId, checkinId),
      sql`${foodOrders.status} != 'cancelled'`,
    ));
  return rows.reduce((sum, order) => sum + foodDue(order), 0);
}

export async function getFoodOrdersByCheckinIds(checkinIds: number[]) {
  const db = getDb();
  if (checkinIds.length === 0) return [];
  const rows = await collectInBatches(checkinIds, (batch) => db.select().from(foodOrders)
    .where(and(
      inArray(foodOrders.checkinId, batch),
      sql`${foodOrders.status} != 'cancelled'`,
    ))
    .orderBy(foodOrders.createdAt));
  return rows.filter((order) => foodDue(order) > 0).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

// --- Food bill share tokens (Cloudflare-only) ---

export async function createFoodBillShareToken(data: {
  token: string; phone: string; checkinId?: number | null; expiresAt: string; createdBy: string;
}) {
  const db = getDb();
  return db.insert(foodBillShareTokens).values({
    token: data.token,
    phone: data.phone,
    checkinId: data.checkinId ?? null,
    expiresAt: data.expiresAt,
    createdBy: data.createdBy,
    createdAt: new Date().toISOString(),
  });
}

export async function getValidFoodBillShareToken(token: string) {
  const db = getDb();
  const now = new Date().toISOString();
  const rows = await db.select().from(foodBillShareTokens)
    .where(and(eq(foodBillShareTokens.token, token), gte(foodBillShareTokens.expiresAt, now)))
    .limit(1);
  return rows[0] || null;
}

export async function updateFoodOrder(id: number, data: Partial<typeof foodOrders.$inferInsert>) {
  const db = getDb();
  return db.update(foodOrders).set(syncUpdate({
    ...data,
    updatedAt: new Date().toISOString(),
  })).where(eq(foodOrders.id, id));
}

export async function deleteFoodOrderItem(id: number) {
  const db = getDb();
  return db.delete(foodOrderItems).where(eq(foodOrderItems.id, id));
}

export async function updateFoodOrderItemQuantity(orderItemId: number, newQuantity: number, itemPrice: number) {
  const db = getDb();
  return db.update(foodOrderItems).set(syncUpdate({
    quantity: newQuantity,
    lineTotal: newQuantity * itemPrice,
  })).where(eq(foodOrderItems.id, orderItemId));
}

// --- Active Checkins for Food Lookup ---

export async function getActiveCheckins() {
  const db = getDb();
  return db.select().from(checkins).where(eq(checkins.status, "active"));
}

export async function getRecentlyCheckedOutGuests(graceDays: number) {
  if (graceDays <= 0) return [];
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - graceDays);
  const cutoffStr = cutoff.toISOString();
  const db = getDb();
  return db.select().from(checkins).where(
    and(
      eq(checkins.status, "checked_out"),
      sql`${checkins.checkedOutAt} >= ${cutoffStr}`
    )
  );
}

// --- Inventory ---

export async function decrementStock(menuItemId: number, quantity: number) {
  const db = getDb();
  const item = await db.select().from(menuItems).where(eq(menuItems.id, menuItemId)).limit(1);
  if (!item[0] || !item[0].trackInventory) return;

  await db.update(menuItems).set({
    stockQuantity: sql`MAX(0, ${menuItems.stockQuantity} - ${quantity})`,
    isAvailable: sql`CASE WHEN ${menuItems.stockQuantity} - ${quantity} <= 0 THEN 0 ELSE ${menuItems.isAvailable} END`,
  }).where(eq(menuItems.id, menuItemId));
}

/** Atomically reserves tracked inventory for an order edit or kitchen add. */
export async function decrementStockIfAvailable(menuItemId: number, quantity: number): Promise<boolean> {
  if (!Number.isInteger(quantity) || quantity <= 0) return true;
  const db = getDb();
  const updated = await db.update(menuItems).set({
    stockQuantity: sql`${menuItems.stockQuantity} - ${quantity}`,
    isAvailable: sql`CASE WHEN ${menuItems.stockQuantity} - ${quantity} <= 0 THEN 0 ELSE ${menuItems.isAvailable} END`,
  }).where(and(
    eq(menuItems.id, menuItemId),
    eq(menuItems.trackInventory, 1),
    sql`${menuItems.stockQuantity} >= ${quantity}`,
  )).returning({ id: menuItems.id });
  return updated.length > 0;
}

export async function addStock(menuItemId: number, quantity: number) {
  const db = getDb();
  await db.update(menuItems).set({
    stockQuantity: sql`${menuItems.stockQuantity} + ${quantity}`,
    isAvailable: 1,
  }).where(eq(menuItems.id, menuItemId));
}

export async function restoreStock(orderId: number) {
  const db = getDb();
  const items = await db.select().from(foodOrderItems)
    .where(and(eq(foodOrderItems.orderId, orderId), sql`${foodOrderItems.status} != 'voided'`));

  for (const item of items) {
    await db.update(menuItems).set({
      stockQuantity: sql`${menuItems.stockQuantity} + ${item.quantity}`,
      isAvailable: 1,
    }).where(
      and(eq(menuItems.id, item.menuItemId), eq(menuItems.trackInventory, 1))
    );
  }
}

export async function getLowStockItems() {
  const db = getDb();
  return db.select().from(menuItems)
    .where(and(
      eq(menuItems.trackInventory, 1),
      sql`${menuItems.deletedAt} IS NULL`,
      sql`${menuItems.stockQuantity} <= ${menuItems.lowStockThreshold}`
    ))
    .orderBy(menuItems.stockQuantity);
}

// --- Expenses ---

export async function addExpense(data: {
  amount: number; category: string; customCategory?: string; purpose: string;
  billImageLink?: string; createdBy: string; expenseDate: string; createdMonth: string;
  vendorId?: number | null; accountId?: number | null; paymentMethod?: string;
  mainCategory?: string; subCategory?: string; taskId?: number | null;
}) {
  const db = getDb();
  const now = new Date().toISOString();
  const result = await db.insert(expenses).values(syncInsert({ ...data, createdAt: now, updatedAt: now })).returning({ id: expenses.id });
  return result[0]?.id ?? null;
}

export async function getExpenseById(id: number) {
  const db = getDb();
  const rows = await db.select().from(expenses).where(eq(expenses.id, id)).limit(1);
  return rows[0] || null;
}

export async function getExpensesByMonth(month: string) {
  const db = getDb();
  return db.select().from(expenses).where(eq(expenses.createdMonth, month)).orderBy(desc(expenses.id));
}

export async function getExpensesByUser(username: string, days: number) {
  const db = getDb();
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  return db.select().from(expenses)
    .where(and(eq(expenses.createdBy, username), sql`${expenses.createdAt} >= ${cutoff}`))
    .orderBy(desc(expenses.id));
}

export async function updateExpense(id: number, data: {
  amount?: number; category?: string; customCategory?: string; purpose?: string; billImageLink?: string;
  expenseDate?: string; createdMonth?: string; vendorId?: number | null; accountId?: number | null;
  paymentMethod?: string; mainCategory?: string; subCategory?: string; updatedBy: string;
}) {
  const db = getDb();
  return db.update(expenses).set(syncUpdate({ ...data, updatedAt: new Date().toISOString() })).where(eq(expenses.id, id));
}

export async function deleteExpense(id: number) {
  const db = getDb();
  return db.delete(expenses).where(eq(expenses.id, id));
}

export async function getExpenseMonths(): Promise<string[]> {
  const db = getDb();
  const rows = await db.selectDistinct({ month: expenses.createdMonth }).from(expenses).orderBy(desc(expenses.createdMonth));
  return rows.map((r) => r.month);
}

// --- Review Funnel ---

export async function createReviewRequest(data: {
  token: string; checkinId: number; guestName: string; guestContact: string;
  propertyId?: string; bookingId?: string;
}) {
  const db = getDb();
  return db.insert(reviewRequests).values({
    ...data,
    createdAt: new Date().toISOString(),
  });
}

export async function getReviewRequestByToken(token: string) {
  const db = getDb();
  const rows = await db.select().from(reviewRequests).where(and(eq(reviewRequests.token, token), sql`${reviewRequests.deletedAt} IS NULL`)).limit(1);
  return rows[0] || null;
}

export async function getReviewRequestByCheckinId(checkinId: number) {
  const db = getDb();
  const rows = await db.select().from(reviewRequests).where(and(eq(reviewRequests.checkinId, checkinId), sql`${reviewRequests.deletedAt} IS NULL`)).limit(1);
  return rows[0] || null;
}

export async function recordWhatsAppSent(id: number) {
  const db = getDb();
  const now = new Date().toISOString();
  return db.update(reviewRequests).set({
    whatsappSentCount: sql`${reviewRequests.whatsappSentCount} + 1`,
    whatsappLastSentAt: now,
  }).where(eq(reviewRequests.id, id));
}

export async function submitReviewRating(token: string, rating: number) {
  const db = getDb();
  const now = new Date().toISOString();
  return db.update(reviewRequests).set({
    rating,
    ratedAt: now,
    redirectedToGoogle: rating >= 4 ? 1 : 0,
  }).where(eq(reviewRequests.token, token));
}

export async function submitReviewFeedback(data: {
  reviewRequestId: number; rating: number; improvementAreas: string[]; comments: string;
}) {
  const db = getDb();
  return db.insert(reviewFeedback).values({
    reviewRequestId: data.reviewRequestId,
    rating: data.rating,
    improvementAreas: JSON.stringify(data.improvementAreas),
    comments: data.comments,
    submittedAt: new Date().toISOString(),
  });
}

export async function getReviewRequestsForAdmin(filters: { fromDate?: string; toDate?: string; property?: string }) {
  const db = getDb();
  const conditions = [sql`${reviewRequests.deletedAt} IS NULL`];
  if (filters.fromDate) conditions.push(gte(reviewRequests.createdAt, filters.fromDate));
  if (filters.toDate) conditions.push(lte(reviewRequests.createdAt, filters.toDate + "T23:59:59"));
  if (filters.property) conditions.push(eq(reviewRequests.propertyId, filters.property));
  return db.select().from(reviewRequests).where(and(...conditions)).orderBy(desc(reviewRequests.createdAt));
}

export async function getReviewFeedbackList(filters: { fromDate?: string; toDate?: string; property?: string; rating?: number; improvementArea?: string }) {
  const db = getDb();
  const conditions: any[] = [sql`${reviewFeedback.deletedAt} IS NULL`];
  if (filters.fromDate) conditions.push(gte(reviewFeedback.submittedAt, filters.fromDate));
  if (filters.toDate) conditions.push(lte(reviewFeedback.submittedAt, filters.toDate + "T23:59:59"));
  if (filters.rating != null) conditions.push(eq(reviewFeedback.rating, filters.rating));
  if (filters.property) conditions.push(eq(reviewRequests.propertyId, filters.property));

  const rows = await db
    .select({
      id: reviewFeedback.id,
      reviewRequestId: reviewFeedback.reviewRequestId,
      rating: reviewFeedback.rating,
      improvementAreas: reviewFeedback.improvementAreas,
      comments: reviewFeedback.comments,
      submittedAt: reviewFeedback.submittedAt,
      guestName: reviewRequests.guestName,
      guestContact: reviewRequests.guestContact,
      propertyId: reviewRequests.propertyId,
      bookingId: reviewRequests.bookingId,
    })
    .from(reviewFeedback)
    .innerJoin(reviewRequests, eq(reviewFeedback.reviewRequestId, reviewRequests.id))
    .where(and(...conditions))
    .orderBy(desc(reviewFeedback.submittedAt));

  if (filters.improvementArea) {
    return rows.filter((r) => {
      try {
        const areas: string[] = JSON.parse(r.improvementAreas || "[]");
        return areas.includes(filters.improvementArea!);
      } catch { return false; }
    });
  }
  return rows;
}

export async function getReviewAnalytics(filters: { fromDate?: string; toDate?: string; property?: string }) {
  const db = getDb();
  const conditions = [sql`${reviewRequests.deletedAt} IS NULL`];
  if (filters.fromDate) conditions.push(gte(reviewRequests.createdAt, filters.fromDate));
  if (filters.toDate) conditions.push(lte(reviewRequests.createdAt, filters.toDate + "T23:59:59"));
  if (filters.property) conditions.push(eq(reviewRequests.propertyId, filters.property));

  const allRequests = await db.select().from(reviewRequests).where(and(...conditions));

  const totalSent = allRequests.filter((r) => (r.whatsappSentCount || 0) > 0).length;
  const totalRated = allRequests.filter((r) => r.rating !== null).length;
  const googleRedirects = allRequests.filter((r) => r.redirectedToGoogle === 1).length;
  const ratingDist = [0, 0, 0, 0, 0];
  for (const r of allRequests) {
    if (r.rating && r.rating >= 1 && r.rating <= 5) ratingDist[r.rating - 1]++;
  }

  const feedbackConditions: any[] = [sql`${reviewFeedback.deletedAt} IS NULL`];
  if (filters.fromDate) feedbackConditions.push(gte(reviewFeedback.submittedAt, filters.fromDate));
  if (filters.toDate) feedbackConditions.push(lte(reviewFeedback.submittedAt, filters.toDate + "T23:59:59"));
  if (filters.property) feedbackConditions.push(eq(reviewRequests.propertyId, filters.property));
  const feedbackRows = await db.select({ improvementAreas: reviewFeedback.improvementAreas })
    .from(reviewFeedback)
    .innerJoin(reviewRequests, eq(reviewFeedback.reviewRequestId, reviewRequests.id))
    .where(and(...feedbackConditions));

  const improvementCounts: Record<string, number> = {};
  for (const f of feedbackRows) {
    try {
      const areas: string[] = JSON.parse(f.improvementAreas || "[]");
      for (const area of areas) improvementCounts[area] = (improvementCounts[area] || 0) + 1;
    } catch {}
  }

  return {
    totalRequests: allRequests.length,
    totalSent,
    totalRated,
    googleRedirects,
    feedbackSubmissions: feedbackRows.length,
    responseRate: totalSent > 0 ? Math.round((totalRated / totalSent) * 100) : 0,
    ratingDistribution: ratingDist,
    improvementAreas: improvementCounts,
  };
}

// --- Channel Manager ---

/** Public routing needs only these fields, never integration credentials. */
export async function getGuestBookingConfig() {
  const db = getDb();
  const rows = await db.select({
    bookingEngineUrl: channelConfig.bookingEngineUrl,
    apiBaseUrl: channelConfig.apiBaseUrl,
  }).from(channelConfig).limit(1);
  return rows[0] || null;
}

export async function getChannelConfig() {
  const db = getDb();
  const rows = await db.select().from(channelConfig).limit(1);
  return rows[0] || null;
}

export async function upsertChannelConfig(data: {
  provider?: string; hotelCode: string; pmsId: string; apiBaseUrl: string;
  apiUsername: string; apiPassword: string; webhookSecret?: string;
  bookingEngineUrl?: string; isActive?: number; autoPushInventory?: number;
  autoPushRates?: number; autoPushRateRestrictions?: number; autoPushInvRestrictions?: number;
}) {
  const db = getDb();
  const existing = await getChannelConfig();
  if (existing) {
    return db.update(channelConfig).set({
      ...data,
      isActive: data.isActive ?? existing.isActive,
    }).where(eq(channelConfig.id, existing.id));
  }
  return db.insert(channelConfig).values({
    ...data,
    provider: data.provider || "aiosell",
    webhookSecret: data.webhookSecret || "",
    bookingEngineUrl: data.bookingEngineUrl || "",
    isActive: data.isActive ?? 0,
    createdAt: new Date().toISOString(),
  });
}

export async function updateChannelSyncTime() {
  const db = getDb();
  const config = await getChannelConfig();
  if (config) {
    await db.update(channelConfig).set({ lastSyncAt: new Date().toISOString() }).where(eq(channelConfig.id, config.id));
  }
}

export async function getRoomTypeMappings() {
  const db = getDb();
  return db.select().from(roomTypeMapping).orderBy(roomTypeMapping.dormName);
}

export async function upsertRoomTypeMapping(data: {
  id?: number; dormId: number; dormName?: string; channelRoomCode: string;
  totalInventory: number; isActive?: number;
}) {
  const db = getDb();
  const code = (data.channelRoomCode || "").trim();
  if (!data.dormId || !code) {
    throw new Error("Dorm and Aiosell room code are required");
  }
  const dormRows = await db.select().from(dorms).where(eq(dorms.id, data.dormId)).limit(1);
  if (dormRows.length === 0) {
    throw new Error(`No dorm with id ${data.dormId}. Pick a dorm from the list.`);
  }
  const dormName = dormRows[0].name;
  const isActive = data.isActive ?? 1;
  const inventory = Number(data.totalInventory);
  const totalInventory = Number.isFinite(inventory) && inventory >= 0 ? Math.floor(inventory) : 0;

  const sameCode = await db.select().from(roomTypeMapping).where(eq(roomTypeMapping.channelRoomCode, code));
  const clash = sameCode.find((r) => r.dormId !== data.dormId);
  if (clash) {
    throw new Error(`Aiosell code "${code}" is already mapped to ${clash.dormName}`);
  }

  if (data.id) {
    return db.update(roomTypeMapping).set({
      dormId: data.dormId,
      dormName,
      channelRoomCode: code,
      totalInventory,
      isActive,
    }).where(eq(roomTypeMapping.id, data.id));
  }

  const existing = await db.select().from(roomTypeMapping).where(eq(roomTypeMapping.dormId, data.dormId)).limit(1);
  if (existing[0]) {
    return db.update(roomTypeMapping).set({
      dormName,
      channelRoomCode: code,
      totalInventory,
      isActive,
    }).where(eq(roomTypeMapping.id, existing[0].id));
  }

  // D1 rejects Drizzle's `id = null` on AUTOINCREMENT PKs — omit the column.
  return db.run(sql`
    INSERT INTO room_type_mapping (dorm_id, dorm_name, channel_room_code, total_inventory, is_active)
    VALUES (${data.dormId}, ${dormName}, ${code}, ${totalInventory}, ${isActive})
  `);
}

export async function deleteRoomTypeMapping(id: number) {
  const db = getDb();
  const plans = await db.select().from(ratePlanMapping).where(eq(ratePlanMapping.roomMappingId, id));
  for (const plan of plans) {
    await db.delete(dailyRates).where(eq(dailyRates.ratePlanId, plan.id));
    await db.delete(channelRates).where(eq(channelRates.ratePlanId, plan.id));
  }
  await db.delete(ratePlanMapping).where(eq(ratePlanMapping.roomMappingId, id));
  return db.delete(roomTypeMapping).where(eq(roomTypeMapping.id, id));
}

export async function getRatePlanMappings(roomMappingId?: number) {
  const db = getDb();
  if (roomMappingId) {
    return db.select().from(ratePlanMapping).where(eq(ratePlanMapping.roomMappingId, roomMappingId));
  }
  return db.select().from(ratePlanMapping);
}

export async function upsertRatePlanMapping(data: {
  id?: number; roomMappingId: number; ratePlanCode: string;
  ratePlanName: string; isActive?: number;
}) {
  const db = getDb();
  const room = await db.select({ id: roomTypeMapping.id }).from(roomTypeMapping).where(eq(roomTypeMapping.id, data.roomMappingId)).limit(1);
  if (!room[0]) {
    throw new Error("Map the room first");
  }
  if (data.id) {
    return db.update(ratePlanMapping).set({
      roomMappingId: data.roomMappingId,
      ratePlanCode: data.ratePlanCode,
      ratePlanName: data.ratePlanName,
      isActive: data.isActive ?? 1,
    }).where(eq(ratePlanMapping.id, data.id));
  }
  return db.run(sql`
    INSERT INTO rate_plan_mapping (room_mapping_id, rate_plan_code, rate_plan_name, is_active)
    VALUES (${data.roomMappingId}, ${data.ratePlanCode}, ${data.ratePlanName}, ${data.isActive ?? 1})
  `);
}

export async function deleteRatePlanMapping(id: number) {
  const db = getDb();
  await db.delete(dailyRates).where(eq(dailyRates.ratePlanId, id));
  return db.delete(ratePlanMapping).where(eq(ratePlanMapping.id, id));
}

export async function getDailyRates(ratePlanId: number, startDate: string, endDate: string) {
  const db = getDb();
  return db.select().from(dailyRates).where(
    and(
      eq(dailyRates.ratePlanId, ratePlanId),
      gte(dailyRates.date, startDate),
      lte(dailyRates.date, endDate)
    )
  ).orderBy(dailyRates.date);
}

export async function getAllDailyRates(startDate: string, endDate: string) {
  const db = getDb();
  return db.select().from(dailyRates).where(
    and(gte(dailyRates.date, startDate), lte(dailyRates.date, endDate))
  ).orderBy(dailyRates.date);
}

export async function upsertDailyRate(data: {
  ratePlanId: number; date: string; rate: number;
  stopSell?: number; minimumStay?: number; maximumStay?: number | null;
  closeOnArrival?: number; closeOnDeparture?: number;
  minimumAdvanceReservation?: number | null; maximumAdvanceReservation?: number | null;
  adult1Rate?: number | null; adult2Rate?: number | null;
  childRate?: number | null; infantRate?: number | null; extraPersonRate?: number | null;
  updatedBy?: string;
}) {
  const db = getDb();
  const now = new Date().toISOString();
  const existing = await db.select().from(dailyRates).where(
    and(eq(dailyRates.ratePlanId, data.ratePlanId), eq(dailyRates.date, data.date))
  ).limit(1);

  const setFields: any = {
    rate: data.rate,
    stopSell: data.stopSell ?? 0,
    minimumStay: data.minimumStay ?? 1,
    maximumStay: data.maximumStay,
    closeOnArrival: data.closeOnArrival ?? 0,
    closeOnDeparture: data.closeOnDeparture ?? 0,
    minimumAdvanceReservation: data.minimumAdvanceReservation,
    maximumAdvanceReservation: data.maximumAdvanceReservation,
    updatedBy: data.updatedBy || "",
    updatedAt: now,
  };
  if (data.adult1Rate !== undefined) setFields.adult1Rate = data.adult1Rate;
  if (data.adult2Rate !== undefined) setFields.adult2Rate = data.adult2Rate;
  if (data.childRate !== undefined) setFields.childRate = data.childRate;
  if (data.infantRate !== undefined) setFields.infantRate = data.infantRate;
  if (data.extraPersonRate !== undefined) setFields.extraPersonRate = data.extraPersonRate;

  if (existing.length > 0) {
    return db.update(dailyRates).set(setFields).where(eq(dailyRates.id, existing[0].id));
  }
  return db.insert(dailyRates).values({
    ratePlanId: data.ratePlanId,
    date: data.date,
    ...setFields,
    maximumStay: data.maximumStay ?? null,
    minimumAdvanceReservation: data.minimumAdvanceReservation ?? null,
    maximumAdvanceReservation: data.maximumAdvanceReservation ?? null,
    syncedAt: "",
  });
}

export async function bulkUpsertDailyRates(rates: Array<{
  ratePlanId: number; date: string; rate: number;
  stopSell?: number; minimumStay?: number; maximumStay?: number | null;
  closeOnArrival?: number; closeOnDeparture?: number;
  updatedBy?: string;
}>) {
  let count = 0;
  for (const r of rates) {
    await upsertDailyRate(r);
    count++;
  }
  return count;
}

export async function markRatesSynced(ratePlanId: number, startDate: string, endDate: string) {
  const db = getDb();
  const now = new Date().toISOString();
  return db.update(dailyRates).set({ syncedAt: now }).where(
    and(
      eq(dailyRates.ratePlanId, ratePlanId),
      gte(dailyRates.date, startDate),
      lte(dailyRates.date, endDate)
    )
  );
}

export async function addChannelSyncLog(data: {
  direction: string; type: string; status: string;
  requestPayload?: string; responsePayload?: string;
  errorMessage?: string; recordsAffected?: number;
  httpMethod?: string; url?: string; httpStatus?: number; durationMs?: number;
}) {
  try {
    const db = getDb();
    await db.insert(channelSyncLog).values({
      direction: data.direction,
      type: data.type,
      status: data.status,
      requestPayload: data.requestPayload || "",
      responsePayload: data.responsePayload || "",
      errorMessage: data.errorMessage || "",
      recordsAffected: data.recordsAffected || 0,
      createdAt: new Date().toISOString(),
      httpMethod: data.httpMethod || "",
      url: data.url || "",
      httpStatus: data.httpStatus ?? null,
      durationMs: data.durationMs ?? null,
    });
  } catch (err) {
    // Never throw — logging must not break PMS calls. Surface the miss so a missing 0036 is obvious.
    console.error("channel_sync_log write failed:", err instanceof Error ? err.message : err);
    return;
  }
  try {
    await pruneChannelSyncLogs();
  } catch (err) {
    console.error("channel_sync_log prune failed:", err instanceof Error ? err.message : err);
  }
}

async function pruneChannelSyncLogs() {
  const db = getDb();
  await db.delete(channelSyncLog).where(lt(channelSyncLog.createdAt, logRetentionSince()));
}

export async function getChannelSyncLogs(
  limit = 50,
  filters?: { direction?: string; type?: string; status?: string; since?: string; offset?: number },
) {
  await pruneChannelSyncLogs().catch(() => {});
  const pageSize = clampLogPageSize(limit, LOG_DOWNLOAD_MAX);
  const db = getDb();
  const conditions = [gte(channelSyncLog.createdAt, clampLogSince(filters?.since))];
  if (filters?.direction) conditions.push(eq(channelSyncLog.direction, filters.direction));
  if (filters?.type) {
    // "inventory" also matches "inventory (auto)"; "fetch" matches "fetch (rates)"
    const prefix = sqliteLikePrefix(filters.type);
    conditions.push(or(
      eq(channelSyncLog.type, filters.type),
      sql`${channelSyncLog.type} LIKE ${prefix} ESCAPE '\\'`,
    )!);
  }
  if (filters?.status) conditions.push(eq(channelSyncLog.status, filters.status));
  const where = and(...conditions);
  const [countRow] = await db.select({ n: sql<number>`count(*)` }).from(channelSyncLog).where(where);
  const total = Number(countRow?.n ?? 0);
  const offset = clampLogOffset(total, pageSize, filters?.offset ?? 0);
  const logs = await db.select().from(channelSyncLog).where(where).orderBy(desc(channelSyncLog.id)).limit(pageSize).offset(offset);
  return { logs, total };
}

export async function getAvailableBedsForDorm(dormId: number): Promise<number> {
  const db = getDb();
  const rows = await db.select().from(beds).where(
    and(eq(beds.dormId, dormId), eq(beds.status, "available"))
  );
  return rows.length;
}

// --- Booking Dashboard Queries ---

export async function getBookingCalendarData(startDate: string, endDate: string) {
  return dbRead(async () => {
    const db = getDb();
    // endDate is the last visible night (inclusive), not an exclusive checkout.
    let bookingRows = await db.select().from(bookings).where(
      and(
        sql`${bookings.checkinDate} <= ${endDate}`,
        sql`${bookings.checkoutDate} > ${startDate}`,
        sql`${bookings.status} != 'cancelled'`
      )
    );

    const assignments = await db.select().from(bookingBedAssignments).where(
      and(
        eq(bookingBedAssignments.status, "assigned"),
        sql`${bookingBedAssignments.checkoutDate} > ${bookingBedAssignments.checkinDate}`,
        sql`${bookingBedAssignments.checkinDate} <= ${endDate}`,
        sql`${bookingBedAssignments.checkoutDate} > ${startDate}`
      )
    );

    // Assignments can exist when the booking row was dropped (empty checkout, etc.).
    // Without these rows the calendar skips the tile (`if (!booking) continue`).
    const have = new Set(bookingRows.map((b) => b.id));
    const missing = [...new Set(assignments.map((a) => a.bookingId))].filter((id) => !have.has(id));
    if (missing.length > 0) {
      const extra = await collectInBatches(missing, (batch) => db.select().from(bookings).where(inArray(bookings.id, batch)));
      bookingRows = bookingRows.concat(extra);
    }

    return { bookings: bookingRows, assignments };
  });
}

export async function getBookingTableData(
  startDate: string,
  endDate: string,
  options: { page?: number; pageSize?: number; status?: string; query?: string } = {},
) {
  return dbRead(async () => {
    const db = getDb();
    const page = Math.max(0, Math.floor(options.page ?? 0));
    const pageSize = Math.min(100, Math.max(1, Math.floor(options.pageSize ?? 50)));
    const query = options.query?.trim();
    const overlap = [
      sql`${bookings.checkinDate} <= ${endDate}`,
      or(
        sql`${bookings.checkoutDate} > ${startDate}`,
        and(
          sql`${bookings.status} IN ('checked_out', 'no_show', 'cancelled')`,
          sql`(${bookings.checkoutDate} IS NULL OR ${bookings.checkoutDate} = '' OR ${bookings.checkoutDate} >= ${startDate})`,
        ),
      ),
      query
        ? sql`(${bookings.guestName} LIKE ${`%${query}%`} OR ${bookings.bookingRef} LIKE ${`%${query}%`} OR ${bookings.gokoBookingId} LIKE ${`%${query}%`} OR ${bookings.contact} LIKE ${`%${query}%`})`
        : undefined,
    ];
    const baseWhere = and(...overlap);
    const where = and(baseWhere, options.status ? eq(bookings.status, options.status) : undefined);

    const [rows, totalRows, statusRows] = await Promise.all([
      db.select().from(bookings)
        .where(where)
        .orderBy(desc(bookings.checkinDate), desc(bookings.id))
        .limit(pageSize)
        .offset(page * pageSize),
      db.select({ total: sql<number>`count(*)` }).from(bookings).where(where),
      db.select({ status: bookings.status, total: sql<number>`count(*)` })
        .from(bookings)
        .where(baseWhere)
        .groupBy(bookings.status),
    ]);

    return {
      bookings: rows,
      total: Number(totalRows[0]?.total ?? 0),
      statusCounts: Object.fromEntries(statusRows.map((row) => [row.status, Number(row.total ?? 0)])),
      page,
      pageSize,
    };
  });
}

export async function getBookingDetail(bookingId: number) {
  return dbRead(async () => {
    const db = getDb();
    const bookingRows = await db.select().from(bookings).where(eq(bookings.id, bookingId)).limit(1);
    if (bookingRows.length === 0) return null;

    const booking = bookingRows[0];
    const assignmentRows = await db.select().from(bookingBedAssignments).where(eq(bookingBedAssignments.bookingId, bookingId));
    const historyRows = await db.select().from(bookingHistory).where(eq(bookingHistory.bookingId, bookingId)).orderBy(desc(bookingHistory.id));
    const contactRows = await getBookingContactMethods(bookingId);

    let linkedBookings: typeof bookingRows = [];
    if (booking.gokoBookingId) {
      linkedBookings = await db.select().from(bookings).where(
        and(eq(bookings.gokoBookingId, booking.gokoBookingId), sql`${bookings.id} != ${bookingId}`)
      );
    }

    return { booking, assignments: assignmentRows, history: historyRows, contactMethods: contactRows, linkedBookings };
  });
}

export async function searchBookings(query: string) {
  const db = getDb();
  const q = `%${query}%`;
  return db.select().from(bookings).where(
    sql`(${bookings.guestName} LIKE ${q} OR ${bookings.bookingRef} LIKE ${q} OR ${bookings.gokoBookingId} LIKE ${q} OR ${bookings.contact} LIKE ${q})`
  ).orderBy(desc(bookings.id)).limit(20);
}

export async function getUnassignedBookings() {
  return dbRead(() => {
    const db = getDb();
    return db.select().from(bookings).where(
      sql`${bookings.status} NOT IN ('cancelled', 'checked_out', 'guest_declined', 'no_show')
        AND NOT EXISTS (
          SELECT 1 FROM ${bookingBedAssignments}
          WHERE ${bookingBedAssignments.bookingId} = ${bookings.id}
            AND ${bookingBedAssignments.status} = 'assigned'
        )`
    ).orderBy(desc(bookings.id));
  });
}

/** Unassigned channel_manager rooms occupying this dorm's OTA pool for `date`. */
export async function getUnassignedOtaRoomCountForDorm(dormId: number, date: string): Promise<number> {
  const codes = (await getRoomTypeMappings())
    .filter((m) => m.dormId === dormId && m.isActive)
    .map((m) => m.channelRoomCode);
  if (codes.length === 0) return 0;
  const db = getDb();
  const rows = await db.select({
    roomType: bookings.roomType,
    rawData: bookings.rawData,
  }).from(bookings).where(
    and(
      eq(bookings.source, "channel_manager"),
      sql`${bookings.status} NOT IN ('cancelled', 'checked_out', 'guest_declined', 'no_show')`,
      lte(bookings.checkinDate, date),
      sql`(
        CASE
          WHEN ${bookings.checkoutDate} IS NULL
            OR ${bookings.checkoutDate} = ''
            OR ${bookings.checkoutDate} <= ${bookings.checkinDate}
          THEN date(${bookings.checkinDate}, '+1 day')
          ELSE ${bookings.checkoutDate}
        END > ${date}
      )`,
      sql`NOT EXISTS (
        SELECT 1 FROM ${bookingBedAssignments}
        WHERE ${bookingBedAssignments.bookingId} = ${bookings.id}
          AND ${bookingBedAssignments.status} = 'assigned'
          AND coalesce(${bookingBedAssignments.inventoryPool}, 'online') = 'online'
      )`,
    ),
  );
  return countUnassignedOtaRooms(codes, rows);
}

export async function getUnassignedOtaHoldsForRange(
  startDate: string,
  endExclusive: string,
  excludeBookingId?: number,
): Promise<Array<{ dormId: number; date: string; rooms: number }>> {
  if (!startDate || !endExclusive || startDate >= endExclusive) return [];
  const mappings = (await getRoomTypeMappings()).filter((m) => m.isActive);
  if (mappings.length === 0) return [];
  const db = getDb();
  const rows = await db.select({
    id: bookings.id,
    checkinDate: bookings.checkinDate,
    checkoutDate: bookings.checkoutDate,
    roomType: bookings.roomType,
    rawData: bookings.rawData,
  }).from(bookings).where(
    and(
      eq(bookings.source, "channel_manager"),
      sql`${bookings.status} NOT IN ('cancelled', 'checked_out', 'guest_declined', 'no_show')`,
      sql`${bookings.checkinDate} < ${endExclusive}`,
      sql`(
        CASE
          WHEN ${bookings.checkoutDate} IS NULL
            OR ${bookings.checkoutDate} = ''
            OR ${bookings.checkoutDate} <= ${bookings.checkinDate}
          THEN date(${bookings.checkinDate}, '+1 day')
          ELSE ${bookings.checkoutDate}
        END > ${startDate}
      )`,
      sql`NOT EXISTS (
        SELECT 1 FROM ${bookingBedAssignments}
        WHERE ${bookingBedAssignments.bookingId} = ${bookings.id}
          AND ${bookingBedAssignments.status} = 'assigned'
          AND coalesce(${bookingBedAssignments.inventoryPool}, 'online') = 'online'
      )`,
    ),
  );
  return explodeUnassignedOtaHolds(rows, mappings, startDate, endExclusive, excludeBookingId);
}

export async function checkBedAvailability(bedId: number, checkinDate: string, checkoutDate: string, excludeBookingId?: number): Promise<boolean> {
  if (!checkinDate || !checkoutDate || checkinDate >= checkoutDate) return true;
  const db = getDb();
  let conditions = and(
    eq(bookingBedAssignments.bedId, bedId),
    eq(bookingBedAssignments.status, "assigned"),
    sql`${bookingBedAssignments.checkoutDate} > ${bookingBedAssignments.checkinDate}`,
    sql`${bookingBedAssignments.checkinDate} < ${checkoutDate}`,
    sql`${bookingBedAssignments.checkoutDate} > ${checkinDate}`
  );

  if (excludeBookingId) {
    conditions = and(conditions, sql`${bookingBedAssignments.bookingId} != ${excludeBookingId}`);
  }

  const conflicts = await db.select({ count: sql<number>`COUNT(*)` }).from(bookingBedAssignments).where(conditions!);
  if ((conflicts[0]?.count ?? 0) > 0) return false;

  const blocked = await db.select({ count: sql<number>`COUNT(*)` }).from(bedBlocks).where(
    and(
      eq(bedBlocks.bedId, bedId),
      eq(bedBlocks.isActive, 1),
      sql`${bedBlocks.startDate} < ${checkoutDate}`,
      sql`${bedBlocks.endDate} > ${checkinDate}`
    )
  );
  return (blocked[0]?.count ?? 0) === 0;
}

async function loadBedsAvailabilityForRange(
  checkinDate: string,
  checkoutDate: string,
  dormId?: number,
  excludePhysicalOccupancy = false,
  excludeBookingId?: number,
) {
  const db = getDb();
  const allBeds = dormId
    ? await db.select().from(beds).where(eq(beds.dormId, dormId))
    : await db.select().from(beds);

  const assignmentRows = await db.select().from(bookingBedAssignments).where(
    and(
      eq(bookingBedAssignments.status, "assigned"),
      sql`${bookingBedAssignments.checkoutDate} > ${bookingBedAssignments.checkinDate}`,
      sql`${bookingBedAssignments.checkinDate} < ${checkoutDate}`,
      sql`${bookingBedAssignments.checkoutDate} > ${checkinDate}`
    )
  );
  // Date edits / revalidation pass excludeBookingId so this stay's own beds are not
  // treated as conflicting with themselves (same rule as checkBedAvailability).
  const ownAssignedBedIds = new Set<number>();
  const assignments = excludeBookingId != null
    ? assignmentRows.filter((row) => {
        if (row.bookingId === excludeBookingId) {
          ownAssignedBedIds.add(row.bedId);
          return false;
        }
        return true;
      })
    : assignmentRows;

  const blocks = await db.select().from(bedBlocks).where(
    and(
      eq(bedBlocks.isActive, 1),
      sql`${bedBlocks.startDate} < ${checkoutDate}`,
      sql`${bedBlocks.endDate} > ${checkinDate}`,
      ...(dormId ? [eq(bedBlocks.dormId, dormId)] : [])
    )
  );

  const nights = stayNights(checkinDate, checkoutDate);
  const lastNight = nights[nights.length - 1];
  const overrides = lastNight
    ? await db.select().from(inventoryOverrides).where(
        and(gte(inventoryOverrides.date, checkinDate), lte(inventoryOverrides.date, lastNight))
      )
    : [];

  const occupiedBedIds = new Set(assignments.map((r) => r.bedId));
  const physicalOccupiedBedIds = excludePhysicalOccupancy
    ? new Set(allBeds.filter((b) => b.status === "occupied" && b.checkinDate && b.expectedCheckout
      && b.checkinDate < checkoutDate && b.expectedCheckout > checkinDate).map((b) => b.id))
    : new Set<number>();
  const blockedBedIds = new Set(blocks.map((r) => r.bedId));
  // Online booking inventory and physical occupancy are separate ledgers. A physical
  // assignment must not make an online planned bed unavailable here.
  for (const unit of sellableUnits(allBeds)) {
    if (unit.type !== "Double") continue;
    if (unit.beds.some((b) => blockedBedIds.has(b.id))) unit.beds.forEach((b) => blockedBedIds.add(b.id));
  }
  const physical = allBeds.filter((b) => !occupiedBedIds.has(b.id) && !physicalOccupiedBedIds.has(b.id) && !blockedBedIds.has(b.id));
  const blockedOnly = allBeds.filter((b) => !occupiedBedIds.has(b.id) && blockedBedIds.has(b.id));
  return { allBeds, assignments, blocks, overrides, nights, physical, blockedOnly, ownAssignedBedIds };
}

export async function getCalendarAvailability(startDate: string, endDate: string) {
  return dbRead(async () => {
    const checkout = addCalendarDays(endDate, 1);
    const { allBeds, nights, blocks, assignments, overrides } = await loadBedsAvailabilityForRange(startDate, checkout);
    const holds = await getUnassignedOtaHoldsForRange(startDate, checkout);
    return calendarAvailability(allBeds, nights, blocks, assignments, overrides, holds);
  });
}

export async function getAvailableBedsForRange(
  checkinDate: string,
  checkoutDate: string,
  dormId?: number,
  excludeBookingId?: number,
  /** Hide beds already assigned to excludeBookingId (add-bed picker). Date revalidation leaves them visible. */
  omitOwnAssigned = false,
) {
  return dbRead(async () => {
    const { allBeds, assignments, blocks, overrides, nights, physical, blockedOnly, ownAssignedBedIds } = await loadBedsAvailabilityForRange(
      checkinDate,
      checkoutDate,
      dormId,
      false,
      excludeBookingId,
    );
    if (nights.length === 0) return [];
    const unassignedHolds = await getUnassignedOtaHoldsForRange(checkinDate, checkoutDate, excludeBookingId);
    let tagged = tagBedsForPicker(physical, blockedOnly, allBeds, nights, blocks, assignments, overrides, unassignedHolds, todayIST());
    // Match guest search: beds under an active native website hold are not free to pick/assign.
    // Filter bed IDs only — do not change Aiosell hold unit math (getActiveNativeHoldBedCountForDorm).
    try {
      const heldRows = await getDb().select({ bedIds: nativeInventoryHolds.bedIds }).from(nativeInventoryHolds).where(sql`
        ${nativeInventoryHolds.state} = 'held'
        AND ${nativeInventoryHolds.expiresAt} > CAST(strftime('%s','now') AS INTEGER)
        AND ${nativeInventoryHolds.checkinDate} < ${checkoutDate}
        AND ${nativeInventoryHolds.checkoutDate} > ${checkinDate}
      `);
      const heldIds = new Set<number>();
      for (const row of heldRows) {
        let ids: unknown;
        try { ids = JSON.parse(row.bedIds); } catch { continue; }
        if (!Array.isArray(ids)) continue;
        for (const id of ids) {
          if (Number.isInteger(id) && (id as number) > 0) heldIds.add(id as number);
        }
      }
      if (heldIds.size) tagged = tagged.filter((bed) => !heldIds.has(bed.id));
    } catch { /* holds table missing — picker still works */ }
    if (!omitOwnAssigned || ownAssignedBedIds.size === 0) return tagged;
    return tagged.filter((bed) => !ownAssignedBedIds.has(bed.id));
  });
}

/** Physical beds with no assignment and no block overlapping [startDate, endDate). */
export async function getBedsFreeToBlock(startDate: string, endDate: string, dormId?: number) {
  if (!startDate || !endDate || startDate >= endDate) return [];
  const { physical } = await loadBedsAvailabilityForRange(startDate, endDate, dormId, true);
  return physical;
}

export async function validateBedsForRange(
  bedIds: number[],
  checkinDate: string,
  checkoutDate: string,
  excludeBookingId?: number,
  allowPartialDouble = false,
): Promise<string | null> {
  if (bedIds.length === 0) return null;
  const requestedIds = new Set(bedIds);
  const selectedUnits = sellableUnits(await getAllBeds()).filter((u) => u.beds.some((b) => requestedIds.has(b.id)));
  if (!allowPartialDouble && selectedUnits.some((u) => u.type === "Double" && !u.beds.every((b) => requestedIds.has(b.id)))) {
    return "A double bed must be selected as one complete room";
  }
  const tagged = await getAvailableBedsForRange(checkinDate, checkoutDate, undefined, excludeBookingId);
  const byId = new Map(tagged.map((b) => [b.id, b]));
  const requested = [];
  for (const id of bedIds) {
    if (!byId.has(id)) return "One or more beds are not available for these dates";
    requested.push({ id });
  }
  return bedsFitInventoryCap(requested, new Set(tagged.map((b) => b.id)));
}

export async function assignBedToBooking(data: {
  bookingId: number; bedId: number; dormId: number;
  checkinDate: string; checkoutDate: string; assignedBy: string;
  inventoryPool?: string;
}): Promise<boolean> {
  if (!data.checkinDate || !data.checkoutDate || data.checkinDate >= data.checkoutDate) return false;
  return dbWrite(async () => {
    const db = getDb();
    const now = new Date().toISOString();
    const pool = data.inventoryPool || "online";

    const result: any = await db.run(sql`
      INSERT INTO booking_bed_assignments (booking_id, bed_id, dorm_id, checkin_date, checkout_date, status, assigned_by, assigned_at, inventory_pool)
      SELECT ${data.bookingId}, ${data.bedId}, ${data.dormId}, ${data.checkinDate}, ${data.checkoutDate}, 'assigned', ${data.assignedBy}, ${now}, ${pool}
      WHERE NOT EXISTS (
        SELECT 1 FROM booking_bed_assignments
        WHERE bed_id = ${data.bedId} AND status = 'assigned'
        AND checkout_date > checkin_date
        AND checkin_date < ${data.checkoutDate} AND checkout_date > ${data.checkinDate}
      )
    `);
    if (sqliteWriteCount(result) > 0) return true;
    // Retry after a thrown D1 error: this stay+bed may already be written.
    const own = await db.select({ id: bookingBedAssignments.id }).from(bookingBedAssignments).where(
      and(
        eq(bookingBedAssignments.bookingId, data.bookingId),
        eq(bookingBedAssignments.bedId, data.bedId),
        eq(bookingBedAssignments.status, "assigned"),
        sql`${bookingBedAssignments.checkinDate} = ${data.checkinDate}`,
        sql`${bookingBedAssignments.checkoutDate} = ${data.checkoutDate}`,
      )
    ).limit(1);
    return own.length > 0;
  }, { idempotentWrite: true });
}

export async function unassignBookingBeds(bookingId: number) {
  const db = getDb();
  return db.update(bookingBedAssignments)
    .set({ status: "unassigned" })
    .where(and(eq(bookingBedAssignments.bookingId, bookingId), eq(bookingBedAssignments.status, "assigned")));
}

export async function unassignBookingBedsByBedIds(bookingId: number, bedIds: number[]) {
  if (bedIds.length === 0) return;
  const db = getDb();
  for (const batch of uniqueInBatches(bedIds)) {
    await db.update(bookingBedAssignments)
      .set({ status: "unassigned" })
      .where(and(
        eq(bookingBedAssignments.bookingId, bookingId),
        eq(bookingBedAssignments.status, "assigned"),
        inArray(bookingBedAssignments.bedId, batch),
      ));
  }
}

export async function shortenAssignedCheckout(bookingId: number, newCheckout: string) {
  const db = getDb();
  return db.update(bookingBedAssignments)
    .set({ checkoutDate: newCheckout })
    .where(and(eq(bookingBedAssignments.bookingId, bookingId), eq(bookingBedAssignments.status, "assigned")));
}

export async function cancelBedAssignments(assignmentIds: number[], bookingId?: number) {
  if (assignmentIds.length === 0) return false;
  const db = getDb();
  let cancelled = 0;
  for (const batch of uniqueInBatches(assignmentIds)) {
    const rows = await db.update(bookingBedAssignments)
      .set({ status: "cancelled" })
      .where(and(
        inArray(bookingBedAssignments.id, batch),
        eq(bookingBedAssignments.status, "assigned"),
        ...(bookingId ? [eq(bookingBedAssignments.bookingId, bookingId)] : []),
      ))
      .returning({ id: bookingBedAssignments.id });
    cancelled += rows.length;
  }
  return cancelled > 0;
}

export async function addBookingHistoryEntry(data: {
  bookingId: number; action: string; details?: string; performedBy: string;
}) {
  const db = getDb();
  return db.insert(bookingHistory).values({
    bookingId: data.bookingId,
    action: data.action,
    details: data.details || "",
    performedBy: data.performedBy,
    performedAt: new Date().toISOString(),
  });
}

export async function getBookingHistoryEntries(bookingId: number) {
  const db = getDb();
  return db.select().from(bookingHistory).where(eq(bookingHistory.bookingId, bookingId)).orderBy(desc(bookingHistory.id));
}

/** Recent lifecycle events for the Management audit view, enriched with booking context. */
export async function getBookingAuditEntries(limit = 500, dateFrom?: string, dateTo?: string) {
  const db = getDb();
  const bounds = auditDateBounds(await getAuditRetentionCutoff(), dateFrom, dateTo);
  return db.select({
    id: bookingHistory.id,
    bookingId: bookingHistory.bookingId,
    action: bookingHistory.action,
    details: bookingHistory.details,
    performedBy: bookingHistory.performedBy,
    performedAt: bookingHistory.performedAt,
    guestName: bookings.guestName,
    platform: bookings.platform,
    bookingRef: bookings.bookingRef,
    gokoBookingId: bookings.gokoBookingId,
    checkinDate: bookings.checkinDate,
    checkoutDate: bookings.checkoutDate,
  })
    .from(bookingHistory)
    .leftJoin(bookings, eq(bookingHistory.bookingId, bookings.id))
    .where(and(
      gte(bookingHistory.performedAt, bounds.start),
      ...(bounds.end ? [lte(bookingHistory.performedAt, bounds.end)] : []),
    ))
    .orderBy(desc(bookingHistory.id))
    .limit(limit);
}

export async function getLinkedBookings(gokoBookingId: string) {
  const db = getDb();
  return db.select().from(bookings).where(eq(bookings.gokoBookingId, gokoBookingId));
}

export async function getExpiredHoldBookings() {
  const db = getDb();
  const now = new Date().toISOString();
  return db.select().from(bookings).where(
    and(
      eq(bookings.status, "hold"),
      sql`${bookings.holdExpiresAt} != ''`,
      sql`${bookings.holdExpiresAt} < ${now}`
    )
  );
}

// --- Inventory & Rate Plan Queries ---

export async function getChannels() {
  const db = getDb();
  return db.select().from(channels);
}

export async function upsertChannel(data: { id?: number; name: string; code: string; isActive?: number }) {
  const db = getDb();
  if (data.id) {
    return db.update(channels).set({ name: data.name, code: data.code, isActive: data.isActive ?? 1 }).where(eq(channels.id, data.id));
  }
  return db.insert(channels).values({ name: data.name, code: data.code, isActive: data.isActive ?? 1, createdAt: new Date().toISOString() });
}

export async function deleteChannel(id: number) {
  const db = getDb();
  return db.delete(channels).where(eq(channels.id, id));
}

export async function getBedTypeConfigs(dormId?: number) {
  const db = getDb();
  if (dormId) return db.select().from(bedTypeConfig).where(eq(bedTypeConfig.dormId, dormId));
  return db.select().from(bedTypeConfig);
}

export async function upsertBedTypeConfig(data: { id?: number; dormId: number; bedType: string; maxOccupancy: number; extraPersonAllowed: number }) {
  const db = getDb();
  if (data.id) {
    return db.update(bedTypeConfig).set({
      bedType: data.bedType,
      maxOccupancy: data.maxOccupancy,
      extraPersonAllowed: data.extraPersonAllowed,
    }).where(eq(bedTypeConfig.id, data.id));
  }
  return db.insert(bedTypeConfig).values({ ...data, createdAt: new Date().toISOString() });
}

export async function getActiveBedBlocks(dormId?: number, startDate?: string, endDate?: string) {
  const db = getDb();
  let conditions = eq(bedBlocks.isActive, 1);
  if (dormId) conditions = and(conditions, eq(bedBlocks.dormId, dormId))!;
  if (startDate && endDate) {
    conditions = and(conditions, sql`${bedBlocks.startDate} <= ${endDate}`, sql`${bedBlocks.endDate} > ${startDate}`)!;
  }
  return db.select().from(bedBlocks).where(conditions);
}

export async function getBlockedBedIdsForDate(dormId: number, date: string): Promise<number[]> {
  const db = getDb();
  const rows = await db.select({ bedId: bedBlocks.bedId }).from(bedBlocks).where(
    and(
      eq(bedBlocks.dormId, dormId),
      eq(bedBlocks.isActive, 1),
      sql`${bedBlocks.startDate} <= ${date}`,
      sql`${bedBlocks.endDate} > ${date}`
    )
  );
  return [...new Set(rows.map(r => r.bedId))];
}

export async function createBedBlock(data: { bedId: number; dormId: number; startDate: string; endDate: string; reason: string; blockedBy: string }) {
  const db = getDb();
  return db.insert(bedBlocks).values({
    bedId: data.bedId,
    dormId: data.dormId,
    startDate: data.startDate,
    endDate: data.endDate,
    reason: data.reason,
    blockedBy: data.blockedBy,
    blockedAt: new Date().toISOString(),
    isActive: 1,
  });
}

export async function deactivateBedBlock(blockId: number, unblockedBy: string) {
  const db = getDb();
  return db.update(bedBlocks).set({
    isActive: 0,
    unblockedBy,
    unblockedAt: new Date().toISOString(),
  }).where(eq(bedBlocks.id, blockId));
}

export async function deactivateBedBlocksByBedIds(bedIds: number[], startDate: string, endDate: string, unblockedBy: string) {
  if (bedIds.length === 0) return;
  const db = getDb();
  for (const batch of uniqueInBatches(bedIds)) {
    await db.update(bedBlocks).set({
      isActive: 0,
      unblockedBy,
      unblockedAt: new Date().toISOString(),
    }).where(
      and(
        inArray(bedBlocks.bedId, batch),
        eq(bedBlocks.isActive, 1),
        sql`${bedBlocks.startDate} < ${endDate}`,
        sql`${bedBlocks.endDate} > ${startDate}`
      )
    );
  }
}

export async function getInventoryOverrides(dormId: number, startDate: string, endDate: string) {
  const db = getDb();
  return db.select().from(inventoryOverrides).where(
    and(
      eq(inventoryOverrides.dormId, dormId),
      gte(inventoryOverrides.date, startDate),
      lte(inventoryOverrides.date, endDate)
    )
  );
}

export async function getInventoryOverrideForDormDate(dormId: number, date: string) {
  const db = getDb();
  const rows = await db.select().from(inventoryOverrides)
    .where(and(eq(inventoryOverrides.dormId, dormId), eq(inventoryOverrides.date, date)));
  return pickInventoryOverride(rows, dormId, date);
}

export async function upsertInventoryOverride(data: { dormId: number; channelId: number | null; date: string; onlineAvailable?: number | null; offlineAvailable?: number | null; overriddenBy: string }) {
  const db = getDb();
  const now = new Date().toISOString();
  const existing = await db.select().from(inventoryOverrides).where(
    and(
      eq(inventoryOverrides.dormId, data.dormId),
      data.channelId ? eq(inventoryOverrides.channelId, data.channelId) : sql`${inventoryOverrides.channelId} IS NULL`,
      eq(inventoryOverrides.date, data.date)
    )
  ).limit(1);

  if (existing.length > 0) {
    return db.update(inventoryOverrides).set({
      onlineAvailable: data.onlineAvailable ?? null,
      offlineAvailable: data.offlineAvailable ?? null,
      overriddenBy: data.overriddenBy,
      overriddenAt: now,
    }).where(eq(inventoryOverrides.id, existing[0].id));
  }
  return db.insert(inventoryOverrides).values({
    dormId: data.dormId,
    channelId: data.channelId,
    date: data.date,
    onlineAvailable: data.onlineAvailable ?? null,
    offlineAvailable: data.offlineAvailable ?? null,
    overriddenBy: data.overriddenBy,
    overriddenAt: now,
  });
}

export async function deleteInventoryOverride(data: { dormId: number; channelId: number | null; date: string }) {
  const db = getDb();
  return db.delete(inventoryOverrides).where(
    and(
      eq(inventoryOverrides.dormId, data.dormId),
      data.channelId == null ? sql`${inventoryOverrides.channelId} IS NULL` : eq(inventoryOverrides.channelId, data.channelId),
      eq(inventoryOverrides.date, data.date),
    ),
  );
}

/** Replace default (channelId IS NULL) overrides for a bulk availability operation. */
export async function bulkReplaceInventoryOverrides(
  rows: Array<{ dormId: number; date: string; onlineAvailable: number | null; overriddenBy: string }>,
  mode: "set" | "clear",
) {
  const db = getDb();
  const now = new Date().toISOString();
  const chunks: typeof rows[] = [];
  for (let start = 0; start < rows.length; start += 10) chunks.push(rows.slice(start, start + 10));

  const batch = (db as unknown as { batch?: (statements: unknown[]) => Promise<unknown> }).batch;
  if (typeof batch === "function") {
    let committedRows = 0;
    try {
      // D1 limits a batch to a bounded number of statements. Forty chunks
      // means at most 80 statements (delete + insert) per atomic batch.
      for (let groupStart = 0; groupStart < chunks.length; groupStart += 40) {
        const statements: unknown[] = [];
        const group = chunks.slice(groupStart, groupStart + 40);
        for (const chunk of group) {
          const predicates = chunk.map((row) => and(
            eq(inventoryOverrides.dormId, row.dormId),
            sql`${inventoryOverrides.channelId} IS NULL`,
            eq(inventoryOverrides.date, row.date),
          ));
          if (predicates.length > 0) statements.push(db.delete(inventoryOverrides).where(or(...predicates)));
          if (mode === "set" && chunk.length > 0) {
            statements.push(db.insert(inventoryOverrides).values(chunk.map((row) => ({
              dormId: row.dormId,
              channelId: null,
              date: row.date,
              onlineAvailable: row.onlineAvailable,
              offlineAvailable: null,
              overriddenBy: row.overriddenBy,
              overriddenAt: now,
            }))));
          }
        }
        if (statements.length > 0) await batch.call(db, statements);
        committedRows += group.reduce((count, chunk) => count + chunk.length, 0);
      }
    } catch (error: any) {
      throw Object.assign(error instanceof Error ? error : new Error(String(error)), { committedRows });
    }
    return committedRows;
  }

  let committedRows = 0;
  for (const row of rows) {
    try {
      if (mode === "clear") {
        await deleteInventoryOverride({ dormId: row.dormId, channelId: null, date: row.date });
      } else {
        await upsertInventoryOverride({ ...row, channelId: null, offlineAvailable: null });
      }
      committedRows++;
    } catch (error: any) {
      throw Object.assign(error instanceof Error ? error : new Error(String(error)), { committedRows });
    }
  }
  return committedRows;
}

export async function getChannelRatesForRange(ratePlanId: number, channelId: number, startDate: string, endDate: string) {
  const db = getDb();
  return db.select().from(channelRates).where(
    and(
      eq(channelRates.ratePlanId, ratePlanId),
      eq(channelRates.channelId, channelId),
      gte(channelRates.date, startDate),
      lte(channelRates.date, endDate)
    )
  ).orderBy(channelRates.date);
}

export async function upsertChannelRate(data: {
  ratePlanId: number; channelId: number; date: string;
  adult1Rate?: number | null; adult2Rate?: number | null; childRate?: number | null;
  infantRate?: number | null; extraPersonRate?: number | null; updatedBy: string;
}) {
  const db = getDb();
  const now = new Date().toISOString();
  const existing = await db.select().from(channelRates).where(
    and(eq(channelRates.ratePlanId, data.ratePlanId), eq(channelRates.channelId, data.channelId), eq(channelRates.date, data.date))
  ).limit(1);

  const existingRow = existing[0];
  const values = {
    adult1Rate: data.adult1Rate !== undefined ? data.adult1Rate : (existingRow?.adult1Rate ?? null),
    adult2Rate: data.adult2Rate !== undefined ? data.adult2Rate : (existingRow?.adult2Rate ?? null),
    childRate: data.childRate !== undefined ? data.childRate : (existingRow?.childRate ?? null),
    infantRate: data.infantRate !== undefined ? data.infantRate : (existingRow?.infantRate ?? null),
    extraPersonRate: data.extraPersonRate !== undefined ? data.extraPersonRate : (existingRow?.extraPersonRate ?? null),
    updatedBy: data.updatedBy,
    updatedAt: now,
  };

  if (existing.length > 0) {
    return db.update(channelRates).set(values).where(eq(channelRates.id, existing[0].id));
  }
  return db.insert(channelRates).values({
    ratePlanId: data.ratePlanId,
    channelId: data.channelId,
    date: data.date,
    ...values,
  });
}

export async function getInventoryGridData(startDate: string, endDate: string) {
  const db = getDb();
  const allDorms = await db.select().from(dorms);
  const allBeds = await db.select().from(beds);
  const blocks = await db.select().from(bedBlocks).where(
    and(eq(bedBlocks.isActive, 1), sql`${bedBlocks.startDate} <= ${endDate}`, sql`${bedBlocks.endDate} > ${startDate}`)
  );
  const assignments = await db.select().from(bookingBedAssignments).where(
    and(
      eq(bookingBedAssignments.status, "assigned"),
      sql`${bookingBedAssignments.checkinDate} <= ${endDate}`,
      sql`${bookingBedAssignments.checkoutDate} > ${startDate}`
    )
  );
  const roomMappings = await db.select().from(roomTypeMapping).where(eq(roomTypeMapping.isActive, 1));
  const ratePlans = await db.select().from(ratePlanMapping).where(eq(ratePlanMapping.isActive, 1));
  const rates = await db.select().from(dailyRates).where(
    and(gte(dailyRates.date, startDate), lte(dailyRates.date, endDate))
  );

  const overrides = await db.select().from(inventoryOverrides).where(
    and(gte(inventoryOverrides.date, startDate), lte(inventoryOverrides.date, endDate))
  );
  const unassignedOta = await getUnassignedOtaHoldsForRange(startDate, addCalendarDays(endDate, 1));

  return { dorms: allDorms, beds: allBeds, blocks, assignments, roomMappings, ratePlans, rates, overrides, unassignedOta };
}

// --- Inventory Dirty Tracking ---

export async function markInventoryDirty(dormId: number, dates: string[]) {
  const db = getDb();
  const now = new Date().toISOString();
  const rows = [...new Set(dates)].map((date) => ({ dormId, date, createdAt: now }));
  const batch = (db as unknown as { batch?: (statements: unknown[]) => Promise<unknown> }).batch;
  if (typeof batch === "function") {
    const statements = [];
    for (let start = 0; start < rows.length; start += 20) {
      statements.push(db.insert(inventoryDirty).values(rows.slice(start, start + 20)).onConflictDoNothing());
    }
    if (statements.length > 0) await batch.call(db, statements);
    return;
  }
  for (const row of rows) {
    await db.run(sql`INSERT OR IGNORE INTO inventory_dirty (dorm_id, date, created_at) VALUES (${row.dormId}, ${row.date}, ${row.createdAt})`);
  }
}

export async function getDirtyInventory() {
  const db = getDb();
  return db.select().from(inventoryDirty).orderBy(inventoryDirty.date);
}

export async function clearDirtyInventory(ids: number[]) {
  if (ids.length === 0) return;
  const db = getDb();
  // Keep the IN list below SQLite/D1's bind-variable limit. A full 30-day
  // sync can otherwise push hundreds of rows and fail after Aiosell accepted
  // the inventory update, leaving the same dirty rows queued forever.
  for (const batch of uniqueInBatches(ids)) {
    await db.delete(inventoryDirty).where(inArray(inventoryDirty.id, batch));
  }
}

export async function clearAllDirtyInventory() {
  const db = getDb();
  return db.delete(inventoryDirty);
}
