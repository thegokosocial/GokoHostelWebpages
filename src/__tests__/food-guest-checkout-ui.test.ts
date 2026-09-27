import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const cart = readFileSync("src/components/food/FoodCart.tsx", "utf8");
const bills = readFileSync("src/app/my-bills/page.tsx", "utf8");
const page = readFileSync("src/app/food-order/page.tsx", "utf8");
const menu = readFileSync("src/components/food/MenuBrowser.tsx", "utf8");
const guestOrderRoute = readFileSync("src/app/api/food/order/route.ts", "utf8");
const queries = readFileSync("src/db/queries.ts", "utf8");
const adminFoodOrders = readFileSync("src/app/api/admin/food-orders/route.ts", "utf8");

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

  it("auto-restores menu from remembered phone when session is missing", () => {
    expect(page).toContain('localStorage.getItem("gokoFoodPhone")');
    expect(page).toContain("setAutoReorder(true)");
    expect(page).toContain("loadFoodGuestSession()");
    expect(page).toMatch(/else if \(rememberedPhone\)[\s\S]*setAutoReorder\(true\)/);
  });

  it("mints one guest idempotency key and regenerates only after success", () => {
    expect(cart).toMatch(/useState\(\(\) => crypto\.randomUUID\(\)\)/);
    expect(cart).toContain("idempotencyKey,");
    const successIdx = cart.indexOf("setIdempotencyKey(crypto.randomUUID())");
    const errorEarlyReturn = cart.indexOf('setError(data.message || data.error || "Failed to place order")');
    expect(successIdx).toBeGreaterThan(-1);
    expect(errorEarlyReturn).toBeGreaterThan(-1);
    expect(successIdx).toBeGreaterThan(errorEarlyReturn);
  });
});

describe("guest menu UX contracts", () => {
  it("uses shared diet helpers and flat All/Veg/Non-veg controls", () => {
    expect(menu).toContain('from "@/lib/foodMenuFilters"');
    expect(menu).toContain("itemMatchesDiet");
    expect(menu).toContain("itemMatchesCurated");
    expect(menu).toContain("itemMatchesSearch");
    expect(menu).toContain("dietEmptyMessage");
    expect(menu).toContain('aria-label="Diet filter"');
    expect(menu).toContain("grid grid-cols-3 gap-1.5");
    expect(menu).toMatch(/>\s*All\s*<\/motion\.button>/);
    expect(menu).toMatch(/>\s*Veg\s*<\/motion\.button>/);
    expect(menu).toMatch(/>\s*Non-veg\s*<\/motion\.button>/);
    expect(menu).toContain("aria-labelledby={`menu-cat-${category.id}`}");
    expect(menu).not.toContain('aria-label="Food categories"');
    expect(menu).not.toContain("selectCategory");
    expect(menu).not.toContain("grid-cols-[4.25rem_minmax(0,1fr)]");
  });

  it("reserves FAB safe-area space on menu and cart button", () => {
    expect(menu).toContain("pb-[calc(4.5rem+env(safe-area-inset-bottom))]");
    expect(page).toContain("bottom-[max(0.75rem,env(safe-area-inset-bottom))]");
    expect(page).toContain("View Cart");
    expect(page).toContain('view === "menu" ? "max-w-7xl pb-0 pt-1"');
  });
});

describe("D1 ~100 bind-param fix on guest place-order path", () => {
  it("chunks line inserts at FOOD_ORDER_ITEM_INSERT_CHUNK = 5 in queries", () => {
    expect(queries).toMatch(/D1 allows ~100 bound params per statement/);
    expect(queries).toMatch(/FOOD_ORDER_ITEM_INSERT_CHUNK\s*=\s*5/);
    expect(queries).toContain("for (let start = 0; start < items.length; start += FOOD_ORDER_ITEM_INSERT_CHUNK)");
  });

  it("guest /api/food/order inserts lines only through addFoodOrderItems", () => {
    expect(guestOrderRoute).toContain("addFoodOrderItems");
    expect(guestOrderRoute).toMatch(/await addFoodOrderItems\(/);
    // Direct multi-row insert would reintroduce the D1 bind ceiling.
    expect(guestOrderRoute).not.toMatch(/\.insert\(foodOrderItems\)/);
    expect(guestOrderRoute).not.toMatch(/db\.insert\(foodOrderItems\)/);
  });

  it("admin placeOrderForGuest shares the same chunked helper", () => {
    expect(adminFoodOrders).toContain("addFoodOrderItems");
    expect(adminFoodOrders).toMatch(/await addFoodOrderItems\(/);
  });

  it("guest cart posts createdBy guest with the stable idempotencyKey", () => {
    expect(cart).toContain('createdBy: "guest"');
    expect(cart).toContain('fetch("/api/food/order"');
    expect(cart).toContain("idempotencyKey,");
  });
});
