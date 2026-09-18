/** Editable website booking SMS templates (all kinds reserved — no send path yet). */

import {
  BOOKING_EMAIL_KINDS,
  BOOKING_EMAIL_PLACEHOLDERS,
  fillBookingEmailTemplate,
  type BookingEmailKind,
  type BookingEmailPlaceholderToken,
} from "@/lib/bookingEmailTemplates";

export const BOOKING_SMS_TEMPLATES_KEY = "booking_sms_templates";

export const BOOKING_SMS_KINDS = BOOKING_EMAIL_KINDS;
export type BookingSmsKind = BookingEmailKind;

/** Same tokens as email so staff can reuse familiar placeholders. */
export const BOOKING_SMS_PLACEHOLDERS = BOOKING_EMAIL_PLACEHOLDERS;

export type BookingSmsTemplate = { body: string };
export type BookingSmsTemplates = Record<BookingSmsKind, BookingSmsTemplate>;

/** Soft guidance for single SMS segments; stored max allows longer drafts. */
export const BOOKING_SMS_SOFT_LIMIT = 160;
const BODY_MAX = 500;

export const DEFAULT_BOOKING_SMS_TEMPLATES: BookingSmsTemplates = {
  confirmation: {
    body: "Goko: booking {BOOKING_ID} confirmed for {CHECK_IN}→{CHECK_OUT}. Total ₹{TOTAL}, paid ₹{PAID}, due ₹{BALANCE}. Manage: {MANAGE_URL}",
  },
  modified: {
    body: "Goko: booking {BOOKING_ID} updated. Stay {CHECK_IN}→{CHECK_OUT}. Total ₹{TOTAL}, due ₹{BALANCE}. Manage: {MANAGE_URL}",
  },
  cancelled: {
    body: "Goko: booking {BOOKING_ID} cancelled ({CHECK_IN}→{CHECK_OUT}). Reply or WhatsApp if you have questions.",
  },
};

function trimBody(body: unknown): string | null {
  if (typeof body !== "string") return null;
  const trimmed = body.trim();
  if (!trimmed || trimmed.length > BODY_MAX) return null;
  return trimmed;
}

export function parseBookingSmsTemplates(raw: string | null | undefined): BookingSmsTemplates {
  const base: BookingSmsTemplates = {
    confirmation: { ...DEFAULT_BOOKING_SMS_TEMPLATES.confirmation },
    modified: { ...DEFAULT_BOOKING_SMS_TEMPLATES.modified },
    cancelled: { ...DEFAULT_BOOKING_SMS_TEMPLATES.cancelled },
  };
  if (!raw) return base;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return base;
    const record = parsed as Record<string, unknown>;
    for (const kind of BOOKING_SMS_KINDS) {
      const entry = record[kind];
      if (entry && typeof entry === "object" && !Array.isArray(entry)) {
        const body = trimBody((entry as { body?: unknown }).body);
        if (body) base[kind] = { body };
      }
    }
    return base;
  } catch {
    return base;
  }
}

export function validateBookingSmsTemplates(value: unknown): BookingSmsTemplates | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const out = {} as BookingSmsTemplates;
  for (const kind of BOOKING_SMS_KINDS) {
    const entry = record[kind];
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
    const body = trimBody((entry as { body?: unknown }).body);
    if (!body) return null;
    out[kind] = { body };
  }
  return out;
}

export function fillBookingSmsTemplate(
  text: string,
  values: Partial<Record<BookingEmailPlaceholderToken, string>>,
): string {
  return fillBookingEmailTemplate(text, values);
}

export const BOOKING_SMS_KIND_LABELS: Record<BookingSmsKind, string> = {
  confirmation: "Booking confirmation (reserved)",
  modified: "Booking updated (reserved)",
  cancelled: "Booking cancelled (reserved)",
};
