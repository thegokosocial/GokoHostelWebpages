import { and, asc, eq, or, sql } from "drizzle-orm";
import { getDb } from "./index";
import {
  dorms,
  roomTypeMapping,
  siteCommunitySpaces,
  siteEvents,
  siteHeroVideos,
  sitePageCopy,
  sitePageHeroes,
  sitePropertyContent,
  siteRoomContent,
} from "./schema";

export type SiteEventRow = typeof siteEvents.$inferSelect;
export type SiteCommunitySpaceRow = typeof siteCommunitySpaces.$inferSelect;
export type SitePageCopyRow = typeof sitePageCopy.$inferSelect;
export type SiteRoomContentRow = typeof siteRoomContent.$inferSelect;
export type SitePropertyContentRow = typeof sitePropertyContent.$inferSelect;
export type SiteHeroVideoRow = typeof siteHeroVideos.$inferSelect;
export type SitePageHeroRow = typeof sitePageHeroes.$inferSelect;

function nowIso() {
  return new Date().toISOString();
}

export async function getSiteEvents(isPast?: boolean) {
  const db = getDb();
  if (isPast === undefined) {
    return db.select().from(siteEvents).orderBy(asc(siteEvents.isPast), asc(siteEvents.displayOrder), asc(siteEvents.id));
  }
  return db
    .select()
    .from(siteEvents)
    .where(eq(siteEvents.isPast, isPast ? 1 : 0))
    .orderBy(asc(siteEvents.displayOrder), asc(siteEvents.id));
}

export async function getSiteEventById(id: number) {
  const db = getDb();
  const rows = await db.select().from(siteEvents).where(eq(siteEvents.id, id)).limit(1);
  return rows[0] || null;
}

export async function addSiteEvent(data: {
  date: string;
  title: string;
  description: string;
  tags: string;
  isPast: number;
  coverUrl: string;
  photos: string;
  displayOrder: number;
}) {
  const db = getDb();
  return db.insert(siteEvents).values({ ...data, updatedAt: nowIso() });
}

export async function updateSiteEvent(id: number, data: Partial<{
  date: string;
  title: string;
  description: string;
  tags: string;
  isPast: number;
  coverUrl: string;
  photos: string;
  displayOrder: number;
}>) {
  const db = getDb();
  return db.update(siteEvents).set({ ...data, updatedAt: nowIso() }).where(eq(siteEvents.id, id));
}

export async function deleteSiteEvent(id: number) {
  const db = getDb();
  return db.delete(siteEvents).where(eq(siteEvents.id, id));
}

export async function getSiteCommunitySpaces() {
  const db = getDb();
  return db.select().from(siteCommunitySpaces).orderBy(asc(siteCommunitySpaces.displayOrder), asc(siteCommunitySpaces.id));
}

export async function getSiteCommunitySpaceById(id: number) {
  const db = getDb();
  const rows = await db.select().from(siteCommunitySpaces).where(eq(siteCommunitySpaces.id, id)).limit(1);
  return rows[0] || null;
}

export async function addSiteCommunitySpace(data: {
  title: string;
  icon: string;
  description: string;
  imageUrl: string;
  photos: string;
  displayOrder: number;
}) {
  const db = getDb();
  return db.insert(siteCommunitySpaces).values({ ...data, updatedAt: nowIso() });
}

export async function updateSiteCommunitySpace(id: number, data: Partial<{
  title: string;
  icon: string;
  description: string;
  imageUrl: string;
  photos: string;
  displayOrder: number;
}>) {
  const db = getDb();
  return db.update(siteCommunitySpaces).set({ ...data, updatedAt: nowIso() }).where(eq(siteCommunitySpaces.id, id));
}

export async function deleteSiteCommunitySpace(id: number) {
  const db = getDb();
  return db.delete(siteCommunitySpaces).where(eq(siteCommunitySpaces.id, id));
}

export async function getSitePageCopy(page: string) {
  const db = getDb();
  const rows = await db.select().from(sitePageCopy).where(eq(sitePageCopy.page, page)).limit(1);
  return rows[0] || null;
}

export async function upsertSitePageCopy(page: string, content: string) {
  const db = getDb();
  const existing = await getSitePageCopy(page);
  if (existing) {
    return db.update(sitePageCopy).set({ content, updatedAt: nowIso() }).where(eq(sitePageCopy.page, page));
  }
  return db.insert(sitePageCopy).values({ page, content, updatedAt: nowIso() });
}

export async function getAccommodationContentRows() {
  const db = getDb();
  const [rooms, content, mappings, property] = await Promise.all([
    db.select({ id: dorms.id, name: dorms.name, deletedAt: dorms.deletedAt }).from(dorms),
    db.select().from(siteRoomContent),
    db.select({ dormId: roomTypeMapping.dormId, isActive: roomTypeMapping.isActive }).from(roomTypeMapping),
    db.select().from(sitePropertyContent).where(eq(sitePropertyContent.id, 1)).limit(1),
  ]);
  return { rooms, content, mappings, property: property[0] || null };
}

export async function saveSiteRoomContent(data: typeof siteRoomContent.$inferInsert, revision: string) {
  const db = getDb();
  const now = nowIso();
  if (!data.dormId) return [];
  if (revision === "missing") {
    return db.insert(siteRoomContent).values({ ...data, updatedAt: now })
      .onConflictDoNothing({ target: siteRoomContent.dormId }).returning();
  }
  return db.update(siteRoomContent).set({ ...data, updatedAt: now })
    .where(and(eq(siteRoomContent.dormId, data.dormId), eq(siteRoomContent.updatedAt, revision))).returning();
}

export async function saveSitePropertyContent(data: Omit<typeof sitePropertyContent.$inferInsert, "id">, revision: string) {
  const db = getDb();
  const now = nowIso();
  if (revision === "missing") {
    return db.insert(sitePropertyContent).values({ id: 1, ...data, updatedAt: now })
      .onConflictDoNothing({ target: sitePropertyContent.id }).returning();
  }
  return db.update(sitePropertyContent).set({ ...data, updatedAt: now })
    .where(and(eq(sitePropertyContent.id, 1), eq(sitePropertyContent.updatedAt, revision))).returning();
}

/** True if any CMS row still points at this public media URL. */
export async function countMediaUrlRefs(url: string): Promise<number> {
  if (!url) return 0;
  const db = getDb();
  const [events] = await db
    .select({ n: sql<number>`count(*)` })
    .from(siteEvents)
    .where(or(eq(siteEvents.coverUrl, url), sql`instr(${siteEvents.photos}, ${url}) > 0`));
  const [spaces] = await db
    .select({ n: sql<number>`count(*)` })
    .from(siteCommunitySpaces)
    .where(or(eq(siteCommunitySpaces.imageUrl, url), sql`instr(${siteCommunitySpaces.photos}, ${url}) > 0`));
  const [copy] = await db
    .select({ n: sql<number>`count(*)` })
    .from(sitePageCopy)
    .where(sql`instr(${sitePageCopy.content}, ${url}) > 0`);
  const [rooms] = await db.select({ n: sql<number>`count(*)` }).from(siteRoomContent)
    .where(or(sql`instr(${siteRoomContent.roomPhotos}, ${url}) > 0`, sql`instr(${siteRoomContent.washroomPhotos}, ${url}) > 0`));
  const [property] = await db.select({ n: sql<number>`count(*)` }).from(sitePropertyContent)
    .where(or(sql`instr(${sitePropertyContent.exteriorPhotos}, ${url}) > 0`, sql`instr(${sitePropertyContent.commonPhotos}, ${url}) > 0`, sql`instr(${sitePropertyContent.washroomPhotos}, ${url}) > 0`));
  const [heroes] = await db
    .select({ n: sql<number>`count(*)` })
    .from(siteHeroVideos)
    .where(or(eq(siteHeroVideos.url, url), eq(siteHeroVideos.posterUrl, url)));
  return (
    Number(events?.n ?? 0)
    + Number(spaces?.n ?? 0)
    + Number(copy?.n ?? 0)
    + Number(rooms?.n ?? 0)
    + Number(property?.n ?? 0)
    + Number(heroes?.n ?? 0)
  );
}

export async function getSiteHeroVideos() {
  const db = getDb();
  return db.select().from(siteHeroVideos).orderBy(asc(siteHeroVideos.slot), asc(siteHeroVideos.createdAt));
}

export async function getSiteHeroVideoById(id: string) {
  const db = getDb();
  const rows = await db.select().from(siteHeroVideos).where(eq(siteHeroVideos.id, id)).limit(1);
  return rows[0] || null;
}

export async function addSiteHeroVideo(data: {
  id: string;
  slot: string;
  label: string;
  url: string;
  posterUrl: string;
  bytes: number;
  width: number;
  height: number;
}) {
  const db = getDb();
  const now = nowIso();
  await db.insert(siteHeroVideos).values({ ...data, createdAt: now, updatedAt: now });
  return getSiteHeroVideoById(data.id);
}

export async function deleteSiteHeroVideo(id: string) {
  const db = getDb();
  await db.delete(siteHeroVideos).where(eq(siteHeroVideos.id, id));
}

export async function countPageHeroRefs(videoId: string): Promise<number> {
  if (!videoId) return 0;
  const db = getDb();
  const [row] = await db
    .select({ n: sql<number>`count(*)` })
    .from(sitePageHeroes)
    .where(or(eq(sitePageHeroes.desktopVideoId, videoId), eq(sitePageHeroes.mobileVideoId, videoId)));
  return Number(row?.n ?? 0);
}

export async function getSitePageHeroes() {
  const db = getDb();
  return db.select().from(sitePageHeroes).orderBy(asc(sitePageHeroes.page));
}

export async function upsertSitePageHero(page: string, desktopVideoId: string, mobileVideoId: string) {
  const db = getDb();
  const now = nowIso();
  await db
    .insert(sitePageHeroes)
    .values({ page, desktopVideoId, mobileVideoId, updatedAt: now })
    .onConflictDoUpdate({
      target: sitePageHeroes.page,
      set: { desktopVideoId, mobileVideoId, updatedAt: now },
    });
  const rows = await db.select().from(sitePageHeroes).where(eq(sitePageHeroes.page, page)).limit(1);
  return rows[0] || null;
}
