"use client";

import { useState, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import {
  XIcon,
  PhoneIcon,
  MailIcon,
  BedDoubleIcon,
  ClockIcon,
  CreditCardIcon,
  UserIcon,
  FileTextIcon,
  HistoryIcon,
  Loader2Icon,
  LogInIcon,
  LogOutIcon,
  BanIcon,
  EditIcon,
  BanknoteIcon,
  RefreshCwIcon,
  MessageCircleIcon,
  SendIcon,
} from "lucide-react";
import { STATUS_COLORS, platformLogo, STATUS_LABELS, formatCurrency, getHostelToday, getNights, collectionCopy, displayedStayPayment } from "./utils";
import { parseGokoWalkin, walkinDiscountOnGross } from "@/lib/bookingPricing";
import { stayDueAtHotel, stayRefundCap } from "@/lib/stayPayment";
import { CheckInPopup } from "./CheckInPopup";
import { ConfirmDialog } from "./ConfirmDialog";
import { RecordPaymentModal, PaymentDetailLabel } from "@/components/admin/RecordPaymentModal";
import { overlayVariants, modalVariants } from "@/lib/animations";
import { fetchWithRetry } from "@/components/admin/useAdminApi";
import { canLookupFoodTab, foodTabUncheckedMessage, unpaidFoodCheckoutMessage } from "@/lib/foodTab";
import { useAdminToast } from "@/components/admin/AdminToast";
import { hasPermission, type Role } from "../types";
import type { DashboardBooking, BedAssignment, BookingHistoryEntry } from "./types";
import { bookingWhatsAppNumber, bookingWhatsAppReference, fillBookingWhatsAppTemplate, type BookingWhatsAppTemplate } from "@/lib/bookingWhatsApp";
import { EditBookingModal } from "./EditBookingModal";

export function BookingDetailPanel({
  booking,
  assignments,
  onClose,
  onAction,
  role,
  permissions,
  password,
  username,
  whatsAppTemplates,
}: {
  booking: DashboardBooking;
  assignments: BedAssignment[];
  onClose: () => void;
  onAction: (action: string, bookingId: number, extra?: Record<string, unknown>) => Promise<boolean | void>;
  role: Role;
  permissions: Record<string, boolean>;
  password: string;
  username?: string;
  whatsAppTemplates: BookingWhatsAppTemplate[];
}) {
  const { showError } = useAdminToast();
  const [history, setHistory] = useState<BookingHistoryEntry[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showCheckinPopup, setShowCheckinPopup] = useState(false);
  const [showCollect, setShowCollect] = useState(false);
  const [refundOpen, setRefundOpen] = useState(false);
  const [refundRupees, setRefundRupees] = useState("0");
  const [refundPay, setRefundPay] = useState<{ amount: number } | null>(null);
  const [showWhatsAppTemplates, setShowWhatsAppTemplates] = useState(false);
  const [showEditBooking, setShowEditBooking] = useState(false);
  const [confirmAction, setConfirmAction] = useState<{
    action: string;
    title: string;
    description: string;
    variant: "default" | "destructive";
    confirmLabel?: string;
  } | null>(null);

  const statusColor = STATUS_COLORS[booking.status] ?? STATUS_COLORS.received;
  const platform = platformLogo(booking.platform);

  const loadHistory = useCallback(async () => {
    setLoadingHistory(true);
    try {
      const payload: Record<string, unknown> = { password, action: "getBookingHistory", bookingId: booking.id };
      if (username) payload.username = username;
      const res = await fetch("/api/admin/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        const data = await res.json();
        setHistory(data.history || []);
      }
    } catch {
      // silently fail for history
    } finally {
      setLoadingHistory(false);
    }
  }, [password, username, booking.id]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  const handleAction = async (action: string, extra?: Record<string, unknown>) => {
    setBusy(true);
    try {
      await onAction(action, booking.id, extra);
    } finally {
      setBusy(false);
    }
  };

  const promptCheckOut = async () => {
    if (!canLookupFoodTab({ contact: booking.contact })) {
      setConfirmAction({
        action: "checkOut",
        title: "Check Out Guest",
        description: foodTabUncheckedMessage("no-phone"),
        variant: "destructive",
        confirmLabel: "Check out anyway",
      });
      return;
    }
    setBusy(true);
    let pendingTab = 0;
    let pendingOrders = 0;
    let lookupOk = false;
    try {
      const payload: Record<string, unknown> = { password, action: "getPendingFoodTab", bookingId: booking.id };
      if (username) payload.username = username;
      const res = await fetchWithRetry("/api/admin/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }, { retries: 2, retryServerError: true });
      if (res.ok) {
        const data = await res.json();
        pendingTab = Number(data.pendingTab) || 0;
        pendingOrders = Number(data.pendingOrders) || 0;
        lookupOk = true;
      }
    } catch {
      lookupOk = false;
    } finally {
      setBusy(false);
    }
    if (!lookupOk) {
      setConfirmAction({
        action: "checkOut",
        title: "Check Out Guest",
        description: foodTabUncheckedMessage("lookup-failed"),
        variant: "destructive",
        confirmLabel: "Check out anyway",
      });
      return;
    }
    if (pendingTab > 0) {
      setConfirmAction({
        action: "checkOut",
        title: "Unpaid food bill",
        description: unpaidFoodCheckoutMessage(booking.guestName, pendingTab, pendingOrders),
        variant: "destructive",
        confirmLabel: "Check out anyway",
      });
      return;
    }
    setConfirmAction({
      action: "checkOut",
      title: "Check Out Guest",
      description: `Check out ${booking.guestName}?`,
      variant: "default",
    });
  };

  const nights = getNights(booking.checkinDate, booking.checkoutDate);
  const walkin = parseGokoWalkin(booking.rawData);
  const gross = booking.nightlyRate * nights * (walkin?.unitPricing ? 1 : Math.max(1, booking.persons));
  const discount = walkin
    ? walkinDiscountOnGross(gross, walkin)
    : (booking.source === "manual" ? Math.max(0, gross - booking.amountBeforeTax) : 0);
  const due = stayDueAtHotel(booking.paymentStatus, booking.amountTotal, booking.amountPaid);
  const collection = collectionCopy(booking.paymentStatus, due);
  const dueAtHotel = due > 0;
  // Prepaid: Paid = total / Balance = ₹0. Check-in copies amountPaid as online; status stays prepaid.
  const shownPay = displayedStayPayment(booking.paymentStatus, booking.amountTotal, booking.amountPaid);
  const whatsAppNumber = bookingWhatsAppNumber(booking.contact || "");
  const propertyName = booking.property === "sunnys_paradise" ? "Sunny's Paradise" : "Goko Hostel";
  const bookingId = bookingWhatsAppReference(booking);
  const balanceText = booking.currency && booking.currency !== "INR"
    ? `${booking.currency} ${shownPay.balance.toLocaleString("en-IN")}`
    : formatCurrency(shownPay.balance);

  const openWhatsApp = (template: BookingWhatsAppTemplate) => {
    const message = fillBookingWhatsAppTemplate(template.message, {
      "{GUEST_NAME}": booking.guestName,
      "{CHECK_IN}": booking.checkinDate,
      "{CHECK_OUT}": booking.checkoutDate || "-",
      "{BOOKING_ID}": bookingId,
      "{BALANCE}": balanceText,
      "{PROPERTY_NAME}": propertyName,
    });
    window.open(`https://wa.me/${whatsAppNumber}?text=${encodeURIComponent(message)}`, "_blank", "noopener,noreferrer");
    setShowWhatsAppTemplates(false);
  };
  const hasAssignedBed = assignments.some((a) => a.status === "assigned");
  const canCancelStay = hasAssignedBed
    ? hasPermission(role, permissions, "canDeleteBooking")
    : (role === "admin" || role === "manager");
  const canCollectStay = due > 0
    && (booking.status === "checked_in" || booking.status === "checked_out")
    && (hasPermission(role, permissions, "canAddBooking") || hasPermission(role, permissions, "canCheckIn"));
  const collectedHint = formatCurrency(booking.amountPaid || 0);
  const canEditBooking = booking.source === "manual" && hasPermission(role, permissions, "canAddBooking");

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40 bg-black/20 backdrop-blur-sm" onClick={onClose} />

      {/* Panel */}
      <motion.div
        initial={{ x: "100%" }}
        animate={{ x: 0 }}
        exit={{ x: "100%" }}
        transition={{ type: "spring", stiffness: 300, damping: 30 }}
        className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-border bg-popover shadow-xl sm:max-w-lg"
      >
        {/* Header */}
        <div className="flex items-start justify-between border-b border-border p-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h3 className="truncate text-base font-semibold text-foreground">{booking.guestName}</h3>
              <span className={cn("shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium", statusColor.bg, statusColor.text)}>
                {STATUS_LABELS[booking.status] ?? booking.status}
              </span>
            </div>
            {platform && (
              <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className={cn("inline-flex size-4 items-center justify-center rounded-full text-[8px] font-bold text-white", platform.color)}>
                  {platform.abbr}
                </span>
                {platform.label}
              </div>
            )}
          </div>
          <Button variant="ghost" size="icon-sm" onClick={onClose}>
            <XIcon className="size-4" />
          </Button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          <div className="space-y-4 p-4">
            {/* Booking Info */}
            <Section icon={FileTextIcon} title="Booking Info">
              <InfoRow label="CM Booking ID" value={booking.cmBookingId} />
              <InfoRow label="OTA Booking ID" value={booking.bookingRef} />
              <InfoRow
                label="Goko Booking ID"
                value={
                  booking.gokoBookingId
                  || (booking.source === "manual" ? `#${booking.id}` : "")
                }
              />
              <InfoRow label="Check-in" value={booking.checkinDate} />
              <InfoRow label="Check-out" value={booking.checkoutDate} />
              <InfoRow label="Nights" value={String(nights)} />
              <InfoRow label="Persons" value={String(booking.persons)} />
              <InfoRow label="Room Type" value={booking.roomType} />
              <InfoRow label="Rate Plan" value={booking.ratePlan} />
              <InfoRow label="Source" value={booking.source} />
              <InfoRow label="Booked On" value={booking.createdAt?.split("T")[0] || "-"} />
            </Section>

            {/* Assigned Beds */}
            <Section icon={BedDoubleIcon} title="Assigned Beds">
              {assignments.length === 0 ? (
                <p className="text-xs text-muted-foreground">No beds assigned</p>
              ) : (
                <div className="space-y-1">
                  {assignments.map((a) => (
                    <div
                      key={a.id}
                      className={cn(
                        "flex items-center justify-between rounded-lg border px-2.5 py-1.5 text-xs",
                        a.status === "cancelled"
                          ? "border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-900/20"
                          : "border-border bg-muted/30",
                      )}
                    >
                      <span className="font-medium">{a.dormName} - {a.bedLabel}</span>
                      <span className="text-muted-foreground">{a.status}</span>
                    </div>
                  ))}
                </div>
              )}
            </Section>

            {/* Payment */}
            <Section icon={CreditCardIcon} title="Payment">
              {collection && (
                <InfoRow
                  label={collection.label}
                  value={collection.value}
                  highlight
                  className={dueAtHotel ? "text-red-600 dark:text-red-400" : "text-green-700 dark:text-green-400"}
                />
              )}
              <InfoRow label="Subtotal" value={formatCurrency(booking.amountBeforeTax + discount)} />
              {discount > 0 && (
                <InfoRow
                  label={walkin?.discountReason ? `Discount (${walkin.discountReason})` : "Discount"}
                  value={`-${formatCurrency(discount)}`}
                />
              )}
              <InfoRow
                label={walkin?.taxPercent != null ? `Tax (${walkin.taxPercent}%)` : "Tax"}
                value={formatCurrency(booking.amountTax)}
              />
              <InfoRow label="Total" value={formatCurrency(booking.amountTotal)} highlight />
              <InfoRow label="Paid" value={formatCurrency(shownPay.paid)} />
              <InfoRow
                label="Balance"
                value={formatCurrency(shownPay.balance)}
                highlight={dueAtHotel}
                className={dueAtHotel ? "text-red-600 dark:text-red-400" : ""}
              />
              {booking.paymentMethod && (booking.amountPaid || 0) > 0 && (
                <div className="text-xs">
                  <PaymentDetailLabel
                    method={booking.paymentMethod}
                    total={booking.amountPaid || 0}
                    cashReceived={booking.cashReceived || 0}
                    changeGiven={booking.changeGiven || 0}
                    amountUnit="rupees"
                  />
                </div>
              )}
              {(booking.amountRefunded || 0) > 0 && (
                <InfoRow
                  label="Refunded"
                  value={`${formatCurrency(booking.amountRefunded || 0)}${booking.refundMethod ? ` (${booking.refundMethod})` : ""}`}
                  className="text-orange-700 dark:text-orange-400"
                />
              )}
              <InfoRow label="Nightly Rate" value={formatCurrency(booking.nightlyRate)} />
              <InfoRow label="Currency" value={booking.currency} />
            </Section>

            {/* Guest Contact */}
            <Section icon={UserIcon} title="Guest Contact">
              <div className="space-y-1.5">
                {booking.contact && (
                  <div className="flex items-center gap-2 text-xs">
                    <PhoneIcon className="size-3 text-muted-foreground" />
                    <span className="text-foreground">{booking.contact}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="ml-auto text-emerald-600 hover:bg-emerald-50 hover:text-emerald-700 dark:hover:bg-emerald-950/30"
                      onClick={() => setShowWhatsAppTemplates(true)}
                      disabled={!whatsAppNumber}
                      title={whatsAppNumber ? "Send WhatsApp message" : "A valid phone number is required"}
                    >
                      <MessageCircleIcon className="size-4" />
                      <span className="sr-only">Send WhatsApp message</span>
                    </Button>
                  </div>
                )}
                {booking.email && (
                  <div className="flex items-center gap-2 text-xs">
                    <MailIcon className="size-3 text-muted-foreground" />
                    <span className="text-foreground">{booking.email}</span>
                  </div>
                )}
              </div>
            </Section>

            {/* Special Requests */}
            {booking.specialRequests && (
              <Section icon={EditIcon} title="Special Requests">
                <p className="whitespace-pre-wrap text-xs text-foreground">{booking.specialRequests}</p>
              </Section>
            )}

            {/* Status timestamps */}
            {(booking.checkedInAt || booking.checkedOutAt || booking.cancelledAt || booking.holdExpiresAt) && (
              <Section icon={ClockIcon} title="Timestamps">
                {booking.checkedInAt && <InfoRow label="Checked in" value={`${booking.checkedInAt} by ${booking.checkedInBy}`} />}
                {booking.checkedOutAt && <InfoRow label="Checked out" value={`${booking.checkedOutAt} by ${booking.checkedOutBy}`} />}
                {booking.cancelledAt && <InfoRow label="Cancelled" value={`${booking.cancelledAt} by ${booking.cancelledBy}`} />}
                {booking.holdExpiresAt && <InfoRow label="Hold expires" value={booking.holdExpiresAt} />}
              </Section>
            )}

            {/* History */}
            <Section icon={HistoryIcon} title="History">
              {loadingHistory ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2Icon className="size-3 animate-spin" />
                  Loading...
                </div>
              ) : history.length === 0 ? (
                <p className="text-xs text-muted-foreground">No history</p>
              ) : (
                <div className="space-y-2">
                  {history.map((entry) => (
                    <div key={entry.id} className="border-l-2 border-border pl-3 text-xs">
                      <div className="font-medium text-foreground">{entry.action}</div>
                      {entry.details && <p className="text-muted-foreground">{entry.details}</p>}
                      <div className="mt-0.5 text-[10px] text-muted-foreground">
                        {entry.performedBy} - {entry.performedAt}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Section>
          </div>
        </div>

        {/* Actions */}
        <div className="border-t border-border p-4">
          <div className="flex flex-wrap gap-2">
            {canEditBooking && (
              <Button size="sm" variant="outline" onClick={() => setShowEditBooking(true)} disabled={busy}>
                <EditIcon className="size-3.5" />
                Edit Booking
              </Button>
            )}
            {booking.status === "received" && (hasPermission(role, permissions, "canAddBooking") || hasPermission(role, permissions, "canCheckIn")) && (
              <Button
                size="sm"
                onClick={() => setShowCheckinPopup(true)}
                disabled={busy}
              >
                <LogInIcon className="size-3.5" />
                Check In
              </Button>
            )}
            {booking.status === "checked_in" && (hasPermission(role, permissions, "canAddBooking") || hasPermission(role, permissions, "canCheckOut")) && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => { void promptCheckOut(); }}
                disabled={busy}
              >
                <LogOutIcon className="size-3.5" />
                Check Out
              </Button>
            )}
            {canCollectStay && (
              <Button
                size="sm"
                onClick={() => setShowCollect(true)}
                disabled={busy}
              >
                <BanknoteIcon className="size-3.5" />
                Collect
              </Button>
            )}
            {(booking.status === "received" || booking.status === "hold") &&
              canCancelStay && (
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => setConfirmAction({
                    action: "cancelBooking",
                    title: "Cancel Booking",
                    description: `Cancel booking for ${booking.guestName} in Goko? Beds will be released online; cancel the OTA reservation separately.`,
                    variant: "destructive",
                  })}
                  disabled={busy}
                >
                  <BanIcon className="size-3.5" />
                  Cancel
                </Button>
              )}
            {booking.status === "checked_in" && canCancelStay && (
              <Button
                size="sm"
                variant="destructive"
                onClick={() => { setRefundRupees("0"); setRefundOpen(true); }}
                disabled={busy}
              >
                <BanIcon className="size-3.5" />
                Cancel
              </Button>
            )}
            {booking.status === "received" && booking.checkinDate <= getHostelToday() && hasPermission(role, permissions, "canDeleteBooking") && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setConfirmAction({
                  action: "markNoShow",
                  title: "Mark No Show",
                  description: `Mark ${booking.guestName} as no-show?`,
                  variant: "default",
                })}
                disabled={busy}
              >
                No Show
              </Button>
            )}
            {booking.status === "no_show" && booking.noShowPmsStatus === "failed" && hasPermission(role, permissions, "canDeleteBooking") && (
              <Button size="sm" variant="outline" onClick={() => void handleAction("retryNoShow")} disabled={busy}>
                <RefreshCwIcon className="size-3.5" /> Retry Aiosell no-show
              </Button>
            )}
          </div>
        </div>
      </motion.div>

      {showWhatsAppTemplates && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30 p-4 backdrop-blur-sm" onClick={() => setShowWhatsAppTemplates(false)}>
          <div className="w-full max-w-sm rounded-2xl border border-border bg-popover p-5 shadow-xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-foreground">Message {booking.guestName}</h3>
                <p className="text-xs text-muted-foreground">Choose a template to open in WhatsApp.</p>
              </div>
              <Button variant="ghost" size="icon-sm" onClick={() => setShowWhatsAppTemplates(false)}><XIcon className="size-4" /><span className="sr-only">Close</span></Button>
            </div>
            <div className="mt-4 max-h-80 space-y-2 overflow-y-auto">
              {whatsAppTemplates.length === 0 ? (
                <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">No message templates are saved. An admin or manager can add them from the Bookings toolbar.</p>
              ) : whatsAppTemplates.map((template) => (
                <button key={template.id} type="button" onClick={() => openWhatsApp(template)} className="flex w-full items-center gap-3 rounded-lg border border-border p-3 text-left hover:bg-muted/50">
                  <SendIcon className="size-4 shrink-0 text-emerald-600" />
                  <span className="min-w-0 text-sm font-medium text-foreground">{template.name}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {showEditBooking && (
        <EditBookingModal
          booking={booking}
          assignments={assignments}
          password={password}
          username={username}
          onAction={onAction}
          onClose={() => setShowEditBooking(false)}
        />
      )}

      {/* Check-in popup */}
      {showCheckinPopup && (
        <CheckInPopup
          booking={booking}
          password={password}
          username={username}
          onConfirm={async (collectPayment, extra) => {
            setShowCheckinPopup(false);
            await handleAction("checkIn", { collectPayment, ...extra });
          }}
          onCancel={() => setShowCheckinPopup(false)}
        />
      )}

      {showCollect && (
        <RecordPaymentModal
          totalAmount={due}
          guestName={booking.guestName}
          amountUnit="rupees"
          zClass="z-[70]"
          password={password} username={username} receiptKind="room"
          onConfirm={async (method, cashReceived, changeGiven, onlineAccountId, receiptId) => {
            setShowCollect(false);
            await handleAction("collectStayPayment", { paymentMethod: method, cashReceived, changeGiven, onlineAccountId, receiptId });
          }}
          onClose={() => setShowCollect(false)}
        />
      )}

      {refundOpen && (
        <AnimatePresence>
          <motion.div
            key="refund-overlay"
            variants={overlayVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            className="fixed inset-0 z-[60] flex items-center justify-center overflow-y-auto bg-black/30 p-4 backdrop-blur-sm"
            onClick={() => setRefundOpen(false)}
          >
            <motion.div
              key="refund-modal"
              variants={modalVariants}
              initial="hidden"
              animate="visible"
              exit="exit"
              className="w-full min-w-0 max-w-sm rounded-2xl border border-border bg-popover p-5 shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="font-heading text-base font-medium break-words text-foreground">Cancel Stay</h3>
              <p className="mt-2 break-words text-sm text-muted-foreground">
                Cancel booking for {booking.guestName}? Beds will be freed. Collected at Goko: {collectedHint}.
              </p>
              <label className="mt-3 block text-xs font-medium text-muted-foreground">Refund amount (₹), max {collectedHint}</label>
              <input
                type="number"
                inputMode="numeric"
                min={0}
                max={stayRefundCap(booking.amountPaid)}
                className="mt-1 w-full min-w-0 rounded-lg border border-border bg-background px-3 py-2 text-sm"
                value={refundRupees}
                onChange={(e) => setRefundRupees(e.target.value)}
              />
              <div className="mt-4 flex flex-wrap justify-end gap-2">
                <Button variant="outline" size="sm" className="min-w-0" onClick={() => setRefundOpen(false)}>
                  Back
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  className="min-w-0"
                  onClick={() => {
                    const rupees = Math.max(0, Number(refundRupees) || 0);
                    const cap = stayRefundCap(booking.amountPaid);
                    const clamped = Math.min(rupees, cap);
                    const amount = Math.round(clamped);
                    setRefundOpen(false);
                    if (amount <= 0) {
                      void handleAction("cancelBooking", { refundAmount: 0 });
                      return;
                    }
                    setRefundPay({ amount });
                  }}
                >
                  Continue
                </Button>
              </div>
            </motion.div>
          </motion.div>
        </AnimatePresence>
      )}

      {refundPay && (
        <RecordPaymentModal
          totalAmount={refundPay.amount}
          guestName={booking.guestName}
          mode="refund"
          amountUnit="rupees"
          zClass="z-[70]"
          onConfirm={async (method, cashReceived) => {
            const amount = refundPay.amount;
            setRefundPay(null);
            await handleAction("cancelBooking", {
              refundAmount: amount,
              refundMethod: method,
              refundCash: method === "cash" ? amount : cashReceived,
            });
          }}
          onClose={() => setRefundPay(null)}
        />
      )}

      {/* Confirm dialog */}
      {confirmAction && (
        <ConfirmDialog
          open
          title={confirmAction.title}
          description={confirmAction.description}
          variant={confirmAction.variant}
          confirmLabel={confirmAction.confirmLabel}
          onConfirm={async () => {
            const action = confirmAction.action;
            setConfirmAction(null);
            await handleAction(action);
          }}
          onCancel={() => setConfirmAction(null)}
        />
      )}
    </>
  );
}

function Section({
  icon: Icon,
  title,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border p-3">
      <div className="mb-2 flex items-center gap-1.5">
        <Icon className="size-3.5 text-muted-foreground" />
        <h4 className="text-xs font-semibold text-foreground">{title}</h4>
      </div>
      {children}
    </div>
  );
}

function InfoRow({
  label,
  value,
  highlight,
  className,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  className?: string;
}) {
  if (!value || value === "-") {
    return (
      <div className="flex items-center justify-between py-0.5 text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="text-muted-foreground">-</span>
      </div>
    );
  }
  return (
    <div className="flex items-center justify-between py-0.5 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("font-medium text-foreground", highlight && "font-semibold", className)}>
        {value}
      </span>
    </div>
  );
}
