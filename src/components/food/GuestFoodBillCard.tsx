"use client";

import { type ReactNode } from "react";
import {
  DEFAULT_BILL_BRANDING,
  billPaymentStatusLabel,
  formatGstRateLabel,
  mergeBillLineItems,
  payableBillItems,
  splitGstPaise,
  splitGstRate,
} from "@/lib/foodBillFormat";
import { foodTaxRateFromAmounts } from "@/lib/foodLookup";

export type GuestFoodBillItem = {
  name?: string;
  itemName?: string;
  quantity: number;
  price?: number;
  itemPrice?: number;
  lineTotal: number;
  status?: string;
  pricingStatus?: string;
};

export type GuestFoodBillOrder = {
  guestName?: string;
  roomInfo?: string | null;
  paymentStatus?: string;
  amountPaid?: number;
  paymentMethod?: string | null;
  createdAt: string;
  subtotal: number;
  tax: number;
  total: number;
  discount?: number;
  items: GuestFoodBillItem[];
};

export type GuestFoodBillBranding = {
  hostelName: string;
  location: string;
  accent: string;
  upiId?: string;
  qrUrl?: string;
  footer?: string;
  taxRate?: number;
};

function formatRupees(paise: number): string {
  return `₹${(paise / 100).toFixed(2)}`;
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

/** Shared guest food tab layout (My Bills + admin Bill drawer). */
export function GuestFoodBillCard({
  orders,
  variant,
  branding,
  alwaysExpanded = false,
  expanded,
  onToggle,
  footerActions,
  paymentDue,
  className = "",
}: {
  orders: GuestFoodBillOrder[];
  variant: "unpaid" | "paid";
  branding: GuestFoodBillBranding;
  alwaysExpanded?: boolean;
  expanded?: boolean;
  onToggle?: () => void;
  footerActions?: ReactNode;
  paymentDue?: number;
  className?: string;
}) {
  const accent = branding.accent || DEFAULT_BILL_BRANDING.accent;
  const subtotal = orders.reduce((s, o) => s + o.subtotal, 0);
  const tax = orders.reduce((s, o) => s + o.tax, 0);
  const total = orders.reduce((s, o) => s + o.total, 0);
  const discount = orders.reduce((s, o) => s + (o.discount || 0), 0);
  const due = paymentDue ?? orders.reduce((s, o) => s + Math.max(0, o.total - (o.amountPaid || 0)), 0);
  const items = mergeBillLineItems(
    orders.flatMap((o) =>
      (variant === "unpaid" ? payableBillItems(o.items, o.amountPaid || 0, o.total) : o.items)
        .filter((i) => i.pricingStatus !== "pending" && i.status !== "voided")
        .map((i) => ({
          name: i.itemName || i.name,
          quantity: i.quantity,
          price: i.itemPrice ?? i.price,
          lineTotal: i.lineTotal,
          status: i.status || "active",
        })),
    ),
  );
  const pendingItems = orders.flatMap((o) =>
    o.items.filter((i) => i.status !== "voided" && i.pricingStatus === "pending"),
  );
  const pendingPrice = pendingItems.length > 0;
  const { cgst, sgst } = splitGstPaise(tax);
  const rateForLabels = tax > 0 ? foodTaxRateFromAmounts(subtotal, tax) : (branding.taxRate || 0);
  const { cgstRate, sgstRate } = splitGstRate(rateForLabels);
  const showPayment = variant === "unpaid" && due > 0 && !!(branding.qrUrl || branding.upiId);
  const guestName = orders[0]?.guestName;
  const roomInfo = orders.find((o) => o.roomInfo)?.roomInfo;
  const latest = orders.reduce((a, b) => (a.createdAt > b.createdAt ? a : b), orders[0]);
  const badgeLabel = variant === "paid" ? "Paid" : billPaymentStatusLabel(orders[0]?.paymentStatus || "on_tab");
  const isExpanded = alwaysExpanded || !!expanded;

  const body = (
    <div className={`${alwaysExpanded ? "" : "border-t border-zinc-100 dark:border-white/10"} px-4 pb-4 pt-3`}>
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
            <span className="text-zinc-700 dark:text-zinc-300">{item.itemName || item.name}</span>
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
          <span>{pendingPrice ? "Price pending" : formatRupees(variant === "unpaid" ? due : total)}</span>
        </div>
        {due !== total && !pendingPrice && (
          <div className="flex justify-between text-sm font-bold text-orange-700 dark:text-orange-400">
            <span>Amount Due</span>
            <span>{formatRupees(due)}</span>
          </div>
        )}
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
              {formatRupees(due)}
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

      {footerActions && <div className="mt-4 flex flex-wrap gap-2">{footerActions}</div>}
    </div>
  );

  return (
    <div
      className={`overflow-hidden rounded-2xl border border-black/5 bg-white shadow-sm dark:border-white/10 dark:bg-card ${variant === "paid" ? "opacity-90" : ""} ${className}`}
    >
      <div className="flex overflow-hidden">
        <div className="w-1.5 shrink-0" style={{ backgroundColor: accent }} />
        <div className="flex-1 bg-[#F7F4EF] px-4 py-3 dark:bg-zinc-900/60">
          <p className="text-base font-bold text-zinc-900 dark:text-zinc-100">{branding.hostelName}</p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">{branding.location}</p>
        </div>
      </div>

      {alwaysExpanded ? (
        <div className="px-4 py-3">
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
          {latest && (
            <p className="text-xs text-zinc-400">
              {formatDate(latest.createdAt)} · {formatTime(latest.createdAt)}
            </p>
          )}
          <p className="mt-1 text-sm font-semibold text-zinc-800 dark:text-zinc-100">
            {pendingPrice ? "Price pending" : `₹${Math.round((variant === "unpaid" ? due : total) / 100)}`}
          </p>
        </div>
      ) : (
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
            {latest && (
              <p className="text-xs text-zinc-400">
                {formatDate(latest.createdAt)} · {formatTime(latest.createdAt)}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">
              {pendingPrice ? "Price pending" : `₹${Math.round((variant === "unpaid" ? due : total) / 100)}`}
            </span>
            <svg
              className={`h-4 w-4 text-zinc-400 transition-transform ${isExpanded ? "rotate-180" : ""}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </div>
        </button>
      )}

      {isExpanded && body}
    </div>
  );
}

export function groupHasPendingSpecialPrice(orders: GuestFoodBillOrder[]): boolean {
  return orders.some((o) =>
    o.items.some((i) => i.status !== "voided" && i.pricingStatus === "pending"),
  );
}
