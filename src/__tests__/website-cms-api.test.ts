import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { defaultEventsCopy } from "@/lib/siteCopy";
import { getSyncableTableNames } from "@/lib/syncEngine";
import { upcomingEvents, pastEvents } from "@/content/events";
import { communitySpaces } from "@/content/community";
import { spaceRowToItem } from "@/lib/siteContent";

vi.mock("@/lib/auth", () => ({
  authenticateUser: vi.fn(),
}));

vi.mock("@/lib/runtime", () => ({
  isPiRuntime: vi.fn(() => false),
  getRuntimeName: vi.fn(() => "cloudflare"),
  getBuildVersion: vi.fn(() => "test"),
}));

vi.mock("@/db/siteQueries", () => ({
  getSiteEvents: vi.fn(),
  getSiteEventById: vi.fn(),
  addSiteEvent: vi.fn(),
  updateSiteEvent: vi.fn(),
  deleteSiteEvent: vi.fn(),
  getSiteCommunitySpaces: vi.fn(),
  getSiteCommunitySpaceById: vi.fn(),
  addSiteCommunitySpace: vi.fn(),
  updateSiteCommunitySpace: vi.fn(),
  deleteSiteCommunitySpace: vi.fn(),
  getSitePageCopy: vi.fn(),
  upsertSitePageCopy: vi.fn(),
  countMediaUrlRefs: vi.fn(),
}));

vi.mock("@/lib/mediaR2", () => ({
  deleteMediaKeys: vi.fn(),
  getMediaBucket: vi.fn(),
  putMediaObject: vi.fn(),
  getMediaObject: vi.fn(),
}));

import { authenticateUser } from "@/lib/auth";
import { isPiRuntime } from "@/lib/runtime";
import * as siteQueries from "@/db/siteQueries";
import { deleteMediaKeys, getMediaBucket, getMediaObject, putMediaObject } from "@/lib/mediaR2";
import { POST as websitePOST } from "@/app/api/admin/website/route";
import { POST as uploadPOST } from "@/app/api/admin/website/upload/route";
import { GET as mediaGET } from "@/app/api/media/[...key]/route";
import { GET as siteGET } from "@/app/api/site/route";

const admin = { role: "admin" as const, displayName: "Admin", permissions: {} };
const staff = { role: "staff" as const, displayName: "Staff", permissions: {} };

function jsonReq(body: unknown) {
  return new NextRequest("http://localhost/api/admin/website", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function call(body: unknown) {
  const res = await websitePOST(jsonReq(body));
  return { status: res.status, body: await res.json() };
}

describe("sync engine isolation", () => {
  it("does not sync website CMS tables to the Pi", () => {
    const tables = getSyncableTableNames();
    expect(tables).not.toContain("site_events");
    expect(tables).not.toContain("site_community_spaces");
    expect(tables).not.toContain("site_page_copy");
  });
});

describe("space row mapping", () => {
  it("does not invent a hardcoded space when CMS image is empty", () => {
    const item = spaceRowToItem({
      id: 1, title: "Empty", icon: "sofa", description: "x",
      imageUrl: "", photos: "[]", displayOrder: 0, updatedAt: "",
    });
    expect(item.image).toBe("");
    expect(item.photos).toEqual([]);
  });
});

describe("POST /api/admin/website", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isPiRuntime).mockReturnValue(false);
    vi.mocked(authenticateUser).mockResolvedValue(admin);
    vi.mocked(siteQueries.getSiteEvents).mockResolvedValue([]);
    vi.mocked(siteQueries.getSiteCommunitySpaces).mockResolvedValue([]);
    vi.mocked(siteQueries.getSitePageCopy).mockResolvedValue(null as never);
    vi.mocked(siteQueries.addSiteEvent).mockResolvedValue(undefined as never);
    vi.mocked(siteQueries.updateSiteEvent).mockResolvedValue(undefined as never);
    vi.mocked(siteQueries.deleteSiteEvent).mockResolvedValue(undefined as never);
    vi.mocked(siteQueries.deleteSiteCommunitySpace).mockResolvedValue(undefined as never);
    vi.mocked(siteQueries.upsertSitePageCopy).mockResolvedValue(undefined as never);
    vi.mocked(siteQueries.countMediaUrlRefs).mockResolvedValue(0);
    vi.mocked(deleteMediaKeys).mockResolvedValue(undefined);
  });

  it("rejects unauthenticated callers", async () => {
    vi.mocked(authenticateUser).mockResolvedValue(null);
    const res = await call({ action: "getAll", password: "nope" });
    expect(res.status).toBe(401);
  });

  it("rejects staff even with a valid password", async () => {
    vi.mocked(authenticateUser).mockResolvedValue(staff);
    const res = await call({ action: "getAll", password: "x", username: "staff" });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/Admin/);
  });

  it("rejects Pi runtime", async () => {
    vi.mocked(isPiRuntime).mockReturnValue(true);
    const res = await call({ action: "getAll", password: "x" });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/live site/);
  });

  it("rejects unknown actions", async () => {
    const res = await call({ action: "dropTables", password: "x" });
    expect(res.status).toBe(400);
  });

  it("getAll fills default copy when D1 has none", async () => {
    const res = await call({ action: "getAll", password: "x" });
    expect(res.status).toBe(200);
    expect(res.body.events).toEqual([]);
    expect(res.body.eventsCopy.hero.title).toBe(defaultEventsCopy.hero.title);
    expect(res.body.communityCopy.specialEvents.cards).toHaveLength(4);
  });

  it("maps missing CMS tables to a migration hint", async () => {
    vi.mocked(siteQueries.getSiteEvents).mockRejectedValue(new Error("no such table: site_events"));
    const res = await call({ action: "getAll", password: "x" });
    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/0035/);
  });

  it("rejects addEvent without a title", async () => {
    const res = await call({ action: "addEvent", password: "x", title: "  " });
    expect(res.status).toBe(400);
    expect(siteQueries.addSiteEvent).not.toHaveBeenCalled();
  });

  it("adds an event with comma-separated tags", async () => {
    const res = await call({
      action: "addEvent",
      password: "x",
      title: "Holi",
      date: "March",
      tags: "Color, Beach",
      isPast: false,
      coverUrl: "/images/a.jpg",
      photos: ["/images/a.jpg"],
    });
    expect(res.status).toBe(200);
    expect(siteQueries.addSiteEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Holi",
        tags: JSON.stringify(["Color", "Beach"]),
        isPast: 0,
        displayOrder: 0,
      }),
    );
  });

  it("appends after the highest displayOrder, not the row count", async () => {
    vi.mocked(siteQueries.getSiteEvents).mockResolvedValue([
      { id: 3, date: "", title: "Kept", description: "", tags: "[]", isPast: 0, coverUrl: "", photos: "[]", displayOrder: 5, updatedAt: "" },
    ]);
    const res = await call({ action: "addEvent", password: "x", title: "New" });
    expect(res.status).toBe(200);
    expect(siteQueries.addSiteEvent).toHaveBeenCalledWith(expect.objectContaining({ displayOrder: 6 }));
  });

  it("orders a new past event against other past events", async () => {
    vi.mocked(siteQueries.getSiteEvents).mockImplementation(async (isPast?: boolean) => {
      if (isPast) {
        return [{ id: 2, date: "", title: "Old", description: "", tags: "[]", isPast: 1, coverUrl: "", photos: "[]", displayOrder: 3, updatedAt: "" }];
      }
      return [];
    });
    const res = await call({ action: "addEvent", password: "x", title: "Memory", isPast: true });
    expect(res.status).toBe(200);
    expect(siteQueries.getSiteEvents).toHaveBeenCalledWith(true);
    expect(siteQueries.addSiteEvent).toHaveBeenCalledWith(expect.objectContaining({ isPast: 1, displayOrder: 4 }));
  });

  it("drops off-site image URLs", async () => {
    const res = await call({
      action: "addEvent",
      password: "x",
      title: "X",
      coverUrl: "https://evil.example/x.jpg",
      photos: ["https://evil.example/x.jpg", "/images/ok.jpg"],
    });
    expect(res.status).toBe(200);
    expect(siteQueries.addSiteEvent).toHaveBeenCalledWith(
      expect.objectContaining({ coverUrl: "/images/ok.jpg", photos: JSON.stringify(["/images/ok.jpg"]) }),
    );
  });

  it("rejects a non-array photos payload", async () => {
    const res = await call({ action: "addEvent", password: "x", title: "X", photos: "/images/a.jpg" });
    expect(res.status).toBe(400);
    expect(siteQueries.addSiteEvent).not.toHaveBeenCalled();
  });

  it("caps galleries at 8 photos and sets cover to the first", async () => {
    const photos = Array.from({ length: 9 }, (_, i) => `/images/${i}.jpg`);
    const res = await call({ action: "addEvent", password: "x", title: "X", photos });
    expect(res.status).toBe(200);
    expect(siteQueries.addSiteEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        coverUrl: "/images/0.jpg",
        photos: JSON.stringify(photos.slice(0, 8)),
      }),
    );
  });

  it("rejects blank title on update", async () => {
    vi.mocked(siteQueries.getSiteEventById).mockResolvedValue({
      id: 1, date: "x", title: "Old", description: "", tags: "[]",
      isPast: 0, coverUrl: "/api/media/events/old.jpg", photos: "[]",
      displayOrder: 0, updatedAt: "",
    });
    const res = await call({ action: "updateEvent", password: "x", id: 1, title: "   " });
    expect(res.status).toBe(400);
    expect(siteQueries.updateSiteEvent).not.toHaveBeenCalled();
  });

  it("releases replaced R2 keys on update and ignores static /images", async () => {
    vi.mocked(siteQueries.getSiteEventById).mockResolvedValue({
      id: 1, date: "x", title: "Old", description: "", tags: "[]",
      isPast: 0,
      coverUrl: "/api/media/events/old.jpg",
      photos: JSON.stringify(["/api/media/events/old.jpg", "/images/keep.jpg"]),
      displayOrder: 0, updatedAt: "",
    });
    const res = await call({
      action: "updateEvent",
      password: "x",
      id: 1,
      coverUrl: "/api/media/events/new.jpg",
      photos: ["/api/media/events/new.jpg", "/images/keep.jpg"],
    });
    expect(res.status).toBe(200);
    expect(deleteMediaKeys).toHaveBeenCalledWith(["events/old.jpg"]);
    expect(siteQueries.countMediaUrlRefs).toHaveBeenCalledWith("/api/media/events/old.jpg");
  });

  it("releases one extra R2 photo when the gallery shrinks", async () => {
    vi.mocked(siteQueries.getSiteEventById).mockResolvedValue({
      id: 1, date: "x", title: "Old", description: "", tags: "[]",
      isPast: 0,
      coverUrl: "/api/media/events/a.jpg",
      photos: JSON.stringify(["/api/media/events/a.jpg", "/api/media/events/b.jpg", "/api/media/events/c.jpg"]),
      displayOrder: 0, updatedAt: "",
    });
    const res = await call({
      action: "updateEvent",
      password: "x",
      id: 1,
      coverUrl: "/api/media/events/a.jpg",
      photos: ["/api/media/events/a.jpg", "/api/media/events/c.jpg"],
    });
    expect(res.status).toBe(200);
    expect(deleteMediaKeys).toHaveBeenCalledWith(["events/b.jpg"]);
  });

  it("deletes R2 objects when an event is removed", async () => {
    vi.mocked(siteQueries.getSiteEventById).mockResolvedValue({
      id: 9, date: "x", title: "Gone", description: "", tags: "[]",
      isPast: 1, coverUrl: "/api/media/events/gone.jpg", photos: "[]",
      displayOrder: 0, updatedAt: "",
    });
    const res = await call({ action: "deleteEvent", password: "x", id: 9 });
    expect(res.status).toBe(200);
    expect(siteQueries.deleteSiteEvent).toHaveBeenCalledWith(9);
    expect(deleteMediaKeys).toHaveBeenCalledWith(["events/gone.jpg"]);
  });

  it("releases replaced hero images when saving page copy", async () => {
    vi.mocked(siteQueries.getSitePageCopy).mockResolvedValue({
      page: "events",
      content: JSON.stringify({
        hero: { title: "T", subtitle: "s", chips: ["A"], ribbonImage: "/api/media/heroes/old.jpg" },
        pastCta: { title: "c", body: "b" },
      }),
      updatedAt: "",
    });
    const res = await call({
      action: "saveEventsCopy",
      password: "x",
      copy: { hero: { title: "T", subtitle: "s", chips: ["A"], ribbonImage: "/api/media/heroes/new.jpg" }, pastCta: { title: "c", body: "b" } },
    });
    expect(res.status).toBe(200);
    expect(deleteMediaKeys).toHaveBeenCalledWith(["heroes/old.jpg"]);
  });

  it("strips off-site hero URLs and keeps an empty still empty", async () => {
    const evil = await call({
      action: "saveEventsCopy",
      password: "x",
      copy: { hero: { title: "T", subtitle: "s", chips: ["A"], ribbonImage: "https://evil.example/x.jpg" }, pastCta: { title: "c", body: "b" } },
    });
    expect(evil.status).toBe(200);
    const evilSaved = JSON.parse(vi.mocked(siteQueries.upsertSitePageCopy).mock.calls.at(-1)![1]);
    expect(evilSaved.hero.ribbonImage).toBe("");

    vi.mocked(siteQueries.upsertSitePageCopy).mockClear();
    const cleared = await call({
      action: "saveEventsCopy",
      password: "x",
      copy: { hero: { title: "T", subtitle: "s", chips: ["A"], ribbonImage: "" }, pastCta: { title: "c", body: "b" } },
    });
    expect(cleared.status).toBe(200);
    const clearedSaved = JSON.parse(vi.mocked(siteQueries.upsertSitePageCopy).mock.calls.at(-1)![1]);
    expect(clearedSaved.hero.ribbonImage).toBe("");
  });

  it("releases R2 objects when a space is removed", async () => {
    vi.mocked(siteQueries.getSiteCommunitySpaceById).mockResolvedValue({
      id: 2, title: "Lounge", icon: "sofa", description: "",
      imageUrl: "/api/media/community/gone.jpg", photos: "[]",
      displayOrder: 0, updatedAt: "",
    });
    const res = await call({ action: "deleteSpace", password: "x", id: 2 });
    expect(res.status).toBe(200);
    expect(siteQueries.deleteSiteCommunitySpace).toHaveBeenCalledWith(2);
    expect(deleteMediaKeys).toHaveBeenCalledWith(["community/gone.jpg"]);
  });

  it("normalizes partial page copy before save", async () => {
    const res = await call({
      action: "saveEventsCopy",
      password: "x",
      copy: { hero: { title: "Only title" } },
    });
    expect(res.status).toBe(200);
    const saved = JSON.parse(vi.mocked(siteQueries.upsertSitePageCopy).mock.calls[0][1]);
    expect(saved.hero.title).toBe("Only title");
    expect(saved.hero.chips.length).toBeGreaterThan(0);
    expect(saved.pastCta.title).toBeTruthy();
  });

  it("rejects invalid page copy instead of writing garbage", async () => {
    const res = await call({ action: "saveEventsCopy", password: "x", copy: { nope: true } });
    expect(res.status).toBe(400);
    expect(siteQueries.upsertSitePageCopy).not.toHaveBeenCalled();
  });

  it("keeps empty community copy fields and strips an evil ribbon", async () => {
    const res = await call({
      action: "saveCommunityCopy",
      password: "x",
      copy: {
        hero: { title: "T", subtitle: "", ribbonImage: "https://evil.example/x.jpg" },
        intro: { title: "", paragraph: "" },
        activities: { title: "", subtitle: "", badges: [], rhythmTitle: "", rhythmIntro: "", weekly: [] },
        specialEvents: { title: "", subtitle: "", cards: [] },
      },
    });
    expect(res.status).toBe(200);
    const saved = JSON.parse(vi.mocked(siteQueries.upsertSitePageCopy).mock.calls.at(-1)![1]);
    expect(saved.hero.subtitle).toBe("");
    expect(saved.hero.ribbonImage).toBe("");
    expect(saved.activities.badges).toEqual([]);
    expect(saved.activities.weekly).toEqual([]);
  });

  it("does not clobber a stored hero when ribbonImage is omitted", async () => {
    vi.mocked(siteQueries.getSitePageCopy).mockResolvedValue({
      page: "events",
      content: JSON.stringify({
        hero: { title: "T", subtitle: "s", chips: ["A"], ribbonImage: "/api/media/heroes/keep.jpg" },
        pastCta: { title: "c", body: "b" },
      }),
      updatedAt: "",
    });
    const res = await call({
      action: "saveEventsCopy",
      password: "x",
      copy: { hero: { title: "Only title" } },
    });
    expect(res.status).toBe(200);
    const saved = JSON.parse(vi.mocked(siteQueries.upsertSitePageCopy).mock.calls[0][1]);
    expect(saved.hero.ribbonImage).toBe("/api/media/heroes/keep.jpg");
    expect(deleteMediaKeys).not.toHaveBeenCalled();
  });

  it("still succeeds if R2 cleanup throws after a DB write", async () => {
    vi.mocked(deleteMediaKeys).mockRejectedValue(new Error("R2 down"));
    vi.mocked(siteQueries.getSiteEventById).mockResolvedValue({
      id: 1, date: "x", title: "Old", description: "", tags: "[]",
      isPast: 0, coverUrl: "/api/media/events/old.jpg", photos: "[]",
      displayOrder: 0, updatedAt: "",
    });
    const res = await call({
      action: "updateEvent",
      password: "x",
      id: 1,
      coverUrl: "/api/media/events/new.jpg",
      photos: ["/api/media/events/new.jpg"],
    });
    expect(res.status).toBe(200);
    expect(siteQueries.updateSiteEvent).toHaveBeenCalled();
  });

  it("does not delete an R2 key still referenced by another row", async () => {
    vi.mocked(siteQueries.countMediaUrlRefs).mockResolvedValue(1);
    vi.mocked(siteQueries.getSiteEventById).mockResolvedValue({
      id: 1, date: "x", title: "Old", description: "", tags: "[]",
      isPast: 0, coverUrl: "/api/media/events/shared.jpg", photos: "[]",
      displayOrder: 0, updatedAt: "",
    });
    const res = await call({
      action: "updateEvent",
      password: "x",
      id: 1,
      coverUrl: "/api/media/events/new.jpg",
      photos: ["/api/media/events/new.jpg"],
    });
    expect(res.status).toBe(200);
    expect(deleteMediaKeys).not.toHaveBeenCalled();
  });

  it("assigns displayOrder from the destination list when toggling isPast", async () => {
    vi.mocked(siteQueries.getSiteEventById).mockResolvedValue({
      id: 1, date: "x", title: "Move me", description: "", tags: "[]",
      isPast: 0, coverUrl: "", photos: "[]", displayOrder: 0, updatedAt: "",
    });
    vi.mocked(siteQueries.getSiteEvents).mockImplementation(async (isPast?: boolean) => {
      if (isPast) {
        return [{ id: 9, date: "", title: "Old", description: "", tags: "[]", isPast: 1, coverUrl: "", photos: "[]", displayOrder: 4, updatedAt: "" }];
      }
      return [{ id: 1, date: "", title: "Move me", description: "", tags: "[]", isPast: 0, coverUrl: "", photos: "[]", displayOrder: 0, updatedAt: "" }];
    });
    const res = await call({ action: "updateEvent", password: "x", id: 1, isPast: true });
    expect(res.status).toBe(200);
    expect(siteQueries.updateSiteEvent).toHaveBeenCalledWith(1, expect.objectContaining({ isPast: 1, displayOrder: 5 }));
  });

  it("releases replaced space images on update", async () => {
    vi.mocked(siteQueries.getSiteCommunitySpaceById).mockResolvedValue({
      id: 3, title: "Lounge", icon: "sofa", description: "",
      imageUrl: "/api/media/community/old.jpg", photos: JSON.stringify(["/api/media/community/old.jpg"]),
      displayOrder: 0, updatedAt: "",
    });
    const res = await call({
      action: "updateSpace",
      password: "x",
      id: 3,
      imageUrl: "/api/media/community/new.jpg",
      photos: ["/api/media/community/new.jpg"],
    });
    expect(res.status).toBe(200);
    expect(deleteMediaKeys).toHaveBeenCalledWith(["community/old.jpg"]);
  });

  it("discards an unreferenced pending upload and ignores static paths", async () => {
    const media = await call({ action: "discardMedia", password: "x", url: "/api/media/events/pending.jpg" });
    expect(media.status).toBe(200);
    expect(deleteMediaKeys).toHaveBeenCalledWith(["events/pending.jpg"]);

    vi.mocked(deleteMediaKeys).mockClear();
    const stat = await call({ action: "discardMedia", password: "x", url: "/images/a.jpg" });
    expect(stat.status).toBe(200);
    expect(deleteMediaKeys).not.toHaveBeenCalled();
  });

  it("discards a batch of pending uploads", async () => {
    const res = await call({
      action: "discardMedia",
      password: "x",
      urls: ["/api/media/events/a.jpg", "/api/media/events/b.jpg", "/images/skip.jpg"],
    });
    expect(res.status).toBe(200);
    expect(deleteMediaKeys).toHaveBeenCalledWith(["events/a.jpg", "events/b.jpg"]);
  });
});

describe("POST /api/admin/website/upload", () => {
  const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 0x00]);
  function jpegFile(type = "image/jpeg") {
    return new File([jpegBytes], "a.jpg", { type });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isPiRuntime).mockReturnValue(false);
    vi.mocked(authenticateUser).mockResolvedValue(admin);
    vi.mocked(getMediaBucket).mockReturnValue({} as never);
    vi.mocked(putMediaObject).mockResolvedValue(undefined);
  });

  it("rejects non-admin", async () => {
    vi.mocked(authenticateUser).mockResolvedValue(staff);
    const fd = new FormData();
    fd.set("password", "x");
    fd.set("folder", "events");
    fd.set("file", jpegFile());
    const res = await uploadPOST(new NextRequest("http://localhost/api/admin/website/upload", { method: "POST", body: fd }));
    expect(res.status).toBe(403);
  });

  it("rejects invalid folders", async () => {
    const fd = new FormData();
    fd.set("password", "x");
    fd.set("folder", "etc");
    fd.set("file", jpegFile());
    const res = await uploadPOST(new NextRequest("http://localhost/api/admin/website/upload", { method: "POST", body: fd }));
    expect(res.status).toBe(400);
    expect(putMediaObject).not.toHaveBeenCalled();
  });

  it("rejects empty content-type and non-JPEG bytes", async () => {
    const fd = new FormData();
    fd.set("password", "x");
    fd.set("folder", "events");
    fd.set("file", jpegFile(""));
    const emptyType = await uploadPOST(new NextRequest("http://localhost/api/admin/website/upload", { method: "POST", body: fd }));
    expect(emptyType.status).toBe(400);

    const fd2 = new FormData();
    fd2.set("password", "x");
    fd2.set("folder", "events");
    fd2.set("file", new File([new Uint8Array([1, 2, 3])], "a.jpg", { type: "image/jpeg" }));
    const badMagic = await uploadPOST(new NextRequest("http://localhost/api/admin/website/upload", { method: "POST", body: fd2 }));
    expect(badMagic.status).toBe(400);
    expect(putMediaObject).not.toHaveBeenCalled();
  });

  it("returns 503 when R2 is not bound", async () => {
    vi.mocked(getMediaBucket).mockReturnValue(null);
    const fd = new FormData();
    fd.set("password", "x");
    fd.set("folder", "events");
    fd.set("file", jpegFile());
    const res = await uploadPOST(new NextRequest("http://localhost/api/admin/website/upload", { method: "POST", body: fd }));
    expect(res.status).toBe(503);
  });

  it("returns 403 on Pi", async () => {
    vi.mocked(isPiRuntime).mockReturnValue(true);
    const fd = new FormData();
    fd.set("password", "x");
    fd.set("folder", "events");
    fd.set("file", jpegFile());
    const res = await uploadPOST(new NextRequest("http://localhost/api/admin/website/upload", { method: "POST", body: fd }));
    expect(res.status).toBe(403);
  });

  it("stores a jpeg under events/ and returns a media URL", async () => {
    const fd = new FormData();
    fd.set("password", "x");
    fd.set("folder", "events");
    fd.set("file", jpegFile());
    const res = await uploadPOST(new NextRequest("http://localhost/api/admin/website/upload", { method: "POST", body: fd }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.url).toMatch(/^\/api\/media\/events\/\d{4}-\d{2}-\d{2}-[0-9a-f-]{36}\.jpg$/i);
    expect(putMediaObject).toHaveBeenCalled();
  });
});

describe("GET /api/media/[...key]", () => {
  it("rejects path traversal", async () => {
    const res = await mediaGET(
      new NextRequest("http://localhost/api/media/events/../secret"),
      { params: Promise.resolve({ key: ["events", "..", "secret"] }) },
    );
    expect(res.status).toBe(404);
    expect(getMediaObject).not.toHaveBeenCalled();
  });

  it("returns the object with a long cache when present", async () => {
    vi.mocked(getMediaObject).mockResolvedValue({
      body: new ReadableStream(),
      httpMetadata: { contentType: "image/jpeg" },
    });
    const res = await mediaGET(
      new NextRequest("http://localhost/api/media/events/2026-08-28-abcd1234.jpg"),
      { params: Promise.resolve({ key: ["events", "2026-08-28-abcd1234.jpg"] }) },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toContain("immutable");
    expect(res.headers.get("Content-Type")).toBe("image/jpeg");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("preserves the stored media content type", async () => {
    vi.mocked(getMediaObject).mockResolvedValue({
      body: new ReadableStream(),
      httpMetadata: { contentType: "application/octet-stream" },
    });
    const res = await mediaGET(
      new NextRequest("http://localhost/api/media/events/2026-08-28-abcd1234.jpg"),
      { params: Promise.resolve({ key: ["events", "2026-08-28-abcd1234.jpg"] }) },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/octet-stream");
  });
});

describe("GET /api/site", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(siteQueries.getSiteEvents).mockResolvedValue([]);
    vi.mocked(siteQueries.getSiteCommunitySpaces).mockResolvedValue([]);
    vi.mocked(siteQueries.getSitePageCopy).mockResolvedValue(null as never);
  });

  it("returns events JSON with a CDN cache header", async () => {
    const res = await siteGET(new NextRequest("http://localhost/api/site?page=events"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toContain("s-maxage=60");
    const body = await res.json();
    expect(body.copy.hero.title).toBe(defaultEventsCopy.hero.title);
    expect(body.upcoming).toEqual([]);
    expect(body.past).toEqual([]);
  });

  it("returns community JSON", async () => {
    const res = await siteGET(new NextRequest("http://localhost/api/site?page=community"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.spaces).toEqual([]);
    expect(body.copy.intro.title).toBeTruthy();
  });

  it("rejects unknown pages", async () => {
    const res = await siteGET(new NextRequest("http://localhost/api/site?page=stay"));
    expect(res.status).toBe(404);
  });

  it("rejects a missing page query", async () => {
    const res = await siteGET(new NextRequest("http://localhost/api/site"));
    expect(res.status).toBe(404);
  });

  it("falls back to seed events when D1 throws", async () => {
    vi.mocked(siteQueries.getSiteEvents).mockRejectedValue(new Error("no such table"));
    const res = await siteGET(new NextRequest("http://localhost/api/site?page=events"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.upcoming.map((e: { title: string }) => e.title)).toEqual(
      upcomingEvents.map((e) => e.title),
    );
  });
});

describe("seed vs hardcoded content", () => {
  it("hardcoded fallback still has the current public page items", () => {
    expect(upcomingEvents.map((e) => e.title)).toEqual([
      "Ganesha Chaturthi Celebration",
      "Full Moon Beach Parties",
      "Halloween Spooktacular",
      "New Year's Eve Beach Party",
    ]);
    expect(pastEvents).toHaveLength(6);
    expect(communitySpaces.map((s) => s.icon)).toEqual(["sofa", "utensils", "dice", "laptop", "book"]);
  });
});
