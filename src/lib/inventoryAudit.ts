export const INVENTORY_AUDIT_ACTION_PREFIXES = [
  "CHANNEL_",
  "BED_TYPE_CONFIG_",
  "BEDS_",
  "INVENTORY_",
  "RATE_",
  "RATES_",
  "RESTRICTIONS_",
] as const;

export function isInventoryAuditAction(action: string): boolean {
  return INVENTORY_AUDIT_ACTION_PREFIXES.some((prefix) => action.startsWith(prefix));
}
