import { NextRequest, NextResponse } from "next/server";
import { authenticateUser } from "@/lib/auth";
import { isPiRuntime } from "@/lib/runtime";
import { deleteMediaKeys } from "@/lib/mediaR2";
import { collectMediaKeys, keyToMediaUrl, mediaUrlToKey, releasedMediaKeys, sanitizeSiteImageUrl } from "@/lib/mediaKeys";
import { defaultCommunityCopy, defaultEventsCopy, mergeGallery, parseCommunityCopy, parseEventsCopy, parseJsonArray } from "@/lib/siteCopy";
import {
  addSiteCommunitySpace,
  addSiteEvent,
  addSiteHeroVideo,
  countMediaUrlRefs,
  countPageHeroRefs,
  deleteSiteCommunitySpace,
  deleteSiteEvent,
  deleteSiteHeroVideo,
  getSiteCommunitySpaceById,
  getSiteCommunitySpaces,
  getSiteEventById,
  getSiteEvents,
  getSiteHeroVideoById,
  getSiteHeroVideos,
  getSitePageCopy,
  updateSiteCommunitySpace,
  updateSiteEvent,
  upsertSitePageCopy,
  upsertSitePageHero,
} from "@/db/siteQueries";
import {
  isHeroPageKey,
  sanitizeHeroMediaUrl,
  validateAssignmentIds,
  type HeroLibraryItem,
  type HeroVideoSlot,
} from "@/lib/heroVideos";
import { loadHeroVideosAdminPayload } from "@/lib/loadHeroVideos";

function jsonTags(input: unknown): string {
  if (Array.isArray(input)) return JSON.stringify(input.map((t) => String(t).trim()).filter(Boolean));
  if (typeof input === "string") {
    return JSON.stringify(input.split(",").map((t) => t.trim()).filter(Boolean));
  }
  return "[]";
}

function incomingPhotoList(photos: unknown): string[] | { error: string } {
  if (photos === undefined) return [];
  if (!Array.isArray(photos)) return { error: "Photos must be an array" };
  return photos.map((t) => sanitizeSiteImageUrl(String(t).trim())).filter(Boolean);
}

function buildGallery(coverRaw: unknown, photosRaw: unknown): { coverUrl: string; photosJson: string } | { error: string } {
  const extras = incomingPhotoList(photosRaw);
  if (!Array.isArray(extras)) return extras;
  const urls = mergeGallery(sanitizeSiteImageUrl(String(coverRaw || "")), extras);
  return { coverUrl: urls[0] || "", photosJson: JSON.stringify(urls) };
}

function nextOrder(rows: { displayOrder: number }[]) {
  return rows.reduce((m, r) => Math.max(m, r.displayOrder), -1) + 1;
}

function sentRibbonImage(copy: unknown): boolean {
  const hero = copy && typeof copy === "object" && "hero" in copy ? (copy as { hero?: unknown }).hero : null;
  return Boolean(hero && typeof hero === "object" && "ribbonImage" in hero);
}

function sanitizedIncomingRibbon(copy: unknown): string {
  const hero = copy && typeof copy === "object" ? (copy as { hero?: { ribbonImage?: unknown } }).hero : undefined;
  return sanitizeSiteImageUrl(String(hero?.ribbonImage ?? ""));
}

async function safeDeleteMediaKeys(keys: string[]) {
  try {
    const drop: string[] = [];
    for (const key of keys) {
      if ((await countMediaUrlRefs(keyToMediaUrl(key))) === 0) drop.push(key);
    }
    if (drop.length) await deleteMediaKeys(drop);
  } catch (err) {
    console.error("Website media cleanup failed:", err);
  }
}

async function releaseHeroImage(prevUrl: string | undefined, nextUrl: string) {
  await safeDeleteMediaKeys(releasedMediaKeys([prevUrl || ""], [nextUrl]));
}

/** Keep in sync with iconMap in src/components/ui/Icon.tsx */
const SITE_ICONS = new Set([
  "bed", "lock", "shower", "wifi", "waves", "sofa", "utensils", "dice", "laptop", "book",
  "party", "palette", "globe", "flame", "handshake", "leaf", "umbrella", "rainbow", "heart",
  "building", "mapPin", "clipboard", "target",
]);

function safeIcon(raw: unknown): string {
  const s = String(raw || "sofa").trim();
  return SITE_ICONS.has(s) ? s : "sofa";
}

async function requireAdmin(password: unknown, username: unknown) {
  if (isPiRuntime()) {
    return { error: NextResponse.json({ error: "Website CMS is only available on the live site" }, { status: 403 }) };
  }
  const auth = await authenticateUser(String(password || ""), username ? String(username) : undefined);
  if (!auth) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (auth.role !== "admin") return { error: NextResponse.json({ error: "Admin access required" }, { status: 403 }) };
  return { auth };
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { password, username, action, ...params } = body;
    const gate = await requireAdmin(password, username);
    if (gate.error) return gate.error;

    switch (action) {
      case "getAll": {
        const [events, spaces, eventsCopy, communityCopy] = await Promise.all([
          getSiteEvents(),
          getSiteCommunitySpaces(),
          getSitePageCopy("events"),
          getSitePageCopy("community"),
        ]);
        return NextResponse.json({
          events,
          spaces,
          eventsCopy: parseEventsCopy(eventsCopy?.content ?? null) ?? defaultEventsCopy,
          communityCopy: parseCommunityCopy(communityCopy?.content ?? null) ?? defaultCommunityCopy,
        });
      }

      case "saveEventsCopy": {
        if (params.copy == null) return NextResponse.json({ error: "Copy is required" }, { status: 400 });
        const copy = parseEventsCopy(JSON.stringify(params.copy));
        if (!copy) return NextResponse.json({ error: "Invalid page copy" }, { status: 400 });
        const prevRow = await getSitePageCopy("events");
        if (sentRibbonImage(params.copy)) {
          copy.hero.ribbonImage = sanitizedIncomingRibbon(params.copy);
        } else {
          const prev = parseEventsCopy(prevRow?.content ?? null);
          if (prev) copy.hero.ribbonImage = prev.hero.ribbonImage;
        }
        await upsertSitePageCopy("events", JSON.stringify(copy));
        if (sentRibbonImage(params.copy)) {
          const prevUrl = parseEventsCopy(prevRow?.content ?? null)?.hero.ribbonImage;
          await releaseHeroImage(prevUrl, copy.hero.ribbonImage);
        }
        return NextResponse.json({ ok: true });
      }

      case "saveCommunityCopy": {
        if (params.copy == null) return NextResponse.json({ error: "Copy is required" }, { status: 400 });
        const copy = parseCommunityCopy(JSON.stringify(params.copy));
        if (!copy) return NextResponse.json({ error: "Invalid page copy" }, { status: 400 });
        const prevRow = await getSitePageCopy("community");
        if (sentRibbonImage(params.copy)) {
          copy.hero.ribbonImage = sanitizedIncomingRibbon(params.copy);
        } else {
          const prev = parseCommunityCopy(prevRow?.content ?? null);
          if (prev) copy.hero.ribbonImage = prev.hero.ribbonImage;
        }
        await upsertSitePageCopy("community", JSON.stringify(copy));
        if (sentRibbonImage(params.copy)) {
          const prevUrl = parseCommunityCopy(prevRow?.content ?? null)?.hero.ribbonImage;
          await releaseHeroImage(prevUrl, copy.hero.ribbonImage);
        }
        return NextResponse.json({ ok: true });
      }

      case "addEvent": {
        if (!String(params.title || "").trim()) return NextResponse.json({ error: "Title is required" }, { status: 400 });
        const gallery = buildGallery(params.coverUrl, params.photos);
        if ("error" in gallery) return NextResponse.json({ error: gallery.error }, { status: 400 });
        const existing = await getSiteEvents(params.isPast ? true : false);
        await addSiteEvent({
          date: String(params.date || "").trim(),
          title: String(params.title).trim(),
          description: String(params.description || "").trim(),
          tags: jsonTags(params.tags),
          isPast: params.isPast ? 1 : 0,
          coverUrl: gallery.coverUrl,
          photos: gallery.photosJson,
          displayOrder: nextOrder(existing),
        });
        return NextResponse.json({ ok: true });
      }

      case "updateEvent": {
        const id = Number(params.id);
        if (!id) return NextResponse.json({ error: "ID is required" }, { status: 400 });
        const prev = await getSiteEventById(id);
        if (!prev) return NextResponse.json({ error: "Event not found" }, { status: 404 });
        const gallery = (params.coverUrl !== undefined || params.photos !== undefined)
          ? buildGallery(
            params.coverUrl !== undefined ? params.coverUrl : prev.coverUrl,
            params.photos !== undefined ? params.photos : parseJsonArray(prev.photos),
          )
          : { coverUrl: prev.coverUrl, photosJson: prev.photos };
        if ("error" in gallery) return NextResponse.json({ error: gallery.error }, { status: 400 });
        const coverUrl = gallery.coverUrl;
        const photos = gallery.photosJson;
        const data: Parameters<typeof updateSiteEvent>[1] = { coverUrl, photos };
        if (params.date !== undefined) data.date = String(params.date);
        if (params.title !== undefined) {
          const title = String(params.title).trim();
          if (!title) return NextResponse.json({ error: "Title is required" }, { status: 400 });
          data.title = title;
        }
        if (params.description !== undefined) data.description = String(params.description);
        if (params.tags !== undefined) data.tags = jsonTags(params.tags);
        if (params.isPast !== undefined) {
          data.isPast = params.isPast ? 1 : 0;
          if (data.isPast !== prev.isPast) {
            data.displayOrder = nextOrder(await getSiteEvents(!!data.isPast));
          } else if (params.displayOrder !== undefined) {
            data.displayOrder = Number(params.displayOrder) || 0;
          }
        } else if (params.displayOrder !== undefined) {
          data.displayOrder = Number(params.displayOrder) || 0;
        }
        await updateSiteEvent(id, data);
        const prevPhotos = parseJsonArray(prev.photos);
        const nextPhotos = parseJsonArray(photos);
        const released = releasedMediaKeys(
          [prev.coverUrl, ...prevPhotos],
          [coverUrl, ...nextPhotos],
        );
        await safeDeleteMediaKeys(released);
        return NextResponse.json({ ok: true });
      }

      case "deleteEvent": {
        const id = Number(params.id);
        if (!id) return NextResponse.json({ error: "ID is required" }, { status: 400 });
        const prev = await getSiteEventById(id);
        if (!prev) return NextResponse.json({ error: "Event not found" }, { status: 404 });
        await deleteSiteEvent(id);
        await safeDeleteMediaKeys(collectMediaKeys([prev.coverUrl, ...parseJsonArray(prev.photos)]));
        return NextResponse.json({ ok: true });
      }

      case "addSpace": {
        if (!String(params.title || "").trim()) return NextResponse.json({ error: "Title is required" }, { status: 400 });
        const gallery = buildGallery(params.imageUrl, params.photos);
        if ("error" in gallery) return NextResponse.json({ error: gallery.error }, { status: 400 });
        const existing = await getSiteCommunitySpaces();
        await addSiteCommunitySpace({
          title: String(params.title).trim(),
          icon: safeIcon(params.icon),
          description: String(params.description || "").trim(),
          imageUrl: gallery.coverUrl,
          photos: gallery.photosJson,
          displayOrder: nextOrder(existing),
        });
        return NextResponse.json({ ok: true });
      }

      case "updateSpace": {
        const id = Number(params.id);
        if (!id) return NextResponse.json({ error: "ID is required" }, { status: 400 });
        const prev = await getSiteCommunitySpaceById(id);
        if (!prev) return NextResponse.json({ error: "Space not found" }, { status: 404 });
        const gallery = (params.imageUrl !== undefined || params.photos !== undefined)
          ? buildGallery(
            params.imageUrl !== undefined ? params.imageUrl : prev.imageUrl,
            params.photos !== undefined ? params.photos : parseJsonArray(prev.photos),
          )
          : { coverUrl: prev.imageUrl, photosJson: prev.photos };
        if ("error" in gallery) return NextResponse.json({ error: gallery.error }, { status: 400 });
        const imageUrl = gallery.coverUrl;
        const photos = gallery.photosJson;
        const data: Parameters<typeof updateSiteCommunitySpace>[1] = { imageUrl, photos };
        if (params.title !== undefined) {
          const title = String(params.title).trim();
          if (!title) return NextResponse.json({ error: "Title is required" }, { status: 400 });
          data.title = title;
        }
        if (params.icon !== undefined) data.icon = safeIcon(params.icon);
        if (params.description !== undefined) data.description = String(params.description);
        if (params.displayOrder !== undefined) data.displayOrder = Number(params.displayOrder) || 0;
        await updateSiteCommunitySpace(id, data);
        const prevPhotos = parseJsonArray(prev.photos);
        const nextPhotos = parseJsonArray(photos);
        const released = releasedMediaKeys(
          [prev.imageUrl, ...prevPhotos],
          [imageUrl, ...nextPhotos],
        );
        await safeDeleteMediaKeys(released);
        return NextResponse.json({ ok: true });
      }

      case "deleteSpace": {
        const id = Number(params.id);
        if (!id) return NextResponse.json({ error: "ID is required" }, { status: 400 });
        const prev = await getSiteCommunitySpaceById(id);
        if (!prev) return NextResponse.json({ error: "Space not found" }, { status: 404 });
        await deleteSiteCommunitySpace(id);
        await safeDeleteMediaKeys(collectMediaKeys([prev.imageUrl, ...parseJsonArray(prev.photos)]));
        return NextResponse.json({ ok: true });
      }

      case "discardMedia": {
        const raw = params.urls !== undefined ? params.urls : params.url;
        const list = Array.isArray(raw) ? raw : [raw];
        const keys = list.map((u) => mediaUrlToKey(String(u || ""))).filter((k): k is string => Boolean(k));
        if (keys.length) await safeDeleteMediaKeys(keys);
        return NextResponse.json({ ok: true });
      }

      case "getHeroVideos": {
        return NextResponse.json(await loadHeroVideosAdminPayload());
      }

      case "addHeroVideo": {
        const slot = String(params.slot || "") as HeroVideoSlot;
        if (slot !== "desktop" && slot !== "mobile") {
          return NextResponse.json({ error: "slot must be desktop or mobile" }, { status: 400 });
        }
        const url = sanitizeHeroMediaUrl(String(params.url || ""));
        const posterRaw = String(params.posterUrl || "").trim();
        const posterKey = mediaUrlToKey(posterRaw);
        const posterUrl = posterKey?.startsWith("hero-videos/") && posterRaw.endsWith(".jpg") ? posterRaw : "";
        if (!url || !url.includes(".mp4")) {
          return NextResponse.json({ error: "Valid hero-videos MP4 URL is required" }, { status: 400 });
        }
        const label = String(params.label || "").trim().slice(0, 80) || (slot === "desktop" ? "Desktop clip" : "Mobile clip");
        const id = crypto.randomUUID();
        const row = await addSiteHeroVideo({
          id,
          slot,
          label,
          url,
          posterUrl,
          bytes: Math.max(0, Number(params.bytes) || 0),
          width: Math.max(0, Number(params.width) || 0),
          height: Math.max(0, Number(params.height) || 0),
        });
        return NextResponse.json({ ok: true, video: row });
      }

      case "deleteHeroVideo": {
        const id = String(params.id || "").trim();
        if (!id) return NextResponse.json({ error: "ID is required" }, { status: 400 });
        if (id.startsWith("builtin:")) {
          return NextResponse.json({ error: "Built-in videos cannot be deleted" }, { status: 400 });
        }
        const prev = await getSiteHeroVideoById(id);
        if (!prev) return NextResponse.json({ error: "Video not found" }, { status: 404 });
        if ((await countPageHeroRefs(id)) > 0) {
          return NextResponse.json({ error: "Video is assigned to a page — unassign first" }, { status: 400 });
        }
        await deleteSiteHeroVideo(id);
        await safeDeleteMediaKeys(collectMediaKeys([prev.url, prev.posterUrl]));
        return NextResponse.json({ ok: true });
      }

      case "savePageHero": {
        const page = String(params.page || "").trim();
        if (!isHeroPageKey(page)) {
          return NextResponse.json({ error: "Unknown page" }, { status: 400 });
        }
        const rows = await getSiteHeroVideos();
        const libraryById = new Map<string, HeroLibraryItem>();
        for (const row of rows) {
          libraryById.set(row.id, {
            id: row.id,
            slot: row.slot === "mobile" ? "mobile" : "desktop",
            label: row.label,
            url: row.url,
            posterUrl: row.posterUrl,
            bytes: row.bytes,
            width: row.width,
            height: row.height,
            builtin: false,
          });
        }
        const checked = validateAssignmentIds(
          String(params.desktopVideoId || ""),
          String(params.mobileVideoId || ""),
          libraryById,
        );
        if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400 });
        const saved = await upsertSitePageHero(page, checked.desktopVideoId, checked.mobileVideoId);
        return NextResponse.json({ ok: true, assignment: saved });
      }

      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal server error";
    console.error("Website CMS error:", message);
    if (/no such table/i.test(message)) {
      return NextResponse.json({ error: "Website tables missing — apply migration 0035 / 0079" }, { status: 503 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
