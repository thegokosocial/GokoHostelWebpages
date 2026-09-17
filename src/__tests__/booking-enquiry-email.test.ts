import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { bookingEnquirySchema } from "@/lib/bookingEnquiry";

const mocks = vi.hoisted(() => ({
  send: vi.fn(async () => ({ messageId: "test-id" })),
  getCloudflareContext: vi.fn(),
}));

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: mocks.getCloudflareContext,
}));

import { POST } from "@/app/api/booking-enquiry/route";
import { EmailUnavailableError, sendBookingEnquiryEmails, sendBookingLookupCode, ADMIN_EMAIL, BOOKING_EMAIL } from "@/lib/email";

const validPayload = {
  name: "Ada Lovelace",
  email: "ada@example.com",
  phone: "+919876543210",
  checkIn: "2026-10-01",
  checkOut: "2026-10-03",
  guests: "2",
  message: "Looking for a private room near the beach.",
};

function request(body: unknown) {
  return new NextRequest("https://www.gokohostel.com/api/booking-enquiry", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.send.mockResolvedValue({ messageId: "test-id" });
  mocks.getCloudflareContext.mockReturnValue({ env: { EMAIL: { send: mocks.send } } });
});

describe("bookingEnquirySchema", () => {
  it("accepts a valid payload", () => {
    expect(bookingEnquirySchema.safeParse(validPayload).success).toBe(true);
  });

  it("rejects missing required fields", () => {
    expect(bookingEnquirySchema.safeParse({ ...validPayload, email: "not-an-email" }).success).toBe(false);
    expect(bookingEnquirySchema.safeParse({ ...validPayload, message: "short" }).success).toBe(false);
  });
});

describe("sendBookingEnquiryEmails", () => {
  it("sends private lookup codes from booking@ and rejects malformed codes", async () => {
    await sendBookingLookupCode("ada@example.com", "012345");
    expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({ from: { email: BOOKING_EMAIL, name: "Goko Hostel" }, to: "ada@example.com", text: expect.stringContaining("012345") }));
    await expect(sendBookingLookupCode("ada@example.com", "bad")).rejects.toThrow();
    expect(mocks.send).toHaveBeenCalledTimes(1);
  });
  it("sends staff notification and guest auto-reply", async () => {
    await sendBookingEnquiryEmails(validPayload);

    expect(mocks.send).toHaveBeenCalledTimes(2);
    expect(mocks.send).toHaveBeenNthCalledWith(1, {
      from: { email: BOOKING_EMAIL, name: "Goko Hostel" },
      to: ADMIN_EMAIL,
      replyTo: validPayload.email,
      subject: `Booking enquiry — ${validPayload.name}`,
      text: expect.stringContaining(validPayload.name),
    });
    expect(mocks.send).toHaveBeenNthCalledWith(2, {
      from: { email: BOOKING_EMAIL, name: "Goko Hostel" },
      to: validPayload.email,
      subject: "We received your enquiry — Goko Hostel",
      text: expect.stringContaining("Thanks for reaching out"),
    });
  });

  it("throws when EMAIL binding is missing", async () => {
    mocks.getCloudflareContext.mockReturnValue({ env: {} });
    await expect(sendBookingEnquiryEmails(validPayload)).rejects.toBeInstanceOf(EmailUnavailableError);
  });
});

describe("POST /api/booking-enquiry", () => {
  it("returns 400 for invalid payloads", async () => {
    const res = await POST(request({ ...validPayload, phone: "123" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when honeypot is filled", async () => {
    const res = await POST(request({ ...validPayload, _hp: "bot" }));
    expect(res.status).toBe(400);
  });

  it("returns success when email sends", async () => {
    const res = await POST(request(validPayload));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ success: true });
    expect(mocks.send).toHaveBeenCalledTimes(2);
  });

  it("returns 503 when EMAIL binding is unavailable", async () => {
    mocks.getCloudflareContext.mockReturnValue({ env: {} });
    const res = await POST(request(validPayload));
    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toMatchObject({
      error: "Email is temporarily unavailable. Try WhatsApp instead.",
    });
  });
});
