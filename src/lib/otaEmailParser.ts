/**
 * OTA Email Parser — extracts booking details from MakeMyTrip, Booking.com, and Hostelworld emails.
 */

import type { GmailMessage } from "./googleApiFetch";

export type ParsedBooking = {
  guestName: string;
  contact: string;
  platform: string;
  bookingRef: string;
  checkinDate: string;
  checkoutDate: string;
  roomType: string;
  persons: number;
  paymentStatus: string;
  specialRequests: string;
};

const OTA_SENDERS: Record<string, string> = {
  "makemytrip": "makemytrip.com",
  "booking_com": "booking.com",
  "hostelworld": "hostelworld.com",
};

export function identifyPlatform(from: string): string | null {
  const lower = from.toLowerCase();
  if (lower.includes("makemytrip")) return "makemytrip";
  if (lower.includes("booking.com")) return "booking_com";
  if (lower.includes("hostelworld")) return "hostelworld";
  return null;
}

export function isBookingEmail(message: GmailMessage): boolean {
  const subject = message.subject.toLowerCase();
  const from = message.from.toLowerCase();

  const bookingKeywords = ["booking confirmation", "reservation confirmed", "new booking", "new reservation", "booking id", "booking reference"];
  const isFromOTA = Object.values(OTA_SENDERS).some((domain) => from.includes(domain));
  const hasKeyword = bookingKeywords.some((kw) => subject.includes(kw));

  return isFromOTA && hasKeyword;
}

export function parseBookingEmail(message: GmailMessage): ParsedBooking | null {
  const platform = identifyPlatform(message.from);
  if (!platform) return null;

  const body = message.body;
  const subject = message.subject;

  try {
    switch (platform) {
      case "makemytrip":
        return parseMakeMyTrip(body, subject);
      case "booking_com":
        return parseBookingCom(body, subject);
      case "hostelworld":
        return parseHostelworld(body, subject);
      default:
        return null;
    }
  } catch {
    return null;
  }
}

function parseMakeMyTrip(body: string, subject: string): ParsedBooking {
  const guestName = extractBetween(body, "Guest Name", "\n") || extractBetween(body, "guest name", "\n") || "Unknown Guest";
  const bookingRef = extractPattern(body, /(?:Booking ID|booking id|Confirmation No)[:\s]*([A-Z0-9\-]+)/i) || "";
  const checkinDate = extractDate(body, "check.?in") || "";
  const checkoutDate = extractDate(body, "check.?out") || "";
  const roomType = extractBetween(body, "Room Type", "\n") || extractBetween(body, "room type", "\n") || "";
  const persons = parseInt(extractPattern(body, /(\d+)\s*(?:guest|person|pax)/i) || "1", 10);
  const contact = extractPattern(body, /(?:phone|mobile|contact)[:\s]*([+\d\s\-]+)/i) || "";

  return {
    guestName: guestName.replace(/[:\-]/g, "").trim(),
    contact: contact.trim(),
    platform: "makemytrip",
    bookingRef,
    checkinDate,
    checkoutDate,
    roomType: roomType.replace(/[:\-]/g, "").trim(),
    persons,
    paymentStatus: body.toLowerCase().includes("paid") ? "paid" : "pay_at_property",
    specialRequests: extractBetween(body, "Special Request", "\n") || "",
  };
}

function parseBookingCom(body: string, subject: string): ParsedBooking {
  const guestName = extractPattern(body, /(?:Guest name|Booked by)[:\s]*([^\n<]+)/i) || extractPattern(subject, /from\s+(.+?)(?:\s*-|\s*$)/i) || "Unknown Guest";
  const bookingRef = extractPattern(body, /(?:Confirmation|Booking|Reservation)\s*(?:number|#|no\.?)[:\s]*(\d+)/i) || "";
  const checkinDate = extractDate(body, "check.?in|arrival") || "";
  const checkoutDate = extractDate(body, "check.?out|departure") || "";
  const roomType = extractPattern(body, /(?:Room|Bed|Accommodation)[:\s]*([^\n<]+)/i) || "";
  const persons = parseInt(extractPattern(body, /(\d+)\s*(?:guest|person|adult)/i) || "1", 10);
  const contact = extractPattern(body, /(?:phone|tel|mobile)[:\s]*([+\d\s\-()]+)/i) || "";

  return {
    guestName: guestName.trim(),
    contact: contact.trim(),
    platform: "booking_com",
    bookingRef,
    checkinDate,
    checkoutDate,
    roomType: roomType.trim(),
    persons,
    paymentStatus: body.toLowerCase().includes("prepaid") || body.toLowerCase().includes("paid online") ? "paid" : "pay_at_property",
    specialRequests: extractPattern(body, /(?:special request|guest request)[:\s]*([^\n<]+)/i) || "",
  };
}

function parseHostelworld(body: string, subject: string): ParsedBooking {
  const guestName = extractPattern(body, /(?:Guest|Name|Traveller)[:\s]*([^\n<]+)/i) || "Unknown Guest";
  const bookingRef = extractPattern(body, /(?:Booking|Reservation)\s*(?:ID|#|ref|number)[:\s]*([A-Z0-9\-]+)/i) || "";
  const checkinDate = extractDate(body, "check.?in|arrival|from") || "";
  const checkoutDate = extractDate(body, "check.?out|departure|to") || "";
  const roomType = extractPattern(body, /(?:Bed|Room|Dorm)[:\s]*([^\n<]+)/i) || "Dorm Bed";
  const persons = parseInt(extractPattern(body, /(\d+)\s*(?:bed|guest|person)/i) || "1", 10);

  return {
    guestName: guestName.trim(),
    contact: "",
    platform: "hostelworld",
    bookingRef,
    checkinDate,
    checkoutDate,
    roomType: roomType.trim(),
    persons,
    paymentStatus: "partial",
    specialRequests: "",
  };
}

// --- Utility helpers ---

function extractBetween(text: string, startKey: string, endKey: string): string | null {
  const regex = new RegExp(`${startKey}[:\\s]*([^\\n<]+?)(?:${endKey}|$)`, "i");
  const match = text.match(regex);
  return match ? match[1].trim() : null;
}

function extractPattern(text: string, pattern: RegExp): string | null {
  const match = text.match(pattern);
  return match ? match[1] : null;
}

function extractDate(text: string, contextKey: string): string {
  const contextRegex = new RegExp(`${contextKey}[^\\n]*?(\\d{1,2}[\\s/\\-]\\w{3,9}[\\s/\\-]\\d{2,4}|\\d{4}-\\d{2}-\\d{2}|\\d{1,2}/\\d{1,2}/\\d{2,4})`, "i");
  const match = text.match(contextRegex);
  if (!match) return "";

  const dateStr = match[1];
  try {
    const d = new Date(dateStr);
    if (!isNaN(d.getTime())) return d.toISOString().split("T")[0];
  } catch {}

  return dateStr;
}

export function getOtaSearchQuery(): string {
  return "from:(makemytrip.com OR booking.com OR hostelworld.com) subject:(booking OR reservation OR confirmation) newer_than:7d";
}
