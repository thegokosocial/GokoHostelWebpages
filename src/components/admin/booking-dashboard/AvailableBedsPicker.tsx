"use client";

import { cn } from "@/lib/utils";
import { Loader2Icon, CheckIcon } from "lucide-react";

export type AvailableBedUnit = {
  key: string;
  label: string;
  dormId: number;
  dormName: string;
  type: string;
  capacity: number;
  bedIds: number[];
  pool?: "online" | "offline" | "block" | string;
};

export function AvailableBedsPicker({
  units,
  selectedKeys,
  dormRates,
  loading,
  onToggle,
  emptyLabel = "No beds available for the selected dates",
}: {
  units: AvailableBedUnit[];
  selectedKeys: string[];
  dormRates: Record<number, number>;
  loading?: boolean;
  onToggle: (key: string) => void;
  emptyLabel?: string;
}) {
  const byDorm = new Map<number, { id: number; name: string; beds: AvailableBedUnit[] }>();
  for (const unit of units) {
    if (!byDorm.has(unit.dormId)) byDorm.set(unit.dormId, { id: unit.dormId, name: unit.dormName, beds: [] });
    byDorm.get(unit.dormId)!.beds.push(unit);
  }
  const dorms = Array.from(byDorm.values());

  return (
    <div>
      <p className="mt-0.5 text-[10px] text-muted-foreground">
        <span className="font-medium text-sky-700 dark:text-sky-400">Blue</span> = OTA (pushed to PMS)
        {" · "}
        <span className="font-medium text-emerald-700 dark:text-emerald-400">Green</span> = walk-in
        {" · "}
        <span className="font-medium text-orange-600">Orange</span> = blocked (clears the block, no PMS push)
        {" · "}One guest may use one slot of a double bed; two guests need both slots.
      </p>
      {loading ? (
        <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2Icon className="size-3.5 animate-spin" /> Loading available beds...
        </div>
      ) : (
        <div className="mt-2 space-y-2">
          {dorms.map((dorm) => {
            const onlineN = dorm.beds.filter((b) => (b.pool ?? "online") === "online").length;
            const offlineN = dorm.beds.filter((b) => b.pool === "offline").length;
            const blockN = dorm.beds.filter((b) => b.pool === "block").length;
            return (
              <div key={dorm.id} className="rounded-lg border border-border p-2">
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <span className="text-[11px] font-semibold text-foreground">{dorm.name}</span>
                  <span className="text-[10px] text-muted-foreground">
                    {onlineN > 0 && <span className="text-sky-700 dark:text-sky-400">{onlineN} OTA</span>}
                    {onlineN > 0 && (offlineN > 0 || blockN > 0) && " · "}
                    {offlineN > 0 && <span className="text-emerald-700 dark:text-emerald-400">{offlineN} walk-in</span>}
                    {offlineN > 0 && blockN > 0 && " · "}
                    {blockN > 0 && <span className="text-orange-600">{blockN} blocked</span>}
                    {onlineN === 0 && offlineN === 0 && blockN === 0 && `${dorm.beds.length} available`}
                    {dormRates[dorm.id] ? ` · ₹${dormRates[dorm.id]}/night` : ""}
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {dorm.beds.map((bed) => {
                    const isSelected = selectedKeys.includes(bed.key);
                    const pool = bed.pool ?? "online";
                    return (
                      <button
                        key={bed.key}
                        type="button"
                        onClick={() => onToggle(bed.key)}
                        className={cn(
                          "flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium transition-colors",
                          isSelected && pool === "online" && "border-sky-600 bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200",
                          isSelected && pool === "offline" && "border-emerald-600 bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
                          isSelected && pool === "block" && "border-orange-500 bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-200",
                          !isSelected && pool === "online" && "border-sky-200 bg-sky-50/80 text-sky-800 hover:bg-sky-100 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-200",
                          !isSelected && pool === "offline" && "border-emerald-200 bg-emerald-50/80 text-emerald-800 hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200",
                          !isSelected && pool === "block" && "border-orange-200 bg-orange-50 text-orange-800 hover:bg-orange-100 dark:border-orange-800 dark:bg-orange-950/40 dark:text-orange-200",
                        )}
                      >
                        {isSelected && <CheckIcon className="size-3" />}
                        {bed.label}{bed.capacity > 1 ? " · up to 2 guests" : ""}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
          {dorms.length === 0 && !loading && (
            <p className="text-xs text-muted-foreground">{emptyLabel}</p>
          )}
        </div>
      )}
    </div>
  );
}
