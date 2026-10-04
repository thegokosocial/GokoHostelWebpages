import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const cart = readFileSync("src/components/food/FoodCart.tsx", "utf8");
const bills = readFileSync("src/app/my-bills/page.tsx", "utf8");
const page = readFileSync("src/app/food-order/page.tsx", "utf8");
const menu = readFileSync("src/components/food/MenuBrowser.tsx", "utf8");

describe("guest food checkout and bills restore", () => {
  it("shows locked walk-in name when lookup already provided one", () => {
    expect(cart).toContain("walkinNameLocked");
    expect(cart).toContain("knownWalkinName");
    expect(cart).toContain("guestInfo.guestType === \"walkin\" ? guestInfo.name.trim() : \"\"");
    expect(cart).toContain("walkinNameLocked ? knownWalkinName : walkinName.trim()");
    expect(cart).toMatch(/walkinNameLocked \? \([\s\S]*knownWalkinName/);
  });

  it("keeps hostel name and dorm read-only with special instructions", () => {
    expect(cart).toContain("Charged to room tab");
    expect(cart).toContain("Special Instructions");
    expect(cart).toContain("guestInfo.roomInfo");
  });

  it("returns from my-bills to food-order without history.back logout paths", () => {
    expect(bills).toContain('router.push("/food-order")');
    expect(bills).not.toContain("router.back()");
    expect(bills).not.toContain("window.history.length");
    expect(bills).toContain("← Back to menu");
  });
});

describe("guest menu diet filters and floating cart", () => {
  it("keeps All/Veg/Non-veg on one grid row and removes Special chips", () => {
    expect(menu).toContain('aria-label="Diet filter"');
    expect(menu).toContain("grid shrink-0 grid-cols-3");
    expect(menu).toMatch(/>\s*All\s*<\/motion\.button>/);
    expect(menu).toMatch(/bg-green-500" \/>\s*Veg\s*<\/motion\.button>/);
    expect(menu).toMatch(/bg-red-500" \/>\s*Non-veg\s*<\/motion\.button>/);
    expect(menu).toContain('aria-label="Food categories"');
    expect(menu).not.toContain("Goko Special");
    expect(menu).not.toContain("Chef Special");
    expect(menu).not.toContain("curatedFilter");
    expect(menu).not.toContain("hasGokoSpecial");
  });

  it("keeps phone lookup and menu loading recoverable on mobile", () => {
    const phone = readFileSync("src/components/food/PhoneEntry.tsx", "utf8");
    expect(page).toContain('aria-busy="true"');
    expect(page).toContain("Loading the menu…");
    expect(page).toContain("Retry menu");
    expect(phone).toContain('name="phone"');
    expect(phone).toContain('autoComplete="tel-national"');
    expect(phone).toContain('aria-describedby={error ? "food-phone-error" : "food-phone-help"}');
    expect(phone).toContain('role="alert"');
  });

  it("uses full-height rail layout and floating View Cart with safe-area", () => {
    expect(menu).toContain("h-[calc(100dvh-4.75rem)]");
    expect(menu).toContain("pb-[calc(3.75rem+env(safe-area-inset-bottom))]");
    expect(page).toContain("bottom-[max(0.75rem,env(safe-area-inset-bottom))]");
    expect(page).toContain("View Cart");
  });

  it("searches all categories and lands on the hit category after Add", () => {
    expect(menu).toContain("Search all dishes");
    expect(menu).toContain("const searching = q.length > 0");
    expect(menu).toContain("searching");
    expect(menu).toContain("items.filter(");
    expect(menu).toMatch(/searchQuery\.trim\(\)[\s\S]*setSelectedCategory\(item\.categoryId\)/);
    expect(menu).toMatch(/setSelectedCategory\(item\.categoryId\)[\s\S]*setSearchQuery\(""\)/);
  });

  it("centers a red clear-search control without Framer translate fight", () => {
    expect(menu).toContain('aria-label="Clear search"');
    expect(menu).toContain("bg-red-500");
    expect(menu).toContain("absolute inset-y-0 right-0 flex items-center");
    expect(menu).not.toMatch(/Clear search[\s\S]{0,400}top-1\/2 -translate-y-1\/2/);
    expect(menu).not.toMatch(/bg-gray-300[\s\S]{0,80}Clear search|Clear search[\s\S]{0,200}bg-gray-300/);
  });
});
