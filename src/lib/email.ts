import { getCloudflareContext } from "@opennextjs/cloudflare";
import { formatBookingEnquiryBody, type BookingEnquiryPayload } from "@/lib/bookingEnquiry";
import { buildBookingEmailBody } from "@/lib/guestBookingDetails";
import { stayNights } from "@/lib/inventoryAvailability";
import { site } from "@/lib/site";

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
        amended: input.amended,
      }),
      site.shortName,
      site.url,
    ].join("\n");
    const subject = input.amended
      ? `Booking updated — ${input.reference}`
      : `Booking confirmed — ${input.reference}`;
    await email.send({ from, to: input.guestEmail, subject, text: body });
    await email.send({
      from, to: ADMIN_EMAIL, replyTo: input.guestEmail,
      subject: input.amended
        ? `Website booking updated — ${input.reference}`
        : `Website booking confirmed — ${input.reference}`,
      text: body,
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
