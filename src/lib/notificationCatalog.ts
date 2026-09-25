export const NOTIFICATION_CATEGORIES = [
  {
    id: "booking",
    label: "Bookings",
    permission: "canReceiveBookingNotifications",
    events: [
      ["booking.new", "New booking"],
      ["booking.rebooked", "Booking rebooked"],
      ["booking.modified", "Booking modified"],
      ["booking.dates_changed", "Booking dates changed"],
      ["booking.cancelled", "Booking cancelled"],
      ["booking.partially_cancelled", "Booking partially cancelled"],
      ["booking.no_show", "Booking marked no-show"],
    ],
  },
  {
    id: "checkin",
    label: "Check-ins",
    permission: "canReceiveCheckinNotifications",
    events: [
      ["checkin.new", "New check-in"],
      ["checkin.guest_checked_in", "Booking guest checked in"],
    ],
  },
  {
    id: "food",
    label: "Food",
    permission: "canReceiveFoodNotifications",
    events: [["food.new_order", "New food order"]],
  },
  {
    id: "attention",
    label: "Attention",
    permission: "canReceiveAttentionNotifications",
    events: [
      ["attention.booking", "Booking needs attention"],
      ["attention.bed_assignment", "Booking needs bed assignment"],
    ],
  },
  {
    id: "operations",
    label: "Operations",
    permission: "canReceiveOperationsNotifications",
    events: [
      ["operations.ota_inventory_reconciliation", "OTA inventory reconciliation needed"],
      ["operations.channel_booking_sync_failed", "Channel booking sync failed"],
      ["operations.inventory_sync_failed", "Inventory sync failed"],
    ],
  },
  {
    id: "reminder",
    label: "Reminders",
    permission: "canReceiveReminderNotifications",
    events: [["reminder.reconciliation_pending", "Reconciliation pending"]],
  },
] as const;

export type NotificationCategory = typeof NOTIFICATION_CATEGORIES[number]["id"];
export type SelectableNotificationType = typeof NOTIFICATION_CATEGORIES[number]["events"][number][0];
export type NotificationType = SelectableNotificationType | "system.test";

export const NOTIFICATION_TYPES = NOTIFICATION_CATEGORIES.flatMap((category) =>
  category.events.map(([id, label]) => ({ id, label, category: category.id })),
);
export const NOTIFICATION_TYPE_IDS = NOTIFICATION_TYPES.map((event) => event.id);
export const NOTIFICATION_PERMISSION_KEYS = NOTIFICATION_CATEGORIES.map((category) => category.permission);

export function notificationCategoryFor(type: NotificationType): NotificationCategory | "test" {
  if (type === "system.test") return "test";
  return NOTIFICATION_TYPES.find((event) => event.id === type)?.category || "operations";
}

export function allowedNotificationCategories(role: string, permissions: Record<string, boolean> | null | undefined): NotificationCategory[] {
  if (role === "admin") return NOTIFICATION_CATEGORIES.map((category) => category.id);
  const grants = permissions && typeof permissions === "object" ? permissions : {};
  const configured = NOTIFICATION_PERMISSION_KEYS.some((key) => Object.prototype.hasOwnProperty.call(grants, key));
  return NOTIFICATION_CATEGORIES.filter((category) => !configured || grants[category.permission]).map((category) => category.id);
}

export function withDefaultNotificationPermissions(permissions: Record<string, boolean>): Record<string, boolean> {
  if (NOTIFICATION_PERMISSION_KEYS.some((key) => Object.prototype.hasOwnProperty.call(permissions, key))) return { ...permissions };
  return Object.fromEntries([...Object.entries(permissions), ...NOTIFICATION_PERMISSION_KEYS.map((key) => [key, true])]);
}

export function parseMutedNotificationTypes(raw: unknown): SelectableNotificationType[] {
  try {
    const values = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!Array.isArray(values)) return [];
    const valid = new Set(NOTIFICATION_TYPE_IDS);
    return [...new Set(values.filter((value): value is SelectableNotificationType => typeof value === "string" && valid.has(value as SelectableNotificationType)))];
  } catch { return []; }
}
