"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { cn, todayIST } from "@/lib/utils";
import { addCalendarDays } from "@/lib/inventoryAvailability";
import { motion, AnimatePresence } from "framer-motion";
import { overlayVariants, modalVariants } from "@/lib/animations";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { XIcon, Loader2Icon, CheckIcon } from "lucide-react";
import { useAdminToast } from "@/components/admin/AdminToast";
import { fetchWithRetry } from "@/components/admin/useAdminApi";
import { getNights, formatCurrency } from "./utils";
import {
  bookingDiscountRupees,
  bookingTaxPercent,
  bookingTotals,
  DEFAULT_BOOKING_TAX_PERCENT,
} from "@/lib/bookingPricing";
import type { CalendarDorm, DateRange } from "./types";

type AvailableUnit = { key: string; label: string; dormId: number; dormName: string; type: "Double" | "Bed"; capacity: number; bedIds: number[]; pool?: "online" | "offline" | "block" };

const DISCOUNT_REASONS = ["Complimentary", "Staff Stay", "Loyalty Guest", "Service Issue", "Manager Discount", "Other"];
const QUICK_PERCENTS = [5, 10, 15, 20, 25, 50, 100];

export function CreateBookingModal({
  dorms,
  dateRange,
  onClose,
  onCreated,
  password,
  username,
}: {
  dorms: CalendarDorm[];
  dateRange: DateRange;
  onClose: () => void;
  onCreated: () => Promise<void>;
  password: string;
  username?: string;
}) {
  const { showError, showSuccess } = useAdminToast();
  const [submitting, setSubmitting] = useState(false);

  const [guestName, setGuestName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [checkinDate, setCheckinDate] = useState(() => {
    const today = todayIST();
    return dateRange.startDate > today ? dateRange.startDate : today;
  });
  const [checkoutDate, setCheckoutDate] = useState(() => {
    const today = todayIST();
    const start = dateRange.startDate > today ? dateRange.startDate : today;
    return addCalendarDays(start, 1);
  });
  const [platform, setPlatform] = useState<"walkin" | "booking_engine">("walkin");
  const [nightlyRate, setNightlyRate] = useState(500);
  const [specialRequests, setSpecialRequests] = useState("");
  const [persons, setPersons] = useState("1");
  const [selectedUnits, setSelectedUnits] = useState<string[]>([]);
  const [availableUnits, setAvailableUnits] = useState<AvailableUnit[]>([]);
  const [loadingBeds, setLoadingBeds] = useState(false);
  const [dormRates, setDormRates] = useState<Record<number, number>>({});
  const [taxPercent, setTaxPercent] = useState(DEFAULT_BOOKING_TAX_PERCENT);
  const [discountMode, setDiscountMode] = useState<"percent" | "fixed">("percent");
  const [discountPercent, setDiscountPercent] = useState("");
  const [discountAmount, setDiscountAmount] = useState("");
  const [discountReason, setDiscountReason] = useState(DISCOUNT_REASONS[0]);
  const [customReason, setCustomReason] = useState("");

  const nights = useMemo(() => getNights(checkinDate, checkoutDate), [checkinDate, checkoutDate]);
  const pricing = useMemo(() => {
    const gross = nightlyRate * nights;
    const discount = platform === "walkin"
      ? bookingDiscountRupees(gross, discountMode === "percent"
        ? { percent: discountPercent }
        : { amount: discountAmount })
      : 0;
    return bookingTotals(gross, { discount, taxPercent });
  }, [nightlyRate, nights, platform, discountMode, discountPercent, discountAmount, taxPercent]);

  useEffect(() => {
    if (!checkinDate || !checkoutDate || checkinDate >= checkoutDate) {
      setAvailableUnits([]);
      setLoadingBeds(false);
      return;
    }
    setLoadingBeds(true);
    setSelectedUnits([]);
    setAvailableUnits([]);
    let cancelled = false;
    (async () => {
      try {
        const payload: Record<string, unknown> = { password, action: "getAvailableBeds", checkinDate, checkoutDate };
        if (username) payload.username = username;
        const res = await fetchWithRetry("/api/admin/bookings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }, { retryServerError: true });
        if (cancelled) return;
        if (res.ok) {
          const data = await res.json();
          setAvailableUnits(data.units || []);
          setDormRates(data.dormRates || {});
          if (data.taxRate != null) setTaxPercent(bookingTaxPercent(data.taxRate));
        } else {
          setAvailableUnits([]);
        }
      } catch {
        if (!cancelled) setAvailableUnits([]);
      } finally {
        if (!cancelled) setLoadingBeds(false);
      }
    })();
    return () => { cancelled = true; };
  }, [checkinDate, checkoutDate, password, username]);

  const availableBeds = useMemo(() => {
    const dormMap = new Map<number, { id: number; name: string; beds: AvailableUnit[] }>();
    for (const unit of availableUnits) {
      if (!dormMap.has(unit.dormId)) {
        dormMap.set(unit.dormId, { id: unit.dormId, name: unit.dormName, beds: [] });
      }
      dormMap.get(unit.dormId)!.beds.push(unit);
    }
    return Array.from(dormMap.values());
  }, [availableUnits]);

  const toggleBed = useCallback((key: string) => {
    setSelectedUnits((prev) => {
      const next = prev.includes(key) ? prev.filter((id) => id !== key) : [...prev, key];
      const total = availableUnits.filter((u) => next.includes(u.key)).reduce((sum, u) => sum + (dormRates[u.dormId] || 0), 0);
      if (total > 0) setNightlyRate(total);
      return next;
    });
  }, [availableUnits, dormRates]);

  const selectedUnitRows = availableUnits.filter((u) => selectedUnits.includes(u.key));
  const selectedCapacity = selectedUnitRows.reduce((sum, u) => sum + u.capacity, 0);
  const personCount = persons === "" ? NaN : Number(persons);
  const validPersonCount = Number.isInteger(personCount) && personCount >= 1;
  const selectionIsMinimal = validPersonCount && !selectedUnitRows.some((unit) => selectedCapacity - unit.capacity >= personCount);
  const canSubmit = guestName.trim() && phone.trim() && selectedUnits.length > 0 && validPersonCount && personCount <= selectedCapacity && selectionIsMinimal && nights > 0;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const payload: Record<string, unknown> = {
        password,
        action: "createBooking",
        guestName: guestName.trim(),
        contact: phone.trim(),
        email: email.trim(),
        checkinDate,
        checkoutDate,
        platform,
        nightlyRate,
        specialRequests: specialRequests.trim(),
        persons: personCount,
        bedIds: availableUnits.filter((u) => selectedUnits.includes(u.key)).flatMap((u) => u.bedIds),
        unitRates: Object.fromEntries(availableUnits.filter((u) => selectedUnits.includes(u.key)).map((u) => [u.key, dormRates[u.dormId] || 0])),
      };
      if (username) payload.username = username;
      if (platform === "walkin" && pricing.discount > 0) {
        if (discountMode === "percent") payload.discountPercent = Number(discountPercent) || 0;
        else payload.discountAmount = Number(discountAmount) || 0;
        payload.discountReason = discountReason === "Other" ? customReason.trim() : discountReason;
      }

      const res = await fetch("/api/admin/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        showSuccess("Booking created");
        await onCreated();
      } else {
        const data = await res.json().catch(() => ({ error: "Failed to create booking" }));
        showError(data.error || "Failed to create booking");
      }
    } catch {
      showError("Network error");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AnimatePresence>
      <motion.div
        key="overlay"
        variants={overlayVariants}
        initial="hidden"
        animate="visible"
        exit="exit"
        className="fixed inset-0 z-50 bg-black/20 backdrop-blur-sm"
        onClick={onClose}
      />
      <motion.div
        key="modal"
        variants={modalVariants}
        initial="hidden"
        animate="visible"
        exit="exit"
        className="fixed inset-4 z-50 mx-auto flex max-w-lg flex-col rounded-2xl border border-border bg-popover shadow-xl sm:inset-y-8"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border p-4">
          <h3 className="font-heading text-base font-medium text-foreground">New Booking</h3>
          <Button variant="ghost" size="icon-sm" onClick={onClose}>
            <XIcon className="size-4" />
          </Button>
        </div>

        {/* Form */}
        <div className="flex-1 overflow-y-auto p-4">
          <div className="space-y-4">
            {/* Guest info */}
            <div className="space-y-3">
              <div>
                <Label className="text-xs">Guest Name *</Label>
                <Input
                  value={guestName}
                  onChange={(e) => setGuestName(e.target.value)}
                  placeholder="Full name"
                  className="mt-1"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Phone *</Label>
                  <Input
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+91..."
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label className="text-xs">Email</Label>
                  <Input
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="email@example.com"
                    type="email"
                    className="mt-1"
                  />
                </div>
              </div>
            </div>

            {/* Dates */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Check-in Date</Label>
                <Input
                  type="date"
                  min={todayIST()}
                  value={checkinDate}
                  onChange={(e) => {
                    const start = e.target.value;
                    setCheckinDate(start);
                    if (start) setCheckoutDate(addCalendarDays(start, 1));
                  }}
                  className="mt-1"
                />
              </div>
              <div>
                <Label className="text-xs">Check-out Date</Label>
                <Input
                  type="date"
                  min={checkinDate ? addCalendarDays(checkinDate, 1) : todayIST()}
                  value={checkoutDate}
                  onChange={(e) => setCheckoutDate(e.target.value)}
                  className="mt-1"
                />
              </div>
            </div>
            <div className="text-xs text-muted-foreground">
              {nights} night{nights !== 1 ? "s" : ""}
            </div>
            <div>
              <Label className="text-xs">Guests</Label>
              <Input type="number" min={1} step={1} value={persons} onChange={(e) => setPersons(e.target.value)} className="mt-1 w-24" />
              {!validPersonCount && (
                <p className="mt-1 text-[10px] text-red-600">Enter at least 1 guest</p>
              )}
              {selectedUnits.length > 0 && validPersonCount && personCount > selectedCapacity && (
                <p className="mt-1 text-[10px] text-red-600">Selected units hold at most {selectedCapacity} guest(s)</p>
              )}
            </div>

            {/* Platform */}
            <div>
              <Label className="text-xs">Source</Label>
              <div className="mt-1 flex gap-2">
                <button
                  type="button"
                  onClick={() => setPlatform("walkin")}
                  className={cn(
                    "rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
                    platform === "walkin"
                      ? "border-brand-green bg-brand-green/10 text-brand-green"
                      : "border-input bg-background text-muted-foreground hover:bg-muted",
                  )}
                >
                  Walk-in
                </button>
                <button
                  type="button"
                  onClick={() => setPlatform("booking_engine")}
                  className={cn(
                    "rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
                    platform === "booking_engine"
                      ? "border-brand-green bg-brand-green/10 text-brand-green"
                      : "border-input bg-background text-muted-foreground hover:bg-muted",
                  )}
                >
                  Booking Engine
                </button>
              </div>
            </div>

            {/* Rate */}
            <div>
              <Label className="text-xs">Nightly total for selected units</Label>
              <Input
                type="number"
                value={nightlyRate}
                onChange={(e) => setNightlyRate(Number(e.target.value) || 0)}
                className="mt-1 w-32"
                min={0}
              />
            </div>

            {/* Bed picker */}
            <div>
              <Label className="text-xs">Select rooms / beds ({selectedUnits.length} selected)</Label>
              <p className="mt-0.5 text-[10px] text-muted-foreground">
                <span className="font-medium text-sky-700 dark:text-sky-400">Blue</span> = OTA (pushed to PMS)
                {" · "}
                <span className="font-medium text-emerald-700 dark:text-emerald-400">Green</span> = walk-in
                {" · "}
                <span className="font-medium text-orange-600">Orange</span> = blocked (clears the block, no PMS push)
              </p>
              {loadingBeds ? (
                <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2Icon className="size-3.5 animate-spin" /> Loading available beds...
                </div>
              ) : (
                <div className="mt-2 space-y-2">
                  {availableBeds.map((dorm) => {
                    const onlineN = dorm.beds.filter((b) => b.pool === "online").length;
                    const offlineN = dorm.beds.filter((b) => b.pool === "offline").length;
                    const blockN = dorm.beds.filter((b) => b.pool === "block").length;
                    return (
                    <div key={dorm.id} className="rounded-lg border border-border p-2">
                      <div className="mb-1.5 flex items-center justify-between gap-2">
                        <span className="text-[11px] font-semibold text-foreground">{dorm.name}</span>
                        <span className="text-[10px] text-muted-foreground">
                          {onlineN > 0 && <span className="text-sky-700 dark:text-sky-400">{onlineN} OTA</span>}
                          {onlineN > 0 && (offlineN > 0 || blockN > 0) && " · "}
                          {offlineN > 0 && <span className="text-emerald-700 dark:text-emerald-400">{offlineN} walk-in</span>}
                          {offlineN > 0 && blockN > 0 && " · "}
                          {blockN > 0 && <span className="text-orange-600">{blockN} blocked</span>}
                          {onlineN === 0 && offlineN === 0 && blockN === 0 && `${dorm.beds.length} available`}
                          {dormRates[dorm.id] ? ` · ₹${dormRates[dorm.id]}/night` : ""}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {dorm.beds.map((bed) => {
                          const isSelected = selectedUnits.includes(bed.key);
                          const pool = bed.pool ?? "online";
                          return (
                            <button
                              key={bed.key}
                              type="button"
                              onClick={() => toggleBed(bed.key)}
                              className={cn(
                                "flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium transition-colors",
                                isSelected && pool === "online" && "border-sky-600 bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200",
                                isSelected && pool === "offline" && "border-emerald-600 bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
                                isSelected && pool === "block" && "border-orange-500 bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-200",
                                !isSelected && pool === "online" && "border-sky-200 bg-sky-50/80 text-sky-800 hover:bg-sky-100 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-200",
                                !isSelected && pool === "offline" && "border-emerald-200 bg-emerald-50/80 text-emerald-800 hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200",
                                !isSelected && pool === "block" && "border-orange-200 bg-orange-50 text-orange-800 hover:bg-orange-100 dark:border-orange-800 dark:bg-orange-950/40 dark:text-orange-200",
                              )}
                            >
                              {isSelected && <CheckIcon className="size-3" />}
                              {bed.label}{bed.capacity > 1 ? " · up to 2 guests" : ""}
                            </button>
                          );
                        })}
                        {dorm.beds.length === 0 && (
                          <span className="text-[10px] text-muted-foreground">No available beds</span>
                        )}
                      </div>
                    </div>
                    );
                  })}
                  {availableBeds.length === 0 && !loadingBeds && (
                    <p className="text-xs text-muted-foreground">No beds available for the selected dates</p>
                  )}
                </div>
              )}
            </div>

            {/* Special requests */}
            <div>
              <Label className="text-xs">Special Requests</Label>
              <textarea
                value={specialRequests}
                onChange={(e) => setSpecialRequests(e.target.value)}
                placeholder="Any notes..."
                rows={2}
                className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>

            {platform === "walkin" && (
              <div>
                <Label className="text-xs">Discount</Label>
                <div className="mt-1 flex gap-1 border-b border-border">
                  {([{ id: "percent" as const, label: "% discount" }, { id: "fixed" as const, label: "Amount discount" }]).map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setDiscountMode(t.id)}
                      className={cn(
                        "rounded-t-lg px-3 py-1.5 text-xs font-medium transition-colors",
                        discountMode === t.id
                          ? "border-b-2 border-purple-600 bg-purple-50 text-purple-700 dark:bg-purple-950 dark:text-purple-400"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
                <div className="mt-2 space-y-2">
                  {discountMode === "percent" ? (
                    <>
                      <div className="flex flex-wrap gap-1">
                        {QUICK_PERCENTS.map((p) => (
                          <button
                            key={p}
                            type="button"
                            onClick={() => setDiscountPercent(String(p))}
                            className={cn(
                              "rounded-md border px-2 py-0.5 text-[11px]",
                              Number(discountPercent) === p
                                ? "border-purple-600 bg-purple-50 text-purple-700 dark:bg-purple-950 dark:text-purple-400"
                                : "border-input text-muted-foreground hover:bg-muted",
                            )}
                          >
                            {p}%
                          </button>
                        ))}
                      </div>
                      <Input
                        type="number"
                        min={0}
                        max={100}
                        value={discountPercent}
                        onChange={(e) => setDiscountPercent(e.target.value)}
                        placeholder="Custom %"
                        className="w-32"
                      />
                    </>
                  ) : (
                    <Input
                      type="number"
                      min={0}
                      value={discountAmount}
                      onChange={(e) => setDiscountAmount(e.target.value)}
                      placeholder="₹ amount"
                      className="w-32"
                    />
                  )}
                  <div className="flex flex-wrap gap-1">
                    {DISCOUNT_REASONS.map((r) => (
                      <button
                        key={r}
                        type="button"
                        onClick={() => setDiscountReason(r)}
                        className={cn(
                          "rounded-md border px-2 py-0.5 text-[11px]",
                          discountReason === r
                            ? "border-brand-green bg-brand-green/10 text-brand-green"
                            : "border-input text-muted-foreground hover:bg-muted",
                        )}
                      >
                        {r}
                      </button>
                    ))}
                  </div>
                  {discountReason === "Other" && (
                    <Input
                      value={customReason}
                      onChange={(e) => setCustomReason(e.target.value)}
                      placeholder="Reason..."
                    />
                  )}
                </div>
              </div>
            )}

            {/* Pricing summary */}
            {selectedUnits.length > 0 && (
              <div className="rounded-lg border border-border bg-muted/30 p-3">
                <div className="space-y-1 text-xs">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">
                      {formatCurrency(nightlyRate)} x {nights} night{nights !== 1 ? "s" : ""} · {selectedUnits.length} unit{selectedUnits.length !== 1 ? "s" : ""} · {validPersonCount ? personCount : "—"} guest{personCount !== 1 ? "s" : ""}
                    </span>
                    <span className="text-foreground">{formatCurrency(pricing.gross)}</span>
                  </div>
                  {pricing.discount > 0 && (
                    <div className="flex justify-between text-purple-700 dark:text-purple-400">
                      <span>
                        Discount
                        {discountMode === "percent" && discountPercent ? ` (${discountPercent}%)` : ""}
                      </span>
                      <span>-{formatCurrency(pricing.discount)}</span>
                    </div>
                  )}
                  {taxPercent > 0 && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Tax ({taxPercent}%)</span>
                      <span className="text-foreground">{formatCurrency(pricing.tax)}</span>
                    </div>
                  )}
                  <div className="flex justify-between border-t border-border pt-1 font-semibold">
                    <span className="text-foreground">Total</span>
                    <span className="text-foreground">{formatCurrency(pricing.total)}</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-border p-4">
          <Button variant="outline" size="sm" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleSubmit} disabled={!canSubmit || submitting}>
            {submitting && <Loader2Icon className="size-3.5 animate-spin" />}
            Create Booking
          </Button>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
