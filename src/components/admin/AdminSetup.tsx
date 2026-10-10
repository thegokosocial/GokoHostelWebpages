"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAdminApi } from "./useAdminApi";
import { useAdminToast } from "@/components/admin/AdminToast";
import { AdminLoading } from "./AdminLoading";
import { cn } from "@/lib/utils";
import { PlusIcon, Trash2Icon } from "lucide-react";
import { parseBedRow, type BedRow } from "./types";

export function AdminSetup({ password, username }: { password: string; username?: string }) {
  const { apiCall } = useAdminApi(password, username);
  const { showError } = useAdminToast();
  const [beds, setBeds] = useState<BedRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [newDorm, setNewDorm] = useState("");
  const [newBedCount, setNewBedCount] = useState("6");
  const [newBedType, setNewBedType] = useState<BedRow["type"]>("Bunk");
  const [minAge, setMinAge] = useState("18");
  const [maxAge, setMaxAge] = useState("40");
  const [ageSaving, setAgeSaving] = useState(false);
  const [ageLoaded, setAgeLoaded] = useState(false);
  const [showDobInRecords, setShowDobInRecords] = useState(false);
  const [togglingDob, setTogglingDob] = useState(false);

  useEffect(() => { loadBeds(); loadAgeSettings(); }, []);

  const loadBeds = async () => {
    setLoading(true);
    try {
      const res = await apiCall({ action: "getBeds" });
      if (res.ok) {
        const data = await res.json();
        setBeds((data.beds || []).map(parseBedRow));
      }
    } finally { setLoading(false); }
  };

  const addDorm = async () => {
    if (!newDorm.trim()) { showError("Enter a dorm name"); return; }
    const count = parseInt(newBedCount) || 6;
    setLoading(true);
    try {
      const res = await apiCall({ action: "initDorms", dormName: newDorm.trim(), bedCount: count, bedType: newBedType });
      if (res.ok) { setNewDorm(""); await loadBeds(); }
      else { const d = await res.json(); showError("Failed to add dorm", d.error); }
    } finally { setLoading(false); }
  };

  const removeBed = async (bedIdx: number) => {
    if (!confirm("Remove this bed? Only available beds can be removed.")) return;
    setLoading(true);
    try {
      const res = await apiCall({ action: "removeBed", bedId: bedIdx });
      if (res.ok) await loadBeds();
      else { const d = await res.json(); showError("Failed to remove bed", d.error); }
    } finally { setLoading(false); }
  };

  const removeDorm = async (dormName: string) => {
    const dormBeds = beds.filter((b) => b.dormName === dormName);
    const hasOccupied = dormBeds.some((b) => b.status !== "available");
    if (hasOccupied) { showError("Cannot delete dorm with occupied or cleanup beds. Checkout all guests first."); return; }
    if (!confirm(`Delete entire dorm "${dormName}", all ${dormBeds.length} beds, and its calendar and channel data?`)) return;
    setLoading(true);
    try {
      const res = await apiCall({ action: "removeDorm", dormName });
      if (res.ok) await loadBeds();
      else { const d = await res.json(); showError("Failed to remove dorm", d.error); }
    } finally { setLoading(false); }
  };

  const loadAgeSettings = async () => {
    try {
      const [minRes, maxRes, dobRes] = await Promise.all([
        apiCall({ action: "getSetting", key: "guest_min_age" }),
        apiCall({ action: "getSetting", key: "guest_max_age" }),
        apiCall({ action: "getSetting", key: "show_dob_in_records" }),
      ]);
      if (minRes.ok) { const d = await minRes.json(); if (d.value) setMinAge(d.value); }
      if (maxRes.ok) { const d = await maxRes.json(); if (d.value) setMaxAge(d.value); }
      if (dobRes.ok) { const d = await dobRes.json(); setShowDobInRecords(d.value === "true"); }
    } catch {}
    setAgeLoaded(true);
  };

  const toggleShowDob = async () => {
    setTogglingDob(true);
    const newVal = !showDobInRecords;
    try {
      await apiCall({ action: "setSetting", key: "show_dob_in_records", value: newVal ? "true" : "false" });
      setShowDobInRecords(newVal);
    } finally { setTogglingDob(false); }
  };

  const saveAgeRange = async () => {
    const min = parseInt(minAge);
    const max = parseInt(maxAge);
    if (isNaN(min) || isNaN(max) || min < 1 || max < 1) { showError("Enter valid age values"); return; }
    if (min >= max) { showError("Min age must be less than max age"); return; }
    setAgeSaving(true);
    try {
      await Promise.all([
        apiCall({ action: "setSetting", key: "guest_min_age", value: String(min) }),
        apiCall({ action: "setSetting", key: "guest_max_age", value: String(max) }),
      ]);
    } finally { setAgeSaving(false); }
  };

  const dorms = [...new Set(beds.map((b) => b.dormName))];

  if (loading) {
    return <AdminLoading message="Loading setup..." />;
  }

  return (
    <div>
      <h2 className="font-display text-xl font-bold text-brand-green md:text-2xl">Dorm Setup</h2>
      <p className="mt-1 text-sm text-brand-green-dark/60">Configure dorms and beds. Only available beds can be removed.</p>

      {/* Add new dorm */}
      <div className="mt-6 rounded-2xl border border-brand-mist bg-white dark:bg-card p-4 sm:p-6 shadow-card dark:shadow-none">
        <h3 className="font-display text-base font-bold text-brand-green-dark">Add new dorm</h3>
        <div className="mt-4 grid gap-3 sm:grid-cols-4">
          <div>
            <Label className="text-xs">Dorm name</Label>
            <Input value={newDorm} onChange={(e) => setNewDorm(e.target.value)} placeholder="e.g. Mixed Dorm 1" className="mt-1" />
          </div>
          <div>
            <Label className="text-xs">Number of units</Label>
            <p className="mt-1 text-xs text-brand-green-dark/50">The selected bed type determines how many bookable beds each unit creates.</p>
            <Input type="number" value={newBedCount} onChange={(e) => setNewBedCount(e.target.value)} min="1" max="20" className="mt-1" />
          </div>
          <div>
            <Label className="text-xs">Bed type</Label>
            <select value={newBedType} onChange={(e) => setNewBedType(e.target.value as BedRow["type"])} className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
              <option value="Bunk">Bunk (1 upper + 1 lower)</option>
              <option value="Bunk2L1U">Bunk (2 lower + 1 upper)</option>
              <option value="Double">Double bed (2 lower)</option>
              <option value="Single">Single beds</option>
            </select>
          </div>
          <div className="flex items-end">
            <Button type="button" variant="cta" onClick={addDorm} disabled={loading}>
              <PlusIcon className="mr-1 h-4 w-4" /> Add dorm
            </Button>
          </div>
        </div>
      </div>

      {/* Guest Age Range */}
      {ageLoaded && (
        <div className="mt-6 rounded-2xl border border-brand-mist bg-white dark:bg-card p-4 sm:p-6 shadow-card dark:shadow-none">
          <h3 className="font-display text-base font-bold text-brand-green-dark">Guest Age Range</h3>
          <p className="mt-1 text-xs text-brand-green-dark/50">Guests outside this age range will be flagged for staff review. Staff can dismiss flags by marking &ldquo;Vibe Matches&rdquo;.</p>
          <div className="mt-4 flex items-end gap-3">
            <div className="w-28">
              <Label className="text-xs">Min age</Label>
              <Input type="number" value={minAge} onChange={(e) => setMinAge(e.target.value)} min="1" max="99" className="mt-1" />
            </div>
            <span className="pb-2 text-sm text-brand-green-dark/40">&ndash;</span>
            <div className="w-28">
              <Label className="text-xs">Max age</Label>
              <Input type="number" value={maxAge} onChange={(e) => setMaxAge(e.target.value)} min="1" max="99" className="mt-1" />
            </div>
            <Button type="button" variant="cta" size="sm" onClick={saveAgeRange} disabled={ageSaving}>
              {ageSaving ? "Saving..." : "Save"}
            </Button>
          </div>
          <div className="mt-4 flex items-center gap-3 border-t border-brand-mist pt-4">
            <span className="text-sm font-medium text-brand-green-dark">Show DOB in Records</span>
            <button type="button" onClick={toggleShowDob} disabled={togglingDob}
              className={cn("relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full transition-colors duration-200", showDobInRecords ? "bg-brand-green" : "bg-brand-green-dark/20")}>
              <span className={cn("inline-block h-5 w-5 transform rounded-full bg-white shadow-md transition-transform duration-200 mt-0.5", showDobInRecords ? "translate-x-5" : "translate-x-0.5")} />
            </button>
            <span className={cn("text-xs font-semibold", showDobInRecords ? "text-brand-green" : "text-brand-green-dark/40")}>
              {togglingDob ? "..." : showDobInRecords ? "ON" : "OFF"}
            </span>
          </div>
        </div>
      )}

      {/* Existing dorms */}
      <div className="mt-6 space-y-4">
        {dorms.length === 0 ? (
          <p className="py-10 text-center text-brand-green-dark/50">No dorms configured yet. Add one above.</p>
        ) : dorms.map((dormName) => {
          const dormBeds = beds.map((b) => ({ bed: b, idx: b.id })).filter(({ bed }) => bed.dormName === dormName);

          const groupMap = new Map<string, { upper?: typeof dormBeds[0]; lowers: typeof dormBeds[0][]; singles: typeof dormBeds[0][] }>();
          const singleBeds: typeof dormBeds[0][] = [];
          for (const item of dormBeds) {
            if (item.bed.type === "Single") { singleBeds.push(item); continue; }
            const numMatch = item.bed.bedId.match(/\d+/);
            const num = parseInt(numMatch?.[0] || "0");
            const groupKey = String(Math.ceil(num / 2));
            if (!groupMap.has(groupKey)) groupMap.set(groupKey, { lowers: [], singles: [] });
            const group = groupMap.get(groupKey)!;
            if (item.bed.position === "Upper") group.upper = item;
            else group.lowers.push(item);
          }
          const bunkGroups = [...groupMap.values()];
          const isDouble = dormBeds.every(({ bed }) => bed.type === "Double");

          const statusFill = (s: string) => s === "available" ? "#22c55e" : s === "occupied" ? "#ef4444" : "#f97316";
          const statusBg = (s: string) => s === "available" ? "bg-green-50 dark:bg-green-950 border-green-300" : s === "occupied" ? "bg-red-50 dark:bg-red-950 border-red-300" : "bg-orange-50 dark:bg-orange-950 border-orange-300";

          return (
            <div key={dormName} className="rounded-2xl border border-brand-mist bg-white dark:bg-card p-5 shadow-card dark:shadow-none">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-display text-base font-bold text-brand-green-dark">{dormName}</h3>
                  <p className="text-xs text-brand-green-dark/50">{dormBeds.length} beds · {bunkGroups.length} {isDouble ? "doubles" : "bunks"}{singleBeds.length > 0 ? ` · ${singleBeds.length} singles` : ""}</p>
                </div>
                <button type="button" onClick={() => removeDorm(dormName)}
                  className="flex items-center gap-1 rounded-md bg-red-50 dark:bg-red-950 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-100 dark:hover:bg-red-900/50">
                  <Trash2Icon className="h-3.5 w-3.5" /> Delete dorm
                </button>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
                {bunkGroups.map((group, gi) => (
                  <div key={gi} className="overflow-hidden rounded-xl border border-brand-mist bg-brand-sand/20">
                    <div className="bg-brand-green-dark/[0.03] px-2.5 py-1">
                      <span className="text-[9px] font-bold uppercase tracking-widest text-brand-green-dark/30">{isDouble ? "Double" : "Bunk"} {gi + 1}</span>
                    </div>
                    {group.upper && (
                      <div className={cn("mx-1.5 mt-1.5 flex items-center justify-between rounded-lg border px-2.5 py-2", statusBg(group.upper.bed.status))}>
                        <div className="flex items-center gap-2">
                          <svg viewBox="0 0 20 14" className="h-3.5 w-5 shrink-0"><rect x="1" y="1" width="18" height="5" rx="1.5" fill={statusFill(group.upper.bed.status)} opacity="0.3" stroke={statusFill(group.upper.bed.status)} strokeWidth="0.8" /><rect x="1" y="8" width="18" height="5" rx="1.5" fill="none" stroke="#d1d5db" strokeWidth="0.5" strokeDasharray="2 1.5" /></svg>
                          <span className="text-[11px] font-semibold text-brand-green-dark">{group.upper.bed.bedId}</span>
                          <span className="text-[9px] text-brand-green-dark/40">Upper</span>
                        </div>
                        {group.upper.bed.status === "available" && (
                          <button type="button" onClick={() => removeBed(group.upper!.idx)} className="rounded p-0.5 text-red-400 hover:text-red-600"><Trash2Icon className="h-3 w-3" /></button>
                        )}
                      </div>
                    )}
                    {group.lowers.map((lower, li) => (
                      <div key={li} className={cn("mx-1.5 mt-1 flex items-center justify-between rounded-lg border px-2.5 py-2", li === group.lowers.length - 1 && "mb-1.5", statusBg(lower.bed.status))}>
                        <div className="flex items-center gap-2">
                          <svg viewBox="0 0 20 14" className="h-3.5 w-5 shrink-0"><rect x="1" y="1" width="18" height="5" rx="1.5" fill="none" stroke="#d1d5db" strokeWidth="0.5" strokeDasharray="2 1.5" /><rect x="1" y="8" width="18" height="5" rx="1.5" fill={statusFill(lower.bed.status)} opacity="0.3" stroke={statusFill(lower.bed.status)} strokeWidth="0.8" /></svg>
                          <span className="text-[11px] font-semibold text-brand-green-dark">{lower.bed.bedId}</span>
                          <span className="text-[9px] text-brand-green-dark/40">Lower</span>
                        </div>
                        {lower.bed.status === "available" && (
                          <button type="button" onClick={() => removeBed(lower.idx)} className="rounded p-0.5 text-red-400 hover:text-red-600"><Trash2Icon className="h-3 w-3" /></button>
                        )}
                      </div>
                    ))}
                  </div>
                ))}
                {singleBeds.map(({ bed, idx }) => (
                  <div key={idx} className="overflow-hidden rounded-xl border border-brand-mist bg-brand-sand/20">
                    <div className="bg-brand-green-dark/[0.03] px-2.5 py-1">
                      <span className="text-[9px] font-bold uppercase tracking-widest text-brand-green-dark/30">Single</span>
                    </div>
                    <div className={cn("m-1.5 flex items-center justify-between rounded-lg border px-2.5 py-2", statusBg(bed.status))}>
                      <div className="flex items-center gap-2">
                        <svg viewBox="0 0 20 10" className="h-3 w-5 shrink-0"><rect x="1" y="1" width="18" height="8" rx="1.5" fill={statusFill(bed.status)} opacity="0.3" stroke={statusFill(bed.status)} strokeWidth="0.8" /></svg>
                        <span className="text-[11px] font-semibold text-brand-green-dark">{bed.bedId}</span>
                      </div>
                      {bed.status === "available" && (
                        <button type="button" onClick={() => removeBed(idx)} className="rounded p-0.5 text-red-400 hover:text-red-600"><Trash2Icon className="h-3 w-3" /></button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
