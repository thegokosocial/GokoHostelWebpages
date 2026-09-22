"use client";

import { useState, useEffect, useCallback } from "react";
import { useAdminToast } from "@/components/admin/AdminToast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AdminLoading } from "./AdminLoading";
import { cn } from "@/lib/utils";
import { SaveIcon, RefreshCwIcon, PlusIcon, XIcon } from "lucide-react";
import type { Role } from "./types";
import { parseKitchenHours, slotsToString } from "@/lib/kitchenHours";

type FoodSettings = {
  food_kitchen_whatsapp: string;
  food_tax_rate: string;
  food_kitchen_hours: string;
  food_tab_limit: string;
  food_checkout_grace_days: string;
  food_cafe_tables: string;
  food_confirm_with_guest: string;
  food_payment_history_days: string;
  food_kannada_kitchen_print: string;
  food_kannada_kitchen_display: string;
  food_approval_in_kitchen: string;
  food_kitchen_busy: string;
  food_customer_whatsapp: string;
  food_show_out_of_stock: string;
};

const DEFAULT_SETTINGS: FoodSettings = {
  food_kitchen_whatsapp: "",
  food_tax_rate: "5",
  food_kitchen_hours: "08:00-15:00,18:00-23:30",
  food_tab_limit: "0",
  food_checkout_grace_days: "10",
  food_cafe_tables: "6",
  food_confirm_with_guest: "false",
  food_payment_history_days: "7",
  food_kannada_kitchen_print: "true",
  food_kannada_kitchen_display: "true",
  food_approval_in_kitchen: "false",
  food_kitchen_busy: "false",
  food_customer_whatsapp: "true",
  food_show_out_of_stock: "false",
};

function paiseToRupees(paise: string): string {
  const p = parseInt(paise) || 0;
  if (p === 0) return "0";
  return (p / 100).toFixed(2).replace(/\.00$/, "");
}

function rupeesToPaise(rupees: string): string {
  const num = parseFloat(rupees.replace(/[^\d.]/g, ""));
  if (isNaN(num)) return "0";
  return String(Math.round(num * 100));
}

export function AdminFoodSettings({ password, username, role }: { password: string; username?: string; role: Role }) {
  const { showError } = useAdminToast();
  const [settings, setSettings] = useState<FoodSettings>({ ...DEFAULT_SETTINGS });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [savedSettings, setSavedSettings] = useState<FoodSettings>({ ...DEFAULT_SETTINGS });

  const apiCall = useCallback(async (body: Record<string, any>) => {
    const payload: Record<string, any> = { password, ...body };
    if (username) payload.username = username;
    return fetch("/api/admin/food", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  }, [password, username]);

  const loadSettings = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiCall({ action: "getFoodSettings" });
      if (res.ok) {
        const data = await res.json();
        const s = data.settings || {};
        let kitchenHours = s.food_kitchen_hours || "";
        if (!kitchenHours && s.food_kitchen_open && s.food_kitchen_close) {
          kitchenHours = `${s.food_kitchen_open}-${s.food_kitchen_close}`;
        }
        const merged: FoodSettings = {
          food_kitchen_whatsapp: s.food_kitchen_whatsapp || DEFAULT_SETTINGS.food_kitchen_whatsapp,
          food_tax_rate: s.food_tax_rate != null && s.food_tax_rate !== "" ? String(s.food_tax_rate) : DEFAULT_SETTINGS.food_tax_rate,
          food_kitchen_hours: kitchenHours || DEFAULT_SETTINGS.food_kitchen_hours,
          food_tab_limit: s.food_tab_limit || DEFAULT_SETTINGS.food_tab_limit,
          food_checkout_grace_days: s.food_checkout_grace_days || DEFAULT_SETTINGS.food_checkout_grace_days,
          food_cafe_tables: s.food_cafe_tables || DEFAULT_SETTINGS.food_cafe_tables,
          food_confirm_with_guest: s.food_confirm_with_guest ?? DEFAULT_SETTINGS.food_confirm_with_guest,
          food_payment_history_days: s.food_payment_history_days || DEFAULT_SETTINGS.food_payment_history_days,
          food_kannada_kitchen_print: s.food_kannada_kitchen_print ?? DEFAULT_SETTINGS.food_kannada_kitchen_print,
          food_kannada_kitchen_display: s.food_kannada_kitchen_display ?? DEFAULT_SETTINGS.food_kannada_kitchen_display,
          food_approval_in_kitchen: s.food_approval_in_kitchen ?? DEFAULT_SETTINGS.food_approval_in_kitchen,
          food_kitchen_busy: s.food_kitchen_busy || DEFAULT_SETTINGS.food_kitchen_busy,
          food_customer_whatsapp: s.food_customer_whatsapp ?? DEFAULT_SETTINGS.food_customer_whatsapp,
          food_show_out_of_stock: s.food_show_out_of_stock ?? DEFAULT_SETTINGS.food_show_out_of_stock,
        };
        setSettings(merged);
        setSavedSettings(merged);
        setDirty(false);
      }
    } finally {
      setLoading(false);
    }
  }, [apiCall]);

  useEffect(() => { loadSettings(); }, [loadSettings]);

  const updateField = (key: keyof FoodSettings, value: string) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
  };

  const saveAll = async () => {
    setSaving(true);
    try {
      const res = await apiCall({
        action: "updateFoodSettings",
        settings: {
          ...settings,
        },
      });
      if (res.ok) {
        setSavedSettings({ ...settings });
        setDirty(false);
      } else {
        const d = await res.json();
        showError("Failed to save settings", d.error);
      }
    } finally {
      setSaving(false);
    }
  };

  const toggleBusyMode = async () => {
    const newValue = settings.food_kitchen_busy === "true" ? "false" : "true";
    setSaving(true);
    try {
      const res = await apiCall({
        action: "updateFoodSettings",
        settings: { food_kitchen_busy: newValue },
      });
      if (res.ok) {
        setSettings((prev) => ({ ...prev, food_kitchen_busy: newValue }));
        setSavedSettings((prev) => ({ ...prev, food_kitchen_busy: newValue }));
      } else {
        const d = await res.json();
        showError("Failed to toggle", d.error);
      }
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <AdminLoading message="Loading food settings..." />;

  const isBusy = settings.food_kitchen_busy === "true";
  const tabLimitRupees = paiseToRupees(settings.food_tab_limit);

  return (
    <div>
      <h2 className="font-display text-xl font-bold text-brand-green md:text-2xl">Food Settings</h2>
      <p className="mt-1 text-sm text-brand-green-dark/60">Configure kitchen hours, tax, and ordering settings.</p>

      {/* Kitchen Busy Mode - prominent toggle */}
      <div className={cn(
        "mt-6 rounded-2xl border p-5 shadow-card dark:shadow-none transition-colors",
        isBusy ? "border-red-300 bg-red-50 dark:bg-red-950" : "border-brand-mist bg-white dark:bg-card"
      )}>
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-display text-base font-bold text-brand-green-dark">Kitchen Busy Mode</h3>
            <p className="mt-0.5 text-xs text-brand-green-dark/50">
              {isBusy
                ? "Kitchen is BUSY — new orders are paused. Guests see a busy message."
                : "Kitchen is accepting orders normally."}
            </p>
          </div>
          <button
            type="button"
            onClick={toggleBusyMode}
            disabled={saving}
            className={cn(
              "relative inline-flex h-8 w-14 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none",
              isBusy ? "bg-red-500" : "bg-gray-200 dark:bg-[#2a2a2a]"
            )}
          >
            <span className={cn(
              "pointer-events-none inline-block h-7 w-7 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out",
              isBusy ? "translate-x-6" : "translate-x-0"
            )} />
          </button>
        </div>
      </div>

      {/* Customer WhatsApp Toggle */}
      <div className="mt-4 rounded-2xl border border-brand-mist bg-white dark:bg-card p-5 shadow-card dark:shadow-none">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-display text-base font-bold text-brand-green-dark">Customer WhatsApp Order</h3>
            <p className="mt-0.5 text-xs text-brand-green-dark/50">
              {settings.food_customer_whatsapp === "true"
                ? "Customers are prompted to send order via WhatsApp after placing."
                : "WhatsApp order sharing is disabled for customers."}
            </p>
          </div>
          <button
            type="button"
            onClick={async () => {
              const newValue = settings.food_customer_whatsapp === "true" ? "false" : "true";
              setSaving(true);
              try {
                const res = await apiCall({
                  action: "updateFoodSettings",
                  settings: { food_customer_whatsapp: newValue },
                });
                if (res.ok) {
                  setSettings((prev) => ({ ...prev, food_customer_whatsapp: newValue }));
                  setSavedSettings((prev) => ({ ...prev, food_customer_whatsapp: newValue }));
                }
              } catch {}
              setSaving(false);
            }}
            disabled={saving}
            className={cn(
              "relative inline-flex h-8 w-14 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none",
              settings.food_customer_whatsapp === "true" ? "bg-green-500" : "bg-gray-200 dark:bg-[#2a2a2a]"
            )}
          >
            <span className={cn(
              "pointer-events-none inline-block h-7 w-7 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out",
              settings.food_customer_whatsapp === "true" ? "translate-x-6" : "translate-x-0"
            )} />
          </button>
        </div>
      </div>

      {/* Show Out of Stock Items Toggle */}
      <div className="mt-4 rounded-2xl border border-brand-mist bg-white dark:bg-card p-5 shadow-card dark:shadow-none">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-display text-base font-bold text-brand-green-dark">Show Out of Stock Items</h3>
            <p className="mt-0.5 text-xs text-brand-green-dark/50">
              {settings.food_show_out_of_stock === "true"
                ? "Out of stock items are shown greyed out on the guest menu."
                : "Out of stock items are hidden from the guest menu."}
            </p>
          </div>
          <button
            type="button"
            onClick={async () => {
              const newValue = settings.food_show_out_of_stock === "true" ? "false" : "true";
              setSaving(true);
              try {
                const res = await apiCall({
                  action: "updateFoodSettings",
                  settings: { food_show_out_of_stock: newValue },
                });
                if (res.ok) {
                  setSettings((prev) => ({ ...prev, food_show_out_of_stock: newValue }));
                  setSavedSettings((prev) => ({ ...prev, food_show_out_of_stock: newValue }));
                }
              } catch {}
              setSaving(false);
            }}
            disabled={saving}
            className={cn(
              "relative inline-flex h-8 w-14 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none",
              settings.food_show_out_of_stock === "true" ? "bg-green-500" : "bg-gray-200 dark:bg-[#2a2a2a]"
            )}
          >
            <span className={cn(
              "pointer-events-none inline-block h-7 w-7 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out",
              settings.food_show_out_of_stock === "true" ? "translate-x-6" : "translate-x-0"
            )} />
          </button>
        </div>
      </div>

      {/* Settings Form */}
      <div className="mt-6 rounded-2xl border border-brand-mist bg-white dark:bg-card p-5 shadow-card dark:shadow-none">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-display text-base font-bold text-brand-green-dark">Settings</h3>
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={loadSettings} disabled={loading}>
              <RefreshCwIcon className="mr-1 h-3.5 w-3.5" /> Reload
            </Button>
            <Button type="button" size="sm" onClick={saveAll} disabled={saving || !dirty}>
              <SaveIcon className="mr-1 h-3.5 w-3.5" /> Save All
            </Button>
          </div>
        </div>

        <div className="mt-5 space-y-5">
          {/* Kitchen WhatsApp */}
          <div className="grid gap-1.5 sm:grid-cols-3 sm:items-center">
            <div>
              <Label className="text-sm font-medium text-brand-green-dark">Kitchen WhatsApp Number</Label>
              <p className="text-[11px] text-brand-green-dark/40">For order notifications to kitchen staff</p>
            </div>
            <div className="sm:col-span-2">
              <Input
                value={settings.food_kitchen_whatsapp}
                onChange={(e) => updateField("food_kitchen_whatsapp", e.target.value)}
                placeholder="e.g. 919876543210"
                className="w-full sm:max-w-xs"
              />
            </div>
          </div>

          <hr className="border-brand-mist" />

          {/* Tax Rate */}
          <div className="grid gap-1.5 sm:grid-cols-3 sm:items-center">
            <div>
              <Label className="text-sm font-medium text-brand-green-dark">Tax Rate (%)</Label>
              <p className="text-[11px] text-brand-green-dark/40">Applied to food order subtotals</p>
            </div>
            <div className="sm:col-span-2">
              <div className="relative max-w-[120px]">
                <Input
                  type="number"
                  step="0.1"
                  min="0"
                  max="100"
                  value={settings.food_tax_rate}
                  onChange={(e) => updateField("food_tax_rate", e.target.value)}
                />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-brand-green-dark/40">%</span>
              </div>
            </div>
          </div>

          <hr className="border-brand-mist" />

          {/* Kitchen Hours - Multiple Slots */}
          <div className="grid gap-1.5 sm:grid-cols-3 sm:items-start">
            <div className="pt-1">
              <Label className="text-sm font-medium text-brand-green-dark">Kitchen Hours</Label>
              <p className="text-[11px] text-brand-green-dark/40">Orders only accepted during these hours</p>
            </div>
            <div className="space-y-2 sm:col-span-2">
              {parseKitchenHours(settings.food_kitchen_hours).map((slot, idx, arr) => (
                <div key={idx} className="flex flex-wrap items-center gap-2">
                  <Input
                    type="time"
                    value={slot.open}
                    onChange={(e) => {
                      const slots = parseKitchenHours(settings.food_kitchen_hours);
                      slots[idx] = { ...slots[idx], open: e.target.value };
                      updateField("food_kitchen_hours", slotsToString(slots));
                    }}
                    className="w-full sm:w-32"
                  />
                  <span className="text-xs text-brand-green-dark/40">to</span>
                  <Input
                    type="time"
                    value={slot.close}
                    onChange={(e) => {
                      const slots = parseKitchenHours(settings.food_kitchen_hours);
                      slots[idx] = { ...slots[idx], close: e.target.value };
                      updateField("food_kitchen_hours", slotsToString(slots));
                    }}
                    className="w-full sm:w-32"
                  />
                  {arr.length > 1 && (
                    <button
                      type="button"
                      onClick={() => {
                        const slots = parseKitchenHours(settings.food_kitchen_hours);
                        slots.splice(idx, 1);
                        updateField("food_kitchen_hours", slotsToString(slots));
                      }}
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-red-400 transition hover:bg-red-50 dark:hover:bg-red-950 hover:text-red-600"
                    >
                      <XIcon className="h-4 w-4" />
                    </button>
                  )}
                </div>
              ))}
              <button
                type="button"
                onClick={() => {
                  const slots = parseKitchenHours(settings.food_kitchen_hours);
                  slots.push({ open: "08:00", close: "22:00" });
                  updateField("food_kitchen_hours", slotsToString(slots));
                }}
                className="flex items-center gap-1 text-xs font-medium text-brand-green transition hover:text-brand-green-dark"
              >
                <PlusIcon className="h-3.5 w-3.5" /> Add Time Slot
              </button>
            </div>
          </div>

          <hr className="border-brand-mist" />

          {/* Tab Spending Limit */}
          <div className="grid gap-1.5 sm:grid-cols-3 sm:items-center">
            <div>
              <Label className="text-sm font-medium text-brand-green-dark">Tab Spending Limit</Label>
              <p className="text-[11px] text-brand-green-dark/40">Max tab amount per guest (0 = no limit)</p>
            </div>
            <div className="sm:col-span-2">
              <div className="relative max-w-[160px]">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-brand-green-dark/50">₹</span>
                <Input
                  type="number"
                  step="1"
                  min="0"
                  value={tabLimitRupees}
                  onChange={(e) => updateField("food_tab_limit", rupeesToPaise(e.target.value))}
                  className="pl-7"
                />
              </div>
              {parseInt(settings.food_tab_limit) > 0 && (
                <p className="mt-0.5 text-[10px] text-brand-green-dark/40">
                  Stored as {settings.food_tab_limit} paise
                </p>
              )}
            </div>
          </div>

          {/* Checkout Grace Period */}
          <div className="grid gap-1.5 sm:grid-cols-3 sm:items-center">
            <div>
              <Label className="text-sm font-medium text-brand-green-dark">Post-checkout Food Ordering</Label>
              <p className="text-[11px] text-brand-green-dark/40">Days after checkout a guest can still order on their tab (0 = disabled)</p>
            </div>
            <div className="sm:col-span-2">
              <div className="flex items-center gap-2 max-w-[160px]">
                <Input
                  type="number"
                  step="1"
                  min="0"
                  max="90"
                  value={settings.food_checkout_grace_days}
                  onChange={(e) => updateField("food_checkout_grace_days", e.target.value)}
                />
                <span className="text-sm text-brand-green-dark/50">days</span>
              </div>
            </div>
          </div>

          {/* Cafe Tables */}
          <div className="grid gap-1.5 sm:grid-cols-3 sm:items-center">
            <div>
              <Label className="text-sm font-medium text-brand-green-dark">Cafe Tables</Label>
              <p className="text-[11px] text-brand-green-dark/40">Number of dine-in tables for quick orders without guest details (0 = disabled)</p>
            </div>
            <div className="sm:col-span-2">
              <div className="flex items-center gap-2 max-w-[160px]">
                <Input
                  type="number"
                  step="1"
                  min="0"
                  max="20"
                  value={settings.food_cafe_tables}
                  onChange={(e) => updateField("food_cafe_tables", e.target.value)}
                />
                <span className="text-sm text-brand-green-dark/50">tables</span>
              </div>
            </div>
          </div>

          {/* Confirm with Guest */}
          <div className="grid gap-1.5 sm:grid-cols-3 sm:items-center">
            <div>
              <Label className="text-sm font-medium text-brand-green-dark">Confirm with Guest</Label>
              <p className="text-[11px] text-brand-green-dark/40">Ask staff to confirm the order with the guest before placing</p>
            </div>
            <div className="sm:col-span-2">
              <button
                type="button"
                onClick={async () => {
                  const newValue = settings.food_confirm_with_guest === "true" ? "false" : "true";
                  setSaving(true);
                  try {
                    const res = await apiCall({ action: "updateFoodSettings", settings: { food_confirm_with_guest: newValue } });
                    if (res.ok) { setSettings((prev) => ({ ...prev, food_confirm_with_guest: newValue })); setSavedSettings((prev) => ({ ...prev, food_confirm_with_guest: newValue })); }
                    else { const d = await res.json().catch(() => ({})); showError("Failed to toggle", d.error); }
                  } finally { setSaving(false); }
                }}
                disabled={saving}
                className={cn("relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full transition-colors duration-200", settings.food_confirm_with_guest === "true" ? "bg-brand-green" : "bg-brand-green-dark/20")}
              >
                <span className={cn("inline-block h-5 w-5 transform rounded-full bg-white shadow-md transition-transform duration-200 mt-0.5", settings.food_confirm_with_guest === "true" ? "translate-x-5" : "translate-x-0.5")} />
              </button>
            </div>
          </div>

          {/* Payment History Visibility */}
          <div className="grid gap-1.5 sm:grid-cols-3 sm:items-center">
            <div>
              <Label className="text-sm font-medium text-brand-green-dark">Paid Orders Visibility</Label>
              <p className="text-[11px] text-brand-green-dark/40">How many days of paid orders to show in Order Summary (unpaid always visible)</p>
            </div>
            <div className="sm:col-span-2">
              <div className="flex items-center gap-2 max-w-[160px]">
                <Input
                  type="number"
                  step="1"
                  min="1"
                  max="90"
                  value={settings.food_payment_history_days}
                  onChange={(e) => updateField("food_payment_history_days", e.target.value)}
                />
                <span className="text-sm text-brand-green-dark/50">days</span>
              </div>
            </div>
          </div>

          {/* Kannada in Kitchen Print */}
          <div className="grid gap-1.5 sm:grid-cols-3 sm:items-center">
            <div>
              <Label className="text-sm font-medium text-brand-green-dark">Kannada on Kitchen Ticket</Label>
              <p className="text-[11px] text-brand-green-dark/40">Print Kannada menu names on thermal kitchen tickets</p>
            </div>
            <div className="sm:col-span-2">
              <button
                type="button"
                onClick={async () => {
                  const newValue = settings.food_kannada_kitchen_print === "true" ? "false" : "true";
                  setSaving(true);
                  try {
                    const res = await apiCall({ action: "updateFoodSettings", settings: { food_kannada_kitchen_print: newValue } });
                    if (res.ok) { setSettings((prev) => ({ ...prev, food_kannada_kitchen_print: newValue })); setSavedSettings((prev) => ({ ...prev, food_kannada_kitchen_print: newValue })); }
                  } finally { setSaving(false); }
                }}
                disabled={saving}
                className={cn("relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full transition-colors duration-200", settings.food_kannada_kitchen_print === "true" ? "bg-brand-green" : "bg-brand-green-dark/20")}
              >
                <span className={cn("inline-block h-5 w-5 transform rounded-full bg-white shadow-md transition-transform duration-200 mt-0.5", settings.food_kannada_kitchen_print === "true" ? "translate-x-5" : "translate-x-0.5")} />
              </button>
            </div>
          </div>

          {/* Kannada in Kitchen Display */}
          <div className="grid gap-1.5 sm:grid-cols-3 sm:items-center">
            <div>
              <Label className="text-sm font-medium text-brand-green-dark">Kannada on Screen</Label>
              <p className="text-[11px] text-brand-green-dark/40">Show Kannada menu names in Active Orders and Kitchen page</p>
            </div>
            <div className="sm:col-span-2">
              <button
                type="button"
                onClick={async () => {
                  const newValue = settings.food_kannada_kitchen_display === "true" ? "false" : "true";
                  setSaving(true);
                  try {
                    const res = await apiCall({ action: "updateFoodSettings", settings: { food_kannada_kitchen_display: newValue } });
                    if (res.ok) { setSettings((prev) => ({ ...prev, food_kannada_kitchen_display: newValue })); setSavedSettings((prev) => ({ ...prev, food_kannada_kitchen_display: newValue })); }
                  } finally { setSaving(false); }
                }}
                disabled={saving}
                className={cn("relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full transition-colors duration-200", settings.food_kannada_kitchen_display === "true" ? "bg-brand-green" : "bg-brand-green-dark/20")}
              >
                <span className={cn("inline-block h-5 w-5 transform rounded-full bg-white shadow-md transition-transform duration-200 mt-0.5", settings.food_kannada_kitchen_display === "true" ? "translate-x-5" : "translate-x-0.5")} />
              </button>
            </div>
          </div>

          {/* Approval in Kitchen */}
          <div className="grid gap-1.5 sm:grid-cols-3 sm:items-center">
            <div>
              <Label className="text-sm font-medium text-brand-green-dark">Order Approval in Kitchen</Label>
              <p className="text-[11px] text-brand-green-dark/40">Allow kitchen staff to approve/reject guest orders (otherwise only from admin Order Summary)</p>
            </div>
            <div className="sm:col-span-2">
              <button
                type="button"
                onClick={async () => {
                  const newValue = settings.food_approval_in_kitchen === "true" ? "false" : "true";
                  setSaving(true);
                  try {
                    const res = await apiCall({ action: "updateFoodSettings", settings: { food_approval_in_kitchen: newValue } });
                    if (res.ok) { setSettings((prev) => ({ ...prev, food_approval_in_kitchen: newValue })); setSavedSettings((prev) => ({ ...prev, food_approval_in_kitchen: newValue })); }
                  } finally { setSaving(false); }
                }}
                disabled={saving}
                className={cn("relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full transition-colors duration-200", settings.food_approval_in_kitchen === "true" ? "bg-brand-green" : "bg-brand-green-dark/20")}
              >
                <span className={cn("inline-block h-5 w-5 transform rounded-full bg-white shadow-md transition-transform duration-200 mt-0.5", settings.food_approval_in_kitchen === "true" ? "translate-x-5" : "translate-x-0.5")} />
              </button>
            </div>
          </div>
        </div>

        {dirty && (
          <div className="mt-5 flex items-center gap-2 rounded-lg bg-amber-50 dark:bg-amber-950 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
            <span className="font-medium">Unsaved changes</span> — click Save All to apply.
          </div>
        )}
      </div>
    </div>
  );
}
