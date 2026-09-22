import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { actionAllowed } from "@/lib/actionPermissions";
import { isValidReconciliationDate, parseReconciliationTarget, reconciliationPermission, summarizeReconciliation } from "@/lib/reconciliation";

describe("reconciliation targets", () => {
  it("accepts today and past valid dates but rejects future or impossible dates", () => {
    expect(isValidReconciliationDate("2026-09-21", "2026-09-21")).toBe(true);
    expect(isValidReconciliationDate("2026-09-20", "2026-09-21")).toBe(true);
    expect(isValidReconciliationDate("2026-09-22", "2026-09-21")).toBe(false);
    expect(isValidReconciliationDate("2026-02-30", "2026-09-21")).toBe(false);
    expect(isValidReconciliationDate("2026/09/21", "2026-09-21")).toBe(false);
  });

  it("accepts only canonical cash and positive online account targets", () => {
    expect(parseReconciliationTarget({ type: "cash" })).toEqual({ type: "cash", accountId: null });
    expect(parseReconciliationTarget({ type: "online", accountId: 7 })).toEqual({ type: "online", accountId: 7 });
    expect(parseReconciliationTarget({ type: "cash", accountId: 7 })).toBeNull();
    expect(parseReconciliationTarget({ type: "online", accountId: null })).toBeNull();
    expect(parseReconciliationTarget({ type: "online", accountId: -1 })).toBeNull();
  });

  it("maps cash and online targets to independent permissions with legacy compatibility", () => {
    const cash = parseReconciliationTarget({ type: "cash" })!;
    const online = parseReconciliationTarget({ type: "online", accountId: 3 })!;
    expect(reconciliationPermission(cash)).toBe("canReconcileCash");
    expect(reconciliationPermission(online)).toBe("canReconcileOnline");
    expect(actionAllowed("staff", { canReconcileCash: true }, reconciliationPermission(online))).toBe("forbidden");
    expect(actionAllowed("staff", { canReconcileAccounts: true }, reconciliationPermission(online))).toBe("allowed");
    expect(actionAllowed("staff", { canReconcile: true }, reconciliationPermission(cash))).toBe("allowed");
  });

  it("accepts real non-future calendar dates only", () => {
    expect(isValidReconciliationDate("2026-09-16", "2026-09-16")).toBe(true);
    expect(isValidReconciliationDate("2024-02-29", "2026-09-16")).toBe(true);
    expect(isValidReconciliationDate("2026-02-30", "2026-09-16")).toBe(false);
    expect(isValidReconciliationDate("2026-09-17", "2026-09-16")).toBe(false);
  });
});

describe("independent reconciliation workflow", () => {
  const ui = readFileSync("src/components/admin/DailyReconcile.tsx", "utf8");
  const route = readFileSync("src/app/api/admin/expenses/route.ts", "utf8");

  it("submits one account at a time and renders one action per account card", () => {
    expect(ui).toContain('target: balance.accountId === null ? { type: "cash" } : { type: "online", accountId: balance.accountId }');
    expect(ui).toContain("Reconcile {b.accountName}");
    expect(ui).not.toContain("entries,");
    expect(ui).toContain("if (!balance.isReconciled && previous[key] !== undefined)");
    expect(ui).toContain("if (res.status === 409) await loadReconciliation(true)");
  });

  it("locks and undoes only the selected ledger row", () => {
    expect(route).toContain("This account has already been reconciled");
    expect(route).toContain("where(eq(dailyLedger.id, existing[0].id))");
    expect(route).toContain('undoReconciliation: "admin_only"');
    expect(route).toContain('saveReconciliation: ["canReconcileCash", "canReconcileOnline"]');
    expect(route).not.toContain("}).where(eq(dailyLedger.date, date));");
  });

  it("uses atomic state transitions so simultaneous requests cannot overwrite or duplicate Cash", () => {
    expect(route).toContain("WHERE NOT EXISTS (");
    expect(route).toContain("sqliteWriteCount(inserted) === 0");
    expect(route).toContain("eq(dailyLedger.isReconciled, 0)");
    expect(route).toContain("eq(dailyLedger.isReconciled, 1)");
    expect(route).toContain("reconciled by another user");
  });

  it("returns reconciliation metadata on every account", () => {
    expect(route).toContain('notes: ledgerEntry?.notes || ""');
    expect(route).toContain('reconciledBy: ledgerEntry?.reconciledBy || ""');
    expect(route).toContain('reconciledAt: ledgerEntry?.reconciledAt || ""');
  });

  it("keeps the day pending until Cash and every online account are complete", () => {
    const accounts = [
      { id: 1, name: "HDFC", nickname: "Sunny HDFC" },
      { id: 2, name: "UPI", nickname: null },
    ];
    const cashOnly = summarizeReconciliation("2026-09-16", accounts, [{ accountId: null, isReconciled: 1 }]);
    expect(cashOnly).toMatchObject({ isReconciled: false, reconciledAccountCount: 1, missingAccountNames: ["Sunny HDFC", "UPI"] });

    const partialOnline = summarizeReconciliation("2026-09-16", accounts, [
      { accountId: null, isReconciled: 1 },
      { accountId: 2, isReconciled: 1 },
    ]);
    expect(partialOnline).toMatchObject({ isReconciled: false, reconciledAccountCount: 2, missingAccountNames: ["Sunny HDFC"] });

    const complete = summarizeReconciliation("2026-09-16", accounts, [
      { accountId: null, isReconciled: 1 },
      { accountId: 1, isReconciled: 1 },
      { accountId: 2, isReconciled: 1 },
    ]);
    expect(complete).toMatchObject({ isReconciled: true, reconciledAccountCount: 3, missingAccountNames: [] });
  });
});
