"use client";

import { useState, useEffect } from "react";
import { useAdminApi } from "./useAdminApi";
import { AdminLoading } from "./AdminLoading";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PlusIcon, Trash2Icon, CalendarIcon, RefreshCwIcon, XIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Role } from "./types";

type Booking = {
  id: number;
  guestName: string;
  contact: string;
  platform: string;
  bookingRef: string;
  checkinDate: string;
  checkoutDate: string;
  roomType: string;
  persons: number;
  paymentStatus: string;
  specialRequests: string;
  status: string;
  source: string;
  createdAt: string;
};

const PLATFORM_COLORS: Record<string, string> = {
  makemytrip: "bg-blue-100 text-blue-700",
  booking_com: "bg-indigo-100 text-indigo-700",
  hostelworld: "bg-orange-100 text-orange-700",
  direct: "bg-green-100 text-green-700",
  manual: "bg-gray-100 text-gray-700",
};

const PLATFORM_LABELS: Record<string, string> = {
  makemytrip: "MakeMyTrip",
  booking_com: "Booking.com",
  hostelworld: "Hostelworld",
  direct: "Direct",
  manual: "Manual",
};

export function AdminBookings({ password, username, role }: { password: string; username?: string; role: Role }) {
  const { apiCall } = useAdminApi(password, username);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [filterPlatform, setFilterPlatform] = useState("");
  const [filterStatus, setFilterStatus] = useState("");

  const [form, setForm] = useState({
    guestName: "", contact: "", platform: "manual", bookingRef: "",
    checkinDate: "", checkoutDate: "", roomType: "", persons: "1",
    paymentStatus: "unknown", specialRequests: "",
  });
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [syncResult, setSyncResult] = useState<string | null>(null);

  useEffect(() => { loadBookings(); loadSyncStatus(); }, []);

  const loadSyncStatus = async () => {
    const res = await apiCall({ action: "getSetting", key: "last_email_sync" });
    if (res.ok) { const d = await res.json(); setLastSync(d.value || null); }
  };

  const syncEmails = async () => {
    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await fetch("/api/bookings/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      if (res.ok) {
        setSyncResult(`Synced ${data.synced} new booking(s). ${data.skipped || 0} skipped.`);
        setLastSync(new Date().toISOString());
        if (data.synced > 0) await loadBookings();
      } else {
        setSyncResult(`Sync failed: ${data.error}`);
      }
    } catch {
      setSyncResult("Network error during sync");
    } finally { setSyncing(false); }
  };

  const loadBookings = async () => {
    setLoading(true);
    try {
      const res = await apiCall({ action: "getBookings" });
      if (res.ok) { const d = await res.json(); setBookings(d.bookings || []); }
    } finally { setLoading(false); }
  };

  const addBooking = async () => {
    if (!form.guestName || !form.checkinDate) { alert("Guest name and check-in date are required"); return; }
    setSaving(true);
    try {
      const res = await apiCall({ action: "addBooking", ...form, persons: parseInt(form.persons) || 1 });
      if (res.ok) {
        setShowForm(false);
        setForm({ guestName: "", contact: "", platform: "manual", bookingRef: "", checkinDate: "", checkoutDate: "", roomType: "", persons: "1", paymentStatus: "unknown", specialRequests: "" });
        await loadBookings();
      } else { const d = await res.json(); alert(d.error || "Failed"); }
    } finally { setSaving(false); }
  };

  const markStatus = async (id: number, status: string) => {
    await apiCall({ action: "updateBookingStatus", bookingId: id, status });
    await loadBookings();
  };

  const deleteBookingEntry = async (id: number) => {
    if (!confirm("Delete this booking?")) return;
    await apiCall({ action: "deleteBooking", bookingId: id });
    await loadBookings();
  };

  const today = new Date().toISOString().split("T")[0];
  const todayArrivals = bookings.filter((b) => b.checkinDate === today && b.status === "confirmed");
  const upcoming = bookings.filter((b) => b.checkinDate > today && b.status === "confirmed");

  const filtered = bookings.filter((b) => {
    if (filterPlatform && b.platform !== filterPlatform) return false;
    if (filterStatus && b.status !== filterStatus) return false;
    return true;
  });

  const allPlatforms = [...new Set(bookings.map((b) => b.platform))];
  const allStatuses = [...new Set(bookings.map((b) => b.status))];

  if (loading) return <AdminLoading message="Loading bookings..." />;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-display text-xl font-bold text-brand-green md:text-2xl">Bookings</h2>
          {lastSync && <p className="mt-0.5 text-[10px] text-brand-green-dark/40">Last email sync: {new Date(lastSync).toLocaleString()}</p>}
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="cta" onClick={() => setShowForm(true)}>
            <PlusIcon className="mr-1 h-4 w-4" /> Add Booking
          </Button>
          <Button type="button" variant="ctaOutline" onClick={syncEmails} disabled={syncing}>
            {syncing ? "Syncing..." : "Sync Emails"}
          </Button>
          <Button type="button" variant="ctaOutline" onClick={loadBookings}>
            <RefreshCwIcon className="mr-1 h-4 w-4" /> Refresh
          </Button>
        </div>
      </div>
      {syncResult && (
        <div className={`rounded-xl p-3 text-sm ${syncResult.includes("failed") || syncResult.includes("error") ? "bg-red-50 text-red-700" : "bg-green-50 text-green-700"}`}>
          {syncResult}
        </div>
      )}

      {/* Today's Arrivals */}
      {todayArrivals.length > 0 && (
        <div className="rounded-2xl border-2 border-brand-green bg-brand-green/[0.03] p-5">
          <h3 className="mb-3 font-semibold text-brand-green">Today&apos;s Arrivals ({todayArrivals.length})</h3>
          <div className="space-y-2">
            {todayArrivals.map((b) => (
              <div key={b.id} className="flex items-center justify-between rounded-xl bg-white p-3 shadow-sm">
                <div className="flex items-center gap-3">
                  <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold uppercase", PLATFORM_COLORS[b.platform] || "bg-gray-100 text-gray-700")}>
                    {PLATFORM_LABELS[b.platform] || b.platform}
                  </span>
                  <div>
                    <p className="font-medium text-brand-green-dark">{b.guestName}</p>
                    <p className="text-xs text-brand-green-dark/50">{b.roomType || "Any"} · {b.persons} person(s){b.contact ? ` · ${b.contact}` : ""}</p>
                  </div>
                </div>
                <button type="button" onClick={() => markStatus(b.id, "checked_in")}
                  className="rounded-lg bg-brand-green px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-green-dark">
                  Mark Arrived
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Upcoming */}
      {upcoming.length > 0 && (
        <div className="rounded-2xl border border-brand-mist bg-white p-5 shadow-sm">
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-brand-green-dark/50">Upcoming ({upcoming.length})</h3>
          <div className="space-y-2">
            {upcoming.slice(0, 10).map((b) => (
              <div key={b.id} className="flex items-center justify-between rounded-lg border border-brand-mist p-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 flex-col items-center justify-center rounded-lg bg-brand-sand">
                    <span className="text-[10px] font-bold text-brand-green-dark/60">{new Date(b.checkinDate).toLocaleDateString("en", { day: "numeric" })}</span>
                    <span className="text-[8px] uppercase text-brand-green-dark/40">{new Date(b.checkinDate).toLocaleDateString("en", { month: "short" })}</span>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-brand-green-dark">{b.guestName}</p>
                    <p className="text-xs text-brand-green-dark/50">
                      <span className={cn("mr-1.5 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase", PLATFORM_COLORS[b.platform] || "bg-gray-100 text-gray-700")}>
                        {PLATFORM_LABELS[b.platform] || b.platform}
                      </span>
                      {b.roomType || "Any"} · {b.persons}p
                    </p>
                  </div>
                </div>
                <span className="text-xs text-brand-green-dark/40">{b.checkoutDate ? `${b.checkinDate} → ${b.checkoutDate}` : b.checkinDate}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* All Bookings Table */}
      <div className="rounded-2xl border border-brand-mist bg-white shadow-sm">
        <div className="flex flex-wrap items-center gap-3 border-b border-brand-mist p-4">
          <h3 className="text-sm font-semibold text-brand-green-dark/70">All Bookings</h3>
          <select value={filterPlatform} onChange={(e) => setFilterPlatform(e.target.value)} className="rounded-md border border-input bg-background px-2 py-1 text-xs">
            <option value="">All platforms</option>
            {allPlatforms.map((p) => <option key={p} value={p}>{PLATFORM_LABELS[p] || p}</option>)}
          </select>
          <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className="rounded-md border border-input bg-background px-2 py-1 text-xs">
            <option value="">All statuses</option>
            {allStatuses.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <span className="ml-auto text-xs text-brand-green-dark/50">{filtered.length} bookings</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[800px] text-left text-sm">
            <thead>
              <tr className="border-b border-brand-mist bg-brand-sand/50">
                <th className="px-4 py-3 text-xs font-bold uppercase text-brand-green-dark/70">Guest</th>
                <th className="px-4 py-3 text-xs font-bold uppercase text-brand-green-dark/70">Platform</th>
                <th className="px-4 py-3 text-xs font-bold uppercase text-brand-green-dark/70">Check-in</th>
                <th className="px-4 py-3 text-xs font-bold uppercase text-brand-green-dark/70">Check-out</th>
                <th className="px-4 py-3 text-xs font-bold uppercase text-brand-green-dark/70">Room</th>
                <th className="px-4 py-3 text-xs font-bold uppercase text-brand-green-dark/70">Status</th>
                <th className="px-4 py-3 text-xs font-bold uppercase text-brand-green-dark/70">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-12 text-center text-brand-green-dark/50">No bookings yet</td></tr>
              ) : (
                filtered.map((b) => (
                  <tr key={b.id} className="border-b border-brand-mist/50 last:border-0 hover:bg-brand-sand/30">
                    <td className="px-4 py-3">
                      <p className="font-medium text-brand-green-dark">{b.guestName}</p>
                      {b.contact && <p className="text-[10px] text-brand-green-dark/50">{b.contact}</p>}
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn("rounded-full px-2 py-0.5 text-[9px] font-bold uppercase", PLATFORM_COLORS[b.platform] || "bg-gray-100 text-gray-700")}>
                        {PLATFORM_LABELS[b.platform] || b.platform}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-brand-green-dark/70">{b.checkinDate}</td>
                    <td className="px-4 py-3 text-xs text-brand-green-dark/70">{b.checkoutDate || "—"}</td>
                    <td className="px-4 py-3 text-xs text-brand-green-dark/70">{b.roomType || "Any"}</td>
                    <td className="px-4 py-3">
                      <span className={cn("rounded-full px-2 py-0.5 text-[9px] font-bold uppercase",
                        b.status === "confirmed" && "bg-green-100 text-green-700",
                        b.status === "checked_in" && "bg-blue-100 text-blue-700",
                        b.status === "cancelled" && "bg-red-100 text-red-700",
                        b.status === "no_show" && "bg-yellow-100 text-yellow-700",
                      )}>{b.status}</span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1">
                        {b.status === "confirmed" && (
                          <>
                            <button type="button" onClick={() => markStatus(b.id, "cancelled")} className="rounded px-1.5 py-0.5 text-[9px] text-red-500 hover:bg-red-50">Cancel</button>
                            <button type="button" onClick={() => markStatus(b.id, "no_show")} className="rounded px-1.5 py-0.5 text-[9px] text-yellow-600 hover:bg-yellow-50">No-show</button>
                          </>
                        )}
                        {role === "admin" && (
                          <button type="button" onClick={() => deleteBookingEntry(b.id)} className="rounded p-1 text-red-400 hover:bg-red-50"><Trash2Icon className="h-3.5 w-3.5" /></button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add Booking Form */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-lg font-bold text-brand-green">Add Booking</h3>
              <button type="button" onClick={() => setShowForm(false)}><XIcon className="h-5 w-5 text-brand-green-dark/40" /></button>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium text-brand-green-dark/60">Guest Name *</label>
                <Input value={form.guestName} onChange={(e) => setForm({ ...form, guestName: e.target.value })} placeholder="John Doe" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-brand-green-dark/60">Contact</label>
                <Input value={form.contact} onChange={(e) => setForm({ ...form, contact: e.target.value })} placeholder="Phone/email" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-brand-green-dark/60">Platform *</label>
                <select value={form.platform} onChange={(e) => setForm({ ...form, platform: e.target.value })} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
                  <option value="manual">Manual / Walk-in</option>
                  <option value="makemytrip">MakeMyTrip</option>
                  <option value="booking_com">Booking.com</option>
                  <option value="hostelworld">Hostelworld</option>
                  <option value="direct">Direct (WhatsApp/Call)</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-brand-green-dark/60">Booking Ref</label>
                <Input value={form.bookingRef} onChange={(e) => setForm({ ...form, bookingRef: e.target.value })} placeholder="OTA booking ID" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-brand-green-dark/60">Check-in Date *</label>
                <Input type="date" value={form.checkinDate} onChange={(e) => setForm({ ...form, checkinDate: e.target.value })} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-brand-green-dark/60">Check-out Date</label>
                <Input type="date" value={form.checkoutDate} onChange={(e) => setForm({ ...form, checkoutDate: e.target.value })} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-brand-green-dark/60">Room Type</label>
                <select value={form.roomType} onChange={(e) => setForm({ ...form, roomType: e.target.value })} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
                  <option value="">Any</option>
                  <option value="Mixed Dorm">Mixed Dorm</option>
                  <option value="Female Dorm">Female Dorm</option>
                  <option value="Luxury Dorm">Luxury Dorm</option>
                  <option value="Private Room">Private Room</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-brand-green-dark/60">Persons</label>
                <Input type="number" min="1" value={form.persons} onChange={(e) => setForm({ ...form, persons: e.target.value })} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-brand-green-dark/60">Payment</label>
                <select value={form.paymentStatus} onChange={(e) => setForm({ ...form, paymentStatus: e.target.value })} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
                  <option value="unknown">Unknown</option>
                  <option value="paid">Paid (Online)</option>
                  <option value="pay_at_property">Pay at Property</option>
                  <option value="partial">Partial</option>
                </select>
              </div>
              <div className="sm:col-span-2">
                <label className="mb-1 block text-xs font-medium text-brand-green-dark/60">Special Requests</label>
                <Input value={form.specialRequests} onChange={(e) => setForm({ ...form, specialRequests: e.target.value })} placeholder="Lower bunk, early check-in, etc." />
              </div>
            </div>
            <div className="mt-5 flex gap-2">
              <Button type="button" variant="cta" onClick={addBooking} disabled={saving}>{saving ? "Saving..." : "Add Booking"}</Button>
              <Button type="button" variant="ghost" onClick={() => setShowForm(false)}>Cancel</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
