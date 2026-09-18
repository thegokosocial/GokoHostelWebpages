"use client";

import { useState, useEffect, useCallback } from "react";
import { useAdminToast } from "@/components/admin/AdminToast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AdminLoading } from "./AdminLoading";
import { SaveIcon, RefreshCwIcon, UploadIcon, Trash2Icon } from "lucide-react";
import { DEFAULT_BILL_BRANDING, parseAccentHex } from "@/lib/foodBillFormat";

type BillSettings = {
  food_bill_hostel_name: string;
  food_bill_location: string;
  food_bill_accent: string;
  food_bill_upi_id: string;
  food_bill_payment_qr_url: string;
  food_bill_footer: string;
};

const DEFAULTS: BillSettings = {
  food_bill_hostel_name: DEFAULT_BILL_BRANDING.hostelName,
  food_bill_location: DEFAULT_BILL_BRANDING.location,
  food_bill_accent: DEFAULT_BILL_BRANDING.accent,
  food_bill_upi_id: "",
  food_bill_payment_qr_url: "",
  food_bill_footer: DEFAULT_BILL_BRANDING.footer,
};

export function AdminBillSettings({ password, username }: { password: string; username?: string }) {
  const { showError, showSuccess } = useAdminToast();
  const [settings, setSettings] = useState<BillSettings>({ ...DEFAULTS });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [dirty, setDirty] = useState(false);

  const apiCall = useCallback(async (body: Record<string, unknown>) => {
    const payload: Record<string, unknown> = { password, ...body };
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
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load");
      const s = data.settings || {};
      setSettings({
        food_bill_hostel_name: s.food_bill_hostel_name || DEFAULTS.food_bill_hostel_name,
        food_bill_location: s.food_bill_location || DEFAULTS.food_bill_location,
        food_bill_accent: parseAccentHex(s.food_bill_accent),
        food_bill_upi_id: s.food_bill_upi_id || "",
        food_bill_payment_qr_url: s.food_bill_payment_qr_url || "",
        food_bill_footer: s.food_bill_footer || DEFAULTS.food_bill_footer,
      });
      setDirty(false);
    } catch (e: unknown) {
      showError(e instanceof Error ? e.message : "Failed to load bill settings");
    } finally {
      setLoading(false);
    }
  }, [apiCall, showError]);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const update = <K extends keyof BillSettings>(key: K, value: BillSettings[K]) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      const payload = {
        ...settings,
        food_bill_accent: parseAccentHex(settings.food_bill_accent),
      };
      const res = await apiCall({ action: "updateFoodSettings", settings: payload });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Save failed");
      showSuccess("Bill settings saved");
      setDirty(false);
      await loadSettings();
    } catch (e: unknown) {
      showError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const persistQrUrl = async (url: string) => {
    const res = await apiCall({
      action: "updateFoodSettings",
      settings: { food_bill_payment_qr_url: url },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Could not save QR");
    setSettings((prev) => ({ ...prev, food_bill_payment_qr_url: url }));
  };

  const uploadQr = async (file: File) => {
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("password", password);
      form.append("username", username || "");
      form.append("folder", "bills");
      const res = await fetch("/api/admin/website/upload", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed");
      await persistQrUrl(data.url);
      showSuccess("Payment QR saved");
    } catch (e: unknown) {
      showError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const clearQr = async () => {
    try {
      await persistQrUrl("");
      showSuccess("Payment QR removed");
    } catch (e: unknown) {
      showError(e instanceof Error ? e.message : "Could not remove QR");
    }
  };

  if (loading) return <AdminLoading />;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-bold text-brand-green md:text-2xl">Bill Settings</h2>
          <p className="mt-1 text-sm text-brand-green-dark/60 dark:text-zinc-400">
            Branding, UPI ID, and payment QR for guest food bills (PDF, thermal, My Bills).
          </p>
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={loadSettings} disabled={saving}>
            <RefreshCwIcon className="mr-2 h-4 w-4" /> Reload
          </Button>
          <Button type="button" variant="cta" onClick={save} disabled={saving || !dirty}>
            <SaveIcon className="mr-2 h-4 w-4" /> {saving ? "Saving…" : "Save All"}
          </Button>
        </div>
      </div>

      <div className="rounded-2xl border border-brand-mist bg-white p-4 shadow-sm dark:bg-card sm:p-5 space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="bill-hostel">Hostel name</Label>
            <Input
              id="bill-hostel"
              value={settings.food_bill_hostel_name}
              onChange={(e) => update("food_bill_hostel_name", e.target.value)}
              className="mt-1"
            />
          </div>
          <div>
            <Label htmlFor="bill-location">Location</Label>
            <Input
              id="bill-location"
              value={settings.food_bill_location}
              onChange={(e) => update("food_bill_location", e.target.value)}
              className="mt-1"
            />
          </div>
          <div>
            <Label htmlFor="bill-accent">Accent color</Label>
            <div className="mt-1 flex items-center gap-2">
              <input
                type="color"
                value={parseAccentHex(settings.food_bill_accent)}
                onChange={(e) => update("food_bill_accent", e.target.value.toUpperCase())}
                className="h-10 w-12 cursor-pointer rounded border border-brand-mist bg-transparent"
                aria-label="Accent color picker"
              />
              <Input
                id="bill-accent"
                value={settings.food_bill_accent}
                onChange={(e) => update("food_bill_accent", e.target.value)}
                placeholder="#E67E22"
                className="font-mono"
              />
            </div>
          </div>
          <div>
            <Label htmlFor="bill-upi">UPI ID</Label>
            <Input
              id="bill-upi"
              value={settings.food_bill_upi_id}
              onChange={(e) => update("food_bill_upi_id", e.target.value)}
              placeholder="9148973725@okbizaxis"
              className="mt-1"
            />
          </div>
        </div>

        <div>
          <Label htmlFor="bill-footer">Footer message</Label>
          <Input
            id="bill-footer"
            value={settings.food_bill_footer}
            onChange={(e) => update("food_bill_footer", e.target.value)}
            className="mt-1"
          />
        </div>

        <div>
          <Label>Payment QR image</Label>
          <p className="mt-0.5 text-xs text-brand-green-dark/50">JPEG, PNG, or WebP. Shown on PDF and My Bills.</p>
          {settings.food_bill_payment_qr_url ? (
            <div className="mt-3 flex flex-wrap items-start gap-4">
              <img
                src={settings.food_bill_payment_qr_url}
                alt="Payment QR preview"
                className="h-40 w-40 rounded-xl border border-brand-mist bg-white object-contain p-2"
              />
              <div className="flex flex-col gap-2">
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-brand-mist px-3 py-2 text-sm font-medium text-brand-green-dark hover:bg-brand-sand">
                  <UploadIcon className="h-4 w-4" />
                  {uploading ? "Uploading…" : "Replace"}
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="hidden"
                    disabled={uploading}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void uploadQr(f);
                      e.target.value = "";
                    }}
                  />
                </label>
                <Button type="button" variant="outline" onClick={() => void clearQr()} className="text-red-600">
                  <Trash2Icon className="mr-2 h-4 w-4" /> Delete
                </Button>
              </div>
            </div>
          ) : (
            <label className="mt-3 flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-brand-mist bg-brand-sand/40 px-4 py-8 text-sm text-brand-green-dark/60 hover:bg-brand-sand">
              <UploadIcon className="mb-2 h-6 w-6" />
              {uploading ? "Uploading…" : "Upload payment QR"}
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                disabled={uploading}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void uploadQr(f);
                  e.target.value = "";
                }}
              />
            </label>
          )}
        </div>
      </div>
    </div>
  );
}
