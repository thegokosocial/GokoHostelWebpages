export type PayableActivity = {
  key: string; kind: "note" | "payment" | "adjustment"; timestamp: string;
  actor: string; text: string; amount?: number; date?: string; method?: string;
  account?: string; links?: string; reversed?: boolean;
};

export function payableBillActivity(bill: {
  notes?: { id: number; createdAt: string; authorUsername: string; body: string }[];
  adjustments?: { id: number; createdAt: string; createdBy: string; reason: string; amount: number }[];
  payments?: { id: number; createdAt: string; createdBy: string; purpose: string; amount: number; expenseDate: string; paymentMethod: string; accountName: string; billImageLink?: string; deletedAt?: string | null }[];
}): PayableActivity[] {
  const events: PayableActivity[] = [
    ...(bill.notes || []).map(row => ({ key: `note-${row.id}`, kind: "note" as const, timestamp: row.createdAt, actor: row.authorUsername, text: row.body })),
    ...(bill.adjustments || []).map(row => ({ key: `adjustment-${row.id}`, kind: "adjustment" as const, timestamp: row.createdAt, actor: row.createdBy, text: row.reason, amount: row.amount })),
    ...(bill.payments || []).map(row => ({ key: `payment-${row.id}`, kind: "payment" as const, timestamp: row.createdAt, actor: row.createdBy, text: row.purpose, amount: row.amount, date: row.expenseDate, method: row.paymentMethod, account: row.accountName, links: row.billImageLink, reversed: Boolean(row.deletedAt) })),
  ];
  return events.sort((a, b) => (Date.parse(b.timestamp) || 0) - (Date.parse(a.timestamp) || 0) || b.key.localeCompare(a.key, "en", { numeric: true }));
}
