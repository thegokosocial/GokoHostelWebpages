import { NextResponse } from "next/server";
import { asc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { quickLinkSections, quickLinks } from "@/db/schema";

export async function GET() {
  try {
    const db = getDb();
    const sections = await db.select().from(quickLinkSections).orderBy(asc(quickLinkSections.displayOrder), asc(quickLinkSections.id));
    const items = await db.select().from(quickLinks).where(eq(quickLinks.isActive, 1)).orderBy(asc(quickLinks.displayOrder), asc(quickLinks.id));
    return NextResponse.json({ sections, items }, { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" } });
  } catch (error) {
    console.error("Public quick links error:", error);
    return NextResponse.json({ error: "Unable to load links" }, { status: 500 });
  }
}
