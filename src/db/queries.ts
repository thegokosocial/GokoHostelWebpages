import { eq, desc, and, sql } from "drizzle-orm";
import { getDb } from "./index";
import { checkins, dorms, beds, bedHistory, settings, apiStats, users, auditLog, systemLogs, bookings } from "./schema";

// --- Check-ins ---

export async function getCheckinsByMonth(month: string) {
  const db = getDb();
  return db.select().from(checkins).where(eq(checkins.createdMonth, month)).orderBy(desc(checkins.id));
}

export async function addCheckin(data: {
  submittedAt: string; arrivalDate: string; arrivalTime: string; name: string;
  persons: string; contact: string; stayingDays: string; comingFrom: string;
  nationality: string; emergencyName: string; emergencyPhone: string;
  idType: string; idCardLink: string; visaLink: string; verified: string; createdMonth: string;
}) {
  const db = getDb();
  return db.insert(checkins).values(data);
}

export async function updateCheckin(id: number, data: Partial<typeof checkins.$inferInsert>) {
  const db = getDb();
  return db.update(checkins).set(data).where(eq(checkins.id, id));
}

export async function deleteCheckin(id: number) {
  const db = getDb();
  return db.delete(checkins).where(eq(checkins.id, id));
}

export async function getCheckinMonths(): Promise<string[]> {
  const db = getDb();
  const rows = await db.selectDistinct({ month: checkins.createdMonth }).from(checkins);
  return rows.map((r) => r.month);
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
  return db.insert(dorms).values({ name, createdAt: new Date().toISOString() });
}

export async function deleteDormAndBeds(dormId: number) {
  const db = getDb();
  await db.delete(beds).where(eq(beds.dormId, dormId));
  await db.delete(dorms).where(eq(dorms.id, dormId));
}

// --- Beds ---

export async function getAllBeds() {
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
    dormName: dorms.name,
  }).from(beds).innerJoin(dorms, eq(beds.dormId, dorms.id));
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
}) {
  const db = getDb();
  return db.update(beds).set(data).where(eq(beds.id, bedId));
}

export async function addBed(data: { dormId: number; dormName: string; bedId: string; position: string; type: string }) {
  const db = getDb();
  return db.insert(beds).values({ ...data, status: "available", guestName: "", guestContact: "", checkinDate: "", expectedCheckout: "", stayingDays: "" });
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
  return db.insert(bedHistory).values({ ...data, createdAt: new Date().toISOString() });
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
  const db = getDb();
  const rows = await db.select().from(settings).where(eq(settings.key, key));
  return rows[0]?.value ?? null;
}

export async function setSetting(key: string, value: string) {
  const db = getDb();
  await db.insert(settings).values({ key, value }).onConflictDoUpdate({
    target: settings.key,
    set: { value },
  });
}

// --- API Stats ---

export async function incrementStat(apiType: "vision" | "sheets" | "drive", count = 1) {
  const db = getDb();
  const month = getMonthKey();

  const existing = await db.select().from(apiStats).where(eq(apiStats.month, month));
  if (existing.length > 0) {
    const row = existing[0];
    const updated = {
      vision: row.vision + (apiType === "vision" ? count : 0),
      sheets: row.sheets + (apiType === "sheets" ? count : 0),
      drive: row.drive + (apiType === "drive" ? count : 0),
      total: 0,
    };
    updated.total = updated.vision + updated.sheets + updated.drive;
    await db.update(apiStats).set(updated).where(eq(apiStats.month, month));
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
  const d = date || new Date();
  const months = ["JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE",
    "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER"];
  return `${months[d.getMonth()]}-${d.getFullYear()}`;
}

// --- Users ---

export async function getAllUsers() {
  const db = getDb();
  return db.select().from(users).orderBy(users.id);
}

export async function getUserByUsername(username: string) {
  const db = getDb();
  const rows = await db.select().from(users).where(eq(users.username, username)).limit(1);
  return rows[0] || null;
}

export async function createUser(data: {
  username: string; passwordHash: string; displayName: string;
  role: string; permissions: string; createdBy?: string;
}) {
  const db = getDb();
  return db.insert(users).values({
    ...data,
    createdAt: new Date().toISOString(),
    createdBy: data.createdBy || "",
    isSystem: 0,
  });
}

export async function updateUser(userId: number, data: {
  displayName?: string; passwordHash?: string; role?: string; permissions?: string;
}) {
  const db = getDb();
  const updateData: any = {};
  if (data.displayName !== undefined) updateData.displayName = data.displayName;
  if (data.passwordHash !== undefined) updateData.passwordHash = data.passwordHash;
  if (data.role !== undefined) updateData.role = data.role;
  if (data.permissions !== undefined) updateData.permissions = data.permissions;
  return db.update(users).set(updateData).where(eq(users.id, userId));
}

export async function deleteUser(userId: number) {
  const db = getDb();
  return db.delete(users).where(eq(users.id, userId));
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

export async function getAuditEntries(limit = 500) {
  const db = getDb();
  return db.select().from(auditLog).orderBy(desc(auditLog.id)).limit(limit);
}

// --- System Logs ---

const LOG_LEVELS: Record<string, number> = { debug: 0, info: 1, warn: 2, error: 3 };

export async function addSystemLog(data: {
  level: string; source: string; message: string; details?: string; requestId?: string;
}) {
  try {
    const configuredLevel = await getSetting("log_level") || "error";
    const configuredPriority = LOG_LEVELS[configuredLevel] ?? 3;
    const messagePriority = LOG_LEVELS[data.level] ?? 0;

    if (messagePriority < configuredPriority) return;

    const db = getDb();
    return db.insert(systemLogs).values({
      timestamp: new Date().toISOString(),
      level: data.level,
      source: data.source,
      message: data.message,
      details: data.details || "",
      requestId: data.requestId || "",
    });
  } catch {
    // Fail silently — logging should never break the app
  }
}

export async function getSystemLogs(limit = 200) {
  const db = getDb();
  return db.select().from(systemLogs).orderBy(desc(systemLogs.id)).limit(limit);
}

// --- Bookings ---

export async function getAllBookings() {
  const db = getDb();
  return db.select().from(bookings).orderBy(desc(bookings.id));
}

export async function getUpcomingBookings() {
  const db = getDb();
  const today = new Date().toISOString().split("T")[0];
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
  paymentStatus?: string; specialRequests?: string; status?: string; source?: string; rawData?: string;
}) {
  const db = getDb();
  return db.insert(bookings).values({
    guestName: data.guestName,
    contact: data.contact || "",
    platform: data.platform,
    bookingRef: data.bookingRef || "",
    checkinDate: data.checkinDate,
    checkoutDate: data.checkoutDate || "",
    roomType: data.roomType || "",
    persons: data.persons || 1,
    paymentStatus: data.paymentStatus || "unknown",
    specialRequests: data.specialRequests || "",
    status: data.status || "confirmed",
    source: data.source || "manual",
    rawData: data.rawData || "",
    createdAt: new Date().toISOString(),
    syncedAt: "",
  });
}

export async function updateBookingStatus(id: number, status: string) {
  const db = getDb();
  return db.update(bookings).set({ status }).where(eq(bookings.id, id));
}

export async function deleteBooking(id: number) {
  const db = getDb();
  return db.delete(bookings).where(eq(bookings.id, id));
}
