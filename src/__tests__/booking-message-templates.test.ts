import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  DEFAULT_BOOKING_EMAIL_TEMPLATES,
  fillBookingEmailTemplate,
  parseBookingEmailTemplates,
  validateBookingEmailTemplates,
  tidyBookingEmailBody,
} from "@/lib/bookingEmailTemplates";
import {
  DEFAULT_BOOKING_SMS_TEMPLATES,
  parseBookingSmsTemplates,
  validateBookingSmsTemplates,
} from "@/lib/bookingSmsTemplates";

describe("booking email templates", () => {
  it("fills placeholders and merges defaults for missing kinds", () => {
    const filled = fillBookingEmailTemplate("Hi {GUEST_NAME} — {BOOKING_ID}", {
      "{GUEST_NAME}": "Ada",
      "{BOOKING_ID}": "GOKO1",
    });
    expect(filled).toBe("Hi Ada — GOKO1");
    const parsed = parseBookingEmailTemplates(JSON.stringify({
      confirmation: { subject: "Custom {BOOKING_ID}", body: "Hello {GUEST_NAME}" },
    }));
    expect(parsed.confirmation.subject).toBe("Custom {BOOKING_ID}");
    expect(parsed.modified.subject).toBe(DEFAULT_BOOKING_EMAIL_TEMPLATES.modified.subject);
    expect(tidyBookingEmailBody("a\n\n\n\nb  \n")).toBe("a\n\nb");
  });

  it("rejects invalid email saves", () => {
    expect(validateBookingEmailTemplates({})).toBeNull();
    expect(validateBookingEmailTemplates({
      confirmation: { subject: "ok", body: "ok" },
      modified: { subject: "ok", body: "ok" },
      cancelled: { subject: "", body: "ok" },
    })).toBeNull();
    expect(validateBookingEmailTemplates(DEFAULT_BOOKING_EMAIL_TEMPLATES)).toEqual(DEFAULT_BOOKING_EMAIL_TEMPLATES);
  });
});

describe("booking SMS templates", () => {
  it("parses body-only drafts and keeps defaults", () => {
    const parsed = parseBookingSmsTemplates(JSON.stringify({
      confirmation: { body: "Confirmed {BOOKING_ID}" },
    }));
    expect(parsed.confirmation.body).toBe("Confirmed {BOOKING_ID}");
    expect(parsed.cancelled.body).toBe(DEFAULT_BOOKING_SMS_TEMPLATES.cancelled.body);
    expect(validateBookingSmsTemplates(DEFAULT_BOOKING_SMS_TEMPLATES)).toEqual(DEFAULT_BOOKING_SMS_TEMPLATES);
    expect(validateBookingSmsTemplates({ confirmation: { body: "" } })).toBeNull();
  });
});

describe("booking message template UI/API contracts", () => {
  const route = readFileSync("src/app/api/admin/booking-settings/route.ts", "utf8");
  const ui = readFileSync("src/components/admin/BookingSettings.tsx", "utf8");
  const email = readFileSync("src/lib/email.ts", "utf8");

  it("exposes email + SMS get/save and Email/Text tabs", () => {
    expect(route).toContain('case "getEmailTemplates"');
    expect(route).toContain('case "saveEmailTemplates"');
    expect(route).toContain('case "getSmsTemplates"');
    expect(route).toContain('case "saveSmsTemplates"');
    expect(ui).toContain('["emails", "Email Templates"]');
    expect(ui).toContain('["sms", "Text Templates"]');
    expect(ui).toContain("Save email templates");
    expect(ui).toContain("Save text templates");
  });

  it("wires confirmation email only; SMS has no send path", () => {
    expect(email).toContain("templates.confirmation");
    expect(email).toContain("BOOKING_EMAIL_TEMPLATES_KEY");
    expect(email).not.toContain("BOOKING_SMS_TEMPLATES_KEY");
    expect(ui).toContain("No provider is connected yet");
  });
});
