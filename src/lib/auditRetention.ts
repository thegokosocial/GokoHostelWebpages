export const AUDIT_RETENTION_SETTING = "audit_retention_months";
export const DEFAULT_AUDIT_RETENTION_MONTHS = 36;
export const MAX_AUDIT_RETENTION_MONTHS = 1200;

export function normalizeAuditRetentionMonths(value: unknown): number {
  const months = Math.floor(Number(value));
  if (!Number.isFinite(months)) return DEFAULT_AUDIT_RETENTION_MONTHS;
  return Math.min(MAX_AUDIT_RETENTION_MONTHS, Math.max(1, months));
}

export function auditRetentionCutoff(months: number, now = Date.now()): string {
  const cutoff = new Date(now);
  cutoff.setUTCMonth(cutoff.getUTCMonth() - normalizeAuditRetentionMonths(months));
  return cutoff.toISOString();
}

export function auditRetentionParts(months: number): { years: number; months: number; totalMonths: number } {
  const totalMonths = normalizeAuditRetentionMonths(months);
  return { years: Math.floor(totalMonths / 12), months: totalMonths % 12, totalMonths };
}
