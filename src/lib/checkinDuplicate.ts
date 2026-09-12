import { normalizePhone } from "@/lib/phoneUtils";

type CheckinVisitFields = {
  name: string | null | undefined;
  contact: string | null | undefined;
  arrivalDate: string | null | undefined;
};

function normalizedName(value: string | null | undefined): string {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export function checkinVisitKey(fields: CheckinVisitFields): string {
  return [
    normalizePhone(String(fields.contact || "")),
    normalizedName(fields.name),
    String(fields.arrivalDate || "").trim(),
  ].join("|");
}

export function isSameCheckinVisit(a: CheckinVisitFields, b: CheckinVisitFields): boolean {
  const key = checkinVisitKey(a);
  return Boolean(key.split("|")[0] && key.split("|")[1]) && key === checkinVisitKey(b);
}

export function dedupeCheckins<T extends CheckinVisitFields & { id: number }>(rows: T[], assignedIds = new Set<number>()): T[] {
  const seen = new Set<string>();
  const deduped: T[] = [];
  for (const row of rows) {
    const key = checkinVisitKey(row);
    if (!key.split("|")[0] || !key.split("|")[1]) {
      deduped.push(row);
      continue;
    }
    if (seen.has(key)) continue;
    seen.add(key);
    if (rows.some((candidate) => checkinVisitKey(candidate) === key && assignedIds.has(candidate.id))) continue;
    deduped.push(row);
  }
  return deduped;
}
