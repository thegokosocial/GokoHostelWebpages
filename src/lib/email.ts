import { getCloudflareContext } from "@opennextjs/cloudflare";
import { formatBookingEnquiryBody, type BookingEnquiryPayload } from "@/lib/bookingEnquiry";
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
}): Promise<void> {
  try {
    const email = getEmailBinding();
    const from = bookingFrom();
    const due = Math.max(0, input.totalRupees - input.paidRupees);
    const body = [
      `Hi ${input.guestName},`,
      "",
      `Your Goko booking ${input.reference} is confirmed.`,
      `Stay: ${input.checkinDate} to ${input.checkoutDate}`,
      `Total: ₹${input.totalRupees} · Paid online: ₹${input.paidRupees}${due ? ` · Due at property: ₹${due}` : ""}`,
      "",
      `View or manage: ${site.url}/booking/${encodeURIComponent(input.reference)}`,
      "",
      site.shortName,
      site.url,
    ].join("\n");
    await email.send({ from, to: input.guestEmail, subject: `Booking confirmed — ${input.reference}`, text: body });
    await email.send({
      from, to: ADMIN_EMAIL, replyTo: input.guestEmail,
      subject: `Website booking confirmed — ${input.reference}`,
      text: body,
    });
  } catch {
    // Non-fatal: confirmation email must not roll back fulfilment.
  }
}
