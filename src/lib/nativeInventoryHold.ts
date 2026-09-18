import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { nativeInventoryHolds as holds } from "@/db/schema";
import { getAllBeds, getAvailableBedsForRange } from "@/db/queries";
import { afterResponse } from "@/lib/afterResponse";
import { otaFingerprint, pushIfOtaChanged } from "@/lib/aiosellSync";
import { occupiedNights, sellableUnits } from "@/lib/inventoryAvailability";
import { isPiRuntime } from "@/lib/runtime";
import { todayIST } from "@/lib/utils";

const date = z.string().regex(/^20\d{2}-\d{2}-\d{2}$/).refine((s) => {
  const d = new Date(`${s}T00:00:00Z`); return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === s;
}, "Invalid calendar date");
const recoverySchema = z.object({ requestKey: z.string().uuid(), ownerToken: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
const inputSchema = z.object({ requestKey: z.string().uuid(), ownerToken: z.string().regex(/^[a-f0-9]{64}$/),
  bedIds: z.array(z.number().int().positive()).min(1).max(4).refine((ids) => new Set(ids).size === ids.length),
  checkinDate: date, checkoutDate: date,
  /** Lease length in seconds; clamped to [300, 900] to match settings min (5m) and DB max (15m). */
  holdSeconds: z.number().int().min(300).max(900).optional(),
  /** Guest amend: allow hold to overlap this booking's own assignments. */
  excludeBookingId: z.number().int().positive().optional(),
}).strict().refine((s) => s.checkoutDate > s.checkinDate &&
  (Date.parse(s.checkoutDate) - Date.parse(s.checkinDate)) / 86400000 <= 30, "Stay must be 1–30 nights");
const staySchemaWithExclude = z.object({
  checkinDate: date, checkoutDate: date,
  excludeBookingId: z.number().int().positive().optional(),
}).strict().refine((s) => s.checkoutDate > s.checkinDate &&
  (Date.parse(s.checkoutDate) - Date.parse(s.checkinDate)) / 86400000 <= 30, "Stay must be 1–30 nights");
export function clampHoldSeconds(seconds?: number) {
  if (seconds == null || !Number.isFinite(seconds)) return 900;
  return Math.min(900, Math.max(300, Math.trunc(seconds)));
}
export class NativeHoldError extends Error {
  constructor(message: string, public status = 409) { super(message); this.name = "NativeHoldError"; }
}
const hash = async (s: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))), (b) => b.toString(16).padStart(2, "0")).join("");
function cloudOnly() { if (isPiRuntime()) throw new NativeHoldError("Native holds are Cloudflare-owned", 403); }
function enabled() { if (process.env.GOKO_NATIVE_HOLD_INTERNAL_ENABLED !== "true") throw new NativeHoldError("Internal native hold creation is disabled", 403); }
function arrivalWithinWindow(checkinDate: string) {
  const today = todayIST();
  if (checkinDate < today || Date.parse(checkinDate) - Date.parse(today) > 365 * 86400000) throw new NativeHoldError("Arrival must be within the next 365 days", 400);
}
export async function requireNativeHoldGuards() {
  try {
    const db = getDb();
    await db.select().from(holds).limit(0); // Checks every mapped column, including on an empty table.
    const required = [["native_hold_insert_guard", "native_inventory_holds"], ["native_hold_immutable", "native_inventory_holds"],
      ["assignment_native_hold_insert_guard", "booking_bed_assignments"], ["assignment_native_hold_update_guard", "booking_bed_assignments"],
      ["block_native_hold_insert_guard", "bed_blocks"], ["block_native_hold_update_guard", "bed_blocks"]];
    const rows = await db.select({ name: sql<string>`name` }).from(sql`sqlite_master`)
      .where(sql`type = 'trigger' AND (${sql.join(required.map(([name, table]) => sql`(name = ${name} AND tbl_name = ${table})`), sql` OR `)})`);
    if (rows.length !== required.length) throw new Error("Incomplete hold guards");
  } catch { throw new NativeHoldError("Native inventory storage is not ready", 503); }
}
function snapshot(row: typeof holds.$inferSelect) {
  return { id: row.id, requestKey: row.requestKey, bedIds: JSON.parse(row.bedIds) as number[], checkinDate: row.checkinDate,
    checkoutDate: row.checkoutDate, expiresAt: row.expiresAt,
    state: row.state === "released" ? "released" : row.expiresAt <= Math.floor(Date.now() / 1000) ? "expired" : "held",
    nativeCheckoutReady: false as const };
}

async function pushHoldOtaChange(
  bedIds: number[],
  checkinDate: string,
  checkoutDate: string,
  before: string,
  allBeds: Awaited<ReturnType<typeof getAllBeds>>,
) {
  const bedMeta = new Map(allBeds.map((b) => [b.id, b]));
  const dormIds = [...new Set(bedIds.map((id) => bedMeta.get(id)?.dormId).filter((id): id is number => id != null))];
  const nights = occupiedNights(checkinDate, checkoutDate);
  if (dormIds.length === 0 || nights.length === 0) return;
  try { await pushIfOtaChanged(before, dormIds, nights); } catch { /* best-effort */ }
}

/** Read-only original-request recovery, including after creation is disabled. */
export async function getNativeInventoryHold(input: z.input<typeof recoverySchema>) {
  cloudOnly(); const parsed = recoverySchema.parse(input), ownerHash = await hash(parsed.ownerToken);
  let rows: (typeof holds.$inferSelect)[];
  try {
    rows = await getDb().select().from(holds).where(and(eq(holds.requestKey, parsed.requestKey), eq(holds.ownerHash, ownerHash))).limit(1);
  } catch { throw new NativeHoldError("Hold recovery unavailable; retain the original request key", 503); }
  if (!rows.length) throw new NativeHoldError("Hold not found", 404);
  return snapshot(rows[0]);
}

/** INTERNAL ONLY. Advisory selection, not a quote or an atomic category/quota promise. */
export async function getNativeSelectionAvailability(input: z.input<typeof staySchemaWithExclude>) {
  cloudOnly(); const parsed = staySchemaWithExclude.parse(input); enabled(); arrivalWithinWindow(parsed.checkinDate);
  await requireNativeHoldGuards();
  try {
    const [allBeds, available, active] = await Promise.all([
      getAllBeds(),
      getAvailableBedsForRange(parsed.checkinDate, parsed.checkoutDate, undefined, parsed.excludeBookingId),
      getDb().select({ bedIds: holds.bedIds }).from(holds).where(and(eq(holds.state, "held"),
        sql`${holds.expiresAt} > CAST(strftime('%s','now') AS INTEGER)`,
        sql`${holds.checkinDate} < ${parsed.checkoutDate}`, sql`${holds.checkoutDate} > ${parsed.checkinDate}`)),
    ]);
    const heldIds = new Set(active.flatMap((row) => JSON.parse(row.bedIds) as number[]));
    const onlineIds = new Set(available.filter((b) => b.pool === "online" && !heldIds.has(b.id)).map((b) => b.id));
    return { checkinDate: parsed.checkinDate, checkoutDate: parsed.checkoutDate, nativeCheckoutReady: false as const,
      units: sellableUnits(allBeds).filter((unit) => (unit.type !== "Double" || unit.beds.length === 2) && unit.beds.every((b) => b.id !== undefined && onlineIds.has(b.id)))
        .map((unit) => ({ key: unit.key, dormId: unit.dormId, type: unit.type, capacity: unit.capacity, bedIds: unit.beds.map((b) => b.id) })),
    };
  } catch { throw new NativeHoldError("Native selection availability is unavailable", 503); }
}

/** INTERNAL ONLY. Physical-unit atomicity, not yet a public category/quota hold. */
export async function createNativeInventoryHold(input: z.input<typeof inputSchema>) {
  cloudOnly(); const parsed = inputSchema.parse(input), db = getDb();
  const bedIds = [...parsed.bedIds].sort((a, b) => a - b), ownerHash = await hash(parsed.ownerToken);
  const requestHash = await hash(JSON.stringify({
    bedIds, checkinDate: parsed.checkinDate, checkoutDate: parsed.checkoutDate,
    excludeBookingId: parsed.excludeBookingId ?? null,
  }));
  let existing: typeof holds.$inferSelect | undefined;
  try { [existing] = await db.select().from(holds).where(eq(holds.requestKey, parsed.requestKey)).limit(1); }
  catch { throw new NativeHoldError("Hold recovery unavailable; retain the original request key", 503); }
  if (existing) {
    const [owned] = await db.select().from(holds).where(and(eq(holds.id, existing.id), eq(holds.ownerHash, ownerHash))).limit(1);
    if (!owned) throw new NativeHoldError("Hold not found", 404);
    if (owned.requestHash !== requestHash) throw new NativeHoldError("Request key already belongs to a different selection");
    return snapshot(owned); // Recovery survives disable/expiry; never renews.
  }
  enabled(); arrivalWithinWindow(parsed.checkinDate); await requireNativeHoldGuards();
  let allBeds: Awaited<ReturnType<typeof getAllBeds>>, available: Awaited<ReturnType<typeof getAvailableBedsForRange>>;
  try {
    [allBeds, available] = await Promise.all([
      getAllBeds(),
      getAvailableBedsForRange(parsed.checkinDate, parsed.checkoutDate, undefined, parsed.excludeBookingId),
    ]);
  }
  catch { throw new NativeHoldError("Native selection availability is unavailable", 503); }
  const selected = new Set(bedIds);
  if (bedIds.some((id) => !available.some((b) => b.id === id && b.pool === "online"))) throw new NativeHoldError("Selected units are unavailable online");
  if (sellableUnits(allBeds).some((unit) => unit.type === "Double" && unit.beds.some((b) => selected.has(b.id)) && (unit.beds.length !== 2 || !unit.beds.every((b) => selected.has(b.id))))) throw new NativeHoldError("Select a complete double unit");
  const dormIds = [...new Set(bedIds.map((id) => allBeds.find((b) => b.id === id)?.dormId).filter((id): id is number => id != null))];
  const nights = occupiedNights(parsed.checkinDate, parsed.checkoutDate);
  let before = "";
  try { before = await otaFingerprint(dormIds, nights); } catch { before = ""; }
  const createdAt = Math.floor(Date.now() / 1000);
  const lease = clampHoldSeconds(parsed.holdSeconds);
  try {
    const rows = await db.insert(holds).values({
      id: crypto.randomUUID(), requestKey: parsed.requestKey, requestHash, ownerHash,
      bedIds: JSON.stringify(bedIds), checkinDate: parsed.checkinDate, checkoutDate: parsed.checkoutDate,
      createdAt, expiresAt: createdAt + lease,
      excludeBookingId: parsed.excludeBookingId ?? null,
    }).onConflictDoNothing({ target: holds.requestKey }).returning();
    if (rows.length) {
      // Inventory is held in D1 immediately; Aiosell push must not block checkout UX.
      if (before) await afterResponse(pushHoldOtaChange(bedIds, parsed.checkinDate, parsed.checkoutDate, before, allBeds));
      return snapshot(rows[0]);
    }
  } catch (error) {
    const message = [error instanceof Error ? error.message : "", error instanceof Error && error.cause instanceof Error ? error.cause.message : ""].join(" ");
    if (message.includes("NATIVE_HOLD_CONFLICT")) throw new NativeHoldError("Selected units were just reserved; choose another selection");
    throw new NativeHoldError("Hold result unavailable. Recover the original request before retrying", 503);
  }
  const [owned] = await db.select().from(holds).where(and(eq(holds.requestKey, parsed.requestKey), eq(holds.ownerHash, ownerHash))).limit(1);
  if (!owned) throw new NativeHoldError("Unable to recover the original hold request", 503);
  if (owned.requestHash !== requestHash) throw new NativeHoldError("Request key already belongs to a different selection");
  return snapshot(owned); // Concurrent same-key owner; no repeat insert / no Aiosell push.
}
export async function releaseNativeInventoryHold(id: string, ownerToken: string) {
  cloudOnly(); z.string().uuid().parse(id); z.string().regex(/^[a-f0-9]{64}$/).parse(ownerToken);
  const ownerHash = await hash(ownerToken);
  let owned: typeof holds.$inferSelect | undefined;
  try {
    [owned] = await getDb().select().from(holds).where(and(eq(holds.id, id), eq(holds.ownerHash, ownerHash))).limit(1);
  } catch { throw new NativeHoldError("Hold release result unavailable; recover the original request", 503); }
  if (!owned) throw new NativeHoldError("Hold not found", 404);
  const bedIds = JSON.parse(owned.bedIds) as number[];
  let before = "";
  let allBeds: Awaited<ReturnType<typeof getAllBeds>> = [];
  if (owned.state === "held") {
    try { allBeds = await getAllBeds(); } catch { allBeds = []; }
    const dormIds = [...new Set(bedIds.map((id) => allBeds.find((b) => b.id === id)?.dormId).filter((id): id is number => id != null))];
    const nights = occupiedNights(owned.checkinDate, owned.checkoutDate);
    try { before = await otaFingerprint(dormIds, nights); } catch { before = ""; }
  }
  let rows: (typeof holds.$inferSelect)[];
  try { rows = await getDb().update(holds).set({ state: "released" }).where(and(eq(holds.id, id), eq(holds.ownerHash, ownerHash))).returning(); }
  catch { throw new NativeHoldError("Hold release result unavailable; recover the original request", 503); }
  if (!rows.length) throw new NativeHoldError("Hold not found", 404);
  if (before) await afterResponse(pushHoldOtaChange(bedIds, owned.checkinDate, owned.checkoutDate, before, allBeds));
  return snapshot(rows[0]);
}
