import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { cropRect } from "@/lib/cropRect";
import { isSafeMediaKey, mediaUrlToKey, releasedMediaKeys, sanitizeSiteImageUrl } from "@/lib/mediaKeys";
import { mergeGallery, parseCommunityCopy, parseEventsCopy, parseJsonArray } from "@/lib/siteCopy";
import { resolveCommunityPageData, resolveEventsPageData } from "@/lib/siteContent";
import { upcomingEvents, pastEvents } from "@/content/events";
import { communitySpaces } from "@/content/community";

describe("cropRect", () => {
  it("center-crops a wide landscape into 16:10", () => {
    const r = cropRect(4000, 2000, 1600, 1000);
    expect(r.sh).toBe(2000);
    expect(r.sw).toBe(3200);
    expect(r.sx).toBe(400);
    expect(r.sy).toBe(0);
  });

  it("top-crops a portrait into 16:10 instead of slicing the middle", () => {
    const r = cropRect(1000, 2000, 1600, 1000);
    expect(r.sw).toBe(1000);
    expect(r.sh).toBeCloseTo(625);
    expect(r.sx).toBe(0);
    expect(r.sy).toBe(0);
  });

  it("center-crops a wide landscape into 16:9 for heroes", () => {
    const r = cropRect(4000, 2000, 1920, 1080);
    expect(r.sh).toBe(2000);
    expect(r.sw).toBeCloseTo(2000 * (1920 / 1080));
    expect(r.sy).toBe(0);
  });

  it("does not throw on zero-size input", () => {
    const r = cropRect(0, 0, 1600, 1000);
    expect(r.sw).toBeGreaterThanOrEqual(1);
    expect(r.sh).toBeGreaterThanOrEqual(1);
  });
});

describe("media keys", () => {
  it("accepts generated upload keys", () => {
    expect(isSafeMediaKey("events/2026-08-28-abcd1234.jpg")).toBe(true);
    expect(isSafeMediaKey("heroes/2026-08-28-abcd1234.jpg")).toBe(true);
    expect(isSafeMediaKey("quick-links/2026-08-28-abcd1234.jpg")).toBe(true);
    expect(isSafeMediaKey("../secret")).toBe(false);
    expect(isSafeMediaKey("events/../../etc/passwd")).toBe(false);
    expect(isSafeMediaKey("/events/foo.jpg")).toBe(false);
    expect(mediaUrlToKey("/api/media/events/2026-08-28-abcd1234.jpg")).toBe("events/2026-08-28-abcd1234.jpg");
    expect(mediaUrlToKey("/images/foo.jpg")).toBe(null);
    expect(mediaUrlToKey("/api/media/%")).toBe(null);
    expect(sanitizeSiteImageUrl("/images/a.jpg")).toBe("/images/a.jpg");
    expect(sanitizeSiteImageUrl("/api/media/events/2026-08-28-abcd1234.jpg")).toBe("/api/media/events/2026-08-28-abcd1234.jpg");
    expect(sanitizeSiteImageUrl("/api/media/quick-links/2026-08-28-abcd1234.jpg")).toBe("/api/media/quick-links/2026-08-28-abcd1234.jpg");
    expect(sanitizeSiteImageUrl("https://evil.example/x.jpg")).toBe("");
    expect(sanitizeSiteImageUrl("/images/%2e%2e/secret.jpg")).toBe("");
    expect(sanitizeSiteImageUrl("/legacy-images/foo%20bar.webp")).toBe("/legacy-images/foo%20bar.webp");
    expect(sanitizeSiteImageUrl("/images/community-area/workspace/Screenshot%20at%20Dec%2006%2022-19-37.jpg")).toBe(
      "/images/community-area/workspace/Screenshot%20at%20Dec%2006%2022-19-37.jpg",
    );
  });

  it("releases only unused R2 keys and ignores static /images paths", () => {
    const released = releasedMediaKeys(
      ["/api/media/events/old.jpg", "/images/keep-static.jpg", "/api/media/events/shared.jpg"],
      ["/api/media/events/new.jpg", "/images/keep-static.jpg", "/api/media/events/shared.jpg"],
    );
    expect(released).toEqual(["events/old.jpg"]);
  });

  it("dedupes the same key listed as both cover and gallery photo", () => {
    const released = releasedMediaKeys(
      ["/api/media/events/old.jpg", "/api/media/events/old.jpg"],
      ["/api/media/events/new.jpg"],
    );
    expect(released).toEqual(["events/old.jpg"]);
  });
});

describe("CMS page data resolution", () => {
  it("falls back to hardcoded content when D1 is unavailable", () => {
    const events = resolveEventsPageData(null);
    expect(events.upcoming).toEqual(upcomingEvents);
    expect(events.past).toEqual(pastEvents);
    expect(events.copy.hero.title).toContain("Events");

    const community = resolveCommunityPageData(null);
    expect(community.spaces).toEqual(communitySpaces);
  });

  it("does not resurrect hardcoded events after the CMS is emptied", () => {
    const events = resolveEventsPageData({ rows: [], copyRaw: null });
    expect(events.upcoming).toEqual([]);
    expect(events.past).toEqual([]);

    const community = resolveCommunityPageData({ rows: [], copyRaw: null });
    expect(community.spaces).toEqual([]);
  });

  it("maps D1 rows including past flag 1/0", () => {
    const events = resolveEventsPageData({
      rows: [
        {
          id: 1, date: "Tomorrow", title: "Live Night", description: "x",
          tags: '["DJ"]', isPast: 0, coverUrl: "/images/a.jpg",
          photos: '["/images/a.jpg"]', displayOrder: 0, updatedAt: "",
        },
        {
          id: 2, date: "Last year", title: "Holi", description: "y",
          tags: "[]", isPast: 1, coverUrl: "/images/b.jpg",
          photos: "[]", displayOrder: 0, updatedAt: "",
        },
      ],
      copyRaw: JSON.stringify({
        hero: { title: "From DB", subtitle: "sub", chips: ["A"], ribbonImage: "/images/r.jpg" },
        pastCta: { title: "cta", body: "body" },
      }),
    });
    expect(events.copy.hero.title).toBe("From DB");
    expect(events.upcoming.map((e) => e.title)).toEqual(["Live Night"]);
    expect(events.past.map((e) => e.title)).toEqual(["Holi"]);
    expect(events.upcoming[0].tags).toEqual(["DJ"]);
    expect(events.past[0].past).toBe(true);
  });

  it("uses the first photo as cover when coverUrl is empty", () => {
    const events = resolveEventsPageData({
      rows: [{
        id: 1, date: "x", title: "Live", description: "",
        tags: "[]", isPast: 0, coverUrl: "",
        photos: '["/images/a.jpg"]', displayOrder: 0, updatedAt: "",
      }],
      copyRaw: null,
    });
    expect(events.upcoming[0].cover).toBe("/images/a.jpg");
    expect(events.upcoming[0].photos).toEqual(["/images/a.jpg"]);
  });

  it("keeps a distinct cover in the public slideshow", () => {
    const events = resolveEventsPageData({
      rows: [{
        id: 1, date: "x", title: "Live", description: "",
        tags: "[]", isPast: 0, coverUrl: "/images/cover.jpg",
        photos: '["/images/b.jpg"]', displayOrder: 0, updatedAt: "",
      }],
      copyRaw: null,
    });
    expect(events.upcoming[0].cover).toBe("/images/cover.jpg");
    expect(events.upcoming[0].photos).toEqual(["/images/cover.jpg", "/images/b.jpg"]);
  });

  it("fills missing copy fields instead of crashing", () => {
    const parsed = parseEventsCopy('{"hero":{"title":"Only title"}}');
    expect(parsed?.hero.title).toBe("Only title");
    expect(parsed?.hero.chips.length).toBeGreaterThan(0);
    expect(parseEventsCopy("not-json")).toBeNull();
    expect(parseCommunityCopy(null)).toBeNull();
    expect(parseJsonArray("not-array")).toEqual([]);
    expect(parseJsonArray('["a", 1, "b"]')).toEqual(["a", "b"]);
    expect(mergeGallery("/images/a.jpg", ["/images/a.jpg", "/images/b.jpg"])).toEqual(["/images/a.jpg", "/images/b.jpg"]);
    expect(mergeGallery("/images/cover.jpg", ["/images/b.jpg"])).toEqual(["/images/cover.jpg", "/images/b.jpg"]);
    expect(mergeGallery("", ["/images/a.jpg", "/images/a.jpg"])).toEqual(["/images/a.jpg"]);
    expect(mergeGallery("", [])).toEqual([]);
    expect(mergeGallery("", Array.from({ length: 9 }, (_, i) => `/images/${i}.jpg`))).toHaveLength(8);
    expect(parseJsonArray('["a", "", "  "]')).toEqual(["a"]);
  });

  it("keeps deliberately empty copy fields instead of resurrecting defaults", () => {
    const parsed = parseEventsCopy(JSON.stringify({
      hero: { title: "T", subtitle: "", chips: [], ribbonImage: "" },
      pastCta: { title: "", body: "" },
    }));
    expect(parsed?.hero.subtitle).toBe("");
    expect(parsed?.hero.chips).toEqual([]);
    expect(parsed?.hero.ribbonImage).toBe("");
    expect(parsed?.pastCta.title).toBe("");
  });

  it("drops off-site image URLs when mapping public cards", () => {
    const events = resolveEventsPageData({
      rows: [{
        id: 1, date: "x", title: "Live", description: "",
        tags: "[]", isPast: 0, coverUrl: "https://evil.example/x.jpg",
        photos: '["https://evil.example/x.jpg"]', displayOrder: 0, updatedAt: "",
      }],
      copyRaw: null,
    });
    expect(events.upcoming[0].cover).toBeUndefined();
    expect(events.upcoming[0].photos).toEqual([]);
  });

  it("keeps seeded community images that use %20 in the path", () => {
    const url = "/images/community-area/workspace/Screenshot%20at%20Dec%2006%2022-19-37.jpg";
    const community = resolveCommunityPageData({
      rows: [{
        id: 1, title: "Co-working space", icon: "laptop", description: "x",
        imageUrl: url, photos: JSON.stringify([url]), displayOrder: 3, updatedAt: "",
      }],
      copyRaw: null,
    });
    expect(community.spaces[0].image).toBe(url);
    expect(community.spaces[0].photos).toEqual([url]);
  });
});

describe("migration 0035 seed", () => {
  let sqliteOk = true;
  try { execFileSync("sqlite3", ["-version"]); } catch { sqliteOk = false; }

  it.skipIf(!sqliteOk)("creates expected rows and valid JSON copy in SQLite", () => {
    const dbPath = "/tmp/goko-site-cms-test.db";
    try { execFileSync("rm", ["-f", dbPath]); } catch { /* ignore */ }
    const sql = readFileSync("migrations/0035_site_cms.sql", "utf8");
    execFileSync("sqlite3", [dbPath], { input: sql });
    const counts = execFileSync("sqlite3", [dbPath, "SELECT (SELECT COUNT(*) FROM site_events)||' '||(SELECT COUNT(*) FROM site_community_spaces)||' '||(SELECT COUNT(*) FROM site_page_copy);"], { encoding: "utf8" }).trim();
    expect(counts).toBe("10 5 2");

    const eventsCopy = execFileSync("sqlite3", [dbPath, "SELECT content FROM site_page_copy WHERE page='events';"], { encoding: "utf8" }).trim();
    const communityCopy = execFileSync("sqlite3", [dbPath, "SELECT content FROM site_page_copy WHERE page='community';"], { encoding: "utf8" }).trim();
    const events = parseEventsCopy(eventsCopy);
    const community = parseCommunityCopy(communityCopy);
    expect(events?.hero.chips).toHaveLength(4);
    expect(events?.pastCta.title).toBe("Don't miss out!");
    expect(community?.activities.weekly).toHaveLength(7);
    expect(community?.specialEvents.cards).toHaveLength(4);

    const upcoming = Number(execFileSync("sqlite3", [dbPath, "SELECT COUNT(*) FROM site_events WHERE is_past=0;"], { encoding: "utf8" }).trim());
    const past = Number(execFileSync("sqlite3", [dbPath, "SELECT COUNT(*) FROM site_events WHERE is_past=1;"], { encoding: "utf8" }).trim());
    expect(upcoming).toBe(4);
    expect(past).toBe(6);
    const upcomingTitles = execFileSync("sqlite3", [dbPath, "SELECT title FROM site_events WHERE is_past=0 ORDER BY display_order;"], { encoding: "utf8" }).trim().split("\n");
    expect(upcomingTitles).toEqual(upcomingEvents.map((e) => e.title));
  });
});

describe("Pi migrator", () => {
  it("records Cloudflare-only migrations without applying their SQL", () => {
    const src = readFileSync("scripts/migrate-pi.ts", "utf8");
    expect(src).toMatch(/0035_site_cms\.sql[\s\S]*Cloudflare-only/);
    expect(src).toMatch(/0041_splits\.sql/);
    expect(src).toMatch(/0064_food_bill_share_tokens\.sql/);
    expect(src).toMatch(/0077_food_bill_walkin_identity\.sql/);
    expect(src).toMatch(/0066_gateway_receivables\.sql/);
    expect(src).toMatch(/0068_gateway_settlement_allocations\.sql/);
  });
});

describe("Workers Free 10ms", () => {
  it("does not SSR CMS pages or keep paid-only Worker bindings", () => {
    const events = readFileSync("src/app/(marketing)/events/page.tsx", "utf8");
    const community = readFileSync("src/app/(marketing)/community-area/page.tsx", "utf8");
    const wrangler = readFileSync("wrangler.jsonc", "utf8");
    const openNext = readFileSync("open-next.config.ts", "utf8");
    expect(events).not.toMatch(/loadEventsPageData/);
    expect(events).toMatch(/force-static/);
    expect(events).not.toMatch(/force-dynamic/);
    expect(events).not.toMatch(/revalidate/);
    expect(community).not.toMatch(/loadCommunityPageData/);
    expect(community).toMatch(/force-static/);
    expect(community).not.toMatch(/force-dynamic/);
    expect(community).not.toMatch(/revalidate/);
    expect(wrangler).not.toMatch(/cpu_ms/);
    expect(wrangler).not.toMatch(/NEXT_CACHE_DO_QUEUE/);
    expect(wrangler).not.toMatch(/NEXT_INC_CACHE_R2_BUCKET/);
    expect(openNext).not.toMatch(/doQueue|r2IncrementalCache/);
  });
});
