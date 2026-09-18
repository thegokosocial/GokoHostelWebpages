/** Editable website booking email templates (confirmation wired; modify/cancel reserved). */

export const BOOKING_EMAIL_TEMPLATES_KEY = "booking_email_templates";

export const BOOKING_EMAIL_KINDS = ["confirmation", "modified", "cancelled"] as const;
export type BookingEmailKind = (typeof BOOKING_EMAIL_KINDS)[number];

export type BookingEmailTemplate = {
  subject: string;
  body: string;
};

export type BookingEmailTemplates = Record<BookingEmailKind, BookingEmailTemplate>;

export const BOOKING_EMAIL_PLACEHOLDERS = [
  { token: "{GUEST_NAME}", label: "Guest name" },
  { token: "{BOOKING_ID}", label: "Confirmation / Goko booking reference" },
  { token: "{CHECK_IN}", label: "Check-in date" },
  { token: "{CHECK_OUT}", label: "Check-out date" },
  { token: "{NIGHTS}", label: "Number of nights" },
  { token: "{PERSONS}", label: "Sleeps / persons" },
  { token: "{ROOMS}", label: "Room lines (multi-line)" },
  { token: "{PAYMENT_CHOICE}", label: "Payment choice label" },
  { token: "{SUBTOTAL}", label: "Subtotal (₹)" },
  { token: "{TAX}", label: "Tax (₹)" },
  { token: "{TAX_PERCENT}", label: "Tax percent" },
  { token: "{TOTAL}", label: "Total (₹)" },
  { token: "{PAID}", label: "Paid online (₹)" },
  { token: "{BALANCE}", label: "Due at property (₹)" },
  { token: "{MANAGE_URL}", label: "Guest manage booking URL" },
  { token: "{CANCELLATION_DEADLINE}", label: "Online cancel deadline (IST text)" },
  { token: "{PROPERTY_NAME}", label: "Property short name" },
  { token: "{PROPERTY_URL}", label: "Property website URL" },
] as const;

export type BookingEmailPlaceholderToken =
  (typeof BOOKING_EMAIL_PLACEHOLDERS)[number]["token"];

const SUBJECT_MAX = 200;
const BODY_MAX = 8000;

export const DEFAULT_BOOKING_EMAIL_TEMPLATES: BookingEmailTemplates = {
  confirmation: {
    subject: "Booking confirmed — {BOOKING_ID}",
    body: [
      "Hi {GUEST_NAME},",
      "",
      "Your Goko booking {BOOKING_ID} is confirmed.",
      "",
      "Stay",
      "  {CHECK_IN} → {CHECK_OUT} ({NIGHTS} nights)",
      "  Sleeps up to {PERSONS}",
      "",
      "Rooms",
      "{ROOMS}",
      "",
      "Payment",
      "  {PAYMENT_CHOICE}",
      "  Subtotal: ₹{SUBTOTAL}",
      "  Tax ({TAX_PERCENT}%): ₹{TAX}",
      "  Total: ₹{TOTAL}",
      "  Paid online: ₹{PAID}",
      "  Due at property: ₹{BALANCE}",
      "",
      "View or manage your booking: {MANAGE_URL}",
      "{CANCELLATION_DEADLINE}",
      "",
      "{PROPERTY_NAME}",
      "{PROPERTY_URL}",
    ].join("\n"),
  },
  modified: {
    subject: "Booking updated — {BOOKING_ID}",
    body: [
      "Hi {GUEST_NAME},",
      "",
      "Your Goko booking {BOOKING_ID} has been updated.",
      "",
      "Stay",
      "  {CHECK_IN} → {CHECK_OUT} ({NIGHTS} nights)",
      "  Sleeps up to {PERSONS}",
      "",
      "Rooms",
      "{ROOMS}",
      "",
      "Payment",
      "  {PAYMENT_CHOICE}",
      "  Total: ₹{TOTAL}",
      "  Paid online: ₹{PAID}",
      "  Due at property: ₹{BALANCE}",
      "",
      "View or manage your booking: {MANAGE_URL}",
      "",
      "{PROPERTY_NAME}",
      "{PROPERTY_URL}",
    ].join("\n"),
  },
  cancelled: {
    subject: "Booking cancelled — {BOOKING_ID}",
    body: [
      "Hi {GUEST_NAME},",
      "",
      "Your Goko booking {BOOKING_ID} has been cancelled.",
      "",
      "Stay was {CHECK_IN} → {CHECK_OUT}.",
      "If a refund applies, it will follow our cancellation policy.",
      "",
      "{PROPERTY_NAME}",
      "{PROPERTY_URL}",
    ].join("\n"),
  },
};

function trimTemplate(item: { subject?: unknown; body?: unknown }): BookingEmailTemplate | null {
  const subject = typeof item.subject === "string" ? item.subject.trim() : "";
  const body = typeof item.body === "string" ? item.body.trim() : "";
  if (!subject || !body || subject.length > SUBJECT_MAX || body.length > BODY_MAX) return null;
  return { subject, body };
}

/** Merge saved JSON with defaults so new kinds appear without migration. */
export function parseBookingEmailTemplates(raw: string | null | undefined): BookingEmailTemplates {
  const base: BookingEmailTemplates = {
    confirmation: { ...DEFAULT_BOOKING_EMAIL_TEMPLATES.confirmation },
    modified: { ...DEFAULT_BOOKING_EMAIL_TEMPLATES.modified },
    cancelled: { ...DEFAULT_BOOKING_EMAIL_TEMPLATES.cancelled },
  };
  if (!raw) return base;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return base;
    const record = parsed as Record<string, unknown>;
    for (const kind of BOOKING_EMAIL_KINDS) {
      const entry = record[kind];
      if (entry && typeof entry === "object" && !Array.isArray(entry)) {
        const trimmed = trimTemplate(entry as { subject?: unknown; body?: unknown });
        if (trimmed) base[kind] = trimmed;
      }
    }
    return base;
  } catch {
    return base;
  }
}

export function validateBookingEmailTemplates(value: unknown): BookingEmailTemplates | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const out = {} as BookingEmailTemplates;
  for (const kind of BOOKING_EMAIL_KINDS) {
    const entry = record[kind];
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
    const trimmed = trimTemplate(entry as { subject?: unknown; body?: unknown });
    if (!trimmed) return null;
    out[kind] = trimmed;
  }
  return out;
}

export function fillBookingEmailTemplate(
  text: string,
  values: Partial<Record<BookingEmailPlaceholderToken, string>>,
): string {
  return BOOKING_EMAIL_PLACEHOLDERS.reduce(
    (result, { token }) => result.replaceAll(token, values[token] ?? ""),
    text,
  );
}

/** Drop blank lines left by empty optional placeholders. */
export function tidyBookingEmailBody(body: string): string {
  return body
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export const BOOKING_EMAIL_KIND_LABELS: Record<BookingEmailKind, string> = {
  confirmation: "Booking confirmation",
  modified: "Booking updated (reserved)",
  cancelled: "Booking cancelled (reserved)",
};
