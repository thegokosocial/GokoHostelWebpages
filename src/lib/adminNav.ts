import type { AdminSection } from "@/components/admin/types";

export function isSplitsSectionEnabled(): boolean {
  return process.env.NEXT_PUBLIC_GOKO_RUNTIME !== "pi";
}

export const ADMIN_NAV: AdminSection[] = [
  "dashboard", "bookings", "beds", "timeline", "analytics", "inventory", "records", "foodOrders", "expenditure",
  ...(isSplitsSectionEnabled() ? ["splits" as const] : []),
  "reviews", "management",
];

export const ADMIN_NAV_PERMS: Record<AdminSection, string> = {
  dashboard: "canViewDashboard", bookings: "canViewBookings", beds: "canViewBeds",
  timeline: "canViewTimeline", analytics: "canViewAnalytics", inventory: "canManageInventory", records: "canViewRecords", foodOrders: "canViewFoodOrders",
  expenditure: "canViewAccounts", splits: "canViewSplits", reviews: "canViewReviews", management: "canViewManagement",
};

export function firstVisibleAdminSection(
  role: string,
  permissions: Record<string, boolean>,
  current: AdminSection,
): AdminSection | null {
  if (role === "admin") {
    return ADMIN_NAV.includes(current) ? current : (ADMIN_NAV[0] ?? null);
  }
  const isVisible = (id: AdminSection) => Boolean(permissions[ADMIN_NAV_PERMS[id]]);
  if (ADMIN_NAV.includes(current) && isVisible(current)) return current;
  return ADMIN_NAV.find(isVisible) ?? null;
}
