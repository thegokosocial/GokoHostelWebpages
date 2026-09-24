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
  RotateCcwIcon,
  MessageCircleIcon,
  SendIcon,
  Trash2Icon,
  CopyIcon,
} from "lucide-react";
import { STATUS_COLORS, platformLogo, STATUS_LABELS, formatCurrency, getHostelToday, getNights, collectionCopy, displayedStayPayment } from "./utils";
import { PlatformBadge } from "./PlatformBadge";
import { parseGokoWalkin, walkinDiscountOnGross } from "@/lib/bookingPricing";
import { parseWebsiteCheckout } from "@/lib/websiteCheckoutSnapshot";
import { isManualWalkinBooking } from "@/lib/bookingResolution";
import { stayDueAtHotel, stayRefundCap } from "@/lib/stayPayment";
import { remainingCorrectableOnEvent, resolveCorrectionConfirmAmounts, correctionPaidTransition, formatCorrectionPaidTransition } from "@/lib/otaPaymentCorrectionUi";
import { isRedundantOtaMoneyHistoryAction } from "@/lib/otaPaymentHistory";
import { CheckInPopup } from "./CheckInPopup";
import { ConfirmDialog } from "./ConfirmDialog";
import { RecordPaymentModal, PaymentDetailLabel } from "@/components/admin/RecordPaymentModal";
import { overlayVariants, modalVariants } from "@/lib/animations";
import { fetchWithRetry } from "@/components/admin/useAdminApi";
import { canLookupFoodTab, foodTabUncheckedMessage, unpaidFoodCheckoutMessage } from "@/lib/foodTab";
import { useAdminToast } from "@/components/admin/AdminToast";
import { hasPermission, type Role } from "../types";
import type { DashboardBooking, BedAssignment, BookingHistoryEntry, BookingContactMethod } from "./types";
import { bookingWhatsAppNumber, bookingWhatsAppReference, fillBookingWhatsAppTemplate, type BookingWhatsAppTemplate } from "@/lib/bookingWhatsApp";
import { EditBookingModal } from "./EditBookingModal";
import { useStaffWhatsApp } from "../StaffWhatsAppProvider";

export function BookingDetailPanel({
  booking,
  assignments,
  contactMethods,
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
  contactMethods: BookingContactMethod[];
  onClose: () => void;
  onAction: (action: string, bookingId: number, extra?: Record<string, unknown>) => Promise<boolean | void>;
  role: Role;
  permissions: Record<string, boolean>;
  password: string;
  username?: string;
  whatsAppTemplates: BookingWhatsAppTemplate[];
}) {
  const { showError, showSuccess } = useAdminToast();
  const prepareWhatsApp = useStaffWhatsApp();
  const [history, setHistory] = useState<BookingHistoryEntry[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showCheckinPopup, setShowCheckinPopup] = useState(false);
  const [showCollect, setShowCollect] = useState(false);
  const [showOtaCollect, setShowOtaCollect] = useState(false);
  const [otaCancelFlow, setOtaCancelFlow] = useState(false);
  const [otaNoShowFlow, setOtaNoShowFlow] = useState(false);
  const [otaRefundOpen, setOtaRefundOpen] = useState(false);
  const [paymentEvents, setPaymentEvents] = useState<any[]>([]);
  const [correctionTarget, setCorrectionTarget] = useState<any | null>(null);
  const [refundOpen, setRefundOpen] = useState(false);
  const [refundRupees, setRefundRupees] = useState("0");
  const [refundPay, setRefundPay] = useState<{ amount: number } | null>(null);
  const [showWhatsAppTemplates, setShowWhatsAppTemplates] = useState(false);
  const [whatsAppContact, setWhatsAppContact] = useState("");
  const [editingContacts, setEditingContacts] = useState(false);
  const [contactDraft, setContactDraft] = useState<Array<Partial<BookingContactMethod> & { value: string; label: string; type: "phone" | "email" }>>([]);
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
        setPaymentEvents(data.paymentEvents || []);
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

  // Parent refreshes booking/assignments after mutations but not history —
  // each successful action must re-fetch so edits append instead of looking overwritten.
  const runAction = async (
    action: string,
    bookingId: number,
    extra?: Record<string, unknown>,
  ) => {
    const ok = await onAction(action, bookingId, extra);
    if (ok) await loadHistory();
    return ok;
  };

  const handleAction = async (action: string, extra?: Record<string, unknown>) => {
    setBusy(true);
    try {
      return await runAction(action, booking.id, extra);
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
  const websiteCheckout = booking.source === "website" ? parseWebsiteCheckout(booking.rawData) : null;
  const orphanRefundDue = Boolean(
    websiteCheckout
    && booking.status === "cancelled"
    && (booking.amountPaid || 0) > (booking.amountRefunded || 0)
    && (websiteCheckout.orphanCapture || (websiteCheckout.paymentIds?.length ?? 0) > 0 || websiteCheckout.razorpayOrderId),
  );
  const canRefundWebsiteOrphan = orphanRefundDue && hasPermission(role, permissions, "canDeleteBooking");
  const copyId = async (label: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      showSuccess(`${label} copied`);
    } catch {
      showError(`Could not copy ${label}`);
    }
  };
  const gross = booking.nightlyRate * nights * (walkin?.unitPricing ? 1 : Math.max(1, booking.persons));
  const discount = walkin
    ? walkinDiscountOnGross(gross, walkin)
    : (booking.source === "manual" ? Math.max(0, gross - booking.amountBeforeTax) : 0);
  const due = stayDueAtHotel(booking.paymentStatus, booking.amountTotal, booking.amountPaid, booking.amountRefunded);
  const collection = collectionCopy(booking.paymentStatus, due);
  const dueAtHotel = due > 0;
  // Prepaid: Paid = total / Balance = ₹0. Check-in copies amountPaid as online; status stays prepaid.
  const shownPay = displayedStayPayment(booking.paymentStatus, booking.amountTotal, booking.amountPaid, booking.amountRefunded);
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
    prepareWhatsApp(whatsAppContact, message, "bookings", true);
    setShowWhatsAppTemplates(false);
  };
  const beginContactEdit = () => {
    setContactDraft(contactMethods.map((method) => ({ ...method, value: method.value, label: method.label || "" })));
    setEditingContacts(true);
  };
  const addContactDraft = (type: "phone" | "email") => {
    if (contactDraft.filter((row) => row.type === type).length >= 5) return;
    setContactDraft((rows) => [...rows, { type, value: "", label: "", origin: "custom" }]);
  };
  const saveContacts = async () => {
    const ok = await runAction("saveBookingContacts", booking.id, {
      contacts: contactDraft.map((row) => ({ id: row.id, type: row.type, value: row.value, label: row.label })),
    });
    if (ok) setEditingContacts(false);
  };
  const visibleContacts = contactMethods.length > 0 ? contactMethods : [
    ...(booking.contact ? [{ id: -1, bookingId: booking.id, type: "phone" as const, value: booking.contact, normalizedValue: "", label: "", origin: booking.source === "channel_manager" ? "pms" as const : "custom" as const, isPrimary: 1, position: 0 }] : []),
    ...(booking.email ? [{ id: -2, bookingId: booking.id, type: "email" as const, value: booking.email, normalizedValue: "", label: "", origin: booking.source === "channel_manager" ? "pms" as const : "custom" as const, isPrimary: 1, position: 0 }] : []),
  ];
  const canManageContacts = hasPermission(role, permissions, "canManageBookingContacts");
  const hasAssignedBed = assignments.some((a) => a.status === "assigned");
  const canCancelStay = hasAssignedBed
    ? hasPermission(role, permissions, "canDeleteBooking")
    : (role === "admin" || role === "manager");
  const canCollectStay = due > 0
    && (booking.status === "checked_in" || booking.status === "checked_out")
    && !(booking.source === "channel_manager" && booking.otaPaymentTerms === "pay_at_hotel" && booking.otaCurrency?.toUpperCase() === "INR" && hasPermission(role, permissions, "canRecordBookingPayments"))
    && (hasPermission(role, permissions, "canAddBooking") || hasPermission(role, permissions, "canCheckIn"));
  const canCollectOta = due > 0
    && booking.source === "channel_manager"
    && booking.otaPaymentTerms === "pay_at_hotel"
    && booking.otaCurrency?.toUpperCase() === "INR"
    && ["received", "hold", "checked_in", "checked_out"].includes(booking.status)
    && hasPermission(role, permissions, "canRecordBookingPayments");
  const isOtaPostpaid = booking.source === "channel_manager" && booking.otaPaymentTerms === "pay_at_hotel" && booking.otaCurrency?.toUpperCase() === "INR";
  const grossUnrefunded = Math.max(0, (booking.amountPaid || 0) - (booking.amountRefunded || 0));
  const otaRefundOverage = isOtaPostpaid ? Math.max(0, (booking.amountRefunded || 0) - (booking.amountPaid || 0)) : 0;
  const terminalPaymentState = booking.status === "cancelled" || booking.status === "no_show";
  const otaRefundMaximum = terminalPaymentState ? grossUnrefunded : Math.max(0, grossUnrefunded - (booking.amountTotal || 0));
  const otaCreditAvailable = isOtaPostpaid && !terminalPaymentState ? otaRefundMaximum : 0;
  const canRecordOtaRefund = isOtaPostpaid
    && otaRefundMaximum > 0
    && hasPermission(role, permissions, "canDeleteBooking")
    && ["received", "hold", "checked_in", "checked_out", "cancelled", "no_show"].includes(booking.status);
  const collectedHint = formatCurrency(booking.amountPaid || 0);
  const canEditBooking = (booking.source === "manual" || booking.source === "website")
    && hasPermission(role, permissions, "canAddBooking");
  const canHardDeleteRecordsWalkin = isManualWalkinBooking(booking)
    && Boolean(String(booking.bookingRef || "").trim())
    && hasPermission(role, permissions, "canDeleteBooking");
  const canHardDeleteWebsite = booking.source === "website"
    && hasPermission(role, permissions, "canDeleteBooking");
  const canHardDeleteBooking = canHardDeleteRecordsWalkin || canHardDeleteWebsite;
  const canReleaseForNoShow = booking.source === "channel_manager"
    && (booking.platform || "").toLowerCase().replace(/[._\s-]/g, "") === "bookingcom"
    && hasPermission(role, permissions, "canDeleteBooking");

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
                <PlatformBadge platform={booking.platform} size={16} />
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
              {otaCreditAvailable > 0 && <InfoRow label="Refundable credit" value={formatCurrency(otaCreditAvailable)} className="text-amber-700 dark:text-amber-400" />}
              {isOtaPostpaid && terminalPaymentState && grossUnrefunded > 0 && <InfoRow label="Goko funds held / unresolved" value={formatCurrency(grossUnrefunded)} className="text-amber-700 dark:text-amber-400" />}
              {otaRefundOverage > 0 && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">Recorded refunds exceed Goko collections by {formatCurrency(otaRefundOverage)}. Review the synced payment events and reconcile the cash/online movements before recording another refund.</p>}
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

            {websiteCheckout && (
              <Section icon={CreditCardIcon} title="Website / Razorpay">
                {websiteCheckout.orphanCapture && (
                  <p className="mb-2 rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-2 text-xs text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
                    Orphan capture — guest was told booking not confirmed. Refund via Razorpay using the Payment ID below.
                  </p>
                )}
                <InfoRow label="Payment choice" value={websiteCheckout.paymentChoice || "-"} />
                <InfoRow label="Gateway" value={websiteCheckout.gatewayEnvironment || "-"} />
                {websiteCheckout.razorpayOrderId && (
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <div className="min-w-0">
                      <span className="text-muted-foreground">Razorpay Order ID</span>
                      <p className="break-all font-mono text-foreground">{websiteCheckout.razorpayOrderId}</p>
                    </div>
                    <Button type="button" variant="ghost" size="icon-sm" onClick={() => void copyId("Order ID", websiteCheckout.razorpayOrderId!)}>
                      <CopyIcon className="size-3.5" />
                      <span className="sr-only">Copy Order ID</span>
                    </Button>
                  </div>
                )}
                {(websiteCheckout.paymentIds || []).map((pid) => (
                  <div key={pid} className="flex items-center justify-between gap-2 text-xs">
                    <div className="min-w-0">
                      <span className="text-muted-foreground">Payment ID</span>
                      <p className="break-all font-mono text-foreground">{pid}</p>
                    </div>
                    <Button type="button" variant="ghost" size="icon-sm" onClick={() => void copyId("Payment ID", pid)}>
                      <CopyIcon className="size-3.5" />
                      <span className="sr-only">Copy Payment ID</span>
                    </Button>
                  </div>
                ))}
                {websiteCheckout.dueNowPaise != null && (
                  <InfoRow label="Due online" value={formatCurrency(websiteCheckout.dueNowPaise / 100)} />
                )}
                {websiteCheckout.capturedPaise != null && websiteCheckout.capturedPaise > 0 && (
                  <InfoRow label="Captured" value={formatCurrency(websiteCheckout.capturedPaise / 100)} />
                )}
                {websiteCheckout.dueAtPropertyPaise != null && websiteCheckout.dueAtPropertyPaise > 0 && (
                  <InfoRow label="Due at property" value={formatCurrency(websiteCheckout.dueAtPropertyPaise / 100)} />
                )}
                {websiteCheckout.receipt && <InfoRow label="Receipt" value={websiteCheckout.receipt} />}
                {websiteCheckout.checkoutId && (
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <div className="min-w-0">
                      <span className="text-muted-foreground">Checkout ID</span>
                      <p className="break-all font-mono text-foreground">{websiteCheckout.checkoutId}</p>
                    </div>
                    <Button type="button" variant="ghost" size="icon-sm" onClick={() => void copyId("Checkout ID", websiteCheckout.checkoutId!)}>
                      <CopyIcon className="size-3.5" />
                      <span className="sr-only">Copy Checkout ID</span>
                    </Button>
                  </div>
                )}
                {websiteCheckout.checkoutState && <InfoRow label="Checkout state" value={websiteCheckout.checkoutState} />}
                {websiteCheckout.quoteSummary && (
                  <InfoRow
                    label="Quote"
                    value={`${websiteCheckout.quoteSummary.nights}n · ${formatCurrency(websiteCheckout.quoteSummary.total)}${websiteCheckout.quoteSummary.unitsLabel ? ` · ${websiteCheckout.quoteSummary.unitsLabel}` : ""}`}
                  />
                )}
              </Section>
            )}

            {/* Guest Contact */}
            <Section icon={UserIcon} title="Guest Contact" action={canManageContacts && !editingContacts ? (
              <Button type="button" variant="ghost" size="icon-sm" onClick={beginContactEdit} title="Edit guest contacts">
                <EditIcon className="size-4" /><span className="sr-only">Edit guest contacts</span>
              </Button>
            ) : undefined}>
              {editingContacts ? (
                <div className="space-y-2">
                  {contactDraft.map((row, index) => {
                    const locked = row.origin === "pms";
                    return (
                      <div key={row.id ?? `new-${index}`} className="grid grid-cols-[auto_1fr_auto] items-center gap-2 rounded-lg border border-border p-2">
                        {row.type === "phone" ? <PhoneIcon className="size-3 text-muted-foreground" /> : <MailIcon className="size-3 text-muted-foreground" />}
                        <div className="min-w-0 space-y-1">
                          <input className="w-full rounded border border-border bg-background px-2 py-1 text-xs" value={row.value} disabled={locked} aria-label={`${row.type} value`} onChange={(event) => setContactDraft((rows) => rows.map((item, i) => i === index ? { ...item, value: event.target.value } : item))} />
                          <input className="w-full rounded border border-border bg-background px-2 py-1 text-[11px]" value={row.label || ""} disabled={locked} placeholder="Optional label" aria-label={`${row.type} label`} onChange={(event) => setContactDraft((rows) => rows.map((item, i) => i === index ? { ...item, label: event.target.value } : item))} />
                        </div>
                        <div className="flex items-center gap-1">
                          {locked ? <span className="text-[10px] font-semibold text-muted-foreground">PMS</span> : <Button type="button" variant="ghost" size="icon-sm" title="Delete contact" onClick={() => setContactDraft((rows) => rows.filter((_, i) => i !== index))}><Trash2Icon className="size-3.5 text-red-600" /><span className="sr-only">Delete contact</span></Button>}
                        </div>
                      </div>
                    );
                  })}
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" variant="outline" size="sm" onClick={() => addContactDraft("phone")} disabled={contactDraft.filter((row) => row.type === "phone").length >= 5}>+ Phone</Button>
                    <Button type="button" variant="outline" size="sm" onClick={() => addContactDraft("email")} disabled={contactDraft.filter((row) => row.type === "email").length >= 5}>+ Email</Button>
                  </div>
                  <div className="flex justify-end gap-2 border-t border-border pt-2"><Button type="button" variant="outline" size="sm" onClick={() => setEditingContacts(false)}>Cancel</Button><Button type="button" size="sm" onClick={() => void saveContacts()}>Save</Button></div>
                </div>
              ) : (
                <div className="space-y-1.5">
                  {visibleContacts.length === 0 ? <p className="text-xs text-muted-foreground">No phone or email recorded.</p> : visibleContacts.map((method) => {
                    const whatsAppNumber = method.type === "phone" ? bookingWhatsAppNumber(method.value) : "";
                    return <div key={method.id} className="flex items-center gap-2 text-xs">
                      {method.type === "phone" ? <PhoneIcon className="size-3 text-muted-foreground" /> : <MailIcon className="size-3 text-muted-foreground" />}
                      <span className="min-w-0 text-foreground">{method.value}</span>
                      {method.origin === "pms" && <span className="text-[10px] font-semibold text-muted-foreground">PMS</span>}
                      {method.label && <span className="truncate text-[10px] text-muted-foreground">({method.label})</span>}
                      {method.type === "email" && <a className="ml-auto text-emerald-700 hover:underline" href={`mailto:${encodeURIComponent(method.value)}`} title="Email guest"><SendIcon className="size-3.5" /><span className="sr-only">Email guest</span></a>}
                      {method.type === "phone" && <Button type="button" variant="ghost" size="icon-sm" className="ml-auto text-emerald-600 hover:bg-emerald-50 hover:text-emerald-700 dark:hover:bg-emerald-950/30" onClick={() => { setWhatsAppContact(method.value); setShowWhatsAppTemplates(true); }} disabled={!whatsAppNumber} title={whatsAppNumber ? "Send WhatsApp message" : "A valid phone number is required"}><MessageCircleIcon className="size-4" /><span className="sr-only">Send WhatsApp message</span></Button>}
                    </div>;
                  })}
                </div>
              )}
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
              ) : history.length === 0 && paymentEvents.length === 0 ? (
                <p className="text-xs text-muted-foreground">No history</p>
              ) : (
                <div className="space-y-3">
                  {paymentEvents.length > 0 && <div className="space-y-2">
                    {paymentEvents.slice().reverse().map((event) => {
                      const amount = `₹${(Math.abs(event.amountPaise || 0) / 100).toFixed(2)}`;
                      const paidTransition = event.eventType === "correction"
                        ? correctionPaidTransition(
                          paymentEvents.filter((entry) => entry.bookingCycle === event.bookingCycle),
                          event.eventId,
                        )
                        : null;
                      const titleAmount = paidTransition
                        ? formatCorrectionPaidTransition(paidTransition)
                        : amount;
                      const corrections = paymentEvents.filter((entry) => entry.eventType === "correction" && entry.correctsEventId === event.eventId);
                      const remaining = remainingCorrectableOnEvent(event, corrections);
                      const correctableAmountPaise = remaining.amountPaise;
                      const canCorrectEvent = hasPermission(role, permissions, "canCorrectBookingPayments")
                        && ["collection", "refund"].includes(event.eventType)
                        && !event.isOpening && Boolean(event.businessDate) && !event.unknownPaise && event.bookingCycle === booking.bookingCycle
                        && correctableAmountPaise > 0;
                      const tender = event.unknownPaise > 0 ? "method not recorded"
                        : event.cashPaise && event.onlinePaise ? `cash ₹${Math.abs(event.cashPaise) / 100} + online ₹${Math.abs(event.onlinePaise) / 100}`
                          : event.cashPaise ? "cash" : event.onlinePaise ? "online" : "—";
                      return <div key={event.eventId} className="border-l-2 border-emerald-500 pl-3 text-xs">
                        <div className="font-medium text-foreground">{event.eventType === "refund" ? "Refund" : event.eventType === "correction" ? "Correction" : "Payment"} · {titleAmount}</div>
                        <p className="text-muted-foreground">{event.guestNameSnapshot} · {tender} · cycle {event.bookingCycle}{event.isOpening ? " · opening balance" : ""}</p>
                        {event.note && <p className="text-muted-foreground">{event.note}</p>}
                        <div className="mt-0.5 text-[10px] text-muted-foreground">{event.businessDate || "Date unknown"} · {event.actor}</div>
                        {canCorrectEvent && (
                          <div className="mt-1 flex flex-wrap items-center gap-2">
                            {corrections.length > 0 && (
                              <span className="text-[10px] text-muted-foreground">
                                ₹{(correctableAmountPaise / 100).toFixed(2)} still reversible
                              </span>
                            )}
                            <Button
                              className="h-7 px-2 text-[10px]"
                              size="sm"
                              variant="outline"
                              onClick={() => setCorrectionTarget({
                                event,
                                maxPaise: remaining.amountPaise,
                                remainingCashPaise: remaining.cashPaise,
                                remainingOnlinePaise: remaining.onlinePaise,
                              })}
                            >
                              Revert mistaken payment
                            </Button>
                          </div>
                        )}
                      </div>;
                    })}
                  </div>}
                  {history.filter((entry) => !isRedundantOtaMoneyHistoryAction(entry.action)).map((entry) => (
                    <div key={entry.id} className="border-l-2 border-border pl-3 text-xs">
                      <div className="font-medium text-foreground">{entry.action}</div>
                      {entry.details && <p className="text-muted-foreground">{entry.details}</p>}
                      <div className="mt-0.5 text-[10px] text-muted-foreground">{entry.performedBy} - {entry.performedAt}</div>
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
            {canCollectOta && (
              <Button size="sm" onClick={() => setShowOtaCollect(true)} disabled={busy}>
                <CreditCardIcon className="size-3.5" />
                Collect payment
              </Button>
            )}
            {(booking.status === "received" || booking.status === "hold") &&
              canCancelStay && (
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => {
                    if (isOtaPostpaid && grossUnrefunded > 0) setOtaCancelFlow(true);
                    else setConfirmAction({
                      action: "cancelBooking",
                      title: "Cancel Booking",
                      description: `Cancel booking for ${booking.guestName} in Goko? Beds will be released online; cancel the OTA reservation separately.`,
                      variant: "destructive",
                    });
                  }}
                  disabled={busy}
                >
                  <BanIcon className="size-3.5" />
                  Cancel
                </Button>
              )}
            {(booking.status === "received" || booking.status === "hold") && canReleaseForNoShow && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setConfirmAction({
                  action: "releaseForNoShow",
                  title: "Guest Declined Stay",
                  description: `Release the bed for ${booking.guestName} while keeping the Booking.com reservation active? You can mark it no-show after the check-in date passes.`,
                  variant: "default",
                  confirmLabel: "Release bed",
                })}
                disabled={busy}
              >
                Release for No-show
              </Button>
            )}
            {booking.status === "checked_in" && canCancelStay && (
              <Button
                size="sm"
                variant="destructive"
                onClick={() => {
                  if (isOtaPostpaid && grossUnrefunded > 0) setOtaCancelFlow(true);
                  else { setRefundRupees("0"); setRefundOpen(true); }
                }}
                disabled={busy}
              >
                <BanIcon className="size-3.5" />
                Cancel
              </Button>
            )}
            {(["received", "hold", "guest_declined"].includes(booking.status))
              && (booking.status === "guest_declined" ? booking.checkinDate < getHostelToday() : booking.checkinDate <= getHostelToday())
              && hasPermission(role, permissions, "canDeleteBooking") && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  if (isOtaPostpaid && grossUnrefunded > 0) setOtaNoShowFlow(true);
                  else setConfirmAction({
                    action: "markNoShow",
                    title: "Mark No Show",
                    description: `Mark ${booking.guestName} as no-show?`,
                    variant: "default",
                  });
                }}
                disabled={busy}
              >
                No Show
              </Button>
            )}
            {canRecordOtaRefund && (
              <Button size="sm" variant="outline" onClick={() => setOtaRefundOpen(true)} disabled={busy}>
                <RotateCcwIcon className="size-3.5" />
                {terminalPaymentState ? "Record refund" : "Refund credit"}
              </Button>
            )}
            {canRefundWebsiteOrphan && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setConfirmAction({
                  action: "refundWebsiteOrphan",
                  title: "Refund Razorpay orphan",
                  description: `Refund ${formatCurrency((booking.amountPaid || 0) - (booking.amountRefunded || 0))} captured on this cancelled website booking via Razorpay? Use the Payment ID in Website / Razorpay to cross-check the dashboard.`,
                  variant: "destructive",
                  confirmLabel: "Refund via Razorpay",
                })}
                disabled={busy}
              >
                <BanknoteIcon className="size-3.5" />
                Refund orphan capture
              </Button>
            )}
            {canHardDeleteBooking && (
              <Button
                size="sm"
                variant="destructive"
                onClick={() => setConfirmAction({
                  action: "hardDeleteRecordsWalkinBooking",
                  title: canHardDeleteWebsite ? "Delete website booking" : "Delete walk-in booking",
                  description: canHardDeleteWebsite
                    ? `Permanently delete ${booking.guestName}'s Goko Website booking and release beds?`
                    : `Permanently delete ${booking.guestName}'s Records walk-in booking and its room receipts? The check-in record is kept.`,
                  variant: "destructive",
                  confirmLabel: "Delete permanently",
                })}
                disabled={busy}
              >
                <Trash2Icon className="size-3.5" />
                Delete booking
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
                <p className="text-xs text-muted-foreground">Choose a template. Android opens WhatsApp Business; other devices show message options.</p>
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
          onAction={runAction}
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
            const ok = await handleAction("checkIn", { collectPayment, ...extra });
            if (ok) setShowCheckinPopup(false);
            return ok;
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
          onConfirm={async (method, cashReceived, changeGiven, onlineAccountId, receiptId, _amount, operationId) => {
            const ok = await handleAction("collectStayPayment", { paymentMethod: method, cashReceived, changeGiven, onlineAccountId, receiptId, operationId });
            if (ok) setShowCollect(false);
            return ok;
          }}
          onClose={() => setShowCollect(false)}
        />
      )}

      {showOtaCollect && (
        <RecordPaymentModal
          totalAmount={due}
          guestName={booking.guestName}
          amountUnit="rupees"
          allowPartial
          zClass="z-[70]"
          password={password}
          username={username}
          receiptKind="room"
          onConfirm={async (method, cashReceived, changeGiven, onlineAccountId, _receiptId, amountToApply, operationId, note) => {
            const amountPaise = Math.round((amountToApply ?? due) * 100);
            const cashPaise = method === "cash" ? amountPaise : method === "split" ? Math.round(cashReceived * 100) : 0;
            const ok = await handleAction("collectOtaBookingPayment", {
              operationId,
              amountPaise,
              cashPaise,
              onlinePaise: amountPaise - cashPaise,
              cashTenderPaise: method === "cash" ? Math.round(cashReceived * 100) : cashPaise,
              changePaise: method === "cash" ? Math.round(changeGiven * 100) : 0,
              onlineAccountId,
              note,
            });
            if (ok) setShowOtaCollect(false);
            return ok;
          }}
          onClose={() => setShowOtaCollect(false)}
        />
      )}

      {(otaCancelFlow || otaNoShowFlow || otaRefundOpen) && (
        <RecordPaymentModal
          totalAmount={otaCancelFlow || otaNoShowFlow ? grossUnrefunded : otaRefundMaximum}
          guestName={booking.guestName}
          mode="refund"
          amountUnit="rupees"
          allowPartial
          zClass="z-[70]"
          password={password}
          username={username}
          receiptKind="room"
          secondaryActionLabel={otaCancelFlow ? "Cancel without refund" : otaNoShowFlow ? "Mark no-show without refund" : undefined}
          onSecondaryAction={otaCancelFlow || otaNoShowFlow ? async () => {
            const action = otaCancelFlow ? "cancelBooking" : "markNoShow";
            const ok = await handleAction(action);
            if (ok) { setOtaCancelFlow(false); setOtaNoShowFlow(false); }
            return ok;
          } : undefined}
          onConfirm={async (method, cashReceived, _change, onlineAccountId, _receiptId, amountToApply, operationId, note) => {
            const amountPaise = Math.round((amountToApply || 0) * 100);
            const cashPart = method === "cash" ? amountPaise : method === "split" ? Math.round(cashReceived * 100) : 0;
            const common = {
              operationId,
              refundAmountPaise: amountPaise,
              amountPaise,
              cashPaise: cashPart,
              onlinePaise: amountPaise - cashPart,
              cashTenderPaise: cashPart,
              changePaise: 0,
              onlineAccountId,
              note,
            };
            const action = otaCancelFlow ? "cancelBooking" : otaNoShowFlow ? "markNoShow" : "refundOtaBookingPayment";
            const ok = await handleAction(action, common);
            if (ok) { setOtaCancelFlow(false); setOtaNoShowFlow(false); setOtaRefundOpen(false); }
            return ok;
          }}
          onClose={() => { setOtaCancelFlow(false); setOtaNoShowFlow(false); setOtaRefundOpen(false); }}
        />
      )}

      {correctionTarget && (
        <RecordPaymentModal
          totalAmount={correctionTarget.maxPaise / 100}
          guestName={booking.guestName}
          mode="correction"
          initialMethod={correctionTarget.event.cashPaise && correctionTarget.event.onlinePaise ? "split" : correctionTarget.event.onlinePaise ? "online" : "cash"}
          amountUnit="rupees"
          allowPartial
          zClass="z-[75]"
          password={password}
          username={username}
          receiptKind="room"
          onConfirm={async (method, cashReceived, _change, onlineAccountId, _receiptId, amountToApply, operationId, note) => {
            const { amountPaise, cashPaise, onlinePaise } = resolveCorrectionConfirmAmounts({
              amountToApplyRupees: amountToApply || 0,
              maxPaise: correctionTarget.maxPaise,
              remainingCashPaise: correctionTarget.remainingCashPaise,
              remainingOnlinePaise: correctionTarget.remainingOnlinePaise,
              method,
              cashReceivedRupees: cashReceived,
            });
            const ok = await handleAction("correctOtaBookingPayment", {
              operationId,
              correctsEventId: correctionTarget.event.eventId,
              amountPaise,
              cashPaise,
              onlinePaise,
              onlineAccountId,
              note,
            });
            if (ok) setCorrectionTarget(null);
            return ok;
          }}
          onClose={() => setCorrectionTarget(null)}
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
            const ok = await handleAction(action);
            if (ok && action === "hardDeleteRecordsWalkinBooking") onClose();
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
  action,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border p-3">
      <div className="mb-2 flex items-center gap-1.5">
        <Icon className="size-3.5 text-muted-foreground" />
        <h4 className="text-xs font-semibold text-foreground">{title}</h4>
        {action && <div className="ml-auto">{action}</div>}
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
