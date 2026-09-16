import { getDb } from "@/db";
import { accounts, dailyLedger } from "@/db/schema";
import { eq } from "drizzle-orm";

type LedgerOpening = {
  openingBalance: number;
  expectedClosing: number;
  actualClosing: number | null;
  isReconciled: number;
  openingAdjusted: number;
};

export function resolveOpeningBalance(
  current: LedgerOpening | undefined,
  previous: LedgerOpening | undefined,
  seed: number,
): number {
  if (current && (current.isReconciled || current.openingAdjusted)) return current.openingBalance;
  if (previous) return previous.actualClosing ?? previous.expectedClosing;
  return seed;
}

export type ReconciliationStatus = {
  date: string;
  isReconciled: boolean;
  requiredAccountCount: number;
  reconciledAccountCount: number;
  missingAccountNames: string[];
};

export type ReconciliationTarget =
  | { type: "cash"; accountId: null }
  | { type: "online"; accountId: number };

export function parseReconciliationTarget(value: unknown): ReconciliationTarget | null {
  if (!value || typeof value !== "object") return null;
  const target = value as { type?: unknown; accountId?: unknown };
  if (target.type === "cash" && (target.accountId === undefined || target.accountId === null)) {
    return { type: "cash", accountId: null };
  }
  if (target.type === "online" && Number.isInteger(target.accountId) && Number(target.accountId) > 0) {
    return { type: "online", accountId: Number(target.accountId) };
  }
  return null;
}

export function reconciliationPermission(target: ReconciliationTarget): "canReconcileCash" | "canReconcileOnline" {
  return target.type === "cash" ? "canReconcileCash" : "canReconcileOnline";
}

export function isValidReconciliationDate(value: unknown, today: string): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value > today) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function summarizeReconciliation(
  date: string,
  activeAccounts: Array<{ id: number; name: string; nickname: string | null }>,
  ledgerEntries: Array<{ accountId: number | null; isReconciled: number }>,
): ReconciliationStatus {
  const reconciledIds = new Set(
    ledgerEntries.filter((entry) => entry.isReconciled === 1).map((entry) => entry.accountId),
  );
  const required = [
    { id: null as number | null, name: "Cash" },
    ...activeAccounts.map((account) => ({
      id: account.id as number | null,
      name: account.nickname || account.name,
    })),
  ];
  const missingAccountNames = required
    .filter((account) => !reconciledIds.has(account.id))
    .map((account) => account.name);

  return {
    date,
    isReconciled: missingAccountNames.length === 0,
    requiredAccountCount: required.length,
    reconciledAccountCount: required.length - missingAccountNames.length,
    missingAccountNames,
  };
}

/** Cash plus every currently active account must have a reconciled row. */
export async function getReconciliationStatus(date: string): Promise<ReconciliationStatus> {
  const db = getDb();
  const [activeAccounts, ledgerEntries] = await Promise.all([
    db.select({ id: accounts.id, name: accounts.name, nickname: accounts.nickname })
      .from(accounts)
      .where(eq(accounts.isActive, 1)),
    db.select({ accountId: dailyLedger.accountId, isReconciled: dailyLedger.isReconciled })
      .from(dailyLedger)
      .where(eq(dailyLedger.date, date)),
  ]);

  return summarizeReconciliation(date, activeAccounts, ledgerEntries);
}
