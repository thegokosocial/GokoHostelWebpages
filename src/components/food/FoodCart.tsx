"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { PrinterIcon, DownloadIcon } from "lucide-react";
import { isBluetoothSupported, printFoodBill } from "@/lib/thermalPrint";
import { generateGuestBill, type GuestBillData, type BillOrder } from "@/components/admin/FoodBillGenerator";
import { useActionProgress } from "@/components/ui/ActionProgressProvider";

export interface CartItemData {
  menuItemId: number;
  name: string;
  nameKannada: string;
  price: number;
  priceOnRequest?: number;
  indicativeMinPrice?: number;
  indicativeMaxPrice?: number;
  priceBasis?: string;
  quantity: number;
  imageUrl: string;
}

export interface GuestInfoData {
  name: string;
  phone: string;
  checkinId: number | null;
  guestType: "hostel" | "walkin";
  roomInfo: string;
}

interface FoodCartProps {
  cart: CartItemData[];
  guestInfo: GuestInfoData;
  taxRate?: number;
  whatsappNumber?: string;
  customerWhatsappEnabled?: boolean;
  onUpdateQuantity: (menuItemId: number, delta: number) => void;
  onRemoveItem: (menuItemId: number) => void;
  onOrderPlaced: (orderNumber: string) => void;
  onBack: () => void;
}

function formatPrice(paise: number): string {
  return `₹${Math.round(paise / 100)}`;
}

function generateUUID(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function FoodCart({
  cart,
  guestInfo,
  taxRate = 5,
  whatsappNumber = "",
  customerWhatsappEnabled = true,
  onUpdateQuantity,
  onRemoveItem,
  onOrderPlaced,
  onBack,
}: FoodCartProps) {
  const [specialInstructions, setSpecialInstructions] = useState("");
  const [itemNotes, setItemNotes] = useState<Record<number, string>>({});
  const [walkinName, setWalkinName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [orderSuccess, setOrderSuccess] = useState<{
    orderNumber: string;
    total: number;
    items: Array<{ name: string; quantity: number; price: number; lineTotal: number }>;
    subtotal: number;
    taxAmount: number;
  } | null>(null);
  const [btSupported, setBtSupported] = useState(false);
  const [printingReceipt, setPrintingReceipt] = useState(false);
  const { runAction } = useActionProgress();

  useEffect(() => { setBtSupported(isBluetoothSupported()); }, []);

  const subtotal = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const taxAmount = Math.round((subtotal * taxRate) / 100);
  const total = subtotal + taxAmount;
  const hasPendingPrice = cart.some((item) => item.priceOnRequest === 1);

  const handlePlaceOrder = async () => {
    const name = guestInfo.guestType === "hostel" ? guestInfo.name : walkinName.trim();
    if (!name) {
      setError("Please enter your name");
      return;
    }

    await runAction("Placing order…", async () => {
      setSubmitting(true);
      setError("");

      const idempotencyKey = generateUUID();

      try {
        const res = await fetch("/api/food/order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          idempotencyKey,
          guestType: guestInfo.guestType,
          checkinId: guestInfo.checkinId,
          guestName: name,
          guestPhone: guestInfo.phone,
          roomInfo: guestInfo.roomInfo,
          specialInstructions,
          items: cart.map((c) => ({ menuItemId: c.menuItemId, quantity: c.quantity, notes: itemNotes[c.menuItemId] || "" })),
          createdBy: "guest",
        }),
        });

        const data = await res.json();

        if (!res.ok) {
          setError(data.message || data.error || "Failed to place order");
          return;
        }

        setOrderSuccess({
          orderNumber: data.orderNumber,
          total: data.total,
          items: cart.map(c => ({
            name: c.name,
            quantity: c.quantity,
            price: c.price,
            lineTotal: c.price * c.quantity,
          })),
          subtotal,
          taxAmount,
        });
        onOrderPlaced(data.orderNumber);

        if (whatsappNumber && customerWhatsappEnabled) {
          const msg = buildWhatsAppMessage(name, data.orderNumber, cart, total, specialInstructions, guestInfo.roomInfo);
          const waUrl = `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(msg)}`;
          window.open(waUrl, "_blank");
        }
      } catch {
        setError("Network error. Please try again.");
      } finally {
        setSubmitting(false);
      }
    });
  };

  if (orderSuccess) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="px-4 pb-24"
      >
        <div className="mx-auto max-w-md rounded-2xl bg-white dark:bg-card p-6 text-center shadow-lg dark:shadow-none">
          <motion.div
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: "spring", stiffness: 300, damping: 20, delay: 0.1 }}
            className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/50"
          >
            <motion.svg
              initial={{ pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: 0.5, delay: 0.3 }}
              className="h-8 w-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </motion.svg>
          </motion.div>
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
            <h2 className="text-xl font-bold text-gray-800 dark:text-foreground">Order Placed!</h2>
            <p className="mt-2 text-gray-600 dark:text-muted-foreground">
              Order #{orderSuccess.orderNumber}
            </p>
            <p className="mt-1 text-2xl font-bold text-gray-800 dark:text-foreground">
              {orderSuccess.items.some((item) => item.price === 0) ? "Price pending" : formatPrice(orderSuccess.total)}
            </p>
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35 }} className="mt-6 space-y-3">
            <a
              href={`/food-order/status?order=${orderSuccess.orderNumber}&phone=${guestInfo.phone}`}
              className="block w-full rounded-xl goko-gradient-cta py-3 text-center font-semibold text-white shadow-lg dark:shadow-none transition-all duration-200 hover:shadow-xl dark:hover:shadow-none hover:-translate-y-0.5"
            >
              Track your order
            </a>
            <a
              href="/food-order?reorder=1"
              className="block w-full rounded-xl border border-gray-200 dark:border-white/10 py-3 text-center font-medium text-gray-700 dark:text-gray-300 transition-all duration-200 hover:bg-gray-50 dark:hover:bg-muted hover:shadow-sm dark:hover:shadow-none"
            >
              Place another order
            </a>
          </motion.div>
        </div>
      </motion.div>
    );
  }

  if (cart.length === 0) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="px-4 pb-24"
      >
        <div className="mx-auto max-w-md rounded-2xl bg-white dark:bg-card p-8 text-center shadow-sm dark:shadow-none">
          <span className="text-4xl">🛒</span>
          <h2 className="mt-3 text-lg font-semibold text-gray-800 dark:text-foreground">Your cart is empty</h2>
          <p className="mt-1 text-sm text-gray-500 dark:text-muted-foreground">Browse the menu and add some dishes</p>
          <button
            onClick={onBack}
            className="mt-5 rounded-xl bg-gray-100 dark:bg-muted px-6 py-2.5 text-sm font-medium text-gray-700 dark:text-gray-300 transition hover:bg-gray-200 dark:hover:bg-accent"
          >
            Browse menu
          </button>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="mx-auto max-w-lg px-4 pb-24"
    >
      <div className="mb-4 flex items-center gap-3">
        <button
          onClick={onBack}
          className="flex h-11 w-11 items-center justify-center rounded-full bg-gray-100 dark:bg-muted text-gray-600 dark:text-foreground transition hover:bg-gray-200 dark:hover:bg-accent"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <h2 className="text-xl font-bold text-gray-800 dark:text-foreground">Your Order</h2>
      </div>

      {/* Cart Items */}
      <div className="space-y-2">
        <AnimatePresence>
          {cart.map((item) => (
            <motion.div
              key={item.menuItemId}
              layout
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20, height: 0 }}
              className="flex items-center gap-3 rounded-xl border border-gray-100 dark:border-border bg-white dark:bg-card p-3 shadow-sm dark:shadow-none"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-gray-800 dark:text-foreground">{item.name}</p>
                {item.nameKannada && (
                  <p className="truncate text-xs text-gray-500">{item.nameKannada}</p>
                )}
                <p className="mt-0.5 text-xs text-gray-400">{item.priceOnRequest === 1 ? (item.indicativeMinPrice && item.indicativeMaxPrice ? `₹${Math.round(item.indicativeMinPrice / 100)}–₹${Math.round(item.indicativeMaxPrice / 100)} approx. ${item.priceBasis || "per portion"}` : "Check with staff for price") : `${formatPrice(item.price)} each`}</p>
                {item.priceOnRequest === 1 && <input value={itemNotes[item.menuItemId] || ""} onChange={(e) => setItemNotes((prev) => ({ ...prev, [item.menuItemId]: e.target.value.slice(0, 500) }))} placeholder="Size or weight (optional)" className="mt-1 w-full rounded border border-gray-200 bg-transparent px-2 py-1 text-xs text-gray-600 outline-none focus:border-brand-green" />}
              </div>

              <div className="flex items-center gap-2 rounded-lg border border-gray-200 dark:border-white/10 px-1.5 py-0.5">
                <motion.button
                  whileTap={{ scale: 0.85 }}
                  onClick={() => onUpdateQuantity(item.menuItemId, -1)}
                  className="flex h-10 w-10 items-center justify-center rounded-md text-gray-600 dark:text-gray-400 transition-colors hover:bg-gray-100 dark:hover:bg-muted"
                >
                  −
                </motion.button>
                <motion.span key={item.quantity} initial={{ scale: 1.3 }} animate={{ scale: 1 }} className="min-w-[16px] text-center text-sm font-semibold">{item.quantity}</motion.span>
                <motion.button
                  whileTap={{ scale: 0.85 }}
                  onClick={() => onUpdateQuantity(item.menuItemId, 1)}
                  className="flex h-10 w-10 items-center justify-center rounded-md text-gray-600 dark:text-gray-400 transition-colors hover:bg-gray-100 dark:hover:bg-muted"
                >
                  +
                </motion.button>
              </div>

              <span className="w-14 text-right text-sm font-semibold text-gray-800 dark:text-gray-200">
                {item.priceOnRequest === 1 ? "Pending" : formatPrice(item.price * item.quantity)}
              </span>

              <button
                onClick={() => onRemoveItem(item.menuItemId)}
                className="flex h-10 w-10 items-center justify-center rounded-full text-gray-400 transition hover:bg-red-50 dark:hover:bg-red-950 hover:text-red-500"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* Totals */}
      <div className="mt-4 rounded-xl border border-gray-100 dark:border-border bg-white dark:bg-card p-4 shadow-sm dark:shadow-none">
        <div className="flex justify-between text-sm text-gray-600 dark:text-muted-foreground">
          <span>Subtotal</span>
          <span>{hasPendingPrice ? `${formatPrice(subtotal)} + pending` : formatPrice(subtotal)}</span>
        </div>
        {taxRate > 0 && (
          <div className="mt-1 flex justify-between text-sm text-gray-600 dark:text-muted-foreground">
            <span>Tax ({taxRate}%)</span>
            <span>{hasPendingPrice ? "Pending" : formatPrice(taxAmount)}</span>
          </div>
        )}
        <div className="mt-2 border-t border-gray-100 dark:border-border pt-2">
          <div className="flex justify-between text-base font-bold text-gray-800 dark:text-foreground">
            <span>Total</span>
            <span>{hasPendingPrice ? "Pending price" : formatPrice(total)}</span>
          </div>
        </div>
      </div>

      {/* Checkout Form */}
      <div className="mt-4 rounded-xl border border-gray-100 dark:border-border bg-white dark:bg-card p-4 shadow-sm dark:shadow-none">
        {guestInfo.guestType === "hostel" ? (
          <div className="mb-3 rounded-lg bg-brand-green/10 dark:bg-brand-green/20 p-3">
            <p className="text-sm font-medium text-brand-green-dark dark:text-brand-green">{guestInfo.name}</p>
            {guestInfo.roomInfo && (
              <p className="text-xs text-brand-green dark:text-brand-green-dark">{guestInfo.roomInfo}</p>
            )}
            <p className="text-xs text-brand-green/80 dark:text-brand-green-dark">Charged to room tab</p>
          </div>
        ) : (
          <div className="mb-3">
            <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-muted-foreground">Your Name *</label>
            <input
              type="text"
              value={walkinName}
              onChange={(e) => {
                setWalkinName(e.target.value);
                setError("");
              }}
              placeholder="Enter your name"
              className="w-full rounded-lg border border-gray-200 dark:border-border bg-gray-50 dark:bg-muted px-3 py-2.5 text-sm dark:text-foreground outline-none transition focus:border-brand-green focus:bg-white dark:focus:bg-accent focus-visible:goko-focus"
            />
          </div>
        )}

        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-muted-foreground">Special Instructions</label>
          <textarea
            value={specialInstructions}
            onChange={(e) => setSpecialInstructions(e.target.value)}
            placeholder="Any dietary needs or requests…"
            rows={2}
            className="w-full resize-none rounded-lg border border-gray-200 dark:border-border bg-gray-50 dark:bg-muted px-3 py-2.5 text-sm dark:text-foreground outline-none transition focus:border-brand-green focus:bg-white dark:focus:bg-accent focus-visible:goko-focus"
          />
        </div>
      </div>

      {error && (
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="mt-3 rounded-lg bg-red-50 dark:bg-red-950 px-3 py-2 text-sm text-red-600 dark:text-red-400"
        >
          {error}
        </motion.p>
      )}

      <button
        onClick={handlePlaceOrder}
        disabled={submitting}
        className="goko-gradient-cta mt-5 w-full rounded-xl py-4 text-base font-bold text-white shadow-lg dark:shadow-none transition hover:shadow-xl dark:hover:shadow-none disabled:opacity-50"
      >
        {submitting ? (
          <span className="flex items-center justify-center gap-2">
            <svg className="h-5 w-5 animate-spin" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            Placing order…
          </span>
        ) : (
          `Place Order${hasPendingPrice ? "" : ` — ${formatPrice(total)}`}`
        )}
      </button>
    </motion.div>
  );
}

function buildWhatsAppMessage(
  name: string,
  orderNumber: string,
  cart: CartItemData[],
  total: number,
  instructions: string,
  roomInfo: string
): string {
  let msg = `🍽️ *New Food Order #${orderNumber}*\n\n`;
  msg += `👤 ${name}`;
  if (roomInfo) msg += ` (${roomInfo})`;
  msg += "\n\n";

  msg += "*Items:*\n";
  for (const item of cart) {
    msg += `• ${item.name} x${item.quantity} — ${item.price ? `₹${Math.round((item.price * item.quantity) / 100)}` : "Price pending"}\n`;
  }
  msg += `\n*Total: ${cart.some((item) => !item.price) ? "Price pending" : `₹${Math.round(total / 100)}`}*`;

  if (instructions) {
    msg += `\n\n📝 ${instructions}`;
  }

  return msg;
}
