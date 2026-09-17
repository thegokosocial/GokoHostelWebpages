import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { settings } from "@/db/schema";
import { WEBSITE_BOOKING_SETTINGS_KEY } from "@/lib/websiteBookingSettings";

/** Single-statement compare-and-set; two admins cannot silently replace an edit. */
export async function compareAndSetWebsiteSettings(expectedRaw: string | null, nextRaw: string): Promise<boolean> {
  const db = getDb(), fields = { value: nextRaw, syncUpdatedAt: new Date().toISOString(), syncSource: "cloudflare" };
  if (expectedRaw === null) {
    const rows = await db.insert(settings).values({ key: WEBSITE_BOOKING_SETTINGS_KEY, ...fields })
      .onConflictDoNothing({ target: settings.key }).returning({ key: settings.key });
    return rows.length === 1;
  }
  const rows = await db.update(settings).set(fields).where(and(eq(settings.key, WEBSITE_BOOKING_SETTINGS_KEY), eq(settings.value, expectedRaw)))
    .returning({ key: settings.key });
  return rows.length === 1;
}
