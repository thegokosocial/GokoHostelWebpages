"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { PlusIcon, TableIcon, CalendarIcon, ListIcon, AlertCircleIcon, RefreshCwIcon, Loader2Icon, ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { BookingCalendarGrid } from "./BookingCalendarGrid";
import { BookingTableView } from "./BookingTableView";
import { BookingSearchBar } from "./BookingSearchBar";
import { BookingDetailPanel } from "./BookingDetailPanel";
import { CreateBookingModal } from "./CreateBookingModal";
import { UnassignedBookings } from "./UnassignedBookings";
import { DateRangeSelector } from "./DateRangeSelector";
import { getDateRange, getHostelToday, rangeCoveringStay, STATUS_LABELS } from "./utils";
import { useAdminToast } from "@/components/admin/AdminToast";
import { AdminLoading } from "../AdminLoading";
import type { DashboardBooking, BedAssignment, BookingStatus, DateRange, CalendarDorm } from "./types";
import type { Role } from "../types";
import { hasPermission } from "../types";
import { fetchWithRetry } from "@/components/admin/useAdminApi";
import { WhatsAppTemplateManager, MessageTemplatesIcon } from "./WhatsAppTemplateManager";
import type { BookingWhatsAppTemplate } from "@/lib/bookingWhatsApp";

function useBookingApi(password: string, username?: string) {
  const apiCall = useCallback(
    async (body: Record<string, unknown>) => {
      const payload: Record<string, unknown> = { password, ...body };
      if (username) payload.username = username;
      return fetchWithRetry("/api/admin/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }, {
        retries: 2,
        retryServerError: body.action !== "createBooking",
      });
    },
    [password, username],
  );
  return { apiCall };
}

function apiErrorDetails(response: Response, data: Record<string, any>, action: string): string {
  return JSON.stringify({
    status: response.status,
    action,
    requestId: response.headers.get("x-goko-request-id") || data.debug?.requestId,
    ...data.debug,
  }, null, 2);
}

const ALL_BOOKINGS_PAGE_SIZE = 50;
const ALL_BOOKING_STATUSES: Array<BookingStatus | "all"> = [
  "all", "received", "checked_in", "checked_out", "hold", "no_show", "cancelled", "modified",
];


export function BookingDashboard({
  password,
  username,
  role,
  permissions = {},
  initialBookingId,
  onInitialBookingConsumed,
}: {
  password: string;
  username?: string;
  role: Role;
  permissions?: Record<string, boolean>;
  initialBookingId?: number | null;
  onInitialBookingConsumed?: () => void;
}) {
  const { apiCall } = useBookingApi(password, username);
  const { showError, showSuccess, showInfo } = useAdminToast();

  const [view, setView] = useState<"calendar" | "table" | "all">("calendar");
  const [dateRange, setDateRange] = useState<DateRange>(() => {
    const { start, end } = getDateRange("10days");
    return { startDate: start, endDate: end, mode: "10days" };
  });
  const [bookings, setBookings] = useState<DashboardBooking[]>([]);
  const [allBookings, setAllBookings] = useState<DashboardBooking[]>([]);
  const [allBookingsTotal, setAllBookingsTotal] = useState(0);
  const [allBookingStatusCounts, setAllBookingStatusCounts] = useState<Record<string, number>>({});
  const [allBookingStatus, setAllBookingStatus] = useState<BookingStatus | "all">("all");
  const [allBookingsPage, setAllBookingsPage] = useState(0);
  const [allBookingsLoading, setAllBookingsLoading] = useState(false);
  const [assignments, setAssignments] = useState<BedAssignment[]>([]);
  const [dorms, setDorms] = useState<CalendarDorm[]>([]);
  const [unassignedBookings, setUnassignedBookings] = useState<DashboardBooking[]>([]);
  const [selectedBookingId, setSelectedBookingId] = useState<number | null>(null);
  const [externalDetail, setExternalDetail] = useState<{ booking: DashboardBooking; assignments: BedAssignment[] } | null>(null);
  const openingInitialBookingId = useRef<number | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showUnassigned, setShowUnassigned] = useState(false);
  const [showTemplateManager, setShowTemplateManager] = useState(false);
  const [whatsAppTemplates, setWhatsAppTemplates] = useState<BookingWhatsAppTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const selectedBooking = useMemo(
    () => bookings.find((b) => b.id === selectedBookingId)
      ?? allBookings.find((b) => b.id === selectedBookingId)
      ?? (externalDetail?.booking.id === selectedBookingId ? externalDetail.booking : null),
    [allBookings, bookings, externalDetail, selectedBookingId],
  );

  const openBooking = useCallback(async (bookingId: number) => {
    const visible = bookings.find((booking) => booking.id === bookingId)
      ?? allBookings.find((booking) => booking.id === bookingId);
    if (visible) {
      setExternalDetail(null);
      setSelectedBookingId(bookingId);
      return;
    }
    try {
      const res = await apiCall({ action: "getDetail", bookingId });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: "Booking not found" }));
        showError(data.error || "Booking not found");
        return;
      }
      const detail = await res.json();
      setExternalDetail({ booking: detail.booking, assignments: detail.assignments || [] });
      setSelectedBookingId(bookingId);
    } catch {
      showError("Network error loading booking details");
    }
  }, [allBookings, apiCall, bookings, showError]);

  useEffect(() => {
    if (!initialBookingId || openingInitialBookingId.current === initialBookingId) return;
    openingInitialBookingId.current = initialBookingId;
    void openBooking(initialBookingId).finally(() => onInitialBookingConsumed?.());
  }, [initialBookingId, onInitialBookingConsumed, openBooking]);

  const loadData = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true); else setLoading(true);
    setDorms((current) => current.map((dorm) => ({
      ...dorm, availability: undefined,
      beds: dorm.beds.map((bed) => ({ ...bed, availability: undefined })),
    })));
    try {
      const [calSettled, unSettled] = await Promise.allSettled([
        apiCall({
          action: "getCalendarData",
          startDate: dateRange.startDate,
          endDate: dateRange.endDate,
        }),
        apiCall({ action: "getUnassigned" }),
      ]);
      if (calSettled.status === "fulfilled") {
        const calRes = calSettled.value;
        if (calRes.ok) {
          const data = await calRes.json();
          setBookings(data.bookings || []);
          setAssignments(data.assignments || []);
          setDorms(
            (data.dorms || []).map((d: CalendarDorm) => ({
              ...d,
              collapsed: dorms.find((existing) => existing.id === d.id)?.collapsed ?? false,
            })),
          );
        } else {
          const data = await calRes.json().catch(() => ({ error: "Failed to load data" }));
          showError(data.error || "Failed to load booking data", apiErrorDetails(calRes, data, "getCalendarData"));
        }
      } else {
        showError("Network error loading booking data");
      }
      if (unSettled.status === "fulfilled") {
        const unRes = unSettled.value;
        if (unRes.ok) {
          const data = await unRes.json();
          setUnassignedBookings(data.bookings || []);
        } else {
          const data = await unRes.json().catch(() => ({ error: "Failed to load unassigned bookings" }));
          showError(data.error || "Failed to load unassigned bookings", apiErrorDetails(unRes, data, "getUnassigned"));
        }
      }
    } catch {
      showError("Network error loading booking data");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [apiCall, dateRange.startDate, dateRange.endDate, showError, dorms]);

  const loadAllBookings = useCallback(async () => {
    setAllBookingsLoading(true);
    try {
      const res = await apiCall({
        action: "getAllBookings",
        startDate: dateRange.startDate,
        endDate: dateRange.endDate,
        page: allBookingsPage,
        pageSize: ALL_BOOKINGS_PAGE_SIZE,
        status: allBookingStatus,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: "Failed to load all bookings" }));
        showError(data.error || "Failed to load all bookings", apiErrorDetails(res, data, "getAllBookings"));
        return;
      }
      const data = await res.json();
      setAllBookings(data.bookings || []);
      setAllBookingsTotal(Number(data.total || 0));
      setAllBookingStatusCounts(data.statusCounts || {});
    } catch {
      showError("Network error loading all bookings");
    } finally {
      setAllBookingsLoading(false);
    }
  }, [allBookingStatus, allBookingsPage, apiCall, dateRange.endDate, dateRange.startDate, showError]);

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateRange.startDate, dateRange.endDate]);

  useEffect(() => {
    if (view === "all") void loadAllBookings();
  }, [loadAllBookings, view]);

  useEffect(() => {
    void apiCall({ action: "getWhatsAppTemplates" }).then(async (res) => {
      if (res.ok) setWhatsAppTemplates((await res.json()).templates || []);
    }).catch(() => {});
  }, [apiCall]);

  const handleDateRangeChange = useCallback((newRange: DateRange) => {
    setAllBookingsPage(0);
    setDateRange(newRange);
  }, []);

  const handleToggleDorm = useCallback((dormId: number) => {
    setDorms((prev) => prev.map((d) => (d.id === dormId ? { ...d, collapsed: !d.collapsed } : d)));
  }, []);

  const handleBookingAction = useCallback(
    async (action: string, bookingId: number, extra?: Record<string, unknown>, reload = true) => {
      try {
        const res = await apiCall({ action, bookingId, ...extra });
        if (res.ok) {
          const data = await res.json().catch(() => ({}));
          showSuccess(data.message || "Action completed");
          if (data.warning) showInfo(data.warning);
          if (reload) {
            await loadData(true);
            if (view === "all") await loadAllBookings();
          }
          if (externalDetail?.booking.id === bookingId) {
            const detailRes = await apiCall({ action: "getDetail", bookingId });
            if (detailRes.ok) {
              const detail = await detailRes.json();
              setExternalDetail({ booking: detail.booking, assignments: detail.assignments || [] });
            }
          }
          return true;
        }
        const data = await res.json().catch(() => ({ error: "Action failed" }));
        showError(data.error || "Action failed");
        if (reload) {
          await loadData(true);
          if (view === "all") await loadAllBookings();
        }
        return false;
      } catch {
        showError("Network error");
        return false;
      }
    },
    [apiCall, externalDetail, loadAllBookings, loadData, showError, showInfo, showSuccess, view],
  );

  if (loading) {
    return (
      <div className="flex h-full min-h-0 flex-1 items-center justify-center">
        <AdminLoading message="Loading booking calendar..." />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col gap-4">
      {/* Toolbar */}
      <div className="flex shrink-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="font-display text-xl font-bold text-brand-green md:text-2xl">
          {view === "all" ? "All Bookings" : "Booking Calendar"}
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <BookingSearchBar
            bookings={bookings}
            onSelect={openBooking}
          />
          {(role === "admin" || role === "manager" || hasPermission(role, permissions, "canManageBookingTemplates")) && (
            <Button variant="outline" size="sm" onClick={() => setShowTemplateManager(true)}>
              <MessageTemplatesIcon />
              <span className="hidden sm:inline">Message Templates</span>
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => loadData(true)}
            disabled={refreshing}
          >
            {refreshing ? <Loader2Icon className="size-3.5 animate-spin" /> : <RefreshCwIcon className="size-3.5" />}
            <span className="hidden sm:inline">Refresh</span>
          </Button>
        </div>
      </div>

      {/* Controls row */}
      <div className="flex shrink-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <DateRangeSelector dateRange={dateRange} onChange={handleDateRangeChange} />
        <div className="flex items-center gap-2">
          {unassignedBookings.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowUnassigned(!showUnassigned)}
              className="relative"
            >
              <AlertCircleIcon className="size-3.5" />
              Unassigned
              <span className="ml-1 inline-flex size-5 items-center justify-center rounded-full bg-orange-500 text-[10px] font-bold text-white">
                {unassignedBookings.length}
              </span>
            </Button>
          )}
          <div className="flex rounded-lg border border-input">
            <button
              type="button"
              onClick={() => setView("calendar")}
              className={cn(
                "flex items-center gap-1 rounded-l-lg px-3 py-1.5 text-xs font-medium transition-colors",
                view === "calendar"
                  ? "bg-brand-green text-white"
                  : "bg-background text-muted-foreground hover:bg-muted",
              )}
            >
              <CalendarIcon className="size-3.5" />
              <span className="hidden sm:inline">Calendar</span>
            </button>
            <button
              type="button"
              onClick={() => setView("table")}
              className={cn(
                "flex items-center gap-1 border-l border-input px-3 py-1.5 text-xs font-medium transition-colors",
                view === "table"
                  ? "bg-brand-green text-white"
                  : "bg-background text-muted-foreground hover:bg-muted",
              )}
            >
              <TableIcon className="size-3.5" />
              <span className="hidden sm:inline">Table</span>
            </button>
            <button
              type="button"
              onClick={() => setView("all")}
              className={cn(
                "flex items-center gap-1 rounded-r-lg border-l border-input px-3 py-1.5 text-xs font-medium transition-colors",
                view === "all"
                  ? "bg-brand-green text-white"
                  : "bg-background text-muted-foreground hover:bg-muted",
              )}
              aria-label="All bookings"
            >
              <ListIcon className="size-3.5" />
              <span className="hidden sm:inline">All Bookings</span>
              <span className="sm:hidden">All</span>
            </button>
          </div>
          {hasPermission(role, permissions, "canAddBooking") && (
            <Button size="sm" onClick={() => setShowCreateModal(true)}>
              <PlusIcon className="size-3.5" />
              <span className="hidden sm:inline">New Booking</span>
            </Button>
          )}
        </div>
      </div>

      {/* Unassigned panel */}
      {showUnassigned && (
        <div className="shrink-0">
          <UnassignedBookings
            bookings={unassignedBookings}
            dorms={dorms}
            dateRange={dateRange}
            onAssign={async (bookingId, bedIds) => {
              const booking = unassignedBookings.find((b) => b.id === bookingId);
              const assignedDormIds = new Set<number>();
              for (const d of dorms) {
                for (const bed of d.beds) {
                  if (bedIds.includes(bed.id)) assignedDormIds.add(d.id);
                }
              }
              const next = booking?.checkinDate
                ? rangeCoveringStay(booking.checkinDate, booking.checkoutDate, dateRange)
                : dateRange;
              const jumping = next.startDate !== dateRange.startDate || next.endDate !== dateRange.endDate;
              const ok = await handleBookingAction("assignBeds", bookingId, { bedIds }, !jumping);
              if (!ok) return false;
              setShowUnassigned(false);
              setView("calendar");
              if (assignedDormIds.size > 0) {
                setDorms((prev) => prev.map((d) => ({ ...d, collapsed: !assignedDormIds.has(d.id) })));
              }
              if (jumping) setDateRange(next);
              return true;
            }}
            onClose={() => setShowUnassigned(false)}
            password={password}
            username={username}
            canAssign={hasPermission(role, permissions, "canAddBooking")}
            canReject={role === "admin" || role === "manager"}
            onReject={async (bookingId) => handleBookingAction("cancelBooking", bookingId)}
          />
        </div>
      )}

      {/* Main content */}
      {view === "calendar" ? (
        <BookingCalendarGrid
          bookings={bookings}
          assignments={assignments}
          dorms={dorms}
          dateRange={dateRange}
          today={getHostelToday()}
          onSelectBooking={openBooking}
          selectedBookingId={selectedBookingId}
          onToggleDorm={handleToggleDorm}
        />
      ) : view === "table" ? (
        <div className="min-h-0 flex-1 overflow-auto">
          <BookingTableView
            bookings={bookings}
            assignments={assignments}
            onSelectBooking={openBooking}
            selectedBookingId={selectedBookingId}
          />
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          <div className="mb-3 flex flex-col gap-2 rounded-xl border border-border bg-white p-3 dark:bg-card sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-semibold text-foreground">All booking statuses</p>
              <p className="text-xs text-muted-foreground">
                Showing bookings that overlap {dateRange.startDate} to {dateRange.endDate}.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <label htmlFor="all-booking-status" className="text-xs text-muted-foreground">Status</label>
              <select
                id="all-booking-status"
                value={allBookingStatus}
                onChange={(event) => {
                  setAllBookingsPage(0);
                  setAllBookingStatus(event.target.value as BookingStatus | "all");
                }}
                className="h-8 rounded-lg border border-input bg-background px-2 text-xs text-foreground"
              >
                {ALL_BOOKING_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {status === "all" ? `All (${Object.values(allBookingStatusCounts).reduce((sum, count) => sum + count, 0)})` : `${STATUS_LABELS[status]} (${allBookingStatusCounts[status] || 0})`}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {allBookingsLoading ? (
            <div className="flex min-h-48 items-center justify-center rounded-xl border border-border bg-white dark:bg-card">
              <Loader2Icon className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <BookingTableView
              bookings={allBookings}
              assignments={assignments}
              onSelectBooking={openBooking}
              selectedBookingId={selectedBookingId}
            />
          )}

          <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
            <span>
              {allBookingsTotal === 0 ? "No bookings" : `${allBookingsPage * ALL_BOOKINGS_PAGE_SIZE + 1}-${Math.min((allBookingsPage + 1) * ALL_BOOKINGS_PAGE_SIZE, allBookingsTotal)} of ${allBookingsTotal}`}
            </span>
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="xs"
                disabled={allBookingsLoading || allBookingsPage === 0}
                onClick={() => setAllBookingsPage((page) => Math.max(0, page - 1))}
                aria-label="Previous bookings page"
              >
                <ChevronLeftIcon className="size-3.5" />
              </Button>
              <Button
                variant="outline"
                size="xs"
                disabled={allBookingsLoading || (allBookingsPage + 1) * ALL_BOOKINGS_PAGE_SIZE >= allBookingsTotal}
                onClick={() => setAllBookingsPage((page) => page + 1)}
                aria-label="Next bookings page"
              >
                <ChevronRightIcon className="size-3.5" />
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Detail panel */}
      {selectedBooking && (
        <BookingDetailPanel
          booking={selectedBooking}
          assignments={externalDetail?.booking.id === selectedBooking.id ? externalDetail.assignments : assignments.filter((a) => a.bookingId === selectedBooking.id)}
          onClose={() => { setSelectedBookingId(null); setExternalDetail(null); }}
          onAction={handleBookingAction}
          role={role}
          permissions={permissions}
          password={password}
          username={username}
          whatsAppTemplates={whatsAppTemplates}
        />
      )}

      {showTemplateManager && (
        <WhatsAppTemplateManager
          apiCall={apiCall}
          onClose={() => setShowTemplateManager(false)}
          onSaved={setWhatsAppTemplates}
        />
      )}

      {/* Create modal */}
      {showCreateModal && (
        <CreateBookingModal
          dorms={dorms}
          dateRange={dateRange}
          onClose={() => setShowCreateModal(false)}
          onCreated={async () => {
            setShowCreateModal(false);
            await loadData(true);
          }}
          password={password}
          username={username}
        />
      )}
    </div>
  );
}
