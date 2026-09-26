import type { HeroLoopVideo } from "@/lib/site";
import { heroVideoA, heroVideoB } from "@/lib/site";
import { mediaUrlToKey } from "@/lib/mediaKeys";

export type HeroVideoSlot = "desktop" | "mobile";

export type HeroPageKey =
  | "home"
  | "stay"
  | "story"
  | "events"
  | "community"
  | "how-to-reach"
  | "faqs"
  | "reviews"
  | "booking-enquiry"
  | "book"
  | "booking-confirmation"
  | "self-checkin"
  | "things-to-do";

export const HERO_PAGE_KEYS: readonly HeroPageKey[] = [
  "home",
  "stay",
  "story",
  "events",
  "community",
  "how-to-reach",
  "faqs",
  "reviews",
  "booking-enquiry",
  "book",
  "booking-confirmation",
  "self-checkin",
  "things-to-do",
] as const;

export const HERO_PAGE_LABELS: Record<HeroPageKey, string> = {
  home: "Home",
  stay: "Stay / Our rooms",
  story: "Our story",
  events: "Events",
  community: "Community Area",
  "how-to-reach": "How to reach",
  faqs: "FAQs",
  reviews: "Reviews",
  "booking-enquiry": "Booking enquiry",
  book: "Book (+ Find my booking)",
  "booking-confirmation": "Booking confirmation",
  "self-checkin": "Self check-in",
  "things-to-do": "Things to do",
};

/** Legacy default loop when a page has no CMS assignment. */
export const HERO_PAGE_DEFAULT_SET: Record<HeroPageKey, "A" | "B"> = {
  home: "A",
  stay: "B",
  story: "A",
  events: "A",
  community: "B",
  "how-to-reach": "B",
  faqs: "B",
  reviews: "A",
  "booking-enquiry": "A",
  book: "A",
  "booking-confirmation": "A",
  "self-checkin": "A",
  "things-to-do": "A",
};

export type BuiltinHeroId =
  | "builtin:A:desktop"
  | "builtin:A:mobile"
  | "builtin:B:desktop"
  | "builtin:B:mobile";

export type HeroLibraryItem = {
  id: string;
  slot: HeroVideoSlot;
  label: string;
  url: string;
  posterUrl: string;
  bytes: number;
  width: number;
  height: number;
  builtin: boolean;
};

export type PageHeroAssignment = {
  page: HeroPageKey;
  desktopVideoId: string;
  mobileVideoId: string;
};

const BUILTIN: Record<BuiltinHeroId, Omit<HeroLibraryItem, "id" | "builtin">> = {
  "builtin:A:desktop": {
    slot: "desktop",
    label: "Built-in A (desktop)",
    url: heroVideoA.mp4,
    posterUrl: heroVideoA.poster,
    bytes: 0,
    width: 1024,
    height: 576,
  },
  "builtin:A:mobile": {
    slot: "mobile",
    label: "Built-in A (mobile)",
    url: heroVideoA.mobileMp4,
    posterUrl: heroVideoA.poster,
    bytes: 0,
    width: 324,
    height: 576,
  },
  "builtin:B:desktop": {
    slot: "desktop",
    label: "Built-in B (desktop)",
    url: heroVideoB.mp4,
    posterUrl: heroVideoB.poster,
    bytes: 0,
    width: 1024,
    height: 576,
  },
  "builtin:B:mobile": {
    slot: "mobile",
    label: "Built-in B (mobile)",
    url: heroVideoB.mobileMp4,
    posterUrl: heroVideoB.poster,
    bytes: 0,
    width: 324,
    height: 576,
  },
};

export function isHeroPageKey(value: string): value is HeroPageKey {
  return (HERO_PAGE_KEYS as readonly string[]).includes(value);
}

export function isBuiltinHeroId(id: string): id is BuiltinHeroId {
  return id in BUILTIN;
}

export function builtinHeroCatalog(): HeroLibraryItem[] {
  return (Object.keys(BUILTIN) as BuiltinHeroId[]).map((id) => ({
    id,
    builtin: true,
    ...BUILTIN[id],
  }));
}

export function resolveBuiltinHero(id: string): HeroLibraryItem | null {
  if (!isBuiltinHeroId(id)) return null;
  return { id, builtin: true, ...BUILTIN[id] };
}

export function defaultAssignmentIds(page: HeroPageKey): { desktopVideoId: string; mobileVideoId: string } {
  const set = HERO_PAGE_DEFAULT_SET[page];
  return {
    desktopVideoId: `builtin:${set}:desktop`,
    mobileVideoId: `builtin:${set}:mobile`,
  };
}

function setToLoop(set: "A" | "B"): HeroLoopVideo {
  return set === "B" ? heroVideoB : heroVideoA;
}

function gitWebmFor(url: string, which: "desktop" | "mobile"): string {
  if (!url.startsWith("/videos/hero/")) return "";
  const set = url.includes("hero-b") ? heroVideoB : url.includes("hero-a") ? heroVideoA : null;
  if (!set) return "";
  return which === "mobile" ? (set.mobileWebm || "") : (set.webm || "");
}

/** Build a playable loop from desktop + mobile library rows (webm optional). */
export function loopFromPair(
  desktop: { url: string; posterUrl: string } | null,
  mobile: { url: string; posterUrl: string } | null,
  fallbackSet: "A" | "B",
): HeroLoopVideo {
  const fallback = setToLoop(fallbackSet);
  const poster = desktop?.posterUrl || mobile?.posterUrl || fallback.poster;
  const mp4 = desktop?.url || fallback.mp4;
  const mobileMp4 = mobile?.url || fallback.mobileMp4;
  return {
    poster,
    mp4,
    webm: gitWebmFor(mp4, "desktop") || undefined,
    mobileMp4,
    mobileWebm: gitWebmFor(mobileMp4, "mobile") || undefined,
  };
}

export function lookupLibraryItem(
  id: string,
  libraryById: Map<string, HeroLibraryItem>,
): HeroLibraryItem | null {
  if (!id) return null;
  return libraryById.get(id) ?? resolveBuiltinHero(id);
}

/**
 * Resolve one page's hero loop from assignments + library.
 * Empty assignment ids fall back to the legacy A/B default for that page.
 */
export function resolvePageHeroLoop(
  page: HeroPageKey,
  assignment: { desktopVideoId?: string; mobileVideoId?: string } | null | undefined,
  libraryById: Map<string, HeroLibraryItem>,
): HeroLoopVideo {
  const defaults = defaultAssignmentIds(page);
  const desktopId = String(assignment?.desktopVideoId || "").trim() || defaults.desktopVideoId;
  const mobileId = String(assignment?.mobileVideoId || "").trim() || defaults.mobileVideoId;
  const desktop = lookupLibraryItem(desktopId, libraryById);
  const mobile = lookupLibraryItem(mobileId, libraryById);
  if (desktop && desktop.slot !== "desktop") {
    throw new Error(`Desktop assignment must be a desktop clip (${page})`);
  }
  if (mobile && mobile.slot !== "mobile") {
    throw new Error(`Mobile assignment must be a mobile clip (${page})`);
  }
  return loopFromPair(
    desktop ? { url: desktop.url, posterUrl: desktop.posterUrl } : null,
    mobile ? { url: mobile.url, posterUrl: mobile.posterUrl } : null,
    HERO_PAGE_DEFAULT_SET[page],
  );
}

export function resolveAllPageHeroes(
  assignments: PageHeroAssignment[],
  library: HeroLibraryItem[],
): Record<HeroPageKey, HeroLoopVideo> {
  const byId = new Map<string, HeroLibraryItem>();
  for (const item of builtinHeroCatalog()) byId.set(item.id, item);
  for (const item of library) byId.set(item.id, item);
  const byPage = new Map(assignments.map((a) => [a.page, a]));
  const out = {} as Record<HeroPageKey, HeroLoopVideo>;
  for (const page of HERO_PAGE_KEYS) {
    out[page] = resolvePageHeroLoop(page, byPage.get(page), byId);
  }
  return out;
}

/** Accept R2 media URLs under hero-videos/ or built-in /videos/hero paths. */
export function sanitizeHeroMediaUrl(url: string): string {
  const s = String(url || "").trim();
  if (!s) return "";
  if (s.startsWith("/videos/hero/") && !s.includes("..") && !s.includes("\\")) {
    try {
      const decoded = decodeURIComponent(s);
      if (decoded.includes("..") || !decoded.startsWith("/videos/hero/")) return "";
      return s;
    } catch {
      return "";
    }
  }
  const key = mediaUrlToKey(s);
  return key?.startsWith("hero-videos/") ? s : "";
}

export function validateAssignmentIds(
  desktopVideoId: string,
  mobileVideoId: string,
  libraryById: Map<string, HeroLibraryItem>,
): { ok: true; desktopVideoId: string; mobileVideoId: string } | { ok: false; error: string } {
  const d = String(desktopVideoId || "").trim();
  const m = String(mobileVideoId || "").trim();
  if (!d || !m) return { ok: false, error: "Desktop and mobile videos are required" };
  const desktop = lookupLibraryItem(d, libraryById);
  const mobile = lookupLibraryItem(m, libraryById);
  if (!desktop) return { ok: false, error: "Unknown desktop video" };
  if (!mobile) return { ok: false, error: "Unknown mobile video" };
  if (desktop.slot !== "desktop") return { ok: false, error: "Desktop picker must use a desktop clip" };
  if (mobile.slot !== "mobile") return { ok: false, error: "Mobile picker must use a mobile clip" };
  return { ok: true, desktopVideoId: d, mobileVideoId: m };
}
