export function defaultAccountingDateRange(today: string) {
  const [year, month] = today.split("-").map(Number);
  const from = new Date(Date.UTC(year, month - 2, 1)).toISOString().slice(0, 10);
  return { fromDate: from, toDate: today };
}

export function isValidAccountingDateRange(fromDate: string, toDate: string, today: string) {
  const validDate = (value: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value > today) return false;
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  };
  return validDate(fromDate) && validDate(toDate) && fromDate <= toDate;
}

export function resolveActivityAnchor(
  openingBalance: number,
  actualClose?: { date: string; actualClosing: number | null } | null,
  openingAdjustment?: { date: string; openingBalance: number } | null,
) {
  if (openingAdjustment && (!actualClose || openingAdjustment.date > actualClose.date)) {
    return { date: openingAdjustment.date, balance: openingAdjustment.openingBalance, type: "opening_adjustment" as const, includeAnchorDay: true };
  }
  if (actualClose?.actualClosing != null) {
    return { date: actualClose.date, balance: actualClose.actualClosing, type: "actual_close" as const, includeAnchorDay: false };
  }
  return { date: null, balance: openingBalance, type: "opening_balance" as const, includeAnchorDay: true };
}
