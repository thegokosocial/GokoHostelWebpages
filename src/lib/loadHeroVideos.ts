import {
  getSiteHeroVideos,
  getSitePageHeroes,
  type SiteHeroVideoRow,
  type SitePageHeroRow,
} from "@/db/siteQueries";
import {
  builtinHeroCatalog,
  HERO_PAGE_KEYS,
  isHeroPageKey,
  resolveAllPageHeroes,
  type HeroLibraryItem,
  type HeroPageKey,
  type PageHeroAssignment,
} from "@/lib/heroVideos";
import type { HeroLoopVideo } from "@/lib/site";

function rowToLibraryItem(row: SiteHeroVideoRow): HeroLibraryItem {
  return {
    id: row.id,
    slot: row.slot === "mobile" ? "mobile" : "desktop",
    label: row.label,
    url: row.url,
    posterUrl: row.posterUrl,
    bytes: row.bytes,
    width: row.width,
    height: row.height,
    builtin: false,
  };
}

function rowToAssignment(row: SitePageHeroRow): PageHeroAssignment | null {
  if (!isHeroPageKey(row.page)) return null;
  return {
    page: row.page,
    desktopVideoId: row.desktopVideoId,
    mobileVideoId: row.mobileVideoId,
  };
}

export type HeroVideosAdminPayload = {
  desktop: HeroLibraryItem[];
  mobile: HeroLibraryItem[];
  builtins: HeroLibraryItem[];
  assignments: PageHeroAssignment[];
  pages: Record<HeroPageKey, HeroLoopVideo>;
};

export async function loadHeroVideosAdminPayload(): Promise<HeroVideosAdminPayload> {
  let rows: SiteHeroVideoRow[] = [];
  let assignRows: SitePageHeroRow[] = [];
  try {
    [rows, assignRows] = await Promise.all([getSiteHeroVideos(), getSitePageHeroes()]);
  } catch (err) {
    console.error("Hero videos CMS load failed:", err);
  }
  const library = rows.map(rowToLibraryItem);
  const assignments = assignRows.map(rowToAssignment).filter((a): a is PageHeroAssignment => Boolean(a));
  const builtins = builtinHeroCatalog();
  const pages = resolveAllPageHeroes(assignments, library);
  return {
    desktop: library.filter((v) => v.slot === "desktop"),
    mobile: library.filter((v) => v.slot === "mobile"),
    builtins,
    assignments,
    pages,
  };
}

export type PublicHeroVideosPayload = {
  pages: Record<HeroPageKey, HeroLoopVideo>;
};

export async function loadPublicHeroVideos(): Promise<PublicHeroVideosPayload> {
  const admin = await loadHeroVideosAdminPayload();
  // Ensure every key present (resolver already does)
  const pages = {} as Record<HeroPageKey, HeroLoopVideo>;
  for (const key of HERO_PAGE_KEYS) pages[key] = admin.pages[key];
  return { pages };
}
