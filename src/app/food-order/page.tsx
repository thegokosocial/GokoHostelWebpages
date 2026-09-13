"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import dynamic from "next/dynamic";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import { PhoneEntry, type GuestInfo } from "@/components/food/PhoneEntry";
import type { CartItem } from "@/components/food/MenuBrowser";
import type { CartItemData, GuestInfoData } from "@/components/food/FoodCart";
import { isKitchenOpen, parseKitchenHours, formatSlotsForDisplay } from "@/lib/kitchenHours";
import { foodTaxPercent } from "@/lib/foodLookup";
import { saveFoodGuestSession, loadFoodGuestSession, clearFoodGuestSession } from "@/lib/foodGuestSession";
import { usePanelHistory } from "@/hooks/usePanelHistory";
// import { DarkModeToggle } from "@/components/DarkModeToggle";

const MenuBrowser = dynamic(
  () => import("@/components/food/MenuBrowser").then((m) => m.MenuBrowser),
  { ssr: false },
);
const FoodCart = dynamic(
  () => import("@/components/food/FoodCart").then((m) => m.FoodCart),
  { ssr: false },
);

type View = "loading" | "phone" | "menu" | "cart";

interface PastOrderItem {
  menuItemId: number;
  name: string;
  quantity: number;
  price: number;
  lineTotal: number;
}

interface PastOrder {
  orderNumber: string;
  status: string;
  items: PastOrderItem[];
  total: number;
  createdAt: string;
}

interface MenuSettings {
  kitchenHours: string;
  isBusy: boolean;
  taxRate: number;
  whatsappNumber: string;
  customerWhatsappEnabled: boolean;
  showOutOfStock: boolean;
}

interface MenuCategory {
  id: number;
  name: string;
  nameKannada: string;
  icon: string;
  description: string;
  displayOrder: number;
}

interface MenuItemData {
  id: number;
  categoryId: number;
  name: string;
  nameKannada: string;
  description: string;
  price: number;
  priceText: string;
  tags: string;
  ingredients: string;
  imageUrl: string;
  isAvailable: number;
  displayOrder: number;
}

function loadCartFromStorage(): CartItem[] {
  try {
    const raw = localStorage.getItem("gokoFoodCart");
    if (raw) return JSON.parse(raw);
  } catch {}
  return [];
}

function saveCartToStorage(cart: CartItem[]) {
  try {
    localStorage.setItem("gokoFoodCart", JSON.stringify(cart));
  } catch {}
}

export default function FoodOrderPage() {
  const [view, setView] = useState<View>("loading");
  const [kitchenClosed, setKitchenClosed] = useState(false);
  const [kitchenStatus, setKitchenStatus] = useState<{ nextOpenAt?: string } | null>(null);
  const [settings, setSettings] = useState<MenuSettings | null>(null);
  const [categories, setCategories] = useState<MenuCategory[]>([]);
  const [items, setItems] = useState<MenuItemData[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [guestInfo, setGuestInfo] = useState<GuestInfoData | null>(null);
  const [savedPhone, setSavedPhone] = useState<string | null>(null);
  const [fetchError, setFetchError] = useState("");
  const [pastOrders, setPastOrders] = useState<PastOrder[]>([]);
  const [showMyOrders, setShowMyOrders] = useState(false);
  const [loadingOrders, setLoadingOrders] = useState(false);
  const [reorderToast, setReorderToast] = useState("");

  const [autoReorder, setAutoReorder] = useState(false);
  const viewRef = useRef<View>("loading");
  const isPopStateNav = useRef(false);

  usePanelHistory(showMyOrders, () => setShowMyOrders(false));

  // Sync view changes to browser history for back navigation
  useEffect(() => {
    if (view === "loading") return;
    if (viewRef.current === "loading") {
      viewRef.current = view;
      history.replaceState({ foodView: view }, "");
      return;
    }
    if (isPopStateNav.current) {
      isPopStateNav.current = false;
      return;
    }
    if (view !== viewRef.current) {
      const prev = viewRef.current;
      viewRef.current = view;
      if (prev === "phone" && view === "menu") {
        history.replaceState({ foodView: view }, "");
      } else if (view === "phone") {
        history.replaceState({ foodView: view }, "");
      } else {
        history.pushState({ foodView: view }, "");
      }
    }
  }, [view]);

  useEffect(() => {
    const handlePopState = (e: PopStateEvent) => {
      const state = e.state as { foodView?: View } | null;
      if (state?.foodView && state.foodView !== "phone") {
        isPopStateNav.current = true;
        viewRef.current = state.foodView;
        setView(state.foodView);
      }
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useEffect(() => {
    const stored = loadCartFromStorage();
    if (stored.length > 0) setCart(stored);

    const phone = localStorage.getItem("gokoFoodPhone") || null;
    setSavedPhone(phone);

    const params = new URLSearchParams(window.location.search);
    if (params.get("reorder") === "1" && phone) {
      setAutoReorder(true);
    }

    fetchMenu();
  }, []);

  const fetchMenu = async () => {
    try {
      const res = await fetch("/api/food/menu");
      if (!res.ok) throw new Error("Failed to fetch");
      const data = await res.json();

      setCategories(data.categories || []);
      setItems(data.items || []);
      setSettings(data.settings);

      const s = data.settings as MenuSettings;
      const status = isKitchenOpen(s.kitchenHours);

      if (!status.open) {
        setKitchenClosed(true);
        setKitchenStatus(status);
      }
      setFetchError("");

      const session = loadFoodGuestSession();
      if (session?.phone) {
        setGuestInfo(session);
        setView("menu");
        fetchMyOrders(session.phone);
      } else {
        setView("phone");
      }
    } catch {
      setFetchError("Unable to load menu. Please try again.");
      setView("phone");
    }
  };

  const fetchMyOrders = useCallback(async (phone: string) => {
    setLoadingOrders(true);
    try {
      const res = await fetch(`/api/food/status?phone=${encodeURIComponent(phone)}`);
      if (res.ok) {
        const data = await res.json();
        if (data.found && data.orders) {
          setPastOrders(data.orders);
        }
      }
    } catch {
      // silently ignore
    } finally {
      setLoadingOrders(false);
    }
  }, []);

  const handleIdentified = useCallback((guest: GuestInfo) => {
    const info: GuestInfoData = {
      name: guest.name,
      phone: guest.phone,
      checkinId: guest.checkinId,
      guestType: guest.guestType,
      roomInfo: guest.roomInfo,
    };
    setGuestInfo(info);
    saveFoodGuestSession(info);
    setView("menu");
    if (guest.guestType === "hostel" && guest.phone) {
      fetchMyOrders(guest.phone);
    }
  }, [fetchMyOrders]);

  const handleWalkin = useCallback((phone: string, displayName?: string) => {
    const info: GuestInfoData = {
      name: displayName?.trim() || "",
      phone,
      checkinId: null,
      guestType: "walkin",
      roomInfo: "",
    };
    setGuestInfo(info);
    saveFoodGuestSession(info);
    setView("menu");
  }, []);

  const handleLogout = useCallback(() => {
    clearFoodGuestSession();
    localStorage.removeItem("gokoFoodPhone");
    setGuestInfo(null);
    setSavedPhone(null);
    setPastOrders([]);
    setShowMyOrders(false);
    setView("phone");
  }, []);

  useEffect(() => {
    if (autoReorder && view === "phone" && savedPhone) {
      setAutoReorder(false);
      fetch(`/api/food/lookup?phone=${savedPhone}`)
        .then((r) => r.json())
        .then((data) => {
          if (data.found && data.guests?.length === 1) {
            const g = data.guests[0];
            handleIdentified({ name: g.name, phone: g.phone, checkinId: g.checkinId, guestType: "hostel", roomInfo: g.roomInfo || "" });
          } else if (data.found && data.guests?.length > 1) {
            handleIdentified(data.guests[0]);
          } else {
            handleWalkin(savedPhone, typeof data.displayName === "string" ? data.displayName : undefined);
          }
        })
        .catch(() => {});
    }
  }, [autoReorder, view, savedPhone, handleIdentified, handleWalkin]);

  const handleReorder = useCallback((order: PastOrder) => {
    const skipped: string[] = [];
    const availableIds = new Set(items.filter((i) => i.isAvailable).map((i) => i.id));

    setCart((prev) => {
      let next = [...prev];
      for (const oi of order.items) {
        if (!availableIds.has(oi.menuItemId)) {
          skipped.push(oi.name);
          continue;
        }
        const menuItem = items.find((i) => i.id === oi.menuItemId);
        if (!menuItem) {
          skipped.push(oi.name);
          continue;
        }
        const existing = next.find((c) => c.menuItemId === oi.menuItemId);
        if (existing) {
          next = next.map((c) =>
            c.menuItemId === oi.menuItemId ? { ...c, quantity: c.quantity + oi.quantity } : c
          );
        } else {
          next.push({
            menuItemId: menuItem.id,
            name: menuItem.name,
            nameKannada: menuItem.nameKannada,
            price: menuItem.price,
            quantity: oi.quantity,
            imageUrl: menuItem.imageUrl,
          });
        }
      }
      saveCartToStorage(next);
      return next;
    });

    if (skipped.length > 0) {
      setReorderToast(`Some items unavailable: ${skipped.join(", ")}`);
    } else {
      setReorderToast("Items added to cart!");
    }
    setShowMyOrders(false);
    setTimeout(() => setReorderToast(""), 4000);
  }, [items]);

  const handleAddToCart = useCallback((item: CartItem) => {
    setCart((prev) => {
      const existing = prev.find((c) => c.menuItemId === item.menuItemId);
      let next: CartItem[];
      if (existing) {
        next = prev.map((c) =>
          c.menuItemId === item.menuItemId ? { ...c, quantity: c.quantity + 1 } : c
        );
      } else {
        next = [...prev, { ...item, quantity: 1 }];
      }
      saveCartToStorage(next);
      return next;
    });
  }, []);

  const handleRemoveFromCart = useCallback((menuItemId: number) => {
    setCart((prev) => {
      const existing = prev.find((c) => c.menuItemId === menuItemId);
      if (!existing) return prev;
      let next: CartItem[];
      if (existing.quantity <= 1) {
        next = prev.filter((c) => c.menuItemId !== menuItemId);
      } else {
        next = prev.map((c) =>
          c.menuItemId === menuItemId ? { ...c, quantity: c.quantity - 1 } : c
        );
      }
      saveCartToStorage(next);
      return next;
    });
  }, []);

  const handleUpdateQuantity = useCallback((menuItemId: number, delta: number) => {
    setCart((prev) => {
      const existing = prev.find((c) => c.menuItemId === menuItemId);
      if (!existing) return prev;
      const newQty = existing.quantity + delta;
      let next: CartItem[];
      if (newQty <= 0) {
        next = prev.filter((c) => c.menuItemId !== menuItemId);
      } else {
        next = prev.map((c) =>
          c.menuItemId === menuItemId ? { ...c, quantity: newQty } : c
        );
      }
      saveCartToStorage(next);
      return next;
    });
  }, []);

  const handleRemoveItem = useCallback((menuItemId: number) => {
    setCart((prev) => {
      const next = prev.filter((c) => c.menuItemId !== menuItemId);
      saveCartToStorage(next);
      return next;
    });
  }, []);

  const handleOrderPlaced = useCallback(() => {
    setCart([]);
    saveCartToStorage([]);
  }, []);

  const cartCount = cart.reduce((sum, c) => sum + c.quantity, 0);

  // Loading state
  if (view === "loading") {
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

  return (
    <div className="relative min-h-screen goko-mesh goko-noise bg-brand-sand dark:bg-background">
      {/* Kitchen closed banner */}
      {kitchenClosed && settings && (
        <motion.div
          initial={{ y: -40, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className="sticky top-0 z-40 flex flex-col items-center justify-center gap-0.5 bg-gray-800 px-4 py-2.5 text-center text-white"
        >
          <div className="flex items-center gap-2 text-sm font-medium">
            <span>🌙</span>
            Kitchen is closed
            {kitchenStatus?.nextOpenAt && (
              <span>· Opens at {kitchenStatus.nextOpenAt}</span>
            )}
          </div>
          <p className="text-xs text-gray-300">
            {formatSlotsForDisplay(parseKitchenHours(settings.kitchenHours))} IST
          </p>
        </motion.div>
      )}

      {/* Busy banner */}
      {settings?.isBusy && !kitchenClosed && view !== "phone" && (
        <motion.div
          initial={{ y: -40, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className="sticky top-0 z-40 flex flex-wrap items-center justify-center gap-2 bg-amber-500 px-4 py-2 text-center text-sm font-medium text-white"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          Kitchen is busy — longer wait times expected
        </motion.div>
      )}

      <div className={`mx-auto w-full pb-8 ${view === "menu" ? "max-w-7xl pt-2" : "max-w-lg pt-8"}`}>
        <AnimatePresence mode="wait">
          {view === "phone" && (
            <motion.div
              key="phone"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, x: -50 }}
            >
              <PhoneEntry
                onIdentified={handleIdentified}
                onWalkin={handleWalkin}
                savedPhone={savedPhone || undefined}
              />
              {fetchError && (
                <div className="mt-4 px-4 text-center">
                  <p className="text-sm text-brand-red">{fetchError}</p>
                  <button
                    type="button"
                    onClick={() => {
                      setView("loading");
                      fetchMenu();
                    }}
                    className="mt-2 text-sm font-medium text-brand-green underline"
                  >
                    Try again
                  </button>
                </div>
              )}
              {(guestInfo?.phone || savedPhone) && (
                <div className="mt-4 text-center">
                  <Link
                    href={`/my-bills?phone=${encodeURIComponent(guestInfo?.phone || savedPhone || "")}`}
                    className="text-sm font-medium text-brand-green-dark/70 transition hover:text-brand-green"
                  >
                    View my bills →
                  </Link>
                </div>
              )}
            </motion.div>
          )}

          {view === "menu" && (
            <motion.div
              key="menu"
              initial={{ opacity: 0, x: 50 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -50 }}
            >
              {/* Header */}
              <div className="mb-2 px-3 sm:mb-4 sm:px-4">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <h1 className="truncate text-base font-bold text-brand-green sm:text-lg">
                      {guestInfo?.name?.trim()
                        ? `Hi, ${guestInfo.name.trim().split(" ")[0]}! 👋`
                        : "Welcome! 👋"}
                    </h1>
                    {guestInfo?.roomInfo && (
                      <p className="truncate text-xs text-brand-green-dark/70 sm:text-sm">{guestInfo.roomInfo}</p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-1 sm:gap-2">
                    <Link
                      title="My Bills"
                      href={`/my-bills?phone=${encodeURIComponent(guestInfo?.phone || savedPhone || "")}`}
                      className="flex items-center gap-1.5 rounded-xl bg-brand-green/10 px-2.5 py-2 text-xs font-medium text-brand-green transition hover:bg-brand-green/15 sm:px-3 sm:text-sm"
                    >
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                      </svg>
                      <span className="hidden sm:inline">My Bills</span>
                    </Link>
                    {guestInfo?.guestType === "hostel" && pastOrders.length > 0 && (
                      <button
                        title="My Orders"
                        onClick={() => setShowMyOrders(true)}
                        className="flex items-center gap-1.5 rounded-xl bg-brand-green/10 px-2.5 py-2 text-xs font-medium text-brand-green transition hover:bg-brand-green/15 sm:px-3 sm:text-sm"
                      >
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5h6m-8 4h10m-10 4h6m-6 4h6M5 5h.01M5 9h.01M5 13h.01M5 17h.01" />
                        </svg>
                        <span className="hidden sm:inline">My Orders</span>
                      </button>
                    )}
                    <button
                      type="button"
                      title="Logout"
                      onClick={handleLogout}
                      className="flex items-center gap-1.5 rounded-xl bg-gray-100 dark:bg-muted px-2.5 py-2 text-xs font-medium text-gray-600 dark:text-gray-400 transition hover:bg-gray-200 dark:hover:bg-accent sm:px-3 sm:text-sm"
                    >
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                      </svg>
                      <span className="hidden sm:inline">Logout</span>
                    </button>
                  </div>
                </div>
              </div>

              <div className={`rounded-t-3xl bg-gray-50 dark:bg-background pt-5 ${kitchenClosed ? "pointer-events-none opacity-50" : ""}`}>
                <MenuBrowser
                  categories={categories}
                  items={items}
                  cart={kitchenClosed ? [] : cart}
                  onAddToCart={handleAddToCart}
                  onRemoveFromCart={handleRemoveFromCart}
                />
              </div>
            </motion.div>
          )}

          {view === "cart" && guestInfo && !kitchenClosed && (
            <motion.div
              key="cart"
              initial={{ opacity: 0, x: 50 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -50 }}
            >
              <div className="rounded-t-3xl bg-gray-50 dark:bg-background pt-5">
                <FoodCart
                  cart={cart as CartItemData[]}
                  guestInfo={guestInfo}
                  taxRate={foodTaxPercent(settings?.taxRate)}
                  whatsappNumber={settings?.whatsappNumber || ""}
                  customerWhatsappEnabled={settings?.customerWhatsappEnabled ?? true}
                  onUpdateQuantity={handleUpdateQuantity}
                  onRemoveItem={handleRemoveItem}
                  onOrderPlaced={handleOrderPlaced}
                  onBack={() => history.back()}
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Floating cart button */}
      <AnimatePresence>
      {view === "menu" && cartCount > 0 && !kitchenClosed && (
        <motion.button
          initial={{ y: 100, opacity: 0, scale: 0.9 }}
          animate={{ y: 0, opacity: 1, scale: 1 }}
          exit={{ y: 100, opacity: 0, scale: 0.9 }}
          transition={{ type: "spring", stiffness: 300, damping: 25 }}
          whileTap={{ scale: 0.95 }}
          onClick={() => setView("cart")}
          className="goko-gradient-cta fixed bottom-6 inset-x-4 z-50 mx-auto flex w-max max-w-full items-center gap-3 rounded-2xl px-6 py-4 shadow-2xl"
        >
          <div className="relative">
            <svg className="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 100 4 2 2 0 000-4z" />
            </svg>
            <motion.span
              key={cartCount}
              initial={{ scale: 1.5 }}
              animate={{ scale: 1 }}
              className="absolute -right-2 -top-2 flex h-5 w-5 items-center justify-center rounded-full bg-white text-xs font-bold text-brand-green"
            >
              {cartCount}
            </motion.span>
          </div>
          <span className="text-sm font-bold text-white">View Cart</span>
          <span className="text-sm font-medium text-white/80">
            ₹{Math.round(cart.reduce((s, c) => s + c.price * c.quantity, 0) / 100)}
          </span>
        </motion.button>
      )}
      </AnimatePresence>

      {/* Reorder toast */}
      <AnimatePresence>
        {reorderToast && (
          <motion.div
            initial={{ y: 80, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 80, opacity: 0 }}
            className="fixed bottom-24 inset-x-4 z-[60] mx-auto w-fit max-w-full rounded-xl bg-gray-900 px-4 py-2.5 text-sm text-white shadow-lg break-words text-center"
          >
            {reorderToast}
          </motion.div>
        )}
      </AnimatePresence>

      {/* My Orders slide-up panel */}
      <AnimatePresence>
        {showMyOrders && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowMyOrders(false)}
              className="fixed inset-0 z-[70] bg-black/40"
            />
            <motion.div
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 28, stiffness: 300 }}
              className="fixed inset-x-0 bottom-0 z-[80] max-h-[85vh] overflow-y-auto rounded-t-3xl bg-white dark:bg-card pb-8 shadow-2xl dark:shadow-none"
            >
                <div className="sticky top-0 z-10 bg-white dark:bg-card px-5 pb-3 pt-4 border-b border-transparent dark:border-white/5">
                <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-gray-300 dark:bg-gray-600" />
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-bold text-gray-800 dark:text-foreground">My Orders</h2>
                  <button
                    onClick={() => setShowMyOrders(false)}
                    className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-100 dark:bg-muted text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-accent"
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>

              <div className="px-5">
                {loadingOrders ? (
                  <div className="flex justify-center py-10">
                    <motion.div
                      animate={{ rotate: 360 }}
                      transition={{ repeat: Infinity, duration: 1, ease: "linear" }}
                      className="h-8 w-8 rounded-full border-3 border-gray-200 border-t-brand-green"
                    />
                  </div>
                ) : pastOrders.length === 0 ? (
                  <p className="py-10 text-center text-sm text-gray-400">No past orders found</p>
                ) : (
                  <MyOrdersList orders={pastOrders} onReorder={handleReorder} />
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

function formatOrderDate(dateStr: string): string {
  const d = new Date(dateStr);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);

  const dateOnly = (dt: Date) => dt.toISOString().split("T")[0];
  if (dateOnly(d) === dateOnly(today)) return "Today";
  if (dateOnly(d) === dateOnly(yesterday)) return "Yesterday";
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

const STATUS_COLORS: Record<string, string> = {
  placed: "bg-yellow-100 dark:bg-yellow-900/50 text-yellow-700 dark:text-yellow-400",
  preparing: "bg-brand-green/10 dark:bg-brand-green/20 text-brand-green dark:text-brand-green-dark",
  ready: "bg-green-100 dark:bg-green-900/50 text-green-700 dark:text-green-400",
  served: "bg-gray-100 dark:bg-muted text-gray-600 dark:text-gray-400",
  cancelled: "bg-red-100 dark:bg-red-900/50 text-red-600 dark:text-red-400",
};

function MyOrdersList({ orders, onReorder }: { orders: PastOrder[]; onReorder: (order: PastOrder) => void }) {
  const grouped: Record<string, PastOrder[]> = {};
  for (const o of orders) {
    const key = formatOrderDate(o.createdAt);
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(o);
  }

  return (
    <div className="space-y-5">
      {Object.entries(grouped).map(([date, dateOrders]) => (
        <div key={date}>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">{date}</p>
          <div className="space-y-3">
            {dateOrders.map((order) => (
              <div key={order.orderNumber} className="rounded-xl border border-gray-100 dark:border-border bg-gray-50 dark:bg-muted p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm font-bold text-gray-700 dark:text-gray-300">#{order.orderNumber}</span>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[order.status] || "bg-gray-100 dark:bg-muted text-gray-600 dark:text-gray-400"}`}>
                      {order.status}
                    </span>
                  </div>
                  <span className="text-xs text-gray-400">
                    {new Date(order.createdAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
                  </span>
                </div>

                <div className="mt-2 space-y-0.5">
                  {order.items.map((item, idx) => (
                    <p key={idx} className="text-sm text-gray-600 dark:text-gray-400">
                      {item.quantity}× {item.name}
                      <span className="ml-1 text-gray-400 dark:text-gray-500">₹{Math.round(item.lineTotal / 100)}</span>
                    </p>
                  ))}
                </div>

                <div className="mt-3 flex items-center justify-between">
                  <span className="text-sm font-semibold text-gray-800 dark:text-gray-200">₹{Math.round(order.total / 100)}</span>
                  {order.status !== "cancelled" && (
                    <button
                      onClick={() => onReorder(order)}
                      className="flex items-center gap-1 rounded-lg bg-brand-green/10 dark:bg-brand-green/20 px-3 py-2.5 text-sm font-medium text-brand-green dark:text-brand-green-dark transition hover:bg-brand-green/15 dark:hover:bg-brand-green/30"
                    >
                      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                      Reorder
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
