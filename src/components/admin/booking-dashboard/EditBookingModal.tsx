"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { XIcon } from "lucide-react";
import type { DashboardBooking, BedAssignment } from "./types";
import { addCalendarDays } from "@/lib/inventoryAvailability";
import { getNights, formatCurrency } from "./utils";
import { RecordPaymentModal } from "@/components/admin/RecordPaymentModal";
import { DateRangePicker } from "@/components/dates/DateRangePicker";
import {
  bookingTaxPercent,
  bookingTotals,
  DEFAULT_BOOKING_TAX_PERCENT,
  parseGokoWalkin,
  walkinDiscountOnGross,
} from "@/lib/bookingPricing";
import { AvailableBedsPicker, type AvailableBedUnit } from "./AvailableBedsPicker";

export function EditBookingModal({ booking, assignments, password, username, onAction, onClose }: {
  booking: DashboardBooking;
  assignments: BedAssignment[];
  password: string;
  username?: string;
  onAction: (action: string, bookingId: number, extra?: Record<string, unknown>) => Promise<boolean | void>;
  onClose: () => void;
}) {
  const oldNights = getNights(booking.checkinDate, booking.checkoutDate);
  const oldBeds = Math.max(
    1,
    assignments
      .filter((a) => a.status === "assigned")
      .reduce((sum, a) => sum + (a.physicalBedIds?.length || a.capacity || 1), 0) || 1,
  );
  const oldBasis = Number(booking.amountBeforeTax || 0) > 0
    ? Number(booking.amountBeforeTax)
    : Number(booking.amountTotal || 0);
  const impliedRate = Number(booking.nightlyRate || 0) > 0
    ? Number(booking.nightlyRate)
    : (oldBasis > 0 ? Math.max(0, Math.round(oldBasis / (oldNights * oldBeds))) : 0);

  const [guestName, setGuestName] = useState(booking.guestName);
  const [contact, setContact] = useState(booking.contact || "");
  const [email, setEmail] = useState(booking.email || "");
  const [checkinDate, setCheckinDate] = useState(booking.checkinDate);
  const [checkoutDate, setCheckoutDate] = useState(booking.checkoutDate || addCalendarDays(booking.checkinDate, 1));
  const [persons, setPersons] = useState(String(booking.persons || 1));
  const [nightlyRate, setNightlyRate] = useState(String(impliedRate));
  const [amountPaid, setAmountPaid] = useState(String(booking.amountPaid || 0));
  const [lowerPaymentMode, setLowerPaymentMode] = useState<"correction" | "refund">("correction");
  const [specialRequests, setSpecialRequests] = useState(booking.specialRequests || "");
  const [availableUnits, setAvailableUnits] = useState<AvailableBedUnit[]>([]);
  const [dormRates, setDormRates] = useState<Record<number, number>>({});
  const [taxPercent, setTaxPercent] = useState(DEFAULT_BOOKING_TAX_PERCENT);
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
    () => assignments.filter((a) => {
      if (a.status !== "assigned") return false;
      const ids = a.physicalBedIds?.length ? a.physicalBedIds : [a.bedId];
      return !ids.some((id) => removeBedIds.includes(id));
    }),
    [assignments, removeBedIds],
  );
  const finalCapacity = keptAssignments.reduce((sum, a) => sum + (a.capacity || a.physicalBedIds?.length || 1), 0)
    + selectedAddUnits.reduce((sum, unit) => sum + unit.capacity, 0);
  const finalBedCount = keptAssignments.reduce((sum, a) => sum + (a.physicalBedIds?.length || a.capacity || 1), 0)
    + selectedAddUnits.reduce((sum, unit) => sum + unit.bedIds.length, 0);
  const personCount = Number(persons);
  const overCapacity = finalCapacity > 0 && Number.isInteger(personCount) && personCount > finalCapacity;
  const nights = validDates ? getNights(checkinDate, checkoutDate) : 0;
  const rate = Number(nightlyRate) || 0;

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
    const priced = bookingTotals(gross, { discount, taxPercent: walkin?.taxPercent ?? taxPercent });
    return {
      currentTotal,
      paid,
      currentDue,
      previewTotal: priced.total,
      previewDue: Math.max(0, priced.total - paid),
      totalUnchanged: false,
    };
  }, [booking.amountPaid, booking.amountTotal, booking.rawData, finalBedCount, nights, rate, taxPercent]);

  const recalcNightlyFromSelection = useCallback((keys: string[], units: AvailableBedUnit[], rates: Record<number, number>, kept: BedAssignment[]) => {
    const addUnits = units.filter((u) => keys.includes(u.key));
    const addTotal = addUnits.reduce((sum, u) => sum + (rates[u.dormId] || 0), 0);
    // Group kept beds so a double (2 physical slots) contributes one unit rate.
    const keptUnitKeys = new Set<string>();
    let keptTotal = 0;
    let keptBedSlots = 0;
    for (const a of kept) {
      const isDouble = /double/i.test(a.bedLabel || "");
      const unitKey = isDouble ? `d:${a.dormId}:${a.bedLabel}` : `b:${a.bedId}`;
      keptBedSlots += a.physicalBedIds?.length || a.capacity || 1;
      if (keptUnitKeys.has(unitKey)) continue;
      keptUnitKeys.add(unitKey);
      keptTotal += rates[a.dormId] || 0;
    }
    const unitRateSum = addTotal + keptTotal;
    if (unitRateSum <= 0) return;
    const walkin = parseGokoWalkin(booking.rawData);
    if (walkin?.unitPricing) {
      setNightlyRate(String(unitRateSum));
      return;
    }
    // Per-bed storage (website): convert unit rates → per physical bed slot.
    const bedSlots = Math.max(1, keptBedSlots + addUnits.reduce((n, u) => n + u.bedIds.length, 0));
    setNightlyRate(String(Math.max(0, Math.round(unitRateSum / bedSlots))));
  }, [booking.rawData]);

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
        const units: AvailableBedUnit[] = Array.isArray(data.units) ? data.units : [];
        const rates = (data.dormRates || {}) as Record<number, number>;
        setAvailableUnits(units);
        setDormRates(rates);
        if (data.taxRate != null) setTaxPercent(bookingTaxPercent(data.taxRate));
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

  const toggleAddUnit = (key: string) => {
    setAddUnitKeys((current) => {
      const next = current.includes(key) ? current.filter((k) => k !== key) : [...current, key];
      recalcNightlyFromSelection(next, availableUnits, dormRates, keptAssignments);
      return next;
    });
  };

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
      ...(nightlyRateChanged || Number(booking.nightlyRate ?? 0) === 0 ? { nightlyRate: Number(nightlyRate) } : {}),
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
              {moneyPreview.totalUnchanged ? " (enter a nightly rate to update the total)" : ""}
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
            {assignments.length === 0 ? <p className="mt-1 text-xs text-muted-foreground">No beds assigned.</p> : <div className="mt-1 space-y-1">{assignments.map((assignment) => {
              const slotIds = assignment.physicalBedIds?.length ? assignment.physicalBedIds : [assignment.bedId];
              const markedRemove = slotIds.some((id) => removeBedIds.includes(id));
              return (
                <label key={assignment.id} className="flex items-center gap-2 rounded-lg border border-border px-2.5 py-2 text-xs">
                  <input
                    type="checkbox"
                    disabled={closed}
                    checked={!markedRemove}
                    onChange={() => setRemoveBedIds((current) => {
                      const next = markedRemove
                        ? current.filter((id) => !slotIds.includes(id))
                        : [...new Set([...current, ...slotIds])];
                      const kept = assignments.filter((a) => {
                        if (a.status !== "assigned") return false;
                        const ids = a.physicalBedIds?.length ? a.physicalBedIds : [a.bedId];
                        return !ids.some((id) => next.includes(id));
                      });
                      recalcNightlyFromSelection(addUnitKeys, availableUnits, dormRates, kept);
                      return next;
                    })}
                  />
                  <span className="font-medium">{assignment.dormName} - {assignment.bedLabel}</span>
                  <span className="ml-auto text-muted-foreground">{markedRemove ? "remove" : "keep"}</span>
                </label>
              );
            })}</div>}
          </div>

          <div>
            <div className="text-xs font-semibold text-foreground">Add available rooms / beds ({addUnitKeys.length} selected)</div>
            {closed ? (
              <p className="mt-1 text-xs text-muted-foreground">Closed bookings keep their historical bed assignments.</p>
            ) : (
              <AvailableBedsPicker
                units={availableUnits}
                selectedKeys={addUnitKeys}
                dormRates={dormRates}
                loading={loadingUnits}
                onToggle={toggleAddUnit}
                emptyLabel="No additional complete rooms/beds are available for this stay."
              />
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
          <p className="text-[11px] text-muted-foreground">Dates and bed changes can be saved together. Totals recalculate from nightly rate × nights × beds. Website stays keep online payments; use Collect remaining for any new balance.</p>
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
