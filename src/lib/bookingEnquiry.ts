import { z } from "zod";
import { site } from "@/lib/site";

export const bookingEnquirySchema = z.object({
  name: z.string().trim().min(2, "Please enter your name"),
  email: z.string().trim().email("Valid email required"),
  phone: z.string().trim().min(8, "Phone number required"),
  checkIn: z.string().optional(),
  checkOut: z.string().optional(),
  guests: z.string().optional(),
  message: z.string().trim().min(10, "Tell us a bit more (10+ characters)"),
  _hp: z.string().optional(),
});

export type BookingEnquiryPayload = z.infer<typeof bookingEnquirySchema>;

export function formatBookingEnquiryBody(data: BookingEnquiryPayload): string {
  const lines = [
    `Booking enquiry — ${site.shortName}`,
    `Name: ${data.name}`,
    `Email: ${data.email}`,
    `Phone: ${data.phone}`,
  ];
  if (data.checkIn) lines.push(`Check-in: ${data.checkIn}`);
  if (data.checkOut) lines.push(`Check-out: ${data.checkOut}`);
  if (data.guests) lines.push(`Guests: ${data.guests}`);
  lines.push("", data.message);
  return lines.join("\n");
}
