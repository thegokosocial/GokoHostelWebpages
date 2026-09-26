import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  MANAGEMENT_NAV_GROUPS,
  filterManagementNavGroups,
} from "@/components/admin/managementNavGroups";

const managementSource = readFileSync("src/components/admin/AdminManagement.tsx", "utf8");
const sheetSource = readFileSync("src/components/ui/sheet.tsx", "utf8");

const FOOD_CHILD_IDS = new Set(["menu", "foodSettings", "billSettings"]);

function managementTabIdsFromSource(source: string): string[] {
  const tabsBlock = source.match(/const TABS[\s\S]*?= \[([\s\S]*?)\n\];/)?.[1] ?? "";
  return [...tabsBlock.matchAll(/\{\s*id:\s*"([^"]+)"/g)].map((match) => match[1]);
}

function collapsedNavIds(tabIds: string[]): string[] {
  const ids: string[] = [];
  let foodSeen = false;
  for (const id of tabIds) {
    if (FOOD_CHILD_IDS.has(id)) {
      if (!foodSeen) {
        ids.push("foodSettingsGroup");
        foodSeen = true;
      }
      continue;
    }
    ids.push(id);
  }
  return ids;
}

const ALL_NAV_IDS = [
  "dorms",
  "users",
  "preferences",
  "backup",
  "audit",
  "logs",
  "health",
  "history",
  "rates",
  "foodSettingsGroup",
  "website",
  "bulkUpload",
  "qrGenerator",
  "accountSettings",
  "attendance",
  "tasks",
  "serverSync",
  "channelManager",
  "bookingSettings",
  "razorpayPayments",
  "analytics",
  "quickLinks",
] as const;

function items(ids: readonly string[]) {
  return ids.map((id) => ({ id, label: id }));
}

describe("filterManagementNavGroups", () => {
  it("places every known nav id in exactly one group and uses foodSettingsGroup for Food", () => {
    const flat = MANAGEMENT_NAV_GROUPS.flatMap((group) => [...group.navIds]);
    expect(new Set(flat).size).toBe(flat.length);
    expect(flat.sort()).toEqual([...ALL_NAV_IDS].sort());
    expect(MANAGEMENT_NAV_GROUPS.find((group) => group.id === "food")?.navIds).toEqual(["foodSettingsGroup"]);
    expect(flat).not.toContain("menu");
    expect(flat).not.toContain("foodSettings");
    expect(flat).not.toContain("billSettings");
  });

  it("stays in sync with AdminManagement TABS after Food Settings collapse", () => {
    const tabIds = managementTabIdsFromSource(managementSource);
    expect(tabIds.length).toBeGreaterThan(10);
    const expectedNavIds = collapsedNavIds(tabIds).sort();
    const groupedIds = MANAGEMENT_NAV_GROUPS.flatMap((group) => [...group.navIds]).sort();
    expect(groupedIds).toEqual(expectedNavIds);
  });

  it("keeps open picker stacking below the admin Sheet overlay", () => {
    expect(managementSource).toContain('subMenuOpen ? "z-[26]" : "z-10"');
    expect(managementSource).toContain("fixed inset-0 z-[25] bg-black/40");
    expect(sheetSource).toContain("fixed inset-0 z-50");
  });

  it("keeps group order, omits empty groups, and preserves definition tile order", () => {
    const groups = filterManagementNavGroups(items(["analytics", "history", "rates", "preferences"]));
    expect(groups.map((group) => group.id)).toEqual(["peopleOps", "moneyBooking", "insights"]);
    expect(groups.find((group) => group.id === "insights")?.tiles.map((tile) => tile.id)).toEqual(["analytics", "history"]);
  });

  it("shows only My Preferences under People & ops for prefs-only users", () => {
    const groups = filterManagementNavGroups(items(["preferences"]));
    expect(groups).toEqual([{ id: "peopleOps", label: "People & ops", tiles: [{ id: "preferences", label: "preferences" }] }]);
  });

  it("is idempotent for the same visible set", () => {
    const once = filterManagementNavGroups(items(["analytics", "history"]));
    const twice = filterManagementNavGroups(items(["analytics", "history"]));
    expect(once).toEqual(twice);
  });
});
