"use client";

import { useState, useCallback, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { Suspense } from "react";
import {
  DEFAULT_BILL_BRANDING,
  billPaymentStatusLabel,
  formatGstRateLabel,
  mergeBillLineItems,
  splitGstPaise,
  splitGstRate,
} from "@/lib/foodBillFormat";
import { foodTaxRateFromAmounts } from "@/lib/foodLookup";

interface BillItem {
  menuItemId: number;
  name: string;
  quantity: number;
  price: number;
  lineTotal: number;
  pricingStatus?: string;
  notes?: string;
}

interface BillOrder {
  orderNumber: string;
  status: string;
  guestType: string;
  guestName: string;
  roomInfo: string | null;
  subtotal: number;
  tax: number;
  total: number;
  discount: number;
  paymentStatus: string;
  paymentMethod: string | null;
  createdAt: string;
  checkinId: number | null;
  items: BillItem[];
}

type BillBrandingPublic = {
  hostelName: string;
  location: string;
  accent: string;
  upiId: string;
  qrUrl: string;
  footer: string;
  taxRate: number;
};

function formatPhone(digits: string): string {
  if (digits.length <= 5) return digits;
  return digits.slice(0, 5) + " " + digits.slice(5);
}

function stripNonDigits(val: string): string {
  return val.replace(/\D/g, "").slice(0, 10);
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const fmt = (dt: Date) => dt.toISOString().split("T")[0];
  if (fmt(d) === fmt(now)) return "Today";
  if (fmt(d) === fmt(yesterday)) return "Yesterday";
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function formatTime(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
}

function formatRupees(paise: number): string {
  return `₹${(paise / 100).toFixed(2)}`;
}

const DEFAULT_PUBLIC_BRANDING: BillBrandingPublic = {
  hostelName: DEFAULT_BILL_BRANDING.hostelName,
  location: DEFAULT_BILL_BRANDING.location,
  accent: DEFAULT_BILL_BRANDING.accent,
  upiId: "",
  qrUrl: "",
  footer: DEFAULT_BILL_BRANDING.footer,
  taxRate: 0,
};

function MyBillsContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const phoneParam = searchParams.get("phone") || "";

  const [phone, setPhone] = useState(() => {
    if (phoneParam) return phoneParam;
    if (typeof window !== "undefined") {
      return localStorage.getItem("gokoFoodPhone") || "";
    }
    return "";
  });
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [unpaidOrders, setUnpaidOrders] = useState<BillOrder[]>([]);
  const [paidOrders, setPaidOrders] = useState<BillOrder[]>([]);
  const [expandedOrders, setExpandedOrders] = useState<Set<string>>(new Set());
  const [billBranding, setBillBranding] = useState<BillBrandingPublic>(DEFAULT_PUBLIC_BRANDING);

  const fetchBills = useCallback(async (phoneDigits: string) => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/food/bills?phone=${encodeURIComponent(phoneDigits)}`);
      if (!res.ok) throw new Error("Failed to fetch");
      const data = await res.json();
      setUnpaidOrders(data.unpaidOrders || []);
      setPaidOrders(data.paidOrders || []);
      if (data.billBranding) {
        setBillBranding({ ...DEFAULT_PUBLIC_BRANDING, ...data.billBranding });
      }
      setExpandedOrders(new Set((data.unpaidOrders || []).length ? ["unpaid-tab"] : []));
      setSubmitted(true);
    } catch {
      setError("Unable to load bills. Please try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const digits = stripNonDigits(phone);
    if (digits.length < 10) {
      setError("Please enter a valid 10-digit number");
      return;
    }
    localStorage.setItem("gokoFoodPhone", digits);
    fetchBills(digits);
  };

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = stripNonDigits(e.target.value);
    setPhone(raw);
    setError("");
  };

  const toggleOrder = (orderNumber: string) => {
    setExpandedOrders((prev) => {
      const next = new Set(prev);
      if (next.has(orderNumber)) next.delete(orderNumber);
      else next.add(orderNumber);
      return next;
    });
  };

  useEffect(() => {
    if (phoneParam && !submitted) {
      const digits = phoneParam.replace(/\D/g, "");
      if (digits.length >= 7) {
        setPhone(digits);
        setSubmitted(true);
        fetchBills(digits);
      }
    }
  }, [phoneParam]);

  const handleChangeNumber = () => {
    setPhone("");
    setSubmitted(false);
    setUnpaidOrders([]);
    setPaidOrders([]);
    setError("");
    localStorage.removeItem("gokoFoodPhone");
  };

  const handleBack = () => {
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
    } else {
      router.push("/food-order");
    }
  };

  const unpaidTotal = unpaidOrders.reduce((sum, o) => sum + o.total, 0);
  const paidTotal = paidOrders.reduce((sum, o) => sum + o.total, 0);
  const totalDiscount = [...unpaidOrders, ...paidOrders].reduce((sum, o) => sum + (o.discount || 0), 0);
  const totalSpent = unpaidTotal + paidTotal;

  return (
    <div className="min-h-screen goko-mesh goko-noise bg-brand-sand dark:bg-background">
      <div className="mx-auto max-w-lg px-4 pb-10 pt-8">
        {/* Back */}
        <button
          type="button"
          onClick={handleBack}
          className="mb-4 flex items-center gap-1.5 text-sm font-medium text-brand-green-dark/70 transition hover:text-brand-green"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back
        </button>

        {/* Header */}
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-green/10">
            <span className="text-2xl">🧾</span>
          </div>
          <h1 className="text-2xl font-bold text-brand-green">My Bills</h1>
          <p className="mt-1 text-sm text-brand-green-dark/70">View your food orders & bills</p>
        </div>

        {/* Phone entry */}
        {!submitted ? (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-2xl bg-white/95 dark:bg-card/95 p-6 shadow-xl dark:shadow-none backdrop-blur-sm"
          >
            <h2 className="mb-1 text-lg font-semibold text-gray-800 dark:text-foreground">Enter your phone number</h2>
            <p className="mb-5 text-sm text-gray-500 dark:text-muted-foreground">We&apos;ll look up your bills</p>

            <form onSubmit={handleSubmit}>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-medium text-gray-500">
                  +91
                </span>
                <input
                  type="tel"
                  inputMode="numeric"
                  value={formatPhone(phone)}
                  onChange={handlePhoneChange}
                  placeholder="98765 43210"
                  className="w-full rounded-xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-muted py-3.5 pl-12 pr-4 text-lg font-medium tracking-wide text-gray-800 dark:text-foreground outline-none transition focus:border-brand-green focus:bg-white dark:focus:bg-accent focus-visible:goko-focus"
                  autoFocus
                  disabled={loading}
                />
              </div>

              {error && (
                <p className="mt-3 text-sm text-brand-red">{error}</p>
              )}

              <button
                type="submit"
                disabled={loading || stripNonDigits(phone).length < 10}
                className="goko-gradient-cta mt-5 w-full rounded-xl py-3.5 text-base font-semibold text-white shadow-lg dark:shadow-none transition hover:shadow-xl dark:hover:shadow-none disabled:opacity-50 disabled:shadow-none"
              >
                {loading ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="h-5 w-5 animate-spin" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Loading…
                  </span>
                ) : (
                  "Continue"
                )}
              </button>
            </form>

            <div className="mt-4 text-center">
              <button
                type="button"
                onClick={handleBack}
                className="text-sm text-brand-green hover:text-brand-green-dark"
              >
                ← Back to menu
              </button>
            </div>
          </motion.div>
        ) : (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
          >
            {/* Phone bar + change */}
            <div className="mb-4 flex items-center justify-between rounded-xl bg-brand-green/10 px-4 py-2.5">
              <span className="text-sm font-medium text-brand-green">
                +91 {formatPhone(phone)}
              </span>
              <button
                onClick={handleChangeNumber}
                className="text-sm font-medium text-brand-green-dark/70 hover:text-brand-green"
              >
                Change
              </button>
            </div>

            {/* Total Summary */}
            {(unpaidOrders.length > 0 || paidOrders.length > 0) && (
              <div className="mb-4 rounded-xl bg-white/95 dark:bg-card/95 p-4 shadow-lg dark:shadow-none backdrop-blur-sm">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-600 dark:text-gray-400">Total Spent</span>
                  <span className="text-xl font-bold text-gray-800 dark:text-foreground">₹{Math.round(totalSpent / 100)}</span>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-4 border-t border-gray-100 dark:border-white/10 pt-2">
                  {totalDiscount > 0 && (
                    <div className="flex items-center gap-1.5">
                      <div className="h-2 w-2 rounded-full bg-purple-500" />
                      <span className="text-sm text-purple-700 dark:text-purple-400">
                        {Math.round((totalDiscount / (totalSpent + totalDiscount)) * 100)}% off (₹{Math.round(totalDiscount / 100)})
                      </span>
                    </div>
                  )}
                  {paidTotal > 0 && (
                    <div className="flex items-center gap-1.5">
                      <div className="h-2 w-2 rounded-full bg-green-500" />
                      <span className="text-sm text-green-700 dark:text-green-400">₹{Math.round(paidTotal / 100)} paid</span>
                    </div>
                  )}
                  {unpaidTotal > 0 && (
                    <div className="flex items-center gap-1.5">
                      <div className="h-2 w-2 rounded-full bg-amber-500" />
                      <span className="text-sm font-semibold text-amber-700 dark:text-amber-400">₹{Math.round(totalSpent / 100) - Math.round(paidTotal / 100)} unpaid</span>
                    </div>
                  )}
                  {unpaidTotal === 0 && paidTotal > 0 && !totalDiscount && (
                    <span className="text-sm font-semibold text-green-600">All paid</span>
                  )}
                  {unpaidTotal === 0 && paidTotal === 0 && totalDiscount > 0 && (
                    <span className="text-sm font-semibold text-green-600">All settled</span>
                  )}
                </div>
              </div>
            )}

            {/* Unpaid — one combined tab bill */}
            {unpaidOrders.length > 0 && (
              <div className="mb-6">
                <div className="mb-3 flex items-center justify-between px-1">
                  <h2 className="text-lg font-bold text-brand-green">Open tab</h2>
                  <span className="rounded-full bg-amber-400/90 px-3 py-1 text-sm font-bold text-amber-900">
                    ₹{Math.round(unpaidTotal / 100)}
                  </span>
                </div>
                <TabBillCard
                  orders={unpaidOrders}
                  variant="unpaid"
                  expanded={expandedOrders.has("unpaid-tab")}
                  onToggle={() => toggleOrder("unpaid-tab")}
                  branding={billBranding}
                />
              </div>
            )}

            {/* Paid — one combined receipt */}
            {paidOrders.length > 0 && (
              <div className="mb-6">
                <div className="mb-3 px-1">
                  <h2 className="text-lg font-bold text-brand-green-dark/70">Paid</h2>
                </div>
                <TabBillCard
                  orders={paidOrders}
                  variant="paid"
                  expanded={expandedOrders.has("paid-tab")}
                  onToggle={() => toggleOrder("paid-tab")}
                  branding={billBranding}
                />
              </div>
            )}

            {/* No orders */}
            {unpaidOrders.length === 0 && paidOrders.length === 0 && (
              <div className="rounded-2xl bg-white/95 dark:bg-card/95 p-8 text-center shadow-xl dark:shadow-none backdrop-blur-sm">
                <span className="text-4xl">📭</span>
                <p className="mt-3 text-gray-600 dark:text-gray-400">No bills found for this number</p>
              </div>
            )}

            {/* Back to menu */}
            <div className="mt-6 text-center">
              <button
                type="button"
                onClick={handleBack}
                className="text-sm font-medium text-brand-green-dark/70 hover:text-brand-green"
              >
                ← Back to menu
              </button>
            </div>
          </motion.div>
        )}
      </div>
    </div>
  );
}

function TabBillCard({
  orders,
  variant,
  expanded,
  onToggle,
  branding,
}: {
  orders: BillOrder[];
  variant: "unpaid" | "paid";
  expanded: boolean;
  onToggle: () => void;
  branding: BillBrandingPublic;
}) {
  const accent = branding.accent || DEFAULT_BILL_BRANDING.accent;
  const subtotal = orders.reduce((s, o) => s + o.subtotal, 0);
  const tax = orders.reduce((s, o) => s + o.tax, 0);
  const total = orders.reduce((s, o) => s + o.total, 0);
  const discount = orders.reduce((s, o) => s + (o.discount || 0), 0);
  const items = mergeBillLineItems(
    orders.flatMap((o) =>
      o.items
        .filter((i) => i.pricingStatus !== "pending")
        .map((i) => ({
          name: i.name,
          quantity: i.quantity,
          price: i.price,
          lineTotal: i.lineTotal,
          status: "active",
        })),
    ),
  );
  const pendingItems = orders.flatMap((o) =>
    o.items.filter((i) => i.pricingStatus === "pending"),
  );
  const pendingPrice = pendingItems.length > 0;
  const { cgst, sgst } = splitGstPaise(tax);
  const rateForLabels = tax > 0 ? foodTaxRateFromAmounts(subtotal, tax) : (branding.taxRate || 0);
  const { cgstRate, sgstRate } = splitGstRate(rateForLabels);
  const showPayment = variant === "unpaid" && (branding.qrUrl || branding.upiId);
  const guestName = orders[0]?.guestName;
  const roomInfo = orders.find((o) => o.roomInfo)?.roomInfo;
  const latest = orders.reduce((a, b) => (a.createdAt > b.createdAt ? a : b), orders[0]);
  const badgeLabel = variant === "paid" ? "Paid" : billPaymentStatusLabel(orders[0]?.paymentStatus || "on_tab");

  return (
    <motion.div
      layout
      className={`overflow-hidden rounded-2xl border border-black/5 bg-white shadow-sm dark:border-white/10 dark:bg-card ${variant === "paid" ? "opacity-90" : ""}`}
    >
      {/* Unique header: left rail + sand strip (not full accent band) */}
      <div className="flex overflow-hidden">
        <div className="w-1.5 shrink-0" style={{ backgroundColor: accent }} />
        <div className="flex-1 bg-[#F7F4EF] px-4 py-3 dark:bg-zinc-900/60">
          <p className="text-base font-bold text-zinc-900 dark:text-zinc-100">{branding.hostelName}</p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">{branding.location}</p>
        </div>
      </div>

      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between px-4 py-3.5 text-left"
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-bold text-zinc-800 dark:text-zinc-100">Food tab</span>
            <span
              className="rounded-md border px-2 py-0.5 text-[11px] font-semibold"
              style={{ borderColor: accent, color: accent }}
            >
              {badgeLabel}
            </span>
            {orders.length > 1 && (
              <span className="text-xs text-zinc-400">{orders.length} orders</span>
            )}
          </div>
          <p className="mt-1 text-xs text-zinc-400">
            {[guestName, roomInfo].filter(Boolean).join(" · ")}
          </p>
          <p className="text-xs text-zinc-400">
            {formatDate(latest.createdAt)} · {formatTime(latest.createdAt)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">
            {pendingPrice ? "Price pending" : `₹${Math.round(total / 100)}`}
          </span>
          <svg
            className={`h-4 w-4 text-zinc-400 transition-transform ${expanded ? "rotate-180" : ""}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="border-t border-zinc-100 px-4 pb-4 pt-3 dark:border-white/10">
              <div className="mb-2 grid grid-cols-[1fr_auto_auto] gap-x-3 text-[10px] font-semibold uppercase tracking-wide text-zinc-400">
                <span>Item</span>
                <span className="w-8 text-center">Qty</span>
                <span className="w-16 text-right">Amount</span>
              </div>
              <div className="space-y-2">
                {items.map((item, idx) => (
                  <div
                    key={idx}
                    className="grid grid-cols-[1fr_auto_auto] gap-x-3 border-b border-zinc-50 pb-2 text-sm last:border-0 dark:border-white/5"
                  >
                    <div className="min-w-0">
                      <span className="text-zinc-700 dark:text-zinc-300">{item.itemName}</span>
                      {item.quantity > 1 && (
                        <p className="text-[11px] text-zinc-400">
                          {item.quantity} × {formatRupees(item.itemPrice)}
                        </p>
                      )}
                    </div>
                    <span className="w-8 text-center text-zinc-500">{item.quantity}</span>
                    <span className="w-16 text-right text-zinc-600 dark:text-zinc-400">
                      {formatRupees(item.lineTotal)}
                    </span>
                  </div>
                ))}
                {pendingItems.map((item, idx) => (
                  <div
                    key={`p-${idx}`}
                    className="grid grid-cols-[1fr_auto_auto] gap-x-3 border-b border-zinc-50 pb-2 text-sm last:border-0 dark:border-white/5"
                  >
                    <span className="text-zinc-700 dark:text-zinc-300">{item.name}</span>
                    <span className="w-8 text-center text-zinc-500">{item.quantity}</span>
                    <span className="w-16 text-right text-amber-600">Pending</span>
                  </div>
                ))}
              </div>

              <div className="mt-3 space-y-1 border-t border-zinc-200 pt-2 dark:border-white/10">
                <div className="flex justify-between text-xs text-zinc-500">
                  <span>Subtotal</span>
                  <span>{formatRupees(subtotal + discount)}</span>
                </div>
                {discount > 0 && (
                  <div className="flex justify-between text-xs text-green-600">
                    <span>Discount</span>
                    <span>-{formatRupees(discount)}</span>
                  </div>
                )}
                {tax > 0 && (
                  <>
                    <div className="flex justify-between text-xs text-zinc-500">
                      <span>CGST ({formatGstRateLabel(cgstRate)}%)</span>
                      <span>{formatRupees(cgst)}</span>
                    </div>
                    <div className="flex justify-between text-xs text-zinc-500">
                      <span>SGST ({formatGstRateLabel(sgstRate)}%)</span>
                      <span>{formatRupees(sgst)}</span>
                    </div>
                  </>
                )}
                <div className="mt-1 flex justify-between text-sm font-semibold text-zinc-800 dark:text-zinc-100">
                  <span>Grand Total</span>
                  <span>{pendingPrice ? "Price pending" : formatRupees(total)}</span>
                </div>
              </div>

              {showPayment && !pendingPrice && (
                <div className="mt-4 border-t border-dashed border-zinc-200 pt-4 text-center dark:border-white/10">
                  {branding.qrUrl && (
                    <img
                      src={branding.qrUrl}
                      alt="Payment QR"
                      className="mx-auto h-36 w-36 bg-white object-contain p-1"
                    />
                  )}
                  <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">
                    Pay{" "}
                    <span className="font-semibold" style={{ color: accent }}>
                      {formatRupees(total)}
                    </span>
                    {" "}via UPI
                  </p>
                  {branding.upiId && (
                    <p className="mt-0.5 font-mono text-xs text-zinc-400">{branding.upiId}</p>
                  )}
                </div>
              )}

              {variant === "paid" && (
                <p className="mt-2 text-xs text-zinc-400">
                  Settled{orders.some((o) => o.paymentMethod) ? ` · ${[...new Set(orders.map((o) => o.paymentMethod).filter(Boolean))].join(", ")}` : ""}
                </p>
              )}

              {branding.footer && (
                <p className="mt-3 text-center text-xs text-zinc-400">{branding.footer}</p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

export default function MyBillsPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center goko-mesh goko-noise bg-brand-sand dark:bg-background"><p className="text-brand-green">Loading...</p></div>}>
      <MyBillsContent />
    </Suspense>
  );
}
