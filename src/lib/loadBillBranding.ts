"use client";

import {
  brandingFromSettings,
  type BillBranding,
  DEFAULT_BILL_BRANDING,
} from "@/lib/foodBillFormat";

export type LoadedBillBranding = {
  ok: boolean;
  branding: BillBranding;
  paymentQrDataUrl?: string;
  error?: string;
};

async function qrUrlToDataUrl(url: string): Promise<string | undefined> {
  if (!url) return undefined;
  try {
    const res = await fetch(url);
    if (!res.ok) return undefined;
    const blob = await res.blob();
    return await new Promise<string | undefined>((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(typeof reader.result === "string" ? reader.result : undefined);
      reader.onerror = () => resolve(undefined);
      reader.readAsDataURL(blob);
    });
  } catch {
    return undefined;
  }
}

/** Load bill branding for PDF/thermal. Soft-fails QR image fetch; surfaces API errors via `ok`. */
export async function loadBillBranding(
  password: string,
  username?: string,
): Promise<LoadedBillBranding> {
  try {
    const payload: Record<string, unknown> = { password, action: "getBillBranding" };
    if (username) payload.username = username;
    const res = await fetch("/api/admin/food", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return {
        ok: false,
        branding: { ...DEFAULT_BILL_BRANDING },
        error: (data as { error?: string }).error || "Could not load bill branding",
      };
    }
    const settings = (data.settings || {}) as Record<string, string>;
    const branding = brandingFromSettings(settings);
    const paymentQrDataUrl = branding.paymentQrUrl
      ? await qrUrlToDataUrl(branding.paymentQrUrl)
      : undefined;
    return { ok: true, branding, paymentQrDataUrl };
  } catch {
    return {
      ok: false,
      branding: { ...DEFAULT_BILL_BRANDING },
      error: "Could not load bill branding",
    };
  }
}
