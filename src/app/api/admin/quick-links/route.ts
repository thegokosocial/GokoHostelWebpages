import { NextRequest, NextResponse } from "next/server";
import { asc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { quickLinkSections, quickLinks } from "@/db/schema";
import { actionAllowed } from "@/lib/actionPermissions";
import { authenticateUser } from "@/lib/auth";
import { sanitizeSiteImageUrl } from "@/lib/mediaKeys";

const MAX_NAME = 80;
const MAX_TEXT = 500;

function cleanText(value: unknown, max = MAX_TEXT) {
  return String(value ?? "").trim().slice(0, max);
}

function cleanUrl(value: unknown) {
  const raw = cleanText(value, 2000);
  if (!raw) return "";
  try {
    const url = new URL(raw);
    if (!["http:", "https:"].includes(url.protocol)) throw new Error();
    return url.toString();
  } catch {
    throw new Error("URL must start with http:// or https://");
  }
}

function orderOf(rows: { displayOrder: number }[]) {
  return rows.reduce((max, row) => Math.max(max, row.displayOrder), -1) + 1;
}

async function authorize(body: Record<string, unknown>, mutation = false) {
  const auth = await authenticateUser(String(body.password || ""), body.username ? String(body.username) : undefined);
  if (!auth) return { response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  const access = actionAllowed(auth.role, auth.permissions, mutation ? "admin_only" : "canViewQuickLinks");
  if (access !== "allowed") return { response: NextResponse.json({ error: access === "admin_required" ? "Admin access required" : "Insufficient permissions" }, { status: 403 }) };
  return { auth };
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as Record<string, unknown>;
    const action = String(body.action || "list");
    const gate = await authorize(body, action !== "list");
    if (gate.response) return gate.response;
    const db = getDb();

    if (action === "list") {
      const sections = await db.select().from(quickLinkSections).orderBy(asc(quickLinkSections.displayOrder), asc(quickLinkSections.id));
      const items = await db.select().from(quickLinks).orderBy(asc(quickLinks.displayOrder), asc(quickLinks.id));
      return NextResponse.json({ sections, items });
    }

    if (action === "saveSection") {
      const name = cleanText(body.name, MAX_NAME);
      if (!name) return NextResponse.json({ error: "Section name is required" }, { status: 400 });
      const now = new Date().toISOString();
      const id = Number(body.id || 0);
      if (id) {
        await db.update(quickLinkSections).set({ name, description: cleanText(body.description), updatedAt: now }).where(eq(quickLinkSections.id, id));
      } else {
        const rows = await db.select({ displayOrder: quickLinkSections.displayOrder }).from(quickLinkSections);
        await db.insert(quickLinkSections).values({ name, description: cleanText(body.description), displayOrder: orderOf(rows), createdAt: now, updatedAt: now });
      }
      return NextResponse.json({ success: true });
    }

    if (action === "deleteSection") {
      const id = Number(body.id);
      if (!id) return NextResponse.json({ error: "Section ID is required" }, { status: 400 });
      await db.delete(quickLinks).where(eq(quickLinks.sectionId, id));
      await db.delete(quickLinkSections).where(eq(quickLinkSections.id, id));
      return NextResponse.json({ success: true });
    }

    if (action === "saveItem") {
      const sectionId = Number(body.sectionId);
      const title = cleanText(body.title, MAX_NAME);
      if (!sectionId || !title) return NextResponse.json({ error: "Section and title are required" }, { status: 400 });
      const section = await db.select({ id: quickLinkSections.id }).from(quickLinkSections).where(eq(quickLinkSections.id, sectionId)).limit(1);
      if (!section[0]) return NextResponse.json({ error: "Section not found" }, { status: 404 });
      let url = "";
      try { url = cleanUrl(body.url); } catch (error) { return NextResponse.json({ error: (error as Error).message }, { status: 400 }); }
      const imageUrl = sanitizeSiteImageUrl(String(body.imageUrl || ""));
      const now = new Date().toISOString();
      const id = Number(body.id || 0);
      if (id) {
        await db.update(quickLinks).set({ sectionId, title, description: cleanText(body.description), url, imageUrl, isActive: body.isActive === false ? 0 : 1, updatedAt: now }).where(eq(quickLinks.id, id));
      } else {
        const rows = await db.select({ displayOrder: quickLinks.displayOrder }).from(quickLinks).where(eq(quickLinks.sectionId, sectionId));
        await db.insert(quickLinks).values({ sectionId, title, description: cleanText(body.description), url, imageUrl, displayOrder: orderOf(rows), isActive: 1, createdAt: now, updatedAt: now });
      }
      return NextResponse.json({ success: true });
    }

    if (action === "deleteItem") {
      const id = Number(body.id);
      if (!id) return NextResponse.json({ error: "Item ID is required" }, { status: 400 });
      await db.delete(quickLinks).where(eq(quickLinks.id, id));
      return NextResponse.json({ success: true });
    }

    if (action === "reorder") {
      const kind = body.kind === "sections" ? "sections" : "items";
      const ids = Array.isArray(body.ids) ? body.ids.map(Number).filter((id) => Number.isInteger(id) && id > 0) : [];
      const table = kind === "sections" ? quickLinkSections : quickLinks;
      await Promise.all(ids.map((id, index) => db.update(table).set({ displayOrder: index, updatedAt: new Date().toISOString() }).where(eq(table.id, id))));
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    console.error("Quick links error:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Internal error" }, { status: 500 });
  }
}

export async function GET() {
  try {
    const db = getDb();
    const sections = await db.select().from(quickLinkSections).orderBy(asc(quickLinkSections.displayOrder), asc(quickLinkSections.id));
    const items = await db.select().from(quickLinks).where(eq(quickLinks.isActive, 1)).orderBy(asc(quickLinks.displayOrder), asc(quickLinks.id));
    return NextResponse.json({ sections, items }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Public quick links error:", error);
    return NextResponse.json({ error: "Unable to load links" }, { status: 500 });
  }
}
