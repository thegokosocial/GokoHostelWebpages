import { normalizePhone } from "@/lib/phoneUtils";

/** 24-char unguessable token (same density as review request tokens). */
export function generateBillShareToken(): string {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(36).padStart(2, "0")).join("").slice(0, 24);
}

export function billShareExpiresAt(days = 7): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}

/** Digits for wa.me (India 91 + 10-digit mobile). */
export function whatsAppPhoneDigits(phone: string | null | undefined): string | null {
  const n = normalizePhone(phone || "");
  if (!n || n.length !== 10) return null;
  return `91${n}`;
}

export function buildBillWhatsAppHref(opts: {
  guestPhone: string | null | undefined;
  guestName: string;
  shareUrl: string;
}): string | null {
  const draft = buildBillWhatsAppDraft(opts);
  return draft ? `https://wa.me/${draft.phone}?text=${encodeURIComponent(draft.message)}` : null;
}

export function buildBillWhatsAppDraft(opts: {
  guestPhone: string | null | undefined;
  guestName: string;
  shareUrl: string;
}): { phone: string; message: string } | null {
  const waPhone = whatsAppPhoneDigits(opts.guestPhone);
  if (!waPhone) return null;
  const name = opts.guestName.trim() || "there";
  return { phone: waPhone, message: `Hi ${name}, here is your Goko food bill:\n${opts.shareUrl}` };
}

export function publicBillShareUrl(origin: string, token: string): string {
  const base = origin.replace(/\/$/, "");
  return `${base}/my-bills?t=${encodeURIComponent(token)}`;
}
