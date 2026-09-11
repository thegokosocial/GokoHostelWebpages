"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { XIcon, Loader2Icon } from "lucide-react";
import type { DashboardBooking, BedAssignment } from "./types";
import { addCalendarDays } from "@/lib/inventoryAvailability";
import { getNights } from "./utils";
import { RecordPaymentModal } from "@/components/admin/RecordPaymentModal";

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
  const [loadingUnits, setLoadingUnits] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [paymentAdjustment, setPaymentAdjustment] = useState<{ mode: "collect" | "refund"; amount: number } | null>(null);

  const originalCheckout = booking.checkoutDate || booking.checkinDate;
  const datesChanged = checkinDate !== booking.checkinDate || checkoutDate !== originalCheckout;
  const validDates = Boolean(checkinDate && checkoutDate && checkoutDate > checkinDate);
  const parsedAmountPaid = amountPaid === "" ? NaN : Number(amountPaid);
  const validAmountPaid = Number.isInteger(parsedAmountPaid) && parsedAmountPaid >= 0;
  const validForm = Boolean(guestName.trim() && validDates && Number.isInteger(Number(persons)) && Number(persons) > 0 && Number.isInteger(Number(nightlyRate)) && Number(nightlyRate) >= 0 && validAmountPaid);
  const paymentChanged = validAmountPaid && parsedAmountPaid !== Number(booking.amountPaid || 0);
  const selectedAddUnits = useMemo(() => availableUnits.filter((unit) => addUnitKeys.includes(unit.key)), [availableUnits, addUnitKeys]);
  const closed = ["checked_out", "cancelled", "no_show"].includes(booking.status);

  useEffect(() => {
    if (!validDates || closed) {
      setAvailableUnits([]);
      return;
    }
    let cancelled = false;
    setLoadingUnits(true);
    const payload: Record<string, unknown> = { password, action: "getAvailableBeds", checkinDate, checkoutDate, bookingId: booking.id };
    if (username) payload.username = username;
    fetch("/api/admin/bookings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) })
      .then(async (res) => res.ok ? res.json() : { units: [] })
      .then((data) => { if (!cancelled) setAvailableUnits(Array.isArray(data.units) ? data.units : []); })
      .catch(() => { if (!cancelled) setAvailableUnits([]); })
      .finally(() => { if (!cancelled) setLoadingUnits(false); });
    return () => { cancelled = true; };
  }, [booking.id, checkinDate, checkoutDate, closed, password, username, validDates]);

  const save = async (paymentFields: Record<string, unknown> = {}) => {
    setError("");
    if (!validForm) { setError("Enter a guest name, valid dates, guest count, and nightly rate."); return; }
    if (datesChanged && (addUnitKeys.length > 0 || removeBedIds.length > 0)) {
      setError("Save date changes and bed changes separately.");
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
          <div><h3 className="font-display text-lg font-bold text-foreground">Edit Booking</h3><p className="text-xs text-muted-foreground">Manual offline / walk-in booking · status stays {booking.status.replaceAll("_", " ")}</p></div>
          <Button variant="ghost" size="icon-sm" onClick={onClose}><XIcon className="size-4" /><span className="sr-only">Close</span></Button>
        </div>
        <div className="max-h-[calc(100dvh-8rem)] space-y-4 overflow-y-auto p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="text-xs font-medium sm:col-span-2">Guest name *<input className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" value={guestName} onChange={(e) => setGuestName(e.target.value)} /></label>
            <label className="text-xs font-medium">Phone<input className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" value={contact} onChange={(e) => setContact(e.target.value)} /></label>
            <label className="text-xs font-medium">Email<input type="email" className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
            <label className="text-xs font-medium">Check-in *<input type="date" className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" value={checkinDate} onChange={(e) => setCheckinDate(e.target.value)} /></label>
            <label className="text-xs font-medium">Check-out *<input type="date" min={checkinDate} className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" value={checkoutDate} onChange={(e) => setCheckoutDate(e.target.value)} /></label>
            <p className="text-xs text-muted-foreground sm:col-span-2">{validDates ? `${getNights(checkinDate, checkoutDate)} night${getNights(checkinDate, checkoutDate) === 1 ? "" : "s"}` : "Enter a check-out date after check-in."}</p>
            <label className="text-xs font-medium">Persons<input type="number" min={1} step={1} inputMode="numeric" className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" value={persons} onChange={(e) => setPersons(e.target.value)} /></label>
            <label className="text-xs font-medium">Nightly rate (₹)<input type="number" min={0} step={1} inputMode="numeric" className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" value={nightlyRate} onChange={(e) => setNightlyRate(e.target.value)} /></label>
            <label className="text-xs font-medium sm:col-span-2">Amount received (₹)<input type="number" min={0} step={1} inputMode="numeric" className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" value={amountPaid} onChange={(e) => setAmountPaid(e.target.value)} /><span className="mt-1 block text-[11px] font-normal text-muted-foreground">Final balance is recalculated from the saved pricing rules when you save.</span></label>
          </div>

          {paymentChanged && parsedAmountPaid < Number(booking.amountPaid || 0) && (
            <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50/60 p-3 text-xs dark:border-amber-900 dark:bg-amber-950/20">
              <div className="font-semibold text-amber-900 dark:text-amber-100">Amount is lower than the saved payment</div>
              <label className="flex items-start gap-2"><input type="radio" name="lower-payment-mode" checked={lowerPaymentMode === "correction"} onChange={() => setLowerPaymentMode("correction")} /><span><span className="font-medium">Correct the saved amount</span><span className="block text-muted-foreground">Use this when the original advance was entered incorrectly. No money is refunded.</span></span></label>
              <label className="flex items-start gap-2"><input type="radio" name="lower-payment-mode" checked={lowerPaymentMode === "refund"} onChange={() => setLowerPaymentMode("refund")} /><span><span className="font-medium">Refund the difference</span><span className="block text-muted-foreground">Record how the difference is returned using the payment dialog.</span></span></label>
            </div>
          )}

          <div>
            <div className="text-xs font-semibold text-foreground">Assigned rooms / beds</div>
            {assignments.length === 0 ? <p className="mt-1 text-xs text-muted-foreground">No beds assigned.</p> : <div className="mt-1 space-y-1">{assignments.map((assignment) => <label key={assignment.id} className="flex items-center gap-2 rounded-lg border border-border px-2.5 py-2 text-xs"><input type="checkbox" disabled={closed || datesChanged} checked={!removeBedIds.includes(assignment.bedId)} onChange={() => setRemoveBedIds((current) => current.includes(assignment.bedId) ? current.filter((id) => id !== assignment.bedId) : [...current, assignment.bedId])} /><span className="font-medium">{assignment.dormName} - {assignment.bedLabel}</span><span className="ml-auto text-muted-foreground">{removeBedIds.includes(assignment.bedId) ? "remove" : "keep"}</span></label>)}</div>}
          </div>

          <div>
            <div className="flex items-center justify-between text-xs font-semibold text-foreground"><span>Add available rooms / beds</span>{loadingUnits && <Loader2Icon className="size-3 animate-spin" />}</div>
            {closed ? <p className="mt-1 text-xs text-muted-foreground">Closed bookings keep their historical bed assignments.</p> : datesChanged ? <p className="mt-1 text-xs text-muted-foreground">Save the date change first, then edit beds after availability is recalculated.</p> : availableUnits.length === 0 ? <p className="mt-1 text-xs text-muted-foreground">No additional complete rooms/beds are available for this stay.</p> : <div className="mt-1 space-y-1">{availableUnits.map((unit) => <label key={unit.key} className="flex items-center gap-2 rounded-lg border border-border px-2.5 py-2 text-xs"><input type="checkbox" checked={addUnitKeys.includes(unit.key)} onChange={() => setAddUnitKeys((current) => current.includes(unit.key) ? current.filter((key) => key !== unit.key) : [...current, unit.key])} /><span className="font-medium">{unit.dormName} - {unit.label}</span><span className="ml-auto text-muted-foreground">up to {unit.capacity}</span></label>)}</div>}
          </div>

          <label className="block text-xs font-medium">Special requests<textarea rows={3} className="mt-1 w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-sm" value={specialRequests} onChange={(e) => setSpecialRequests(e.target.value)} /></label>
          <p className="text-[11px] text-muted-foreground">Dates and bed changes are checked against existing bookings, blocks, holds, room capacity, and the booking itself. Discounts and tax are preserved/recalculated from the saved walk-in booking rules.</p>
          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs font-medium text-red-700 dark:bg-red-950/30 dark:text-red-400">{error}</p>}
        </div>
        <div className="flex flex-col-reverse gap-2 border-t border-border p-4 sm:flex-row sm:justify-end"><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={() => void submit()} disabled={saving || !validForm}>{saving ? "Saving..." : "Save changes"}</Button></div>
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
