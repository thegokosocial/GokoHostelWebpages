import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const adminPage = readFileSync("src/app/admin/page.tsx", "utf8");
const management = readFileSync("src/components/admin/AdminManagement.tsx", "utf8");
const tasks = readFileSync("src/components/admin/ManagementTasks.tsx", "utf8");
const attendance = readFileSync("src/components/admin/ManagementAttendance.tsx", "utf8");
const accounts = readFileSync("src/components/admin/AccountSettings.tsx", "utf8");
const foodOrder = readFileSync("src/app/food-order/page.tsx", "utf8");

describe("admin mobile navigation", () => {
  it("uses a modal drawer with a viewport-bounded, independently scrollable section list", () => {
    expect(adminPage).toContain("<Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>");
    expect(adminPage).toContain('aria-expanded={mobileMenuOpen}');
    expect(adminPage).toContain('aria-controls="admin-mobile-navigation"');
    expect(adminPage).toContain('className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3"');
    expect(adminPage).toContain('setSection(item.id); setMobileMenuOpen(false);');
  });

  it("keeps the Management tab selector below global navigation and scrollable on short phones", () => {
    expect(management).toContain('className="relative z-10 mt-4 lg:hidden"');
    expect(management).toContain("max-h-[min(70dvh,32rem)] overflow-y-auto overscroll-contain");
  });
  it("groups the existing food tabs without changing their route IDs or permissions", () => {
    expect(management).toContain('const FOOD_SETTINGS_TAB_IDS = new Set<ManagementTab>(["menu", "foodSettings", "billSettings"])');
    expect(management).toContain('permission: "canViewMenu"');
    expect(management).toContain('permission: "canManageFoodSettings"');
    expect(management).toContain('label: "Food Settings"');
    expect(management).toContain('aria-label="Food settings tabs"');
    expect(management).toContain('validValues: visibleTabs.map((t) => t.id)');
  });
  it("bounds long Management dialogs and public order history to the dynamic viewport", () => {
    const boundedScroller = "max-h-[min(90dvh,100%)]";
    expect(tasks).toContain(boundedScroller);
    expect(attendance).toContain(boundedScroller);
    expect(accounts).toContain(boundedScroller);
    expect(foodOrder).toContain("max-h-[85dvh] overflow-y-auto overscroll-contain");
  });
});
