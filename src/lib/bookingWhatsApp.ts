export const BOOKING_WHATSAPP_SETTING = "booking_whatsapp_templates";
export const MAX_BOOKING_WHATSAPP_TEMPLATES = 10;

export type BookingWhatsAppTemplate = {
  id: string;
  name: string;
  message: string;
};

export const BOOKING_WHATSAPP_PLACEHOLDERS = [
  { token: "{GUEST_NAME}", label: "Guest name" },
  { token: "{CHECK_IN}", label: "Check-in date" },
  { token: "{CHECK_OUT}", label: "Check-out date" },
  { token: "{BOOKING_ID}", label: "Guest-facing platform and booking reference" },
  { token: "{BALANCE}", label: "Balance due" },
  { token: "{PROPERTY_NAME}", label: "Property name" },
] as const;

export function parseBookingWhatsAppTemplates(value: string | null | undefined): BookingWhatsAppTemplate[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => item && typeof item.id === "string" && typeof item.name === "string" && typeof item.message === "string")
      .map((item) => ({ id: item.id.trim(), name: item.name.trim(), message: item.message.trim() }))
      .filter((item) => item.id && item.name && item.message)
      .slice(0, MAX_BOOKING_WHATSAPP_TEMPLATES);
  } catch {
    return [];
  }
}

export function validateBookingWhatsAppTemplates(value: unknown): BookingWhatsAppTemplate[] | null {
  if (!Array.isArray(value) || value.length > MAX_BOOKING_WHATSAPP_TEMPLATES) return null;
  const templates = value.map((item) => ({
    id: typeof item?.id === "string" ? item.id.trim() : "",
    name: typeof item?.name === "string" ? item.name.trim() : "",
    message: typeof item?.message === "string" ? item.message.trim() : "",
  }));
  if (templates.some((item) => !item.id || item.id.length > 100 || !item.name || item.name.length > 80 || !item.message || item.message.length > 2000)) return null;
  if (new Set(templates.map((item) => item.id)).size !== templates.length) return null;
  return templates;
}

export function bookingWhatsAppNumber(input: string): string {
  const trimmed = input.trim();
  if (!/^\+?[\d\s().-]+$/.test(trimmed)) return "";
  const international = trimmed.startsWith("+") || trimmed.startsWith("00");
  let digits = trimmed.replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.length === 10 && !international) digits = `91${digits}`;
  return /^[1-9]\d{6,14}$/.test(digits) ? digits : "";
}

export function bookingWhatsAppReference({
  platform,
  bookingRef,
  gokoBookingId,
}: {
  platform?: string | null;
  bookingRef?: string | null;
  gokoBookingId?: string | null;
}): string {
  const key = (platform || "").trim().toLowerCase().replace(/[.\s-]+/g, "_");
  const labels: Record<string, string> = {
    booking_com: "Booking.com",
    hostelworld: "Hostelworld",
    makemytrip: "MakeMyTrip",
    goibibo: "Goibibo",
  };
  if (bookingRef?.trim() && labels[key]) return `${labels[key]}: ${bookingRef.trim()}`;
  if (gokoBookingId?.trim()) return `Goko Hostel: ${gokoBookingId.trim()}`;
  if (bookingRef?.trim()) {
    const label = key && key !== "aiosell" && key !== "channel_manager"
      ? platform!.trim()
      : "Booking reference";
    return `${label}: ${bookingRef.trim()}`;
  }
  return "Goko Hostel booking";
}

export function fillBookingWhatsAppTemplate(
  message: string,
  values: Record<(typeof BOOKING_WHATSAPP_PLACEHOLDERS)[number]["token"], string>,
): string {
  return BOOKING_WHATSAPP_PLACEHOLDERS.reduce(
    (result, { token }) => result.replaceAll(token, values[token]),
    message,
  );
}
