import { getCloudflareContext } from "@opennextjs/cloudflare";
import { formatBookingEnquiryBody, type BookingEnquiryPayload } from "@/lib/bookingEnquiry";
import { buildBookingEmailBody } from "@/lib/guestBookingDetails";
import { stayNights } from "@/lib/inventoryAvailability";
import { site } from "@/lib/site";
import { getSetting } from "@/db/queries";
import {
  BOOKING_EMAIL_TEMPLATES_KEY,
  fillBookingEmailTemplate,
  parseBookingEmailTemplates,
  tidyBookingEmailBody,
  type BookingEmailPlaceholderToken,
} from "@/lib/bookingEmailTemplates";
import { formatPaymentChoice } from "@/lib/guestBookingDetails";

export const INFO_EMAIL = "info@gokohostel.com";
export const BOOKING_EMAIL = "booking@gokohostel.com";
export const ADMIN_EMAIL = "admin@gokohostel.com";
export const STAFF_INBOX = "thegokosocial@gmail.com";

function bookingFrom() {
  return { email: BOOKING_EMAIL, name: site.shortName };
}

export class EmailUnavailableError extends Error {
  constructor(message = "Email service is not available") {
    super(message);
    this.name = "EmailUnavailableError";
  }
}

function getEmailBinding(): CloudflareEnv["EMAIL"] {
  const { env } = getCloudflareContext();
  const email = (env as CloudflareEnv).EMAIL;
  if (!email?.send) throw new EmailUnavailableError();
  return email;
}

export async function sendBookingLookupCode(recipient: string, code: string): Promise<void> {
  if (!/^\d{6}$/.test(code)) throw new Error("Invalid verification code");
  await getEmailBinding().send({ from: bookingFrom(), to: recipient,
    subject: "Your Goko booking verification code",
    text: `Your verification code is ${code}. It expires in 10 minutes and can be used once. Do not share it. If you did not request this code, ignore this email.`,
  });
}

export async function sendBookingEnquiryEmails(payload: BookingEnquiryPayload): Promise<void> {
  const email = getEmailBinding();
  const body = formatBookingEnquiryBody(payload);
  const from = bookingFrom();

  await email.send({
    from,
    to: ADMIN_EMAIL,
    replyTo: payload.email,
    subject: `Booking enquiry — ${payload.name}`,
    text: body,
  });

  await email.send({
    from,
    to: payload.email,
    subject: `We received your enquiry — ${site.shortName}`,
    text: [
      `Hi ${payload.name},`,
      "",
      "Thanks for reaching out to Goko Hostel. We received your booking enquiry and will get back to you soon.",
      "",
      "If you need a faster reply, message us on WhatsApp.",
      "",
      site.shortName,
      site.url,
    ].join("\n"),
  });
}

function money(n: number | null | undefined) {
  if (n == null || Number.isNaN(n)) return "";
  return String(Math.round(n));
}

async function renderConfirmationEmail(input: {
  guestName: string; reference: string;
  checkinDate: string; checkoutDate: string; totalRupees: number; paidRupees: number;
  nights: number;
  rooms: { label: string; subtotalRupees?: number }[];
  persons?: number | null;
  beforeTaxRupees?: number | null;
  taxRupees?: number | null;
  taxPercent?: number | null;
  paymentChoice?: string | null;
  manageUrl: string;
  cancellationDeadlineAt?: string | null;
}): Promise<{ subject: string; body: string }> {
  const due = Math.max(0, input.totalRupees - input.paidRupees);
  const roomLines = input.rooms.length
    ? input.rooms.map((r) => `  • ${r.label}${r.subtotalRupees != null ? ` — ₹${r.subtotalRupees}` : ""}`).join("\n")
    : "  • See your confirmation page for room details";
  const deadline = input.cancellationDeadlineAt
    ? `Online changes/cancellation available until ${new Date(input.cancellationDeadlineAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST.`
    : "";
  const values: Partial<Record<BookingEmailPlaceholderToken, string>> = {
    "{GUEST_NAME}": input.guestName,
    "{BOOKING_ID}": input.reference,
    "{CHECK_IN}": input.checkinDate,
    "{CHECK_OUT}": input.checkoutDate,
    "{NIGHTS}": String(input.nights),
    "{PERSONS}": input.persons != null ? String(input.persons) : "",
    "{ROOMS}": roomLines,
    "{PAYMENT_CHOICE}": input.paymentChoice ? formatPaymentChoice(input.paymentChoice) : "",
    "{SUBTOTAL}": money(input.beforeTaxRupees),
    "{TAX}": money(input.taxRupees),
    "{TAX_PERCENT}": input.taxPercent != null ? String(input.taxPercent) : "",
    "{TOTAL}": money(input.totalRupees),
    "{PAID}": money(input.paidRupees),
    "{BALANCE}": money(due),
    "{MANAGE_URL}": input.manageUrl,
    "{CANCELLATION_DEADLINE}": deadline,
    "{PROPERTY_NAME}": site.shortName,
    "{PROPERTY_URL}": site.url,
  };
  try {
    const templates = parseBookingEmailTemplates(await getSetting(BOOKING_EMAIL_TEMPLATES_KEY));
    const tpl = templates.confirmation;
    return {
      subject: fillBookingEmailTemplate(tpl.subject, values).trim() || `Booking confirmed — ${input.reference}`,
      body: tidyBookingEmailBody(fillBookingEmailTemplate(tpl.body, values)),
    };
  } catch {
    const body = [
      ...buildBookingEmailBody({ ...input, amended: false }),
      site.shortName,
      site.url,
    ].join("\n");
    return { subject: `Booking confirmed — ${input.reference}`, body };
  }
}

/** Best-effort confirmation; booking stands if email fails. */
export async function sendBookingConfirmationEmail(input: {
  guestName: string; guestEmail: string; reference: string;
  checkinDate: string; checkoutDate: string; totalRupees: number; paidRupees: number;
  nights?: number;
  rooms?: { label: string; subtotalRupees?: number }[];
  persons?: number | null;
  beforeTaxRupees?: number | null;
  taxRupees?: number | null;
  taxPercent?: number | null;
  paymentChoice?: string | null;
  cancellationDeadlineAt?: string | null;
  amended?: boolean;
}): Promise<void> {
  try {
    const email = getEmailBinding();
    const from = bookingFrom();
    const nights = input.nights ?? (input.checkinDate && input.checkoutDate
      ? stayNights(input.checkinDate, input.checkoutDate).length : 0);
    const manageUrl = `${site.url}/booking/${encodeURIComponent(input.reference)}`;

    // Modified / cancelled templates are stored for later; amend still uses the built-in body.
    if (input.amended) {
      const body = [
        ...buildBookingEmailBody({
          guestName: input.guestName,
          reference: input.reference,
          checkinDate: input.checkinDate,
          checkoutDate: input.checkoutDate,
          nights,
          rooms: input.rooms || [],
          persons: input.persons,
          beforeTaxRupees: input.beforeTaxRupees,
          taxRupees: input.taxRupees,
          taxPercent: input.taxPercent,
          totalRupees: input.totalRupees,
          paidRupees: input.paidRupees,
          paymentChoice: input.paymentChoice,
          manageUrl,
          cancellationDeadlineAt: input.cancellationDeadlineAt,
          amended: true,
        }),
        site.shortName,
        site.url,
      ].join("\n");
      const subject = `Booking updated — ${input.reference}`;
      await email.send({ from, to: input.guestEmail, subject, text: body });
      await email.send({
        from, to: ADMIN_EMAIL, replyTo: input.guestEmail,
        subject: `Website booking updated — ${input.reference}`,
        text: body,
      });
      return;
    }

    const rendered = await renderConfirmationEmail({
      guestName: input.guestName,
      reference: input.reference,
      checkinDate: input.checkinDate,
      checkoutDate: input.checkoutDate,
      nights,
      rooms: input.rooms || [],
      persons: input.persons,
      beforeTaxRupees: input.beforeTaxRupees,
      taxRupees: input.taxRupees,
      taxPercent: input.taxPercent,
      totalRupees: input.totalRupees,
      paidRupees: input.paidRupees,
      paymentChoice: input.paymentChoice,
      manageUrl,
      cancellationDeadlineAt: input.cancellationDeadlineAt,
    });
    await email.send({ from, to: input.guestEmail, subject: rendered.subject, text: rendered.body });
    await email.send({
      from, to: ADMIN_EMAIL, replyTo: input.guestEmail,
      subject: `Website booking confirmed — ${input.reference}`,
      text: rendered.body,
    });
  } catch {
    // Non-fatal: confirmation email must not roll back fulfilment.
  }
}

export async function sendBookingAmendedEmail(
  input: Parameters<typeof sendBookingConfirmationEmail>[0],
): Promise<void> {
  return sendBookingConfirmationEmail({ ...input, amended: true });
}
