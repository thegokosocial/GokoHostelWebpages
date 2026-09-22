"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { STATUS_STEPS, stepperIndex, shouldPollOrderStatus } from "@/lib/orderStatus";

interface OrderItem {
  name: string;
  price: number;
  quantity: number;
  lineTotal: number;
  pricingStatus?: string;
  notes?: string;
}

interface OrderData {
  orderNumber: string;
  status: string;
  guestName: string;
  items: OrderItem[];
  subtotal: number;
  tax: number;
  total: number;
  discount: number;
  specialInstructions: string;
  createdAt: string;
}

const STATUS_LABELS: Record<string, string> = {
  pending_approval: "Confirming",
  placed: "Placed",
  preparing: "Preparing",
  ready: "Ready",
  served: "Served",
};
const STATUS_ICONS: Record<string, string> = {
  pending_approval: "⏳",
  placed: "📋",
  preparing: "👨‍🍳",
  ready: "✅",
  served: "🍽️",
};
const STATUS_MESSAGES: Record<string, string> = {
  pending_approval: "Waiting for staff to confirm your order",
  placed: "Your order has been received",
  preparing: "The kitchen is preparing your food",
  ready: "Your order is ready for pickup!",
  served: "Enjoy your meal!",
};

function formatPrice(paise: number): string {
  return `₹${Math.round(paise / 100)}`;
}

function getElapsedTime(createdAt: string): string {
  const created = new Date(createdAt);
  const now = new Date();
  const diffMs = now.getTime() - created.getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${mins % 60}m ago`;
}

function OrderStatusContent() {
  const searchParams = useSearchParams();
  const orderNumber = searchParams.get("order") || "";
  const phoneParam = searchParams.get("phone") || "";

  const [phone, setPhone] = useState(phoneParam);
  const [phoneReady, setPhoneReady] = useState(!!phoneParam);
  const [order, setOrder] = useState<OrderData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [elapsed, setElapsed] = useState("");

  useEffect(() => {
    if (phoneParam) {
      setPhone(phoneParam);
      setPhoneReady(true);
      return;
    }
    setPhone(localStorage.getItem("gokoFoodPhone") || "");
    setPhoneReady(true);
  }, [phoneParam]);

  const fetchStatus = useCallback(async () => {
    if (!orderNumber || !phone) {
      setError("Missing order or phone info");
      setLoading(false);
      return;
    }

    try {
      const res = await fetch(
        `/api/food/status?order=${encodeURIComponent(orderNumber)}&phone=${encodeURIComponent(phone)}`
      );
      const data = await res.json();

      if (data.found) {
        setOrder(data.order);
        setElapsed(getElapsedTime(data.order.createdAt));
        setError("");
      } else {
        setError("Order not found");
      }
    } catch {
      setError("Failed to load order status");
    } finally {
      setLoading(false);
    }
  }, [orderNumber, phone]);

  useEffect(() => {
    if (!phoneReady) return;
    fetchStatus();
  }, [phoneReady, fetchStatus]);

  useEffect(() => {
    const status = order?.status;
    if (!status || !shouldPollOrderStatus(status, false)) return;
    const tick = () => {
      if (shouldPollOrderStatus(status, document.hidden)) fetchStatus();
    };
    const interval = setInterval(tick, 10000);
    const onVis = () => {
      if (shouldPollOrderStatus(status, document.hidden)) fetchStatus();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [order?.status, fetchStatus]);

  useEffect(() => {
    if (!order) return;
    const timer = setInterval(() => {
      setElapsed(getElapsedTime(order.createdAt));
    }, 30000);
    return () => clearInterval(timer);
  }, [order]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center goko-mesh goko-noise bg-brand-sand dark:bg-background">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ repeat: Infinity, duration: 1, ease: "linear" }}
          className="h-10 w-10 rounded-full border-4 border-brand-green/20 border-t-brand-green"
        />
      </div>
    );
  }

  if (error || !order) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center goko-mesh goko-noise bg-brand-sand dark:bg-background p-6">
        <div className="max-w-sm rounded-2xl bg-white/95 dark:bg-card/95 p-8 text-center shadow-xl dark:shadow-none">
          <span className="text-4xl">😕</span>
          <h1 className="mt-4 text-xl font-bold text-gray-800 dark:text-gray-200">
            {error || "Order not found"}
          </h1>
          <a
            href="/food-order"
            className="mt-6 inline-block rounded-xl goko-gradient-cta px-6 py-3 font-semibold text-white shadow-lg dark:shadow-none"
          >
            Place an order
          </a>
        </div>
      </div>
    );
  }

  const isCancelled = order.status === "cancelled";
  const currentStepIndex = stepperIndex(order.status);
  const statusMessage = STATUS_MESSAGES[order.status] || "We are checking the latest status of your order";

  return (
    <div className="min-h-screen goko-mesh goko-noise bg-brand-sand dark:bg-background p-4 pt-8">
      <div className="mx-auto max-w-lg">
        {/* Header */}
        <div className="mb-6 text-center">
          <h1 className="text-xl font-bold text-brand-green">Order #{order.orderNumber}</h1>
          <p className="mt-1 text-sm text-brand-green-dark/70">{elapsed}</p>
        </div>

        {/* Progress stepper */}
        <div className="mb-6 rounded-2xl bg-white/95 dark:bg-card/95 p-5 shadow-xl dark:shadow-none backdrop-blur-sm">
          {isCancelled ? (
            <div className="rounded-xl bg-brand-red/10 p-4 text-center" role="status">
              <div className="text-3xl" aria-hidden="true">✕</div>
              <p className="mt-2 text-sm font-semibold text-brand-red">This order was cancelled</p>
            </div>
          ) : (
          <>
          <div className="relative flex justify-between">
            {/* Connecting line */}
            <div className="absolute left-0 right-0 top-5 h-0.5 bg-gray-200 dark:bg-white/10" />
            <div
              className={`absolute left-0 top-5 h-0.5 transition-all duration-500 ${isCancelled ? "bg-brand-red/40" : "bg-brand-green"}`}
              style={{
                width: `${Math.max(0, (currentStepIndex / (STATUS_STEPS.length - 1)) * 100)}%`,
              }}
            />

            {STATUS_STEPS.map((step, idx) => {
              const isActive = idx <= currentStepIndex;
              const isCurrent = idx === currentStepIndex;
              return (
                <div key={step} className="relative z-10 flex flex-col items-center">
                  <motion.div
                    animate={isCurrent ? { scale: [1, 1.1, 1] } : {}}
                    transition={isCurrent ? { repeat: Infinity, duration: 2 } : {}}
                    className={`flex h-10 w-10 items-center justify-center rounded-full text-lg ${
                      isActive
                        ? "goko-gradient-cta shadow-md dark:shadow-none"
                        : "bg-gray-100 dark:bg-muted"
                    }`}
                  >
                    {STATUS_ICONS[step]}
                  </motion.div>
                  <span
                    className={`mt-2 text-[11px] font-medium sm:text-xs ${
                      isActive ? "text-brand-green dark:text-brand-green-dark" : "text-gray-400 dark:text-gray-500"
                    }`}
                  >
                    {STATUS_LABELS[step]}
                  </span>
                </div>
              );
            })}
          </div>

          <div className="mt-5 rounded-xl bg-brand-green/10 p-3 text-center dark:bg-brand-green/20">
            <p className="text-sm font-medium text-brand-green-dark dark:text-brand-green">{statusMessage}</p>
          </div>
          </>
          )}
        </div>

        {/* Order details */}
        <div className="rounded-2xl bg-white/95 dark:bg-card/95 p-5 shadow-xl dark:shadow-none backdrop-blur-sm">
          <h3 className="mb-3 text-sm font-semibold text-gray-800 dark:text-gray-200">Order Details</h3>
          <div className="space-y-2">
            {order.items.map((item, idx) => (
              <div key={idx} className="flex items-center justify-between gap-2 text-sm">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="min-w-0 truncate text-gray-600 dark:text-gray-400">
                    {item.name} × {item.quantity}
                  </span>
                </div>
                <span className="font-medium text-gray-800 dark:text-gray-200">{item.pricingStatus === "pending" ? "Price pending" : formatPrice(item.lineTotal)}</span>
              </div>
            ))}
          </div>

          <div className="mt-3 border-t border-gray-100 dark:border-white/10 pt-3">
            <div className="flex justify-between text-sm text-gray-600 dark:text-gray-400">
              <span>Subtotal</span>
              <span>{formatPrice(order.subtotal + (order.discount || 0))}</span>
            </div>
            {order.discount > 0 && (
              <div className="flex justify-between text-sm text-green-600">
                <span>Discount</span>
                <span>-{formatPrice(order.discount)}</span>
              </div>
            )}
            <div className="flex justify-between text-sm text-gray-600 dark:text-gray-400">
              <span>Tax</span>
              <span>{formatPrice(order.tax)}</span>
            </div>
            <div className="mt-1 flex justify-between font-bold text-gray-800 dark:text-gray-200">
              <span>Total</span>
              <span>{order.items.some((item) => item.pricingStatus === "pending") ? "Price pending" : formatPrice(order.total)}</span>
            </div>
          </div>

          {order.specialInstructions && (
            <div className="mt-3 rounded-lg bg-gray-50 dark:bg-muted p-2.5">
              <p className="text-xs text-gray-500 dark:text-gray-400">Special instructions</p>
              <p className="text-sm text-gray-700 dark:text-gray-300">{order.specialInstructions}</p>
            </div>
          )}
        </div>

        {/* Action */}
        <div className="mt-6 text-center">
          <a
            href="/food-order?reorder=1"
            className="inline-block rounded-xl bg-brand-green/10 px-6 py-3 text-sm font-semibold text-brand-green transition hover:bg-brand-green/15"
          >
            Place another order
          </a>
        </div>
      </div>
    </div>
  );
}

export default function OrderStatusPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center goko-mesh goko-noise bg-brand-sand dark:bg-background">
          <div className="text-brand-green text-lg">Loading order status...</div>
        </div>
      }
    >
      <OrderStatusContent />
    </Suspense>
  );
}
