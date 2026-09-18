"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { XIcon, Loader2Icon } from "lucide-react";
import type { DashboardBooking, BedAssignment } from "./types";
import { addCalendarDays } from "@/lib/inventoryAvailability";
import { getNights, formatCurrency } from "./utils";
import { RecordPaymentModal } from "@/components/admin/RecordPaymentModal";
import { DateRangePicker } from "@/components/dates/DateRangePicker";
import { bookingTotals, parseGokoWalkin, walkinDiscountOnGross } from "@/lib/bookingPricing";

type Unit = { key: string; label: string; dormId: number; dormName: string; type: string; capacity: number; bedIds: number[]; pool: string };

export function EditBookingModal({ booking, assignments, password, username, onAction, onClose }: {
  booking: DashboardBooking;
  assignments: BedAssignment[];
  password: string;
  username?: string;
  onAction: (action: string, bookingId: number, extra?: Record<string, unknown>) => Promise<boolean | void>;
  onClose: () => void;
}) {
  const [guestName, setGuestName] = useState(booking.guestName);
  const [contact, setContact] = useState(booking.contact || "");
  const [email, setEmail] = useState(booking.email || "");
  const [checkinDate, setCheckinDate] = useState(booking.checkinDate);
  const [checkoutDate, setCheckoutDate] = useState(booking.checkoutDate || addCalendarDays(booking.checkinDate, 1));
  const [persons, setPersons] = useState(String(booking.persons || 1));
  const [nightlyRate, setNightlyRate] = useState(String(booking.nightlyRate || 0));
  const [amountPaid, setAmountPaid] = useState(String(booking.amountPaid || 0));
  const [lowerPaymentMode, setLowerPaymentMode] = useState<"correction" | "refund">("correction");
  const [specialRequests, setSpecialRequests] = useState(booking.specialRequests || "");
  const [availableUnits, setAvailableUnits] = useState<Unit[]>([]);
  const [addUnitKeys, setAddUnitKeys] = useState<string[]>([]);
  const [removeBedIds, setRemoveBedIds] = useState<number[]>([]);
  const [droppedAddCount, setDroppedAddCount] = useState(0);
  const [loadingUnits, setLoadingUnits] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [paymentAdjustment, setPaymentAdjustment] = useState<{ mode: "collect" | "refund"; amount: number } | null>(null);

  const canEditPaid = booking.source === "manual";
  const validDates = Boolean(checkinDate && checkoutDate && checkoutDate > checkinDate);
  const parsedAmountPaid = amountPaid === "" ? NaN : Number(amountPaid);
  const validAmountPaid = !canEditPaid || (Number.isInteger(parsedAmountPaid) && parsedAmountPaid >= 0);
  const validForm = Boolean(guestName.trim() && validDates && Number.isInteger(Number(persons)) && Number(persons) > 0 && Number.isInteger(Number(nightlyRate)) && Number(nightlyRate) >= 0 && validAmountPaid);
  const paymentChanged = canEditPaid && validAmountPaid && parsedAmountPaid !== Number(booking.amountPaid || 0);
  const selectedAddUnits = useMemo(() => availableUnits.filter((unit) => addUnitKeys.includes(unit.key)), [availableUnits, addUnitKeys]);
  const closed = ["checked_out", "cancelled", "no_show"].includes(booking.status);

  const keptAssignments = useMemo(
    () => assignments.filter((a) => a.status === "assigned" && !removeBedIds.includes(a.bedId)),
    [assignments, removeBedIds],
  );
  const finalCapacity = keptAssignments.length + selectedAddUnits.reduce((sum, unit) => sum + unit.capacity, 0);
  const finalBedCount = keptAssignments.length + selectedAddUnits.reduce((sum, unit) => sum + unit.bedIds.length, 0);
  const personCount = Number(persons);
  const overCapacity = finalCapacity > 0 && Number.isInteger(personCount) && personCount > finalCapacity;
  const nights = validDates ? getNights(checkinDate, checkoutDate) : 0;
  const rate = Number(nightlyRate) || 0;
  const oldNights = getNights(booking.checkinDate, booking.checkoutDate);
  const oldBeds = Math.max(1, assignments.filter((a) => a.status === "assigned").length || 1);
  const suggestedRate =
    rate === 0 && Number(booking.amountTotal || 0) > 0 && oldNights > 0
      ? Math.max(0, Math.round(Number(booking.amountTotal) / (oldNights * oldBeds)))
      : 0;

  const moneyPreview = useMemo(() => {
    const paid = Number(booking.amountPaid || 0);
    const currentTotal = Number(booking.amountTotal || 0);
    const currentDue = Math.max(0, currentTotal - paid);
    if (rate <= 0 || nights <= 0 || finalBedCount <= 0) {
      return { currentTotal, paid, currentDue, previewTotal: currentTotal, previewDue: currentDue, totalUnchanged: true };
    }
    const walkin = parseGokoWalkin(booking.rawData);
    const bedsForPrice = walkin?.unitPricing ? 1 : finalBedCount;
    const gross = rate * nights * bedsForPrice;
    const discount = walkinDiscountOnGross(gross, walkin);
    const priced = bookingTotals(gross, { discount, taxPercent: walkin?.taxPercent });
    const previewTotal = priced.total;
    return {
      currentTotal,
      paid,
      currentDue,
      previewTotal,
      previewDue: Math.max(0, previewTotal - paid),
      totalUnchanged: false,
    };
  }, [booking.amountPaid, booking.amountTotal, booking.rawData, finalBedCount, nights, rate]);

  useEffect(() => {
    if (!validDates || closed) {
      setAvailableUnits([]);
      return;
    }
    let cancelled = false;
    setLoadingUnits(true);
    setDroppedAddCount(0);
    const payload: Record<string, unknown> = { password, action: "getAvailableBeds", checkinDate, checkoutDate, bookingId: booking.id };
    if (username) payload.username = username;
    fetch("/api/admin/bookings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) })
      .then(async (res) => res.ok ? res.json() : { units: [] })
      .then((data) => {
        if (cancelled) return;
        const units: Unit[] = Array.isArray(data.units) ? data.units : [];
        setAvailableUnits(units);
        setAddUnitKeys((current) => {
          const next = current.filter((key) => units.some((unit) => unit.key === key));
          setDroppedAddCount(current.length - next.length);
          return next;
        });
      })
      .catch(() => {
        if (!cancelled) {
          setAvailableUnits([]);
          setAddUnitKeys([]);
          setDroppedAddCount(0);
        }
      })
      .finally(() => { if (!cancelled) setLoadingUnits(false); });
    return () => { cancelled = true; };
  }, [booking.id, checkinDate, checkoutDate, closed, password, username, validDates]);

  const save = async (paymentFields: Record<string, unknown> = {}) => {
    setError("");
    if (!validForm) { setError("Enter a guest name, valid dates, guest count, and nightly rate."); return; }
    if (overCapacity) {
      setError(`Booking needs ${personCount} guest(s); selected rooms sleep ${finalCapacity}.`);
      return;
    }
    setSaving(true);
    const nightlyRateChanged = Number(nightlyRate) !== Number(booking.nightlyRate ?? 0);
    const ok = await onAction("editReservation", booking.id, {
      guestName: guestName.trim(), contact: contact.trim(), email: email.trim(), specialRequests: specialRequests.trim(),
      persons: Number(persons), checkinDate, checkoutDate,
      ...(nightlyRateChanged ? { nightlyRate: Number(nightlyRate) } : {}),
      addBedIds: selectedAddUnits.flatMap((unit) => unit.bedIds), removeBedIds,
      ...(paymentChanged ? { amountPaid: parsedAmountPaid, ...paymentFields } : {}),
    });
    setSaving(false);
    if (ok) onClose();
  };

  const submit = async () => {
    if (!validForm) {
      setError("Enter a guest name, valid dates, guest count, nightly rate, and a valid amount received.");
      return;
    }
    if (overCapacity) {
      setError(`Booking needs ${personCount} guest(s); selected rooms sleep ${finalCapacity}.`);
      return;
    }
    const currentPaid = Number(booking.amountPaid || 0);
    if (!paymentChanged) await save();
    else if (parsedAmountPaid > currentPaid) setPaymentAdjustment({ mode: "collect", amount: parsedAmountPaid - currentPaid });
    else if (lowerPaymentMode === "refund") setPaymentAdjustment({ mode: "refund", amount: currentPaid - parsedAmountPaid });
    else await save({ paymentAdjustment: "correction" });
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto bg-black/30 p-2 backdrop-blur-sm sm:items-center sm:p-4" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="my-2 w-full max-w-lg overflow-hidden rounded-xl border border-border bg-popover shadow-xl sm:my-0 sm:rounded-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-border p-4">
          <div><h3 className="font-display text-lg font-bold text-foreground">Edit Booking</h3><p className="text-xs text-muted-foreground">{booking.source === "website" ? "Website booking" : "Manual offline / walk-in"} · status stays {booking.status.replaceAll("_", " ")}. Raising the total leaves paid as-is — remaining due shows as Collect remaining.</p></div>
          <Button variant="ghost" size="icon-sm" onClick={onClose}><XIcon className="size-4" /><span className="sr-only">Close</span></Button>
        </div>
        <div className="max-h-[calc(100dvh-8rem)] space-y-4 overflow-y-auto p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="text-xs font-medium sm:col-span-2">Guest name *<input className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" value={guestName} onChange={(e) => setGuestName(e.target.value)} /></label>
            <label className="text-xs font-medium">Phone<input className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" value={contact} onChange={(e) => setContact(e.target.value)} /></label>
            <label className="text-xs font-medium">Email<input type="email" className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
            <div className="sm:col-span-2">
              <DateRangePicker
                presentation="inline"
                variant="admin"
                labels={{ start: "Check-in", end: "Check-out" }}
                startDate={checkinDate}
                endDate={checkoutDate}
                onChange={({ startDate, endDate }) => {
                  setCheckinDate(startDate);
                  setCheckoutDate(endDate);
                }}
              />
              <p className="mt-1 text-xs text-muted-foreground">{validDates ? `${getNights(checkinDate, checkoutDate)} night${getNights(checkinDate, checkoutDate) === 1 ? "" : "s"}` : "Enter a check-out date after check-in."}</p>
            </div>
            <label className="text-xs font-medium">Persons<input type="number" min={1} step={1} inputMode="numeric" className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" value={persons} onChange={(e) => setPersons(e.target.value)} /></label>
            <label className="text-xs font-medium">Nightly rate (₹)<input type="number" min={0} step={1} inputMode="numeric" className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" value={nightlyRate} onChange={(e) => setNightlyRate(e.target.value)} /></label>
            {suggestedRate > 0 && rate === 0 && (
              <p className="text-[11px] text-muted-foreground sm:col-span-2">
                Rate is ₹0 so the total will not auto-update.{" "}
                <button type="button" className="font-medium text-foreground underline underline-offset-2" onClick={() => setNightlyRate(String(suggestedRate))}>
                  Use suggested {formatCurrency(suggestedRate)}/night from current total
                </button>
              </p>
            )}
            {canEditPaid ? (
              <label className="text-xs font-medium sm:col-span-2">Amount received (₹)<input type="number" min={0} step={1} inputMode="numeric" className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" value={amountPaid} onChange={(e) => setAmountPaid(e.target.value)} /><span className="mt-1 block text-[11px] font-normal text-muted-foreground">Final balance is recalculated from the saved pricing rules when you save.</span></label>
            ) : (
              <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground sm:col-span-2">
                Online paid amount stays ₹{Number(booking.amountPaid || 0)}. After you raise the total, collect the difference with Collect remaining.
              </p>
            )}
          </div>

          <div className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            <div>Now: Total {formatCurrency(moneyPreview.currentTotal)} · Paid {formatCurrency(moneyPreview.paid)} · Due {formatCurrency(moneyPreview.currentDue)}</div>
            <div className="mt-0.5 font-medium text-foreground">
              After save: Total {formatCurrency(moneyPreview.previewTotal)} · Due {formatCurrency(moneyPreview.previewDue)}
              {moneyPreview.totalUnchanged ? " (total unchanged while rate is ₹0)" : ""}
            </div>
          </div>

          {canEditPaid && paymentChanged && parsedAmountPaid < Number(booking.amountPaid || 0) && (
            <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50/60 p-3 text-xs dark:border-amber-900 dark:bg-amber-950/20">
              <div className="font-semibold text-amber-900 dark:text-amber-100">Amount is lower than the saved payment</div>
              <label className="flex items-start gap-2"><input type="radio" name="lower-payment-mode" checked={lowerPaymentMode === "correction"} onChange={() => setLowerPaymentMode("correction")} /><span><span className="font-medium">Correct the saved amount</span><span className="block text-muted-foreground">Use this when the original advance was entered incorrectly. No money is refunded.</span></span></label>
              <label className="flex items-start gap-2"><input type="radio" name="lower-payment-mode" checked={lowerPaymentMode === "refund"} onChange={() => setLowerPaymentMode("refund")} /><span><span className="font-medium">Refund the difference</span><span className="block text-muted-foreground">Record how the difference is returned using the payment dialog.</span></span></label>
            </div>
          )}

          <div>
            <div className="text-xs font-semibold text-foreground">Assigned rooms / beds</div>
            {assignments.length === 0 ? <p className="mt-1 text-xs text-muted-foreground">No beds assigned.</p> : <div className="mt-1 space-y-1">{assignments.map((assignment) => <label key={assignment.id} className="flex items-center gap-2 rounded-lg border border-border px-2.5 py-2 text-xs"><input type="checkbox" disabled={closed} checked={!removeBedIds.includes(assignment.bedId)} onChange={() => setRemoveBedIds((current) => current.includes(assignment.bedId) ? current.filter((id) => id !== assignment.bedId) : [...current, assignment.bedId])} /><span className="font-medium">{assignment.dormName} - {assignment.bedLabel}</span><span className="ml-auto text-muted-foreground">{removeBedIds.includes(assignment.bedId) ? "remove" : "keep"}</span></label>)}</div>}
          </div>

          <div>
            <div className="flex items-center justify-between text-xs font-semibold text-foreground"><span>Add available rooms / beds</span>{loadingUnits && <Loader2Icon className="size-3 animate-spin" />}</div>
            {closed ? (
              <p className="mt-1 text-xs text-muted-foreground">Closed bookings keep their historical bed assignments.</p>
            ) : availableUnits.length === 0 ? (
              <p className="mt-1 text-xs text-muted-foreground">{loadingUnits ? "Checking availability for these dates…" : "No additional complete rooms/beds are available for this stay."}</p>
            ) : (
              <div className="mt-1 space-y-1">{availableUnits.map((unit) => <label key={unit.key} className="flex items-center gap-2 rounded-lg border border-border px-2.5 py-2 text-xs"><input type="checkbox" checked={addUnitKeys.includes(unit.key)} onChange={() => setAddUnitKeys((current) => current.includes(unit.key) ? current.filter((key) => key !== unit.key) : [...current, unit.key])} /><span className="font-medium">{unit.dormName} - {unit.label}</span><span className="ml-auto text-muted-foreground">up to {unit.capacity}</span></label>)}</div>
            )}
            {droppedAddCount > 0 && (
              <p className="mt-1 text-xs text-amber-800 dark:text-amber-200">{droppedAddCount} bed(s) no longer available for these dates.</p>
            )}
          </div>

          {finalCapacity > 0 && (
            <p className={`text-xs ${overCapacity ? "font-medium text-red-700 dark:text-red-400" : "text-muted-foreground"}`}>
              Selected rooms sleep {finalCapacity} · booking needs {Number.isInteger(personCount) ? personCount : "—"} guest(s)
              {overCapacity ? " — add beds or lower persons before saving." : ""}
            </p>
          )}

          <label className="block text-xs font-medium">Special requests<textarea rows={3} className="mt-1 w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-sm" value={specialRequests} onChange={(e) => setSpecialRequests(e.target.value)} /></label>
          <p className="text-[11px] text-muted-foreground">Dates and bed changes can be saved together. Availability is checked against existing bookings, blocks, holds, room capacity, and this booking. Discounts and tax follow the saved booking rules. Website stays keep online payments; use Collect remaining for any new balance.</p>
          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs font-medium text-red-700 dark:bg-red-950/30 dark:text-red-400">{error}</p>}
        </div>
        <div className="flex flex-col-reverse gap-2 border-t border-border p-4 sm:flex-row sm:justify-end"><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={() => void submit()} disabled={saving || !validForm || overCapacity}>{saving ? "Saving..." : "Save changes"}</Button></div>
      </div>
      {paymentAdjustment && (
        <RecordPaymentModal
          totalAmount={paymentAdjustment.amount}
          guestName={booking.guestName}
          mode={paymentAdjustment.mode === "refund" ? "refund" : "collect"}
          amountUnit="rupees"
          zClass="z-[80]"
          password={password}
          username={username}
          receiptKind="room"
          onConfirm={async (method, cashReceived, changeGiven, onlineAccountId, receiptId) => {
            const adjustment = paymentAdjustment;
            setPaymentAdjustment(null);
            await save(adjustment.mode === "refund"
              ? { paymentAdjustment: "refund", refundMethod: method, refundCash: method === "cash" ? adjustment.amount : cashReceived, onlineAccountId, receiptId }
              : { paymentAdjustment: "payment", paymentMethod: method, cashReceived, changeGiven, onlineAccountId, receiptId });
          }}
          onClose={() => !saving && setPaymentAdjustment(null)}
        />
      )}
    </div>
  );
}
