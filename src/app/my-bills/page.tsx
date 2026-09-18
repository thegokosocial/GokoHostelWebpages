"use client";

import { useState, useCallback, useEffect, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { DEFAULT_BILL_BRANDING } from "@/lib/foodBillFormat";
import { GuestFoodBillCard } from "@/components/food/GuestFoodBillCard";

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

  const toggleOrder = (key: string) => {
    setExpandedOrders((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
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
        <button
          type="button"
          onClick={handleBack}
          className="mb-4 flex items-center gap-1.5 text-sm font-medium text-brand-green-dark/70 transition hover:text-brand-green"
        >
          ← Back
        </button>

        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-green/10">
            <svg className="h-7 w-7 text-brand-green" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-brand-green">My Bills</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">View your food orders & bills</p>
        </div>

        {!submitted ? (
          <motion.form
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            onSubmit={handleSubmit}
            className="rounded-2xl bg-white/95 dark:bg-card/95 p-6 shadow-xl dark:shadow-none backdrop-blur-sm"
          >
            <label className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
              Phone number
            </label>
            <div className="flex gap-2">
              <div className="flex flex-1 items-center rounded-xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-[#0f0f0f] px-3">
                <span className="text-sm text-gray-400">+91</span>
                <input
                  type="tel"
                  inputMode="numeric"
                  value={formatPhone(phone)}
                  onChange={handlePhoneChange}
                  placeholder="98765 43210"
                  className="w-full bg-transparent px-2 py-3 text-base outline-none"
                  autoFocus
                />
              </div>
              <button
                type="submit"
                disabled={loading || phone.length < 10}
                className="rounded-xl bg-brand-green px-5 py-3 text-sm font-semibold text-white disabled:opacity-50"
              >
                {loading ? "…" : "View"}
              </button>
            </div>
            {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
          </motion.form>
        ) : (
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
            <div className="mb-4 flex items-center justify-between rounded-xl bg-white/80 dark:bg-card/80 px-4 py-2.5 backdrop-blur-sm">
              <span className="text-sm text-gray-600 dark:text-gray-300">+91 {formatPhone(phone)}</span>
              <button type="button" onClick={handleChangeNumber} className="text-sm font-medium text-brand-green">
                Change
              </button>
            </div>

            {loading ? (
              <div className="rounded-2xl bg-white/95 dark:bg-card/95 p-8 text-center shadow-xl dark:shadow-none">
                <p className="text-brand-green">Loading bills…</p>
              </div>
            ) : (
              <>
                {(unpaidOrders.length > 0 || paidOrders.length > 0) && (
                  <div className="mb-4 rounded-2xl bg-white/95 dark:bg-card/95 p-4 shadow-xl dark:shadow-none backdrop-blur-sm">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-gray-500">Total Spent</span>
                      <span className="text-xl font-bold text-brand-green-dark dark:text-brand-green">
                        ₹{Math.round(totalSpent / 100)}
                      </span>
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
                          <span className="text-sm font-semibold text-amber-700 dark:text-amber-400">
                            ₹{Math.round(totalSpent / 100) - Math.round(paidTotal / 100)} unpaid
                          </span>
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

                {unpaidOrders.length > 0 && (
                  <div className="mb-6">
                    <div className="mb-3 flex items-center justify-between px-1">
                      <h2 className="text-lg font-bold text-brand-green">Open tab</h2>
                      <span className="rounded-full bg-amber-400/90 px-3 py-1 text-sm font-bold text-amber-900">
                        ₹{Math.round(unpaidTotal / 100)}
                      </span>
                    </div>
                    <GuestFoodBillCard
                      orders={unpaidOrders}
                      variant="unpaid"
                      branding={billBranding}
                      expanded={expandedOrders.has("unpaid-tab")}
                      onToggle={() => toggleOrder("unpaid-tab")}
                    />
                  </div>
                )}

                {paidOrders.length > 0 && (
                  <div className="mb-6">
                    <div className="mb-3 px-1">
                      <h2 className="text-lg font-bold text-brand-green-dark/70">Paid</h2>
                    </div>
                    <GuestFoodBillCard
                      orders={paidOrders}
                      variant="paid"
                      branding={billBranding}
                      expanded={expandedOrders.has("paid-tab")}
                      onToggle={() => toggleOrder("paid-tab")}
                    />
                  </div>
                )}

                {unpaidOrders.length === 0 && paidOrders.length === 0 && (
                  <div className="rounded-2xl bg-white/95 dark:bg-card/95 p-8 text-center shadow-xl dark:shadow-none backdrop-blur-sm">
                    <span className="text-4xl">📭</span>
                    <p className="mt-3 text-gray-600 dark:text-gray-400">No bills found for this number</p>
                  </div>
                )}

                <div className="mt-6 text-center">
                  <button
                    type="button"
                    onClick={handleBack}
                    className="text-sm font-medium text-brand-green-dark/70 hover:text-brand-green"
                  >
                    ← Back to menu
                  </button>
                </div>
              </>
            )}
          </motion.div>
        )}
      </div>
    </div>
  );
}

export default function MyBillsPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center goko-mesh goko-noise bg-brand-sand dark:bg-background"><p className="text-brand-green">Loading...</p></div>}>
      <MyBillsContent />
    </Suspense>
  );
}
