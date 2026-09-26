import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const adminPage = readFileSync("src/app/admin/page.tsx", "utf8");
const management = readFileSync("src/components/admin/AdminManagement.tsx", "utf8");
const analytics = readFileSync("src/components/admin/AdminAnalytics.tsx", "utf8");
const managementNavGroups = readFileSync("src/components/admin/managementNavGroups.ts", "utf8");
const tasks = readFileSync("src/components/admin/ManagementTasks.tsx", "utf8");
const attendance = readFileSync("src/components/admin/ManagementAttendance.tsx", "utf8");
const accounts = readFileSync("src/components/admin/AccountSettings.tsx", "utf8");
const bookingSettings = readFileSync("src/components/admin/BookingSettings.tsx", "utf8");
const channelManager = readFileSync("src/components/admin/ChannelManager.tsx", "utf8");
const audit = readFileSync("src/components/admin/ManagementAudit.tsx", "utf8");
const logs = readFileSync("src/components/admin/ManagementLogs.tsx", "utf8");
const website = readFileSync("src/components/admin/AdminWebsite.tsx", "utf8");
const websitePayments = readFileSync("src/components/admin/WebsitePaymentsLedger.tsx", "utf8");
const managementTabStyles = readFileSync("src/components/admin/managementSectionTabs.ts", "utf8");
const foodOrder = readFileSync("src/app/food-order/page.tsx", "utf8");

describe("admin mobile navigation", () => {
  it("uses a modal drawer with a viewport-bounded, independently scrollable section list", () => {
    expect(adminPage).toContain("<Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>");
    expect(adminPage).toContain('aria-expanded={mobileMenuOpen}');
    expect(adminPage).toContain('aria-controls="admin-mobile-navigation"');
    expect(adminPage).toContain('className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3"');
    expect(adminPage).toContain("bg-white/95 p-0 backdrop-blur-md dark:bg-zinc-900/95");
    expect(adminPage).toContain("setSection(item.id);");
    expect(adminPage).toContain("setMobileMenuOpen(false);");
    expect(adminPage).toContain("}, [section]);");
    expect(adminPage).not.toContain("queueMicrotask(() => setMobileMenuOpen(false))");
  });

  it("keeps the Management selector below global navigation with a dimmed dismiss layer and high open stacking", () => {
    expect(management).toContain('subMenuOpen ? "z-[26]" : "z-10"');
    expect(management).toContain('className="fixed inset-0 z-[25] bg-black/40"');
    expect(management).toContain("max-h-[min(70dvh,32rem)] overflow-y-auto overscroll-contain");
    expect(management).toContain('id="management-mobile-nav"');
    expect(management).toContain("filterManagementNavGroups");
    expect(adminPage).toContain("sticky top-0 z-30");
  });

  it("renders grouped compact tiles on mobile and keeps Food Settings as the only permission-collapsing group", () => {
    expect(management).toContain("mobileNavGroups.map");
    expect(management).toContain("grid-cols-3");
    expect(management).toContain('const FOOD_SETTINGS_TAB_IDS = new Set<ManagementTab>(["menu", "foodSettings", "billSettings"])');
    expect(management).toContain('permission: "canViewMenu"');
    expect(management).toContain('permission: "canManageFoodSettings"');
    expect(management).toContain('label: "Food Settings"');
    expect(management).toContain('aria-label="Food settings tabs"');
    expect(management).toContain('validValues: visibleTabs.map((t) => t.id)');
    expect(managementNavGroups).toContain('navIds: ["foodSettingsGroup"]');
    expect(managementNavGroups).toContain('label: "People & ops"');
    expect(managementNavGroups).toContain('label: "Money & booking"');
  });

  it("lays out Analytics KPI strips as a 2-col tile grid without horizontal snap-scroll", () => {
    expect(analytics).toContain("grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4");
    expect(analytics).not.toMatch(/function MetricCard[\s\S]*?min-w-\[42%\]/);
    expect(analytics).not.toContain("snap-x snap-mandatory");
    expect(analytics).toContain("sticky top-0 -mx-1");
    expect(analytics).not.toContain("sticky top-0 z-10");
  });

  it("groups the existing food tabs without changing their route IDs or permissions", () => {
    expect(management).toContain('const FOOD_SETTINGS_TAB_IDS = new Set<ManagementTab>(["menu", "foodSettings", "billSettings"])');
    expect(management).toContain('permission: "canViewMenu"');
    expect(management).toContain('permission: "canManageFoodSettings"');
    expect(management).toContain('label: "Food Settings"');
    expect(management).toContain('aria-label="Food settings tabs"');
    expect(management).toContain('validValues: visibleTabs.map((t) => t.id)');
  });

  it("keeps Razorpay payment records under Management with a room tab and food placeholder", () => {
    expect(management).toContain('id: "razorpayPayments", label: "Razorpay payments"');
    expect(management).toContain('import("./RazorpayPayments")');
    const razorpayPayments = readFileSync("src/components/admin/RazorpayPayments.tsx", "utf8");
    expect(razorpayPayments).toContain('aria-label="Razorpay payment tabs"');
    expect(razorpayPayments).toContain("WebsitePaymentsLedger");
    expect(razorpayPayments).toContain("Food payment records will be available here soon.");
    expect(bookingSettings).not.toContain("WebsitePaymentsLedger");
    expect(websitePayments).toContain("25 entries per page");
    expect(websitePayments).toContain("DateRangePicker");
    expect(websitePayments).toContain("Previous");
    expect(websitePayments).toContain("Next");
  });

  it("shares the Account Settings selector styling across existing Management section selectors", () => {
    const consumers = [management, accounts, bookingSettings, channelManager, audit, logs, website];
    for (const source of consumers) {
      expect(source).toContain("managementSectionTabsClass");
      expect(source).toContain("managementSectionTabClass");
      expect(source).toContain("managementSectionTabActiveClass");
      expect(source).toContain("managementSectionTabInactiveClass");
    }
    expect(managementTabStyles).toContain("flex flex-wrap gap-1 rounded-lg border border-brand-mist bg-white p-1 dark:bg-card");
    expect(managementTabStyles).toContain('"bg-brand-green text-white"');
  });

  it("bounds long Management dialogs and public order history to the dynamic viewport", () => {
    const boundedScroller = "max-h-[min(90dvh,100%)]";
    expect(tasks).toContain(boundedScroller);
    expect(attendance).toContain(boundedScroller);
    expect(accounts).toContain(boundedScroller);
    expect(foodOrder).toContain("max-h-[85dvh] overflow-y-auto overscroll-contain");
  });
});
