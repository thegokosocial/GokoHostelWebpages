"use client";

import { useState, useEffect } from "react";
import { useAdminApi } from "./useAdminApi";
import { cn } from "@/lib/utils";
import { BedDoubleIcon, UsersIcon, CalendarCheckIcon, AlertTriangleIcon } from "lucide-react";
import type { Role, AdminSection } from "./types";

export function AdminDashboard({
  password,
  role,
  onNavigate,
}: {
  password: string;
  role: Role;
  onNavigate: (section: AdminSection) => void;
}) {
  const { apiCall } = useAdminApi(password);
  const [todayCheckins, setTodayCheckins] = useState<string[][]>([]);
  const [todayCheckouts, setTodayCheckouts] = useState<string[][]>([]);
  const [stats, setStats] = useState({ total: 0, occupied: 0, available: 0, cleanup: 0 });
  const [validationOn, setValidationOn] = useState(true);
  const [togglingValidation, setTogglingValidation] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadDashboard(); }, []);

  const loadDashboard = async () => {
    setLoading(true);
    try {
      const res = await apiCall({ action: "getDashboard" });
      if (res.ok) {
        const data = await res.json();
        setTodayCheckins(data.todayCheckins || []);
        setTodayCheckouts(data.todayCheckouts || []);
        setStats(data.stats || { total: 0, occupied: 0, available: 0, cleanup: 0 });
        setValidationOn(data.validationEnabled !== false);
      }
    } finally { setLoading(false); }
  };

  const toggleValidation = async () => {
    setTogglingValidation(true);
    try {
      const newValue = validationOn ? "off" : "on";
      const res = await apiCall({ action: "setSetting", key: "image_validation", value: newValue });
      if (res.ok) setValidationOn(!validationOn);
    } finally { setTogglingValidation(false); }
  };

  const today = new Date().toISOString().split("T")[0];

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-brand-green/20 border-t-brand-green" />
        <p className="mt-4 text-sm text-brand-green-dark/60">Loading dashboard...</p>
      </div>
    );
  }

  return (
    <div>
      <h2 className="font-display text-xl font-bold text-brand-green md:text-2xl">Dashboard</h2>
      <p className="mt-1 text-sm text-brand-green-dark/60">{today}</p>

      {/* Stats cards */}
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl border border-brand-mist bg-white p-5 shadow-card">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50"><UsersIcon className="h-5 w-5 text-blue-600" /></div>
            <div>
              <p className="text-2xl font-bold text-brand-green-dark">{todayCheckins.length}</p>
              <p className="text-xs text-brand-green-dark/60">Check-ins today</p>
            </div>
          </div>
        </div>
        <div className="rounded-2xl border border-brand-mist bg-white p-5 shadow-card">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-orange-50"><CalendarCheckIcon className="h-5 w-5 text-orange-600" /></div>
            <div>
              <p className="text-2xl font-bold text-brand-green-dark">{todayCheckouts.length}</p>
              <p className="text-xs text-brand-green-dark/60">Checkouts due today</p>
            </div>
          </div>
        </div>
        <div className="rounded-2xl border border-brand-mist bg-white p-5 shadow-card">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-green-50"><BedDoubleIcon className="h-5 w-5 text-green-600" /></div>
            <div>
              <p className="text-2xl font-bold text-brand-green-dark">{stats.available}</p>
              <p className="text-xs text-brand-green-dark/60">Beds available</p>
            </div>
          </div>
        </div>
        <div className="rounded-2xl border border-brand-mist bg-white p-5 shadow-card">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-red-50"><BedDoubleIcon className="h-5 w-5 text-red-600" /></div>
            <div>
              <p className="text-2xl font-bold text-brand-green-dark">{stats.occupied}/{stats.total}</p>
              <p className="text-xs text-brand-green-dark/60">Beds occupied</p>
            </div>
          </div>
        </div>
      </div>

      {/* Occupancy bar */}
      {stats.total > 0 && (
        <div className="mt-4 rounded-xl border border-brand-mist bg-white p-4">
          <div className="flex items-center justify-between text-xs text-brand-green-dark/70">
            <span>Occupancy: {Math.round((stats.occupied / stats.total) * 100)}%</span>
            <span>{stats.occupied} occupied, {stats.available} available, {stats.cleanup} cleanup</span>
          </div>
          <div className="mt-2 flex h-3 overflow-hidden rounded-full bg-gray-100">
            {stats.occupied > 0 && <div className="bg-red-400" style={{ width: `${(stats.occupied / stats.total) * 100}%` }} />}
            {stats.cleanup > 0 && <div className="bg-orange-400" style={{ width: `${(stats.cleanup / stats.total) * 100}%` }} />}
            {stats.available > 0 && <div className="bg-green-400" style={{ width: `${(stats.available / stats.total) * 100}%` }} />}
          </div>
        </div>
      )}

      {/* Overdue checkouts alert */}
      {todayCheckouts.length > 0 && (
        <div className="mt-4 rounded-xl border border-orange-200 bg-orange-50 p-4">
          <div className="flex items-center gap-2">
            <AlertTriangleIcon className="h-5 w-5 text-orange-600" />
            <span className="font-medium text-orange-800">{todayCheckouts.length} guest{todayCheckouts.length !== 1 ? "s" : ""} due for checkout today</span>
          </div>
          <ul className="mt-2 space-y-1">
            {todayCheckouts.map((row, i) => (
              <li key={i} className="text-sm text-orange-700">{row[3]} — {row[5]}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Today's check-ins */}
      <div className="mt-6">
        <h3 className="font-display text-lg font-bold text-brand-green-dark">Today&apos;s Check-ins</h3>
        {todayCheckins.length === 0 ? (
          <p className="mt-2 text-sm text-brand-green-dark/50">No check-ins today yet</p>
        ) : (
          <div className="mt-3 space-y-2">
            {todayCheckins.map((row, i) => (
              <div key={i} className="flex items-center justify-between rounded-xl border border-brand-mist bg-white px-4 py-3">
                <div>
                  <p className="font-medium text-brand-green-dark">{row[3]}</p>
                  <p className="text-xs text-brand-green-dark/60">{row[7]}, {row[8]} · {row[4]} person{row[4] !== "1" ? "s" : ""} · {row[6]} days</p>
                </div>
                <span className="text-xs text-brand-green-dark/50">{row[2]}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Quick actions */}
      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        <button type="button" onClick={() => onNavigate("beds")} className="rounded-xl border border-brand-mist bg-white p-4 text-left transition-all hover:shadow-soft">
          <BedDoubleIcon className="h-5 w-5 text-brand-green" />
          <p className="mt-2 font-medium text-brand-green-dark">Assign Beds</p>
          <p className="text-xs text-brand-green-dark/50">Manage dorm assignments</p>
        </button>
        <button type="button" onClick={() => onNavigate("records")} className="rounded-xl border border-brand-mist bg-white p-4 text-left transition-all hover:shadow-soft">
          <UsersIcon className="h-5 w-5 text-brand-green" />
          <p className="mt-2 font-medium text-brand-green-dark">View Records</p>
          <p className="text-xs text-brand-green-dark/50">All check-in entries</p>
        </button>
        {role === "admin" && (
          <button type="button" onClick={() => onNavigate("setup")} className="rounded-xl border border-brand-mist bg-white p-4 text-left transition-all hover:shadow-soft">
            <BedDoubleIcon className="h-5 w-5 text-brand-green" />
            <p className="mt-2 font-medium text-brand-green-dark">Dorm Setup</p>
            <p className="text-xs text-brand-green-dark/50">Configure beds and dorms</p>
          </button>
        )}
      </div>

      {/* Validation toggle (admin only) */}
      {role === "admin" && (
        <div className="mt-6 flex items-center gap-3 rounded-xl border border-brand-mist bg-white px-4 py-3">
          <span className="text-sm font-medium text-brand-green-dark">ID Validation (Vision API)</span>
          <button type="button" onClick={toggleValidation} disabled={togglingValidation}
            className={cn("relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full transition-colors duration-200", validationOn ? "bg-brand-green" : "bg-brand-green-dark/20")}>
            <span className={cn("inline-block h-5 w-5 transform rounded-full bg-white shadow-md transition-transform duration-200 mt-0.5", validationOn ? "translate-x-5" : "translate-x-0.5")} />
          </button>
          <span className={cn("text-xs font-semibold", validationOn ? "text-brand-green" : "text-brand-green-dark/40")}>
            {togglingValidation ? "..." : validationOn ? "ON" : "OFF"}
          </span>
        </div>
      )}
    </div>
  );
}
