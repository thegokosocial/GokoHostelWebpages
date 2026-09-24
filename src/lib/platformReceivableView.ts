export type ReceivableTotalRow = {
  key: string;
  grossPaise: number;
  taxChargedPaise: number;
  taxWithheldPaise: number;
  commissionPaise: number;
  tdsPaise: number;
  tcsPaise: number;
  otherDeductionsPaise: number;
  expectedNetPaise: number | null;
  allocatedPaise: number;
  outstandingPaise: number | null;
  pendingCommission?: boolean;
};

export type ReceivableTotals = {
  grossPaise: number;
  taxChargedPaise: number;
  taxWithheldPaise: number;
  commissionPaise: number;
  tdsPaise: number;
  tcsPaise: number;
  otherDeductionsPaise: number;
  expectedNetPaise: number;
  allocatedPaise: number;
  outstandingPaise: number;
  allocationPaise: number;
  pendingCommission: boolean;
  pendingExpectedNet: boolean;
  pendingOutstanding: boolean;
};

export function matchesReceivableFilters(
  platformKey: string,
  checkinDate: string | null,
  platform: string,
  fromDate: string,
  toDate: string,
): boolean {
  if (platform && platformKey !== platform) return false;
  if ((fromDate || toDate) && !checkinDate) return false;
  return (!fromDate || checkinDate! >= fromDate) && (!toDate || checkinDate! <= toDate);
}

export function pruneReceivableSelection(
  selected: string[],
  amounts: Record<string, string>,
  visibleKeys: string[],
) {
  const visible = new Set(visibleKeys);
  return {
    selected: selected.filter((key) => visible.has(key)),
    amounts: Object.fromEntries(Object.entries(amounts).filter(([key]) => visible.has(key))),
  };
}

export function selectedReceivableTotals(
  rows: ReceivableTotalRow[],
  amounts: Record<string, string>,
): ReceivableTotals {
  return rows.reduce<ReceivableTotals>((total, row) => {
    total.grossPaise += row.grossPaise;
    total.taxChargedPaise += row.taxChargedPaise;
    total.taxWithheldPaise += row.taxWithheldPaise;
    total.commissionPaise += row.commissionPaise;
    total.tdsPaise += row.tdsPaise;
    total.tcsPaise += row.tcsPaise;
    total.otherDeductionsPaise += row.otherDeductionsPaise;
    total.expectedNetPaise += row.expectedNetPaise || 0;
    total.allocatedPaise += row.allocatedPaise;
    total.outstandingPaise += row.outstandingPaise || 0;
    const allocation = Number(amounts[row.key]);
    if (Number.isFinite(allocation) && allocation > 0) total.allocationPaise += Math.round(allocation * 100);
    total.pendingCommission ||= !!row.pendingCommission;
    total.pendingExpectedNet ||= row.expectedNetPaise == null;
    total.pendingOutstanding ||= row.outstandingPaise == null;
    return total;
  }, {
    grossPaise: 0, taxChargedPaise: 0, taxWithheldPaise: 0, commissionPaise: 0,
    tdsPaise: 0, tcsPaise: 0, otherDeductionsPaise: 0, expectedNetPaise: 0,
    allocatedPaise: 0, outstandingPaise: 0, allocationPaise: 0,
    pendingCommission: false, pendingExpectedNet: false, pendingOutstanding: false,
  });
}
