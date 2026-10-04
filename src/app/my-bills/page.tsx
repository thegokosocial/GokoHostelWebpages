"use client";

import { useState, useCallback, useEffect, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { DEFAULT_BILL_BRANDING } from "@/lib/foodBillFormat";
import { GuestFoodBillCard } from "@/components/food/GuestFoodBillCard";
import { useFoodBillDynamicQr } from "@/hooks/useFoodBillDynamicQr";
import {
  myBillsHidePayment,
  myBillsShowsPayQr,
  shouldEnsureDynamicFoodQr,
} from "@/lib/foodBillQrUi";

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
  id?: number;
  orderNumber: string;
  status: string;
  guestType: string;
  guestName: string;
  roomInfo: string | null;
  subtotal: number;
  tax: number;
  total: number;
  amountPaid?: number;
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
  qrMode?: string;
};

type GuestChoice = { scope: "hostel" | "walkin"; name: string; nameKey?: string };

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
  qrMode: "static",
};

function MyBillsContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const phoneParam = searchParams.get("phone") || "";
  const tokenParam = searchParams.get("t") || searchParams.get("token") || "";

  const [phone, setPhone] = useState(() => {
    if (tokenParam) return "";
    if (phoneParam) return phoneParam;
    if (typeof window !== "undefined") {
      return localStorage.getItem("gokoFoodPhone") || "";
    }
    return "";
  });
  const [submitted, setSubmitted] = useState(false);
  const [viaToken, setViaToken] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [unpaidOrders, setUnpaidOrders] = useState<BillOrder[]>([]);
  const [paidOrders, setPaidOrders] = useState<BillOrder[]>([]);
  const [guestChoices, setGuestChoices] = useState<GuestChoice[]>([]);
  const [billBranding, setBillBranding] = useState<BillBrandingPublic>(DEFAULT_PUBLIC_BRANDING);
  const [combined, setCombined] = useState(false);

  const applyBillsPayload = useCallback((data: {
    unpaidOrders?: BillOrder[];
    paidOrders?: BillOrder[];
    billBranding?: Partial<BillBrandingPublic>;
    viaToken?: boolean;
    phone?: string;
    combined?: boolean;
  }) => {
    setUnpaidOrders(data.unpaidOrders || []);
    setPaidOrders(data.paidOrders || []);
    if (data.billBranding) {
      setBillBranding({ ...DEFAULT_PUBLIC_BRANDING, ...data.billBranding });
    }
    setViaToken(!!data.viaToken);
    setCombined(!!data.combined);
    if (data.viaToken) {
      setPhone("");
    } else if (data.phone) {
      setPhone(data.phone);
    }
    setSubmitted(true);
  }, []);

  const fetchBillsByPhone = useCallback(async (phoneDigits: string, choice?: GuestChoice) => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ phone: phoneDigits });
      if (choice) {
        params.set("scope", choice.scope);
        if (choice.nameKey) params.set("guest", choice.nameKey);
      }
      const res = await fetch(`/api/food/bills?${params.toString()}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to fetch");
      if (data.requiresGuestSelection) {
        setGuestChoices(data.guestChoices || []);
        setSubmitted(false);
        return;
      }
      setGuestChoices([]);
      applyBillsPayload({ ...data, viaToken: false, phone: phoneDigits });
    } catch {
      setError("Unable to load bills. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [applyBillsPayload]);

  const fetchBillsByToken = useCallback(async (token: string) => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/food/bills?t=${encodeURIComponent(token)}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "This bill link is invalid or has expired");
        setSubmitted(false);
        setViaToken(false);
        return;
      }
      applyBillsPayload({ ...data, viaToken: true });
    } catch {
      setError("Unable to load bills. Please try again.");
      setSubmitted(false);
    } finally {
      setLoading(false);
    }
  }, [applyBillsPayload]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const digits = stripNonDigits(phone);
    if (digits.length < 10) {
      setError("Please enter a valid 10-digit number");
      return;
    }
    localStorage.setItem("gokoFoodPhone", digits);
    void fetchBillsByPhone(digits);
  };

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = stripNonDigits(e.target.value);
    setPhone(raw);
    setError("");
    setGuestChoices([]);
  };

  useEffect(() => {
    if (tokenParam) {
      void fetchBillsByToken(tokenParam);
      return;
    }
    if (phoneParam && !submitted) {
      const digits = phoneParam.replace(/\D/g, "");
      if (digits.length >= 7) {
        setPhone(digits);
        void fetchBillsByPhone(digits);
      }
    }
    // Intentional: run once from URL params on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tokenParam, phoneParam]);

  const handleChangeNumber = () => {
    setPhone("");
    setSubmitted(false);
    setViaToken(false);
    setUnpaidOrders([]);
    setPaidOrders([]);
    setCombined(false);
    setGuestChoices([]);
    setError("");
    localStorage.removeItem("gokoFoodPhone");
    if (tokenParam) {
      router.replace("/my-bills");
    }
  };

  const handleBack = () => {
    router.push("/food-order");
  };

  const unpaidTotal = unpaidOrders.reduce((sum, o) => sum + (combined ? Math.max(0, o.total - (o.amountPaid || 0)) : o.total), 0);
  const unpaidOrderIds = unpaidOrders.map((o) => o.id).filter((id): id is number => typeof id === "number" && id > 0);
  const unpaidRemintKey = unpaidOrders
    .filter((o) => typeof o.id === "number" && o.id > 0)
    .map((o) => `${o.id}:${o.total - (o.amountPaid || 0)}`)
    .sort()
    .join("|");
  const showPayQr = myBillsShowsPayQr(viaToken) && unpaidOrderIds.length > 0;
  const hidePayment = myBillsHidePayment(viaToken);
  const dynamicEnabled = shouldEnsureDynamicFoodQr({
    showPayQr,
    unpaidOrderCount: unpaidOrderIds.length,
    qrMode: billBranding.qrMode,
    ready: submitted && !loading,
  });
  const { state: qrState } = useFoodBillDynamicQr({
    enabled: dynamicEnabled,
    orderIds: unpaidOrderIds,
    remintKey: unpaidRemintKey,
    token: viaToken ? tokenParam : undefined,
    onPaid: () => {
      if (tokenParam) void fetchBillsByToken(tokenParam);
      else {
        const digits = phone.replace(/\D/g, "");
        if (digits.length >= 10) void fetchBillsByPhone(digits);
      }
    },
  });
  const dynamicQr =
    hidePayment || !dynamicEnabled || qrState.status === "idle" || qrState.status === "static"
      ? null
      : qrState.status === "loading"
        ? { status: "loading" as const }
        : qrState.status === "active"
          ? {
              status: "active" as const,
              imageUrl: qrState.imageUrl,
              upiIntent: qrState.upiIntent,
              closeBy: qrState.closeBy,
              label: qrState.label,
            }
          : qrState.status === "paid"
            ? { status: "paid" as const, label: qrState.label }
            : { status: "error" as const, message: qrState.message };

  const menuBranding: BillBrandingPublic = {
    ...billBranding,
    qrUrl: "",
    upiId: "",
  };
  const payBranding = billBranding;

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

        {!submitted && (
          <div className="mb-6 text-center">
            <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-green/10">
              <svg className="h-7 w-7 text-brand-green" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2z" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-brand-green">My Bills</h1>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">View your food orders & bills</p>
          </div>
        )}

        {tokenParam && loading && !submitted ? (
          <div className="rounded-2xl bg-white/95 dark:bg-card/95 p-8 text-center shadow-xl dark:shadow-none">
            <p className="text-brand-green">Loading shared bill…</p>
          </div>
        ) : tokenParam && error && !submitted ? (
          <div className="rounded-2xl bg-white/95 dark:bg-card/95 p-6 shadow-xl dark:shadow-none backdrop-blur-sm">
            <p className="text-sm text-red-600">{error}</p>
            <button
              type="button"
              onClick={handleChangeNumber}
              className="mt-4 text-sm font-medium text-brand-green"
            >
              Look up by phone instead
            </button>
          </div>
        ) : !submitted && guestChoices.length > 0 ? (
          <div className="rounded-2xl bg-white/95 dark:bg-card/95 p-6 shadow-xl dark:shadow-none backdrop-blur-sm">
            <h2 className="text-lg font-semibold text-brand-green-dark dark:text-brand-green">Choose your bill</h2>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">This number is used for more than one guest.</p>
            <div className="mt-4 space-y-2">
              {guestChoices.map((choice) => (
                <button
                  key={`${choice.scope}:${choice.nameKey || "stay"}`}
                  type="button"
                  disabled={loading}
                  onClick={() => void fetchBillsByPhone(phone, choice)}
                  className="flex w-full items-center justify-between rounded-xl border border-brand-mist px-4 py-3 text-left hover:bg-brand-sand/60 disabled:opacity-50"
                >
                  <span className="font-medium text-brand-green-dark dark:text-brand-green">{choice.name}</span>
                  <span className="text-xs text-gray-500">{choice.scope === "hostel" ? "Hostel stay" : "Walk-in"}</span>
                </button>
              ))}
            </div>
            <button type="button" onClick={handleChangeNumber} className="mt-4 text-sm font-medium text-brand-green">Use another number</button>
          </div>
        ) : !submitted ? (
          <motion.form
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            onSubmit={handleSubmit}
            className="rounded-2xl bg-white/95 dark:bg-card/95 p-6 shadow-xl dark:shadow-none backdrop-blur-sm"
          >
            <label htmlFor="bills-phone" className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
              Phone number
            </label>
            <div className="flex gap-2">
              <div className="flex flex-1 items-center rounded-xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-[#0f0f0f] px-3">
                <span className="text-sm text-gray-400">+91</span>
                <input
                  id="bills-phone"
                  type="tel"
                  inputMode="numeric"
                  autoComplete="tel-national"
                  aria-invalid={Boolean(error)}
                  aria-describedby={error ? "bills-phone-error" : "bills-phone-help"}
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
            <p id="bills-phone-help" className="mt-2 text-xs text-gray-500 dark:text-gray-400">Use the number given with your food order.</p>
            {error && <p id="bills-phone-error" className="mt-2 text-sm text-red-600" role="alert">{error}</p>}
          </motion.form>
        ) : (
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
            {loading ? (
              <div className="rounded-2xl bg-white/95 dark:bg-card/95 p-8 text-center shadow-xl dark:shadow-none">
                <p className="text-brand-green">Loading bills…</p>
              </div>
            ) : (
              <>
                {/* Menu (phone): open-tab items only — no QR, no paid history, no spend summary.
                    Share token: open tab through pay QR — no paid history, no spend summary. */}
                {unpaidOrders.length > 0 ? (
                  <div className="mb-6">
                    {viaToken && (
                      <div className="mb-3 flex items-center justify-between px-1">
                        <h2 className="text-lg font-bold text-brand-green">Open tab</h2>
                        <span className="rounded-full bg-amber-400/90 px-3 py-1 text-sm font-bold text-amber-900">
                          ₹{Math.round(unpaidTotal / 100)}
                        </span>
                      </div>
                    )}
                    <GuestFoodBillCard
                      orders={unpaidOrders}
                      variant="unpaid"
                      branding={hidePayment ? menuBranding : payBranding}
                      dynamicQr={dynamicQr}
                      hidePayment={hidePayment}
                      billTitle={combined ? "Shared food tab" : undefined}
                      participantNames={combined ? [...new Set(unpaidOrders.map((order) => order.guestName))] : undefined}
                      alwaysExpanded
                    />
                  </div>
                ) : (
                  <div className="rounded-2xl bg-white/95 dark:bg-card/95 p-8 text-center shadow-xl dark:shadow-none backdrop-blur-sm">
                    <p className="text-gray-600 dark:text-gray-400">
                      {paidOrders.length > 0 ? "No open tab — all settled" : "No bills found for this number"}
                    </p>
                  </div>
                )}

                {!viaToken && (
                  <div className="mb-2 text-center">
                    <button type="button" onClick={handleChangeNumber} className="text-sm font-medium text-brand-green">
                      Change number
                    </button>
                  </div>
                )}

                <div className="mt-4 text-center">
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
