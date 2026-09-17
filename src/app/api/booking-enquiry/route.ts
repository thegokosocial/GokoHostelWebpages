import { NextRequest, NextResponse } from "next/server";
import { bookingEnquirySchema } from "@/lib/bookingEnquiry";
import { EmailUnavailableError, sendBookingEnquiryEmails } from "@/lib/email";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = bookingEnquirySchema.safeParse(body);
    if (!parsed.success) {
      const message = parsed.error.issues[0]?.message ?? "Invalid enquiry";
      return NextResponse.json({ error: message }, { status: 400 });
    }

    if (parsed.data._hp?.trim()) {
      return NextResponse.json({ error: "Invalid enquiry" }, { status: 400 });
    }

    await sendBookingEnquiryEmails(parsed.data);
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof EmailUnavailableError) {
      return NextResponse.json({ error: "Email is temporarily unavailable. Try WhatsApp instead." }, { status: 503 });
    }
    console.error("booking-enquiry send failed:", error);
    return NextResponse.json({ error: "Could not send enquiry. Please try WhatsApp instead." }, { status: 500 });
  }
}
