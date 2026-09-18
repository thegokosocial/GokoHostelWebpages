"use client";

import { useState, useCallback, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { Suspense } from "react";
import {
  DEFAULT_BILL_BRANDING,
  billPaymentStatusLabel,
  formatGstRateLabel,
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

const STATUS_LABELS: Record<string, string> = {
  placed: "Placed",
  preparing: "Preparing",
  ready: "Ready",
  served: "Served",
  cancelled: "Cancelled",
};

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

            {/* Unpaid Bills */}
            {unpaidOrders.length > 0 && (
              <div className="mb-6">
                <div className="mb-3 flex items-center justify-between px-1">
                  <h2 className="text-lg font-bold text-brand-green">Unpaid Bills</h2>
                  <span className="rounded-full bg-amber-400/90 px-3 py-1 text-sm font-bold text-amber-900">
                    ₹{Math.round(totalSpent / 100) - Math.round(paidTotal / 100)}
                  </span>
                </div>
                <div className="space-y-3">
                  {unpaidOrders.map((order) => (
                    <OrderCard
                      key={order.orderNumber}
                      order={order}
                      variant="unpaid"
                      expanded={expandedOrders.has(order.orderNumber)}
                      onToggle={() => toggleOrder(order.orderNumber)}
                      branding={billBranding}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Paid Bills */}
            {paidOrders.length > 0 && (
              <div className="mb-6">
                <div className="mb-3 px-1">
                  <h2 className="text-lg font-bold text-brand-green-dark/70">Paid Bills</h2>
                </div>
                <div className="space-y-3">
                  {paidOrders.map((order) => (
                    <OrderCard
                      key={order.orderNumber}
                      order={order}
                      variant="paid"
                      expanded={expandedOrders.has(order.orderNumber)}
                      onToggle={() => toggleOrder(order.orderNumber)}
                      branding={billBranding}
                    />
                  ))}
                </div>
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

function OrderCard({
  order,
  variant,
  expanded,
  onToggle,
  branding,
}: {
  order: BillOrder;
  variant: "unpaid" | "paid";
  expanded: boolean;
  onToggle: () => void;
  branding: BillBrandingPublic;
}) {
  const accent = branding.accent || DEFAULT_BILL_BRANDING.accent;
  const badgeLabel = billPaymentStatusLabel(order.paymentStatus);
  const { cgst, sgst } = splitGstPaise(order.tax);
  const rateForLabels = order.tax > 0
    ? foodTaxRateFromAmounts(order.subtotal, order.tax)
    : (branding.taxRate || 0);
  const { cgstRate, sgstRate } = splitGstRate(rateForLabels);
  const showPayment = variant === "unpaid" && (branding.qrUrl || branding.upiId);
  const pendingPrice = order.items.some((item) => item.pricingStatus === "pending");

  return (
    <motion.div
      layout
      className={`overflow-hidden rounded-2xl bg-white dark:bg-card shadow-sm dark:shadow-none ${variant === "paid" ? "opacity-90" : ""}`}
    >
      <div className="px-4 py-3 text-center text-white" style={{ backgroundColor: accent }}>
        <p className="text-base font-bold">{branding.hostelName}</p>
        <p className="text-xs opacity-90">{branding.location}</p>
      </div>

      <button
        onClick={onToggle}
        className="flex w-full items-center justify-between px-4 py-3.5 text-left"
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-sm font-bold text-gray-800 dark:text-gray-200">Goko order</span>
            <span className="font-mono text-sm font-bold text-gray-600 dark:text-gray-300">
              #{order.orderNumber}
            </span>
            <span
              className="rounded-full px-2 py-0.5 text-xs font-medium"
              style={{ backgroundColor: `${accent}22`, color: accent }}
            >
              {badgeLabel}
            </span>
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
              order.status === "served" ? "bg-green-50 dark:bg-green-950 text-green-600 dark:text-green-400" :
              order.status === "ready" ? "bg-brand-green/10 dark:bg-brand-green/20 text-brand-green dark:text-brand-green-dark" :
              order.status === "preparing" ? "bg-brand-green/10 dark:bg-brand-green/20 text-brand-green dark:text-brand-green-dark" :
              order.status === "cancelled" ? "bg-red-50 dark:bg-red-950 text-red-600 dark:text-red-400" :
              "bg-amber-50 dark:bg-amber-950 text-amber-600 dark:text-amber-400"
            }`}>
              {STATUS_LABELS[order.status] || order.status}
            </span>
          </div>
          <p className="mt-0.5 text-xs text-gray-400">
            {formatDate(order.createdAt)} · {formatTime(order.createdAt)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="text-right">
            {order.discount > 0 && (
              <span className="mr-1.5 text-xs text-gray-400 line-through">
                ₹{Math.round((order.total + order.discount) / 100)}
              </span>
            )}
            <span className="text-sm font-semibold text-gray-800 dark:text-gray-200">
              {pendingPrice ? "Price pending" : `₹${Math.round(order.total / 100)}`}
            </span>
          </div>
          <svg
            className={`h-4 w-4 text-gray-400 transition-transform ${expanded ? "rotate-180" : ""}`}
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
            <div className="border-t border-gray-100 dark:border-white/10 px-4 pb-4 pt-3">
              <div className="mb-2 grid grid-cols-[1fr_auto_auto] gap-x-3 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
                <span>Item</span>
                <span className="w-8 text-center">Qty</span>
                <span className="w-16 text-right">Amount</span>
              </div>
              <div className="space-y-2">
                {order.items.map((item, idx) => (
                  <div key={idx} className="grid grid-cols-[1fr_auto_auto] gap-x-3 border-b border-gray-50 dark:border-white/5 pb-2 text-sm last:border-0">
                    <div className="min-w-0">
                      <span className="text-gray-700 dark:text-gray-300">{item.name}</span>
                      {item.quantity > 1 && (
                        <p className="text-[11px] text-gray-400">{item.quantity} x {formatRupees(item.price)}</p>
                      )}
                    </div>
                    <span className="w-8 text-center text-gray-500">{item.quantity}</span>
                    <span className="w-16 text-right text-gray-600 dark:text-gray-400">
                      {item.pricingStatus === "pending" ? "—" : formatRupees(item.lineTotal)}
                    </span>
                  </div>
                ))}
              </div>
              <div className="mt-3 space-y-1 border-t border-gray-200 dark:border-white/10 pt-2">
                <div className="flex justify-between text-xs text-gray-500">
                  <span>Subtotal</span>
                  <span>{formatRupees(order.subtotal + (order.discount || 0))}</span>
                </div>
                {order.discount > 0 && (
                  <div className="flex justify-between text-xs text-green-600">
                    <span>Discount</span>
                    <span>-{formatRupees(order.discount)}</span>
                  </div>
                )}
                {order.tax > 0 && (
                  <>
                    <div className="flex justify-between text-xs text-gray-500">
                      <span>CGST ({formatGstRateLabel(cgstRate)}%)</span>
                      <span>{formatRupees(cgst)}</span>
                    </div>
                    <div className="flex justify-between text-xs text-gray-500">
                      <span>SGST ({formatGstRateLabel(sgstRate)}%)</span>
                      <span>{formatRupees(sgst)}</span>
                    </div>
                  </>
                )}
                <div className="mt-1 flex justify-between text-sm font-semibold text-gray-800 dark:text-gray-200">
                  <span>Grand Total</span>
                  <span>{pendingPrice ? "Price pending" : formatRupees(order.total)}</span>
                </div>
              </div>

              {showPayment && !pendingPrice && (
                <div className="mt-4 text-center">
                  {branding.qrUrl && (
                    <img
                      src={branding.qrUrl}
                      alt="Payment QR"
                      className="mx-auto h-40 w-40 rounded-lg border border-gray-100 bg-white object-contain p-2"
                    />
                  )}
                  <p className="mt-2 text-sm text-gray-600">
                    Scan to pay{" "}
                    <span className="font-semibold" style={{ color: accent }}>
                      {formatRupees(order.total)}
                    </span>
                  </p>
                  {branding.upiId && (
                    <p className="mt-0.5 text-xs text-gray-400">{branding.upiId}</p>
                  )}
                </div>
              )}

              {variant === "paid" && order.paymentMethod && (
                <p className="mt-2 text-xs text-gray-400">
                  Paid via {order.paymentMethod}
                </p>
              )}

              {branding.footer && (
                <p className="mt-3 text-center text-xs text-gray-400">{branding.footer}</p>
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
