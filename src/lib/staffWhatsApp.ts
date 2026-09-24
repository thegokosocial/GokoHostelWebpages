export const STAFF_WHATSAPP_KEY = "gokoStaffWhatsAppDraft";
export const STAFF_WHATSAPP_TTL = 30 * 60 * 1000;
export const STAFF_WHATSAPP_FALLBACK_PARAM = "whatsappBusinessUnavailable";
export const STAFF_WHATSAPP_APP_PARAM = "whatsappUnavailable";
export type StaffWhatsAppPreference = "ask" | "business" | "regular";
export type StaffWhatsAppDraft = {
  phone: string;
  message: string;
  section: "bookings" | "reviews" | "foodOrders";
  owner: string;
  createdAt: number;
};

const preferenceKey = (owner: string) => `gokoStaffWhatsAppPreference:${owner}`;

export function readStaffWhatsAppPreference(owner: string, storage?: Pick<Storage, "getItem">): StaffWhatsAppPreference {
  try {
    const value = (storage || localStorage).getItem(preferenceKey(owner));
    return value === "business" || value === "regular" ? value : "ask";
  } catch { return "ask"; }
}

export function writeStaffWhatsAppPreference(owner: string, value: StaffWhatsAppPreference, storage?: Pick<Storage, "setItem">): boolean {
  try {
    (storage || localStorage).setItem(preferenceKey(owner), value);
    return true;
  } catch { return false; }
}

export function staffWhatsAppLinks(draft: Pick<StaffWhatsAppDraft, "phone" | "message" | "section">, origin: string) {
  const phone = draft.phone;
  if (!/^[1-9]\d{6,14}$/.test(phone)) throw new Error("A valid phone number is required.");
  const query = `phone=${phone}&text=${encodeURIComponent(draft.message)}`;
  const businessFallback = new URL("/admin", origin);
  businessFallback.searchParams.set("section", draft.section);
  businessFallback.searchParams.set(STAFF_WHATSAPP_FALLBACK_PARAM, "1");
  const regularFallback = new URL("/admin", origin);
  regularFallback.searchParams.set("section", draft.section);
  regularFallback.searchParams.set(STAFF_WHATSAPP_APP_PARAM, "regular");
  return {
    business: `intent://send?${query}#Intent;scheme=whatsapp;package=com.whatsapp.w4b;S.browser_fallback_url=${encodeURIComponent(businessFallback.href)};end`,
    regular: `intent://send?${query}#Intent;scheme=whatsapp;package=com.whatsapp;S.browser_fallback_url=${encodeURIComponent(regularFallback.href)};end`,
    defaultApp: `https://wa.me/${phone}?text=${encodeURIComponent(draft.message)}`,
  };
}

export function staffWhatsAppFallback(url: string) {
  const parsed = new URL(url);
  const app = parsed.searchParams.get(STAFF_WHATSAPP_APP_PARAM);
  const unavailable: "business" | "regular" | null = app === "regular" ? "regular" : parsed.searchParams.get(STAFF_WHATSAPP_FALLBACK_PARAM) === "1" ? "business" : null;
  const hadMarker = parsed.searchParams.has(STAFF_WHATSAPP_FALLBACK_PARAM) || parsed.searchParams.has(STAFF_WHATSAPP_APP_PARAM);
  parsed.searchParams.delete(STAFF_WHATSAPP_FALLBACK_PARAM);
  parsed.searchParams.delete(STAFF_WHATSAPP_APP_PARAM);
  return { unavailable, hadMarker, cleanUrl: `${parsed.pathname}${parsed.search}${parsed.hash}` };
}

export function parseStaffWhatsAppDraft(raw: string | null, owner: string, now = Date.now()): StaffWhatsAppDraft | null {
  try {
    const draft = JSON.parse(raw || "null");
    return draft && draft.owner === owner && typeof draft.phone === "string" && /^[1-9]\d{6,14}$/.test(draft.phone)
      && typeof draft.message === "string" && draft.message.length > 0
      && (draft.section === "bookings" || draft.section === "reviews" || draft.section === "foodOrders")
      && Number.isFinite(draft.createdAt) && draft.createdAt <= now && now - draft.createdAt < STAFF_WHATSAPP_TTL ? draft : null;
  } catch { return null; }
}

export function clearStaffWhatsAppDraft() {
  try { sessionStorage.removeItem(STAFF_WHATSAPP_KEY); } catch { /* Storage may be disabled. */ }
}
