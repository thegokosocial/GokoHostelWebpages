"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { GuestRoom } from "@/lib/guestBookingSearch";
import { site } from "@/lib/site";
import { bookingTotals } from "@/lib/bookingPricing";
import { canAddGuestRoom } from "@/lib/guestBookingSelection";
import { resolveRoomGallery } from "@/content/rooms";
import { ImageCarousel } from "@/components/media/ImageCarousel";
import { DateRangePicker } from "@/components/dates/DateRangePicker";
import { todayIST } from "@/lib/utils";
import { CheckoutWaitOverlay, type CheckoutWaitPhase } from "@/components/booking/CheckoutWaitOverlay";
import {
  armUnpaidCheckoutAbandon, clearUnpaidCheckoutAbandon, bindUnpaidCheckoutPageHide,
  abandonUnpaidCheckoutBeacon,
} from "@/lib/guestCheckoutAbandonClient";

type BookingDetails = { reference: string | null; externalReference: string | null; guestName: string; checkinDate: string; checkoutDate: string; roomType: string; guests: number; status: string; paymentStatus: string | null; total: number | null; paid: number | null; refunded: number | null };
const field = "mt-1 min-h-12 w-full min-w-0 max-w-full rounded-lg border border-brand-green/25 bg-white px-3 py-3 text-base text-brand-green-dark focus:outline-none focus:ring-2 focus:ring-brand-green";
const action = "min-h-12 rounded-lg bg-brand-red px-4 py-3 font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green focus-visible:ring-offset-2 disabled:opacity-50";
const money = (rupees: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(rupees);
async function readResponse(response: Response) {
  const data = await response.json().catch(() => { throw new Error("Could not reach Goko. Please try again or contact us."); });
  if (!response.ok) throw new Error(data.error || "Please try again.");
  return data;
}

export function BookingHeroPanel({ preview }: { preview?: { stay: { checkinDate: string; checkoutDate: string } } }) {
  const panelRef = useRef<HTMLDivElement>(null), reviewRef = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);
  const [tab, setTab] = useState<"search" | "booking">("search");
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const [checkoutWait, setCheckoutWait] = useState<CheckoutWaitPhase | null>(null);
  const [rooms, setRooms] = useState<GuestRoom[] | null>(null);
  const [selection, setSelection] = useState<Record<string, number>>({});
  const [plans, setPlans] = useState<Record<string, number>>({});
  const [review, setReview] = useState(false);
  const [taxPercent, setTaxPercent] = useState<number | null>(null);
  const [maxSelectedBeds, setMaxSelectedBeds] = useState<number | null>(null);
  const [guest, setGuest] = useState({ name: "", email: "", phone: "" });
  const [stay, setStay] = useState(preview?.stay ?? { checkinDate: "", checkoutDate: "" });
  const [searchedStay, setSearchedStay] = useState<typeof stay | null>(null);
  const [reference, setReference] = useState(""), [email, setEmail] = useState("");
  const [challengeId, setChallengeId] = useState(""), [code, setCode] = useState("");
  const [booking, setBooking] = useState<BookingDetails | null>(null);
  const [manageUrl, setManageUrl] = useState("");
  const [nativeCheckoutReady, setNativeCheckoutReady] = useState(false);
  const [paymentOptions, setPaymentOptions] = useState<{
    advancePercent: number; allowFullPayment: boolean; allowPayAtProperty: boolean; gatewayEnvironment?: "test" | "live";
    requireLookupOtp?: boolean;
  } | null>(null);
  const [requireLookupOtp, setRequireLookupOtp] = useState(true);
  const [paymentChoice, setPaymentChoice] = useState<"advance" | "full" | "property">("advance");
  const [holdExpiresAt, setHoldExpiresAt] = useState<number | null>(null);
  const [checkoutRequestKey, setCheckoutRequestKey] = useState<string | null>(null);
  const [nowTick, setNowTick] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    if (!holdExpiresAt) return;
    const id = window.setInterval(() => setNowTick(Math.floor(Date.now() / 1000)), 1000);
    return () => window.clearInterval(id);
  }, [holdExpiresAt]);
  useEffect(() => bindUnpaidCheckoutPageHide(), []);
  useEffect(() => {
    if (!panelRef.current || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting));
    observer.observe(panelRef.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!review) return;
    reviewRef.current?.focus({ preventScroll: true });
    reviewRef.current?.scrollIntoView({ block: "start", behavior: "auto" });
  }, [review]);
  useEffect(() => {
    let active = true;
    fetch("/api/booking/config", { cache: "no-store", signal: AbortSignal.timeout(15000) })
      .then((res) => res.json())
      .then((data) => {
        if (!active) return;
        if (typeof data.requireLookupOtp === "boolean") setRequireLookupOtp(data.requireLookupOtp);
        else if (typeof data.paymentOptions?.requireLookupOtp === "boolean") {
          setRequireLookupOtp(data.paymentOptions.requireLookupOtp);
        }
      })
      .catch(() => { /* keep default OTP-on */ });
    return () => { active = false; };
  }, []);
  const stayReady = Boolean(stay.checkinDate && stay.checkoutDate && stay.checkoutDate > stay.checkinDate);
  async function search(event: FormEvent) {
    event.preventDefault();
    if (!stayReady) { setMessage("Choose your check-in and check-out dates."); return; }
    setBusy(true); setMessage(""); setRooms(null); setSelection({}); setPlans({}); setReview(false); setHoldExpiresAt(null); setCheckoutRequestKey(null);
    try {
      const data = await readResponse(await fetch(`/api/guest-booking/availability?${new URLSearchParams(stay)}`, { cache: "no-store", signal: AbortSignal.timeout(15000) }));
      setRooms(data.rooms); setTaxPercent(data.taxPercent); setMaxSelectedBeds(data.maxSelectedBeds); setSearchedStay({ ...stay });
      setNativeCheckoutReady(Boolean(data.nativeCheckoutReady));
      setPaymentOptions(data.paymentOptions || null);
      if (typeof data.paymentOptions?.requireLookupOtp === "boolean") setRequireLookupOtp(data.paymentOptions.requireLookupOtp);
      const choice = data.paymentOptions?.allowFullPayment ? "full"
        : data.paymentOptions?.advancePercent > 0 ? "advance"
        : data.paymentOptions?.allowPayAtProperty ? "property" : "advance";
      setPaymentChoice(choice);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not search. Try WhatsApp."); }
    finally { setBusy(false); }
  }
  async function lookup(event: FormEvent) {
    event.preventDefault(); setBusy(true); setMessage(""); setBooking(null); setManageUrl("");
    try {
      if (preview) { setMessage("Demo only. Booking lookup and email sending are disabled in this preview."); return; }
      const data = await readResponse(await fetch("/api/guest-booking/lookup", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(challengeId ? { action: "verify", challengeId, code } : { action: "request", reference, email }), cache: "no-store", signal: AbortSignal.timeout(15000) }));
      if (data.booking) {
        setBooking(data.booking); setCode(""); setChallengeId("");
        if (data.guestAccessToken) {
          const ref = data.booking.reference || data.booking.externalReference;
          if (ref) {
            sessionStorage.setItem(`goko_booking_${ref}`, JSON.stringify({ guestAccessToken: data.guestAccessToken }));
            const href = typeof data.manageUrl === "string" && data.manageUrl.startsWith("/booking/")
              ? data.manageUrl
              : `/booking/${encodeURIComponent(ref)}`;
            setManageUrl(href);
            window.location.assign(href);
            return;
          }
        }
      }
      else if (data.challengeId) { setChallengeId(data.challengeId); setMessage(data.message); }
      else { setMessage(data.message || "Could not find that booking."); }
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not retrieve your booking."); }
    finally { setBusy(false); }
  }
  const selectedCount = rooms?.reduce((sum, room) => sum + (selection[room.id] || 0), 0) || 0;
  const capacity = rooms?.reduce((sum, room) => sum + (selection[room.id] || 0) * room.capacity, 0) || 0;
  const chosenRate = (room: GuestRoom) => room.rates?.find(rate => rate.id === plans[room.id]) ?? room.rates?.[0];
  const subtotal = rooms?.reduce((sum, room) => sum + (selection[room.id] || 0) * (chosenRate(room)?.subtotalRupees || 0), 0) || 0;
  const totals = taxPercent == null ? null : bookingTotals(subtotal, { taxPercent });
  const ready = !!searchedStay && maxSelectedBeds != null && selectedCount > 0 && selectedCount <= maxSelectedBeds && !!rooms?.every(room => !selection[room.id] || (selection[room.id] <= room.availableUnits && !!chosenRate(room)));
  function addRoom(room: GuestRoom, planId: number) {
    setSelection(current => canAddGuestRoom(rooms || [], current, room, maxSelectedBeds ?? 0) ? { ...current, [room.id]: (current[room.id] || 0) + 1 } : current);
    setPlans(current => ({ ...current, [room.id]: planId })); setReview(false);
  }
  function loadRazorpay(): Promise<void> {
    if (typeof window !== "undefined" && (window as unknown as { Razorpay?: unknown }).Razorpay) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://checkout.razorpay.com/v1/checkout.js";
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("Could not load payment checkout"));
      document.body.appendChild(script);
    });
  }
  async function openRazorpay(checkoutId: string, ownerToken: string, options: { key: string; order_id: string; amount: number; currency: string }, guestAccessToken: string, ref: string) {
    setCheckoutWait("awaiting_payment");
    armUnpaidCheckoutAbandon({ checkoutId, ownerToken });
    await loadRazorpay();
    const claimed = await readResponse(await fetch("/api/guest-booking/checkout", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "claim", checkoutId, ownerToken }),
      cache: "no-store", signal: AbortSignal.timeout(15000),
    }));
    const checkout = claimed.checkout || options;
    await new Promise<void>((resolve, reject) => {
      const rzp = new (window as unknown as { Razorpay: new (o: Record<string, unknown>) => { open: () => void; on: (e: string, fn: (r: { error?: { description?: string } }) => void) => void } }).Razorpay({
        key: checkout.key, amount: checkout.amount, currency: checkout.currency, order_id: checkout.order_id,
        name: site.shortName, description: "Goko Hostel booking",
        prefill: { name: guest.name, email: guest.email, contact: guest.phone },
        handler: async (response: { razorpay_payment_id: string; razorpay_order_id: string; razorpay_signature: string }) => {
          try {
            setCheckoutWait("confirming");
            const verified = await readResponse(await fetch("/api/guest-booking/payment/verify", {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                checkoutId, ownerToken,
                paymentId: response.razorpay_payment_id, orderId: response.razorpay_order_id, signature: response.razorpay_signature,
              }),
              cache: "no-store", signal: AbortSignal.timeout(20000),
            }));
            clearUnpaidCheckoutAbandon();
            setCheckoutWait("finishing");
            sessionStorage.setItem(`goko_booking_${ref}`, JSON.stringify({ guestAccessToken }));
            window.location.href = `/booking/${encodeURIComponent(verified.reference || ref)}`;
            resolve();
          } catch (error) { reject(error); }
        },
        modal: { ondismiss: async () => {
          try {
            await fetch("/api/guest-booking/abandon", {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ checkoutId, ownerToken }), cache: "no-store",
            });
          } catch { /* ignore */ }
          clearUnpaidCheckoutAbandon();
          reject(new Error("Payment window closed. If money was deducted, wait a moment and check My booking."));
        } },
        theme: { color: "#1B4D3E" },
        retry: { enabled: false },
        config: { display: { blocks: {}, hide: [], sequence: ["block.card", "block.upi", "block.netbanking", "block.wallet"], preferences: { show_default_blocks: true } } },
      });
      rzp.on("payment.failed", async () => {
        try {
          await fetch("/api/guest-booking/abandon", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ checkoutId, ownerToken }), cache: "no-store",
          });
        } catch { /* ignore */ }
        clearUnpaidCheckoutAbandon();
      });
      rzp.open();
    });
  }
  async function confirmStay() {
    if (preview) { setMessage("Demo only. Checkout is disabled in this preview."); return; }
    if (!guest.name.trim() || !guest.email.trim() || !guest.phone.trim()) {
      setMessage("Enter guest name, email and phone to continue.");
      return;
    }
    if (holdExpiresAt != null && holdExpiresAt <= Math.floor(Date.now() / 1000)) {
      setMessage("Your temporary hold expired. Recheck availability to continue.");
      return;
    }
    if (!searchedStay || !rooms) return;
    setBusy(true); setMessage(""); setCheckoutWait("preparing");
    try {
      const requestKey = checkoutRequestKey || crypto.randomUUID();
      if (!checkoutRequestKey) setCheckoutRequestKey(requestKey);
      const payload = {
        requestKey,
        checkinDate: searchedStay.checkinDate, checkoutDate: searchedStay.checkoutDate,
        paymentChoice, guest,
        rooms: rooms.filter((room) => selection[room.id]).map((room) => ({
          roomId: room.id, quantity: selection[room.id], ratePlanId: chosenRate(room)!.id,
        })),
      };
      const data = await readResponse(await fetch("/api/guest-booking/checkout", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload), cache: "no-store", signal: AbortSignal.timeout(30000),
      }));
      if (data.holdExpiresAt) setHoldExpiresAt(data.holdExpiresAt);
      if (data.guestAccessToken && data.reference) {
        sessionStorage.setItem(`goko_booking_${data.reference}`, JSON.stringify({
          guestAccessToken: data.guestAccessToken,
        }));
      }
      if (data.requiresPayment && data.razorpay && data.ownerToken && data.checkoutId) {
        await openRazorpay(data.checkoutId, data.ownerToken, data.razorpay, data.guestAccessToken, data.reference);
      } else if (data.reference) {
        clearUnpaidCheckoutAbandon();
        setCheckoutWait("finishing");
        window.location.href = `/booking/${encodeURIComponent(data.reference)}`;
      } else {
        clearUnpaidCheckoutAbandon();
        setCheckoutWait(null);
        setMessage("Booking prepared. Check My booking if confirmation did not open.");
      }
    } catch (error) {
      // Release unpaid hold if we armed a session (claim/script failure, verify error, dismiss race).
      abandonUnpaidCheckoutBeacon();
      setCheckoutWait(null);
      const text = error instanceof Error ? error.message : "Could not complete booking.";
      setMessage(text);
      if (/hold|expired|reserved|unavailable|conflict/i.test(text)) {
        setHoldExpiresAt((current) => current ?? Math.floor(Date.now() / 1000));
      }
    }
    finally {
      setBusy(false);
      setCheckoutWait((current) => (current === "finishing" ? current : null));
    }
  }
  async function recheckPaymentReadiness() {
    if (preview) { setMessage("Demo only. Readiness checks are disabled in this preview."); return; }
    setBusy(true); setMessage("");
    try {
      const data = await readResponse(await fetch("/api/booking/config", {
        cache: "no-store", signal: AbortSignal.timeout(15000),
      }));
      setNativeCheckoutReady(Boolean(data.nativeCheckoutReady));
      setPaymentOptions(data.paymentOptions || null);
      if (data.nativeCheckoutReady) {
        const choice = data.paymentOptions?.allowFullPayment ? "full"
          : data.paymentOptions?.advancePercent > 0 ? "advance"
          : data.paymentOptions?.allowPayAtProperty ? "property" : "advance";
        setPaymentChoice(choice);
        setMessage("Checkout is ready. Choose a payment option and continue.");
      } else {
        setMessage("Online payment is still unavailable. Try again shortly or contact Goko.");
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not recheck payment readiness.");
    } finally { setBusy(false); }
  }
  async function recheckAvailability() {
    if (!searchedStay) return;
    setHoldExpiresAt(null);
    setCheckoutRequestKey(null);
    setBusy(true); setMessage(""); setRooms(null); setSelection({}); setPlans({}); setReview(false);
    try {
      const data = await readResponse(await fetch(`/api/guest-booking/availability?${new URLSearchParams(searchedStay)}`, {
        cache: "no-store", signal: AbortSignal.timeout(15000),
      }));
      setRooms(data.rooms); setTaxPercent(data.taxPercent); setMaxSelectedBeds(data.maxSelectedBeds);
      setSearchedStay({ ...searchedStay });
      setNativeCheckoutReady(Boolean(data.nativeCheckoutReady));
      setPaymentOptions(data.paymentOptions || null);
      if (typeof data.paymentOptions?.requireLookupOtp === "boolean") setRequireLookupOtp(data.paymentOptions.requireLookupOtp);
      const choice = data.paymentOptions?.allowFullPayment ? "full"
        : data.paymentOptions?.advancePercent > 0 ? "advance"
        : data.paymentOptions?.allowPayAtProperty ? "property" : "advance";
      setPaymentChoice(choice);
      setMessage(data.rooms?.length
        ? "Availability refreshed. Select beds again to continue."
        : "No online beds are available for these dates. Try different dates or contact us.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not recheck availability.");
    } finally { setBusy(false); }
  }
  const enquiry = searchedStay ? `Hi Goko, please confirm availability and rates for ${searchedStay.checkinDate} to ${searchedStay.checkoutDate}. Selection: ${rooms?.filter(room => selection[room.id]).map(room => `${selection[room.id]} × ${room.name} (${room.type === "Double" ? "double bed" : "dorm bed"})`).join(", ")}. Capacity up to ${capacity} guests; please confirm actual guest count with me.` : "";
  const holdSecondsLeft = holdExpiresAt ? Math.max(0, holdExpiresAt - nowTick) : null;
  const holdExpired = holdExpiresAt != null && holdSecondsLeft === 0;
  const guestDetailsComplete = Boolean(guest.name.trim() && guest.email.trim() && guest.phone.trim());
  return <>
  <CheckoutWaitOverlay phase={checkoutWait} />
  <div ref={panelRef} data-booking-in-view={inView} className="min-w-0 rounded-2xl bg-white p-4 text-brand-green-dark shadow-2xl sm:p-5 md:p-7">
    {preview && <p className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm font-semibold text-amber-900">Design preview — availability, rates, tax and bed limit are fetched from the connected backend. Estimates only; no email, reservation or payment can be made.</p>}
    <div className="mb-5 grid grid-cols-2 gap-2 sm:flex" role="tablist" aria-label="Booking options">
      {(["search", "booking"] as const).map(value => <button key={value} id={`tab-${value}`} type="button" role="tab" aria-selected={tab === value} aria-controls={`panel-${value}`} disabled={busy} onClick={() => { setTab(value); setMessage(""); }} className={`rounded-lg px-4 py-3 font-semibold ${tab === value ? "bg-brand-green text-white" : "bg-brand-sand text-brand-green-dark"}`}>{value === "search" ? "Find a stay" : "My booking"}</button>)}
    </div>
    {tab === "search" ? <div role="tabpanel" id="panel-search" aria-labelledby="tab-search">
      <h2 className="font-display text-2xl font-bold">Find your bed by the beach</h2>
      <form onSubmit={search} className="mt-5 grid grid-cols-2 items-end gap-3 lg:grid-cols-3">
        <label className="col-span-2 min-w-0 text-sm font-semibold lg:col-span-2">
          Dates
          <DateRangePicker
            className="mt-1"
            variant="marketing"
            required
            disabled={busy}
            minDate={todayIST()}
            maxNights={30}
            startDate={stay.checkinDate}
            endDate={stay.checkoutDate}
            onChange={({ startDate, endDate }) => {
              setStay({ checkinDate: startDate, checkoutDate: endDate });
              setRooms(null);
              setSelection({});
              setPlans({});
              setReview(false);
              setSearchedStay(null);
              setMessage("");
            }}
          />
        </label>
        <button className={`${action} col-span-2 lg:col-span-1`} disabled={busy || !stayReady}>{busy ? "Checking…" : "Check availability"}</button>
      </form>
      {rooms && <div className="mt-6 border-t border-brand-mist pt-5">
        <h3 className="font-semibold">Available for {searchedStay?.checkinDate} – {searchedStay?.checkoutDate}</h3>
        {rooms.length === 0 ? <p className="mt-3">No online beds are available for these dates. Try different dates or contact us.</p> : <>
          <div className="mt-4 grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_280px]">
          <div className="min-w-0 space-y-4">{rooms.map(room => {
            const photos = resolveRoomGallery(room.name);
            const quantity = selection[room.id] || 0;
            const canAdd = canAddGuestRoom(rooms, selection, room, maxSelectedBeds ?? 0);
            return <article key={room.id} className="min-w-0 overflow-hidden rounded-2xl border border-brand-green/20 bg-white p-3 shadow-sm sm:p-4 xl:grid xl:grid-cols-[130px_minmax(0,1fr)_210px] xl:gap-4">
              <div className="grid min-w-0 gap-4 sm:grid-cols-[150px_minmax(0,1fr)] xl:contents">
                <div className="min-w-0">
                  {photos.length ? (
                    <ImageCarousel
                      images={[...photos]}
                      controls="overlay"
                      alt={`${room.name} — representative dorm photos`}
                      className="[&_img]:h-[180px] sm:[&_img]:h-[150px]"
                    />
                  ) : (
                    <div className="flex h-[150px] items-center justify-center rounded-xl bg-brand-sand p-4 text-center text-sm">Room photos coming soon</div>
                  )}
                  {photos.length > 0 && <p className="mt-1 text-center text-[11px] text-brand-green">Representative dorm photos</p>}
                </div>
                <div className="min-w-0">
                  <h4 className="text-lg font-bold leading-snug">{room.name}</h4>
                  <p className="mt-1 text-sm">{room.type === "Double" ? "Double bed in a shared dorm" : "Single bed in a shared dorm"}</p>
                  <div className="mt-3 flex flex-wrap gap-2 text-xs font-semibold"><span className="rounded-full bg-brand-sand px-3 py-2">Sleeps {room.capacity} per bed</span><span className="rounded-full bg-brand-green/10 px-3 py-2">{room.availableUnits} beds available</span></div>
                  <p className="mt-3 text-xs leading-relaxed text-brand-green">Non-AC · Individual fan · Locker · Charging point</p>
                  <p className="mt-3 text-xs">Nightly prices and stay totals are per {room.type === "Double" ? "whole double bed" : "single bed"}. Taxes shown in your summary.</p>
                </div>
              </div>
              <div className="mt-4 min-w-0 divide-y divide-brand-mist border-t border-brand-mist xl:mt-0 xl:border-t-0">{room.rates?.length ? room.rates.map(rate => {
                const active = quantity > 0 && chosenRate(room)?.id === rate.id;
                return <div key={rate.id} className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-4">
                  <div className="min-w-0"><p className="text-xl font-bold">{rate.nightlyRates.some(night => night.rupees !== rate.nightlyRates[0]?.rupees) ? "From " : ""}{money(Math.min(...rate.nightlyRates.map(night => night.rupees)))} <span className="text-xs font-normal">/ bed / night</span></p><p className="mt-1 break-words text-sm">{rate.name}</p><p className="mt-1 text-xs">{money(rate.subtotalRupees)} per bed for {rate.nightlyRates.length} nights · Before taxes</p></div>
                  {active ? <div className="flex items-center gap-1 rounded-xl border border-brand-green/30"><button type="button" className="min-h-12 min-w-12 text-xl" aria-label={`Remove ${room.name}`} onClick={() => { setSelection(current => ({ ...current, [room.id]: Math.max(0, (current[room.id] || 0) - 1) })); setReview(false); }}>−</button><span className="min-w-4 text-center font-bold" aria-label={`${quantity} selected`}>{quantity}</span><button type="button" className="min-h-12 min-w-12 text-xl disabled:opacity-30" aria-label={`Add ${room.name} ${rate.name}`} disabled={!canAdd} onClick={() => addRoom(room, rate.id)}>+</button></div>
                    : <button type="button" className="min-h-12 rounded-xl border-2 border-brand-green px-3 font-semibold disabled:opacity-40" disabled={!quantity && !canAdd} aria-label={`${quantity ? "Switch rate for" : "Add"} ${room.name} ${rate.name}`} onClick={() => { if (quantity) { setPlans(current => ({ ...current, [room.id]: rate.id })); setReview(false); } else addRoom(room, rate.id); }}>{quantity ? "Switch rate" : "+ Add"}</button>}
                  <details className="col-span-2 text-xs"><summary className="min-h-12 cursor-pointer py-3">Nightly price breakdown</summary><ul className="space-y-1">{rate.nightlyRates.map(night => <li key={night.date} className="flex justify-between gap-2"><span>{night.date}</span><span>{money(night.rupees)}</span></li>)}</ul></details>
                </div>;
              }) : <p className="py-4 text-sm">No eligible online rate for these dates. Contact us to check the price and stay restrictions.</p>}</div>
            </article>;
          })}</div>
          <aside data-booking-summary className="sticky bottom-[max(0.5rem,env(safe-area-inset-bottom))] z-10 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-2xl bg-brand-green-dark p-3 text-white shadow-lg xl:top-24 xl:bottom-auto xl:grid-cols-1 xl:p-5">
            <p className="hidden border-b border-white/20 pb-3 text-xs xl:block">{searchedStay?.checkinDate} – {searchedStay?.checkoutDate}</p>
            <div className="min-w-0"><p className="text-xs sm:text-sm">Your stay estimate</p><p className="mt-1 break-words text-2xl font-semibold sm:text-3xl">{selectedCount ? money(totals?.total ?? subtotal) : "Choose beds"}</p></div>
            <button type="button" className={`${action} max-w-36 text-sm sm:max-w-none sm:text-base`} disabled={!ready} onClick={() => setReview(true)}>Review your stay</button>
            <p className="col-span-2 text-xs xl:col-span-1">{selectedCount} {selectedCount === 1 ? "bed" : "beds"} selected · Sleeps up to {capacity}.</p>
            {selectedCount === maxSelectedBeds && maxSelectedBeds != null ? (
              <p role="status" className="col-span-2 text-xs xl:col-span-1">
                Maximum {maxSelectedBeds} beds reached. Remove a bed before adding another.
              </p>
            ) : null}
            {selectedCount && totals ? (
              <p className="col-span-2 text-xs xl:col-span-1">
                Beds {money(subtotal)} + tax ({taxPercent}%) {money(totals.tax)}.
              </p>
            ) : null}
            {nativeCheckoutReady ? (
              <p className="hidden text-xs text-white/80 xl:block">Secure checkout ready — review your stay to book.</p>
            ) : null}
          </aside>
          </div>
          {review && ready && <div ref={reviewRef} tabIndex={-1} className="mt-5 scroll-mt-24 rounded-xl border border-brand-mist p-4 focus:outline-none focus:ring-2 focus:ring-brand-green sm:p-5">
            <h3 className="font-display text-2xl font-bold">Your Goko stay</h3>
            <p className="mt-2">{searchedStay?.checkinDate} – {searchedStay?.checkoutDate} · {selectedCount} {selectedCount === 1 ? "bed" : "beds"} · Sleeps up to {capacity}</p>
            <ul className="mt-3 space-y-2 text-sm">{rooms.filter(room => selection[room.id]).map(room => <li key={room.id}>{selection[room.id]} × {room.name} · {chosenRate(room)?.name} · {money(selection[room.id] * chosenRate(room)!.subtotalRupees)}</li>)}</ul>
            {totals && <dl className="mt-4 space-y-2 border-t border-brand-mist pt-3 text-sm"><div className="flex justify-between"><dt>Bed subtotal</dt><dd>{money(totals.beforeTax)}</dd></div><div className="flex justify-between"><dt>Estimated tax ({taxPercent}%)</dt><dd>{money(totals.tax)}</dd></div><div className="flex justify-between text-lg font-semibold"><dt>Estimated total</dt><dd>{money(totals.total)}</dd></div></dl>}
            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              <label className="text-sm">Guest name <span className="text-brand-red" aria-hidden="true">*</span><input className={field} required autoComplete="name" maxLength={120} value={guest.name} onChange={e => setGuest(current => ({ ...current, name: e.target.value }))} /></label>
              <label className="text-sm">Email <span className="text-brand-red" aria-hidden="true">*</span><input className={field} required type="email" autoComplete="email" maxLength={254} value={guest.email} onChange={e => setGuest(current => ({ ...current, email: e.target.value }))} /></label>
              <label className="text-sm">Phone <span className="text-brand-red" aria-hidden="true">*</span><input className={field} required type="tel" autoComplete="tel" maxLength={30} value={guest.phone} onChange={e => setGuest(current => ({ ...current, phone: e.target.value }))} /></label>
            </div>
            {nativeCheckoutReady && paymentOptions ? <>
              {holdExpired ? (
                <div className="mt-5 space-y-3">
                  <div className="rounded-lg bg-brand-sand p-4 text-sm" role="status">
                    <strong>Your temporary hold expired.</strong>
                    <p className="mt-1">Beds were released so others can book. Recheck availability for the same dates, then select beds again.</p>
                  </div>
                  <button type="button" className={action} disabled={busy} onClick={recheckAvailability}>
                    {busy ? "Please wait…" : "Recheck availability"}
                  </button>
                </div>
              ) : (
                <>
              <fieldset className="mt-5 space-y-2 text-sm">
                <legend className="font-semibold">Payment</legend>
                {paymentOptions.advancePercent > 0 && (
                  <label className="flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border border-brand-mist px-3 py-2 has-[:checked]:border-brand-green has-[:checked]:bg-brand-green/5">
                    <input type="radio" name="pay" className="size-4 shrink-0 accent-brand-green" checked={paymentChoice === "advance"} onChange={() => setPaymentChoice("advance")} />
                    <span>Pay {paymentOptions.advancePercent}% advance now</span>
                  </label>
                )}
                {paymentOptions.allowFullPayment && (
                  <label className="flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border border-brand-mist px-3 py-2 has-[:checked]:border-brand-green has-[:checked]:bg-brand-green/5">
                    <input type="radio" name="pay" className="size-4 shrink-0 accent-brand-green" checked={paymentChoice === "full"} onChange={() => setPaymentChoice("full")} />
                    <span>Pay full amount now</span>
                  </label>
                )}
                {paymentOptions.allowPayAtProperty && (
                  <label className="flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border border-brand-mist px-3 py-2 has-[:checked]:border-brand-green has-[:checked]:bg-brand-green/5">
                    <input type="radio" name="pay" className="size-4 shrink-0 accent-brand-green" checked={paymentChoice === "property"} onChange={() => setPaymentChoice("property")} />
                    <span>Reserve now, pay at property</span>
                  </label>
                )}
              </fieldset>
              {holdSecondsLeft != null && <p className="mt-3 text-xs" role="status">Hold expires in {Math.floor(holdSecondsLeft / 60)}:{String(holdSecondsLeft % 60).padStart(2, "0")}</p>}
              {!guestDetailsComplete && (
                <p role="status" className="mt-4 text-sm text-brand-red">
                  Fill in guest name, email and phone to enable Pay now. Mandatory fields are marked with *.
                </p>
              )}
              <div className="mt-4">
                <button type="button" className={action} disabled={busy || !guestDetailsComplete || !!checkoutWait} onClick={confirmStay}>
                  {checkoutWait === "preparing" || checkoutWait === "confirming" || checkoutWait === "finishing"
                    ? "Please wait…"
                    : checkoutWait === "awaiting_payment"
                      ? "Payment in progress…"
                      : paymentChoice === "property" ? "Confirm reservation" : "Pay now"}
                </button>
              </div>
              <p className="mt-3 text-xs">
                {paymentOptions.gatewayEnvironment === "live"
                  ? "Live payments — real money. Card, UPI, netbanking and wallets via Razorpay Checkout."
                  : "Test-mode payments only. Card, UPI, netbanking and wallets are available in Razorpay Checkout."}
              </p>
                </>
              )}
            </> : <>
              <p className="mt-3 text-xs">These details stay in this page only until online checkout is ready.</p>
              <div className="mt-5 rounded-lg bg-brand-sand p-4 text-sm"><strong>Payment is currently disabled.</strong><p>No money will be collected and no reservation is created here. Our team can confirm your selection and final tax-inclusive price.</p></div>
              <div className="mt-4 grid gap-3 sm:flex sm:flex-wrap">
                <button type="button" className={action} disabled>Payment unavailable</button>
                <button type="button" className="inline-flex min-h-12 items-center justify-center rounded-lg border border-brand-green px-5 py-3 text-center font-semibold disabled:opacity-50" disabled={busy || !!preview} onClick={recheckPaymentReadiness}>
                  {busy ? "Please wait…" : "Recheck payment readiness"}
                </button>
                {!preview && <a className="inline-flex min-h-12 items-center justify-center rounded-lg border border-brand-mist px-5 py-3 text-center font-semibold" href={`${site.whatsAppUrl}?text=${encodeURIComponent(enquiry)}`} target="_blank" rel="noopener noreferrer">Ask Goko to confirm this stay</a>}
              </div>
            </>}
          </div>}
        </>}
      </div>}
    </div> : <div role="tabpanel" id="panel-booking" aria-labelledby="tab-booking">
      <h2 className="font-display text-2xl font-bold">Find your booking</h2>
      <p className="mt-1 text-sm">
        {requireLookupOtp
          ? "Enter your confirmation number and the email used for your booking. We’ll email a verification code from booking@gokohostel.com."
          : "Enter your confirmation number and the email used for your booking to open it."}
      </p>
      <form onSubmit={lookup} className="mt-5 grid items-end gap-3 md:grid-cols-3">
        {!challengeId ? <><label className="text-sm font-semibold">Confirmation number<input className={field} required maxLength={120} disabled={busy} autoComplete="off" value={reference} onChange={e => setReference(e.target.value)} /></label><label className="text-sm font-semibold">Booking email<input className={field} required type="email" maxLength={254} disabled={busy} autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} /></label></> : <label className="text-sm font-semibold md:col-span-2">Email verification code<input className={field} required inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} disabled={busy} value={code} onChange={e => setCode(e.target.value)} /></label>}
        <button className={action} disabled={busy}>{busy ? "Please wait…" : challengeId ? "View booking" : requireLookupOtp ? "Send verification code" : "Find booking"}</button>
      </form>
      {challengeId && <button type="button" disabled={busy} className="mt-3 min-h-12 text-left text-sm underline" onClick={() => { setChallengeId(""); setCode(""); setMessage(""); }}>Change details / request again after 10 minutes</button>}
      {booking && <div className="mt-5 rounded-xl bg-brand-sand p-5">
        <h3 className="font-semibold">Booking {booking.reference || booking.externalReference}</h3>
        <p>{booking.guestName} · {booking.guests} guests · {booking.roomType}</p>
        <p>{booking.checkinDate} – {booking.checkoutDate}</p><p>Status: {booking.status} · Payment: {booking.paymentStatus || "Awaiting update"}</p>
        <p>Total: {booking.total == null ? "Not recorded" : money(booking.total)} · Paid: {booking.paid == null ? "Not recorded" : money(booking.paid)} · Refunded: {booking.refunded == null ? "Not recorded" : money(booking.refunded)}</p>
        {manageUrl && <a className={`${action} mt-4 inline-flex items-center justify-center`} href={manageUrl}>Manage booking</a>}
      </div>}
    </div>}
    <p role="status" aria-live="polite" className="mt-4 break-words text-sm">{message}</p>
    <div className="mt-3 grid gap-2 border-t border-brand-mist pt-3 text-sm sm:flex sm:flex-wrap sm:gap-4"><a className="inline-flex min-h-12 items-center font-semibold underline" href="/booking-enquiry">Need help? Send an enquiry</a><a className="inline-flex min-h-12 items-center font-semibold underline" href={site.whatsAppUrl} target="_blank" rel="noopener noreferrer">Contact Goko</a></div>
  </div>
  </>;
}
