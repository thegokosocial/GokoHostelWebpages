/** Mobile Management picker groups. Uses nav ids (e.g. foodSettingsGroup), not child tab route ids. */

export type ManagementNavGroupDef = {
  id: string;
  label: string;
  /** Ordered Management nav item ids after Food Settings collapse. */
  navIds: readonly string[];
};

export const MANAGEMENT_NAV_GROUPS: readonly ManagementNavGroupDef[] = [
  { id: "peopleOps", label: "People & ops", navIds: ["dorms", "users", "attendance", "tasks", "preferences"] },
  { id: "food", label: "Food", navIds: ["foodSettingsGroup"] },
  { id: "moneyBooking", label: "Money & booking", navIds: ["rates", "accountSettings", "bookingSettings", "razorpayPayments", "channelManager"] },
  { id: "content", label: "Content", navIds: ["website", "qrGenerator", "quickLinks"] },
  { id: "insights", label: "Insights", navIds: ["analytics", "history"] },
  { id: "system", label: "System", navIds: ["backup", "audit", "logs", "health", "bulkUpload", "serverSync"] },
] as const;

export type ManagementNavGroupTiles<T extends { id: string }> = {
  id: string;
  label: string;
  tiles: T[];
};

/** Keep group order; drop empty groups; preserve tile order from the group definition. */
export function filterManagementNavGroups<T extends { id: string }>(
  visibleNavItems: readonly T[],
): ManagementNavGroupTiles<T>[] {
  const byId = new Map(visibleNavItems.map((item) => [item.id, item]));
  return MANAGEMENT_NAV_GROUPS.map((group) => ({
    id: group.id,
    label: group.label,
    tiles: group.navIds.map((id) => byId.get(id)).filter((item): item is T => Boolean(item)),
  })).filter((group) => group.tiles.length > 0);
}
