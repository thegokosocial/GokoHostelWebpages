"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import dynamic from "next/dynamic";
import { motion } from "framer-motion";
import { cn, localDateStr } from "@/lib/utils";
import { Loader2Icon, RefreshCwIcon, XIcon, PlusIcon, MinusIcon, SearchIcon, ChevronDownIcon, ChevronRightIcon, BanknoteIcon, SmartphoneIcon, PrinterIcon, DownloadIcon, HistoryIcon, PencilIcon, UtensilsIcon, TagIcon, AlertTriangleIcon, ReceiptIcon, MessageCircleIcon } from "lucide-react";
import { isBluetoothSupported, printFoodBill, printCombinedBill, printOrderTicket, type BillItem } from "@/lib/thermalPrint";
import { generateGuestBill, generateCombinedBill, type CombinedBillData, type BillOrder } from "@/components/admin/FoodBillGenerator";
import { loadBillBranding } from "@/lib/loadBillBranding";
import { GuestFoodBillCard, groupHasPendingSpecialPrice } from "@/components/food/GuestFoodBillCard";
import { DEFAULT_BILL_BRANDING, type BillBranding } from "@/lib/foodBillFormat";
import { buildBillWhatsAppHref } from "@/lib/billShare";
import type { Role } from "./types";
import { hasPermission } from "./types";
import { useTabWithHistory } from "@/hooks/useTabWithHistory";
import { useAdminToast } from "@/components/admin/AdminToast";
import { usePanelHistory } from "@/hooks/usePanelHistory";
import { RecordPaymentModal, PaymentDetailLabel } from "@/components/admin/RecordPaymentModal";
import { foodTaxPercent, foodTaxRateFromAmounts } from "@/lib/foodLookup";
import { DateRangePicker } from "@/components/dates/DateRangePicker";
import { normalizePhone } from "@/lib/phoneUtils";

async function withBillBranding(
  password: string,
  username: string | undefined,
  showError: (title: string, detail?: string) => void,
  opts?: { embedQr?: boolean },
) {
  const loaded = await loadBillBranding(password, username, opts);
  if (!loaded.ok) {
    showError("Bill branding", loaded.error || "Using defaults");
  }
  return loaded;
}

type FoodTab = "summary" | "place" | "combined" | "active";

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
  pricingStatus?: string;
  notes?: string;
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
  const clearPrefillGuest = useCallback(() => setPrefillGuest(null), []);

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
    summary: "canViewFoodTabs",
    place: "canPlaceOrders",
    combined: "canGenerateFoodBills",
    active: "canViewFoodOrders",
  };

  const TABS = ([
    { id: "summary" as FoodTab, label: "Order Summary" },
    { id: "place" as FoodTab, label: "Place Order" },
    { id: "combined" as FoodTab, label: "Combined Bill" },
    { id: "active" as FoodTab, label: "Active Orders" },
  ] as { id: FoodTab; label: string }[]).filter((t) => t.id === "summary"
    ? hasPermission(role, permissions, "canViewFoodTabs")
      || hasPermission(role, permissions, "canViewFoodOrders")
      || hasPermission(role, permissions, "canMarkPaid")
    : hasPermission(role, permissions, TAB_PERMISSIONS[t.id]));

  const [tab, setTab] = useTabWithHistory<FoodTab>("tab", TABS[0]?.id || "summary", { validValues: TABS.map((t) => t.id) });

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
          <KitchenDashboard password={password} authScope="admin" onLogout={() => {}} />
        </div>
      )}
      {tab === "place" && <PlaceOrder apiCall={apiCall} prefillGuest={prefillGuest} onPrefillConsumed={clearPrefillGuest} onOrderPlaced={() => setTab("summary")} />}
      {tab === "summary" && <OrderSummary apiCall={apiCall} password={password} username={username} onOrderMore={(guest) => { setPrefillGuest(guest); setTab("place"); }} onAddNewOrder={() => setTab("place")} role={role} permissions={permissions} />}
      {tab === "combined" && <CombinedBill apiCall={apiCall} password={password} username={username} role={role} permissions={permissions} />}
    </div>
  );
}

// ─── Place Order ─────────────────────────────────────────────────────────────

function PlaceOrder({ apiCall, prefillGuest, onPrefillConsumed, onOrderPlaced }: { apiCall: (body: any) => Promise<Response>; prefillGuest: PrefillGuest | null; onPrefillConsumed: () => void; onOrderPlaced?: () => void }) {
  // Keep the navigation prefill after the parent clears it, so Order More can use a compact guest row.
  const [initialPrefillGuest] = useState(prefillGuest);
  const prefilledTable = initialPrefillGuest?.guestType === "table"
    ? Number(initialPrefillGuest.roomInfo?.match(/Table (\d+)/i)?.[1]) || null
    : null;
  const [guestSelectionExpanded, setGuestSelectionExpanded] = useState(!initialPrefillGuest);
  const [guestType, setGuestType] = useState<"hostel" | "walkin" | "table">(initialPrefillGuest?.guestType || "hostel");
  const [cafeTableCount, setCafeTableCount] = useState(0);
  const [selectedTable, setSelectedTable] = useState<number | null>(prefilledTable);
  const [tableGuestName, setTableGuestName] = useState(initialPrefillGuest?.guestType === "table" ? initialPrefillGuest.guestName : "");
  const [tableSessionId, setTableSessionId] = useState(initialPrefillGuest?.guestType === "table" ? (initialPrefillGuest.guestPhone || "") : "");
  const [guests, setGuests] = useState<Guest[]>([]);
  const [selectedGuest, setSelectedGuest] = useState<Guest | null>(() => initialPrefillGuest?.guestType === "hostel" && initialPrefillGuest.checkinId ? {
    id: initialPrefillGuest.checkinId,
    name: initialPrefillGuest.guestName,
    contact: initialPrefillGuest.guestPhone || "",
    arrivalDate: "",
    stayingDays: "",
    bedInfo: initialPrefillGuest.roomInfo || "",
  } : null);
  const [guestSearch, setGuestSearch] = useState("");
  const [walkinName, setWalkinName] = useState(initialPrefillGuest?.guestType === "walkin" ? initialPrefillGuest.guestName : "");
  const [walkinPhone, setWalkinPhone] = useState(initialPrefillGuest?.guestType === "walkin" ? (initialPrefillGuest.guestPhone || "") : "");
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
    if (initialPrefillGuest) onPrefillConsumed();
  }, [initialPrefillGuest, onPrefillConsumed]);

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
          if (initialPrefillGuest?.guestType === "hostel" && initialPrefillGuest.checkinId) {
            const match = (data.guests as Guest[]).find((g) => g.id === initialPrefillGuest.checkinId);
            if (match) {
              setSelectedGuest(match);
            }
          }
        }
      })();
    }
  }, [guestType, apiCall, initialPrefillGuest]);

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
  const prefilledGuestType = initialPrefillGuest?.guestType === "hostel" ? "Hostel guest" : initialPrefillGuest?.guestType === "table" ? "Cafe table" : "Walk-in";
  const prefilledGuestDetail = initialPrefillGuest?.guestType === "hostel"
    ? initialPrefillGuest.roomInfo || initialPrefillGuest.guestPhone
    : initialPrefillGuest?.guestType === "table"
      ? initialPrefillGuest.roomInfo || initialPrefillGuest.guestName
      : initialPrefillGuest?.guestPhone;

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

      {initialPrefillGuest && !guestSelectionExpanded ? (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-brand-green/20 bg-brand-green/[0.05] px-3 py-2.5">
          <div className="min-w-0">
            <p className="text-[11px] font-medium uppercase tracking-wide text-brand-green-dark/60">Ordering for</p>
            <p className="truncate text-sm font-semibold text-brand-green-dark">{initialPrefillGuest.guestName}</p>
            <p className="truncate text-xs text-brand-green-dark/60">{prefilledGuestType}{prefilledGuestDetail ? ` · ${prefilledGuestDetail}` : ""}</p>
          </div>
          <button type="button" onClick={() => setGuestSelectionExpanded(true)} className="shrink-0 rounded-md px-2 py-1 text-xs font-medium text-brand-green hover:bg-brand-green/10">
            Change guest
          </button>
        </div>
      ) : <>
      {/* Guest Type Toggle */}
      <div className="flex flex-nowrap gap-1.5 sm:gap-2">
        <button
          type="button"
          onClick={() => { setGuestType("hostel"); setSelectedGuest(null); setSelectedTable(null); }}
          className={cn("whitespace-nowrap rounded-lg px-2 py-2 text-xs font-medium transition-colors sm:px-4 sm:text-sm", guestType === "hostel" ? "bg-brand-green text-white" : "border border-brand-mist text-brand-green-dark/70")}
        >
          🏨 Hostel Guest
        </button>
        <button
          type="button"
          onClick={() => { setGuestType("walkin"); setSelectedGuest(null); setSelectedTable(null); }}
          className={cn("whitespace-nowrap rounded-lg px-2 py-2 text-xs font-medium transition-colors sm:px-4 sm:text-sm", guestType === "walkin" ? "bg-brand-green text-white" : "border border-brand-mist text-brand-green-dark/70")}
        >
          🚶 Walk-in
        </button>
        {cafeTableCount > 0 && (
          <button
            type="button"
            onClick={() => { setGuestType("table"); setSelectedGuest(null); }}
            className={cn("whitespace-nowrap rounded-lg px-2 py-2 text-xs font-medium transition-colors sm:px-4 sm:text-sm", guestType === "table" ? "bg-brand-green text-white" : "border border-brand-mist text-brand-green-dark/70")}
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
      </>}

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
  paidAmount: number;
  pendingAmount: number;
}

function OrderSummary({ apiCall, password, username, onOrderMore, onAddNewOrder, role, permissions }: { apiCall: (body: any) => Promise<Response>; password: string; username?: string; onOrderMore: (guest: PrefillGuest) => void; onAddNewOrder?: () => void; role?: Role; permissions?: Record<string, boolean> }) {
  const { showError, showSuccess } = useAdminToast();
  const [hostelGuests, setHostelGuests] = useState<GuestWithTab[]>([]);
  const [walkinOrders, setWalkinOrders] = useState<Order[]>([]);
  const [recentPaidOrders, setRecentPaidOrders] = useState<Order[]>([]);
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
  const [paymentEditOrder, setPaymentEditOrder] = useState<Order | null>(null);
  const [discountModalGroup, setDiscountModalGroup] = useState<SummaryGroup | null>(null);
  const [priceModalItem, setPriceModalItem] = useState<{ orderId: number; itemId: number; itemName: string } | null>(null);
  const [editingOrderId, setEditingOrderId] = useState<number | null>(null);
  const [voidingItemId, setVoidingItemId] = useState<number | null>(null);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [voidedItemReasons, setVoidedItemReasons] = useState<Record<number, string>>({});
  const [pendingQtyChange, setPendingQtyChange] = useState<{ orderId: number; itemId: number; newQty: number } | null>(null);
  const [modHistoryOrderId, setModHistoryOrderId] = useState<number | null>(null);
  const [modHistoryData, setModHistoryData] = useState<OrderModification[]>([]);
  const [modHistoryLoading, setModHistoryLoading] = useState(false);
  const [drawerView, setDrawerView] = useState<"orders" | "bill">("orders");
  const [spBillWarning, setSpBillWarning] = useState(false);
  const [billBranding, setBillBranding] = useState<BillBranding>(DEFAULT_BILL_BRANDING);
  const [billBrandingReady, setBillBrandingReady] = useState(false);
  const [whatsAppBusy, setWhatsAppBusy] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  usePanelHistory(showHistory, () => setShowHistory(false));

  useEffect(() => { setBtSupported(isBluetoothSupported()); }, []);

  useEffect(() => {
    if (!selectedGroupKey) {
      setDrawerView("orders");
      setSpBillWarning(false);
    }
  }, [selectedGroupKey]);

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
      let historyDays = 7;
      if (menuRes.ok) {
        const data = await menuRes.json();
        historyDays = Math.min(90, Math.max(1, parseInt(data.paymentHistoryDays) || 7));
        setCategories(data.categories || []);
        setMenuItems((data.items || []).map((i: any) => ({ id: i.id, categoryId: i.categoryId, name: i.name, nameKannada: i.nameKannada || "", description: i.description || "", price: i.price, priceText: i.priceText || "", tags: i.tags || "[]", isAvailable: i.isAvailable })));
      }
      const paidFrom = new Date();
      paidFrom.setDate(paidFrom.getDate() - historyDays);
      const paidOrders: Order[] = [];
      let paidOffset = 0;
      while (true) {
        const paidRes = await apiCall({
          action: "listOrders", status: "all_history", paymentStatus: "paid",
          dateFrom: localDateStr(paidFrom), dateTo: localDateStr(new Date()), limit: 200, offset: paidOffset,
          includeItems: true, includeModifications: true,
        });
        if (!paidRes.ok) break;
        const data = await paidRes.json();
        const page = (data.orders || []) as Order[];
        paidOrders.push(...page.filter((o) => o.paymentStatus === "paid" && o.status !== "cancelled"));
        if (page.length < 200) break;
        paidOffset += page.length;
      }
      setRecentPaidOrders([...new Map(paidOrders.map((o) => [o.id, o])).values()]);
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

    const paidByHostel = new Map<number, Order[]>();
    const paidByWalkin = new Map<string, Order[]>();
    for (const order of recentPaidOrders) {
      if (order.guestType === "hostel" && order.checkinId) {
        const list = paidByHostel.get(order.checkinId) || [];
        list.push(order); paidByHostel.set(order.checkinId, list);
      } else {
        const isTable = order.roomInfo && /^Table \d+$/i.test(order.roomInfo);
        const key = isTable ? `table_${order.roomInfo}` : (order.guestPhone || `_no_phone_${order.id}`);
        const list = paidByWalkin.get(key) || [];
        list.push(order); paidByWalkin.set(key, list);
      }
    }

    for (const g of hostelGuests) {
      const cachedOrders = hostelOrdersMap[g.checkinId] || [];
      const paidOrders = paidByHostel.get(g.checkinId) || [];
      const allOrders = [...new Map([...cachedOrders, ...paidOrders].map((o) => [o.id, o])).values()];
      const paidAmount = paidOrders.reduce((s, o) => s + o.total, 0);
      const hasLoadedOrders = Object.prototype.hasOwnProperty.call(hostelOrdersMap, g.checkinId);
      const pendingAmount = hasLoadedOrders
        ? cachedOrders.filter((o) => o.paymentStatus !== "paid").reduce((s, o) => s + o.total, 0)
        : g.tabTotal;
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
        orders: allOrders,
        totalAmount: pendingAmount + paidAmount,
        totalSubtotal: allOrders.reduce((s, o) => s + o.subtotal, 0),
        totalTax: allOrders.reduce((s, o) => s + o.tax, 0),
        orderCount: Math.max(g.orderCount, allOrders.length),
        latestOrderTime: hostelLatest,
        earliestOrderTime: hostelEarliest,
        hasModifications: allOrders.length > 0
          ? allOrders.some((o) => o.hasModifications)
          : (g.hasModifications || false),
        paidAmount,
        pendingAmount,
      });
    }
    const knownHostelIds = new Set(hostelGuests.map((g) => g.checkinId));
    for (const [checkinId, paidOrders] of paidByHostel) {
      if (knownHostelIds.has(checkinId) || paidOrders.length === 0) continue;
      const first = paidOrders[0];
      result.push({
        key: `hostel_${checkinId}`, guestName: first.guestName, guestType: "hostel",
        contactInfo: first.guestPhone, roomInfo: first.roomInfo, orders: paidOrders,
        totalAmount: paidOrders.reduce((s, o) => s + o.total, 0),
        totalSubtotal: paidOrders.reduce((s, o) => s + o.subtotal, 0),
        totalTax: paidOrders.reduce((s, o) => s + o.tax, 0), orderCount: paidOrders.length,
        latestOrderTime: paidOrders.reduce((max, o) => o.createdAt > max ? o.createdAt : max, ""),
        earliestOrderTime: paidOrders.reduce((min, o) => !min || o.createdAt < min ? o.createdAt : min, ""),
        hasModifications: paidOrders.some((o) => o.hasModifications),
        paidAmount: paidOrders.reduce((s, o) => s + o.total, 0), pendingAmount: 0,
      });
    }

    const walkinMap = new Map<string, Order[]>();
    for (const order of walkinOrders) {
      const isTable = order.roomInfo && /^Table \d+$/i.test(order.roomInfo);
      const key = isTable ? `table_${order.roomInfo}` : (order.guestPhone || `_no_phone_${order.id}`);
      if (!walkinMap.has(key)) walkinMap.set(key, []);
      walkinMap.get(key)!.push(order);
    }
    for (const [key, paidOrders] of paidByWalkin) {
      if (!walkinMap.has(key)) walkinMap.set(key, []);
      const ids = new Set(walkinMap.get(key)!.map((o) => o.id));
      walkinMap.get(key)!.push(...paidOrders.filter((o) => !ids.has(o.id)));
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
        paidAmount: groupOrders.filter((o) => o.paymentStatus === "paid").reduce((s, o) => s + o.total, 0),
        pendingAmount: groupOrders.filter((o) => o.paymentStatus !== "paid").reduce((s, o) => s + o.total, 0),
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
  }, [hostelGuests, walkinOrders, recentPaidOrders, hostelOrdersMap]);

  const filteredGroups = useMemo(() => {
    if (filter === "all") return groups;
    return groups.filter((g) => g.guestType === filter);
  }, [groups, filter]);

  const getGroupOrders = useCallback((group: SummaryGroup): Order[] => {
    if (group.guestType === "walkin") return group.orders;
    const checkinId = parseInt(group.key.replace("hostel_", ""), 10);
    return hostelOrdersMap[checkinId] || group.orders;
  }, [hostelOrdersMap]);

  const selectedGroup = selectedGroupKey ? groups.find((g) => g.key === selectedGroupKey) || null : null;
  const selectedGroupOrders = useMemo(() => selectedGroup
    ? [...getGroupOrders(selectedGroup)].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    : [], [selectedGroup, getGroupOrders]);
  const canEditOrderItems = hasPermission(role || "staff", permissions || {}, "canEditFoodOrders")
    || hasPermission(role || "staff", permissions || {}, "canPlaceOrders")
    || hasPermission(role || "staff", permissions || {}, "canViewFoodOrders");
  // Mixed groups show only the unpaid orders in the bill. Fully paid groups still
  // open their complete paid bill so Print/Bill/Order More remain available.
  const billOrders = useMemo(() => {
    const unpaid = selectedGroupOrders.filter((o) => o.paymentStatus !== "paid");
    return unpaid.length > 0 ? unpaid : selectedGroupOrders;
  }, [selectedGroupOrders]);

  useEffect(() => {
    if (!groupHasPendingSpecialPrice(selectedGroupOrders)) setSpBillWarning(false);
  }, [selectedGroupOrders]);

  const selectGroup = async (group: SummaryGroup) => {
    setSelectedGroupKey(group.key);
    setModHistoryOrderId(null);
    setDrawerView("orders");
    setSpBillWarning(false);

    if (group.guestType === "hostel" && !hostelOrdersMap[parseInt(group.key.replace("hostel_", ""), 10)]) {
      const checkinId = parseInt(group.key.replace("hostel_", ""), 10);
      setLoadingOrders(group.key);
      try {
        const res = await apiCall({ action: "getGuestTab", checkinId });
        if (res.ok) {
          const data = await res.json();
          const paid = recentPaidOrders.filter((o) => o.checkinId === checkinId);
          const merged = [...new Map([...(data.orders || []), ...paid].map((o: Order) => [o.id, o])).values()];
          setHostelOrdersMap((prev) => ({ ...prev, [checkinId]: merged }));
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
        const paid = recentPaidOrders.filter((o) => o.checkinId === checkinId);
        const merged = [...new Map([...(data.orders || []), ...paid].map((o: Order) => [o.id, o])).values()];
        setHostelOrdersMap((prev) => ({ ...prev, [checkinId]: merged }));
      }
    }
    const paidRes = await apiCall({ action: "listOrders", status: "all_history", paymentStatus: "paid", limit: 200, includeItems: true, includeModifications: true });
    if (paidRes.ok) setRecentPaidOrders(((await paidRes.json()).orders || []).filter((o: Order) => o.status !== "cancelled"));
  }, [apiCall, recentPaidOrders]);

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

  const handleSetItemPrice = async (orderId: number, itemId: number, priceRupees: number, label: string) => {
    if (!Number.isFinite(priceRupees) || priceRupees <= 0) { showError("Enter a valid positive price"); return; }
    setActionBusy(`price_${itemId}`);
    try {
      const res = await apiCall({
        action: "setFoodOrderItemPrice",
        orderId,
        orderItemId: itemId,
        price: Math.round(priceRupees * 100),
        label: label.trim(),
      });
      if (res.ok) {
        setPriceModalItem(null);
        if (selectedGroup) await refreshAfterEdit(selectedGroup);
        showSuccess("Final price saved");
        setSpBillWarning(false);
      }
      else { const data = await res.json().catch(() => ({})); showError(data.error || "Could not save price"); }
    } finally { setActionBusy(null); }
  };

  const actualGroupTotal = selectedGroupOrders.length > 0
    ? selectedGroupOrders.reduce((sum, o) => sum + o.total, 0)
    : selectedGroup?.totalAmount || 0;
  const actualGroupPending = selectedGroupOrders.length > 0
    ? selectedGroupOrders.filter((o) => o.paymentStatus !== "paid").reduce((sum, o) => sum + o.total, 0)
    : selectedGroup?.pendingAmount || 0;
  const billTotal = billOrders.reduce((sum, o) => sum + o.total, 0);

  const groupHasSpPending = groupHasPendingSpecialPrice(selectedGroupOrders);

  const openBillView = async () => {
    if (!selectedGroup) return;
    if (groupHasSpPending) {
      setSpBillWarning(true);
      setDrawerView("orders");
      return;
    }
    if (!billBrandingReady) {
      const { branding } = await withBillBranding(password, username, showError, { embedQr: false });
      setBillBranding(branding);
      setBillBrandingReady(true);
    }
    setSpBillWarning(false);
    setDrawerView("bill");
  };

  const shareBillViaWhatsApp = async (guestPhone: string | null | undefined, guestName: string, checkinId?: number | null) => {
    const phone = normalizePhone(guestPhone || "");
    if (!phone) {
      showError("WhatsApp", "No phone number on this guest");
      return;
    }
    setWhatsAppBusy(true);
    try {
      const res = await apiCall({ action: "createBillShareLink", phone, checkinId: checkinId ?? undefined });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showError("WhatsApp", data.error || "Could not create bill link");
        return;
      }
      const href = buildBillWhatsAppHref({ guestPhone: phone, guestName, shareUrl: data.url });
      if (!href) {
        showError("WhatsApp", "Could not open WhatsApp for this number");
        return;
      }
      window.open(href, "_blank", "noopener,noreferrer");
    } finally {
      setWhatsAppBusy(false);
    }
  };

  const markGroupPaid = async (group: SummaryGroup, paymentMethod: string, cashReceived: number = 0, changeGiven: number = 0, onlineAccountId?: number, receiptId?: string) => {
    const orders = getGroupOrders(group);
    const unpaidOrders = orders.filter((o) => o.paymentStatus !== "paid");
    const orderIds = unpaidOrders.map((o) => o.id);
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

  const updatePayment = async (order: Order, updates: Record<string, unknown>) => {
    setBusy(`payment_${order.id}`);
    try {
      const res = await apiCall({ action: "updatePaymentDetails", orderId: order.id, ...updates });
      if (res.ok && selectedGroup) {
        setPaymentEditOrder(null);
        await refreshAfterEdit(selectedGroup);
      } else if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        showError("Payment", data.error || "Could not update payment");
      }
    } finally { setBusy(null); }
  };

  const revertPayment = async (order: Order) => updatePayment(order, {
    paymentStatus: order.guestType === "hostel" && order.checkinId ? "on_tab" : "pending",
    paymentMethod: "", cashReceived: 0, changeGiven: 0,
  });

  const handlePrintGroup = async (group: SummaryGroup) => {
    const groupOrders = getGroupOrders(group);
    const orders = groupOrders.some((o) => o.paymentStatus !== "paid")
      ? groupOrders.filter((o) => o.paymentStatus !== "paid")
      : groupOrders;
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
      const { branding } = await withBillBranding(password, username, showError);
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
        branding,
      });
      showSuccess("Bill printed successfully!");
    } catch (err: any) {
      showError("Print failed", err.message || "Unknown error");
    } finally {
      setPrintingGroup(null);
    }
  };

  if (loading) return <LoadingState />;

  return (
    <div className="space-y-3 pb-20">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-display text-lg font-bold text-brand-green-dark">Order Summary ({filteredGroups.length})</h3>
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => setShowHistory(true)} className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm text-brand-green hover:bg-brand-green/[0.06]"><HistoryIcon className="h-3.5 w-3.5" /> Payment History</button>
          <button type="button" onClick={load} className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm text-brand-green hover:bg-brand-green/[0.06]"><RefreshCwIcon className="h-3.5 w-3.5" /> Refresh</button>
        </div>
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
          No unpaid or recent paid orders
        </div>
      )}

      {(() => {
        const renderGroupCard = (group: SummaryGroup) => {
          const timeSince = group.earliestOrderTime ? formatTimeSince(group.earliestOrderTime) : "";
          return (
            <button
              key={group.key}
              type="button"
              onClick={() => selectGroup(group)}
              className={cn(
                "rounded-xl border border-brand-mist bg-white dark:bg-card p-3 text-left transition-shadow hover:shadow-md dark:hover:shadow-none",
                group.pendingAmount <= 0
                  ? "border-l-[3px] border-l-green-400"
                  : group.paidAmount > 0
                    ? "border-l-[3px] border-l-orange-400"
                    : "border-l-[3px] border-l-red-400"
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
              <div className="mt-0.5 flex gap-2 text-[11px] font-medium">
                {group.paidAmount > 0 && <span className="text-green-600">₹{(group.paidAmount / 100).toFixed(0)} paid</span>}
                {group.pendingAmount > 0 && <span className="text-orange-600">₹{(group.pendingAmount / 100).toFixed(0)} unpaid</span>}
              </div>
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
        };
        const unpaidGroups = filteredGroups.filter((group) => group.pendingAmount > 0);
        const paidGroups = filteredGroups.filter((group) => group.pendingAmount <= 0);
        return (
          <div className="space-y-4">
            {unpaidGroups.length > 0 && (
              <section>
                <h4 className="mb-2 text-xs font-bold uppercase tracking-wide text-orange-600">Unpaid ({unpaidGroups.length})</h4>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">{unpaidGroups.map(renderGroupCard)}</div>
              </section>
            )}
            {paidGroups.length > 0 && (
              <section>
                <h4 className="mb-2 text-xs font-bold uppercase tracking-wide text-green-600">Paid ({paidGroups.length})</h4>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">{paidGroups.map(renderGroupCard)}</div>
              </section>
            )}
          </div>
        );
      })()}

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
              <span className="text-sm text-brand-green-dark/70">
                {drawerView === "bill" ? "Bill" : `${selectedGroup.orderCount} order${selectedGroup.orderCount !== 1 ? "s" : ""}`}
              </span>
              <span className="text-xl font-bold text-brand-green">₹{((drawerView === "bill" ? billTotal : actualGroupTotal) / 100).toFixed(0)}</span>
            </div>

            {drawerView === "bill" ? (
              <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
                <div className="mb-3 rounded-lg border border-brand-mist bg-brand-sand/30 px-3 py-2 text-xs">
                  <div className="flex justify-between"><span>{actualGroupPending > 0 ? "Unpaid bill" : "Paid bill"}</span><b>₹{(billTotal / 100).toFixed(0)}</b></div>
                  {actualGroupPending > 0 && <p className="mt-1 text-[11px] text-orange-700">Paid orders are excluded from the bill items below.</p>}
                </div>
                <GuestFoodBillCard
                  orders={billOrders.map((o) => ({
                    guestName: selectedGroup.guestName,
                    roomInfo: selectedGroup.roomInfo || o.roomInfo,
                    paymentStatus: o.paymentStatus,
                    paymentMethod: o.paymentMethod,
                    createdAt: o.createdAt,
                    subtotal: o.subtotal,
                    tax: o.tax,
                    total: o.total,
                    discount: o.discount || 0,
                    items: o.items.map((i) => ({
                      itemName: i.itemName,
                      quantity: i.quantity,
                      itemPrice: i.itemPrice,
                      lineTotal: i.lineTotal,
                      status: i.status,
                      pricingStatus: i.pricingStatus,
                    })),
                  }))}
                  variant={actualGroupPending > 0 ? "unpaid" : "paid"}
                  paymentDue={actualGroupPending}
                  branding={{
                    hostelName: billBranding.hostelName,
                    location: billBranding.location,
                    accent: billBranding.accent,
                    upiId: billBranding.upiId,
                    qrUrl: billBranding.paymentQrUrl,
                    footer: billBranding.footer,
                    taxRate: foodTaxRateFromAmounts(
                      billOrders.reduce((s, o) => s + o.subtotal, 0),
                      billOrders.reduce((s, o) => s + o.tax, 0),
                    ),
                  }}
                  alwaysExpanded
                  footerActions={
                    <>
                      <button
                        type="button"
                        onClick={() => setDrawerView("orders")}
                        className="rounded-lg border border-brand-mist px-3 py-2 text-sm font-medium text-brand-green-dark/70 hover:bg-brand-sand"
                      >
                        Back
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const phone = selectedGroup.contactInfo
                            || selectedGroupOrders.find((o) => o.guestPhone)?.guestPhone
                            || "";
                          const checkinId = selectedGroup.guestType === "hostel"
                            ? parseInt(selectedGroup.key.replace("hostel_", ""), 10)
                            : undefined;
                          void shareBillViaWhatsApp(phone, selectedGroup.guestName, Number.isFinite(checkinId) ? checkinId : null);
                        }}
                        disabled={whatsAppBusy}
                        className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800 hover:bg-emerald-100 disabled:opacity-50 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
                      >
                        {whatsAppBusy ? <Loader2Icon className="h-3.5 w-3.5 animate-spin" /> : <MessageCircleIcon className="h-3.5 w-3.5" />}
                        WhatsApp
                      </button>
                      {hasPermission(role || "staff", permissions || {}, "canMarkPaid") && (
                        <button
                          type="button"
                          onClick={() => setDiscountModalGroup(selectedGroup)}
                          disabled={busy === selectedGroup.key}
                          className="flex items-center gap-1.5 rounded-lg border border-purple-500 bg-purple-50 dark:bg-purple-950 px-3 py-2 text-sm font-medium text-purple-700 dark:text-purple-400 hover:bg-purple-100 dark:hover:bg-purple-900/50 disabled:opacity-50"
                        >
                          <TagIcon className="h-3.5 w-3.5" />
                          {selectedGroupOrders.reduce((s, o) => s + (o.discount || 0), 0) > 0
                            ? `Discount · -₹${(selectedGroupOrders.reduce((s, o) => s + (o.discount || 0), 0) / 100).toFixed(0)}`
                            : "Discount"}
                        </button>
                      )}
                      {hasPermission(role || "staff", permissions || {}, "canMarkPaid") && (
                        <button
                          type="button"
                          onClick={() => {
                            if (groupHasSpPending) {
                              setSpBillWarning(true);
                              setDrawerView("orders");
                              return;
                            }
                            setPaymentModalMethod("online");
                            setPaymentModalGroup(selectedGroup);
                          }}
                          disabled={busy === selectedGroup.key || groupHasSpPending || actualGroupPending <= 0}
                          className="flex items-center gap-1.5 rounded-lg border border-green-500 bg-green-50 dark:bg-green-950 px-3 py-2 text-sm font-medium text-green-700 dark:text-green-400 hover:bg-green-100 dark:hover:bg-green-900/50 disabled:opacity-50"
                        >
                        <BanknoteIcon className="h-3.5 w-3.5" /> Pay · ₹{(actualGroupPending / 100).toFixed(0)}
                        </button>
                      )}
                    </>
                  }
                />
                <div className="mt-3 space-y-1.5 rounded-lg border border-brand-mist p-2">
                    {selectedGroupOrders.map((order) => (
                      <div key={order.id} className="rounded-md border border-brand-mist/70 px-2 py-1.5 text-xs">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono text-brand-green-dark/70">{order.orderNumber} · ₹{(order.total / 100).toFixed(0)}</span>
                          <div className="flex items-center gap-1">
                            {hasPermission(role || "staff", permissions || {}, "canMarkPaid") && order.paymentStatus === "paid" ? (
                              <button type="button" aria-label={`Edit payment for ${order.orderNumber}`} title="Edit payment" onClick={() => setPaymentEditOrder(order)} className="rounded p-1 text-brand-green-dark/50 hover:bg-brand-sand hover:text-brand-green-dark"><BanknoteIcon className="h-3.5 w-3.5" /></button>
                            ) : <span className="font-medium text-orange-600">Unpaid</span>}
                            {canEditOrderItems && (
                              <button
                                type="button"
                                aria-label={`Edit items for ${order.orderNumber}`}
                                title="Edit order items"
                                onClick={() => { setDrawerView("orders"); setEditingOrderId(order.id); setVoidingItemId(null); }}
                                className="rounded p-1 text-brand-green-dark/50 hover:bg-brand-sand hover:text-brand-green-dark"
                              >
                                <UtensilsIcon className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>
                        </div>
                        <div className="mt-1 space-y-0.5 text-brand-green-dark/60">
                          {order.items.filter((item) => item.status !== "voided").map((item) => (
                            <div key={item.id} className="flex items-center justify-between gap-2">
                              <span className="min-w-0 truncate">{item.quantity}× {item.itemName}</span>
                              <span className="shrink-0">₹{(item.lineTotal / 100).toFixed(0)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
              </div>
            ) : (
            <>
            {/* Orders list */}
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 space-y-2">
              {(spBillWarning || groupHasSpPending) && (
                <div className="rounded-xl border border-amber-300/80 bg-amber-50 dark:bg-amber-950/40 px-3 py-2.5">
                  <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-amber-800 dark:text-amber-300">
                    Special price
                    <AlertTriangleIcon className="h-3.5 w-3.5" />
                    <span className="font-normal normal-case">set price before opening bill</span>
                  </p>
                  {spBillWarning && (
                    <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
                      One or more items still need a final price. Use Set price on each special-price line, then open Bill again.
                    </p>
                  )}
                </div>
              )}
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
                          <OrderPaymentBadge paymentStatus={order.paymentStatus} />
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
                            title="Edit food items"
                          >
                            <UtensilsIcon className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                      <div className="mt-1.5 space-y-0.5">
                        {order.items.map((item) => {
                          const isVoided = item.status === "voided";
                          const isItemEditing = isEditing && !isVoided;
                          const spPending = !isVoided && item.pricingStatus === "pending";
                          return (
                          <div key={item.id} className={cn(spPending && "rounded-md border border-amber-300/70 bg-amber-50/80 dark:bg-amber-950/30 px-1.5 py-1")}>
                            {item.notes && <div className="mb-0.5 pl-1 text-[10px] italic text-brand-green-dark/50">Note: {item.notes}</div>}
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
                                  {item.notes?.trim() && (
                                    <span className="flex-shrink-0 rounded-full bg-violet-100 dark:bg-violet-900/50 px-1.5 py-0.5 text-[9px] font-semibold text-violet-700 dark:text-violet-300">{item.notes.trim()}</span>
                                  )}
                                </div>
                                <div className="flex items-center gap-1.5">
                                  {spPending ? (
                                    <button type="button" onClick={() => setPriceModalItem({ orderId: order.id, itemId: item.id, itemName: item.itemName })} disabled={actionBusy === `price_${item.id}`} className="rounded bg-amber-200/80 px-1.5 py-0.5 text-[10px] font-semibold text-amber-900 hover:bg-amber-300 disabled:opacity-50">{actionBusy === `price_${item.id}` ? "Saving…" : "Set price"}</button>
                                  ) : <span className="text-brand-green-dark/60">₹{(item.lineTotal / 100).toFixed(0)}</span>}
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
                              <div className="flex items-center justify-between text-xs">
                                <span className={cn("min-w-0", spPending ? "font-medium text-amber-800 dark:text-amber-300" : "text-brand-green-dark/60")}>
                                  <span className="inline-flex max-w-full flex-wrap items-center gap-1">
                                    <span className="truncate">{item.quantity}× {item.itemName}</span>
                                    {item.notes?.trim() && (
                                      <span className="flex-shrink-0 rounded-full bg-violet-100 dark:bg-violet-900/50 px-1.5 py-0.5 text-[9px] font-semibold text-violet-700 dark:text-violet-300">{item.notes.trim()}</span>
                                    )}
                                    {spPending && <AlertTriangleIcon className="h-3 w-3 flex-shrink-0 text-amber-600" />}
                                  </span>
                                </span>
                                {spPending ? (
                                  <button type="button" onClick={() => setPriceModalItem({ orderId: order.id, itemId: item.id, itemName: item.itemName })} disabled={actionBusy === `price_${item.id}`} className="ml-2 flex-shrink-0 rounded bg-amber-200/80 px-1.5 py-0.5 text-[10px] font-semibold text-amber-900 hover:bg-amber-300 disabled:opacity-50">{actionBusy === `price_${item.id}` ? "Saving…" : "Set price"}</button>
                                ) : <span className="ml-2 flex-shrink-0 text-brand-green-dark/60">₹{(item.lineTotal / 100).toFixed(0)}</span>}
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
                <button
                  type="button"
                  onClick={() => openBillView()}
                  className="flex items-center gap-1.5 rounded-lg border border-brand-green bg-brand-green/10 px-3 py-2 text-sm font-medium text-brand-green-dark hover:bg-brand-green/20"
                >
                  <ReceiptIcon className="h-3.5 w-3.5" /> Bill
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
            </>
            )}
          </div>
        </div>
      )}

      {showHistory && <PaymentHistoryPanel apiCall={apiCall} onClose={() => setShowHistory(false)} />}

      {/* Payment Modal */}
      {paymentModalGroup && (
        <RecordPaymentModal
          totalAmount={paymentModalGroup.pendingAmount}
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

      {paymentEditOrder && (
        <RecordPaymentModal
          totalAmount={paymentEditOrder.total}
          guestName={paymentEditOrder.guestName}
          initialMethod={paymentEditOrder.paymentMethod || "online"}
          initialCash={paymentEditOrder.cashReceived}
          mode="correction"
          password={password} username={username} receiptKind="food"
          secondaryActionLabel="Revert to Pending"
          onSecondaryAction={() => revertPayment(paymentEditOrder)}
          onConfirm={(method, cashReceived, changeGiven, onlineAccountId, receiptId, _amount, _op, note) => updatePayment(paymentEditOrder, { paymentMethod: method, cashReceived, changeGiven, onlineAccountId, receiptId, note })}
          onClose={() => setPaymentEditOrder(null)}
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

      {priceModalItem && (
        <SetPriceModal
          itemName={priceModalItem.itemName}
          busy={actionBusy === `price_${priceModalItem.itemId}`}
          onSave={(priceRupees, label) => void handleSetItemPrice(priceModalItem.orderId, priceModalItem.itemId, priceRupees, label)}
          onClose={() => setPriceModalItem(null)}
        />
      )}

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

function CombinedBill({ apiCall, password, username, role, permissions }: { apiCall: (body: any) => Promise<Response>; password: string; username?: string; role: Role; permissions: Record<string, boolean> }) {
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
  const [billBranding, setBillBranding] = useState<BillBranding>(DEFAULT_BILL_BRANDING);
  const [billBrandingReady, setBillBrandingReady] = useState(false);
  const [whatsAppBusyKey, setWhatsAppBusyKey] = useState<string | null>(null);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [discountOpen, setDiscountOpen] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);

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

  const ensureBillBranding = async () => {
    if (billBrandingReady) return billBranding;
    const { branding } = await withBillBranding(password, username, showError, { embedQr: false });
    setBillBranding(branding);
    setBillBrandingReady(true);
    return branding;
  };

  const loadPreview = async () => {
    if (selectedIds.length === 0) return;
    setLoadingPreview(true);
    try {
      const [res] = await Promise.all([
        apiCall({ action: "getCombinedBill", checkinIds: selectedIds }),
        ensureBillBranding(),
      ]);
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setPreview(data);
      } else {
        setPreview(null);
        showError("Combined Bill", data.error || "Could not load combined bill");
      }
    } finally {
      setLoadingPreview(false);
    }
  };

  const shareGuestBill = async (g: any) => {
    const phone = g.guestPhone
      || (g.orders || []).find((o: any) => o.guestPhone)?.guestPhone
      || guests.find((x) => x.checkinId === g.checkinId)?.contact
      || "";
    const key = String(g.checkinId);
    setWhatsAppBusyKey(key);
    try {
      const normalized = normalizePhone(phone);
      if (!normalized) {
        showError("WhatsApp", "No phone number for this guest");
        return;
      }
      const res = await apiCall({ action: "createBillShareLink", phone: normalized, checkinId: g.checkinId });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showError("WhatsApp", data.error || "Could not create bill link");
        return;
      }
      const href = buildBillWhatsAppHref({ guestPhone: normalized, guestName: g.guestName, shareUrl: data.url });
      if (!href) {
        showError("WhatsApp", "Could not open WhatsApp for this number");
        return;
      }
      window.open(href, "_blank", "noopener,noreferrer");
    } finally {
      setWhatsAppBusyKey(null);
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
      const { branding } = await withBillBranding(password, username, showError, { embedQr: true });
      await printCombinedBill(guestData, preview.grandTotal, foodTaxRateFromAmounts(cpSub, cpTax), undefined, cpGross - cpExempt, cpExempt, branding, cpTax);
      showSuccess("Combined bill printed successfully!");
    } catch (err: any) {
      showError("Print failed", err.message || "Unknown error");
    } finally {
      setPrintingCombined(false);
    }
  };

  const combinedOrders = preview?.guests.flatMap((g: any) => g.orders || []) || [];
  const combinedOrderIds = combinedOrders.map((o: any) => o.id).filter((id: unknown): id is number => Number.isInteger(id));
  const combinedGrossSubtotal = combinedOrders.reduce((sum: number, o: any) => sum + (o.subtotal || 0) + (o.discount || 0), 0);
  const combinedDiscount = combinedOrders.reduce((sum: number, o: any) => sum + (o.discount || 0), 0);
  const combinedExemptCategoryIds = new Set(categories.filter((c) => c.discountExempt).map((c) => c.id));
  const combinedMenuCategoryMap = new Map(menuItems.map((mi) => [mi.id, mi.categoryId]));
  const combinedExemptSubtotal = combinedOrders.reduce((sum: number, o: any) => sum + (o.items || []).reduce((itemSum: number, i: any) => {
    const categoryId = combinedMenuCategoryMap.get(i.menuItemId);
    return i.status !== "voided" && categoryId !== undefined && combinedExemptCategoryIds.has(categoryId) ? itemSum + (i.lineTotal || 0) : itemSum;
  }, 0), 0);
  const combinedDiscountableSubtotal = Math.max(0, combinedGrossSubtotal - combinedExemptSubtotal);
  const canCombinedPay = hasPermission(role, permissions, "canMarkPaid");
  const canCombinedDiscount = hasPermission(role, permissions, "canApplyFoodDiscounts") || canCombinedPay;

  const reloadCombinedPreview = async () => {
    if (selectedIds.length === 0) return;
    const res = await apiCall({ action: "getCombinedBill", checkinIds: selectedIds });
    const data = await res.json().catch(() => ({}));
    if (res.ok) setPreview(data);
    else { setPreview(null); showError("Combined Bill", data.error || "Could not reload combined bill"); }
  };

  const handleCombinedPayment = async (method: string, cashReceived: number, changeGiven: number, onlineAccountId?: number, receiptId?: string) => {
    if (combinedOrderIds.length === 0) return;
    setActionBusy(true);
    try {
      const res = await apiCall({ action: "markOrderPaid", orderIds: combinedOrderIds, paymentMethod: method, cashReceived, changeGiven, onlineAccountId, receiptId });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { showError("Combined payment", data.error || "Could not record payment"); return; }
      setPaymentOpen(false);
      setSelectedIds([]);
      setPreview(null);
      showSuccess("Combined payment recorded");
      const guestsRes = await apiCall({ action: "getGuestsWithTabs" });
      if (guestsRes.ok) setGuests((await guestsRes.json()).guests || []);
    } finally { setActionBusy(false); }
  };

  const cardBranding = (orders: any[]) => ({
    hostelName: billBranding.hostelName,
    location: billBranding.location,
    accent: billBranding.accent,
    upiId: billBranding.upiId,
    qrUrl: billBranding.paymentQrUrl,
    footer: billBranding.footer,
    taxRate: foodTaxRateFromAmounts(
      orders.reduce((s: number, o: any) => s + (o.subtotal || 0), 0),
      orders.reduce((s: number, o: any) => s + (o.tax || 0), 0),
    ),
  });

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
              onClick={() => void loadPreview()}
              disabled={loadingPreview}
              className="mt-3 rounded-lg bg-brand-green px-4 py-2 text-sm font-medium text-white hover:bg-brand-green/90 disabled:opacity-50"
            >
              {loadingPreview ? "Loading..." : `Preview Combined Bill (${selectedIds.length} guests)`}
            </button>
          )}
        </div>
      )}

      {preview && (
        <div className="space-y-4">
          <h4 className="text-sm font-bold text-brand-green-dark">Bill Preview</h4>
          {preview.guests.map((g: any) => {
            const orders = (g.orders || []) as any[];
            return (
              <GuestFoodBillCard
                key={g.checkinId}
                orders={orders.map((o) => ({
                  guestName: g.guestName,
                  roomInfo: g.roomInfo || o.roomInfo,
                  paymentStatus: o.paymentStatus,
                  paymentMethod: o.paymentMethod,
                  createdAt: o.createdAt,
                  subtotal: o.subtotal,
                  tax: o.tax,
                  total: o.total,
                  discount: o.discount || 0,
                  items: (o.items || []).map((i: any) => ({
                    itemName: i.itemName || i.name,
                    quantity: i.quantity,
                    itemPrice: i.itemPrice ?? i.price,
                    lineTotal: i.lineTotal,
                    status: i.status,
                    pricingStatus: i.pricingStatus,
                    notes: i.notes,
                  })),
                }))}
                variant="unpaid"
                branding={cardBranding(orders)}
                alwaysExpanded
                footerActions={
                  <button
                    type="button"
                    onClick={() => void shareGuestBill(g)}
                    disabled={whatsAppBusyKey === String(g.checkinId)}
                    className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800 hover:bg-emerald-100 disabled:opacity-50 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
                  >
                    {whatsAppBusyKey === String(g.checkinId) ? <Loader2Icon className="h-3.5 w-3.5 animate-spin" /> : <MessageCircleIcon className="h-3.5 w-3.5" />}
                    WhatsApp {g.guestName.split(" ")[0]}
                  </button>
                }
              />
            );
          })}

          <div className="rounded-xl border border-brand-mist bg-white dark:bg-card p-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold text-brand-green-dark">Grand Total</span>
              <span className="text-lg font-bold text-brand-green">₹{(preview.grandTotal / 100).toFixed(0)}</span>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {btSupported && (
                <button
                  type="button"
                  onClick={() => void handlePrintCombined()}
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
                  const { branding, paymentQrDataUrl } = await withBillBranding(password, username, showError, { embedQr: true });
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
                    branding,
                    paymentQrDataUrl,
                  };
                  await generateCombinedBill(combinedData);
                }}
                className="flex flex-1 items-center justify-center gap-1 rounded-lg border border-blue-200 dark:border-blue-800 px-4 py-2 text-sm font-medium text-blue-700 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950"
              >
                <DownloadIcon className="h-4 w-4" />
                Download PDF
              </button>
              {canCombinedDiscount && (
                <button
                  type="button"
                  onClick={() => setDiscountOpen(true)}
                  disabled={actionBusy}
                  className="flex flex-1 items-center justify-center gap-1 rounded-lg border border-purple-300 px-4 py-2 text-sm font-medium text-purple-700 hover:bg-purple-50 disabled:opacity-50"
                >
                  <TagIcon className="h-4 w-4" /> Discount
                </button>
              )}
              {canCombinedPay && (
                <button
                  type="button"
                  onClick={() => setPaymentOpen(true)}
                  disabled={actionBusy}
                  className="flex flex-1 items-center justify-center gap-1 rounded-lg border border-green-500 px-4 py-2 text-sm font-semibold text-green-700 hover:bg-green-50 disabled:opacity-50"
                >
                  <BanknoteIcon className="h-4 w-4" /> Pay · ₹{(preview.grandTotal / 100).toFixed(0)}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {paymentOpen && preview && (
        <RecordPaymentModal
          totalAmount={preview.grandTotal}
          guestName={`Combined bill · ${preview.guests.length} guests`}
          initialMethod="online"
          password={password}
          username={username}
          receiptKind="food"
          onConfirm={(method, cashReceived, changeGiven, onlineAccountId, receiptId) => handleCombinedPayment(method, cashReceived, changeGiven, onlineAccountId, receiptId)}
          onClose={() => !actionBusy && setPaymentOpen(false)}
        />
      )}

      {discountOpen && preview && (
        <DiscountModal
          totalAmount={combinedGrossSubtotal}
          discountableAmount={combinedDiscountableSubtotal}
          exemptAmount={combinedExemptSubtotal}
          currentDiscount={combinedDiscount}
          guestName={`Combined bill · ${preview.guests.length} guests`}
          onApply={async (data) => {
            setActionBusy(true);
            try {
              const res = await apiCall({ action: "applyDiscount", orderIds: combinedOrderIds, ...data });
              const body = await res.json().catch(() => ({}));
              if (!res.ok) { showError("Combined discount", body.error || "Could not apply discount"); return; }
              setDiscountOpen(false);
              showSuccess("Combined discount applied");
              await reloadCombinedPreview();
            } finally { setActionBusy(false); }
          }}
          onRemove={combinedDiscount > 0 ? async () => {
            setActionBusy(true);
            try {
              const res = await apiCall({ action: "removeDiscount", orderIds: combinedOrderIds });
              const body = await res.json().catch(() => ({}));
              if (!res.ok) { showError("Combined discount", body.error || "Could not remove discount"); return; }
              setDiscountOpen(false);
              showSuccess("Combined discount removed");
              await reloadCombinedPreview();
            } finally { setActionBusy(false); }
          } : undefined}
          onClose={() => !actionBusy && setDiscountOpen(false)}
        />
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
  const { showError } = useAdminToast();
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
      // Keep broad unpaid reads on their focused paths; fetch only recent paid orders below.
      const [hostelRes, menuRes, walkinRes] = await Promise.all([
        apiCall({ action: "getGuestsWithTabs" }),
        apiCall({ action: "getMenu" }),
        apiCall({ action: "getWalkinOrders" }),
      ]);
      const map = new Map<number, GuestWithTab>();
      if (hostelRes.ok) {
        const data = await hostelRes.json();
        for (const g of (data.guests || []) as GuestWithTab[]) map.set(g.checkinId, g);
        setHostelGuestInfo(map);
      } else {
        const data = await hostelRes.json().catch(() => ({}));
        showError("Payment Summary", data.error || "Could not load guest tabs");
      }

      const orders: Order[] = [];
      if (walkinRes.ok) {
        const data = await walkinRes.json();
        orders.push(...(data.orders || []));
      } else {
        const data = await walkinRes.json().catch(() => ({}));
        showError("Payment Summary", data.error || "Could not load walk-in orders");
      }

      if (map.size > 0) {
        const tabBatches = await Promise.all(
          [...map.keys()].map(async (checkinId) => {
            const res = await apiCall({ action: "getGuestAllOrders", checkinId });
            if (!res.ok) return [] as Order[];
            const data = await res.json();
            return ((data.orders || []) as Order[]).filter((o) => o.status !== "cancelled");
          }),
        );
        orders.push(...tabBatches.flat());
      }
      let historyDays = 7;
      if (menuRes.ok) {
        const data = await menuRes.json();
        historyDays = Math.min(90, Math.max(1, parseInt(data.paymentHistoryDays) || 7));
        setPaidVisibilityDays(historyDays);
        setCategories(data.categories || []);
        setMenuItems((data.items || []).map((i: any) => ({ id: i.id, categoryId: i.categoryId, name: i.name, nameKannada: i.nameKannada || "", description: i.description || "", price: i.price, priceText: i.priceText || "", tags: i.tags || "[]", isAvailable: i.isAvailable })));
      } else {
        const data = await menuRes.json().catch(() => ({}));
        showError("Payment Summary", data.error || "Could not load menu settings");
      }

      const paidFrom = new Date();
      paidFrom.setDate(paidFrom.getDate() - historyDays);
      const paidQuery = {
        action: "listOrders",
        status: "all_history",
        paymentStatus: "paid",
        dateFrom: localDateStr(paidFrom),
        dateTo: localDateStr(new Date()),
        limit: 200,
        includeItems: true,
        includeModifications: true,
      };
      let paidOffset = 0;
      while (true) {
        const paidRes = await apiCall({ ...paidQuery, offset: paidOffset });
        if (!paidRes.ok) {
          const data = await paidRes.json().catch(() => ({}));
          showError("Payment Summary", data.error || "Could not load recent paid orders");
          break;
        }
        const data = await paidRes.json();
        const page = (data.orders || []) as Order[];
        orders.push(...page.filter((order) => order.paymentStatus === "paid" && order.status !== "cancelled"));
        if (page.length < paidQuery.limit) break;
        paidOffset += page.length;
      }

      setAllOrders([...new Map(orders.map((order) => [order.id, order])).values()]);
    } finally {
      setLoading(false);
    }
  }, [apiCall, showError]);

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
        const next = ((data.orders || []) as Order[]).filter((o) => o.status !== "cancelled");
        setDetailOrders((prev) => ({ ...prev, [group.key]: next }));
        setAllOrders((prev) => [
          ...prev.filter((o) => !(o.guestType === "hostel" && o.checkinId === checkinId)),
          ...next,
        ]);
      }
      return;
    }
    const walkinRes = await apiCall({ action: "getWalkinOrders" });
    if (walkinRes.ok) {
      const data = await walkinRes.json();
      const walkins = (data.orders || []) as Order[];
      setAllOrders((prev) => [
        ...prev.filter((o) => o.guestType === "hostel"),
        ...walkins,
      ]);
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
                                <BanknoteIcon className="h-3 w-3" /> Edit Payment
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
  const { showError } = useAdminToast();
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
      const res = await apiCall({ action: "listOrders", dateFrom: from, dateTo: to, limit: 200, includeItems: false, includeModifications: false });
      if (res.ok) {
        const data = await res.json();
        setOrders(data.orders || []);
      } else {
        const data = await res.json().catch(() => ({}));
        setOrders([]);
        showError("Payment History", data.error || "Could not load history");
      }
    } finally { setLoading(false); }
  }, [apiCall, getDateRange, showError]);

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
              <DateRangePicker
                variant="compact"
                applyMode="manual"
                minNights={0}
                startDate={customFrom}
                endDate={customTo}
                onChange={({ startDate, endDate }) => {
                  setCustomFrom(startDate);
                  setCustomTo(endDate);
                }}
                className="w-56"
              />
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

export function OrderHistory({ apiCall, password, username }: { apiCall: (body: any) => Promise<Response>; password: string; username?: string }) {
  const { showError, showSuccess } = useAdminToast();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [categories, setCategories] = useState<MenuCategory[]>([]);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [statusFilter, setStatusFilter] = useState("");
  const [guestTypeFilter, setGuestTypeFilter] = useState("");
  const [searchFilter, setSearchFilter] = useState("");
  const [expandedOrder, setExpandedOrder] = useState<number | null>(null);
  const [expandLoading, setExpandLoading] = useState(false);
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
      const params: any = { action: "listOrders", limit: 100, auditHistory: true, includeItems: false };
      if (dateFrom) params.dateFrom = dateFrom;
      if (dateTo) params.dateTo = dateTo;
      if (statusFilter) params.status = statusFilter;
      if (guestTypeFilter) params.guestType = guestTypeFilter;
      if (searchFilter) params.search = searchFilter;
      if (!statusFilter && !dateFrom) params.status = "all_history";

      const res = await apiCall(params);
      if (res.ok) {
        const data = await res.json();
        setOrders(data.orders || []);
        setExpandedOrder(null);
      } else {
        const data = await res.json().catch(() => ({}));
        setOrders([]);
        showError("Order History", data.error || "Could not load orders");
      }
    } finally {
      setLoading(false);
    }
  }, [apiCall, dateFrom, dateTo, statusFilter, guestTypeFilter, searchFilter, showError]);

  const toggleExpandOrder = async (orderId: number) => {
    if (expandedOrder === orderId) {
      setExpandedOrder(null);
      return;
    }
    setExpandedOrder(orderId);
    const existing = orders.find((o) => o.id === orderId);
    if (existing && existing.items && existing.items.length > 0) return;
    setExpandLoading(true);
    try {
      const res = await apiCall({ action: "getOrderDetails", orderId });
      if (res.ok) {
        const data = await res.json();
        const items = data.items || [];
        setOrders((prev) => prev.map((o) => (o.id === orderId ? { ...o, items } : o)));
      } else {
        const data = await res.json().catch(() => ({}));
        showError("Order History", data.error || "Could not load order details");
      }
    } finally {
      setExpandLoading(false);
    }
  };

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

  return (
    <div className="space-y-4">
      <h3 className="font-display text-lg font-bold text-brand-green-dark">Order History</h3>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 rounded-xl border border-brand-mist bg-white dark:bg-card p-3">
        <DateRangePicker
          variant="compact"
          applyMode="manual"
          minNights={0}
          labels={{ start: "From", end: "To" }}
          startDate={dateFrom}
          endDate={dateTo}
          onChange={({ startDate, endDate }) => {
            setDateFrom(startDate);
            setDateTo(endDate);
          }}
          className="w-56"
        />
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
          <label className="mb-0.5 block text-xs text-brand-green-dark/60">Search</label>
          <input type="search" value={searchFilter} onChange={(e) => setSearchFilter(e.target.value)} placeholder="Order, guest, phone, room" className="w-full rounded border border-brand-mist px-2 py-1 text-sm sm:w-52" />
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
                onClick={() => void toggleExpandOrder(order.id)}
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
                  {expandLoading && !(order.items && order.items.length) ? (
                    <p className="text-xs text-brand-green-dark/50">Loading items...</p>
                  ) : !(order.items && order.items.length) ? (
                    <p className="text-xs text-brand-green-dark/50">No items</p>
                  ) : order.items.map((item) => (
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
                          if (!order.items?.length) {
                            showError("Print", "Wait for items to load, then try again");
                            return;
                          }
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
                            const { branding } = await withBillBranding(password, username, showError);
                            await printFoodBill({
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
                              branding,
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
                        if (!order.items?.length) {
                          showError("Bill", "Wait for items to load, then try again");
                          return;
                        }
                        if (order.items.some((i) => i.status !== "voided" && i.pricingStatus === "pending")) { showError("Price pending", "Set final prices before generating the bill"); return; }
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
                        const { branding, paymentQrDataUrl } = await withBillBranding(password, username, showError);
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
                          paymentStatus: order.paymentStatus,
                          paymentMethod: order.paymentMethod || undefined,
                          branding,
                          paymentQrDataUrl: order.paymentStatus === "paid" ? undefined : paymentQrDataUrl,
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

// ─── Set Price Modal ─────────────────────────────────────────────────────────

const QUICK_PRICE_LABELS = ["Outside", "Market", "Special", "Catch", "Custom"];

function SetPriceModal({
  itemName,
  busy,
  onSave,
  onClose,
}: {
  itemName: string;
  busy: boolean;
  onSave: (priceRupees: number, label: string) => void;
  onClose: () => void;
}) {
  const [priceInput, setPriceInput] = useState("");
  const [label, setLabel] = useState("");
  const priceRupees = Number(priceInput);
  const canSave = Number.isFinite(priceRupees) && priceRupees > 0 && !busy;

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center p-0 sm:p-4">
      <div className="absolute inset-0 bg-black/40" onClick={busy ? undefined : onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="set-price-title"
        className="relative w-full max-w-sm rounded-t-2xl sm:rounded-2xl bg-white dark:bg-card shadow-2xl dark:shadow-none animate-in slide-in-from-bottom sm:zoom-in-95 duration-200 max-h-[90vh] flex flex-col safe-area-pb"
      >
        <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-brand-mist sm:hidden" />
        <div className="flex items-center justify-between border-b border-brand-mist px-5 py-4">
          <div className="min-w-0 pr-2">
            <h3 id="set-price-title" className="text-base font-bold text-brand-green-dark">Set final price</h3>
            <p className="truncate text-xs text-brand-green-dark/50">{itemName}</p>
          </div>
          <button type="button" onClick={onClose} disabled={busy} className="flex-shrink-0 rounded-lg p-1.5 hover:bg-brand-sand disabled:opacity-50">
            <XIcon className="h-5 w-5 text-brand-green-dark/60" />
          </button>
        </div>

        <div className="space-y-4 overflow-y-auto px-5 py-4">
          <div>
            <label htmlFor="set-price-rupees" className="mb-1.5 block text-xs font-medium text-brand-green-dark/70">Price per unit (₹)</label>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-brand-green-dark/50">₹</span>
              <input
                id="set-price-rupees"
                type="number"
                inputMode="decimal"
                min="0"
                step="1"
                autoFocus
                value={priceInput}
                onChange={(e) => setPriceInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && canSave) onSave(priceRupees, label);
                }}
                placeholder="0"
                className="w-full rounded-xl border border-brand-mist bg-white dark:bg-card py-3 pl-8 pr-3 text-lg font-bold text-brand-green-dark outline-none focus:border-brand-green focus:ring-2 focus:ring-brand-green/20"
              />
            </div>
          </div>

          <div>
            <label htmlFor="set-price-label" className="mb-1.5 block text-xs font-medium text-brand-green-dark/70">
              Custom label <span className="font-normal text-brand-green-dark/40">(optional)</span>
            </label>
            <div className="mb-2 flex flex-wrap gap-1.5">
              {QUICK_PRICE_LABELS.map((chip) => (
                <button
                  key={chip}
                  type="button"
                  onClick={() => setLabel(chip === "Custom" ? "" : chip)}
                  className={cn(
                    "rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors",
                    label === chip
                      ? "bg-violet-600 text-white"
                      : "bg-violet-100 text-violet-700 dark:bg-violet-900/50 dark:text-violet-300 hover:bg-violet-200 dark:hover:bg-violet-900",
                  )}
                >
                  {chip}
                </button>
              ))}
            </div>
            <input
              id="set-price-label"
              type="text"
              maxLength={24}
              value={label}
              onChange={(e) => setLabel(e.target.value.slice(0, 24))}
              placeholder="e.g. Outside, Market rate…"
              className="w-full rounded-xl border border-brand-mist bg-white dark:bg-card px-3 py-2.5 text-sm text-brand-green-dark outline-none focus:border-brand-green focus:ring-2 focus:ring-brand-green/20"
            />
            {label.trim() && (
              <p className="mt-2 flex items-center gap-1.5 text-[11px] text-brand-green-dark/50">
                Preview
                <span className="rounded-full bg-violet-100 dark:bg-violet-900/50 px-1.5 py-0.5 text-[9px] font-semibold text-violet-700 dark:text-violet-300">{label.trim()}</span>
              </p>
            )}
          </div>
        </div>

        <div className="flex gap-2 border-t border-brand-mist px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="flex-1 rounded-xl border border-brand-mist px-4 py-3 text-sm font-medium text-brand-green-dark/70 hover:bg-brand-sand disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onSave(priceRupees, label)}
            disabled={!canSave}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-brand-green px-4 py-3 text-sm font-semibold text-white hover:bg-brand-green/90 disabled:opacity-50"
          >
            {busy ? <Loader2Icon className="h-4 w-4 animate-spin" /> : null}
            Save price
          </button>
        </div>
      </div>
    </div>
  );
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
  onApply: (data: { discountPercent?: number; discountAmount?: number; reason: string }) => void | Promise<void>;
  onRemove?: () => void | Promise<void>;
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

  const handleApply = async () => {
    setSaving(true);
    try {
      if (mode === "percent") {
        await onApply({ discountPercent: Number(percentInput) || 0, reason: finalReason });
      } else {
        await onApply({ discountAmount: Math.round((Number(fixedInput) || 0) * 100), reason: finalReason });
      }
    } finally {
      setSaving(false);
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
              onClick={async () => {
                setSaving(true);
                try { await onRemove(); } finally { setSaving(false); }
              }}
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
            onClick={() => void handleApply()}
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

export function OrderPaymentBadge({ paymentStatus }: { paymentStatus: string }) {
  const paid = paymentStatus === "paid";
  return (
    <span
      className={cn(
        "rounded-full px-1.5 py-0.5 text-[10px] font-semibold",
        paid
          ? "bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-400"
          : "bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-400",
      )}
    >
      {paid ? "Paid" : "Unpaid"}
    </span>
  );
}
