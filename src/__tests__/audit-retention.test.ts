import { describe, expect, it } from "vitest";
import {
  auditRetentionCutoff,
  auditRetentionParts,
  DEFAULT_AUDIT_RETENTION_MONTHS,
  normalizeAuditRetentionMonths,
} from "@/lib/auditRetention";

describe("audit retention", () => {
  it("defaults to three years and splits combined retention into years and months", () => {
    expect(normalizeAuditRetentionMonths(undefined)).toBe(DEFAULT_AUDIT_RETENTION_MONTHS);
    expect(auditRetentionParts(42)).toEqual({ years: 3, months: 6, totalMonths: 42 });
  });

  it("calculates a calendar-month cutoff", () => {
    expect(auditRetentionCutoff(18, Date.parse("2026-09-11T12:00:00.000Z"))).toBe("2025-03-11T12:00:00.000Z");
  });

  it("never allows a zero or negative retention period", () => {
    expect(normalizeAuditRetentionMonths(0)).toBe(1);
    expect(normalizeAuditRetentionMonths(-12)).toBe(1);
  });
});
