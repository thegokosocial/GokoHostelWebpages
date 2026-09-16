export const STAFF_WHATSAPP_KEY = "gokoStaffWhatsAppDraft";
export const STAFF_WHATSAPP_TTL = 30 * 60 * 1000;
export type StaffWhatsAppDraft = {
  phone: string;
  message: string;
  section: "bookings" | "reviews";
  owner: string;
  createdAt: number;
};

export function staffWhatsAppLinks(draft: Pick<StaffWhatsAppDraft, "phone" | "message" | "section">, origin: string) {
  const phone = draft.phone;
  if (!/^[1-9]\d{6,14}$/.test(phone)) throw new Error("A valid phone number is required.");
  const query = `phone=${phone}&text=${encodeURIComponent(draft.message)}`;
  const fallback = new URL(`/admin?section=${draft.section}`, origin).href;
  return {
    business: `intent://send?${query}#Intent;scheme=whatsapp;package=com.whatsapp.w4b;S.browser_fallback_url=${encodeURIComponent(fallback)};end`,
    defaultApp: `https://wa.me/${phone}?text=${encodeURIComponent(draft.message)}`,
  };
}

export function parseStaffWhatsAppDraft(raw: string | null, owner: string, now = Date.now()): StaffWhatsAppDraft | null {
  try {
    const draft = JSON.parse(raw || "null");
    return draft && draft.owner === owner && typeof draft.phone === "string" && /^[1-9]\d{6,14}$/.test(draft.phone)
      && typeof draft.message === "string" && draft.message.length > 0
      && (draft.section === "bookings" || draft.section === "reviews")
      && Number.isFinite(draft.createdAt) && draft.createdAt <= now && now - draft.createdAt < STAFF_WHATSAPP_TTL ? draft : null;
  } catch { return null; }
}

export function clearStaffWhatsAppDraft() {
  try { sessionStorage.removeItem(STAFF_WHATSAPP_KEY); } catch { /* Storage may be disabled. */ }
}
