import { eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { getAllBeds } from "@/db/queries";
import { nativeAcceptedQuotes as quotes } from "@/db/schema";
import { sellableUnits } from "@/lib/inventoryAvailability";
import { buildNativeBookingQuote } from "@/lib/nativeBookingQuote";
import { getNativeInventoryHold, NativeHoldError, requireNativeHoldGuards } from "@/lib/nativeInventoryHold";

type Owner = Parameters<typeof getNativeInventoryHold>[0];
type QuoteInput = Parameters<typeof buildNativeBookingQuote>[0];
function result(row: typeof quotes.$inferSelect) {
  // Recompute/validate stored evidence instead of trusting duplicated computed JSON fields.
  const stored = JSON.parse(row.quoteJson), { currency, nativeCheckoutReady, beforeTaxRupees, taxRupees,
    totalRupees, dueNowPaise, dueAtPropertyPaise, totalPaise, ...input } = stored;
  const quote = buildNativeBookingQuote(input);
  if (currency !== quote.currency || nativeCheckoutReady !== false || beforeTaxRupees !== quote.beforeTaxRupees ||
    taxRupees !== quote.taxRupees || totalRupees !== quote.totalRupees || dueNowPaise !== quote.dueNowPaise ||
    dueAtPropertyPaise !== quote.dueAtPropertyPaise || totalPaise !== quote.totalPaise) throw new Error("Invalid accepted quote evidence");
  return { id: row.id, holdId: row.holdId, acceptedAt: row.acceptedAt, quote, nativeCheckoutReady: false as const };
}
async function read(holdId: string) {
  try { return (await getDb().select().from(quotes).where(eq(quotes.holdId, holdId)).limit(1))[0]; }
  catch { throw new NativeHoldError("Accepted quote storage unavailable; recover the original request", 503); }
}
function safeResult(row: typeof quotes.$inferSelect) {
  try { return result(row); } catch { throw new NativeHoldError("Accepted quote evidence requires review", 503); }
}
/** Owner-bound read-only recovery; accepted terms survive disable/release/expiry. */
export async function getNativeAcceptedQuote(owner: Owner) {
  const hold = await getNativeInventoryHold(owner), row = await read(hold.id);
  if (!row) throw new NativeHoldError("Accepted quote not found", 404);
  return safeResult(row);
}
/** Internal trusted-server acceptance only; never expose submitted rates/policies directly to guests. */
export async function acceptNativeQuote(owner: Owner, input: QuoteInput) {
  const hold = await getNativeInventoryHold(owner), quote = buildNativeBookingQuote(input), quoteJson = JSON.stringify(quote);
  const existing = await read(hold.id);
  if (existing) {
    if (existing.quoteJson !== quoteJson) throw new NativeHoldError("The hold already has different accepted terms");
    return safeResult(existing);
  }
  if (process.env.GOKO_NATIVE_HOLD_INTERNAL_ENABLED !== "true") throw new NativeHoldError("Internal quote acceptance is disabled", 403);
  await requireNativeHoldGuards();
  if (quote.checkinDate !== hold.checkinDate || quote.checkoutDate !== hold.checkoutDate) throw new NativeHoldError("Quote dates do not match the hold");
  const db = getDb();
  try {
    await db.select().from(quotes).limit(0);
    const guards = await db.select({ name: sql<string>`name` }).from(sql`sqlite_master`)
      .where(sql`type='trigger' AND tbl_name='native_accepted_quotes' AND name IN ('native_quote_insert_guard','native_quote_immutable','native_quote_retained')`);
    if (guards.length !== 3) throw new Error("Incomplete quote guards");
  } catch { throw new NativeHoldError("Accepted quote storage is not ready", 503); }
  let allBeds: Awaited<ReturnType<typeof getAllBeds>>;
  try { allBeds = await getAllBeds(); } catch { throw new NativeHoldError("Quote allocation validation unavailable", 503); }
  const ids = new Set(hold.bedIds);
  const units = sellableUnits(allBeds).filter((unit) => unit.beds.some((bed) => ids.has(bed.id)));
  if (units.some((unit) => !unit.beds.every((bed) => ids.has(bed.id)) || (unit.type === "Double" && unit.beds.length !== 2)) ||
    units.flatMap((unit) => unit.beds).length !== ids.size || units.length !== quote.units.length ||
    units.some((unit) => !quote.units.some((priced) => priced.key === unit.key))) throw new NativeHoldError("Quote units do not match the held allocation");
  try {
    const inserted = await db.insert(quotes).values({ id: crypto.randomUUID(), holdId: hold.id, quoteJson, acceptedAt: Math.floor(Date.now() / 1000) })
      .onConflictDoNothing({ target: quotes.holdId }).returning();
    if (inserted.length) return safeResult(inserted[0]);
  } catch (error) {
    const message = [error instanceof Error ? error.message : "", error instanceof Error && error.cause instanceof Error ? error.cause.message : ""].join(" ");
    // Concurrent winner may have accepted immediately before release/expiry.
    const recovered = await read(hold.id);
    if (recovered) {
      if (recovered.quoteJson !== quoteJson) throw new NativeHoldError("The hold already has different accepted terms");
      return safeResult(recovered);
    }
    if (message.includes("NATIVE_QUOTE_HOLD_CLOSED")) throw new NativeHoldError("The inventory hold expired or was released");
    throw new NativeHoldError("Quote acceptance result unavailable; recover the original request", 503);
  }
  const recovered = await read(hold.id);
  if (!recovered) throw new NativeHoldError("Quote acceptance result unavailable; recover the original request", 503);
  if (recovered.quoteJson !== quoteJson) throw new NativeHoldError("The hold already has different accepted terms");
  return safeResult(recovered);
}
