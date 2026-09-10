"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import dynamic from "next/dynamic";
import { motion } from "framer-motion";
import { cn, localDateStr } from "@/lib/utils";
import { Loader2Icon, RefreshCwIcon, XIcon, PlusIcon, MinusIcon, SearchIcon, ChevronDownIcon, ChevronRightIcon, BanknoteIcon, SmartphoneIcon, PrinterIcon, DownloadIcon, HistoryIcon, PencilIcon, TagIcon } from "lucide-react";
import { isBluetoothSupported, printFoodBill, printCombinedBill, printOrderTicket, type BillItem } from "@/lib/thermalPrint";
import { generateGuestBill, generateCombinedBill, type CombinedBillData, type BillOrder } from "@/components/admin/FoodBillGenerator";
import type { Role } from "./types";
import { hasPermission } from "./types";
import { useTabWithHistory } from "@/hooks/useTabWithHistory";
import { useAdminToast } from "@/components/admin/AdminToast";
import { usePanelHistory } from "@/hooks/usePanelHistory";
import { RecordPaymentModal, PaymentDetailLabel } from "@/components/admin/RecordPaymentModal";
import { foodTaxPercent, foodTaxRateFromAmounts } from "@/lib/foodLookup";

type FoodTab = "summary" | "place" | "combined" | "payment" | "active";

const KitchenDashboard = dynamic(() => import("@/components/kitchen/KitchenDashboard").then((m) => m.KitchenDashboard), {
  loading: () => <div className="flex items-center justify-center py-20"><div className="h-6 w-6 animate-spin rounded-full border-2 border-brand-green-dark border-t-transparent" /></div>,
  ssr: false,
});

export interface OrderItem {
  id: number;
  menuItemId: number;
  itemName: string;
  itemPrice: number;
  quantity: number;
  lineTotal: number;
  status: string;
}

export interface Order {
  id: number;
  orderNumber: string;
  guestType: string;
  checkinId: number | null;
  guestName: string;
  guestPhone: string;
  roomInfo: string;
  specialInstructions: string;
  subtotal: number;
  tax: number;
  total: number;
  status: string;
  paymentStatus: string;
  paymentMethod: string;
  paidBy: string;
  cashReceived: number;
  changeGiven: number;
  discount: number;
  discountReason: string;
  discountBy: string;
  cancelledReason: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  items: OrderItem[];
  hasModifications?: boolean;
}

export interface OrderModification {
  action: string;
  itemName: string;
  oldValue: string;
  newValue: string;
  reason: string;
  modifiedBy: string;
  createdAt: string;
}

interface Guest {
  id: number;
  name: string;
  contact: string;
  arrivalDate: string;
  stayingDays: string;
  bedInfo: string;
  checkedOut?: boolean;
}

interface GuestWithTab {
  checkinId: number;
  name: string;
  contact: string;
  bedInfo: string;
  tabTotal: number;
  orderCount: number;
  latestOrderTime: string;
  hasModifications?: boolean;
}

interface MenuItem {
  id: number;
  categoryId: number;
  name: string;
  nameKannada: string;
  description: string;
  price: number;
  priceText: string;
  tags: string;
  isAvailable: number;
}

interface MenuCategory {
  id: number;
  name: string;
  nameKannada: string;
  icon: string;
  displayOrder: number;
  discountExempt?: number;
}

interface CartItem {
  menuItemId: number;
  name: string;
  price: number;
  quantity: number;
}

interface PrefillGuest {
  guestType: "hostel" | "walkin" | "table";
  checkinId?: number;
  guestName: string;
  guestPhone?: string;
  roomInfo?: string;
}

export function AdminFoodOrders({ password, username, role, permissions = {} }: { password: string; username?: string; role: Role; permissions?: Record<string, boolean> }) {
  const { showError, showSuccess } = useAdminToast();
  const [prefillGuest, setPrefillGuest] = useState<PrefillGuest | null>(null);

  const apiCall = useCallback(async (body: Record<string, any>) => {
    const payload: Record<string, any> = { password, ...body };
    if (username) payload.username = username;
    const res = await fetch("/api/admin/food-orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return res;
  }, [password, username]);

  const TAB_PERMISSIONS: Record<FoodTab, string> = {
    summary: "canViewTabs",
    place: "canPlaceOrders",
    combined: "canGenerateBills",
    payment: "canMarkPaid",
    active: "canViewFoodOrders",
  };

  const TABS = ([
    { id: "summary" as FoodTab, label: "Order Summary" },
    { id: "place" as FoodTab, label: "Place Order" },
    { id: "combined" as FoodTab, label: "Combined Bill" },
    { id: "payment" as FoodTab, label: "Payment Summary" },
    { id: "active" as FoodTab, label: "Active Orders" },
  ] as { id: FoodTab; label: string }[]).filter((t) => hasPermission(role, permissions, TAB_PERMISSIONS[t.id]));

  const [tab, setTab] = useTabWithHistory<FoodTab>("tab", TABS[0]?.id || "summary");

  return (
    <div>
      {/* Tab buttons */}
      <div className="mb-4 flex flex-wrap gap-1 rounded-xl border border-brand-mist bg-white dark:bg-card p-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={cn(
              "relative rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              tab === t.id ? "text-white" : "text-brand-green-dark/70 hover:bg-brand-green/[0.06]"
            )}
          >
            {tab === t.id && (
              <motion.span layoutId="food-orders-tab-pill" className="absolute inset-0 rounded-lg bg-brand-green" transition={{ type: "spring", stiffness: 400, damping: 30 }} />
            )}
            <span className="relative z-10">{t.label}</span>
          </button>
        ))}
      </div>

      {tab === "active" && (
        <div className="-mx-4 -mb-4 sm:-mx-6 sm:-mb-6 lg:-mx-8 lg:-mb-8">
          <KitchenDashboard password={password} onLogout={() => {}} />
        </div>
      )}
      {tab === "place" && <PlaceOrder apiCall={apiCall} prefillGuest={prefillGuest} onPrefillConsumed={() => setPrefillGuest(null)} onOrderPlaced={() => setTab("summary")} />}
      {tab === "summary" && <OrderSummary apiCall={apiCall} password={password} username={username} onOrderMore={(guest) => { setPrefillGuest(guest); setTab("place"); }} onAddNewOrder={() => setTab("place")} role={role} permissions={permissions} />}
      {tab === "combined" && <CombinedBill apiCall={apiCall} />}
      {tab === "payment" && <PaymentSummary apiCall={apiCall} password={password} username={username} />}
    </div>
  );
}

// ─── Place Order ─────────────────────────────────────────────────────────────

function PlaceOrder({ apiCall, prefillGuest, onPrefillConsumed, onOrderPlaced }: { apiCall: (body: any) => Promise<Response>; prefillGuest: PrefillGuest | null; onPrefillConsumed: () => void; onOrderPlaced?: () => void }) {
  const [guestType, setGuestType] = useState<"hostel" | "walkin" | "table">(prefillGuest?.guestType || "hostel");
  const [cafeTableCount, setCafeTableCount] = useState(0);
  const [selectedTable, setSelectedTable] = useState<number | null>(null);
  const [tableGuestName, setTableGuestName] = useState("");
  const [tableSessionId, setTableSessionId] = useState("");
  const [guests, setGuests] = useState<Guest[]>([]);
  const [selectedGuest, setSelectedGuest] = useState<Guest | null>(null);
  const [guestSearch, setGuestSearch] = useState("");
  const [walkinName, setWalkinName] = useState(prefillGuest?.guestType === "walkin" ? prefillGuest.guestName : "");
  const [walkinPhone, setWalkinPhone] = useState(prefillGuest?.guestType === "walkin" ? (prefillGuest.guestPhone || "") : "");
  const [categories, setCategories] = useState<MenuCategory[]>([]);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<number | null>(null);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [specialInstructions, setSpecialInstructions] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [successMsg, setSuccessMsg] = useState("");
  const [error, setError] = useState("");
  const [loadingMenu, setLoadingMenu] = useState(true);
  const [menuSearch, setMenuSearch] = useState("");
  const [confirmWithGuest, setConfirmWithGuest] = useState(false);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [occupiedTables, setOccupiedTables] = useState<Map<number, string>>(new Map());
  const [taxRate, setTaxRate] = useState(5);
  const cartRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    (async () => {
      const menuRes = await apiCall({ action: "getMenu" });
      if (menuRes.ok) {
        const data = await menuRes.json();
        setCategories(data.categories || []);
        setMenuItems(data.items || []);
        if (data.categories?.length > 0) setSelectedCategory(data.categories[0].id);
        setCafeTableCount(parseInt(data.cafeTableCount) || 0);
        setConfirmWithGuest(data.confirmWithGuest === true);
        if (data.taxRate != null) setTaxRate(foodTaxPercent(data.taxRate));
      }
      setLoadingMenu(false);
    })();
    (async () => {
      const res = await apiCall({ action: "getWalkinOrders" });
      if (res.ok) {
        const data = await res.json();
        const tableMap = new Map<number, string>();
        for (const order of (data.orders || [])) {
          const match = order.roomInfo?.match(/^Table (\d+)$/i);
          if (match) {
            const tableNum = parseInt(match[1], 10);
            if (!tableMap.has(tableNum)) {
              tableMap.set(tableNum, order.guestName || `Table ${tableNum}`);
            }
          }
        }
        setOccupiedTables(tableMap);
      }
    })();
  }, [apiCall]);

  useEffect(() => {
    if (guestType === "hostel") {
      (async () => {
        const res = await apiCall({ action: "getActiveGuests" });
        if (res.ok) {
          const data = await res.json();
          setGuests(data.guests || []);
          if (prefillGuest?.guestType === "hostel" && prefillGuest.checkinId) {
            const match = (data.guests as Guest[]).find((g) => g.id === prefillGuest.checkinId);
            if (match) {
              setSelectedGuest(match);
            } else {
              // Checked-out guest: create a synthetic guest entry from prefill data
              setSelectedGuest({
                id: prefillGuest.checkinId,
                name: prefillGuest.guestName,
                contact: prefillGuest.guestPhone || "",
                arrivalDate: "",
                stayingDays: "",
                bedInfo: prefillGuest.roomInfo || "",
              });
            }
            onPrefillConsumed();
          }
        }
      })();
    }
  }, [guestType, apiCall]);

  useEffect(() => {
    if (prefillGuest?.guestType === "table") {
      setGuestType("table");
      const tableNum = prefillGuest.roomInfo?.match(/Table (\d+)/i)?.[1];
      if (tableNum) {
        setSelectedTable(parseInt(tableNum, 10));
        setTableGuestName(prefillGuest.guestName || `Table ${tableNum}`);
      }
      if (prefillGuest.guestPhone) setTableSessionId(prefillGuest.guestPhone);
      onPrefillConsumed();
    }
  }, [prefillGuest]);

  useEffect(() => {
    if (prefillGuest?.guestType === "walkin") {
      if (prefillGuest.guestPhone) setWalkinPhone(prefillGuest.guestPhone);
      onPrefillConsumed();
    }
  }, []);

  const filteredGuests = guests.filter(
    (g) => g.name.toLowerCase().includes(guestSearch.toLowerCase()) || g.contact.includes(guestSearch)
  );

  const isSearching = menuSearch.trim().length > 0;
  const searchResults = useMemo(() => {
    if (!isSearching) return [];
    const q = menuSearch.toLowerCase().trim();
    return menuItems.filter(
      (i) => i.name.toLowerCase().includes(q) || (i.nameKannada && i.nameKannada.toLowerCase().includes(q))
    );
  }, [menuItems, menuSearch, isSearching]);

  const categoryItems = menuItems.filter((i) => i.categoryId === selectedCategory);
  const displayItems = isSearching ? searchResults : categoryItems;

  const addToCart = (item: MenuItem) => {
    setCart((prev) => {
      const existing = prev.find((c) => c.menuItemId === item.id);
      if (existing) return prev.map((c) => c.menuItemId === item.id ? { ...c, quantity: c.quantity + 1 } : c);
      return [...prev, { menuItemId: item.id, name: item.name, price: item.price, quantity: 1 }];
    });
  };

  const updateCartQty = (menuItemId: number, delta: number) => {
    setCart((prev) => prev.map((c) => {
      if (c.menuItemId !== menuItemId) return c;
      const newQty = c.quantity + delta;
      return newQty <= 0 ? null! : { ...c, quantity: newQty };
    }).filter(Boolean));
  };

  const cartTotal = cart.reduce((sum, c) => sum + c.price * c.quantity, 0);
  const cartTax = Math.round((cartTotal * taxRate) / 100);
  const cartGrandTotal = cartTotal + cartTax;

  const submit = async () => {
    setError("");
    setSuccessMsg("");
    let name: string | undefined;
    if (guestType === "hostel") name = selectedGuest?.name;
    else if (guestType === "table") name = tableGuestName || (selectedTable ? `Table ${selectedTable}` : undefined);
    else name = walkinName;
    if (!name) { setError(guestType === "table" ? "Please select a table" : "Please select/enter a guest"); return; }
    if (guestType === "walkin" && !walkinPhone.trim()) { setError("Phone number is required for walk-in orders"); return; }
    if (guestType === "table" && !selectedTable) { setError("Please select a table"); return; }
    if (cart.length === 0) { setError("Cart is empty"); return; }

    setSubmitting(true);
    try {
      // Table orders are walkin orders with table name + auto-generated session ID as phone
      const tablePhone = guestType === "table"
        ? (tableSessionId || `${Date.now()}`)
        : undefined;

      const res = await apiCall({
        action: "placeOrderForGuest",
        guestType: guestType === "table" ? "walkin" : guestType,
        checkinId: guestType === "hostel" ? selectedGuest?.id : undefined,
        guestName: name,
        guestPhone: guestType === "walkin" ? walkinPhone.trim() : guestType === "table" ? tablePhone : undefined,
        roomInfo: guestType === "hostel" ? selectedGuest?.bedInfo : guestType === "table" ? `Table ${selectedTable}` : undefined,
        items: cart.map((c) => ({ menuItemId: c.menuItemId, quantity: c.quantity })),
        specialInstructions,
      });
      if (res.ok) {
        const data = await res.json();
        setCart([]);
        setSpecialInstructions("");
        setSelectedGuest(null);
        setWalkinName("");
        setWalkinPhone("");
        setTableGuestName("");
        setSelectedTable(null);
        if (onOrderPlaced) {
          onOrderPlaced();
        } else {
          setSuccessMsg(`Order ${data.orderNumber} placed! Total: ₹${(data.total / 100).toFixed(0)}`);
        }
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Failed to place order");
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (loadingMenu) return <LoadingState />;

  return (
    <div className={cn("space-y-4", cart.length > 0 && "pb-20")}>
      <h3 className="font-display text-lg font-bold text-brand-green-dark">Place Order</h3>

      {/* Guest Type Toggle */}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => { setGuestType("hostel"); setSelectedGuest(null); setSelectedTable(null); }}
          className={cn("rounded-lg px-4 py-2 text-sm font-medium transition-colors", guestType === "hostel" ? "bg-brand-green text-white" : "border border-brand-mist text-brand-green-dark/70")}
        >
          🏨 Hostel Guest
        </button>
        <button
          type="button"
          onClick={() => { setGuestType("walkin"); setSelectedGuest(null); setSelectedTable(null); }}
          className={cn("rounded-lg px-4 py-2 text-sm font-medium transition-colors", guestType === "walkin" ? "bg-brand-green text-white" : "border border-brand-mist text-brand-green-dark/70")}
        >
          🚶 Walk-in
        </button>
        {cafeTableCount > 0 && (
          <button
            type="button"
            onClick={() => { setGuestType("table"); setSelectedGuest(null); }}
            className={cn("rounded-lg px-4 py-2 text-sm font-medium transition-colors", guestType === "table" ? "bg-brand-green text-white" : "border border-brand-mist text-brand-green-dark/70")}
          >
            🪑 Cafe Table
          </button>
        )}
      </div>

      {/* Guest Selection */}
      <div className="rounded-xl border border-brand-mist bg-white dark:bg-card p-4">
        {guestType === "table" ? (
          <div>
            <p className="mb-2 text-xs font-medium text-brand-green-dark/70">Select table:</p>
            <div className="flex flex-wrap gap-2">
              {Array.from({ length: cafeTableCount }, (_, i) => i + 1).map((num) => {
                const occupant = occupiedTables.get(num);
                return (
                <button
                  key={num}
                  type="button"
                  onClick={() => { setSelectedTable(num); setTableGuestName(occupant || `Table ${num}`); if (occupant) { /* pre-fill session for existing table */ } }}
                  className={cn(
                    "flex flex-col items-center justify-center rounded-lg text-sm font-bold transition-colors",
                    occupant ? "h-14 w-14" : "h-12 w-12",
                    selectedTable === num
                      ? "bg-brand-green text-white shadow-md dark:shadow-none"
                      : occupant
                        ? "border-2 border-amber-400 bg-amber-50 dark:bg-amber-950 text-amber-700 dark:text-amber-400"
                        : "border border-brand-mist text-brand-green-dark hover:bg-brand-green/[0.06]"
                  )}
                  title={occupant ? `Occupied: ${occupant}` : `Table ${num}`}
                >
                  <span>{num}</span>
                  {occupant && selectedTable !== num && (
                    <span className="mt-0.5 max-w-[3rem] truncate text-[9px] font-medium leading-tight text-amber-600">{occupant.split(" ")[0]}</span>
                  )}
                </button>
                );
              })}
            </div>
            {occupiedTables.size > 0 && (
              <p className="mt-2 flex items-center gap-1.5 text-[11px] text-amber-600">
                <span className="inline-block h-2.5 w-2.5 rounded border-2 border-amber-400 bg-amber-50 dark:bg-amber-950" />
                Occupied (unpaid order)
              </p>
            )}
            {selectedTable && (
              <div className="mt-3">
                <label className="mb-0.5 block text-xs font-medium text-brand-green-dark/70">Guest name (optional)</label>
                <input
                  className="w-full rounded-lg border border-brand-mist px-3 py-2 text-sm"
                  placeholder={`Table ${selectedTable}`}
                  value={tableGuestName}
                  onChange={(e) => setTableGuestName(e.target.value)}
                />
              </div>
            )}
          </div>
        ) : guestType === "hostel" ? (
          <div>
            <div className="relative">
              <SearchIcon className="absolute left-3 top-2.5 h-4 w-4 text-brand-green-dark/40" />
              <input
                className="w-full rounded-lg border border-brand-mist pl-9 pr-3 py-2 text-sm"
                placeholder="Search guest by name or contact..."
                value={guestSearch}
                onChange={(e) => setGuestSearch(e.target.value)}
              />
            </div>
            {selectedGuest ? (
              <div className="mt-2 flex items-center justify-between rounded-lg bg-brand-green/[0.05] px-3 py-2">
                <div>
                  <span className="text-sm font-medium text-brand-green-dark">{selectedGuest.name}</span>
                  {selectedGuest.checkedOut && <span className="ml-1.5 rounded-full bg-amber-100 dark:bg-amber-900/50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400">Checked out</span>}
                  {selectedGuest.bedInfo && <span className="ml-2 text-xs text-brand-green-dark/60">{selectedGuest.bedInfo}</span>}
                </div>
                <button type="button" onClick={() => setSelectedGuest(null)} className="text-xs text-red-500">Change</button>
              </div>
            ) : guestSearch.length > 0 && (
              <div className="mt-2 max-h-40 overflow-y-auto rounded-lg border border-brand-mist">
                {filteredGuests.length === 0 ? (
                  <p className="p-3 text-xs text-brand-green-dark/50">No guests found</p>
                ) : filteredGuests.map((g) => (
                  <button
                    key={g.id}
                    type="button"
                    onClick={() => { setSelectedGuest(g); setGuestSearch(""); }}
                    className="w-full px-3 py-2 text-left text-sm hover:bg-brand-green/[0.04] border-b border-brand-mist last:border-0"
                  >
                    <span className="font-medium">{g.name}</span>
                    {g.checkedOut && <span className="ml-1.5 rounded-full bg-amber-100 dark:bg-amber-900/50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400">Checked out</span>}
                    {g.bedInfo && <span className="ml-2 text-xs text-brand-green-dark/50">{g.bedInfo}</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            <input
              className="w-full rounded-lg border border-brand-mist px-3 py-2 text-sm"
              placeholder="Guest name"
              value={walkinName}
              onChange={(e) => setWalkinName(e.target.value)}
            />
            <div>
              <label className="mb-0.5 block text-xs font-medium text-brand-green-dark/70">Phone Number *</label>
              <input
                className="w-full rounded-lg border border-brand-mist px-3 py-2 text-sm"
                placeholder="e.g. 9876543210"
                type="tel"
                value={walkinPhone}
                onChange={(e) => setWalkinPhone(e.target.value)}
              />
            </div>
          </div>
        )}
      </div>

      {/* Menu Browser */}
      <div className="rounded-xl border border-brand-mist bg-white dark:bg-card p-4">
        <div className="relative mb-3">
          <SearchIcon className="absolute left-3 top-2.5 h-4 w-4 text-brand-green-dark/40" />
          <input
            className="w-full rounded-lg border border-brand-mist pl-9 pr-8 py-2 text-sm"
            placeholder="Search menu items..."
            value={menuSearch}
            onChange={(e) => setMenuSearch(e.target.value)}
          />
          {menuSearch && (
            <button type="button" onClick={() => setMenuSearch("")} className="absolute right-2.5 top-2.5 text-brand-green-dark/40 hover:text-brand-green-dark/70">
              <XIcon className="h-4 w-4" />
            </button>
          )}
        </div>
        {!isSearching && (
          <div className="mb-3 flex flex-wrap gap-1">
            {categories.map((cat) => (
              <button
                key={cat.id}
                type="button"
                onClick={() => setSelectedCategory(cat.id)}
                className={cn(
                  "rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors",
                  selectedCategory === cat.id ? "bg-brand-green text-white" : "bg-brand-sand text-brand-green-dark/70 hover:bg-brand-mist"
                )}
              >
                {cat.icon} {cat.name}
              </button>
            ))}
          </div>
        )}
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {displayItems.map((item) => {
            const cartItem = cart.find((c) => c.menuItemId === item.id);
            const qty = cartItem?.quantity || 0;
            return (
            <div key={item.id} className={cn("flex items-center justify-between rounded-lg border border-brand-mist p-2.5", item.isAvailable === 0 && "opacity-50")}>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-brand-green-dark">{item.name}</p>
                {item.isAvailable === 0 ? (
                  <p className="text-xs font-medium text-red-500">Out of Stock</p>
                ) : (
                  <p className="text-xs text-brand-green-dark/60">₹{(item.price / 100).toFixed(0)}</p>
                )}
              </div>
              {item.isAvailable === 0 ? (
                <span className="ml-2 rounded-full bg-red-100 dark:bg-red-900/50 px-2 py-0.5 text-xs text-red-600 dark:text-red-400">Unavailable</span>
              ) : qty > 0 ? (
                <div className="ml-2 flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => updateCartQty(item.id, -1)}
                    className="flex h-8 w-8 items-center justify-center rounded-md border border-brand-mist text-brand-green-dark hover:bg-gray-100 dark:hover:bg-[#1c1c1c]"
                  >−</button>
                  <span className="w-7 text-center text-sm font-semibold text-brand-green-dark">{qty}</span>
                  <button
                    type="button"
                    onClick={() => addToCart(item)}
                    className="flex h-8 w-8 items-center justify-center rounded-md bg-brand-green text-white hover:bg-brand-green/90"
                  >+</button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => addToCart(item)}
                  className="ml-2 flex h-8 w-8 items-center justify-center rounded-md bg-brand-green text-white hover:bg-brand-green/90"
                >
                  <PlusIcon className="h-4 w-4" />
                </button>
              )}
            </div>
            );
          })}
          {displayItems.length === 0 && (
            <p className="col-span-full text-center text-xs text-brand-green-dark/50 py-4">{isSearching ? "No matching items" : "No items in this category"}</p>
          )}
        </div>
      </div>

      {/* Cart */}
      {cart.length > 0 && (
        <div ref={cartRef} className="rounded-xl border border-brand-mist bg-white dark:bg-card p-4">
          <h4 className="mb-2 text-sm font-bold text-brand-green-dark">Cart ({cart.length} items)</h4>
          <div className="space-y-2">
            {cart.map((c) => (
              <div key={c.menuItemId} className="flex items-center justify-between">
                <span className="min-w-0 flex-1 truncate text-sm text-brand-green-dark">{c.name}</span>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => updateCartQty(c.menuItemId, -1)} className="h-6 w-6 rounded border border-brand-mist flex items-center justify-center">
                    <MinusIcon className="h-3 w-3" />
                  </button>
                  <span className="w-6 text-center text-sm font-medium">{c.quantity}</span>
                  <button type="button" onClick={() => updateCartQty(c.menuItemId, 1)} className="h-6 w-6 rounded border border-brand-mist flex items-center justify-center">
                    <PlusIcon className="h-3 w-3" />
                  </button>
                  <span className="ml-2 w-16 text-right text-sm text-brand-green-dark/70">₹{((c.price * c.quantity) / 100).toFixed(0)}</span>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-3 border-t border-brand-mist pt-2 text-sm">
            <div className="flex justify-between text-brand-green-dark/70"><span>Subtotal</span><span>₹{(cartTotal / 100).toFixed(0)}</span></div>
            {taxRate > 0 && (
              <div className="flex justify-between text-brand-green-dark/70"><span>Tax ({taxRate}%)</span><span>₹{(cartTax / 100).toFixed(0)}</span></div>
            )}
            <div className="flex justify-between font-bold text-brand-green-dark"><span>Total</span><span>₹{(cartGrandTotal / 100).toFixed(0)}</span></div>
          </div>
          <textarea
            className="mt-3 w-full rounded-lg border border-brand-mist px-3 py-2 text-sm"
            placeholder="Special instructions (optional)"
            value={specialInstructions}
            onChange={(e) => setSpecialInstructions(e.target.value)}
            rows={2}
          />
          {error && <p className="mt-2 text-xs text-red-500">{error}</p>}
          {successMsg && <p className="mt-2 text-xs text-green-600">{successMsg}</p>}
          <button
            type="button"
            onClick={() => { if (confirmWithGuest) setShowConfirmDialog(true); else submit(); }}
            disabled={submitting}
            className="mt-3 w-full rounded-lg bg-brand-green px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-green/90 disabled:opacity-50"
          >
            {submitting ? "Placing..." : `Place Order · ₹${(cartGrandTotal / 100).toFixed(0)}`}
          </button>
        </div>
      )}

      {/* Floating Done button - scrolls to cart */}
      {cart.length > 0 && (
        <button
          type="button"
          onClick={() => cartRef.current?.scrollIntoView({ behavior: "smooth" })}
          className="fixed bottom-20 right-4 sm:bottom-6 sm:right-6 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-brand-green text-white shadow-lg dark:shadow-none hover:bg-brand-green/90"
          title="Go to cart"
        >
          <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
        </button>
      )}

      {/* Confirm with guest dialog */}
      {showConfirmDialog && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowConfirmDialog(false)} />
          <div className="relative w-full max-w-sm rounded-2xl bg-white dark:bg-card p-6 shadow-2xl dark:shadow-none">
            <h3 className="text-base font-bold text-brand-green-dark">Confirmed with guest?</h3>
            <p className="mt-2 text-sm text-brand-green-dark/70">
              Please confirm the order items with the guest before placing.
            </p>
            <div className="mt-3 rounded-lg bg-brand-sand/50 p-3 text-sm">
              {cart.map((c) => (
                <div key={c.menuItemId} className="flex justify-between text-brand-green-dark/70">
                  <span>{c.quantity}× {c.name}</span>
                  <span>₹{((c.price * c.quantity) / 100).toFixed(0)}</span>
                </div>
              ))}
              <div className="mt-1 border-t border-brand-mist pt-1 flex justify-between font-bold text-brand-green-dark">
                <span>Total</span>
                <span>₹{(cartGrandTotal / 100).toFixed(0)}</span>
              </div>
            </div>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => { setShowConfirmDialog(false); submit(); }}
                disabled={submitting}
                className="flex-1 rounded-lg bg-brand-green px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-green/90 disabled:opacity-50"
              >
                {submitting ? "Placing..." : "Yes, Place Order"}
              </button>
              <button
                type="button"
                onClick={() => setShowConfirmDialog(false)}
                className="flex-1 rounded-lg border border-brand-mist px-4 py-2.5 text-sm font-medium text-brand-green-dark/70 hover:bg-brand-sand"
              >
                Go Back
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Order Summary (merged Guest Tabs + Walk-in Orders) ─────────────────────

type SummaryFilter = "all" | "hostel" | "walkin";

interface SummaryGroup {
  key: string;
  guestName: string;
  guestType: "hostel" | "walkin";
  contactInfo: string;
  roomInfo: string;
  orders: Order[];
  totalAmount: number;
  totalSubtotal: number;
  totalTax: number;
  orderCount: number;
  latestOrderTime: string;
  earliestOrderTime: string;
  hasModifications: boolean;
}

function OrderSummary({ apiCall, password, username, onOrderMore, onAddNewOrder, role, permissions }: { apiCall: (body: any) => Promise<Response>; password: string; username?: string; onOrderMore: (guest: PrefillGuest) => void; onAddNewOrder?: () => void; role?: Role; permissions?: Record<string, boolean> }) {
  const { showError, showSuccess } = useAdminToast();
  const [hostelGuests, setHostelGuests] = useState<GuestWithTab[]>([]);
  const [walkinOrders, setWalkinOrders] = useState<Order[]>([]);
  const [hostelOrdersMap, setHostelOrdersMap] = useState<Record<number, Order[]>>({});
  const [pendingApprovalOrders, setPendingApprovalOrders] = useState<Order[]>([]);
  const [approvingId, setApprovingId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [categories, setCategories] = useState<MenuCategory[]>([]);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [filter, setFilter] = useState<SummaryFilter>("all");
  const [selectedGroupKey, setSelectedGroupKey] = useState<string | null>(null);
  usePanelHistory(selectedGroupKey !== null, () => setSelectedGroupKey(null));
  const [loadingOrders, setLoadingOrders] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [btSupported, setBtSupported] = useState(false);
  const [printingGroup, setPrintingGroup] = useState<string | null>(null);
  const [paymentModalGroup, setPaymentModalGroup] = useState<SummaryGroup | null>(null);
  const [paymentModalMethod, setPaymentModalMethod] = useState<string>("online");
  const [discountModalGroup, setDiscountModalGroup] = useState<SummaryGroup | null>(null);
  const [editingOrderId, setEditingOrderId] = useState<number | null>(null);
  const [voidingItemId, setVoidingItemId] = useState<number | null>(null);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [voidedItemReasons, setVoidedItemReasons] = useState<Record<number, string>>({});
  const [pendingQtyChange, setPendingQtyChange] = useState<{ orderId: number; itemId: number; newQty: number } | null>(null);
  const [modHistoryOrderId, setModHistoryOrderId] = useState<number | null>(null);
  const [modHistoryData, setModHistoryData] = useState<OrderModification[]>([]);
  const [modHistoryLoading, setModHistoryLoading] = useState(false);

  useEffect(() => { setBtSupported(isBluetoothSupported()); }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [hostelRes, walkinRes, activeRes, menuRes] = await Promise.all([
        apiCall({ action: "getGuestsWithTabs" }),
        apiCall({ action: "getWalkinOrders" }),
        apiCall({ action: "listOrders", status: "active" }),
        apiCall({ action: "getMenu" }),
      ]);
      if (hostelRes.ok) {
        const data = await hostelRes.json();
        setHostelGuests(data.guests || []);
        setHostelOrdersMap({});
      }
      if (walkinRes.ok) {
        const data = await walkinRes.json();
        setWalkinOrders(data.orders || []);
      }
      if (activeRes.ok) {
        const data = await activeRes.json();
        setPendingApprovalOrders((data.orders || []).filter((o: Order) => o.status === "pending_approval"));
      }
      if (menuRes.ok) {
        const data = await menuRes.json();
        setCategories(data.categories || []);
        setMenuItems((data.items || []).map((i: any) => ({ id: i.id, categoryId: i.categoryId, name: i.name, nameKannada: i.nameKannada || "", description: i.description || "", price: i.price, priceText: i.priceText || "", tags: i.tags || "[]", isAvailable: i.isAvailable })));
      }
    } finally {
      setLoading(false);
    }
  }, [apiCall]);

  const handleApproveOrder = async (orderId: number) => {
    setApprovingId(orderId);
    try {
      const res = await apiCall({ action: "updateOrderStatus", orderId, status: "placed" });
      if (res.ok) await load();
    } finally { setApprovingId(null); }
  };

  const handleRejectOrder = async (orderId: number) => {
    setApprovingId(orderId);
    try {
      const res = await apiCall({ action: "updateOrderStatus", orderId, status: "cancelled", cancelledReason: "Rejected by staff" });
      if (res.ok) await load();
    } finally { setApprovingId(null); }
  };

  useEffect(() => { load(); }, [load]);

  const groups: SummaryGroup[] = useMemo(() => {
    const result: SummaryGroup[] = [];

    for (const g of hostelGuests) {
      const cachedOrders = hostelOrdersMap[g.checkinId] || [];
      const hostelLatest = cachedOrders.length > 0
        ? cachedOrders.reduce((max, o) => o.createdAt > max ? o.createdAt : max, "")
        : g.latestOrderTime || "";
      const hostelEarliest = cachedOrders.length > 0
        ? cachedOrders.reduce((min, o) => !min || o.createdAt < min ? o.createdAt : min, "")
        : g.latestOrderTime || "";
      result.push({
        key: `hostel_${g.checkinId}`,
        guestName: g.name,
        guestType: "hostel",
        contactInfo: g.contact,
        roomInfo: g.bedInfo,
        orders: cachedOrders,
        totalAmount: g.tabTotal,
        totalSubtotal: g.tabTotal,
        totalTax: 0,
        orderCount: g.orderCount,
        latestOrderTime: hostelLatest,
        earliestOrderTime: hostelEarliest,
        hasModifications: cachedOrders.length > 0
          ? cachedOrders.some((o) => o.hasModifications)
          : (g.hasModifications || false),
      });
    }

    const walkinMap = new Map<string, Order[]>();
    for (const order of walkinOrders) {
      const isTable = order.roomInfo && /^Table \d+$/i.test(order.roomInfo);
      const key = isTable ? `table_${order.roomInfo}` : (order.guestPhone || `_no_phone_${order.id}`);
      if (!walkinMap.has(key)) walkinMap.set(key, []);
      walkinMap.get(key)!.push(order);
    }
    for (const [groupKey, groupOrders] of walkinMap) {
      const latest = groupOrders.reduce((max, o) => o.createdAt > max ? o.createdAt : max, "");
      const earliest = groupOrders.reduce((min, o) => !min || o.createdAt < min ? o.createdAt : min, "");
      const isTableGroup = groupKey.startsWith("table_");
      result.push({
        key: `walkin_${groupKey}`,
        guestName: groupOrders[0].guestName,
        guestType: "walkin",
        contactInfo: isTableGroup ? "" : (groupKey.startsWith("_no_phone_") ? "" : groupKey),
        roomInfo: isTableGroup ? groupOrders[0].roomInfo : "",
        orders: groupOrders,
        totalAmount: groupOrders.reduce((s, o) => s + o.total, 0),
        totalSubtotal: groupOrders.reduce((s, o) => s + o.subtotal, 0),
        totalTax: groupOrders.reduce((s, o) => s + o.tax, 0),
        orderCount: groupOrders.length,
        latestOrderTime: latest,
        earliestOrderTime: earliest,
        hasModifications: groupOrders.some((o) => o.hasModifications),
      });
    }

    result.sort((a, b) => {
      const aTime = a.latestOrderTime || "";
      const bTime = b.latestOrderTime || "";
      if (bTime && aTime) return bTime.localeCompare(aTime);
      if (bTime) return 1;
      if (aTime) return -1;
      return 0;
    });

    return result;
  }, [hostelGuests, walkinOrders, hostelOrdersMap]);

  const filteredGroups = useMemo(() => {
    if (filter === "all") return groups;
    return groups.filter((g) => g.guestType === filter);
  }, [groups, filter]);

  const getGroupOrders = useCallback((group: SummaryGroup): Order[] => {
    if (group.guestType === "walkin") return group.orders;
    const checkinId = parseInt(group.key.replace("hostel_", ""), 10);
    return hostelOrdersMap[checkinId] || [];
  }, [hostelOrdersMap]);

  const selectedGroup = selectedGroupKey ? groups.find((g) => g.key === selectedGroupKey) || null : null;
  const selectedGroupOrders = selectedGroup
    ? [...getGroupOrders(selectedGroup)].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    : [];

  const selectGroup = async (group: SummaryGroup) => {
    setSelectedGroupKey(group.key);
    setModHistoryOrderId(null);

    if (group.guestType === "hostel" && !hostelOrdersMap[parseInt(group.key.replace("hostel_", ""), 10)]) {
      const checkinId = parseInt(group.key.replace("hostel_", ""), 10);
      setLoadingOrders(group.key);
      try {
        const res = await apiCall({ action: "getGuestTab", checkinId });
        if (res.ok) {
          const data = await res.json();
          setHostelOrdersMap((prev) => ({ ...prev, [checkinId]: data.orders || [] }));
        }
      } finally {
        setLoadingOrders(null);
      }
    }
  };

  const refreshAfterEdit = useCallback(async (group: SummaryGroup) => {
    const [hostelRes, walkinRes] = await Promise.all([
      apiCall({ action: "getGuestsWithTabs" }),
      apiCall({ action: "getWalkinOrders" }),
    ]);
    if (hostelRes.ok) {
      const data = await hostelRes.json();
      setHostelGuests(data.guests || []);
    }
    if (walkinRes.ok) {
      const data = await walkinRes.json();
      setWalkinOrders(data.orders || []);
    }
    if (group.guestType === "hostel") {
      const checkinId = parseInt(group.key.replace("hostel_", ""), 10);
      const res = await apiCall({ action: "getGuestTab", checkinId });
      if (res.ok) {
        const data = await res.json();
        setHostelOrdersMap((prev) => ({ ...prev, [checkinId]: data.orders || [] }));
      }
    }
  }, [apiCall]);

  const toggleModHistory = async (orderId: number) => {
    if (modHistoryOrderId === orderId) { setModHistoryOrderId(null); return; }
    setModHistoryOrderId(orderId);
    setModHistoryLoading(true);
    try {
      const res = await apiCall({ action: "getOrderModifications", orderId });
      if (res.ok) { const data = await res.json(); setModHistoryData(data.modifications || []); }
      else { setModHistoryData([]); }
    } catch { setModHistoryData([]); }
    finally { setModHistoryLoading(false); }
  };

  const handleVoidItem = async (orderId: number, itemId: number, reason: string) => {
    setActionBusy(`void_${itemId}`);
    try {
      const res = await apiCall({ action: "voidItem", orderId, orderItemId: itemId, reason });
      if (res.ok) {
        setVoidedItemReasons((prev) => ({ ...prev, [itemId]: reason }));
        setVoidingItemId(null);
        if (selectedGroup) await refreshAfterEdit(selectedGroup);
      }
    } finally {
      setActionBusy(null);
    }
  };

  const handleQuantityChange = async (orderId: number, itemId: number, newQuantity: number, orderStatus?: string) => {
    if (newQuantity <= 0) {
      setVoidingItemId(itemId);
      return;
    }
    if (orderStatus === "served") {
      setPendingQtyChange({ orderId, itemId, newQty: newQuantity });
      setVoidingItemId(itemId);
      return;
    }
    setActionBusy(`qty_${itemId}`);
    try {
      const res = await apiCall({ action: "updateItemQuantity", orderId, orderItemId: itemId, newQuantity });
      if (res.ok) {
        if (selectedGroup) await refreshAfterEdit(selectedGroup);
      }
    } finally {
      setActionBusy(null);
    }
  };

  const handleServedQtyChange = async (reason: string) => {
    if (!pendingQtyChange) return;
    const { orderId, itemId, newQty } = pendingQtyChange;
    setActionBusy(`qty_${itemId}`);
    try {
      const res = await apiCall({ action: "updateItemQuantity", orderId, orderItemId: itemId, newQuantity: newQty, reason });
      if (res.ok) {
        setPendingQtyChange(null);
        setVoidingItemId(null);
        if (selectedGroup) await refreshAfterEdit(selectedGroup);
      }
    } finally {
      setActionBusy(null);
    }
  };

  const actualGroupTotal = selectedGroupOrders.length > 0
    ? selectedGroupOrders.reduce((sum, o) => sum + o.total, 0)
    : selectedGroup?.totalAmount || 0;

  const markGroupPaid = async (group: SummaryGroup, paymentMethod: string, cashReceived: number = 0, changeGiven: number = 0, onlineAccountId?: number, receiptId?: string) => {
    const orders = getGroupOrders(group);
    const orderIds = orders.map((o) => o.id);
    if (orderIds.length === 0) return;
    setBusy(group.key);
    try {
      const res = await apiCall({ action: "markOrderPaid", orderIds, paymentMethod, cashReceived, changeGiven, onlineAccountId, receiptId });
      if (res.ok) {
        await load();
        setSelectedGroupKey(null);
      }
    } finally {
      setBusy(null);
    }
  };

  const handlePrintGroup = async (group: SummaryGroup) => {
    const orders = getGroupOrders(group);
    if (orders.length === 0) return;
    setPrintingGroup(group.key);
    try {
      const exemptCatIdsPrint = new Set(categories.filter((c) => c.discountExempt).map((c) => c.id));
      const miCatMapPrint = new Map(menuItems.map((mi) => [mi.id, mi.categoryId]));
      const allItems: BillItem[] = orders.flatMap(o =>
        o.items.filter(i => i.status !== "voided").map(i => ({
          name: i.itemName,
          quantity: i.quantity,
          price: i.itemPrice,
          lineTotal: i.lineTotal,
          status: i.status,
        }))
      );
      const subtotal = orders.reduce((s, o) => s + o.subtotal, 0);
      const tax = orders.reduce((s, o) => s + o.tax, 0);
      const total = orders.reduce((s, o) => s + o.total, 0);
      const discount = orders.reduce((s, o) => s + (o.discount || 0), 0);
      let printExempt = 0;
      for (const o of orders) {
        for (const item of o.items) {
          if (item.status === "voided") continue;
          const catId = miCatMapPrint.get(item.menuItemId);
          if (catId !== undefined && exemptCatIdsPrint.has(catId)) printExempt += item.lineTotal;
        }
      }
      const printGross = subtotal + discount;
      await printFoodBill({
        guestName: group.guestName,
        guestPhone: group.contactInfo || undefined,
        roomInfo: group.roomInfo || undefined,
        guestType: group.guestType === "hostel" ? "hostel" : "walkin",
        items: allItems,
        subtotal,
        tax,
        total,
        taxRate: foodTaxRateFromAmounts(subtotal, tax),
        discount: discount || undefined,
        discountableSubtotal: printGross - printExempt,
        exemptSubtotal: printExempt,
      });
      showSuccess("Bill printed successfully!");
    } catch (err: any) {
      showError("Print failed", err.message || "Unknown error");
    } finally {
      setPrintingGroup(null);
    }
  };

  const handleKitchenPrint = async (group: SummaryGroup) => {
    const orders = getGroupOrders(group);
    const activeOrders = orders.filter(o => o.status !== "cancelled" && o.status !== "served");
    if (activeOrders.length === 0) { showError("No active orders to print for kitchen"); return; }
    setPrintingGroup(group.key);
    try {
      for (const order of activeOrders) {
        const items = order.items.filter(i => i.status !== "voided").map(i => ({ name: i.itemName, quantity: i.quantity }));
        if (items.length === 0) continue;
        await printOrderTicket({
          orderNumber: order.orderNumber,
          guestName: group.guestName,
          guestType: group.guestType === "hostel" ? "hostel" : "walkin",
          roomInfo: group.roomInfo || undefined,
          items,
          specialInstructions: order.specialInstructions || undefined,
          createdAt: order.createdAt,
        });
      }
      showSuccess("Kitchen ticket(s) printed!");
    } catch (err: any) {
      showError("Print failed", err.message || "Unknown error");
    } finally {
      setPrintingGroup(null);
    }
  };

  const handlePdfGroup = async (group: SummaryGroup) => {
    const orders = getGroupOrders(group);
    if (orders.length === 0) return;
    const exemptCatIds = new Set(categories.filter((c) => c.discountExempt).map((c) => c.id));
    const miCatMap = new Map(menuItems.map((mi) => [mi.id, mi.categoryId]));
    const billOrders: BillOrder[] = orders.map(o => ({
      orderNumber: o.orderNumber,
      createdAt: o.createdAt,
      items: o.items.filter(i => i.status !== "voided").map(i => ({
        itemName: i.itemName,
        quantity: i.quantity,
        itemPrice: i.itemPrice,
        lineTotal: i.lineTotal,
        status: i.status,
      })),
      subtotal: o.subtotal,
      tax: o.tax,
      total: o.total,
      discount: o.discount || 0,
      specialInstructions: o.specialInstructions || undefined,
    }));
    let exemptSub = 0;
    for (const o of orders) {
      for (const item of o.items) {
        if (item.status === "voided") continue;
        const catId = miCatMap.get(item.menuItemId);
        if (catId !== undefined && exemptCatIds.has(catId)) exemptSub += item.lineTotal;
      }
    }
    const grossSub = orders.reduce((s, o) => s + o.subtotal + (o.discount || 0), 0);
    await generateGuestBill({
      guestName: group.guestName,
      guestPhone: group.contactInfo || "",
      roomInfo: group.roomInfo || undefined,
      orders: billOrders,
      grandSubtotal: orders.reduce((s, o) => s + o.subtotal, 0),
      grandTax: orders.reduce((s, o) => s + o.tax, 0),
      grandTotal: orders.reduce((s, o) => s + o.total, 0),
      taxRate: foodTaxRateFromAmounts(
        orders.reduce((s, o) => s + o.subtotal, 0),
        orders.reduce((s, o) => s + o.tax, 0),
      ),
      billDate: new Date().toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }),
      discountableSubtotal: grossSub - exemptSub,
      exemptSubtotal: exemptSub,
    });
  };

  if (loading) return <LoadingState />;

  return (
    <div className="space-y-3 pb-20">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-display text-lg font-bold text-brand-green-dark">Order Summary ({filteredGroups.length})</h3>
        <button type="button" onClick={load} className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm text-brand-green hover:bg-brand-green/[0.06]">
          <RefreshCwIcon className="h-3.5 w-3.5" /> Refresh
        </button>
      </div>

      {/* Filter Toggle */}
      <div className="flex gap-1 rounded-lg border border-brand-mist bg-white dark:bg-card p-1">
        {([
          { id: "all" as SummaryFilter, label: "All" },
          { id: "hostel" as SummaryFilter, label: "Goko Guest" },
          { id: "walkin" as SummaryFilter, label: "Walk-in" },
        ]).map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFilter(f.id)}
            className={cn(
              "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
              filter === f.id ? "bg-brand-green text-white" : "text-brand-green-dark/70 hover:bg-brand-green/[0.06]"
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Pending Approval */}
      {pendingApprovalOrders.length > 0 && (
        <div className="rounded-xl border-2 border-amber-400 bg-amber-50 dark:bg-amber-950 p-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">Pending Approval ({pendingApprovalOrders.length})</p>
          <div className="space-y-2">
            {pendingApprovalOrders.map((order) => (
              <div key={order.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 dark:border-amber-800 bg-white dark:bg-card px-3 py-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-mono text-xs font-bold text-amber-700 dark:text-amber-400">{order.orderNumber}</span>
                    <span className="text-sm font-medium text-brand-green-dark">{order.guestName}</span>
                    {order.guestType === "hostel" && <span className="rounded-full bg-green-100 dark:bg-green-900/50 px-1.5 py-0.5 text-[10px] font-medium text-green-700 dark:text-green-400">Goko</span>}
                  </div>
                  <p className="text-xs text-brand-green-dark/50">
                    {order.items.filter(i => i.status !== "voided").map(i => `${i.quantity}× ${i.itemName}`).join(", ")}
                    <span className="ml-2 font-medium text-brand-green-dark">₹{(order.total / 100).toFixed(0)}</span>
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => handleApproveOrder(order.id)} disabled={approvingId === order.id}
                    className="rounded-md bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50">
                    {approvingId === order.id ? "..." : "Approve"}
                  </button>
                  <button type="button" onClick={() => handleRejectOrder(order.id)} disabled={approvingId === order.id}
                    className="rounded-md border border-red-300 dark:border-red-800 px-3 py-1.5 text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950 disabled:opacity-50">
                    Reject
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {filteredGroups.length === 0 && pendingApprovalOrders.length === 0 && (
        <div className="rounded-xl border border-brand-mist bg-white dark:bg-card p-8 text-center text-sm text-brand-green-dark/50">
          No unpaid orders
        </div>
      )}

      {/* Card Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {filteredGroups.map((group) => {
          const timeSince = group.earliestOrderTime ? formatTimeSince(group.earliestOrderTime) : "";
          return (
            <button
              key={group.key}
              type="button"
              onClick={() => selectGroup(group)}
              className={cn(
                "rounded-xl border border-brand-mist bg-white dark:bg-card p-3 text-left transition-shadow hover:shadow-md dark:hover:shadow-none",
                group.guestType === "hostel" ? "border-l-[3px] border-l-green-400" : "border-l-[3px] border-l-gray-300"
              )}
            >
              <div className="flex items-start justify-between gap-1">
                <span className="min-w-0 truncate text-sm font-bold text-brand-green-dark">{group.guestName}</span>
                {group.guestType === "hostel" ? (
                  <span className="flex-shrink-0 rounded-full bg-green-100 dark:bg-green-900/50 px-1.5 py-0.5 text-[10px] font-medium text-green-700 dark:text-green-400">Goko</span>
                ) : (
                  <span className="flex-shrink-0 rounded-full bg-gray-200 dark:bg-[#2a2a2a] px-1.5 py-0.5 text-[10px] font-medium text-gray-600 dark:text-gray-400">Walk-in</span>
                )}
              </div>
              {(group.roomInfo || group.contactInfo) && (
                <p className="mt-0.5 truncate text-xs text-brand-green-dark/50">
                  {group.roomInfo || group.contactInfo}
                </p>
              )}
              <p className="mt-2 text-lg font-bold text-brand-green">₹{(group.totalAmount / 100).toFixed(0)}</p>
              <div className="mt-1 flex items-center justify-between text-xs text-brand-green-dark/50">
                <span>
                  {group.orderCount} order{group.orderCount !== 1 ? "s" : ""}
                  {group.hasModifications && (
                    <span className="ml-1.5 rounded-full bg-amber-100 dark:bg-amber-900/50 px-1.5 py-0.5 text-[9px] font-semibold text-amber-700 dark:text-amber-400">Modified</span>
                  )}
                </span>
                {timeSince && <span className="text-brand-green-dark/40">{timeSince}</span>}
              </div>
            </button>
          );
        })}
      </div>

      {/* Slide-over Panel */}
      {selectedGroup && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/30" onClick={() => setSelectedGroupKey(null)} />
          <div className="relative flex h-full w-full max-w-md flex-col bg-white dark:bg-card shadow-xl dark:shadow-none animate-in slide-in-from-right duration-200">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-brand-mist px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="min-w-0 truncate text-base font-bold text-brand-green-dark">{selectedGroup.guestName}</h3>
                  {selectedGroup.guestType === "hostel" ? (
                    <span className="flex-shrink-0 rounded-full bg-green-100 dark:bg-green-900/50 px-2 py-0.5 text-xs text-green-700 dark:text-green-400">Goko Guest</span>
                  ) : (
                    <span className="flex-shrink-0 rounded-full bg-gray-200 dark:bg-[#2a2a2a] px-2 py-0.5 text-xs text-gray-600 dark:text-gray-400">Walk-in</span>
                  )}
                </div>
                {(selectedGroup.roomInfo || selectedGroup.contactInfo) && (
                  <p className="text-xs text-brand-green-dark/50">{[selectedGroup.roomInfo, selectedGroup.contactInfo].filter(Boolean).join(" · ")}</p>
                )}
              </div>
              <button type="button" onClick={() => setSelectedGroupKey(null)} className="flex-shrink-0 rounded-lg p-1.5 hover:bg-brand-sand">
                <XIcon className="h-5 w-5 text-brand-green-dark/60" />
              </button>
            </div>

            {/* Total bar */}
            <div className="flex items-center justify-between bg-brand-sand/30 px-4 py-2.5">
              <span className="text-sm text-brand-green-dark/70">{selectedGroup.orderCount} order{selectedGroup.orderCount !== 1 ? "s" : ""}</span>
              <span className="text-xl font-bold text-brand-green">₹{(actualGroupTotal / 100).toFixed(0)}</span>
            </div>

            {/* Orders list */}
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 space-y-2">
              {loadingOrders === selectedGroup.key ? (
                <div className="flex justify-center py-8"><Loader2Icon className="h-5 w-5 animate-spin text-brand-green" /></div>
              ) : (
                <>
                  {selectedGroupOrders.map((order) => {
                    const isEditing = editingOrderId === order.id;
                    return (
                    <div key={order.id} className="rounded-lg border border-brand-mist p-3">
                      <div className="flex flex-wrap items-center justify-between gap-1">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs font-bold text-brand-green">{order.orderNumber}</span>
                          <StatusBadge status={order.status} />
                          {order.hasModifications && (
                            <span className="rounded-full bg-amber-100 dark:bg-amber-900/50 px-1.5 py-0.5 text-[9px] font-semibold text-amber-700 dark:text-amber-400">Modified</span>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-brand-green-dark/50">
                            {new Date(order.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" })}{" "}
                            {new Date(order.createdAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" })}
                          </span>
                          {btSupported && order.status !== "cancelled" && order.status !== "served" && (
                            <button
                              type="button"
                              onClick={async () => {
                                const items = order.items.filter(i => i.status !== "voided").map(i => ({ name: i.itemName, quantity: i.quantity }));
                                if (items.length === 0) return;
                                try {
                                  await printOrderTicket({ orderNumber: order.orderNumber, guestName: selectedGroup.guestName, guestType: selectedGroup.guestType === "hostel" ? "hostel" : "walkin", roomInfo: selectedGroup.roomInfo || undefined, items, specialInstructions: order.specialInstructions || undefined, createdAt: order.createdAt });
                                } catch (err: any) { showError("Print failed", err.message || "Unknown error"); }
                              }}
                              className="rounded p-1 text-orange-400 hover:text-orange-600 hover:bg-orange-50 dark:hover:bg-orange-950 transition-colors"
                              title="Print kitchen ticket"
                            >
                              <PrinterIcon className="h-3.5 w-3.5" />
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => { setEditingOrderId(isEditing ? null : order.id); setVoidingItemId(null); }}
                            className={cn(
                              "rounded p-1 transition-colors",
                              isEditing
                                ? "bg-brand-green/10 text-brand-green"
                                : "text-brand-green-dark/40 hover:text-brand-green-dark/70 hover:bg-brand-sand"
                            )}
                            title="Edit order"
                          >
                            <PencilIcon className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                      <div className="mt-1.5 space-y-0.5">
                        {order.items.map((item) => {
                          const isVoided = item.status === "voided";
                          const isItemEditing = isEditing && !isVoided;
                          return (
                          <div key={item.id}>
                            {isVoided ? (
                              <div className="flex items-center justify-between text-xs">
                                <div className="min-w-0 flex-1">
                                  <span className="line-through text-brand-green-dark/40">
                                    {item.quantity}× {item.itemName}
                                  </span>
                                  <span className="ml-1.5 inline-block rounded bg-red-100 dark:bg-red-900/50 px-1 py-0.5 text-[10px] font-bold text-red-600 dark:text-red-400">CANCELLED</span>
                                  {voidedItemReasons[item.id] && (
                                    <span className="ml-1 text-[10px] italic text-red-400">{voidedItemReasons[item.id]}</span>
                                  )}
                                </div>
                                <span className="line-through text-brand-green-dark/30 flex-shrink-0">₹{(item.lineTotal / 100).toFixed(0)}</span>
                              </div>
                            ) : isItemEditing ? (
                              <div className="flex items-center justify-between text-xs">
                                <div className="flex items-center gap-1.5">
                                  <button
                                    type="button"
                                    onClick={() => handleQuantityChange(order.id, item.id, item.quantity - 1, order.status)}
                                    disabled={actionBusy === `qty_${item.id}`}
                                    className="flex h-5 w-5 items-center justify-center rounded border border-brand-mist text-brand-green-dark/60 hover:bg-gray-100 dark:hover:bg-[#1c1c1c] disabled:opacity-50"
                                  >−</button>
                                  <span className="w-5 text-center font-medium text-brand-green-dark">{item.quantity}</span>
                                  <button
                                    type="button"
                                    onClick={() => handleQuantityChange(order.id, item.id, item.quantity + 1, order.status)}
                                    disabled={actionBusy === `qty_${item.id}`}
                                    className="flex h-5 w-5 items-center justify-center rounded border border-brand-mist text-brand-green-dark/60 hover:bg-gray-100 dark:hover:bg-[#1c1c1c] disabled:opacity-50"
                                  >+</button>
                                  <span className="min-w-0 truncate text-brand-green-dark/60">{item.itemName}</span>
                                </div>
                                <div className="flex items-center gap-1.5">
                                  <span className="text-brand-green-dark/60">₹{(item.lineTotal / 100).toFixed(0)}</span>
                                  <button
                                    type="button"
                                    onClick={() => setVoidingItemId(voidingItemId === item.id ? null : item.id)}
                                    className="flex h-5 w-5 items-center justify-center rounded bg-red-50 dark:bg-red-950 text-red-500 hover:bg-red-100 dark:hover:bg-red-900/50"
                                    title="Cancel item"
                                  >
                                    <XIcon className="h-3 w-3" />
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <div className="flex items-center justify-between text-xs text-brand-green-dark/60">
                                <span>{item.quantity}× {item.itemName}</span>
                                <span>₹{(item.lineTotal / 100).toFixed(0)}</span>
                              </div>
                            )}
                            {voidingItemId === item.id && (
                              <VoidReasonPopup
                                itemName={pendingQtyChange?.itemId === item.id ? `Reduce "${item.itemName}" (${item.quantity} → ${pendingQtyChange.newQty})` : item.itemName}
                                onVoid={(reason) => {
                                  if (pendingQtyChange?.itemId === item.id) {
                                    handleServedQtyChange(reason);
                                  } else {
                                    handleVoidItem(order.id, item.id, reason);
                                  }
                                }}
                                onCancel={() => { setVoidingItemId(null); setPendingQtyChange(null); }}
                                busy={actionBusy === `void_${item.id}` || actionBusy === `qty_${item.id}`}
                              />
                            )}
                          </div>
                          );
                        })}
                      </div>
                      <div className="mt-1 flex items-center justify-between">
                        <span className="text-[10px] text-brand-green-dark/40">by {order.createdBy || "guest"}</span>
                        <span className="text-sm font-semibold text-brand-green-dark">₹{(order.total / 100).toFixed(0)}</span>
                      </div>
                      {order.discount > 0 && (
                        <div className="flex items-center justify-between text-[10px] text-green-600">
                          <span>Discount{order.discountBy ? ` by ${order.discountBy}` : ""}</span>
                          <span>-₹{(order.discount / 100).toFixed(0)}</span>
                        </div>
                      )}
                      {order.hasModifications && (
                        <div className="mt-1.5 border-t border-brand-mist pt-1.5">
                          <button type="button" onClick={() => toggleModHistory(order.id)} className="text-[10px] font-medium text-amber-600 dark:text-amber-400 hover:text-amber-700 dark:hover:text-amber-300">
                            {modHistoryOrderId === order.id ? "Hide history" : "View modifications"}
                          </button>
                          {modHistoryOrderId === order.id && (
                            <div className="mt-1 space-y-1">
                              {modHistoryLoading ? (
                                <p className="text-[10px] text-brand-green-dark/40">Loading...</p>
                              ) : modHistoryData.length === 0 ? (
                                <p className="text-[10px] text-brand-green-dark/40">No modifications</p>
                              ) : (
                                modHistoryData.map((mod, mi) => (
                                  <div key={mi} className="rounded bg-amber-50 dark:bg-amber-950 px-2 py-1 text-[10px]">
                                    <div className="font-medium text-amber-700 dark:text-amber-400">{formatAdminModification(mod)}</div>
                                    <div className="text-amber-400">
                                      {new Date(mod.createdAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" })}
                                      {" · "}{mod.modifiedBy}
                                    </div>
                                  </div>
                                ))
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                    );
                  })}
                  {selectedGroupOrders.length === 0 && loadingOrders !== selectedGroup.key && (
                    <p className="text-xs text-brand-green-dark/50 text-center py-4">No orders loaded yet</p>
                  )}
                </>
              )}
            </div>

            {/* Footer action buttons */}
            {selectedGroupOrders.length > 0 && (
              <div className="border-t border-brand-mist p-3 flex flex-wrap gap-2">
                {hasPermission(role || "staff", permissions || {}, "canMarkPaid") && (() => {
                  const totalGroupDiscount = selectedGroupOrders.reduce((s, o) => s + (o.discount || 0), 0);
                  return (
                    <button
                      type="button"
                      onClick={() => setDiscountModalGroup(selectedGroup)}
                      disabled={busy === selectedGroup.key}
                      className="flex items-center gap-1.5 rounded-lg border border-purple-500 bg-purple-50 dark:bg-purple-950 px-3 py-2 text-sm font-medium text-purple-700 dark:text-purple-400 hover:bg-purple-100 dark:hover:bg-purple-900/50 disabled:opacity-50"
                    >
                      <TagIcon className="h-3.5 w-3.5" />
                      {totalGroupDiscount > 0 ? `Discount · -₹${(totalGroupDiscount / 100).toFixed(0)}` : "Discount"}
                    </button>
                  );
                })()}
                <button
                  type="button"
                  onClick={() => { setPaymentModalMethod("cash"); setPaymentModalGroup(selectedGroup); }}
                  disabled={busy === selectedGroup.key}
                  className="flex items-center gap-1.5 rounded-lg border border-green-500 bg-green-50 dark:bg-green-950 px-3 py-2 text-sm font-medium text-green-700 dark:text-green-400 hover:bg-green-100 dark:hover:bg-green-900/50 disabled:opacity-50"
                >
                  <BanknoteIcon className="h-3.5 w-3.5" /> Cash · ₹{(actualGroupTotal / 100).toFixed(0)}
                </button>
                <button
                  type="button"
                  onClick={() => { setPaymentModalMethod("online"); setPaymentModalGroup(selectedGroup); }}
                  disabled={busy === selectedGroup.key}
                  className="flex items-center gap-1.5 rounded-lg border border-blue-500 bg-blue-50 dark:bg-blue-950 px-3 py-2 text-sm font-medium text-blue-700 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/50 disabled:opacity-50"
                >
                  <SmartphoneIcon className="h-3.5 w-3.5" /> Online
                </button>
                {btSupported && (
                  <button
                    type="button"
                    onClick={() => handlePrintGroup(selectedGroup)}
                    disabled={printingGroup === selectedGroup.key}
                    className="flex items-center gap-1.5 rounded-lg border border-gray-200 dark:border-white/10 px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-[#0f0f0f] disabled:opacity-50"
                  >
                    <PrinterIcon className="h-3.5 w-3.5" />
                    {printingGroup === selectedGroup.key ? "Printing..." : "Print"}
                  </button>
                )}
                {btSupported && (
                  <button
                    type="button"
                    onClick={() => handleKitchenPrint(selectedGroup)}
                    disabled={printingGroup === selectedGroup.key}
                    className="flex items-center gap-1.5 rounded-lg border border-orange-200 dark:border-orange-800 px-3 py-2 text-sm font-medium text-orange-700 dark:text-orange-400 hover:bg-orange-50 dark:hover:bg-orange-950 disabled:opacity-50"
                  >
                    <PrinterIcon className="h-3.5 w-3.5" />
                    Kitchen
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => handlePdfGroup(selectedGroup)}
                  className="flex items-center gap-1.5 rounded-lg border border-blue-200 dark:border-blue-800 px-3 py-2 text-sm font-medium text-blue-700 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950"
                >
                  <DownloadIcon className="h-3.5 w-3.5" /> PDF
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const checkinId = selectedGroup.guestType === "hostel"
                      ? parseInt(selectedGroup.key.replace("hostel_", ""), 10)
                      : undefined;
                    const isTable = selectedGroup.roomInfo && /^Table \d+$/i.test(selectedGroup.roomInfo);
                    const tablePhone = isTable && selectedGroupOrders.length > 0 ? selectedGroupOrders[0].guestPhone : undefined;
                    onOrderMore({
                      guestType: isTable ? "table" : selectedGroup.guestType,
                      checkinId,
                      guestName: selectedGroup.guestName,
                      guestPhone: isTable ? tablePhone : (selectedGroup.contactInfo || undefined),
                      roomInfo: selectedGroup.roomInfo || undefined,
                    });
                  }}
                  className="flex items-center gap-1.5 rounded-lg border border-blue-200 dark:border-blue-800 px-3 py-2 text-sm font-medium text-blue-700 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950"
                >
                  <PlusIcon className="h-3.5 w-3.5" /> Order More
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Payment Modal */}
      {paymentModalGroup && (
        <RecordPaymentModal
          totalAmount={actualGroupTotal}
          guestName={paymentModalGroup.guestName}
          initialMethod={paymentModalMethod}
          password={password} username={username} receiptKind="food"
          onConfirm={(method, cashReceived, changeGiven, onlineAccountId, receiptId) => {
            markGroupPaid(paymentModalGroup, method, cashReceived, changeGiven, onlineAccountId, receiptId);
            setPaymentModalGroup(null);
          }}
          onClose={() => setPaymentModalGroup(null)}
        />
      )}

      {/* Discount Modal */}
      {discountModalGroup && (() => {
        const discOrders = getGroupOrders(discountModalGroup);
        const totalGroupDiscount = discOrders.reduce((s, o) => s + (o.discount || 0), 0);
        const grossTotal = discOrders.reduce((s, o) => s + (o.discount || 0) + o.subtotal, 0);
        const exemptCategoryIds = new Set(categories.filter((c) => c.discountExempt).map((c) => c.id));
        const menuItemCategoryMap = new Map(menuItems.map((mi) => [mi.id, mi.categoryId]));
        let exemptTotal = 0;
        for (const o of discOrders) {
          for (const item of o.items) {
            if (item.status === "voided") continue;
            const catId = menuItemCategoryMap.get(item.menuItemId);
            if (catId !== undefined && exemptCategoryIds.has(catId)) {
              exemptTotal += item.lineTotal;
            }
          }
        }
        const discountableTotal = grossTotal - exemptTotal;
        return (
          <DiscountModal
            totalAmount={grossTotal}
            discountableAmount={discountableTotal}
            exemptAmount={exemptTotal}
            currentDiscount={totalGroupDiscount}
            guestName={discountModalGroup.guestName}
            onApply={async (data) => {
              const orderIds = discOrders.map((o) => o.id);
              const res = await apiCall({ action: "applyDiscount", orderIds, ...data });
              if (res.ok) {
                await refreshAfterEdit(discountModalGroup);
              }
              setDiscountModalGroup(null);
            }}
            onRemove={totalGroupDiscount > 0 ? async () => {
              const orderIds = discOrders.map((o) => o.id);
              const res = await apiCall({ action: "removeDiscount", orderIds });
              if (res.ok) {
                await refreshAfterEdit(discountModalGroup);
              }
              setDiscountModalGroup(null);
            } : undefined}
            onClose={() => setDiscountModalGroup(null)}
          />
        );
      })()}

      {/* Floating Add New Order button */}
      {onAddNewOrder && !selectedGroup && (
        <button
          type="button"
          onClick={onAddNewOrder}
          className="fixed bottom-20 right-4 sm:bottom-6 sm:right-6 z-40 flex items-center gap-2 rounded-2xl bg-brand-green px-5 py-3 text-sm font-semibold text-white shadow-lg dark:shadow-none hover:bg-brand-green/90"
        >
          <PlusIcon className="h-5 w-5" /> Add New Order
        </button>
      )}
    </div>
  );
}

// ─── Void Reason Popup ───────────────────────────────────────────────────────

const VOID_REASONS = ["Burnt", "Wrong order", "Guest complaint", "Quality issue", "Out of stock", "Other"];

function VoidReasonPopup({ itemName, onVoid, onCancel, busy }: {
  itemName: string;
  onVoid: (reason: string) => void;
  onCancel: () => void;
  busy: boolean;
}) {
  const [selectedReason, setSelectedReason] = useState<string>("");
  const [customNotes, setCustomNotes] = useState("");

  const finalReason = selectedReason === "Other"
    ? customNotes.trim() || "Other"
    : selectedReason + (customNotes.trim() ? ` — ${customNotes.trim()}` : "");

  return (
    <div className="mt-1.5 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950 p-2.5 space-y-2">
      <p className="text-xs font-medium text-red-700 dark:text-red-400">Cancel &quot;{itemName}&quot;?</p>
      <div className="flex flex-wrap gap-1">
        {VOID_REASONS.map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => setSelectedReason(r)}
            className={cn(
              "rounded-full px-2 py-0.5 text-xs transition-colors",
              selectedReason === r
                ? "bg-red-500 text-white"
                : "bg-white dark:bg-card border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/50"
            )}
          >
            {r}
          </button>
        ))}
      </div>
      <input
        className="w-full rounded border border-red-200 dark:border-red-800 bg-white dark:bg-card px-2 py-1 text-xs"
        placeholder="Additional notes (optional)"
        value={customNotes}
        onChange={(e) => setCustomNotes(e.target.value)}
      />
      <div className="flex gap-1.5">
        <button
          type="button"
          onClick={() => onVoid(finalReason)}
          disabled={busy || !selectedReason}
          className="rounded-md bg-red-500 px-3 py-1 text-xs font-medium text-white hover:bg-red-600 disabled:opacity-50"
        >
          {busy ? "Cancelling..." : "Cancel Item"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-red-200 dark:border-red-800 px-3 py-1 text-xs text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/50"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ─── Combined Bill ───────────────────────────────────────────────────────────

function CombinedBill({ apiCall }: { apiCall: (body: any) => Promise<Response> }) {
  const { showError, showSuccess } = useAdminToast();
  const [guests, setGuests] = useState<GuestWithTab[]>([]);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);
  const [preview, setPreview] = useState<{ guests: any[]; grandTotal: number } | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [btSupported, setBtSupported] = useState(false);
  const [printingCombined, setPrintingCombined] = useState(false);
  const [categories, setCategories] = useState<MenuCategory[]>([]);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);

  useEffect(() => { setBtSupported(isBluetoothSupported()); }, []);

  useEffect(() => {
    (async () => {
      const [res, menuRes] = await Promise.all([
        apiCall({ action: "getGuestsWithTabs" }),
        apiCall({ action: "getMenu" }),
      ]);
      if (res.ok) {
        const data = await res.json();
        setGuests(data.guests || []);
      }
      if (menuRes.ok) {
        const data = await menuRes.json();
        setCategories(data.categories || []);
        setMenuItems((data.items || []).map((i: any) => ({ id: i.id, categoryId: i.categoryId, name: i.name, nameKannada: i.nameKannada || "", description: i.description || "", price: i.price, priceText: i.priceText || "", tags: i.tags || "[]", isAvailable: i.isAvailable })));
      }
      setLoading(false);
    })();
  }, [apiCall]);

  const toggleGuest = (id: number) => {
    setSelectedIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
    setPreview(null);
  };

  const loadPreview = async () => {
    if (selectedIds.length === 0) return;
    setLoadingPreview(true);
    try {
      const res = await apiCall({ action: "getCombinedBill", checkinIds: selectedIds });
      if (res.ok) {
        const data = await res.json();
        setPreview(data);
      }
    } finally {
      setLoadingPreview(false);
    }
  };

  const handlePrintCombined = async () => {
    if (!preview) return;
    setPrintingCombined(true);
    try {
      const cpExemptCats = new Set(categories.filter((c) => c.discountExempt).map((c) => c.id));
      const cpMiCatMap = new Map(menuItems.map((mi) => [mi.id, mi.categoryId]));
      let cpExempt = 0;
      let cpGross = 0;
      for (const g of preview.guests as any[]) {
        for (const o of (g.orders || []) as any[]) {
          cpGross += ((o.subtotal || 0) + (o.discount || 0));
          for (const i of (o.items || []) as any[]) {
            if (i.status === "voided") continue;
            const catId = cpMiCatMap.get(i.menuItemId);
            if (catId !== undefined && cpExemptCats.has(catId)) cpExempt += (i.lineTotal || 0);
          }
        }
      }
      const guestData = preview.guests.map((g: any) => ({
        name: g.guestName as string,
        total: (g.subtotal ?? 0) as number,
        items: ((g.orders || []) as any[]).flatMap((o: any) =>
          ((o.items || []) as any[]).filter((i: any) => i.status !== "voided").map((i: any) => ({
            name: (i.itemName || i.name || "") as string,
            quantity: (i.quantity || 0) as number,
            price: (i.itemPrice || i.price || 0) as number,
            lineTotal: (i.lineTotal || 0) as number,
          }))
        ),
      }));
      const cpOrders = preview.guests.flatMap((g: any) => g.orders || []);
      const cpSub = cpOrders.reduce((s: number, o: any) => s + (o.subtotal || 0), 0);
      const cpTax = cpOrders.reduce((s: number, o: any) => s + (o.tax || 0), 0);
      await printCombinedBill(guestData, preview.grandTotal, foodTaxRateFromAmounts(cpSub, cpTax), undefined, cpGross - cpExempt, cpExempt);
      showSuccess("Combined bill printed successfully!");
    } catch (err: any) {
      showError("Print failed", err.message || "Unknown error");
    } finally {
      setPrintingCombined(false);
    }
  };

  if (loading) return <LoadingState />;

  return (
    <div className="space-y-4">
      <h3 className="font-display text-lg font-bold text-brand-green-dark">Combined Bill</h3>

      {guests.length === 0 ? (
        <div className="rounded-xl border border-brand-mist bg-white dark:bg-card p-8 text-center text-sm text-brand-green-dark/50">No guests with unpaid tabs</div>
      ) : (
        <div className="rounded-xl border border-brand-mist bg-white dark:bg-card p-4">
          <p className="mb-2 text-sm text-brand-green-dark/70">Select guests to combine:</p>
          <div className="space-y-1.5">
            {guests.map((g) => (
              <label key={g.checkinId} className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 hover:bg-brand-sand/50">
                <input
                  type="checkbox"
                  checked={selectedIds.includes(g.checkinId)}
                  onChange={() => toggleGuest(g.checkinId)}
                  className="h-4 w-4 rounded border-brand-mist text-brand-green"
                />
                <div className="flex-1">
                  <span className="text-sm font-medium text-brand-green-dark">{g.name}</span>
                  <span className="ml-2 rounded-full bg-green-100 dark:bg-green-900/50 px-2 py-0.5 text-xs text-green-700 dark:text-green-400">Goko Guest</span>
                  {g.bedInfo && <span className="ml-2 text-xs text-brand-green-dark/50">{g.bedInfo}</span>}
                </div>
                <span className="text-sm font-medium text-brand-green">₹{(g.tabTotal / 100).toFixed(0)}</span>
              </label>
            ))}
          </div>

          {selectedIds.length > 0 && (
            <button
              type="button"
              onClick={loadPreview}
              disabled={loadingPreview}
              className="mt-3 rounded-lg bg-brand-green px-4 py-2 text-sm font-medium text-white hover:bg-brand-green/90 disabled:opacity-50"
            >
              {loadingPreview ? "Loading..." : `Preview Combined Bill (${selectedIds.length} guests)`}
            </button>
          )}
        </div>
      )}

      {preview && (
        <div className="rounded-xl border border-brand-mist bg-white dark:bg-card p-4">
          <h4 className="mb-3 text-sm font-bold text-brand-green-dark">Bill Preview</h4>
          {preview.guests.map((g: any) => (
            <div key={g.checkinId} className="mb-3 border-b border-brand-mist pb-3 last:mb-0 last:border-0 last:pb-0">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-brand-green-dark">
                  {g.guestName}
                  <span className="ml-2 rounded-full bg-green-100 dark:bg-green-900/50 px-2 py-0.5 text-xs text-green-700 dark:text-green-400">Goko Guest</span>
                </span>
                <span className="text-sm font-bold">₹{(g.subtotal / 100).toFixed(0)}</span>
              </div>
              {g.roomInfo && <p className="text-xs text-brand-green-dark/50">{g.roomInfo}</p>}
              <p className="text-xs text-brand-green-dark/40">
                {g.orders.length} order(s)
                {g.orders.some((o: any) => o.hasModifications) && (
                  <span className="ml-1.5 rounded-full bg-amber-100 dark:bg-amber-900/50 px-1.5 py-0.5 text-[9px] font-semibold text-amber-700 dark:text-amber-400">Modified</span>
                )}
              </p>
            </div>
          ))}
          <div className="mt-3 flex items-center justify-between border-t border-brand-mist pt-3">
            <span className="text-sm font-bold text-brand-green-dark">Grand Total</span>
            <span className="text-lg font-bold text-brand-green">₹{(preview.grandTotal / 100).toFixed(0)}</span>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {btSupported && (
              <button
                type="button"
                onClick={handlePrintCombined}
                disabled={printingCombined}
                className="flex flex-1 items-center justify-center gap-1 rounded-lg border border-gray-200 dark:border-white/10 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-[#0f0f0f] disabled:opacity-50"
              >
                <PrinterIcon className="h-4 w-4" />
                {printingCombined ? "Printing..." : "Print Combined"}
              </button>
            )}
            <button
              type="button"
              onClick={async () => {
                if (!preview) return;
                const exemptCatIds2 = new Set(categories.filter((c) => c.discountExempt).map((c) => c.id));
                const miCatMap2 = new Map(menuItems.map((mi) => [mi.id, mi.categoryId]));
                let combExemptSub = 0;
                let combGrossSub = 0;
                for (const g of preview.guests as any[]) {
                  for (const o of (g.orders || []) as any[]) {
                    combGrossSub += ((o.subtotal || 0) + (o.discount || 0));
                    for (const i of (o.items || []) as any[]) {
                      if (i.status === "voided") continue;
                      const catId = miCatMap2.get(i.menuItemId);
                      if (catId !== undefined && exemptCatIds2.has(catId)) combExemptSub += (i.lineTotal || 0);
                    }
                  }
                }
                const combOrders = (preview.guests as any[]).flatMap((g: any) => g.orders || []);
                const combSub = combOrders.reduce((s: number, o: any) => s + (o.subtotal || 0), 0);
                const combTax = combOrders.reduce((s: number, o: any) => s + (o.tax || 0), 0);
                const combinedData: CombinedBillData = {
                  guests: preview.guests.map((g: any) => ({
                    guestName: g.guestName as string,
                    guestPhone: (g.guestPhone || "") as string,
                    roomInfo: g.roomInfo || undefined,
                    orders: ((g.orders || []) as any[]).map((o: any) => ({
                      orderNumber: o.orderNumber as string,
                      createdAt: o.createdAt as string,
                      items: ((o.items || []) as any[]).filter((i: any) => i.status !== "voided").map((i: any) => ({
                        itemName: (i.itemName || i.name || "") as string,
                        quantity: (i.quantity || 0) as number,
                        itemPrice: (i.itemPrice || i.price || 0) as number,
                        lineTotal: (i.lineTotal || 0) as number,
                        status: (i.status || "active") as string,
                      })),
                      subtotal: (o.subtotal || 0) as number,
                      tax: (o.tax || 0) as number,
                      total: (o.total || 0) as number,
                      specialInstructions: o.specialInstructions || undefined,
                    })),
                    guestSubtotal: (g.subtotal || 0) as number,
                    guestTax: (g.tax || 0) as number,
                    guestTotal: (g.subtotal || 0) as number,
                  })),
                  grandSubtotal: combSub,
                  grandTax: combTax,
                  grandTotal: preview.grandTotal,
                  taxRate: foodTaxRateFromAmounts(combSub, combTax),
                  billDate: new Date().toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }),
                  discountableSubtotal: combGrossSub - combExemptSub,
                  exemptSubtotal: combExemptSub,
                };
                await generateCombinedBill(combinedData);
              }}
              className="flex flex-1 items-center justify-center gap-1 rounded-lg border border-blue-200 dark:border-blue-800 px-4 py-2 text-sm font-medium text-blue-700 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950"
            >
              <DownloadIcon className="h-4 w-4" />
              Download PDF
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Payment Summary ─────────────────────────────────────────────────────────

type PaymentFilter = "all" | "hostel" | "walkin";

interface PaymentGroup {
  key: string;
  guestName: string;
  guestType: "hostel" | "walkin";
  contactInfo: string;
  roomInfo: string;
  orders: Order[];
  totalAmount: number;
  paidAmount: number;
  pendingAmount: number;
  cashPaid: number;
  onlinePaid: number;
  orderCount: number;
  latestOrderTime: string;
}

function PaymentSummary({ apiCall, password, username }: { apiCall: (body: any) => Promise<Response>; password: string; username?: string }) {
  const [allOrders, setAllOrders] = useState<Order[]>([]);
  const [hostelGuestInfo, setHostelGuestInfo] = useState<Map<number, GuestWithTab>>(new Map());
  const [detailOrders, setDetailOrders] = useState<Record<string, Order[]>>({});
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<PaymentFilter>("all");
  const [selectedGroupKey, setSelectedGroupKey] = useState<string | null>(null);
  usePanelHistory(selectedGroupKey !== null, () => { setSelectedGroupKey(null); setPaymentEditOrder(null); setRevertConfirmOrder(null); });
  const [loadingOrders, setLoadingOrders] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [paymentEditOrder, setPaymentEditOrder] = useState<Order | null>(null);
  const [revertConfirmOrder, setRevertConfirmOrder] = useState<Order | null>(null);
  const [paidVisibilityDays, setPaidVisibilityDays] = useState(7);
  const [showHistory, setShowHistory] = useState(false);
  usePanelHistory(showHistory, () => setShowHistory(false));
  const [categories, setCategories] = useState<MenuCategory[]>([]);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [modHistoryOrderId, setModHistoryOrderId] = useState<number | null>(null);
  const [modHistoryData, setModHistoryData] = useState<OrderModification[]>([]);
  const [modHistoryLoading, setModHistoryLoading] = useState(false);

  const toggleModHistory = async (orderId: number) => {
    if (modHistoryOrderId === orderId) { setModHistoryOrderId(null); return; }
    setModHistoryOrderId(orderId);
    setModHistoryLoading(true);
    try {
      const res = await apiCall({ action: "getOrderModifications", orderId });
      if (res.ok) { const data = await res.json(); setModHistoryData(data.modifications || []); }
      else { setModHistoryData([]); }
    } catch { setModHistoryData([]); }
    finally { setModHistoryLoading(false); }
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [hostelRes, ordersRes, menuRes] = await Promise.all([
        apiCall({ action: "getGuestsWithTabs" }),
        apiCall({ action: "listOrders", status: "all_history", limit: 200 }),
        apiCall({ action: "getMenu" }),
      ]);
      if (hostelRes.ok) {
        const data = await hostelRes.json();
        const map = new Map<number, GuestWithTab>();
        for (const g of (data.guests || []) as GuestWithTab[]) map.set(g.checkinId, g);
        setHostelGuestInfo(map);
      }
      if (ordersRes.ok) {
        const data = await ordersRes.json();
        setAllOrders(data.orders || []);
      }
      if (menuRes.ok) {
        const data = await menuRes.json();
        setPaidVisibilityDays(parseInt(data.paymentHistoryDays) || 7);
        setCategories(data.categories || []);
        setMenuItems((data.items || []).map((i: any) => ({ id: i.id, categoryId: i.categoryId, name: i.name, nameKannada: i.nameKannada || "", description: i.description || "", price: i.price, priceText: i.priceText || "", tags: i.tags || "[]", isAvailable: i.isAvailable })));
      }
    } finally {
      setLoading(false);
    }
  }, [apiCall]);

  useEffect(() => { load(); }, [load]);

  const groups: PaymentGroup[] = useMemo(() => {
    const result: PaymentGroup[] = [];

    const hostelMap = new Map<number, Order[]>();
    const walkinMap = new Map<string, Order[]>();

    for (const order of allOrders) {
      if (order.status === "cancelled") continue;
      if (order.guestType === "hostel" && order.checkinId) {
        if (!hostelMap.has(order.checkinId)) hostelMap.set(order.checkinId, []);
        hostelMap.get(order.checkinId)!.push(order);
      } else {
        const isTable = order.roomInfo && /^Table \d+$/i.test(order.roomInfo);
        const key = isTable ? `table_${order.roomInfo}` : (order.guestPhone || `_no_phone_${order.id}`);
        if (!walkinMap.has(key)) walkinMap.set(key, []);
        walkinMap.get(key)!.push(order);
      }
    }

    for (const [checkinId, orders] of hostelMap) {
      const guestInfo = hostelGuestInfo.get(checkinId);
      const overrideOrders = detailOrders[`hostel_${checkinId}`];
      const effectiveOrders = overrideOrders || orders;
      const nonCancelled = effectiveOrders.filter(o => o.status !== "cancelled");
      const paidAmt = nonCancelled.filter(o => o.paymentStatus === "paid").reduce((s, o) => s + o.total, 0);
      const pendingAmt = nonCancelled.filter(o => o.paymentStatus !== "paid").reduce((s, o) => s + o.total, 0);
      const cashAmt = nonCancelled.filter(o => o.paymentStatus === "paid" && o.paymentMethod === "cash").reduce((s, o) => s + o.total, 0);
      const onlineAmt = nonCancelled.filter(o => o.paymentStatus === "paid" && (o.paymentMethod === "online" || o.paymentMethod === "split")).reduce((s, o) => s + o.total, 0);
      const totalAmt = nonCancelled.reduce((s, o) => s + o.total, 0);
      result.push({
        key: `hostel_${checkinId}`,
        guestName: guestInfo?.name || orders[0].guestName,
        guestType: "hostel",
        contactInfo: guestInfo?.contact || orders[0].guestPhone,
        roomInfo: guestInfo?.bedInfo || orders[0].roomInfo,
        orders: effectiveOrders,
        totalAmount: totalAmt,
        paidAmount: paidAmt,
        pendingAmount: pendingAmt,
        cashPaid: cashAmt,
        onlinePaid: onlineAmt,
        orderCount: nonCancelled.length,
        latestOrderTime: nonCancelled.reduce((max, o) => o.createdAt > max ? o.createdAt : max, ""),
      });
    }

    for (const [groupKey, orders] of walkinMap) {
      const overrideOrders = detailOrders[`walkin_${groupKey}`];
      const effectiveOrders = overrideOrders || orders;
      const nonCancelled = effectiveOrders.filter(o => o.status !== "cancelled");
      const paidAmt = nonCancelled.filter(o => o.paymentStatus === "paid").reduce((s, o) => s + o.total, 0);
      const pendingAmt = nonCancelled.filter(o => o.paymentStatus !== "paid").reduce((s, o) => s + o.total, 0);
      const cashAmt = nonCancelled.filter(o => o.paymentStatus === "paid" && o.paymentMethod === "cash").reduce((s, o) => s + o.total, 0);
      const onlineAmt = nonCancelled.filter(o => o.paymentStatus === "paid" && (o.paymentMethod === "online" || o.paymentMethod === "split")).reduce((s, o) => s + o.total, 0);
      const totalAmt = nonCancelled.reduce((s, o) => s + o.total, 0);
      const isTableGroup = groupKey.startsWith("table_");
      result.push({
        key: `walkin_${groupKey}`,
        guestName: effectiveOrders[0].guestName,
        guestType: "walkin",
        contactInfo: isTableGroup ? "" : (groupKey.startsWith("_no_phone_") ? "" : groupKey),
        roomInfo: isTableGroup ? effectiveOrders[0].roomInfo : "",
        orders: effectiveOrders,
        totalAmount: totalAmt,
        paidAmount: paidAmt,
        pendingAmount: pendingAmt,
        cashPaid: cashAmt,
        onlinePaid: onlineAmt,
        orderCount: nonCancelled.length,
        latestOrderTime: nonCancelled.reduce((max, o) => o.createdAt > max ? o.createdAt : max, ""),
      });
    }

    result.sort((a, b) => {
      if (a.pendingAmount > 0 && b.pendingAmount <= 0) return -1;
      if (a.pendingAmount <= 0 && b.pendingAmount > 0) return 1;
      return (b.latestOrderTime || "").localeCompare(a.latestOrderTime || "");
    });

    return result;
  }, [allOrders, hostelGuestInfo, detailOrders]);

  const filteredGroups = useMemo(() => {
    if (filter === "all") return groups;
    return groups.filter((g) => g.guestType === filter);
  }, [groups, filter]);

  const selectedGroup = selectedGroupKey ? groups.find((g) => g.key === selectedGroupKey) || null : null;
  const selectedOrders = selectedGroup ? selectedGroup.orders : [];

  const selectGroup = async (group: PaymentGroup) => {
    setSelectedGroupKey(group.key);
    setModHistoryOrderId(null);
    if (group.guestType === "hostel" && !detailOrders[group.key]) {
      const checkinId = parseInt(group.key.replace("hostel_", ""), 10);
      setLoadingOrders(group.key);
      try {
        const res = await apiCall({ action: "getGuestAllOrders", checkinId });
        if (res.ok) {
          const data = await res.json();
          setDetailOrders((prev) => ({ ...prev, [group.key]: data.orders || [] }));
        }
      } finally {
        setLoadingOrders(null);
      }
    }
  };

  const refreshGroupOrders = useCallback(async (group: PaymentGroup) => {
    if (group.guestType === "hostel") {
      const checkinId = parseInt(group.key.replace("hostel_", ""), 10);
      const res = await apiCall({ action: "getGuestAllOrders", checkinId });
      if (res.ok) {
        const data = await res.json();
        setDetailOrders((prev) => ({ ...prev, [group.key]: data.orders || [] }));
      }
    }
    const ordersRes = await apiCall({ action: "listOrders", status: "all_history", limit: 200 });
    if (ordersRes.ok) {
      const data = await ordersRes.json();
      setAllOrders(data.orders || []);
    }
  }, [apiCall]);

  const handleMarkPaid = async (order: Order, method: string, cashReceived: number = 0, changeGiven: number = 0, onlineAccountId?: number, receiptId?: string) => {
    setBusy(true);
    try {
      const res = await apiCall({
        action: "updatePaymentDetails",
        orderId: order.id,
        paymentStatus: "paid",
        paymentMethod: method,
        cashReceived,
        changeGiven,
        onlineAccountId,
        receiptId,
      });
      if (res.ok && selectedGroup) {
        setPaymentEditOrder(null);
        await refreshGroupOrders(selectedGroup);
      }
    } finally {
      setBusy(false);
    }
  };

  const handleRevertToPending = async (order: Order) => {
    setBusy(true);
    try {
      const res = await apiCall({
        action: "updatePaymentDetails",
        orderId: order.id,
        paymentStatus: order.guestType === "hostel" && order.checkinId ? "on_tab" : "pending",
        paymentMethod: "",
        cashReceived: 0,
        changeGiven: 0,
      });
      if (res.ok && selectedGroup) {
        setRevertConfirmOrder(null);
        await refreshGroupOrders(selectedGroup);
      }
    } finally {
      setBusy(false);
    }
  };

  const handleUpdatePayment = async (order: Order, updates: { paymentMethod?: string; cashReceived?: number; changeGiven?: number; onlineAccountId?: number; receiptId?: string }) => {
    setBusy(true);
    try {
      const res = await apiCall({
        action: "updatePaymentDetails",
        orderId: order.id,
        ...updates,
      });
      if (res.ok && selectedGroup) {
        await refreshGroupOrders(selectedGroup);
      }
    } finally {
      setBusy(false);
    }
  };

  const fmt = (paise: number) => `₹${(paise / 100).toFixed(0)}`;

  const actualGroupTotal = selectedOrders.length > 0
    ? selectedOrders.reduce((sum, o) => sum + o.total, 0)
    : selectedGroup?.totalAmount || 0;
  const actualGroupPaid = selectedOrders.length > 0
    ? selectedOrders.filter(o => o.paymentStatus === "paid").reduce((sum, o) => sum + o.total, 0)
    : selectedGroup?.paidAmount || 0;
  const actualGroupPending = actualGroupTotal - actualGroupPaid;

  if (loading) return <LoadingState />;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-display text-lg font-bold text-brand-green-dark">Payment Summary ({filteredGroups.length})</h3>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setShowHistory(true)} className="flex items-center gap-1 rounded-lg border border-brand-mist px-3 py-1.5 text-sm text-brand-green-dark/70 hover:bg-brand-sand">
            <HistoryIcon className="h-3.5 w-3.5" /> Payment History
          </button>
          <button type="button" onClick={load} className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm text-brand-green hover:bg-brand-green/[0.06]">
            <RefreshCwIcon className="h-3.5 w-3.5" /> Refresh
          </button>
        </div>
      </div>

      <div className="flex gap-1 rounded-lg border border-brand-mist bg-white dark:bg-card p-1">
        {([
          { id: "all" as PaymentFilter, label: "All" },
          { id: "hostel" as PaymentFilter, label: "Goko Guest" },
          { id: "walkin" as PaymentFilter, label: "Walk-in" },
        ]).map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFilter(f.id)}
            className={cn(
              "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
              filter === f.id ? "bg-brand-green text-white" : "text-brand-green-dark/70 hover:bg-brand-green/[0.06]"
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {filteredGroups.length === 0 && (
        <div className="rounded-xl border border-brand-mist bg-white dark:bg-card p-8 text-center text-sm text-brand-green-dark/50">
          No orders found
        </div>
      )}

      {(() => {
        const pendingGroups = filteredGroups.filter((g) => g.pendingAmount > 0);
        const paidCutoff = new Date();
        paidCutoff.setDate(paidCutoff.getDate() - paidVisibilityDays);
        const paidCutoffStr = paidCutoff.toISOString();
        const paidGroups = filteredGroups.filter((g) => g.pendingAmount <= 0 && g.paidAmount > 0 && g.latestOrderTime >= paidCutoffStr);

        const renderCard = (group: PaymentGroup) => {
          const allPaid = group.pendingAmount <= 0 && group.paidAmount > 0;
          return (
            <button
              key={group.key}
              type="button"
              onClick={() => selectGroup(group)}
              className={cn(
                "rounded-xl border bg-white dark:bg-card p-3 text-left transition-shadow hover:shadow-md dark:hover:shadow-none",
                allPaid
                  ? "border-brand-mist border-l-[3px] border-l-green-400"
                  : group.pendingAmount > 0
                    ? "border-brand-mist border-l-[3px] border-l-red-400"
                    : "border-brand-mist border-l-[3px] border-l-gray-300"
              )}
            >
              <div className="flex items-start justify-between gap-1">
                <span className="min-w-0 truncate text-sm font-bold text-brand-green-dark">{group.guestName}</span>
                {group.guestType === "hostel" ? (
                  <span className="flex-shrink-0 rounded-full bg-green-100 dark:bg-green-900/50 px-1.5 py-0.5 text-[10px] font-medium text-green-700 dark:text-green-400">Goko</span>
                ) : (
                  <span className="flex-shrink-0 rounded-full bg-gray-200 dark:bg-[#2a2a2a] px-1.5 py-0.5 text-[10px] font-medium text-gray-600 dark:text-gray-400">Walk-in</span>
                )}
              </div>
              {(group.roomInfo || group.contactInfo) && (
                <p className="mt-0.5 truncate text-xs text-brand-green-dark/50">
                  {group.roomInfo || group.contactInfo}
                </p>
              )}
              <p className="mt-2 text-lg font-bold text-brand-green">{fmt(group.totalAmount)}</p>
              <div className="mt-1 space-y-0.5">
                {group.paidAmount > 0 && (
                  <p className="text-xs text-green-600">{fmt(group.paidAmount)} paid</p>
                )}
                {group.pendingAmount > 0 && (
                  <p className="text-xs font-semibold text-red-600">₹{Math.round(group.totalAmount / 100) - Math.round(group.paidAmount / 100)} pending</p>
                )}
                {allPaid && (
                  <p className="text-xs font-semibold text-green-600">All paid</p>
                )}
              </div>
              <div className="mt-1 text-xs text-brand-green-dark/40">
                {group.orderCount} order{group.orderCount !== 1 ? "s" : ""}
                {group.orders.some((o) => o.hasModifications) && (
                  <span className="ml-1.5 rounded-full bg-amber-100 dark:bg-amber-900/50 px-1.5 py-0.5 text-[9px] font-semibold text-amber-700 dark:text-amber-400">Modified</span>
                )}
              </div>
            </button>
          );
        };

        return (
          <>
            {pendingGroups.length > 0 && (
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-red-600">Pending ({pendingGroups.length})</p>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                  {pendingGroups.map(renderCard)}
                </div>
              </div>
            )}
            {paidGroups.length > 0 && (
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-green-600">All Paid ({paidGroups.length})</p>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                  {paidGroups.map(renderCard)}
                </div>
              </div>
            )}
          </>
        );
      })()}

      {/* Slide-over Panel */}
      {selectedGroup && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/30" onClick={() => { setSelectedGroupKey(null); setPaymentEditOrder(null); setRevertConfirmOrder(null); }} />
          <div className="relative flex h-full w-full max-w-md flex-col bg-white dark:bg-card shadow-xl dark:shadow-none animate-in slide-in-from-right duration-200">
            <div className="flex items-center justify-between border-b border-brand-mist px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="min-w-0 truncate text-base font-bold text-brand-green-dark">{selectedGroup.guestName}</h3>
                  {selectedGroup.guestType === "hostel" ? (
                    <span className="flex-shrink-0 rounded-full bg-green-100 dark:bg-green-900/50 px-2 py-0.5 text-xs text-green-700 dark:text-green-400">Goko Guest</span>
                  ) : (
                    <span className="flex-shrink-0 rounded-full bg-gray-200 dark:bg-[#2a2a2a] px-2 py-0.5 text-xs text-gray-600 dark:text-gray-400">Walk-in</span>
                  )}
                </div>
                {(selectedGroup.roomInfo || selectedGroup.contactInfo) && (
                  <p className="text-xs text-brand-green-dark/50">{[selectedGroup.roomInfo, selectedGroup.contactInfo].filter(Boolean).join(" · ")}</p>
                )}
              </div>
              <button type="button" onClick={() => { setSelectedGroupKey(null); setPaymentEditOrder(null); setRevertConfirmOrder(null); }} className="flex-shrink-0 rounded-lg p-1.5 hover:bg-brand-sand">
                <XIcon className="h-5 w-5 text-brand-green-dark/60" />
              </button>
            </div>

            {/* Payment totals bar */}
            <div className="bg-brand-sand/30 px-4 py-3 space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-sm text-brand-green-dark/70">Total</span>
                <span className="text-xl font-bold text-brand-green">{fmt(actualGroupTotal)}</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-green-600">Paid: {fmt(actualGroupPaid)}</span>
                {actualGroupPending > 0 && (
                  <span className="font-semibold text-red-600">Pending: ₹{Math.round(actualGroupTotal / 100) - Math.round(actualGroupPaid / 100)}</span>
                )}
                {actualGroupPending <= 0 && actualGroupPaid > 0 && (
                  <span className="font-semibold text-green-600">All Paid</span>
                )}
              </div>
            </div>

            {/* Orders list */}
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 space-y-2">
              {loadingOrders === selectedGroup.key ? (
                <div className="flex justify-center py-8"><Loader2Icon className="h-5 w-5 animate-spin text-brand-green" /></div>
              ) : (
                <>
                  {selectedOrders.map((order) => (
                    <div key={order.id} className={cn("rounded-lg border p-3", order.paymentStatus === "paid" ? "border-green-200 dark:border-green-800 bg-green-50/30 dark:bg-green-950/30" : "border-brand-mist")}>
                      <div className="flex flex-wrap items-center justify-between gap-1">
                        <div className="flex flex-wrap items-center gap-1">
                          <span className="font-mono text-xs font-bold text-brand-green">{order.orderNumber}</span>
                          <StatusBadge status={order.status} />
                          <PaymentBadge status={order.paymentStatus} />
                          {order.hasModifications && (
                            <span className="rounded-full bg-amber-100 dark:bg-amber-900/50 px-1.5 py-0.5 text-[9px] font-semibold text-amber-700 dark:text-amber-400">Modified</span>
                          )}
                        </div>
                        <span className="text-sm font-semibold text-brand-green-dark">{fmt(order.total)}</span>
                      </div>

                      {/* Items (read-only) */}
                      <div className="mt-1.5 space-y-0.5">
                        {order.items.map((item) => (
                          <div key={item.id} className={cn("flex items-center justify-between text-xs text-brand-green-dark/60", item.status === "voided" && "line-through opacity-50")}>
                            <span>{item.quantity}× {item.itemName}</span>
                            <span>{fmt(item.lineTotal)}</span>
                          </div>
                        ))}
                      </div>

                      {/* Payment details */}
                      <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 border-t border-brand-mist/50 pt-2 text-xs">
                        <span>
                          {order.paymentStatus === "paid" && order.paymentMethod ? (
                            <PaymentDetailLabel method={order.paymentMethod} total={order.total} cashReceived={order.cashReceived} changeGiven={order.changeGiven} />
                          ) : (
                            <PaymentBadge status={order.paymentStatus} />
                          )}
                        </span>
                        <span className="text-brand-green-dark/40">
                          {new Date(order.createdAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" })}
                        </span>
                      </div>

                      {/* Actions */}
                      {order.status !== "cancelled" && (
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          {order.paymentStatus !== "paid" ? (
                            <button
                              type="button"
                              onClick={() => setPaymentEditOrder(order)}
                              disabled={busy}
                              className="flex items-center gap-1 rounded-md bg-green-100 dark:bg-green-900/50 px-2.5 py-1 text-xs font-medium text-green-700 dark:text-green-400 hover:bg-green-200 dark:hover:bg-green-800 disabled:opacity-50"
                            >
                              <BanknoteIcon className="h-3 w-3" /> Mark Paid
                            </button>
                          ) : (
                            <>
                              <button
                                type="button"
                                onClick={() => setPaymentEditOrder(order)}
                                disabled={busy}
                                className="flex items-center gap-1 rounded-md border border-brand-mist px-2.5 py-1 text-xs font-medium text-brand-green-dark/70 hover:bg-brand-sand disabled:opacity-50"
                              >
                                <PencilIcon className="h-3 w-3" /> Edit Payment
                              </button>
                              <button
                                type="button"
                                onClick={() => setRevertConfirmOrder(order)}
                                disabled={busy}
                                className="flex items-center gap-1 rounded-md border border-red-200 dark:border-red-800 px-2.5 py-1 text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950 disabled:opacity-50"
                              >
                                Revert to Pending
                              </button>
                            </>
                          )}
                        </div>
                      )}
                      {order.hasModifications && (
                        <div className="mt-1.5 border-t border-brand-mist pt-1.5">
                          <button type="button" onClick={() => toggleModHistory(order.id)} className="text-[10px] font-medium text-amber-600 dark:text-amber-400 hover:text-amber-700 dark:hover:text-amber-300">
                            {modHistoryOrderId === order.id ? "Hide history" : "View modifications"}
                          </button>
                          {modHistoryOrderId === order.id && (
                            <div className="mt-1 space-y-1">
                              {modHistoryLoading ? (
                                <p className="text-[10px] text-brand-green-dark/40">Loading...</p>
                              ) : modHistoryData.length === 0 ? (
                                <p className="text-[10px] text-brand-green-dark/40">No modifications</p>
                              ) : (
                                modHistoryData.map((mod, mi) => (
                                  <div key={mi} className="rounded bg-amber-50 dark:bg-amber-950 px-2 py-1 text-[10px]">
                                    <div className="font-medium text-amber-700 dark:text-amber-400">{formatAdminModification(mod)}</div>
                                    <div className="text-amber-400">
                                      {new Date(mod.createdAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" })}
                                      {" · "}{mod.modifiedBy}
                                    </div>
                                  </div>
                                ))
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                  {selectedOrders.length === 0 && loadingOrders !== selectedGroup.key && (
                    <p className="text-xs text-brand-green-dark/50 text-center py-4">No orders loaded yet. Click to load.</p>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Payment Modal for marking paid */}
      {paymentEditOrder && (
        <RecordPaymentModal
          totalAmount={paymentEditOrder.total}
          guestName={selectedGroup?.guestName || ""}
          initialMethod={paymentEditOrder.paymentStatus === "paid" ? (paymentEditOrder.paymentMethod || "online") : "online"}
          initialCash={paymentEditOrder.paymentStatus === "paid" ? paymentEditOrder.cashReceived : 0}
          password={password} username={username} receiptKind="food"
          onConfirm={(method, cashReceived, changeGiven, onlineAccountId, receiptId) => {
            if (paymentEditOrder.paymentStatus === "paid") {
              handleUpdatePayment(paymentEditOrder, { paymentMethod: method, cashReceived, changeGiven, onlineAccountId, receiptId });
            } else {
              handleMarkPaid(paymentEditOrder, method, cashReceived, changeGiven, onlineAccountId, receiptId);
            }
            setPaymentEditOrder(null);
          }}
          onClose={() => setPaymentEditOrder(null)}
        />
      )}

      {/* Revert confirmation */}
      {/* Payment History */}
      {showHistory && (
        <PaymentHistoryPanel apiCall={apiCall} onClose={() => setShowHistory(false)} />
      )}

      {revertConfirmOrder && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setRevertConfirmOrder(null)} />
          <div className="relative w-full max-w-sm rounded-2xl bg-white dark:bg-card p-6 shadow-2xl dark:shadow-none">
            <h3 className="text-base font-bold text-brand-green-dark">Revert to Pending?</h3>
            <p className="mt-2 text-sm text-brand-green-dark/70">
              This will mark order <span className="font-mono font-bold">{revertConfirmOrder.orderNumber}</span> ({fmt(revertConfirmOrder.total)}) as unpaid. This action will be logged.
            </p>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => handleRevertToPending(revertConfirmOrder)}
                disabled={busy}
                className="flex-1 rounded-lg bg-red-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                {busy ? "Reverting..." : "Yes, Revert"}
              </button>
              <button
                type="button"
                onClick={() => setRevertConfirmOrder(null)}
                className="flex-1 rounded-lg border border-brand-mist px-4 py-2.5 text-sm font-medium text-brand-green-dark/70 hover:bg-brand-sand"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Payment History Panel ────────────────────────────────────────────────────

type HistoryRange = "7" | "15" | "30" | "custom";

function PaymentHistoryPanel({ apiCall, onClose }: { apiCall: (body: any) => Promise<Response>; onClose: () => void }) {
  const [range, setRange] = useState<HistoryRange>("7");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(false);
  const [categories, setCategories] = useState<MenuCategory[]>([]);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);

  const getDateRange = useCallback(() => {
    if (range === "custom") return { from: customFrom, to: customTo };
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - parseInt(range));
    return { from: localDateStr(from), to: localDateStr(to) };
  }, [range, customFrom, customTo]);

  const loadHistory = useCallback(async () => {
    const { from, to } = getDateRange();
    if (!from || !to) return;
    setLoading(true);
    try {
      const res = await apiCall({ action: "listOrders", dateFrom: from, dateTo: to, limit: 200 });
      if (res.ok) {
        const data = await res.json();
        setOrders(data.orders || []);
      }
    } finally { setLoading(false); }
  }, [apiCall, getDateRange]);

  useEffect(() => { if (range !== "custom") loadHistory(); }, [range]);

  useEffect(() => {
    (async () => {
      const res = await apiCall({ action: "getMenu" });
      if (res.ok) {
        const data = await res.json();
        setCategories(data.categories || []);
        setMenuItems((data.items || []).map((i: any) => ({ id: i.id, categoryId: i.categoryId, name: i.name, nameKannada: i.nameKannada || "", description: i.description || "", price: i.price, priceText: i.priceText || "", tags: i.tags || "[]", isAvailable: i.isAvailable })));
      }
    })();
  }, [apiCall]);

  const fmt = (paise: number) => `₹${Math.round(paise / 100)}`;

  const grouped = useMemo(() => {
    const map = new Map<string, { guestName: string; guestType: string; orders: Order[]; total: number; paid: number; pending: number }>();
    for (const o of orders) {
      if (o.status === "cancelled") continue;
      const isTable = o.roomInfo && /^Table \d+$/i.test(o.roomInfo);
      const key = o.guestType === "hostel" && o.checkinId
        ? `hostel_${o.checkinId}`
        : isTable ? `table_${o.roomInfo}` : (o.guestPhone || `_${o.id}`);
      if (!map.has(key)) map.set(key, { guestName: o.guestName, guestType: o.guestType, orders: [], total: 0, paid: 0, pending: 0 });
      const g = map.get(key)!;
      g.orders.push(o);
      g.total += o.total;
      if (o.paymentStatus === "paid") g.paid += o.total;
      else g.pending += o.total;
    }
    return [...map.values()].sort((a, b) => {
      const aTime = a.orders[0]?.createdAt || "";
      const bTime = b.orders[0]?.createdAt || "";
      return bTime.localeCompare(aTime);
    });
  }, [orders]);

  const totalAll = orders.filter(o => o.status !== "cancelled").reduce((s, o) => s + o.total, 0);
  const totalPaid = orders.filter(o => o.paymentStatus === "paid" && o.status !== "cancelled").reduce((s, o) => s + o.total, 0);
  const totalPending = totalAll - totalPaid;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative flex h-full w-full max-w-lg flex-col bg-white dark:bg-card shadow-xl dark:shadow-none animate-in slide-in-from-right duration-200">
        <div className="flex items-center justify-between border-b border-brand-mist px-4 py-3">
          <h3 className="text-base font-bold text-brand-green-dark">Payment History</h3>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 hover:bg-brand-sand">
            <XIcon className="h-5 w-5 text-brand-green-dark/60" />
          </button>
        </div>

        <div className="border-b border-brand-mist px-4 py-3 space-y-3">
          <div className="flex flex-wrap gap-1.5">
            {([
              { id: "7" as HistoryRange, label: "7 days" },
              { id: "15" as HistoryRange, label: "15 days" },
              { id: "30" as HistoryRange, label: "30 days" },
              { id: "custom" as HistoryRange, label: "Custom" },
            ]).map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => setRange(r.id)}
                className={cn(
                  "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                  range === r.id ? "bg-brand-green text-white" : "border border-brand-mist text-brand-green-dark/70 hover:bg-brand-green/[0.06]"
                )}
              >
                {r.label}
              </button>
            ))}
          </div>
          {range === "custom" && (
            <div className="flex flex-wrap items-center gap-2">
              <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className="rounded-md border border-brand-mist px-2 py-1.5 text-sm" />
              <span className="text-xs text-brand-green-dark/50">to</span>
              <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} className="rounded-md border border-brand-mist px-2 py-1.5 text-sm" />
              <button type="button" onClick={loadHistory} disabled={!customFrom || !customTo || loading} className="rounded-md bg-brand-green px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-green/90 disabled:opacity-50">
                Search
              </button>
            </div>
          )}
        </div>

        {/* Summary bar */}
        {orders.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2 bg-brand-sand/30 px-4 py-2.5 text-xs">
            <span className="font-medium text-brand-green-dark">{orders.length} orders · {grouped.length} guests</span>
            <div className="flex items-center gap-3">
              <span className="text-brand-green-dark">Total: {fmt(totalAll)}</span>
              <span className="text-green-600">Paid: {fmt(totalPaid)}</span>
              {totalPending > 0 && <span className="font-semibold text-red-600">Pending: {fmt(totalPending)}</span>}
            </div>
          </div>
        )}

        {/* Content */}
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 space-y-3">
          {loading ? (
            <div className="flex justify-center py-8"><Loader2Icon className="h-5 w-5 animate-spin text-brand-green" /></div>
          ) : grouped.length === 0 ? (
            <p className="py-8 text-center text-sm text-brand-green-dark/50">No orders found for this period</p>
          ) : (
            grouped.map((g, idx) => (
              <div key={idx} className="rounded-lg border border-brand-mist p-3">
                <div className="flex flex-wrap items-center justify-between gap-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-brand-green-dark">{g.guestName}</span>
                    {g.guestType === "hostel" ? (
                      <span className="rounded-full bg-green-100 dark:bg-green-900/50 px-1.5 py-0.5 text-[10px] font-medium text-green-700 dark:text-green-400">Goko</span>
                    ) : (
                      <span className="rounded-full bg-gray-200 dark:bg-[#2a2a2a] px-1.5 py-0.5 text-[10px] font-medium text-gray-600 dark:text-gray-400">Walk-in</span>
                    )}
                  </div>
                  <span className="text-sm font-bold text-brand-green">{fmt(g.total)}</span>
                </div>
                <div className="mt-1 flex items-center gap-3 text-xs">
                  <span className="text-brand-green-dark/50">{g.orders.length} order{g.orders.length !== 1 ? "s" : ""}</span>
                  {g.paid > 0 && <span className="text-green-600">{fmt(g.paid)} paid</span>}
                  {g.pending > 0 && <span className="font-semibold text-red-600">{fmt(g.pending)} pending</span>}
                </div>
                <div className="mt-2 space-y-1">
                  {g.orders.map((o) => (
                    <div key={o.id} className="flex flex-wrap items-center justify-between gap-1 rounded bg-brand-sand/30 px-2 py-1 text-xs">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono font-bold text-brand-green">{o.orderNumber}</span>
                        <PaymentBadge status={o.paymentStatus} />
                      </div>
                      <div className="flex items-center gap-2 text-brand-green-dark/50">
                        <span>{new Date(o.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" })}</span>
                        <span className="font-medium text-brand-green-dark">{fmt(o.total)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Order History ───────────────────────────────────────────────────────────

export function OrderHistory({ apiCall }: { apiCall: (body: any) => Promise<Response> }) {
  const { showError, showSuccess } = useAdminToast();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [categories, setCategories] = useState<MenuCategory[]>([]);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [statusFilter, setStatusFilter] = useState("");
  const [guestTypeFilter, setGuestTypeFilter] = useState("");
  const [phoneFilter, setPhoneFilter] = useState("");
  const [expandedOrder, setExpandedOrder] = useState<number | null>(null);
  const [showCleanupConfirm, setShowCleanupConfirm] = useState(false);
  const [cleanupBusy, setCleanupBusy] = useState(false);
  const [cleanupResult, setCleanupResult] = useState("");
  const [btSupported, setBtSupported] = useState(false);
  const [printing, setPrinting] = useState<number | null>(null);
  const [modHistoryOrder, setModHistoryOrder] = useState<number | null>(null);
  const [modHistory, setModHistory] = useState<OrderModification[]>([]);
  const [modHistoryLoading, setModHistoryLoading] = useState(false);

  useEffect(() => { setBtSupported(isBluetoothSupported()); }, []);

  const fetchModHistory = async (orderId: number) => {
    if (modHistoryOrder === orderId) {
      setModHistoryOrder(null);
      return;
    }
    setModHistoryOrder(orderId);
    setModHistoryLoading(true);
    try {
      const res = await apiCall({ action: "getOrderModifications", orderId });
      if (res.ok) {
        const data = await res.json();
        setModHistory(data.modifications || []);
      }
    } catch {
      setModHistory([]);
    } finally {
      setModHistoryLoading(false);
    }
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params: any = { action: "listOrders", limit: 100 };
      if (dateFrom) params.dateFrom = dateFrom;
      if (dateTo) params.dateTo = dateTo;
      if (statusFilter) params.status = statusFilter;
      if (guestTypeFilter) params.guestType = guestTypeFilter;
      if (phoneFilter) params.phone = phoneFilter;
      if (!statusFilter && !dateFrom) params.status = "all_history";

      const res = await apiCall(params);
      if (res.ok) {
        const data = await res.json();
        setOrders(data.orders || []);
      }
    } finally {
      setLoading(false);
    }
  }, [apiCall, dateFrom, dateTo, statusFilter, guestTypeFilter, phoneFilter]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    (async () => {
      const res = await apiCall({ action: "getMenu" });
      if (res.ok) {
        const data = await res.json();
        setCategories(data.categories || []);
        setMenuItems((data.items || []).map((i: any) => ({ id: i.id, categoryId: i.categoryId, name: i.name, nameKannada: i.nameKannada || "", description: i.description || "", price: i.price, priceText: i.priceText || "", tags: i.tags || "[]", isAvailable: i.isAvailable })));
      }
    })();
  }, [apiCall]);

  const handleCleanup = async () => {
    setCleanupBusy(true);
    setCleanupResult("");
    try {
      const res = await apiCall({ action: "cleanupOldOrders" });
      const data = await res.json();
      if (res.ok && data.success) {
        setCleanupResult(`Cleaned ${data.ordersCleanedCount} orders, deleted ${data.itemsDeletedCount} item records.`);
        await load();
      } else {
        setCleanupResult(data.error || "Cleanup failed");
      }
    } catch {
      setCleanupResult("Network error during cleanup");
    } finally {
      setCleanupBusy(false);
      setShowCleanupConfirm(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-display text-lg font-bold text-brand-green-dark">Order History</h3>
        <button
          type="button"
          onClick={() => setShowCleanupConfirm(true)}
          className="flex items-center gap-1.5 rounded-lg border border-red-200 dark:border-red-800 px-3 py-1.5 text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950"
        >
          <XIcon className="h-3.5 w-3.5" />
          Cleanup Old Orders
        </button>
      </div>

      {showCleanupConfirm && (
        <div className="rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950 p-4">
          <p className="text-sm text-red-800 dark:text-red-300">
            This will delete item details for orders older than 1 week (checked-out hostel guests and completed walk-in orders). Order summaries will be kept. Continue?
          </p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={handleCleanup}
              disabled={cleanupBusy}
              className="rounded-lg bg-red-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
            >
              {cleanupBusy ? "Cleaning..." : "Yes, Cleanup"}
            </button>
            <button
              type="button"
              onClick={() => setShowCleanupConfirm(false)}
              className="rounded-lg border border-brand-mist px-4 py-1.5 text-xs font-medium text-brand-green-dark/70 hover:bg-brand-sand"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {cleanupResult && (
        <div className="rounded-xl border border-brand-mist bg-white dark:bg-card p-3 text-sm text-brand-green-dark">
          {cleanupResult}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-3 rounded-xl border border-brand-mist bg-white dark:bg-card p-3">
        <div>
          <label className="mb-0.5 block text-xs text-brand-green-dark/60">From</label>
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="rounded border border-brand-mist px-2 py-1 text-sm" />
        </div>
        <div>
          <label className="mb-0.5 block text-xs text-brand-green-dark/60">To</label>
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="rounded border border-brand-mist px-2 py-1 text-sm" />
        </div>
        <div>
          <label className="mb-0.5 block text-xs text-brand-green-dark/60">Status</label>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="rounded border border-brand-mist px-2 py-1 text-sm">
            <option value="">All</option>
            <option value="placed">Placed</option>
            <option value="preparing">Preparing</option>
            <option value="ready">Ready</option>
            <option value="served">Served</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>
        <div>
          <label className="mb-0.5 block text-xs text-brand-green-dark/60">Guest Type</label>
          <select value={guestTypeFilter} onChange={(e) => setGuestTypeFilter(e.target.value)} className="rounded border border-brand-mist px-2 py-1 text-sm">
            <option value="">All</option>
            <option value="hostel">Hostel</option>
            <option value="walkin">Walk-in</option>
          </select>
        </div>
        <div>
          <label className="mb-0.5 block text-xs text-brand-green-dark/60">Phone</label>
          <input type="tel" value={phoneFilter} onChange={(e) => setPhoneFilter(e.target.value)} placeholder="Search by phone" className="rounded border border-brand-mist px-2 py-1 text-sm w-full sm:w-36" />
        </div>
      </div>

      {loading ? <LoadingState /> : (
        <div className="space-y-2">
          {orders.length === 0 && (
            <div className="rounded-xl border border-brand-mist bg-white dark:bg-card p-8 text-center text-sm text-brand-green-dark/50">
              No orders found
            </div>
          )}
          {orders.map((order) => (
            <div key={order.id} className="rounded-xl border border-brand-mist bg-white dark:bg-card overflow-hidden">
              <button
                type="button"
                onClick={() => setExpandedOrder(expandedOrder === order.id ? null : order.id)}
                className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-brand-sand/50"
              >
                <div className="min-w-0 flex flex-wrap items-center gap-1.5">
                  <span className="font-mono text-xs font-bold text-brand-green">{order.orderNumber}</span>
                  <StatusBadge status={order.status} />
                  {order.hasModifications && (
                    <span className="rounded-full bg-amber-100 dark:bg-amber-900/50 px-2 py-0.5 text-xs font-semibold text-amber-700 dark:text-amber-400">Modified</span>
                  )}
                  <span className="min-w-0 truncate text-sm text-brand-green-dark">{order.guestName}</span>
                  {order.guestType === "walkin" && <span className="rounded-full bg-gray-200 dark:bg-[#2a2a2a] px-2 py-0.5 text-xs text-gray-600 dark:text-gray-400">Walk-in</span>}
                  {order.guestType === "hostel" && <span className="rounded-full bg-green-100 dark:bg-green-900/50 px-2 py-0.5 text-xs text-green-700 dark:text-green-400">Goko Guest</span>}
                  <PaymentBadge status={order.paymentStatus} />
                  {order.paymentStatus === "paid" && order.paymentMethod && (
                    <span className="text-xs text-brand-green-dark/40">({order.paymentMethod === "cash" ? "Cash" : order.paymentMethod === "online" ? "Online" : order.paymentMethod === "split" ? "Split" : order.paymentMethod})</span>
                  )}
                </div>
                <div className="flex min-w-0 items-center gap-2">
                  <span className="hidden text-xs text-brand-green-dark/50 sm:inline">{new Date(order.createdAt).toLocaleDateString("en-IN")}</span>
                  <span className="text-xs text-brand-green-dark/50">{new Date(order.createdAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" })}</span>
                  <span className="text-sm font-semibold text-brand-green-dark">₹{(order.total / 100).toFixed(0)}</span>
                  {expandedOrder === order.id ? <ChevronDownIcon className="h-4 w-4 flex-shrink-0" /> : <ChevronRightIcon className="h-4 w-4 flex-shrink-0" />}
                </div>
              </button>
              {expandedOrder === order.id && (
                <div className="border-t border-brand-mist px-4 py-3 space-y-1">
                  {order.items.map((item) => (
                    <div key={item.id} className="flex items-center justify-between text-xs">
                      <span className={cn("text-brand-green-dark/70", item.status === "voided" && "line-through opacity-50")}>
                        {item.quantity}× {item.itemName}
                      </span>
                      <span className={cn(item.status === "voided" && "line-through opacity-50")}>₹{(item.lineTotal / 100).toFixed(0)}</span>
                    </div>
                  ))}
                  <div className="flex flex-wrap justify-between gap-x-3 border-t border-brand-mist pt-1 text-xs">
                    <span>Payment:{" "}
                      {order.paymentStatus === "paid" && order.paymentMethod
                        ? <PaymentDetailLabel method={order.paymentMethod} total={order.total} cashReceived={order.cashReceived} changeGiven={order.changeGiven} />
                        : <PaymentBadge status={order.paymentStatus} />
                      }
                    </span>
                    <span>
                      {order.paymentStatus === "paid" && order.paidBy
                        ? <>Paid by: {order.paidBy}</>
                        : <>By: {order.createdBy}</>
                      }
                    </span>
                  </div>
                  {order.cancelledReason && (
                    <p className="text-xs text-red-500">Cancelled: {order.cancelledReason}</p>
                  )}

                  {/* Modification History */}
                  {order.hasModifications && (
                    <div className="border-t border-brand-mist pt-2">
                      <button
                        type="button"
                        onClick={() => fetchModHistory(order.id)}
                        className="flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-400 hover:text-amber-800 dark:hover:text-amber-300"
                      >
                        <HistoryIcon className="h-3.5 w-3.5" />
                        {modHistoryOrder === order.id ? "Hide" : "Show"} Modification History
                      </button>
                      {modHistoryOrder === order.id && (
                        <div className="mt-2 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/50 p-2.5">
                          {modHistoryLoading ? (
                            <p className="text-xs text-gray-500 dark:text-gray-400">Loading...</p>
                          ) : modHistory.length === 0 ? (
                            <p className="text-xs text-gray-500 dark:text-gray-400">No modifications found</p>
                          ) : (
                            <div className="space-y-1.5">
                              {modHistory.map((mod, idx) => (
                                <div key={idx} className="flex flex-col gap-0.5 border-b border-amber-100 dark:border-amber-800 pb-1.5 last:border-0 last:pb-0">
                                  <span className="text-xs text-gray-800 dark:text-gray-200">
                                    {formatAdminModification(mod)}
                                  </span>
                                  <span className="text-xs text-gray-400 dark:text-gray-500">
                                    {new Date(mod.createdAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" })}
                                    {" · "}{mod.modifiedBy}
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  <div className="flex flex-wrap items-center gap-2 border-t border-brand-mist pt-2">
                    {btSupported && (
                      <button
                        type="button"
                        onClick={async () => {
                          setPrinting(order.id);
                          try {
                            const spExemptCats = new Set(categories.filter((c) => c.discountExempt).map((c) => c.id));
                            const spMiCatMap = new Map(menuItems.map((mi) => [mi.id, mi.categoryId]));
                            let spExempt = 0;
                            for (const it of order.items) {
                              if (it.status === "voided") continue;
                              const cid = spMiCatMap.get(it.menuItemId);
                              if (cid !== undefined && spExemptCats.has(cid)) spExempt += it.lineTotal;
                            }
                            const spGross = order.subtotal + (order.discount || 0);
                            await printFoodBill({
                              billNumber: order.orderNumber,
                              guestName: order.guestName,
                              guestPhone: order.guestPhone || undefined,
                              roomInfo: order.roomInfo || undefined,
                              guestType: order.guestType,
                              items: order.items.filter(i => i.status !== "voided").map(i => ({
                                name: i.itemName,
                                quantity: i.quantity,
                                price: i.itemPrice,
                                lineTotal: i.lineTotal,
                                status: i.status,
                              })),
                              subtotal: order.subtotal,
                              tax: order.tax,
                              total: order.total,
                              taxRate: foodTaxRateFromAmounts(order.subtotal, order.tax),
                              discount: order.discount || undefined,
                              discountableSubtotal: spGross - spExempt,
                              exemptSubtotal: spExempt,
                            });
                            showSuccess("Bill printed successfully!");
                          } catch (err: any) {
                            showError("Print failed", err.message || "Unknown error");
                          } finally {
                            setPrinting(null);
                          }
                        }}
                        disabled={printing === order.id}
                        className="flex items-center gap-1 rounded-lg border border-gray-200 dark:border-white/10 px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-[#0f0f0f] disabled:opacity-50"
                      >
                        <PrinterIcon className="h-3.5 w-3.5" />
                        {printing === order.id ? "Printing..." : "Print"}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={async () => {
                        const exemptCatIds3 = new Set(categories.filter((c) => c.discountExempt).map((c) => c.id));
                        const miCatMap3 = new Map(menuItems.map((mi) => [mi.id, mi.categoryId]));
                        let singleExempt = 0;
                        for (const it of order.items) {
                          if (it.status === "voided") continue;
                          const cid = miCatMap3.get(it.menuItemId);
                          if (cid !== undefined && exemptCatIds3.has(cid)) singleExempt += it.lineTotal;
                        }
                        const singleGross = order.subtotal + (order.discount || 0);
                        const billOrders: BillOrder[] = [{
                          orderNumber: order.orderNumber,
                          createdAt: order.createdAt,
                          items: order.items.filter(i => i.status !== "voided").map(i => ({
                            itemName: i.itemName,
                            quantity: i.quantity,
                            itemPrice: i.itemPrice,
                            lineTotal: i.lineTotal,
                            status: i.status,
                          })),
                          subtotal: order.subtotal,
                          tax: order.tax,
                          total: order.total,
                          specialInstructions: order.specialInstructions || undefined,
                        }];
                        await generateGuestBill({
                          guestName: order.guestName,
                          guestPhone: order.guestPhone || "",
                          roomInfo: order.roomInfo || undefined,
                          orders: billOrders,
                          grandSubtotal: order.subtotal,
                          grandTax: order.tax,
                          grandTotal: order.total,
                          taxRate: foodTaxRateFromAmounts(order.subtotal, order.tax),
                          billDate: new Date(order.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }),
                          discountableSubtotal: singleGross - singleExempt,
                          exemptSubtotal: singleExempt,
                        });
                      }}
                      className="flex items-center gap-1 rounded-lg border border-blue-200 dark:border-blue-800 px-3 py-1.5 text-xs font-medium text-blue-700 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950"
                    >
                      <DownloadIcon className="h-3.5 w-3.5" />
                      PDF
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function formatAdminModification(mod: OrderModification): string {
  const actor = mod.modifiedBy.charAt(0).toUpperCase() + mod.modifiedBy.slice(1);
  switch (mod.action) {
    case "quantity_changed":
      return `${actor} changed ${mod.itemName} qty from ${mod.oldValue} to ${mod.newValue}`;
    case "item_removed":
      return `${actor} removed ${mod.itemName}`;
    case "item_voided":
      return `${actor} cancelled ${mod.itemName}`;
    case "void_item":
      return `${actor} cancelled ${mod.itemName}`;
    case "item_added":
      return `${actor} added ${mod.itemName} x${mod.newValue}`;
    case "discount":
      return `${actor} applied discount: ${mod.oldValue} → ${mod.newValue}`;
    case "order_approved":
      return `${actor} approved this order`;
    case "order_rejected":
      return `${actor} rejected this order`;
    default:
      return `${actor}: ${mod.action} on ${mod.itemName || "order"}`;
  }
}

// ─── Discount Modal ──────────────────────────────────────────────────────────

const DISCOUNT_REASONS = ["Complimentary", "Staff Meal", "Loyalty Guest", "Service Issue", "Manager Discount", "Other"];
const QUICK_PERCENTS = [5, 10, 15, 20, 25, 50, 100];

function DiscountModal({
  totalAmount,
  discountableAmount,
  exemptAmount,
  currentDiscount,
  guestName,
  onApply,
  onRemove,
  onClose,
}: {
  totalAmount: number;
  discountableAmount: number;
  exemptAmount: number;
  currentDiscount: number;
  guestName: string;
  onApply: (data: { discountPercent?: number; discountAmount?: number; reason: string }) => void;
  onRemove?: () => void;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<"percent" | "fixed">("percent");
  const [percentInput, setPercentInput] = useState("");
  const [fixedInput, setFixedInput] = useState("");
  const [reason, setReason] = useState(DISCOUNT_REASONS[0]);
  const [customReason, setCustomReason] = useState("");
  const [saving, setSaving] = useState(false);

  const totalRupees = totalAmount / 100;
  const hasExemptItems = exemptAmount > 0;

  const discountPaise = mode === "percent"
    ? Math.round(discountableAmount * (Math.min(100, Math.max(0, Number(percentInput) || 0)) / 100))
    : Math.round(Math.min(discountableAmount, Math.max(0, (Number(fixedInput) || 0) * 100)));

  const newTotal = Math.max(0, totalAmount - discountPaise);
  const finalReason = reason === "Other" ? customReason : reason;

  const canApply = discountPaise > 0 && finalReason.trim().length > 0 && !saving;

  const handleApply = () => {
    setSaving(true);
    if (mode === "percent") {
      onApply({ discountPercent: Number(percentInput) || 0, reason: finalReason });
    } else {
      onApply({ discountAmount: Math.round((Number(fixedInput) || 0) * 100), reason: finalReason });
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-sm rounded-2xl bg-white dark:bg-card shadow-2xl dark:shadow-none animate-in zoom-in-95 duration-200 max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-brand-mist px-5 py-4">
          <div>
            <h3 className="text-base font-bold text-brand-green-dark">Apply Discount</h3>
            <p className="text-xs text-brand-green-dark/50">{guestName}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 hover:bg-brand-sand">
            <XIcon className="h-5 w-5 text-brand-green-dark/60" />
          </button>
        </div>

        <div className="overflow-y-auto flex-1">
          {/* Original Total */}
          <div className="bg-brand-sand/40 px-5 py-3 text-center">
            <p className="text-xs text-brand-green-dark/60">Original Total</p>
            <p className="text-2xl font-bold text-brand-green">₹{totalRupees.toFixed(0)}</p>
            {hasExemptItems && (
              <div className="mt-1.5 flex justify-center gap-3 text-[11px]">
                <span className="text-brand-green-dark/60">Discountable: <span className="font-semibold text-brand-green-dark">₹{(discountableAmount / 100).toFixed(0)}</span></span>
                <span className="text-purple-600 dark:text-purple-400">Non-discountable: <span className="font-semibold">₹{(exemptAmount / 100).toFixed(0)}</span></span>
              </div>
            )}
          </div>

          {/* Mode Tabs */}
          <div className="flex gap-1 border-b border-brand-mist px-5 pt-3 pb-0">
            {([{ id: "percent" as const, label: "Percentage" }, { id: "fixed" as const, label: "Fixed Amount" }]).map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setMode(t.id)}
                className={cn(
                  "flex items-center gap-1.5 rounded-t-lg px-4 py-2 text-sm font-medium transition-colors",
                  mode === t.id
                    ? "border-b-2 border-purple-600 bg-purple-50 dark:bg-purple-950 text-purple-700 dark:text-purple-400"
                    : "text-brand-green-dark/50 hover:text-brand-green-dark/70"
                )}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Tab Content */}
          <div className="px-5 py-4 space-y-3">
            {mode === "percent" && (
              <>
                <div>
                  <label className="mb-1 block text-xs font-medium text-brand-green-dark/70">Discount %</label>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={100}
                    className="w-full rounded-lg border border-brand-mist px-3 py-2.5 text-lg font-semibold text-brand-green-dark focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500"
                    value={percentInput}
                    onChange={(e) => setPercentInput(e.target.value)}
                    placeholder="0"
                    autoFocus
                  />
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {QUICK_PERCENTS.map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setPercentInput(String(p))}
                      className={cn(
                        "rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
                        Number(percentInput) === p
                          ? "border-purple-500 bg-purple-100 dark:bg-purple-900/50 text-purple-700 dark:text-purple-400"
                          : "border-brand-mist text-brand-green-dark/60 hover:bg-brand-sand"
                      )}
                    >
                      {p}%
                    </button>
                  ))}
                </div>
              </>
            )}

            {mode === "fixed" && (
              <div>
                <label className="mb-1 block text-xs font-medium text-brand-green-dark/70">Discount Amount (₹)</label>
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  className="w-full rounded-lg border border-brand-mist px-3 py-2.5 text-lg font-semibold text-brand-green-dark focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500"
                  value={fixedInput}
                  onChange={(e) => setFixedInput(e.target.value)}
                  placeholder="0"
                  autoFocus
                />
              </div>
            )}

            {/* Reason */}
            <div>
              <label className="mb-1 block text-xs font-medium text-brand-green-dark/70">Reason</label>
              <select
                className="w-full rounded-lg border border-brand-mist px-3 py-2 text-sm text-brand-green-dark focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              >
                {DISCOUNT_REASONS.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </div>
            {reason === "Other" && (
              <input
                type="text"
                className="w-full rounded-lg border border-brand-mist px-3 py-2 text-sm text-brand-green-dark focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500"
                value={customReason}
                onChange={(e) => setCustomReason(e.target.value)}
                placeholder="Enter reason..."
                autoFocus
              />
            )}

            {/* Preview */}
            {discountPaise > 0 && (
              <div className="rounded-lg border border-purple-200 dark:border-purple-800 bg-purple-50 dark:bg-purple-950 px-4 py-3 space-y-1">
                {hasExemptItems ? (
                  <>
                    <div className="flex justify-between text-sm text-brand-green-dark/70">
                      <span>Discountable Items</span>
                      <span>₹{(discountableAmount / 100).toFixed(0)}</span>
                    </div>
                    <div className="flex justify-between text-sm text-brand-green-dark/50">
                      <span>Non-discountable Items</span>
                      <span>₹{(exemptAmount / 100).toFixed(0)}</span>
                    </div>
                  </>
                ) : (
                  <div className="flex justify-between text-sm text-brand-green-dark/70">
                    <span>Original Total</span>
                    <span>₹{totalRupees.toFixed(0)}</span>
                  </div>
                )}
                <div className="flex justify-between text-sm font-semibold text-purple-700 dark:text-purple-400">
                  <span>Discount</span>
                  <span>-₹{(discountPaise / 100).toFixed(0)}</span>
                </div>
                <div className="border-t border-purple-200 dark:border-purple-800 pt-1 flex justify-between text-base font-bold text-brand-green-dark">
                  <span>New Total</span>
                  <span>₹{(newTotal / 100).toFixed(0)}</span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex gap-2 border-t border-brand-mist px-5 py-4">
          {onRemove && currentDiscount > 0 && (
            <button
              type="button"
              onClick={() => { setSaving(true); onRemove(); }}
              disabled={saving}
              className="rounded-lg border border-red-300 dark:border-red-800 px-3 py-2.5 text-sm font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950 disabled:opacity-40"
            >
              Remove
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-lg border border-brand-mist px-4 py-2.5 text-sm font-medium text-brand-green-dark/70 hover:bg-brand-sand"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleApply}
            disabled={!canApply}
            className="flex-1 rounded-lg bg-purple-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-purple-700 disabled:opacity-40"
          >
            {saving ? "Applying..." : "Apply Discount"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatTimeSince(isoDate: string): string {
  const diffMs = Date.now() - new Date(isoDate).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "<1m";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  const remainMins = mins % 60;
  if (remainMins === 0) return `${hrs}h`;
  return `${hrs}h ${remainMins}m`;
}

// ─── Shared Components ───────────────────────────────────────────────────────

export function LoadingState() {
  return (
    <div className="flex items-center justify-center py-12">
      <Loader2Icon className="h-6 w-6 animate-spin text-brand-green" />
    </div>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    pending_approval: "bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-400",
    placed: "bg-yellow-100 dark:bg-yellow-900/50 text-yellow-700 dark:text-yellow-400",
    preparing: "bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-400",
    ready: "bg-green-100 dark:bg-green-900/50 text-green-700 dark:text-green-400",
    served: "bg-gray-100 dark:bg-muted text-gray-600 dark:text-gray-400",
    cancelled: "bg-red-100 dark:bg-red-900/50 text-red-600 dark:text-red-400",
  };
  const labels: Record<string, string> = { pending_approval: "awaiting approval" };
  return (
    <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", colors[status] || "bg-gray-100 dark:bg-muted text-gray-600 dark:text-gray-400")}>
      {labels[status] || status}
    </span>
  );
}

export function PaymentBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    pending: "text-yellow-600",
    on_tab: "text-blue-600",
    paid: "text-green-600",
  };
  return <span className={cn("font-medium", colors[status] || "text-gray-600 dark:text-gray-400")}>{status.replace("_", " ")}</span>;
}
