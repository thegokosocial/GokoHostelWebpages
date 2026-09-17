export type AuditReferenceMaps = {
  dormNames?: Record<string, string>;
  bedNames?: Record<string, string>;
  channelNames?: Record<string, string>;
  ratePlanNames?: Record<string, string>;
};

export type PresentableAuditEntry = {
  id: number;
  timestamp: string;
  username: string;
  action: string;
  target: string;
  details: string;
  displayAction?: string;
  displayTarget?: string;
  displayDetails?: string;
};

type AuditPresentationFields = {
  displayAction: string;
  displayTarget: string;
  displayDetails: string;
};

const ACTION_LABELS: Record<string, string> = {
  INVENTORY_AVAILABILITY_BULK_UPDATED: "Inventory availability updated",
  INVENTORY_OVERRIDE_UPDATED: "Inventory availability updated",
  RATES_BULK_UPDATED: "Rates updated",
  RATES_BULK_ADJUSTED: "Rates adjusted",
  RESTRICTIONS_BULK_UPDATED: "Rate restrictions updated",
  RATE_UPDATED: "Rate updated",
  CHANNEL_RATE_UPDATED: "Channel rate updated",
  BEDS_BLOCKED: "Beds blocked",
  BEDS_UNBLOCKED: "Beds unblocked",
  CHANNEL_CREATED: "Sales channel added",
  CHANNEL_UPDATED: "Sales channel updated",
  CHANNEL_DELETED: "Sales channel removed",
  BED_TYPE_CONFIG_CREATED: "Bed type configuration added",
  BED_TYPE_CONFIG_UPDATED: "Bed type configuration updated",
  checkin_add: "Check-in added",
  past_checkin_add: "Past check-in added",
  checkin_booking_linked: "Booking linked to check-in",
  checkin_no_booking_needed: "Check-in marked as no booking needed",
  record_edit: "Guest record updated",
  record_delete: "Guest record deleted",
  verify_id: "Guest ID verified",
  formc_updated: "Form C updated",
  formc_submission_removed: "Form C submission removed",
  bed_assign: "Bed assigned",
  bed_checkout: "Bed checked out",
  guest_checkout_direct: "Guest checked out",
  bed_clean: "Bed marked clean",
  bed_unassign: "Bed unassigned",
  bed_change: "Guest moved to another bed",
  dorm_created: "Dorm added",
  dorm_deleted: "Dorm removed",
  bed_removed: "Bed removed",
  user_created: "User added",
  user_updated: "User updated",
  user_deleted: "User removed",
  task_created: "Task created",
  task_updated: "Task updated",
  task_archived: "Task archived",
  task_reopened: "Task reopened",
  task_expense_added: "Task expense recorded",
  password_self_change: "Password changed",
  undo_checkout: "Checkout undone",
  booking_added: "Booking added",
  booking_status_changed: "Booking status changed",
  booking_deleted: "Booking removed",
  rate_scrape_started: "Rate comparison started",
  backup_run: "Backup recorded",
  setting_changed: "Setting changed",
  vibe_matched: "Guest vibe matched",
  audit_retention_updated: "Audit retention updated",
  audit_retention_cleanup: "Old audit entries cleaned up",
  expense_added: "Expense added",
  expense_updated: "Expense updated",
  expense_deleted: "Expense deleted",
  account_reconciliation_completed: "Account reconciled",
  account_reconciliation_undone: "Account reconciliation undone",
  food_order_status: "Food order status changed",
  food_order_placed: "Food order placed",
  food_order_paid: "Food order paid",
  food_item_voided: "Food item cancelled",
  food_discount: "Food discount applied",
  food_discount_removed: "Food discount removed",
  food_order_reassigned: "Food order reassigned",
  food_payment_modified: "Food payment updated",
  food_cleanup: "Old food orders cleaned up",
  split_member_added: "Split member added",
  split_member_updated: "Split member updated",
  split_member_deactivated: "Split member deactivated",
  split_group_added: "Split group added",
  split_group_updated: "Split group updated",
  split_group_deleted: "Split group removed",
  split_expense_added: "Shared expense added",
  split_expense_updated: "Shared expense updated",
  split_expense_deleted: "Shared expense removed",
  split_settlement_added: "Split settlement added",
  split_settlement_deleted: "Split settlement removed",
  split_goko_reimbursed: "Goko reimbursement recorded",
  self_checkin: "Guest self check-in submitted",
  email_sync: "Booking email sync completed",
};

const DAY_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const OMITTED_DETAIL_KEYS = new Set(["dormIds", "dormNames", "ratePlanIds", "bedIds", "startDate", "endDate", "dateCount", "dates", "dayFilter", "sync"]);

function humanize(value: string): string {
  return value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatDate(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return String(value ?? "");
  return new Date(`${value}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

function resolveIdList(value: unknown, map: Record<string, string> | undefined, fallbackPrefix: string): string {
  if (!Array.isArray(value)) return "";
  return value.map((id) => map?.[String(id)] || `${fallbackPrefix} ${id}`).join(", ");
}

function formatValue(value: unknown): string {
  if (Array.isArray(value)) return value.join(", ");
  if (value && typeof value === "object") return Object.entries(value as Record<string, unknown>).map(([key, item]) => `${humanize(key)}: ${formatValue(item)}`).join(", ");
  return String(value);
}

function parseDetails(details: string): Record<string, unknown> | null {
  if (!details) return null;
  try {
    const parsed: unknown = JSON.parse(details);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function formatSync(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const sync = value as Record<string, unknown>;
  if (sync.accepted === true) return "PMS sync: accepted";
  if (sync.queued === true) return "PMS sync: queued for retry";
  if (sync.attempted === false) return "PMS sync: not required";
  return `PMS sync: failed${sync.message ? ` (${sync.message})` : ""}`;
}

export function auditActionLabel(action: string): string {
  return ACTION_LABELS[action] || humanize(action);
}

export function formatAuditTarget(action: string, target: string, maps: AuditReferenceMaps = {}): string {
  if (!target) return "";
  if (action === "INVENTORY_AVAILABILITY_BULK_UPDATED" && /^\d+(,\d+)*$/.test(target)) {
    return target.split(",").map((id) => maps.dormNames?.[id] || `Dorm ${id}`).join(", ");
  }
  return target
    .replace(/dorm:(\d+)/g, (_, id: string) => maps.dormNames?.[id] || `Dorm ${id}`)
    .replace(/ratePlans:([\d,]+)/g, (_, ids: string) => ids.split(",").map((id) => maps.ratePlanNames?.[id] || `Rate plan ${id}`).join(", "))
    .replace(/ratePlan:(\d+)/g, (_, id: string) => maps.ratePlanNames?.[id] || `Rate plan ${id}`)
    .replace(/channel:(\d+)/g, (_, id: string) => maps.channelNames?.[id] || `Channel ${id}`)
    .replace(/checkin:(\d+)/g, "check-in #$1")
    .replace(/userId:(\d+)/g, "user #$1")
    .replace(/\b(\d{4}-\d{2}-\d{2})\b/g, (_, date: string) => formatDate(date));
}

export function formatAuditDetails(details: string, action = "", maps: AuditReferenceMaps = {}): string {
  const parsed = parseDetails(details);
  if (!parsed) return details;

  const parts: string[] = [];
  if (parsed.mode) {
    parts.push(action === "INVENTORY_AVAILABILITY_BULK_UPDATED"
      ? parsed.mode === "set" ? "Availability set" : "Availability overrides cleared"
      : `Mode: ${humanize(String(parsed.mode))}`);
  }
  if (parsed.requestedValue !== undefined) parts.push(`online availability: ${parsed.requestedValue}`);
  if (parsed.dormIds) {
    const storedNames = Array.isArray(parsed.dormNames) ? parsed.dormNames : [];
    const rooms = Array.isArray(parsed.dormIds)
      ? parsed.dormIds.map((id, index) => maps.dormNames?.[String(id)] || String(storedNames[index] || `Dorm ${id}`)).join(", ")
      : resolveIdList(parsed.dormIds, maps.dormNames, "Dorm");
    parts.push(`Rooms: ${rooms}`);
  }
  if (parsed.ratePlanIds) parts.push(`Rate plans: ${resolveIdList(parsed.ratePlanIds, maps.ratePlanNames, "Rate plan")}`);
  if (parsed.bedIds) parts.push(`Beds: ${resolveIdList(parsed.bedIds, maps.bedNames, "Bed")}`);
  if (parsed.startDate || parsed.endDate) {
    parts.push(`Dates: ${formatDate(parsed.startDate)}${parsed.endDate ? ` to ${formatDate(parsed.endDate)}` : ""}`);
  } else if (Array.isArray(parsed.dates) && parsed.dates.length > 0) {
    parts.push(`Dates: ${formatDate(parsed.dates[0])} to ${formatDate(parsed.dates[parsed.dates.length - 1])}`);
  }
  if (parsed.dateCount !== undefined) parts.push(`${parsed.dateCount} nights`);
  if (parsed.dayFilter !== undefined) {
    const days = Array.isArray(parsed.dayFilter) ? parsed.dayFilter.map((day) => DAY_LABELS[Number(day)] || String(day)).join(", ") : formatValue(parsed.dayFilter);
    parts.push(`Days: ${days || "all days"}`);
  }
  if (parsed.cellCount !== undefined) parts.push(`${parsed.cellCount} room-nights selected`);
  if (parsed.applied !== undefined) parts.push(`${parsed.applied} applied`);
  if (parsed.updated !== undefined) parts.push(`${parsed.updated} updated`);
  if (parsed.cleared !== undefined) parts.push(`${parsed.cleared} cleared`);
  if (parsed.capped !== undefined) parts.push(`${parsed.capped} capped`);
  if (parsed.partial === true) parts.push("Partial update");
  if (parsed.sync) parts.push(formatSync(parsed.sync));

  for (const [key, value] of Object.entries(parsed)) {
    if (OMITTED_DETAIL_KEYS.has(key) || ["mode", "requestedValue", "cellCount", "applied", "updated", "cleared", "capped", "partial"].includes(key)) continue;
    if (value === null || value === undefined || value === "") continue;
    parts.push(`${humanize(key)}: ${formatValue(value)}`);
  }

  return parts.join(" · ") || (action ? humanize(action) : details);
}

export function presentAuditEntry<T extends PresentableAuditEntry>(entry: T, maps: AuditReferenceMaps = {}): T & AuditPresentationFields {
  return {
    ...entry,
    displayAction: auditActionLabel(entry.action),
    displayTarget: formatAuditTarget(entry.action, entry.target, maps),
    displayDetails: formatAuditDetails(entry.details, entry.action, maps),
  };
}
