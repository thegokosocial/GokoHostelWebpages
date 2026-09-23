import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");

function readFile(relativePath: string): string {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf-8");
}

function exists(relativePath: string): boolean {
  return fs.existsSync(path.join(ROOT, relativePath));
}

describe("Workers CPU: zero-regression API paths", () => {
  it("uses one legacy digest and verifies versioned KDF hashes for kitchen users", () => {
    const auth = readFile("src/lib/auth.ts");
    const fn = auth.match(/export async function authenticateKitchen[\s\S]*?\nexport /)?.[0]
      ?? auth.match(/export async function authenticateKitchen[\s\S]*$/)?.[0];
    expect(fn).toBeTruthy();
    expect(fn!).toContain("const legacy = await legacyHashPassword(password)");
    const hashAt = fn!.indexOf("const legacy = await legacyHashPassword(password)");
    expect(fn!.indexOf("process.env.ADMIN_PASSWORD")).toBeGreaterThan(-1);
    expect(fn!.indexOf("process.env.ADMIN_PASSWORD")).toBeLessThan(hashAt);
    expect(fn!.indexOf("process.env.MANAGER_PASSWORD")).toBeGreaterThan(-1);
    expect(fn!.indexOf("process.env.MANAGER_PASSWORD")).toBeLessThan(hashAt);
    const loop = fn!.match(/for \(const user of allUsers\) \{[\s\S]*?\n    \}/)?.[0];
    expect(loop).toBeTruthy();
    expect(loop!).toContain("legacy === user.passwordHash");
    expect(loop!).toContain("verifyPassword(password, user.passwordHash)");
  });

  it("loads kitchen ticket tags by ordered item ids, not the full menu", () => {
    const route = readFile("src/app/api/food/kitchen/route.ts");
    const section = route.match(/action === "listOrders"[\s\S]*?action === "updateStatus"/)?.[0];
    expect(section).toBeTruthy();
    expect(section!).toContain("getMenuItemTagsByIds");
    expect(section!).toContain('tags: menuItemTags.get(i.menuItemId) || "[]"');
    expect(section!).toContain("hasModifications");
    expect(section!).toContain("isBusy");
    expect(section!).not.toContain("getAllMenuItems");
    expect(section!).toContain("inArray(orderModifications.orderId, batchIds)");
    expect(section!).toContain("if (orderIds.length > 0)");
    expect(section!.split("getFoodOrderItemsBatch").length - 1).toBe(1);

    const tagsFn = readFile("src/db/queries.ts").match(
      /export async function getMenuItemTagsByIds[\s\S]*?return map;\n\}/,
    )?.[0];
    expect(tagsFn).toBeTruthy();
    expect(tagsFn!).toContain("if (ids.length === 0) return map");
    expect(tagsFn!).toContain("uniqueInBatches(ids)");
    expect(tagsFn!).toContain("inArray(menuItems.id, batch)");
  });

  it("keeps sold-out panel on getMenuItems and does not slow the kitchen poll", () => {
    const route = readFile("src/app/api/food/kitchen/route.ts");
    const menu = route.match(/action === "getMenuItems"[\s\S]*?action === /)?.[0]
      ?? route.match(/action === "getMenuItems"[\s\S]*$/)?.[0];
    expect(menu).toContain("getAllMenuItems");

    const dashboard = readFile("src/components/kitchen/KitchenDashboard.tsx");
    expect(dashboard).toContain("setInterval(tick, 5000)");
    expect(dashboard).toContain("if (!document.hidden) fetchOrders()");
    expect(dashboard).toContain('authScope = "kitchen"');
    expect(dashboard).toContain("scope: authScope");
    expect(readFile("src/components/admin/AdminFoodOrders.tsx")).toContain('authScope="admin"');
    expect(route).toContain('authenticateKitchen(password, scope === "admin" ? "admin" : "kitchen")');
    expect(readFile("src/db/queries.ts")).toContain('inArray(foodOrders.status, ["pending_approval", "placed", "preparing", "ready"])');
    expect(dashboard).toContain('showError("Kitchen orders unavailable"');
    expect(dashboard).toContain("lastFetchErrorRef");
    expect(dashboard).toContain("now - previous.at >= 30_000");
    expect(route).toContain("Kitchen modification metadata unavailable:");
  });

  it("lets any authenticated user hit the login auth action before RBAC", () => {
    const checkins = readFile("src/app/api/admin/checkins/route.ts");
    const adminPage = readFile("src/app/admin/page.tsx");
    expect(checkins).toMatch(/if \(action === "auth"\) \{\s*return NextResponse\.json\(\{ role, permissions \}\);/);
    expect(checkins.indexOf('if (action === "auth")')).toBeLessThan(checkins.indexOf("ACTION_PERMISSIONS"));
    const permMap = checkins.match(/const ACTION_PERMISSIONS: Record<string, ActionPerm> = \{[\s\S]*?\n    \};/)?.[0];
    expect(permMap).toBeTruthy();
    expect(permMap!).not.toMatch(/\bauth\s*:/);
    expect(adminPage).toContain('scope: "admin"');
    expect(adminPage).not.toMatch(/action: "list"/);
    expect(adminPage).toContain("firstVisibleAdminSection");
    expect(adminPage).toContain("This account has no admin sections assigned.");
  });

  it("uses one grace-day parser on lookup, guest order, and admin getActiveGuests", () => {
    for (const file of [
      "src/app/api/food/lookup/route.ts",
      "src/app/api/food/order/route.ts",
      "src/app/api/admin/food-orders/route.ts",
    ]) {
      expect(readFile(file)).toContain("parseFoodCheckoutGraceDays");
      expect(readFile(file)).not.toMatch(/Number\(graceDaysStr\) \|\| 10/);
    }
  });
});

describe("Workers CPU: static shells and client islands", () => {
  it("marks operational layouts force-static without touching review tokens", () => {
    for (const file of [
      "src/app/admin/layout.tsx",
      "src/app/kitchen/layout.tsx",
      "src/app/self-checkin/layout.tsx",
      "src/app/food-order/layout.tsx",
      "src/app/food-order/status/layout.tsx",
      "src/app/my-bills/layout.tsx",
      "src/app/(marketing)/page.tsx",
      "src/app/(marketing)/stay/page.tsx",
      "src/app/(marketing)/events/page.tsx",
      "src/app/(marketing)/story/page.tsx",
      "src/app/(marketing)/how-to-reach/page.tsx",
      "src/app/(marketing)/things-to-do/page.tsx",
      "src/app/(marketing)/faqs/page.tsx",
      "src/app/(marketing)/booking-enquiry/page.tsx",
      "src/app/(marketing)/reviews/page.tsx",
      "src/app/(marketing)/community-area/page.tsx",
    ]) {
      expect(readFile(file)).toMatch(/export const dynamic = "force-static"/);
    }
    const reviewPage = readFile("src/app/review/[token]/page.tsx");
    expect(reviewPage).toMatch(/^"use client"/);
    expect(reviewPage).not.toMatch(/force-static/);
    expect(readFile("src/app/review/layout.tsx")).not.toMatch(/force-static/);
  });

  it("defers kitchen, food-order, and self-checkin islands to the client", () => {
    const kitchen = readFile("src/app/kitchen/page.tsx");
    expect(kitchen).toContain('import("@/components/kitchen/KitchenDashboard")');
    expect(kitchen).toContain("ssr: false");
    expect(kitchen).not.toMatch(/framer-motion/);

    const food = readFile("src/app/food-order/page.tsx");
    expect(food).toContain('import { PhoneEntry, type GuestInfo } from "@/components/food/PhoneEntry"');
    expect(food).not.toMatch(/import\("@\/components\/food\/PhoneEntry"\)/);
    expect(food).toContain('import("@/components/food/MenuBrowser")');
    expect(food).toContain('import("@/components/food/FoodCart")');
    expect(food.split("ssr: false").length - 1).toBeGreaterThanOrEqual(2);

    const selfCheckin = readFile("src/app/self-checkin/page.tsx");
    const island = readFile("src/components/forms/SelfCheckinFormIsland.tsx");
    expect(selfCheckin).toContain("SelfCheckinFormIsland");
    expect(selfCheckin).toContain("Welcome to Goko Hostel");
    expect(island).toContain('import("@/components/forms/SelfCheckinForm")');
    expect(island).toContain("ssr: false");
  });

  it("hydrates events and community from /api/site after a static seed", () => {
    expect(readFile("src/app/(marketing)/events/page.tsx")).toContain("EventsPageLive");
    expect(readFile("src/app/(marketing)/community-area/page.tsx")).toContain("CommunityPageLive");
    expect(readFile("src/components/sections/EventsPageLive.tsx")).toContain('fetch("/api/site?page=events")');
    expect(readFile("src/components/sections/CommunityPageLive.tsx")).toContain('fetch("/api/site?page=community")');
  });

  it("does not enable OpenNext cache interception in this change", () => {
    const openNext = readFile("open-next.config.ts");
    expect(openNext).not.toMatch(/enableCacheInterception/);
    expect(openNext).not.toMatch(/staticAssetsIncrementalCache/);
    expect(openNext).not.toMatch(/doQueue|r2IncrementalCache/);
  });
});

describe("Workers CPU: marketing chrome split", () => {
  it("keeps SiteShell off the root layout and on marketing + 404/error only", () => {
    expect(readFile("src/app/layout.tsx")).not.toContain("SiteShell");
    expect(readFile("src/app/(marketing)/layout.tsx")).toContain("SiteShell");
    expect(readFile("src/app/not-found.tsx")).toContain("SiteShell");
    expect(readFile("src/app/error.tsx")).toContain("SiteShell");
    expect(readFile("src/app/(marketing)/error.tsx")).not.toContain("SiteShell");
    expect(readFile("src/app/layout.tsx")).not.toContain("googleTagManager");
    expect(readFile("src/app/(marketing)/layout.tsx")).toContain("googleTagManagerId");
    expect(readFile("src/components/layout/SiteShell.tsx")).toMatch(/^"use client"/);
    expect(readFile("src/components/layout/Footer.tsx")).toMatch(/^"use client"/);
    expect(readFile("src/components/layout/ErrorFallback.tsx")).toContain("export function ErrorFallback");
  });

  it("moves public pages under (marketing) and leaves tools + /review outside", () => {
    expect(exists("src/app/(marketing)/page.tsx")).toBe(true);
    expect(exists("src/app/(marketing)/reviews/page.tsx")).toBe(true);
    expect(exists("src/app/page.tsx")).toBe(false);
    expect(exists("src/app/reviews/page.tsx")).toBe(false);
    expect(exists("src/app/review/[token]/page.tsx")).toBe(true);
    expect(exists("src/app/admin/page.tsx")).toBe(true);
    expect(exists("src/app/kitchen/page.tsx")).toBe(true);
    expect(exists("src/app/self-checkin/page.tsx")).toBe(true);

    const bare = readFile("src/components/layout/ShellWrapper.tsx");
    expect(bare).toContain('"/review"');
    expect(bare).not.toContain('"/reviews"');

    const robots = readFile("src/app/robots.ts");
    expect(robots).toContain('"/review/"');
    expect(robots).not.toMatch(/"\/review"(?!\/)/);
  });

  it("keeps Book now in the site header", () => {
    const header = readFile("src/components/layout/Header.tsx");
    expect(header).toContain("BookNowButton");
    expect(header).toContain("Book now");
  });

  it("does not replace looping heroes with stills", () => {
    const backdrop = readFile("src/components/media/HeroBackdrop.tsx");
    expect(backdrop).not.toContain("requestIdleCallback");
    expect(backdrop).toContain("const showVideo = Boolean(video) && !reduceMotion;");

    const ribbon = readFile("src/components/layout/PageRibbon.tsx");
    expect(ribbon).toContain("heroVideo = heroLoopVideo");

    expect(readFile("src/components/sections/HomeHeroPremium.tsx")).toContain("video={heroLoopVideo}");
    expect(readFile("src/app/(marketing)/stay/page.tsx")).toContain("heroVideo={heroVideoB}");
    expect(readFile("src/components/sections/EventsPageLive.tsx")).not.toMatch(/heroVideo=/);
    expect(readFile("src/components/sections/CommunityPageLive.tsx")).toContain("heroVideo={heroVideoB}");
    expect(readFile("src/app/(marketing)/faqs/page.tsx")).toContain("heroVideo={heroVideoB}");
    expect(readFile("src/app/(marketing)/how-to-reach/page.tsx")).toContain("heroVideo={heroVideoB}");
    expect(readFile("src/app/(marketing)/story/page.tsx")).not.toMatch(/heroVideo=/);
    expect(readFile("src/app/(marketing)/reviews/page.tsx")).not.toMatch(/heroVideo=/);
    expect(readFile("src/app/(marketing)/booking-enquiry/page.tsx")).not.toMatch(/heroVideo=/);
    expect(readFile("src/app/(marketing)/things-to-do/page.tsx")).toContain("heroVideo={null}");
  });
});
