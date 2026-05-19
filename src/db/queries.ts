import { eq, desc } from "drizzle-orm";
import { getDb } from "./index";
import { checkins, dorms, beds, bedHistory, settings, apiStats } from "./schema";

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
