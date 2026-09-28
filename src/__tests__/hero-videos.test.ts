import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  defaultAssignmentIds,
  HERO_PAGE_DEFAULT_SET,
  HERO_PAGE_KEYS,
  heroVideoElementKey,
  loopFromPair,
  resolveAllPageHeroes,
  resolvePageHeroLoop,
  sanitizeHeroMediaUrl,
  validateAssignmentIds,
  type HeroLibraryItem,
} from "@/lib/heroVideos";
import {
  fetchPublicHeroVideos,
  peekHeroForPage,
  resetPublicHeroVideosCache,
} from "@/lib/fetchHeroVideos";
import { heroVideoA, heroVideoB } from "@/lib/site";

describe("heroVideos resolver", () => {
  it("defaults every page to the legacy A/B map including booking-confirmation and things-to-do", () => {
    const pages = resolveAllPageHeroes([], []);
    expect(HERO_PAGE_KEYS).toContain("booking-confirmation");
    expect(HERO_PAGE_KEYS).toContain("things-to-do");
    expect(HERO_PAGE_KEYS).not.toContain("quick-links");
    expect(pages.home.mp4).toBe(heroVideoA.mp4);
    expect(pages.stay.mp4).toBe(heroVideoB.mp4);
    expect(pages.events.mp4).toBe(heroVideoA.mp4);
    expect(pages.community.mp4).toBe(heroVideoB.mp4);
    expect(pages.book.mp4).toBe(heroVideoA.mp4);
    expect(pages["booking-confirmation"].mp4).toBe(heroVideoA.mp4);
    expect(pages["things-to-do"].mp4).toBe(heroVideoA.mp4);
    expect(pages["things-to-do"].mobileMp4).toBe(heroVideoA.mobileMp4);
  });

  it("resolves R2 library pairs without inventing webm sources", () => {
    const library: HeroLibraryItem[] = [
      {
        id: "d1",
        slot: "desktop",
        label: "Events desk",
        url: "/api/media/hero-videos/2026-09-26-aaaa.mp4",
        posterUrl: "/api/media/hero-videos/2026-09-26-aaaa.jpg",
        bytes: 1000,
        width: 1024,
        height: 576,
        builtin: false,
      },
      {
        id: "m1",
        slot: "mobile",
        label: "Events mobile",
        url: "/api/media/hero-videos/2026-09-26-bbbb.mp4",
        posterUrl: "/api/media/hero-videos/2026-09-26-bbbb.jpg",
        bytes: 800,
        width: 324,
        height: 576,
        builtin: false,
      },
    ];
    const byId = new Map(library.map((v) => [v.id, v]));
    const loop = resolvePageHeroLoop(
      "events",
      { desktopVideoId: "d1", mobileVideoId: "m1" },
      byId,
    );
    expect(loop.mp4).toBe(library[0].url);
    expect(loop.mobileMp4).toBe(library[1].url);
    expect(loop.poster).toBe(library[0].posterUrl);
    expect(loop.webm || "").toBe("");
    expect(loop.mobileWebm || "").toBe("");
  });

  it("keeps matching git webm when assigning built-in B on an A-default page", () => {
    const loop = resolvePageHeroLoop(
      "home",
      { desktopVideoId: "builtin:B:desktop", mobileVideoId: "builtin:B:mobile" },
      new Map(),
    );
    expect(loop.mp4).toBe(heroVideoB.mp4);
    expect(loop.webm).toBe(heroVideoB.webm);
    expect(loop.mobileMp4).toBe(heroVideoB.mobileMp4);
    expect(loop.mobileWebm).toBe(heroVideoB.mobileWebm);
  });

  it("rejects cross-slot assignment ids", () => {
    const library: HeroLibraryItem[] = [
      {
        id: "d1", slot: "desktop", label: "D", url: "/api/media/hero-videos/d.mp4",
        posterUrl: "", bytes: 1, width: 1, height: 1, builtin: false,
      },
      {
        id: "m1", slot: "mobile", label: "M", url: "/api/media/hero-videos/m.mp4",
        posterUrl: "", bytes: 1, width: 1, height: 1, builtin: false,
      },
    ];
    const byId = new Map(library.map((v) => [v.id, v]));
    const bad = validateAssignmentIds("m1", "d1", byId);
    expect(bad.ok).toBe(false);
    const good = validateAssignmentIds("d1", "m1", byId);
    expect(good.ok).toBe(true);
    const builtin = validateAssignmentIds("builtin:A:desktop", "builtin:A:mobile", byId);
    expect(builtin.ok).toBe(true);
  });

  it("sanitizes only hero-videos media and /videos/hero paths", () => {
    expect(sanitizeHeroMediaUrl("/api/media/hero-videos/2026-09-26-x.mp4")).toBe(
      "/api/media/hero-videos/2026-09-26-x.mp4",
    );
    expect(sanitizeHeroMediaUrl("/api/media/events/x.jpg")).toBe("");
    expect(sanitizeHeroMediaUrl("/videos/hero/hero-a.mp4")).toBe("/videos/hero/hero-a.mp4");
    expect(sanitizeHeroMediaUrl("/videos/../secret.mp4")).toBe("");
  });

  it("loopFromPair falls back to default set when a side is missing", () => {
    const loop = loopFromPair(null, null, "B");
    expect(loop.mp4).toBe(heroVideoB.mp4);
    expect(defaultAssignmentIds("faqs")).toEqual({
      desktopVideoId: "builtin:B:desktop",
      mobileVideoId: "builtin:B:mobile",
    });
    expect(HERO_PAGE_DEFAULT_SET.book).toBe("A");
  });
});

describe("hero video page wiring", () => {
  it("hydrates CMS pageKeys on marketing surfaces and enables things-to-do + confirmation heroes", () => {
    const checks: Array<[string, string]> = [
      ["src/components/sections/HomeHeroPremium.tsx", 'pageKey="home"'],
      ["src/app/self-checkin/page.tsx", 'pageKey="self-checkin"'],
      ["src/app/(marketing)/book/page.tsx", 'pageKey="book"'],
      ["src/app/(marketing)/book/preview/page.tsx", 'pageKey="book"'],
      ["src/app/(marketing)/stay/page.tsx", 'pageKey="stay"'],
      ["src/app/(marketing)/story/page.tsx", 'pageKey="story"'],
      ["src/app/(marketing)/faqs/page.tsx", 'pageKey="faqs"'],
      ["src/app/(marketing)/how-to-reach/page.tsx", 'pageKey="how-to-reach"'],
      ["src/app/(marketing)/reviews/page.tsx", 'pageKey="reviews"'],
      ["src/app/(marketing)/booking-enquiry/page.tsx", 'pageKey="booking-enquiry"'],
      ["src/app/(marketing)/things-to-do/page.tsx", 'pageKey="things-to-do"'],
      ["src/components/sections/EventsPageLive.tsx", 'pageKey="events"'],
      ["src/components/sections/CommunityPageLive.tsx", 'pageKey="community"'],
      ["src/app/(marketing)/booking/[reference]/page.tsx", 'pageKey="booking-confirmation"'],
    ];
    for (const [path, needle] of checks) {
      expect(readFileSync(path, "utf8"), path).toContain(needle);
    }
    const things = readFileSync("src/app/(marketing)/things-to-do/page.tsx", "utf8");
    expect(things).not.toContain("heroVideo={null}");
    expect(things).toContain("heroLoopVideo");

    const confirmation = readFileSync("src/app/(marketing)/booking/[reference]/page.tsx", "utf8");
    expect(confirmation).toContain("PageRibbon");
    expect(confirmation).toContain("GuestBookingManage");

    const backdrop = readFileSync("src/components/media/HeroBackdrop.tsx", "utf8");
    expect(backdrop).toContain("fetchPublicHeroVideos");
    expect(backdrop).toContain("webmSrc ?");
    expect(backdrop).toContain("pageKey");
    expect(backdrop).toContain("heroVideoElementKey(isMobile, mp4Src, webmSrc)");
    expect(backdrop).not.toContain('key={isMobile ? "mobile" : "desktop"}');
    expect(readFileSync("src/lib/fetchHeroVideos.ts", "utf8")).toContain('cache: "default"');

    const admin = readFileSync("src/components/admin/AdminWebsite.tsx", "utf8");
    expect(admin).toContain("AdminHeroVideos");
    expect(admin).toContain("Hero Videos");

    const heroUpload = readFileSync("src/components/admin/AdminHeroVideos.tsx", "utf8");
    expect(heroUpload).toContain("buildHeroUploadRequest");
    expect(heroUpload).toContain("formatHeroUploadPhaseError");

    // Marketing pages stay force-static; heroes hydrate client-side
    expect(readFileSync("src/app/(marketing)/book/page.tsx", "utf8")).toContain('force-static');
    expect(readFileSync("src/app/(marketing)/book/page.tsx", "utf8")).not.toContain('force-dynamic');
  });

  it("keeps quick-links without a hero ribbon", () => {
    const ql = readFileSync("src/app/(marketing)/quick-links/page.tsx", "utf8");
    expect(ql).not.toContain("PageRibbon");
    expect(ql).not.toContain("HeroBackdrop");
  });
});

describe("hero video hydrate remount workflow (save → public pages)", () => {
  it("remounts when CMS assignment differs from static seed (self-checkin A→B)", () => {
    expect(HERO_PAGE_DEFAULT_SET["self-checkin"]).toBe("A");
    const empty = new Map<string, HeroLibraryItem>();
    const seed = resolvePageHeroLoop("self-checkin", null, empty);
    const live = resolvePageHeroLoop(
      "self-checkin",
      { desktopVideoId: "builtin:B:desktop", mobileVideoId: "builtin:B:mobile" },
      empty,
    );
    expect(seed.mp4).toBe(heroVideoA.mp4);
    expect(live.mp4).toBe(heroVideoB.mp4);

    const seedKey = heroVideoElementKey(false, seed.mp4, seed.webm);
    const liveKey = heroVideoElementKey(false, live.mp4, live.webm);
    expect(seedKey).not.toBe(liveKey);
    expect(liveKey).toContain(heroVideoB.mp4);

    // Matching seed+live → same key (no remount / no forced reload)
    expect(heroVideoElementKey(false, seed.mp4, seed.webm)).toBe(seedKey);

    // Orientation change still remounts (desktop vs mobile file)
    const mobileKey = heroVideoElementKey(true, seed.mobileMp4, seed.mobileWebm);
    expect(mobileKey).not.toBe(seedKey);
    expect(mobileKey.startsWith("m:")).toBe(true);
  });

  it("remounts for uploaded R2 clips vs builtin seed", () => {
    const library: HeroLibraryItem[] = [
      {
        id: "up-d",
        slot: "desktop",
        label: "Upload desk",
        url: "/api/media/hero-videos/2026-09-27-desk.mp4",
        posterUrl: "/api/media/hero-videos/2026-09-27-desk.jpg",
        bytes: 1,
        width: 1024,
        height: 576,
        builtin: false,
      },
      {
        id: "up-m",
        slot: "mobile",
        label: "Upload mobile",
        url: "/api/media/hero-videos/2026-09-27-mob.mp4",
        posterUrl: "/api/media/hero-videos/2026-09-27-mob.jpg",
        bytes: 1,
        width: 324,
        height: 576,
        builtin: false,
      },
    ];
    const byId = new Map(library.map((v) => [v.id, v]));
    const seed = resolvePageHeroLoop("events", null, byId);
    const live = resolvePageHeroLoop(
      "events",
      { desktopVideoId: "up-d", mobileVideoId: "up-m" },
      byId,
    );
    expect(heroVideoElementKey(false, seed.mp4, seed.webm)).not.toBe(
      heroVideoElementKey(false, live.mp4, live.webm),
    );
    expect(live.webm).toBeUndefined();
  });

  it("peekHeroForPage only accepts complete loops", () => {
    expect(peekHeroForPage(null, "self-checkin")).toBeNull();
    expect(peekHeroForPage({ pages: {} }, "self-checkin")).toBeNull();
    expect(
      peekHeroForPage(
        { pages: { "self-checkin": { poster: "p", mp4: heroVideoB.mp4, mobileMp4: "" } } },
        "self-checkin",
      ),
    ).toBeNull();
    const ok = peekHeroForPage(
      {
        pages: {
          "self-checkin": {
            poster: heroVideoB.poster,
            mp4: heroVideoB.mp4,
            webm: heroVideoB.webm,
            mobileMp4: heroVideoB.mobileMp4,
            mobileWebm: heroVideoB.mobileWebm,
          },
        },
      },
      "self-checkin",
    );
    expect(ok?.mp4).toBe(heroVideoB.mp4);
  });

  it("save→resolveAllPageHeroes updates only the assigned page", () => {
    const pages = resolveAllPageHeroes(
      [{ page: "self-checkin", desktopVideoId: "builtin:B:desktop", mobileVideoId: "builtin:B:mobile" }],
      [],
    );
    expect(pages["self-checkin"].mp4).toBe(heroVideoB.mp4);
    expect(pages.home.mp4).toBe(heroVideoA.mp4);
    expect(pages.stay.mp4).toBe(heroVideoB.mp4);
  });
});

describe("fetchPublicHeroVideos client cache", () => {
  beforeEach(() => {
    resetPublicHeroVideosCache();
    vi.stubGlobal("window", {});
  });
  afterEach(() => {
    resetPublicHeroVideosCache();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("uses cache:default once per module lifetime and shares the promise", async () => {
    const payload = {
      pages: {
        "self-checkin": {
          poster: heroVideoB.poster,
          mp4: heroVideoB.mp4,
          mobileMp4: heroVideoB.mobileMp4,
        },
      },
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => payload,
    });
    vi.stubGlobal("fetch", fetchMock);

    const a = await fetchPublicHeroVideos();
    const b = await fetchPublicHeroVideos();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[1]).toEqual({ cache: "default" });
    expect(a).toBe(b);
    expect(peekHeroForPage(a, "self-checkin")?.mp4).toBe(heroVideoB.mp4);
  });
});
