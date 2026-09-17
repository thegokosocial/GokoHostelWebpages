"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Loader2Icon, RefreshCwIcon, SendIcon, CheckCircleIcon, SettingsIcon, XIcon, PencilIcon, RotateCcwIcon } from "lucide-react";
import { cn, localDateStr } from "@/lib/utils";
import { bookingWhatsAppNumber } from "@/lib/bookingWhatsApp";
import { useStaffWhatsApp } from "./StaffWhatsAppProvider";
import { DateRangePicker } from "@/components/dates/DateRangePicker";

interface ReviewRequest {
  id: number;
  token: string;
  whatsappSentCount: number;
  whatsappLastSentAt: string | null;
  rating: number | null;
  ratedAt: string | null;
}

interface GuestRow {
  checkinId: number;
  guestName: string;
  guestContact: string;
  checkedOutAt: string;
  bookingPlatform: string;
  bookingId: string;
  reviewRequest: ReviewRequest | null;
}

interface Settings {
  review_google_url: string;
  review_send_delay: string;
  review_whatsapp_enabled: boolean;
  review_message_template: string;
}

interface Props {
  password: string;
  username: string;
}

function getDateNDaysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return localDateStr(d);
}

function formatDate(iso: string): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  } catch { return iso; }
}

export function ReviewAskTab({ password, username }: Props) {
  const prepareWhatsApp = useStaffWhatsApp();
  const preparing = useRef(false);
  const [sendError, setSendError] = useState("");
  const [guests, setGuests] = useState<GuestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [sendingId, setSendingId] = useState<number | null>(null);
  const [filterMode, setFilterMode] = useState<"days" | "range">("days");
  const [daysBack, setDaysBack] = useState(7);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [editGuest, setEditGuest] = useState<GuestRow | null>(null);
  const [editRating, setEditRating] = useState<string>("");
  const [editSentCount, setEditSentCount] = useState<string>("0");
  const [editSaving, setEditSaving] = useState(false);
  const [resetting, setResetting] = useState(false);

  const apiCall = useCallback(async (body: Record<string, any>) => {
    const payload: Record<string, any> = { password, ...body };
    if (username) payload.username = username;
    const res = await fetch("/api/admin/reviews", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return res;
  }, [password, username]);

  const loadGuests = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, any> = { action: "listAskReview" };
      if (filterMode === "days") {
        params.fromDate = getDateNDaysAgo(daysBack);
      } else {
        if (fromDate) params.fromDate = fromDate;
        if (toDate) params.toDate = toDate;
      }
      const res = await apiCall(params);
      if (res.ok) {
        const data = await res.json();
        setGuests(data.guests || []);
      }
    } catch {}
    setLoading(false);
  }, [apiCall, filterMode, daysBack, fromDate, toDate]);

  const loadSettings = useCallback(async () => {
    setSettingsLoading(true);
    try {
      const res = await apiCall({ action: "getSettings" });
      if (res.ok) setSettings(await res.json());
    } catch {}
    setSettingsLoading(false);
  }, [apiCall]);

  useEffect(() => { loadGuests(); }, [loadGuests]);
  useEffect(() => { loadSettings(); }, [loadSettings]);

  const saveSettings = async () => {
    if (!settings) return;
    setSettingsSaving(true);
    try {
      await apiCall({
        action: "updateSettings",
        settings: {
          review_google_url: settings.review_google_url,
          review_send_delay: settings.review_send_delay,
          review_whatsapp_enabled: String(settings.review_whatsapp_enabled),
          review_message_template: settings.review_message_template,
        },
      });
    } catch {}
    setSettingsSaving(false);
    setShowSettings(false);
  };

  const handleSendWhatsApp = async (guest: GuestRow) => {
    if (preparing.current) return;
    setSendError("");
    if (!bookingWhatsAppNumber(guest.guestContact)) {
      setSendError("A valid guest phone number is required before preparing a review message.");
      return;
    }
    preparing.current = true;
    setSendingId(guest.checkinId);
    try {
      const res = await apiCall({
        action: "sendWhatsApp",
        checkinId: guest.checkinId,
        guestName: guest.guestName,
        guestContact: guest.guestContact,
        bookingId: guest.bookingId || "",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not prepare the review message.");
      const token = data.token;
      if (typeof token !== "string" || !token) throw new Error("The review link was not returned. Please try again.");
      const reviewUrl = `${window.location.origin}/review/${encodeURIComponent(token)}`;
      const template = settings?.review_message_template ||
        "Thank you for staying with us! ❤️\n\nHow was your experience? Please rate your stay:\n{REVIEW_URL}";
      const message = template.split("{REVIEW_URL}").join(reviewUrl);
      prepareWhatsApp(guest.guestContact, message, "reviews");
      await loadGuests();
    } catch (error) {
      setSendError(error instanceof Error ? error.message : "Could not prepare the review message. Please try again.");
    } finally { preparing.current = false; setSendingId(null); }
  };

  const openEditModal = (guest: GuestRow) => {
    setEditGuest(guest);
    setEditRating(guest.reviewRequest?.rating?.toString() || "");
    setEditSentCount(guest.reviewRequest?.whatsappSentCount?.toString() || "0");
  };

  const handleEditSave = async () => {
    if (!editGuest?.reviewRequest) return;
    setEditSaving(true);
    try {
      await apiCall({
        action: "editReviewRequest",
        reviewRequestId: editGuest.reviewRequest.id,
        rating: editRating === "" ? null : Number(editRating),
        whatsappSentCount: Number(editSentCount) || 0,
      });
      await loadGuests();
      setEditGuest(null);
    } catch {}
    setEditSaving(false);
  };

  const handleReset = async () => {
    if (!editGuest) return;
    if (!confirm(`Reset review data for ${editGuest.guestName}? This will delete all review and feedback data for this guest. The process will start fresh.`)) return;
    setResetting(true);
    try {
      await apiCall({ action: "resetReviewRequest", checkinId: editGuest.checkinId });
      await loadGuests();
      setEditGuest(null);
    } catch {}
    setResetting(false);
  };

  const getButtonStyle = (guest: GuestRow) => {
    const rr = guest.reviewRequest;
    if (rr?.rating) return { className: "bg-gray-200 dark:bg-[#2a2a2a] text-gray-500 dark:text-gray-400 cursor-not-allowed", label: `Rated ${rr.rating}★`, disabled: true };
    if (!rr || rr.whatsappSentCount === 0) return { className: "bg-emerald-600 hover:bg-emerald-700 text-white", label: "Send WhatsApp", disabled: false };
    if (rr.whatsappSentCount === 1) return { className: "bg-orange-500 hover:bg-orange-600 text-white", label: `Prepared (${rr.whatsappSentCount})`, disabled: false };
    return { className: "bg-red-500 hover:bg-red-600 text-white", label: `Prepared (${rr.whatsappSentCount})`, disabled: false };
  };

  return (
    <div className="space-y-4">
      {sendError && <p role="alert" className="rounded border border-red-300 p-3 text-sm text-red-700">{sendError}</p>}
      <p className="text-xs text-muted-foreground">Counts include review-message preparation attempts, including historical attempts. They do not confirm delivery.</p>
      {/* Filter bar */}
      <div className="rounded-xl border border-brand-mist bg-white dark:bg-card p-3 sm:p-4">
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <div className="flex rounded-lg border border-brand-mist overflow-hidden">
            <button
              type="button"
              onClick={() => setFilterMode("days")}
              className={cn("px-3 py-1.5 text-xs font-medium transition-colors", filterMode === "days" ? "bg-brand-green text-white" : "text-brand-green-dark/70 hover:bg-brand-green/[0.06]")}
            >
              Last X Days
            </button>
            <button
              type="button"
              onClick={() => setFilterMode("range")}
              className={cn("px-3 py-1.5 text-xs font-medium transition-colors", filterMode === "range" ? "bg-brand-green text-white" : "text-brand-green-dark/70 hover:bg-brand-green/[0.06]")}
            >
              Date Range
            </button>
          </div>

          {filterMode === "days" && (
            <div className="flex items-center gap-1.5">
              {[3, 7, 14, 30].map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDaysBack(d)}
                  className={cn(
                    "rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors",
                    daysBack === d ? "bg-brand-green/10 text-brand-green ring-1 ring-brand-green/30" : "text-brand-green-dark/60 hover:bg-brand-green/[0.06]"
                  )}
                >
                  {d}d
                </button>
              ))}
            </div>
          )}

          {filterMode === "range" && (
            <DateRangePicker
              variant="compact"
              applyMode="manual"
              minNights={0}
              startDate={fromDate}
              endDate={toDate}
              onChange={({ startDate, endDate }) => {
                setFromDate(startDate);
                setToDate(endDate);
              }}
              className="w-56"
            />
          )}

          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={loadGuests}
              className="rounded-lg p-2 text-brand-green-dark/60 hover:bg-brand-green/[0.06]"
              title="Refresh"
            >
              <RefreshCwIcon className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => { setShowSettings(true); loadSettings(); }}
              className="rounded-lg p-2 text-brand-green-dark/60 hover:bg-brand-green/[0.06]"
              title="Settings"
            >
              <SettingsIcon className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Guest list */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2Icon className="h-5 w-5 animate-spin text-brand-green" />
        </div>
      ) : guests.length === 0 ? (
        <div className="rounded-xl border border-brand-mist bg-white dark:bg-card p-8 text-center">
          <p className="text-sm text-brand-green-dark/50">No checked-out guests found for this period.</p>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-brand-green-dark/50">{guests.length} guest{guests.length !== 1 ? "s" : ""} found</p>

          {/* Desktop table */}
          <div className="hidden overflow-hidden rounded-xl border border-brand-mist bg-white dark:bg-card sm:block">
            <table className="w-full text-sm">
              <thead className="border-b border-brand-mist bg-brand-sand/50">
                <tr>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-brand-green-dark/60">Guest</th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-brand-green-dark/60">Contact</th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-brand-green-dark/60">Checkout Date</th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-brand-green-dark/60">Platform</th>
                  <th className="px-4 py-2.5 text-right text-xs font-medium text-brand-green-dark/60">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-brand-mist/50">
                {guests.map((g) => {
                  const btn = getButtonStyle(g);
                  return (
                    <tr key={g.checkinId} className="hover:bg-brand-sand/30">
                      <td className="px-4 py-3 font-medium text-brand-green-dark">{g.guestName}</td>
                      <td className="px-4 py-3 text-brand-green-dark/70">{g.guestContact}</td>
                      <td className="px-4 py-3 text-brand-green-dark/70">{formatDate(g.checkedOutAt)}</td>
                      <td className="px-4 py-3 text-brand-green-dark/70">{g.bookingPlatform || "Walk-in"}</td>
                      <td className="px-4 py-3 text-right">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleSendWhatsApp(g)}
                            disabled={btn.disabled || sendingId !== null}
                            className={cn("inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors", btn.className)}
                          >
                            {sendingId === g.checkinId ? (
                              <Loader2Icon className="h-3.5 w-3.5 animate-spin" />
                            ) : btn.disabled ? (
                              <CheckCircleIcon className="h-3.5 w-3.5" />
                            ) : (
                              <SendIcon className="h-3.5 w-3.5" />
                            )}
                            {btn.label}
                          </button>
                          <button
                            type="button"
                            onClick={() => openEditModal(g)}
                            className="rounded-lg p-1.5 text-brand-green-dark/40 hover:text-brand-green-dark hover:bg-brand-green/[0.06]"
                            title="Edit"
                          >
                            <PencilIcon className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="space-y-2 sm:hidden">
            {guests.map((g) => {
              const btn = getButtonStyle(g);
              return (
                <div key={g.checkinId} className="rounded-xl border border-brand-mist bg-white dark:bg-card p-3">
                  <div className="flex items-start justify-between">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-brand-green-dark truncate">{g.guestName}</p>
                      <p className="mt-0.5 text-xs text-brand-green-dark/60">{g.guestContact}</p>
                      <p className="mt-0.5 text-xs text-brand-green-dark/50">
                        {formatDate(g.checkedOutAt)} · {g.bookingPlatform || "Walk-in"}
                      </p>
                    </div>
                    <div className="ml-2 flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => handleSendWhatsApp(g)}
                        disabled={btn.disabled || sendingId !== null}
                        className={cn("flex-shrink-0 inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition-colors", btn.className)}
                      >
                        {sendingId === g.checkinId ? (
                          <Loader2Icon className="h-3.5 w-3.5 animate-spin" />
                        ) : btn.disabled ? (
                          <CheckCircleIcon className="h-3.5 w-3.5" />
                        ) : (
                          <SendIcon className="h-3.5 w-3.5" />
                        )}
                        {btn.label}
                      </button>
                      <button
                        type="button"
                        onClick={() => openEditModal(g)}
                        className="rounded-lg p-1.5 text-brand-green-dark/40 hover:text-brand-green-dark"
                        title="Edit"
                      >
                        <PencilIcon className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {editGuest && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm overflow-y-auto">
          <div className="w-full max-w-sm rounded-2xl border border-brand-mist bg-white dark:bg-card p-5 shadow-xl dark:shadow-none">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-base font-bold text-brand-green-dark">Edit Review Status</h3>
              <button type="button" onClick={() => setEditGuest(null)} className="rounded-md p-1 text-brand-green-dark/40 hover:text-brand-green-dark">
                <XIcon className="h-5 w-5" />
              </button>
            </div>
            <p className="mt-1 text-xs text-brand-green-dark/50">{editGuest.guestName} · {editGuest.guestContact}</p>

            <div className="mt-4 space-y-3">
              <div>
                <label className="block text-xs font-medium text-brand-green-dark/70 mb-1">Rating</label>
                <select
                  value={editRating}
                  onChange={(e) => setEditRating(e.target.value)}
                  className="w-full rounded-lg border border-brand-mist px-3 py-2 text-sm"
                >
                  <option value="">Not rated</option>
                  <option value="1">1 Star</option>
                  <option value="2">2 Stars</option>
                  <option value="3">3 Stars</option>
                  <option value="4">4 Stars</option>
                  <option value="5">5 Stars</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-brand-green-dark/70 mb-1">WhatsApp Preparation Attempts</label>
                <input
                  type="number"
                  min="0"
                  value={editSentCount}
                  onChange={(e) => setEditSentCount(e.target.value)}
                  className="w-full rounded-lg border border-brand-mist px-3 py-2 text-sm"
                />
              </div>

              {editGuest.reviewRequest && (
                <button
                  type="button"
                  onClick={handleEditSave}
                  disabled={editSaving}
                  className="w-full rounded-lg bg-brand-green px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-green/90 disabled:opacity-50"
                >
                  {editSaving ? "Saving..." : "Save Changes"}
                </button>
              )}

              <div className="border-t border-brand-mist pt-3">
                <button
                  type="button"
                  onClick={handleReset}
                  disabled={resetting}
                  className="w-full inline-flex items-center justify-center gap-2 rounded-lg border-2 border-red-200 dark:border-red-800 px-4 py-2.5 text-sm font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950 disabled:opacity-50"
                >
                  <RotateCcwIcon className="h-3.5 w-3.5" />
                  {resetting ? "Resetting..." : "Reset (Start Fresh)"}
                </button>
                <p className="mt-1.5 text-[10px] text-brand-green-dark/40 text-center">Deletes all review data for this guest. They can be sent a new review request.</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Settings Modal */}
      {showSettings && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm overflow-y-auto">
          <div className="w-full max-w-md rounded-2xl border border-brand-mist bg-white dark:bg-card p-5 shadow-xl dark:shadow-none">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-lg font-bold text-brand-green-dark">Review Settings</h3>
              <button type="button" onClick={() => setShowSettings(false)} className="rounded-md p-1 text-brand-green-dark/40 hover:text-brand-green-dark">
                <XIcon className="h-5 w-5" />
              </button>
            </div>

            {settingsLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2Icon className="h-5 w-5 animate-spin text-brand-green" />
              </div>
            ) : settings && (
              <div className="mt-4 space-y-4">
                <div>
                  <label className="block text-xs font-medium text-brand-green-dark/70 mb-1">Google Review URL</label>
                  <input
                    type="url"
                    value={settings.review_google_url}
                    onChange={(e) => setSettings({ ...settings, review_google_url: e.target.value })}
                    placeholder="https://g.page/r/..."
                    className="w-full rounded-lg border border-brand-mist px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-brand-green-dark/70 mb-1">Message Template</label>
                  <textarea
                    value={settings.review_message_template}
                    onChange={(e) => setSettings({ ...settings, review_message_template: e.target.value })}
                    rows={4}
                    className="w-full rounded-lg border border-brand-mist px-3 py-2 text-sm"
                    placeholder="Use {REVIEW_URL} as placeholder for the review link"
                  />
                  <p className="mt-1 text-xs text-brand-green-dark/40">Use {"{REVIEW_URL}"} where you want the review link to appear.</p>
                </div>
                <div>
                  <label className="block text-xs font-medium text-brand-green-dark/70 mb-1">Send Delay After Checkout</label>
                  <select
                    value={settings.review_send_delay}
                    onChange={(e) => setSettings({ ...settings, review_send_delay: e.target.value })}
                    className="w-full rounded-lg border border-brand-mist px-3 py-2 text-sm"
                  >
                    <option value="immediate">Immediate</option>
                    <option value="1hour">1 hour after checkout</option>
                    <option value="24hours">24 hours after checkout</option>
                  </select>
                </div>
                <button
                  type="button"
                  onClick={saveSettings}
                  disabled={settingsSaving}
                  className="w-full rounded-lg bg-brand-green px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-green/90 disabled:opacity-50"
                >
                  {settingsSaving ? "Saving..." : "Save Settings"}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
