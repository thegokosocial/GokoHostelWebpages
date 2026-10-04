import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const form = readFileSync("src/components/forms/BookingEnquiryForm.tsx", "utf8");

describe("Booking enquiry mobile recovery UI", () => {
  it("keeps validation errors connected to their fields and handles a blocked WhatsApp pop-up", () => {
    expect(form).toContain('const popup = window.open');
    expect(form).toContain("WhatsApp did not open. Allow pop-ups");
    expect(form).toContain('aria-invalid={Boolean(form.formState.errors.name)}');
    expect(form).toContain('aria-describedby={form.formState.errors.email ? "enq-email-error" : undefined}');
    expect(form).toContain('id="enq-msg-error"');
    expect(form).toContain('role="alert"');
  });
});
