"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { GuestRoom } from "@/lib/guestBookingSearch";
import { site } from "@/lib/site";
import { bookingTotals } from "@/lib/bookingPricing";
import { canAddGuestRoom } from "@/lib/guestBookingSelection";
import { homeRooms } from "@/content/home";
import { ImageCarousel } from "@/components/media/ImageCarousel";

type BookingDetails = { reference: string | null; externalReference: string | null; guestName: string; checkinDate: string; checkoutDate: string; roomType: string; guests: number; status: string; paymentStatus: string | null; total: number | null; paid: number | null; refunded: number | null };
const field = "mt-1 min-h-12 w-full min-w-0 max-w-full rounded-lg border border-brand-green/25 bg-white px-3 py-3 text-base text-brand-green-dark focus:outline-none focus:ring-2 focus:ring-brand-green";
const action = "min-h-12 rounded-lg bg-brand-red px-4 py-3 font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green focus-visible:ring-offset-2 disabled:opacity-50";
const money = (rupees: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(rupees);
async function readResponse(response: Response) {
  const data = await response.json().catch(() => { throw new Error("Could not reach Goko. Please try again or contact us."); });
  if (!response.ok) throw new Error(data.error || "Please try again.");
  return data;
}

export function BookingHeroPanel({ preview }: { preview?: { rooms: GuestRoom[]; taxPercent: number; stay: { checkinDate: string; checkoutDate: string; guests: string } } }) {
  const panelRef = useRef<HTMLDivElement>(null), reviewRef = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);
  const [tab, setTab] = useState<"search" | "booking">("search");
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const [rooms, setRooms] = useState<GuestRoom[] | null>(null);
  const [selection, setSelection] = useState<Record<string, number>>({});
  const [plans, setPlans] = useState<Record<string, number>>({});
  const [review, setReview] = useState(false);
  const [taxPercent, setTaxPercent] = useState<number | null>(preview?.taxPercent ?? null);
  const [guest, setGuest] = useState({ name: "", email: "", phone: "" });
  const [stay, setStay] = useState(preview?.stay ?? { checkinDate: "", checkoutDate: "", guests: "1" });
  const [searchedStay, setSearchedStay] = useState<typeof stay | null>(null);
  const [reference, setReference] = useState(""), [email, setEmail] = useState("");
  const [challengeId, setChallengeId] = useState(""), [code, setCode] = useState("");
  const [booking, setBooking] = useState<BookingDetails | null>(null);
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
  function changeStay(key: keyof typeof stay, value: string) {
    setStay(previous => ({ ...previous, [key]: value })); setRooms(null); setSelection({}); setPlans({}); setReview(false); setSearchedStay(null); setMessage("");
  }
  async function search(event: FormEvent) {
    event.preventDefault(); setBusy(true); setMessage(""); setRooms(null); setSelection({}); setPlans({}); setReview(false);
    try {
      if (preview) { const sampleStay = { ...preview.stay, guests: stay.guests }; setStay(sampleStay); setSearchedStay(sampleStay); setRooms(preview.rooms); setTaxPercent(preview.taxPercent); setMessage("Demo search: sample dates and prices, with your selected guest count. No live inventory or payments."); return; }
      const data = await readResponse(await fetch(`/api/guest-booking/availability?${new URLSearchParams(stay)}`, { cache: "no-store", signal: AbortSignal.timeout(15000) }));
      setRooms(data.rooms); setTaxPercent(data.taxPercent); setSearchedStay({ ...stay });
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not search. Try WhatsApp."); }
    finally { setBusy(false); }
  }
  async function lookup(event: FormEvent) {
    event.preventDefault(); setBusy(true); setMessage(""); setBooking(null);
    try {
      if (preview) { setMessage("Demo only. Booking lookup and email sending are disabled in this preview."); return; }
      const data = await readResponse(await fetch("/api/guest-booking/lookup", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(challengeId ? { action: "verify", challengeId, code } : { action: "request", reference, email }), cache: "no-store", signal: AbortSignal.timeout(15000) }));
      if (data.booking) { setBooking(data.booking); setCode(""); setChallengeId(""); }
      else { setChallengeId(data.challengeId); setMessage(data.message); }
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not retrieve your booking."); }
    finally { setBusy(false); }
  }
  const selectedCount = rooms?.reduce((sum, room) => sum + (selection[room.id] || 0), 0) || 0;
  const capacity = rooms?.reduce((sum, room) => sum + (selection[room.id] || 0) * room.capacity, 0) || 0;
  const chosenRate = (room: GuestRoom) => room.rates?.find(rate => rate.id === plans[room.id]) ?? room.rates?.[0];
  const subtotal = rooms?.reduce((sum, room) => sum + (selection[room.id] || 0) * (chosenRate(room)?.subtotalRupees || 0), 0) || 0;
  const totals = taxPercent == null ? null : bookingTotals(subtotal, { taxPercent });
  const ready = !!searchedStay && selectedCount > 0 && selectedCount <= Number(searchedStay.guests) && capacity >= Number(searchedStay.guests) && !!rooms?.every(room => !selection[room.id] || (selection[room.id] <= room.availableUnits && !!chosenRate(room)));
  function addRoom(room: GuestRoom, planId: number) {
    setSelection(current => canAddGuestRoom(rooms || [], current, room, Number(searchedStay?.guests)) ? { ...current, [room.id]: (current[room.id] || 0) + 1 } : current);
    setPlans(current => ({ ...current, [room.id]: planId })); setReview(false);
  }
  const enquiry = searchedStay ? `Hi Goko, please confirm availability and rates for ${searchedStay.checkinDate} to ${searchedStay.checkoutDate}, ${searchedStay.guests} guests. Selection: ${rooms?.filter(room => selection[room.id]).map(room => `${selection[room.id]} × ${room.name} (${room.type === "Double" ? "double bed" : "dorm bed"})`).join(", ")}.` : "";
  return <div ref={panelRef} data-booking-in-view={inView} className="min-w-0 rounded-2xl bg-white p-4 text-brand-green-dark shadow-2xl sm:p-5 md:p-7">
    {preview && <p className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm font-semibold text-amber-900">Design preview only — sample prices and availability, not a real booking offer. No email, reservation or payment can be made.</p>}
    <div className="mb-5 grid grid-cols-2 gap-2 sm:flex" role="tablist" aria-label="Booking options">
      {(["search", "booking"] as const).map(value => <button key={value} id={`tab-${value}`} type="button" role="tab" aria-selected={tab === value} aria-controls={`panel-${value}`} disabled={busy} onClick={() => { setTab(value); setMessage(""); }} className={`rounded-lg px-4 py-3 font-semibold ${tab === value ? "bg-brand-green text-white" : "bg-brand-sand text-brand-green-dark"}`}>{value === "search" ? "Find a stay" : "My booking"}</button>)}
    </div>
    {tab === "search" ? <div role="tabpanel" id="panel-search" aria-labelledby="tab-search">
      <h2 className="font-display text-2xl font-bold">Find your bed by the beach</h2>
      <p className="mt-1 text-sm">Choose your dates, compare our stays and make yourself at home. Dorm beds and double beds · No private rooms.</p>
      <form onSubmit={search} className="mt-5 grid grid-cols-2 items-end gap-3 lg:grid-cols-4">
        <label className="col-span-2 min-w-0 text-sm font-semibold min-[360px]:col-span-1">Check-in<input className={field} type="date" required disabled={busy} value={stay.checkinDate} onInput={e => changeStay("checkinDate", e.currentTarget.value)} onChange={e => changeStay("checkinDate", e.target.value)} /></label>
        <label className="col-span-2 min-w-0 text-sm font-semibold min-[360px]:col-span-1">Check-out<input className={field} type="date" required disabled={busy} min={stay.checkinDate || undefined} value={stay.checkoutDate} onInput={e => changeStay("checkoutDate", e.currentTarget.value)} onChange={e => changeStay("checkoutDate", e.target.value)} /></label>
        <label className="col-span-2 min-w-0 text-sm font-semibold lg:col-span-1">Guests<select className={field} disabled={busy} value={stay.guests} onChange={e => changeStay("guests", e.target.value)}>{[1, 2, 3, 4].map(n => <option key={n} value={n}>{n} {n === 1 ? "guest" : "guests"}</option>)}</select></label>
        <button className={`${action} col-span-2 lg:col-span-1`} disabled={busy}>{busy ? "Checking…" : "Check availability"}</button>
      </form>
      {rooms && <div className="mt-6 border-t border-brand-mist pt-5">
        <h3 className="font-semibold">Available for {searchedStay?.checkinDate} – {searchedStay?.checkoutDate}</h3>
        {rooms.length === 0 ? <p className="mt-3">No online beds are available for these dates. Try different dates or contact us.</p> : <>
          <div className="mt-4 grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_280px]">
          <div className="min-w-0 space-y-4">{rooms.map(room => {
            const categoryId = ["luxury", "female", "mixed"].find(id => room.name.toLowerCase().includes(id));
            const category = homeRooms.find(item => item.id === categoryId);
            const quantity = selection[room.id] || 0;
            const canAdd = canAddGuestRoom(rooms, selection, room, Number(searchedStay?.guests));
            return <article key={room.id} className="min-w-0 overflow-hidden rounded-2xl border border-brand-green/20 bg-white p-3 shadow-sm sm:p-4 xl:grid xl:grid-cols-[130px_minmax(0,1fr)_210px] xl:gap-4">
              <div className="grid min-w-0 gap-4 sm:grid-cols-[150px_minmax(0,1fr)] xl:contents">
                <div className="min-w-0">
                  {category ? <ImageCarousel images={category.images} alt={`${category.name} — representative dorm photos`} className="[&_img]:h-[180px] sm:[&_img]:h-[150px] [&_button]:min-h-12 [&_button]:min-w-12 [&_[role=tablist]]:hidden [&_div.mt-4]:mt-2" /> : <div className="flex h-[150px] items-center justify-center rounded-xl bg-brand-sand p-4 text-center text-sm">Room photos coming soon</div>}
                  {category && <p className="mt-1 text-center text-[11px] text-brand-green">Representative dorm photos</p>}
                </div>
                <div className="min-w-0">
                  <h4 className="text-lg font-bold leading-snug">{room.name}</h4>
                  <p className="mt-1 text-sm">{room.type === "Double" ? "Double bed in a shared dorm" : "Single bed in a shared dorm"}</p>
                  <div className="mt-3 flex flex-wrap gap-2 text-xs font-semibold"><span className="rounded-full bg-brand-sand px-3 py-2">Sleeps {room.capacity} per bed</span><span className="rounded-full bg-brand-green/10 px-3 py-2">{room.availableUnits} beds available</span></div>
                  <p className="mt-3 text-xs leading-relaxed text-brand-green">Non-AC · Individual fan · Locker · Charging point</p>
                  <p className="mt-3 text-xs">Prices below are per {room.type === "Double" ? "whole double bed" : "bed"}, for the entire stay. Taxes shown in your summary.</p>
                </div>
              </div>
              <div className="mt-4 min-w-0 divide-y divide-brand-mist border-t border-brand-mist xl:mt-0 xl:border-t-0">{room.rates?.length ? room.rates.map(rate => {
                const active = quantity > 0 && chosenRate(room)?.id === rate.id;
                return <div key={rate.id} className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-4">
                  <div className="min-w-0"><p className="text-xl font-bold">{money(rate.subtotalRupees)} <span className="text-xs font-normal">/ stay</span></p><p className="mt-1 break-words text-sm">{rate.name}</p><p className="mt-1 text-xs">{rate.nightlyRates.length} nights · Before taxes</p></div>
                  {active ? <div className="flex items-center gap-1 rounded-xl border border-brand-green/30"><button type="button" className="min-h-12 min-w-12 text-xl" aria-label={`Remove ${room.name}`} onClick={() => { setSelection(current => ({ ...current, [room.id]: Math.max(0, (current[room.id] || 0) - 1) })); setReview(false); }}>−</button><span className="min-w-4 text-center font-bold" aria-label={`${quantity} selected`}>{quantity}</span><button type="button" className="min-h-12 min-w-12 text-xl disabled:opacity-30" aria-label={`Add ${room.name} ${rate.name}`} disabled={!canAdd} onClick={() => addRoom(room, rate.id)}>+</button></div>
                    : <button type="button" className="min-h-12 rounded-xl border-2 border-brand-green px-3 font-semibold disabled:opacity-40" disabled={!quantity && !canAdd} aria-label={`${quantity ? "Switch rate for" : "Add"} ${room.name} ${rate.name}`} onClick={() => { if (quantity) { setPlans(current => ({ ...current, [room.id]: rate.id })); setReview(false); } else addRoom(room, rate.id); }}>{quantity ? "Switch rate" : "+ Add"}</button>}
                  <details className="col-span-2 text-xs"><summary className="min-h-12 cursor-pointer py-3">Nightly price breakdown</summary><ul className="space-y-1">{rate.nightlyRates.map(night => <li key={night.date} className="flex justify-between gap-2"><span>{night.date}</span><span>{money(night.rupees)}</span></li>)}</ul></details>
                </div>;
              }) : <p className="py-4 text-sm">No eligible online rate for these dates. Contact us to check the price and stay restrictions.</p>}</div>
            </article>;
          })}</div>
          <aside data-booking-summary className="sticky bottom-[max(0.5rem,env(safe-area-inset-bottom))] z-10 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-2xl bg-brand-green-dark p-3 text-white shadow-lg xl:top-24 xl:bottom-auto xl:grid-cols-1 xl:p-5">
            <p className="hidden border-b border-white/20 pb-3 text-xs xl:block">{searchedStay?.checkinDate} – {searchedStay?.checkoutDate} · {searchedStay?.guests} guests</p>
            <div className="min-w-0"><p className="text-xs sm:text-sm">Your stay estimate</p><p className="mt-1 break-words text-2xl font-semibold sm:text-3xl">{selectedCount ? money(totals?.total ?? subtotal) : "Choose beds"}</p></div>
            <button type="button" className={`${action} max-w-36 text-sm sm:max-w-none sm:text-base`} disabled={!ready} onClick={() => setReview(true)}>Review your stay</button>
            <p className="col-span-2 text-xs xl:col-span-1">{selectedCount} {selectedCount === 1 ? "bed" : "beds"} selected · Capacity {capacity} for {searchedStay?.guests} guests.</p>
            <p className="col-span-2 text-xs xl:col-span-1">{selectedCount && totals ? `Beds ${money(subtotal)} + tax (${taxPercent}%) ${money(totals.tax)}.` : "Select beds to see your total."} Availability is advisory; not reserved.</p>
            <p className="hidden text-xs text-white/80 xl:block">Payment remains disabled.</p>
          </aside>
          </div>
          {review && ready && <div ref={reviewRef} tabIndex={-1} className="mt-5 scroll-mt-24 rounded-xl border border-brand-mist p-4 focus:outline-none focus:ring-2 focus:ring-brand-green sm:p-5">
            <h3 className="font-display text-2xl font-bold">Your Goko stay</h3>
            <p className="mt-2">{searchedStay?.checkinDate} – {searchedStay?.checkoutDate} · {searchedStay?.guests} guests · {selectedCount} {selectedCount === 1 ? "bed" : "beds"}</p>
            <ul className="mt-3 space-y-2 text-sm">{rooms.filter(room => selection[room.id]).map(room => <li key={room.id}>{selection[room.id]} × {room.name} · {chosenRate(room)?.name} · {money(selection[room.id] * chosenRate(room)!.subtotalRupees)}</li>)}</ul>
            {totals && <dl className="mt-4 space-y-2 border-t border-brand-mist pt-3 text-sm"><div className="flex justify-between"><dt>Bed subtotal</dt><dd>{money(totals.beforeTax)}</dd></div><div className="flex justify-between"><dt>Estimated tax ({taxPercent}%)</dt><dd>{money(totals.tax)}</dd></div><div className="flex justify-between text-lg font-semibold"><dt>Estimated total</dt><dd>{money(totals.total)}</dd></div></dl>}
            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              <label className="text-sm">Guest name<input className={field} autoComplete="name" maxLength={120} value={guest.name} onChange={e => setGuest(current => ({ ...current, name: e.target.value }))} /></label>
              <label className="text-sm">Email<input className={field} type="email" autoComplete="email" maxLength={254} value={guest.email} onChange={e => setGuest(current => ({ ...current, email: e.target.value }))} /></label>
              <label className="text-sm">Phone<input className={field} type="tel" autoComplete="tel" maxLength={30} value={guest.phone} onChange={e => setGuest(current => ({ ...current, phone: e.target.value }))} /></label>
            </div>
            <p className="mt-3 text-xs">These details stay in this page only. They are not saved as a booking or included in the WhatsApp link.</p>
            <div className="mt-5 rounded-lg bg-brand-sand p-4 text-sm"><strong>Payment is currently disabled.</strong><p>No money will be collected and no reservation is created here. Our team can confirm your selection and final tax-inclusive price. Confirmation emails will be sent only after a booking is actually confirmed.</p></div>
            <div className="mt-4 grid gap-3 sm:flex sm:flex-wrap"><button type="button" className={action} disabled>Payment unavailable</button>{!preview && <a className="inline-flex min-h-12 items-center justify-center rounded-lg border border-brand-green px-5 py-3 text-center font-semibold" href={`${site.whatsAppUrl}?text=${encodeURIComponent(enquiry)}`} target="_blank" rel="noopener noreferrer">Ask Goko to confirm this stay</a>}</div>
          </div>}
        </>}
      </div>}
      <p className="mt-4 text-sm">Guests aged 18–35 only, up to 4 people. No children. Online checkout is not enabled yet; our team must confirm your stay.</p>
    </div> : <div role="tabpanel" id="panel-booking" aria-labelledby="tab-booking">
      <h2 className="font-display text-2xl font-bold">Find your booking</h2>
      <p className="mt-1 text-sm">Enter your confirmation number and the email used for your booking. We’ll email a verification code from info@gokohostel.com.</p>
      <form onSubmit={lookup} className="mt-5 grid items-end gap-3 md:grid-cols-3">
        {!challengeId ? <><label className="text-sm font-semibold">Confirmation number<input className={field} required maxLength={120} disabled={busy} autoComplete="off" value={reference} onChange={e => setReference(e.target.value)} /></label><label className="text-sm font-semibold">Booking email<input className={field} required type="email" maxLength={254} disabled={busy} autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} /></label></> : <label className="text-sm font-semibold md:col-span-2">Email verification code<input className={field} required inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} disabled={busy} value={code} onChange={e => setCode(e.target.value)} /></label>}
        <button className={action} disabled={busy}>{busy ? "Please wait…" : challengeId ? "View booking" : "Send verification code"}</button>
      </form>
      {challengeId && <button type="button" disabled={busy} className="mt-3 min-h-12 text-left text-sm underline" onClick={() => { setChallengeId(""); setCode(""); setMessage(""); }}>Change details / request again after 10 minutes</button>}
      {booking && <div className="mt-5 rounded-xl bg-brand-sand p-5">
        <h3 className="font-semibold">Booking {booking.reference || booking.externalReference}</h3>
        <p>{booking.guestName} · {booking.guests} guests · {booking.roomType}</p>
        <p>{booking.checkinDate} – {booking.checkoutDate}</p><p>Status: {booking.status} · Payment: {booking.paymentStatus || "Awaiting update"}</p>
        <p>Total: {booking.total == null ? "Not recorded" : money(booking.total)} · Paid: {booking.paid == null ? "Not recorded" : money(booking.paid)} · Refunded: {booking.refunded == null ? "Not recorded" : money(booking.refunded)}</p>
      </div>}
    </div>}
    <p role="status" aria-live="polite" className="mt-4 break-words text-sm">{message}</p>
    <div className="mt-3 grid gap-2 border-t border-brand-mist pt-3 text-sm sm:flex sm:flex-wrap sm:gap-4"><a className="inline-flex min-h-12 items-center font-semibold underline" href="/booking-enquiry">Need help? Send an enquiry</a><a className="inline-flex min-h-12 items-center font-semibold underline" href={site.whatsAppUrl} target="_blank" rel="noopener noreferrer">Contact Goko</a></div>
  </div>;
}
