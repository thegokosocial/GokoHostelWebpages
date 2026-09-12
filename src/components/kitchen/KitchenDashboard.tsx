"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  LogOutIcon,
  ChefHatIcon,
  BellIcon,
  XIcon,
  AlertTriangleIcon,
  CheckIcon,
  ClockIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  ToggleLeftIcon,
  ToggleRightIcon,
  PackageIcon,
  FlameIcon,
  UtensilsCrossedIcon,
  PrinterIcon,
  PlusIcon,
  MinusIcon,
  PencilIcon,
  SaveIcon,
  HistoryIcon,
} from "lucide-react";
import { isBluetoothSupported, printOrderTicket } from "@/lib/thermalPrint";
import { useAdminToast } from "@/components/admin/AdminToast";
// import { DarkModeToggle } from "@/components/DarkModeToggle";

interface OrderItem {
  id: number;
  menuItemId: number;
  itemName: string;
  itemPrice: number;
  quantity: number;
  lineTotal: number;
  status: string;
  tags: string;
}

interface Order {
  id: number;
  orderNumber: string;
  guestType: string;
  guestName: string;
  guestPhone: string;
  roomInfo: string;
  tableNumber: string;
  specialInstructions: string;
  subtotal: number;
  tax: number;
  total: number;
  status: string;
  createdBy: string;
  createdAt: string;
  items: OrderItem[];
  hasModifications?: boolean;
}

interface OrderModification {
  action: string;
  itemName: string;
  oldValue: string;
  newValue: string;
  modifiedBy: string;
  createdAt: string;
}

interface LocalItemChange {
  originalQty: number;
  newQty: number;
}

interface MenuItem {
  id: number;
  name: string;
  nameKannada: string;
  price: number;
  isAvailable: number;
  categoryId: number;
  tags: string;
  trackInventory: number;
  stockQuantity: number;
  lowStockThreshold: number;
}

interface KitchenCategory {
  id: number;
  name: string;
  icon: string;
}

interface KitchenDashboardProps {
  password: string;
  onLogout: () => void;
}

type MobileTab = "new" | "preparing" | "ready";

const TAG_COLORS: Record<string, string> = {
  veg: "bg-green-100 dark:bg-green-900/50 text-green-700 dark:text-green-400",
  "non-veg": "bg-red-100 dark:bg-red-900/50 text-red-700 dark:text-red-400",
  spicy: "bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-400",
  seafood: "bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-400",
  chicken: "bg-orange-100 dark:bg-orange-900/50 text-orange-700 dark:text-orange-400",
  mutton: "bg-red-100 dark:bg-red-900/50 text-red-800 dark:text-red-300",
  egg: "bg-yellow-100 dark:bg-yellow-900/50 text-yellow-700 dark:text-yellow-400",
  "chef-special": "bg-purple-100 dark:bg-purple-900/50 text-purple-700 dark:text-purple-400",
  "goko-special": "bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-400",
};

function parseTags(tagsStr: string): string[] {
  try {
    const parsed = JSON.parse(tagsStr);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function tagDisplayName(tag: string): string {
  return tag.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

const REJECT_REASONS = [
  "Out of stock",
  "Not available today",
  "Kitchen capacity",
  "Other",
];

export function KitchenDashboard({ password, onLogout }: KitchenDashboardProps) {
  const { showError } = useAdminToast();
  const [orders, setOrders] = useState<Order[]>([]);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [kitchenCategories, setKitchenCategories] = useState<KitchenCategory[]>([]);
  const [kannadaPrintEnabled, setKannadaPrintEnabled] = useState(true);
  const [kannadaDisplayEnabled, setKannadaDisplayEnabled] = useState(true);
  const [approvalInKitchen, setApprovalInKitchen] = useState(false);
  const [selectedMenuCategory, setSelectedMenuCategory] = useState<number | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [mobileTab, setMobileTab] = useState<MobileTab>("new");
  const [showMenuPanel, setShowMenuPanel] = useState(false);
  const [showDemand, setShowDemand] = useState(false);
  const [newOrderBadge, setNewOrderBadge] = useState(0);

  const [rejectModal, setRejectModal] = useState<{
    orderId: number;
    orderItemId: number;
    itemName: string;
  } | null>(null);
  const [rejectReason, setRejectReason] = useState("Out of stock");
  const [rejectCustom, setRejectCustom] = useState("");
  const [rejectLoading, setRejectLoading] = useState(false);
  const [bulkUpdatingStatus, setBulkUpdatingStatus] = useState<string | null>(null);
  const [btSupported, setBtSupported] = useState(false);

  // Edit mode state
  const [editingOrderId, setEditingOrderId] = useState<number | null>(null);
  const [editedItems, setEditedItems] = useState<Map<number, Map<number, LocalItemChange>>>(new Map());
  const [savingEdit, setSavingEdit] = useState(false);

  // Modification history state
  const [showModHistory, setShowModHistory] = useState<number | null>(null);
  const [modHistory, setModHistory] = useState<OrderModification[]>([]);
  const [modHistoryLoading, setModHistoryLoading] = useState(false);

  const fetchingRef = useRef(false);
  const prevPlacedCountRef = useRef(0);
  const lastSoundRef = useRef(0);
  const badgeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const api = useCallback(
    async (action: string, extra: Record<string, any> = {}) => {
      const res = await fetch("/api/food/kitchen", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password, action, ...extra }),
      });
      if (res.status === 401) {
        onLogout();
        throw new Error("Unauthorized");
      }
      return res.json();
    },
    [password, onLogout]
  );

  const fetchOrders = useCallback(async () => {
    if (fetchingRef.current) return;
    fetchingRef.current = true;
    try {
      const data = await api("listOrders");
      if (data.success) {
        const incoming: Order[] = data.data.orders;
        setOrders(incoming);
        setIsBusy(data.data.isBusy);

        const placedCount = incoming.filter((o) => o.status === "placed").length;
        if (placedCount > prevPlacedCountRef.current && prevPlacedCountRef.current !== -1) {
          const diff = placedCount - prevPlacedCountRef.current;
          const now = Date.now();
          if (now - lastSoundRef.current > 30_000) {
            try {
              if (!audioRef.current) {
                audioRef.current = new Audio(
                  "data:audio/wav;base64,UklGRlgFAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YTQFAACAgICAgICAgICAgICAgICAgICAgICAgICA/3+AgP9/gID/f4CA/3+AgP9/gICAgP9/gICAgICAgICAgICAgICAgICBgYKCg4OEhIWFh4eIiImJi4uMjI2Njo6Pj5CQkJCQkJCPj46OjYyLi4qKiYiHh4aGhYSEg4OCgoGBgIB/f35+fXx8e3t6enl5eHh4eHh4eHh5eXp6e3t8fH19fn5/f4CAgYGCgoODhISFhYaGh4eIiImJioqKiouLi4uLi4uLi4uKioqKiYmIiIeHhoaFhYSEg4OCgoGBgIB/f35+fX18fHt7e3t6enp6enp6ent7e3t8fH19fn5/f4CAgYGCgoODhISFhYaGh4eIiImJioqKiouLi4uLi4uLi4uKioqJiYmIiIeHhoaFhYSEg4OCgoGBgIB/f35+fX18fHt7e3t6enp6enp6ent7e3t8fH19fn5/f4CAgYGCgoODhISFhQA="
                );
              }
              audioRef.current.currentTime = 0;
              audioRef.current.play().catch(() => {});
            } catch {}
            lastSoundRef.current = now;
          }
          setNewOrderBadge(diff);
          if (badgeTimerRef.current) clearTimeout(badgeTimerRef.current);
          badgeTimerRef.current = setTimeout(() => setNewOrderBadge(0), 5000);
        }
        prevPlacedCountRef.current = placedCount;
      }
    } catch (err: any) {
      if (err?.message !== "Unauthorized") {
        console.error("Fetch orders error:", err);
      }
    } finally {
      fetchingRef.current = false;
    }
  }, [api]);

  const fetchMenuItems = useCallback(async () => {
    try {
      const data = await api("getMenuItems");
      if (data.success) {
        setMenuItems(data.data.items);
        setKitchenCategories(data.data.categories);
        if (data.data.kannadaPrint !== undefined) setKannadaPrintEnabled(data.data.kannadaPrint);
        if (data.data.kannadaDisplay !== undefined) setKannadaDisplayEnabled(data.data.kannadaDisplay);
        if (data.data.approvalInKitchen !== undefined) setApprovalInKitchen(data.data.approvalInKitchen);
        setSelectedMenuCategory((prev) => {
          if (!prev && data.data.categories.length > 0) {
            return data.data.categories[0].id;
          }
          return prev;
        });
      }
    } catch {}
  }, [api]);

  useEffect(() => {
    prevPlacedCountRef.current = -1;
    fetchOrders();
    fetchMenuItems();
    const tick = () => {
      if (!document.hidden) fetchOrders();
    };
    const interval = setInterval(tick, 5000);
    const onVis = () => {
      if (!document.hidden) fetchOrders();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVis);
      if (badgeTimerRef.current) clearTimeout(badgeTimerRef.current);
    };
  }, [fetchOrders, fetchMenuItems]);

  useEffect(() => { setBtSupported(isBluetoothSupported()); }, []);

  const updateStatus = async (orderId: number, status: string) => {
    try {
      await api("updateStatus", { orderId, status });
      setOrders((prev) =>
        prev.map((o) => (o.id === orderId ? { ...o, status } : o))
      );
    } catch {}
  };

  const updateAllStatuses = async (ordersInStage: Order[], status: "preparing" | "ready" | "served") => {
    if (ordersInStage.length === 0 || bulkUpdatingStatus) return;
    setBulkUpdatingStatus(status);
    try {
      const data = await api("updateStatusBulk", { orderIds: ordersInStage.map((order) => order.id), status });
      if (!data.success) throw new Error(data.error || "Bulk status update failed");
      await fetchOrders();
    } catch (err: any) {
      if (err?.message !== "Unauthorized") showError("Could not update all orders", "Please try again.");
    } finally {
      setBulkUpdatingStatus(null);
    }
  };

  const toggleAvailability = async (menuItemId: number, currentlyAvailable: number) => {
    const newAvail = currentlyAvailable === 1 ? 0 : 1;
    try {
      await api("toggleItemAvailability", { menuItemId, isAvailable: newAvail === 1 });
      setMenuItems((prev) =>
        prev.map((m) => (m.id === menuItemId ? { ...m, isAvailable: newAvail } : m))
      );
    } catch {}
  };

  const handleReject = async () => {
    if (!rejectModal) return;
    setRejectLoading(true);
    const reason = rejectReason === "Other" ? rejectCustom : rejectReason;
    try {
      await api("rejectItem", {
        orderId: rejectModal.orderId,
        orderItemId: rejectModal.orderItemId,
        reason,
      });
      setOrders((prev) =>
        prev.map((o) => {
          if (o.id !== rejectModal.orderId) return o;
          return {
            ...o,
            items: o.items.map((i) =>
              i.id === rejectModal.orderItemId ? { ...i, status: "voided" } : i
            ),
          };
        })
      );
      setRejectModal(null);
      setRejectReason("Out of stock");
      setRejectCustom("");
    } catch {
    } finally {
      setRejectLoading(false);
    }
  };


  const toggleBusy = async () => {
    const newBusy = !isBusy;
    try {
      await api("toggleBusy", { isBusy: newBusy });
      setIsBusy(newBusy);
    } catch {}
  };

  const startEditing = (orderId: number) => {
    if (editingOrderId !== null && editingOrderId !== orderId) {
      cancelEditing();
    }
    setEditingOrderId(orderId);
    setEditedItems(new Map());
  };

  const cancelEditing = () => {
    setEditingOrderId(null);
    setEditedItems(new Map());
  };

  const handleEditQuantity = (orderId: number, item: OrderItem, delta: number) => {
    setEditedItems((prev) => {
      const newMap = new Map(prev);
      const orderChanges = new Map(newMap.get(orderId) || new Map());
      const existing = orderChanges.get(item.id);
      const originalQty = existing ? existing.originalQty : item.quantity;
      const currentQty = existing ? existing.newQty : item.quantity;
      const newQty = Math.max(0, currentQty + delta);
      if (newQty === originalQty) {
        orderChanges.delete(item.id);
      } else {
        orderChanges.set(item.id, { originalQty, newQty });
      }
      if (orderChanges.size === 0) {
        newMap.delete(orderId);
      } else {
        newMap.set(orderId, orderChanges);
      }
      return newMap;
    });
  };

  const addItemToOrder = async (orderId: number, menuItemId: number, quantity: number) => {
    try {
      const data = await api("addItemToOrder", { orderId, menuItemId, quantity });
      if (data.success) {
        await fetchOrders();
      }
    } catch {}
  };

  const saveEditing = async () => {
    if (editingOrderId === null) return;
    const changes = editedItems.get(editingOrderId);
    if (!changes || changes.size === 0) {
      cancelEditing();
      return;
    }

    setSavingEdit(true);
    try {
      for (const [itemId, change] of changes) {
        await api("updateItemQuantity", {
          orderId: editingOrderId,
          orderItemId: itemId,
          newQuantity: change.newQty,
        });
      }
      await fetchOrders();
    } catch {} finally {
      setSavingEdit(false);
      cancelEditing();
    }
  };

  const fetchModificationHistory = async (orderId: number) => {
    if (showModHistory === orderId) {
      setShowModHistory(null);
      return;
    }
    setShowModHistory(orderId);
    setModHistoryLoading(true);
    try {
      const data = await api("getOrderModifications", { orderId });
      if (data.success) {
        setModHistory(data.data.modifications || []);
      }
    } catch {
      setModHistory([]);
    } finally {
      setModHistoryLoading(false);
    }
  };

  const handlePrintTicket = async (order: Order) => {
    try {
      await printOrderTicket({
        orderNumber: order.orderNumber,
        guestName: order.guestName,
        guestType: order.guestType,
        roomInfo: order.roomInfo || undefined,
        items: order.items.filter(i => i.status !== "voided").map(i => {
          const mi = kannadaPrintEnabled ? menuItems.find(m => m.id === i.menuItemId) : undefined;
          return { name: i.itemName, nameKannada: mi?.nameKannada || undefined, quantity: i.quantity };
        }),
        specialInstructions: order.specialInstructions || undefined,
        createdAt: order.createdAt,
      });
    } catch (err: any) {
      showError("Print failed", err.message);
    }
  };

  const hasActiveItems = (o: Order) => o.items.some((i) => i.status !== "voided");
  const pendingApprovalOrders = useMemo(() => orders.filter((o) => o.status === "pending_approval" && hasActiveItems(o)), [orders]);
  const placedOrders = useMemo(() => orders.filter((o) => o.status === "placed" && hasActiveItems(o)), [orders]);
  const preparingOrders = useMemo(() => orders.filter((o) => o.status === "preparing" && hasActiveItems(o)), [orders]);
  const readyOrders = useMemo(() => orders.filter((o) => o.status === "ready" && hasActiveItems(o)), [orders]);

  const displayMenuItems = useMemo(() => {
    if (kannadaDisplayEnabled) return menuItems;
    return menuItems.map(mi => ({ ...mi, nameKannada: "" }));
  }, [menuItems, kannadaDisplayEnabled]);

  const kannadaLookup = useMemo(() => {
    if (!kannadaDisplayEnabled) return new Map<string, string>();
    const m = new Map<string, string>();
    for (const mi of menuItems) { if (mi.nameKannada) m.set(mi.name, mi.nameKannada); }
    return m;
  }, [menuItems, kannadaDisplayEnabled]);

  const demandSummary = useMemo(() => {
    const map = new Map<string, number>();
    for (const order of placedOrders) {
      for (const item of order.items) {
        if (item.status === "voided") continue;
        map.set(item.itemName, (map.get(item.itemName) || 0) + item.quantity);
      }
    }
    return Array.from(map.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([name, qty]) => ({ name, nameKannada: kannadaLookup.get(name) || "", qty }));
  }, [placedOrders, kannadaLookup]);

  const unavailableItems = useMemo(
    () => menuItems.filter((m) => m.isAvailable === 0),
    [menuItems]
  );

  const lowStockItems = useMemo(
    () => menuItems.filter((m) => m.trackInventory && m.stockQuantity <= m.lowStockThreshold && m.stockQuantity > 0),
    [menuItems]
  );

  const categoryMenuItems = useMemo(
    () => selectedMenuCategory ? menuItems.filter((m) => m.categoryId === selectedMenuCategory) : [],
    [menuItems, selectedMenuCategory]
  );

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-background text-gray-900 dark:text-foreground">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-gray-200 dark:border-border bg-white/95 dark:bg-card/95 backdrop-blur-md shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <ChefHatIcon className="h-6 w-6 text-amber-500" />
            <h1 className="text-lg font-bold text-gray-900 dark:text-foreground">Kitchen</h1>
            <AnimatePresence>
              {newOrderBadge > 0 && (
                <motion.span
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  exit={{ scale: 0 }}
                  className="flex items-center gap-1 rounded-full bg-amber-500 px-3 py-1 text-xs font-bold text-white"
                >
                  <BellIcon className="h-3 w-3" />
                  {newOrderBadge} new
                </motion.span>
              )}
            </AnimatePresence>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={toggleBusy}
              className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                isBusy
                  ? "bg-orange-500/20 text-orange-600 ring-1 ring-orange-500/50"
                  : "bg-gray-100 dark:bg-muted text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-accent"
              }`}
            >
              {isBusy ? (
                <ToggleRightIcon className="h-4 w-4" />
              ) : (
                <ToggleLeftIcon className="h-4 w-4" />
              )}
              <span className="hidden sm:inline">
                {isBusy ? "BUSY MODE ON" : "Busy Mode"}
              </span>
            </button>

            <button
              type="button"
              onClick={() => {
                setShowMenuPanel(!showMenuPanel);
                if (!showMenuPanel) fetchMenuItems();
              }}
              className="relative flex items-center gap-2 rounded-lg bg-gray-100 dark:bg-muted px-3 py-2 text-sm font-medium text-gray-600 dark:text-gray-400 transition-colors hover:bg-gray-200 dark:hover:bg-accent"
            >
              <PackageIcon className="h-4 w-4" />
              <span className="hidden sm:inline">Out of Stock</span>
              {unavailableItems.length > 0 && (
                <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-xs font-bold text-white">
                  {unavailableItems.length}
                </span>
              )}
            </button>

            {/* <DarkModeToggle className="text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-muted" /> */}
            <button
              type="button"
              onClick={onLogout}
              className="rounded-lg bg-gray-100 dark:bg-muted p-2 text-gray-500 dark:text-gray-400 transition-colors hover:bg-gray-200 dark:hover:bg-accent hover:text-gray-900 dark:hover:text-foreground"
            >
              <LogOutIcon className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Mobile tabs */}
        <div className="flex border-t border-gray-200 dark:border-border md:hidden">
          {(
            [
              { key: "new", label: "New", count: placedOrders.length, color: "amber" },
              { key: "preparing", label: "Preparing", count: preparingOrders.length, color: "blue" },
              { key: "ready", label: "Ready", count: readyOrders.length, color: "emerald" },
            ] as const
          ).map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setMobileTab(tab.key)}
              className={`flex flex-1 items-center justify-center gap-2 py-3 text-sm font-medium transition-colors ${
                mobileTab === tab.key
                  ? `border-b-2 ${
                      tab.color === "amber"
                        ? "border-amber-500 text-amber-600"
                        : tab.color === "blue"
                          ? "border-blue-500 text-blue-600"
                          : "border-emerald-500 text-emerald-600"
                    }`
                  : "border-b-2 border-transparent text-gray-400 dark:text-gray-500"
              }`}
            >
              {tab.label}
              {tab.count > 0 && (
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-bold ${
                    tab.color === "amber"
                      ? "bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-400"
                      : tab.color === "blue"
                        ? "bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-400"
                        : "bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-400"
                  }`}
                >
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </div>
      </header>

      {/* Menu Availability Panel */}
      <AnimatePresence>
        {showMenuPanel && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden border-b border-gray-200 dark:border-border bg-white dark:bg-card"
          >
            <div className="px-4 py-4">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                  Menu Availability
                  {unavailableItems.length > 0 && (
                    <span className="ml-2 text-red-500">
                      ({unavailableItems.length} Out of Stock)
                    </span>
                  )}
                </h3>
              </div>
              {/* Low Stock Alert */}
              {lowStockItems.length > 0 && (
                <div className="mb-4 rounded-lg border border-orange-200 dark:border-orange-800 bg-orange-50 dark:bg-orange-950 p-3">
                  <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-orange-600">
                    <AlertTriangleIcon className="h-4 w-4" />
                    Low Stock ({lowStockItems.length})
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {lowStockItems.map((item) => (
                      <span
                        key={item.id}
                        className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                          item.stockQuantity <= 1
                            ? "bg-red-100 dark:bg-red-900/50 text-red-700 dark:text-red-400"
                            : "bg-orange-100 dark:bg-orange-900/50 text-orange-700 dark:text-orange-400"
                        }`}
                      >
                        {item.name} — <span className="font-bold">{item.stockQuantity}</span> left
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {/* Category selector */}
              <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
                {kitchenCategories.map((cat) => {
                  const catUnavail = menuItems.filter(
                    (m) => m.categoryId === cat.id && m.isAvailable === 0
                  ).length;
                  return (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => setSelectedMenuCategory(cat.id)}
                      className={`relative flex flex-shrink-0 items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-medium transition-all duration-200 ${
                        selectedMenuCategory === cat.id
                          ? "text-amber-700 dark:text-amber-400"
                          : "bg-gray-100 dark:bg-muted text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-accent"
                      }`}
                    >
                      {selectedMenuCategory === cat.id && (
                        <motion.span layoutId="kitchen-cat-pill" className="absolute inset-0 rounded-lg bg-amber-100 dark:bg-amber-900/50 ring-1 ring-amber-300 dark:ring-amber-700" transition={{ type: "spring", stiffness: 400, damping: 30 }} />
                      )}
                      <span className="relative z-10 flex items-center gap-1.5">
                        <span>{cat.icon}</span>
                        <span>{cat.name}</span>
                        {catUnavail > 0 && (
                          <span className="ml-1 rounded-full bg-red-100 dark:bg-red-900/50 px-1.5 py-0.5 text-xs font-bold text-red-600 dark:text-red-400">
                            {catUnavail}
                          </span>
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
              {/* Items in selected category */}
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {categoryMenuItems.map((item) => {
                  const isLow = item.trackInventory && item.stockQuantity <= item.lowStockThreshold;
                  return (
                  <div
                    key={item.id}
                    className={`flex items-center justify-between rounded-lg px-3 py-2 ${
                      item.isAvailable
                        ? isLow ? "bg-orange-50 dark:bg-orange-950 ring-1 ring-orange-200 dark:ring-orange-800" : "bg-gray-50 dark:bg-muted"
                        : "bg-red-50 dark:bg-red-950 ring-1 ring-red-200 dark:ring-red-800"
                    }`}
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">{item.name}</p>
                      {item.nameKannada && (
                        <p className="truncate text-xs text-gray-500">
                          {item.nameKannada}
                        </p>
                      )}
                      {item.trackInventory && (
                        <p className={`text-xs font-medium ${
                          item.stockQuantity === 0 ? "text-red-600" :
                          isLow ? "text-orange-600" : "text-gray-500"
                        }`}>
                          Stock: {item.stockQuantity}
                        </p>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => toggleAvailability(item.id, item.isAvailable)}
                      className={`ml-3 flex-shrink-0 rounded-full px-3 py-2 text-sm font-semibold transition-colors ${
                        item.isAvailable
                          ? "bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-200 dark:hover:bg-emerald-900"
                          : "bg-red-100 dark:bg-red-900/50 text-red-700 dark:text-red-400 hover:bg-red-200 dark:hover:bg-red-900"
                      }`}
                    >
                      {item.isAvailable ? "Available" : "Out of Stock"}
                    </button>
                  </div>
                  );
                })}
                {categoryMenuItems.length === 0 && (
                  <p className="col-span-full py-4 text-center text-sm text-gray-400">
                    {kitchenCategories.length === 0 ? "No categories found" : "No items in this category"}
                  </p>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Aggregate Demand */}
      {placedOrders.length > 0 && (
        <div className="border-b border-gray-200 dark:border-border bg-white dark:bg-card">
          <button
            type="button"
            onClick={() => setShowDemand(!showDemand)}
            className="flex w-full items-center justify-between px-4 py-2 text-sm"
          >
            <span className="flex items-center gap-2 font-medium text-gray-700 dark:text-gray-300">
              <FlameIcon className="h-4 w-4 text-orange-500" />
              Demand Summary
            </span>
            {showDemand ? (
              <ChevronUpIcon className="h-4 w-4 text-gray-400" />
            ) : (
              <ChevronDownIcon className="h-4 w-4 text-gray-400" />
            )}
          </button>
          <AnimatePresence>
            {showDemand && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden"
              >
                <div className="flex flex-wrap gap-2 px-4 pb-3">
                  {demandSummary.map((d) => (
                    <span
                      key={d.name}
                      className="rounded-full bg-gray-100 dark:bg-muted px-3 py-1 text-sm text-gray-700 dark:text-gray-300"
                    >
                      <span className="font-bold text-amber-600">{d.qty}x</span>{" "}
                      {d.name}
                      {d.nameKannada && <span className="ml-1 text-xs text-gray-400">{d.nameKannada}</span>}
                    </span>
                  ))}
                  {demandSummary.length === 0 && (
                    <span className="text-sm text-gray-400">No pending items</span>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {/* Pending Approval */}
      {approvalInKitchen && pendingApprovalOrders.length > 0 && (
        <div className="mx-4 mb-4 rounded-xl border-2 border-amber-400 dark:border-amber-700 bg-amber-50 dark:bg-amber-950 p-4">
          <div className="mb-3 flex items-center gap-2">
            <span className="text-lg">⏳</span>
            <h3 className="font-bold text-amber-800">Pending Approval ({pendingApprovalOrders.length})</h3>
          </div>
          <div className="space-y-3">
            {pendingApprovalOrders.map((order) => {
              const elapsed = Math.floor((Date.now() - new Date(order.createdAt).getTime()) / 60000);
              const elapsedStr = elapsed < 1 ? "<1m" : elapsed < 60 ? `${elapsed}m` : `${Math.floor(elapsed / 60)}h ${elapsed % 60}m`;
              return (
                <div key={order.id} className="rounded-lg border border-amber-200 dark:border-amber-800 bg-white dark:bg-card p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <span className="font-mono text-sm font-bold text-amber-700">#{order.orderNumber}</span>
                      <span className="ml-2 text-sm font-medium text-gray-800 dark:text-gray-200">{order.guestName}</span>
                      {order.guestType === "hostel" && <span className="ml-1.5 rounded-full bg-green-100 dark:bg-green-900/50 px-1.5 py-0.5 text-[10px] font-medium text-green-700 dark:text-green-400">Goko</span>}
                      {order.roomInfo && <span className="ml-1.5 text-xs text-gray-400">{order.roomInfo}</span>}
                    </div>
                    <span className="text-xs text-amber-600">{elapsedStr} ago</span>
                  </div>
                  <div className="mt-2 space-y-0.5">
                    {order.items.filter(i => i.status !== "voided").map((item) => (
                      <div key={item.id} className="text-sm text-gray-700 dark:text-gray-300">
                        <span className="font-medium">{item.quantity}x</span> {item.itemName}
                        {kannadaDisplayEnabled && (() => { const mi = menuItems.find(m => m.id === item.menuItemId); return mi?.nameKannada ? <span className="ml-1 text-xs text-gray-400">{mi.nameKannada}</span> : null; })()}
                      </div>
                    ))}
                  </div>
                  {order.specialInstructions && (
                    <p className="mt-1 text-xs italic text-gray-500">{order.specialInstructions}</p>
                  )}
                  <div className="mt-3 flex gap-2">
                    <button
                      type="button"
                      onClick={() => updateStatus(order.id, "placed")}
                      className="flex-1 rounded-lg bg-green-600 px-3 py-2 text-sm font-medium text-white hover:bg-green-700"
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      onClick={() => updateStatus(order.id, "cancelled")}
                      className="rounded-lg border border-red-300 dark:border-red-800 px-3 py-2 text-sm font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950"
                    >
                      Reject
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Order Columns */}
      <div className="p-4">
        {/* Desktop: 3-column grid */}
        <div className="hidden gap-4 md:grid md:grid-cols-3">
          <OrderColumn
            title="New Orders"
            orders={placedOrders}
            color="amber"
            actionLabel="START PREPARING"
            actionColor="bg-emerald-600 hover:bg-emerald-500 text-white"
            bulkActionLabel="START ALL"
            onBulkAction={() => updateAllStatuses(placedOrders, "preparing")}
            bulkActionDisabled={bulkUpdatingStatus !== null}
            onAction={(id) => updateStatus(id, "preparing")}
            onRejectItem={(orderId, item) =>
              setRejectModal({ orderId, orderItemId: item.id, itemName: item.itemName })
            }
            onUpdateQuantity={handleEditQuantity}
            onPrintTicket={btSupported ? handlePrintTicket : undefined}
            editingOrderId={editingOrderId}
            editedItems={editedItems}
            onStartEdit={startEditing}
            onCancelEdit={cancelEditing}
            onSaveEdit={saveEditing}
            savingEdit={savingEdit}
            showModHistory={showModHistory}
            modHistory={modHistory}
            modHistoryLoading={modHistoryLoading}
            onToggleModHistory={fetchModificationHistory}
            menuItems={displayMenuItems}
            menuCategories={kitchenCategories}
            onAddItemToOrder={addItemToOrder}
          />
          <OrderColumn
            title="Preparing"
            orders={preparingOrders}
            color="blue"
            actionLabel="MARK READY"
            actionColor="bg-blue-600 hover:bg-blue-500 text-white"
            bulkActionLabel="MARK ALL READY"
            onBulkAction={() => updateAllStatuses(preparingOrders, "ready")}
            bulkActionDisabled={bulkUpdatingStatus !== null}
            onAction={(id) => updateStatus(id, "ready")}
            onRejectItem={(orderId, item) =>
              setRejectModal({ orderId, orderItemId: item.id, itemName: item.itemName })
            }
            onUpdateQuantity={handleEditQuantity}
            editingOrderId={editingOrderId}
            editedItems={editedItems}
            onStartEdit={startEditing}
            onCancelEdit={cancelEditing}
            onSaveEdit={saveEditing}
            savingEdit={savingEdit}
            showModHistory={showModHistory}
            modHistory={modHistory}
            modHistoryLoading={modHistoryLoading}
            onToggleModHistory={fetchModificationHistory}
            menuItems={displayMenuItems}
            menuCategories={kitchenCategories}
            onAddItemToOrder={addItemToOrder}
          />
          <OrderColumn
            title="Ready for Pickup"
            orders={readyOrders}
            color="emerald"
            actionLabel="MARK SERVED"
            actionColor="bg-gray-700 hover:bg-gray-600 text-white"
            bulkActionLabel="MARK ALL SERVED"
            onBulkAction={() => updateAllStatuses(readyOrders, "served")}
            bulkActionDisabled={bulkUpdatingStatus !== null}
            onAction={(id) => updateStatus(id, "served")}
            onRejectItem={(orderId, item) =>
              setRejectModal({ orderId, orderItemId: item.id, itemName: item.itemName })
            }
            onUpdateQuantity={handleEditQuantity}
            editingOrderId={editingOrderId}
            editedItems={editedItems}
            onStartEdit={startEditing}
            onCancelEdit={cancelEditing}
            onSaveEdit={saveEditing}
            savingEdit={savingEdit}
            showModHistory={showModHistory}
            modHistory={modHistory}
            modHistoryLoading={modHistoryLoading}
            onToggleModHistory={fetchModificationHistory}
            menuItems={displayMenuItems}
            menuCategories={kitchenCategories}
            onAddItemToOrder={addItemToOrder}
          />
        </div>

        {/* Mobile: Tab content */}
        <div className="md:hidden">
          {mobileTab === "new" && (
            <OrderColumn
              title="New Orders"
              orders={placedOrders}
              color="amber"
              actionLabel="START PREPARING"
              actionColor="bg-emerald-600 hover:bg-emerald-500 text-white"
              bulkActionLabel="START ALL"
              onBulkAction={() => updateAllStatuses(placedOrders, "preparing")}
              bulkActionDisabled={bulkUpdatingStatus !== null}
              onAction={(id) => updateStatus(id, "preparing")}
              onRejectItem={(orderId, item) =>
                setRejectModal({ orderId, orderItemId: item.id, itemName: item.itemName })
              }
              onUpdateQuantity={handleEditQuantity}
              onPrintTicket={btSupported ? handlePrintTicket : undefined}
              editingOrderId={editingOrderId}
              editedItems={editedItems}
              onStartEdit={startEditing}
              onCancelEdit={cancelEditing}
              onSaveEdit={saveEditing}
              savingEdit={savingEdit}
              showModHistory={showModHistory}
              modHistory={modHistory}
              modHistoryLoading={modHistoryLoading}
              onToggleModHistory={fetchModificationHistory}
              menuItems={displayMenuItems}
              menuCategories={kitchenCategories}
              onAddItemToOrder={addItemToOrder}
            />
          )}
          {mobileTab === "preparing" && (
            <OrderColumn
              title="Preparing"
              orders={preparingOrders}
              color="blue"
              actionLabel="MARK READY"
              actionColor="bg-blue-600 hover:bg-blue-500 text-white"
              bulkActionLabel="MARK ALL READY"
              onBulkAction={() => updateAllStatuses(preparingOrders, "ready")}
              bulkActionDisabled={bulkUpdatingStatus !== null}
              onAction={(id) => updateStatus(id, "ready")}
              onRejectItem={(orderId, item) =>
                setRejectModal({ orderId, orderItemId: item.id, itemName: item.itemName })
              }
              onUpdateQuantity={handleEditQuantity}
              editingOrderId={editingOrderId}
              editedItems={editedItems}
              onStartEdit={startEditing}
              onCancelEdit={cancelEditing}
              onSaveEdit={saveEditing}
              savingEdit={savingEdit}
              showModHistory={showModHistory}
              modHistory={modHistory}
              modHistoryLoading={modHistoryLoading}
              onToggleModHistory={fetchModificationHistory}
              menuItems={displayMenuItems}
              menuCategories={kitchenCategories}
              onAddItemToOrder={addItemToOrder}
            />
          )}
          {mobileTab === "ready" && (
            <OrderColumn
              title="Ready for Pickup"
              orders={readyOrders}
              color="emerald"
              actionLabel="MARK SERVED"
              actionColor="bg-gray-700 hover:bg-gray-600 text-white"
              bulkActionLabel="MARK ALL SERVED"
              onBulkAction={() => updateAllStatuses(readyOrders, "served")}
              bulkActionDisabled={bulkUpdatingStatus !== null}
              onAction={(id) => updateStatus(id, "served")}
              onRejectItem={(orderId, item) =>
                setRejectModal({ orderId, orderItemId: item.id, itemName: item.itemName })
              }
              onUpdateQuantity={handleEditQuantity}
              editingOrderId={editingOrderId}
              editedItems={editedItems}
              onStartEdit={startEditing}
              onCancelEdit={cancelEditing}
              onSaveEdit={saveEditing}
              savingEdit={savingEdit}
              showModHistory={showModHistory}
              modHistory={modHistory}
              modHistoryLoading={modHistoryLoading}
              onToggleModHistory={fetchModificationHistory}
              menuItems={displayMenuItems}
              menuCategories={kitchenCategories}
              onAddItemToOrder={addItemToOrder}
            />
          )}
        </div>

        {orders.length === 0 && (
          <div className="flex flex-col items-center justify-center py-24 text-gray-400">
            <UtensilsCrossedIcon className="mb-4 h-12 w-12" />
            <p className="text-lg font-medium">No active orders</p>
            <p className="text-sm">Orders will appear here automatically</p>
          </div>
        )}
      </div>

      {/* Reject Modal */}
      <AnimatePresence>
        {rejectModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
            onClick={() => setRejectModal(null)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="w-full min-w-0 max-w-sm rounded-2xl border border-gray-200 dark:border-border bg-white dark:bg-card p-6 shadow-xl dark:shadow-none"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-4 flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-50 dark:bg-red-950">
                  <AlertTriangleIcon className="h-5 w-5 text-red-500" />
                </div>
                <div>
                  <h3 className="font-semibold text-gray-900 dark:text-gray-100">Reject Item</h3>
                  <p className="text-sm text-gray-500 dark:text-gray-400">{rejectModal.itemName}</p>
                </div>
              </div>

              <div className="space-y-2">
                {REJECT_REASONS.map((reason) => (
                  <button
                    key={reason}
                    type="button"
                    onClick={() => setRejectReason(reason)}
                    className={`w-full rounded-lg px-4 py-3 text-left text-sm font-medium transition-colors ${
                      rejectReason === reason
                        ? "bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-400 ring-1 ring-red-300 dark:ring-red-800"
                        : "bg-gray-100 dark:bg-muted text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-accent"
                    }`}
                  >
                    {reason}
                  </button>
                ))}
              </div>

              {rejectReason === "Other" && (
                <input
                  type="text"
                  value={rejectCustom}
                  onChange={(e) => setRejectCustom(e.target.value)}
                  placeholder="Enter reason..."
                  autoFocus
                  className="mt-3 w-full rounded-lg border border-gray-300 dark:border-white/15 bg-white dark:bg-muted px-4 py-3 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500"
                />
              )}

              <div className="mt-4 flex gap-3">
                <button
                  type="button"
                  onClick={() => setRejectModal(null)}
                  className="flex-1 rounded-lg bg-gray-100 dark:bg-muted py-3 text-sm font-medium text-gray-600 dark:text-gray-400 transition-colors hover:bg-gray-200 dark:hover:bg-accent"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleReject}
                  disabled={rejectLoading || (rejectReason === "Other" && !rejectCustom.trim())}
                  className="flex-1 rounded-lg bg-red-600 py-3 text-sm font-semibold text-white transition-colors hover:bg-red-500 disabled:opacity-50"
                >
                  {rejectLoading ? "Rejecting..." : "Reject Item"}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ——— Order Column ——— */

function OrderColumn({
  title,
  orders,
  color,
  actionLabel,
  actionColor,
  bulkActionLabel,
  onBulkAction,
  bulkActionDisabled,
  onAction,
  onRejectItem,
  onUpdateQuantity,
  onPrintTicket,
  editingOrderId,
  editedItems,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  savingEdit,
  showModHistory,
  modHistory,
  modHistoryLoading,
  onToggleModHistory,
  menuItems,
  menuCategories,
  onAddItemToOrder,
}: {
  title: string;
  orders: Order[];
  color: "amber" | "blue" | "emerald";
  actionLabel: string;
  actionColor: string;
  bulkActionLabel: string;
  onBulkAction: () => void;
  bulkActionDisabled: boolean;
  onAction: (orderId: number) => void;
  onRejectItem: (orderId: number, item: OrderItem) => void;
  onUpdateQuantity: (orderId: number, item: OrderItem, delta: number) => void;
  onPrintTicket?: (order: Order) => Promise<void>;
  editingOrderId: number | null;
  editedItems: Map<number, Map<number, LocalItemChange>>;
  onStartEdit: (orderId: number) => void;
  onCancelEdit: () => void;
  onSaveEdit: () => void;
  savingEdit: boolean;
  showModHistory: number | null;
  modHistory: OrderModification[];
  modHistoryLoading: boolean;
  onToggleModHistory: (orderId: number) => void;
  menuItems: MenuItem[];
  menuCategories: KitchenCategory[];
  onAddItemToOrder: (orderId: number, menuItemId: number, quantity: number) => Promise<void>;
}) {
  const borderColor =
    color === "amber"
      ? "border-amber-400"
      : color === "blue"
        ? "border-blue-400"
        : "border-emerald-400";

  const headerBg =
    color === "amber"
      ? "bg-amber-50 dark:bg-amber-950 text-amber-700 dark:text-amber-400"
      : color === "blue"
        ? "bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-400"
        : "bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-400";

  const badgeBg =
    color === "amber"
      ? "bg-amber-500 text-white"
      : color === "blue"
        ? "bg-blue-500 text-white"
        : "bg-emerald-500 text-white";

  return (
    <div className="flex flex-col">
      <div
        className={`mb-3 flex items-center justify-between rounded-xl px-4 py-2.5 shadow-sm dark:shadow-none ${headerBg}`}
      >
        <span className="text-sm font-bold">{title}</span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onBulkAction}
            disabled={orders.length === 0 || bulkActionDisabled}
            className="rounded-md bg-white/80 px-2 py-1 text-[10px] font-bold text-gray-700 shadow-sm transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-50 dark:bg-black/20 dark:text-gray-200 dark:hover:bg-black/30"
          >
            {bulkActionLabel}
          </button>
          <motion.span
            key={orders.length}
            initial={{ scale: 1.3 }}
            animate={{ scale: 1 }}
            className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${badgeBg}`}
          >
            {orders.length}
          </motion.span>
        </div>
      </div>

      <div className="space-y-3">
        <AnimatePresence mode="popLayout">
          {orders.map((order) => (
            <OrderCard
              key={order.id}
              order={order}
              borderColor={borderColor}
              actionLabel={actionLabel}
              actionColor={actionColor}
              onAction={() => onAction(order.id)}
              onRejectItem={(item) => onRejectItem(order.id, item)}
              onUpdateQuantity={(item, delta) => onUpdateQuantity(order.id, item, delta)}
              isReadyColumn={color === "emerald"}
              onPrintTicket={onPrintTicket ? () => onPrintTicket(order) : undefined}
              isEditing={editingOrderId === order.id}
              editedItemChanges={editedItems.get(order.id)}
              onStartEdit={() => onStartEdit(order.id)}
              onCancelEdit={onCancelEdit}
              onSaveEdit={onSaveEdit}
              savingEdit={savingEdit}
              showModHistory={showModHistory === order.id}
              modHistory={showModHistory === order.id ? modHistory : []}
              modHistoryLoading={modHistoryLoading && showModHistory === order.id}
              onToggleModHistory={() => onToggleModHistory(order.id)}
              menuItems={menuItems}
              menuCategories={menuCategories}
              onAddItemToOrder={(menuItemId, qty) => onAddItemToOrder(order.id, menuItemId, qty)}
            />
          ))}
        </AnimatePresence>

        {orders.length === 0 && (
          <p className="py-8 text-center text-sm text-gray-400">No orders</p>
        )}
      </div>
    </div>
  );
}

/* ——— Order Card ——— */

function OrderCard({
  order,
  borderColor,
  actionLabel,
  actionColor,
  onAction,
  onRejectItem,
  onUpdateQuantity,
  isReadyColumn,
  onPrintTicket,
  isEditing,
  editedItemChanges,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  savingEdit,
  showModHistory,
  modHistory,
  modHistoryLoading,
  onToggleModHistory,
  menuItems,
  menuCategories,
  onAddItemToOrder,
}: {
  order: Order;
  borderColor: string;
  actionLabel: string;
  actionColor: string;
  onAction: () => void;
  onRejectItem: (item: OrderItem) => void;
  onUpdateQuantity: (item: OrderItem, delta: number) => void;
  isReadyColumn: boolean;
  onPrintTicket?: () => Promise<void>;
  isEditing: boolean;
  editedItemChanges?: Map<number, LocalItemChange>;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: () => void;
  savingEdit: boolean;
  showModHistory: boolean;
  modHistory: OrderModification[];
  modHistoryLoading: boolean;
  onToggleModHistory: () => void;
  menuItems: MenuItem[];
  menuCategories: KitchenCategory[];
  onAddItemToOrder: (menuItemId: number, quantity: number) => Promise<void>;
}) {
  const [loading, setLoading] = useState(false);
  const [printLoading, setPrintLoading] = useState(false);
  const [showAddItem, setShowAddItem] = useState(false);
  const [addItemSearch, setAddItemSearch] = useState("");
  const [addItemCategory, setAddItemCategory] = useState<number | null>(null);
  const [addingItem, setAddingItem] = useState(false);

  const addItemResults = useMemo(() => {
    if (!showAddItem) return [];
    const available = menuItems.filter((m) => m.isAvailable === 1);
    if (addItemSearch.trim()) {
      const q = addItemSearch.toLowerCase().trim();
      return available.filter(
        (m) => m.name.toLowerCase().includes(q) || (m.nameKannada && m.nameKannada.toLowerCase().includes(q))
      );
    }
    if (addItemCategory) return available.filter((m) => m.categoryId === addItemCategory);
    return available;
  }, [showAddItem, menuItems, addItemSearch, addItemCategory]);

  const handleAddItem = async (item: MenuItem) => {
    setAddingItem(true);
    try {
      await onAddItemToOrder(item.id, 1);
      setShowAddItem(false);
      setAddItemSearch("");
      setAddItemCategory(null);
    } finally {
      setAddingItem(false);
    }
  };

  const handleAction = async () => {
    setLoading(true);
    await onAction();
    setLoading(false);
  };

  const elapsed = useElapsed(order.createdAt);
  const activeItems = order.items.filter((i) => i.status !== "voided");
  const voidedItems = order.items.filter((i) => i.status === "voided");
  const kannadaMap = useMemo(() => {
    const m = new Map<number, string>();
    for (const mi of menuItems) { if (mi.nameKannada) m.set(mi.id, mi.nameKannada); }
    return m;
  }, [menuItems]);

  const getDisplayQty = (item: OrderItem) => {
    if (!isEditing || !editedItemChanges) return item.quantity;
    const change = editedItemChanges.get(item.id);
    return change ? change.newQty : item.quantity;
  };

  const createdByLabel = order.createdBy.startsWith("staff:")
    ? `Ordered by: ${order.createdBy}`
    : order.createdBy === "admin" || order.createdBy === "Admin"
      ? "Ordered by: Admin"
      : order.createdBy === "guest"
        ? "Ordered by: Guest"
        : `Ordered by: ${order.createdBy}`;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ type: "spring", stiffness: 300, damping: 25 }}
      className={`rounded-xl border border-gray-200 dark:border-border border-l-4 bg-white dark:bg-card shadow-sm dark:shadow-none transition-shadow duration-200 hover:shadow-md dark:hover:shadow-none ${borderColor}`}
    >
      <div className="p-4">
        {/* Header row */}
        <div className="mb-3 flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xl font-bold tracking-tight text-gray-900 dark:text-gray-100">
                #{order.orderNumber}
              </span>
              {order.hasModifications && (
                <span className="rounded-full bg-amber-100 dark:bg-amber-900/50 px-2 py-0.5 text-xs font-semibold text-amber-700 dark:text-amber-400">
                  Modified
                </span>
              )}
              {!isEditing && (
                <button
                  type="button"
                  onClick={onStartEdit}
                  className="flex h-7 w-7 items-center justify-center rounded-full bg-gray-100 dark:bg-muted text-gray-500 dark:text-gray-400 transition-colors hover:bg-gray-200 dark:hover:bg-accent hover:text-gray-700 dark:hover:text-gray-300"
                  title="Edit order"
                >
                  <PencilIcon className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium text-gray-600 dark:text-gray-400">
                {order.guestName}
              </span>
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-bold uppercase tracking-wide ${
                  order.guestType === "hostel"
                    ? "bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-400"
                    : "bg-gray-200 dark:bg-[#2a2a2a] text-gray-600 dark:text-gray-400"
                }`}
              >
                {order.guestType === "hostel" ? "Hostel" : "Walk-in"}
              </span>
              <span className="rounded-full bg-indigo-50 dark:bg-indigo-950 px-2 py-0.5 text-xs font-medium text-indigo-600 dark:text-indigo-400">
                {createdByLabel}
              </span>
            </div>
          </div>
          <TimeBadge minutes={elapsed} />
        </div>

        {/* Room / Table */}
        {(order.roomInfo || order.tableNumber) && (
          <div className="mb-2 text-xs text-gray-500">
            {order.roomInfo && <span>Room: {order.roomInfo}</span>}
            {order.roomInfo && order.tableNumber && <span> · </span>}
            {order.tableNumber && <span>Table: {order.tableNumber}</span>}
          </div>
        )}

        {/* Items */}
        <div className="mb-3 space-y-1">
          {activeItems.map((item) => {
            const itemTags = parseTags(item.tags);
            const displayQty = getDisplayQty(item);
            return (
            <div key={item.id} className="flex min-w-0 flex-wrap items-center justify-between gap-1">
              <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm">
                {isEditing ? (
                  <div className="flex items-center gap-0.5">
                    <button
                      type="button"
                      onClick={() => onUpdateQuantity(item, -1)}
                      className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-gray-100 dark:bg-muted text-gray-600 dark:text-gray-400 transition-colors hover:bg-gray-200 dark:hover:bg-accent"
                      title="Decrease quantity"
                    >
                      <MinusIcon className="h-3 w-3" />
                    </button>
                    <span className={`min-w-[1.5rem] text-center font-bold ${displayQty !== item.quantity ? "text-orange-600" : "text-amber-600"}`}>
                      {displayQty}
                    </span>
                    <button
                      type="button"
                      onClick={() => onUpdateQuantity(item, 1)}
                      className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-gray-100 dark:bg-muted text-gray-600 dark:text-gray-400 transition-colors hover:bg-gray-200 dark:hover:bg-accent"
                      title="Increase quantity"
                    >
                      <PlusIcon className="h-3 w-3" />
                    </button>
                  </div>
                ) : (
                  <span className="min-w-[1.5rem] text-center font-bold text-amber-600">{item.quantity}</span>
                )}
                <span className={`min-w-0 text-gray-800 dark:text-gray-200 ${displayQty === 0 ? "line-through opacity-50" : ""}`}>
                  {item.itemName}
                  {kannadaMap.get(item.menuItemId) && (
                    <span className="ml-1.5 text-xs text-gray-400">{kannadaMap.get(item.menuItemId)}</span>
                  )}
                </span>
                {itemTags.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {itemTags.map((tag) => (
                      <span
                        key={tag}
                        className={`rounded-full px-1.5 py-0.5 text-xs font-medium ${TAG_COLORS[tag.toLowerCase()] || "bg-gray-100 dark:bg-muted text-gray-500 dark:text-gray-400"}`}
                      >
                        {tagDisplayName(tag)}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              {isEditing && (
                <button
                  type="button"
                  onClick={() => onRejectItem(item)}
                  className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-red-50 dark:bg-red-950 text-red-500 transition-all hover:bg-red-100 dark:hover:bg-red-900/50"
                  title="Reject item"
                >
                  <XIcon className="h-4 w-4" />
                </button>
              )}
            </div>
            );
          })}
          {voidedItems.length > 0 && (
            <div className="mt-1 border-t border-gray-200 dark:border-white/10 pt-1">
              {voidedItems.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center gap-2 text-sm text-gray-400 line-through"
                >
                  <span>{item.quantity}x</span>
                  <span>{item.itemName}{kannadaMap.get(item.menuItemId) ? ` ${kannadaMap.get(item.menuItemId)}` : ""}</span>
                  <span className="text-xs text-red-400">REJECTED</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Edit mode: Add Item + Save/Cancel bar */}
        {isEditing && (
          <>
            {!showAddItem ? (
              <button
                type="button"
                onClick={() => {
                  setShowAddItem(true);
                  if (menuCategories.length > 0 && !addItemCategory) setAddItemCategory(menuCategories[0].id);
                }}
                className="mb-2 flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-gray-300 dark:border-white/15 px-3 py-2 text-sm font-medium text-gray-600 dark:text-gray-400 transition-colors hover:border-emerald-400 hover:text-emerald-600"
              >
                <PlusIcon className="h-4 w-4" /> Add Item
              </button>
            ) : (
              <div className="mb-3 rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-950/50 p-2.5">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">Add Item to Order</span>
                  <button type="button" onClick={() => { setShowAddItem(false); setAddItemSearch(""); setAddItemCategory(null); }} className="text-gray-400 hover:text-gray-600">
                    <XIcon className="h-3.5 w-3.5" />
                  </button>
                </div>
                <input
                  type="text"
                  value={addItemSearch}
                  onChange={(e) => setAddItemSearch(e.target.value)}
                  placeholder="Search menu items..."
                  className="mb-2 w-full rounded-md border border-gray-200 dark:border-white/10 bg-white dark:bg-muted px-3 py-1.5 text-sm dark:text-foreground outline-none focus:border-emerald-300 focus:ring-1 focus:ring-emerald-200 dark:focus:ring-emerald-500/30"
                />
                {!addItemSearch.trim() && (
                  <div className="mb-2 flex flex-wrap gap-1">
                    {menuCategories.map((cat) => (
                      <button
                        key={cat.id}
                        type="button"
                        onClick={() => setAddItemCategory(cat.id)}
                        className={`rounded-md px-2 py-1 text-xs font-medium transition-colors ${
                          addItemCategory === cat.id
                            ? "bg-emerald-600 text-white"
                            : "bg-gray-100 dark:bg-muted text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-accent"
                        }`}
                      >
                        {cat.icon} {cat.name}
                      </button>
                    ))}
                  </div>
                )}
                <div className="max-h-40 overflow-y-auto space-y-1">
                  {addItemResults.length === 0 ? (
                    <p className="py-2 text-center text-xs text-gray-400">No items found</p>
                  ) : (
                    addItemResults.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        disabled={addingItem}
                        onClick={() => handleAddItem(item)}
                        className="flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left text-sm hover:bg-emerald-100 dark:hover:bg-emerald-900/50 disabled:opacity-50"
                      >
                        <span className="text-gray-800 dark:text-gray-200">{item.name}</span>
                        <span className="flex-shrink-0 text-xs text-gray-500">₹{(item.price / 100).toFixed(0)}</span>
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}
            <div className="mb-3 flex gap-2">
              <button
                type="button"
                onClick={onSaveEdit}
                disabled={savingEdit}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-500 disabled:opacity-50"
              >
                <SaveIcon className="h-3.5 w-3.5" />
                {savingEdit ? "Saving..." : "Save"}
              </button>
              <button
                type="button"
                onClick={onCancelEdit}
                disabled={savingEdit}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-gray-200 dark:bg-[#2a2a2a] px-3 py-2.5 text-sm font-semibold text-gray-700 dark:text-gray-300 transition-colors hover:bg-gray-300 dark:hover:bg-[#333] disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </>
        )}

        {/* Special instructions */}
        {order.specialInstructions && (
          <div className="mb-3 rounded-lg bg-yellow-50 dark:bg-yellow-950 px-3 py-2 text-sm text-yellow-800 dark:text-yellow-300">
            <span className="mr-1 font-semibold">Note:</span>
            {order.specialInstructions}
          </div>
        )}

        {/* Ready column shows name prominently for callout */}
        {isReadyColumn && (
          <div className="mb-3 rounded-lg bg-emerald-50 dark:bg-emerald-950 px-3 py-2 text-center">
            <span className="text-lg font-bold text-emerald-700 dark:text-emerald-400">
              {order.guestName}
            </span>
          </div>
        )}

        {/* Modification History toggle */}
        {order.hasModifications && (
          <div className="mb-3">
            <button
              type="button"
              onClick={onToggleModHistory}
              className="flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-400 hover:text-amber-800 dark:hover:text-amber-300"
            >
              <HistoryIcon className="h-3.5 w-3.5" />
              {showModHistory ? "Hide" : "Show"} Modification History
              {showModHistory ? <ChevronUpIcon className="h-3 w-3" /> : <ChevronDownIcon className="h-3 w-3" />}
            </button>
            {showModHistory && (
              <div className="mt-2 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/50 p-2">
                {modHistoryLoading ? (
                  <p className="text-xs text-gray-500">Loading...</p>
                ) : modHistory.length === 0 ? (
                  <p className="text-xs text-gray-500">No modifications found</p>
                ) : (
                  <div className="space-y-1.5">
                    {modHistory.map((mod, idx) => (
                      <div key={idx} className="flex flex-col gap-0.5 border-b border-amber-100 pb-1.5 last:border-0 last:pb-0">
                        <span className="text-xs text-gray-800 dark:text-gray-200">
                          {formatModification(mod)}
                        </span>
                        <span className="text-xs text-gray-400">
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

        {/* Print ticket button */}
        {onPrintTicket && !isEditing && (
          <button
            type="button"
            onClick={async () => {
              setPrintLoading(true);
              try { await onPrintTicket(); } catch {} finally { setPrintLoading(false); }
            }}
            disabled={printLoading}
            className="mb-2 flex w-full items-center justify-center gap-1.5 rounded-lg border border-gray-300 dark:border-white/15 px-3 py-2.5 text-xs font-medium text-gray-600 dark:text-gray-400 transition hover:bg-gray-50 dark:hover:bg-muted disabled:opacity-50"
          >
            <PrinterIcon className="h-3.5 w-3.5" />
            {printLoading ? "Printing..." : "Print Ticket"}
          </button>
        )}

        {/* Action button */}
        {!isEditing && (
          <button
            type="button"
            onClick={handleAction}
            disabled={loading}
            className={`w-full rounded-xl py-3.5 text-sm font-bold uppercase tracking-wide transition-all active:scale-[0.98] disabled:opacity-50 ${actionColor}`}
            style={{ minHeight: 48 }}
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                Updating...
              </span>
            ) : (
              actionLabel
            )}
          </button>
        )}
      </div>
    </motion.div>
  );
}

function formatModification(mod: OrderModification): string {
  const actor = mod.modifiedBy.charAt(0).toUpperCase() + mod.modifiedBy.slice(1);
  switch (mod.action) {
    case "quantity_changed":
      return `${actor} changed ${mod.itemName} qty from ${mod.oldValue} to ${mod.newValue}`;
    case "item_removed":
      return `${actor} removed ${mod.itemName}`;
    case "item_voided":
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

/* ——— Time Badge ——— */

function TimeBadge({ minutes }: { minutes: number }) {
  const label =
    minutes < 1
      ? "Just now"
      : minutes < 60
        ? `${minutes}m`
        : `${Math.floor(minutes / 60)}h${minutes % 60}m`;

  const colorClass =
    minutes < 5
      ? "bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-400"
      : minutes < 15
        ? "bg-yellow-100 dark:bg-yellow-900/50 text-yellow-700 dark:text-yellow-400"
        : "bg-red-100 dark:bg-red-900/50 text-red-700 dark:text-red-400";

  const shouldPulse = minutes >= 5;

  return (
    <span
      className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold ${colorClass}`}
    >
      <ClockIcon className={`h-3 w-3 ${shouldPulse ? "animate-pulse" : ""}`} />
      {label}
    </span>
  );
}

/* ——— useElapsed hook ——— */

function useElapsed(createdAt: string): number {
  const [minutes, setMinutes] = useState(() => calcMinutes(createdAt));

  useEffect(() => {
    const id = setInterval(() => setMinutes(calcMinutes(createdAt)), 15_000);
    return () => clearInterval(id);
  }, [createdAt]);

  return minutes;
}

function calcMinutes(iso: string): number {
  const created = new Date(iso);
  if (isNaN(created.getTime())) return 0;
  return Math.max(0, Math.floor((Date.now() - created.getTime()) / 60_000));
}
