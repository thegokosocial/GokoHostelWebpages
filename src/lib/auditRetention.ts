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

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Clamp an optional UI date range to the configured retention window (IST). */
export function auditDateBounds(cutoff: string, dateFrom?: unknown, dateTo?: unknown): { start: string; end?: string } {
  const requestedStart = typeof dateFrom === "string" && DATE_RE.test(dateFrom)
    ? new Date(`${dateFrom}T00:00:00+05:30`).toISOString()
    : cutoff;
  const end = typeof dateTo === "string" && DATE_RE.test(dateTo)
    ? new Date(`${dateTo}T23:59:59.999+05:30`).toISOString()
    : undefined;
  return { start: requestedStart > cutoff ? requestedStart : cutoff, ...(end ? { end } : {}) };
}
