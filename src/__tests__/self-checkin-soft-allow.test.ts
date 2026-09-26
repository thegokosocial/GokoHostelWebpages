import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { isStaffReviewValidation, messageFromCheckinFailure } from "@/lib/checkinSubmitError";

const ROOT = process.cwd();

describe("checkin submit error mapping", () => {
  it("prefers API error text for non-OK statuses", () => {
    expect(messageFromCheckinFailure(500, { error: "Database temporarily unavailable. Please try again." }))
      .toBe("Database temporarily unavailable. Please try again.");
    expect(messageFromCheckinFailure(429, { error: "Too many submissions. Please try again later." }))
      .toBe("Too many submissions. Please try again later.");
    expect(messageFromCheckinFailure(400, { error: "Missing required fields" })).toBe("Missing required fields");
  });

  it("falls back by status when body has no error", () => {
    expect(messageFromCheckinFailure(429, {})).toMatch(/too many/i);
    expect(messageFromCheckinFailure(413, null)).toMatch(/too large/i);
    expect(messageFromCheckinFailure(403, undefined)).toMatch(/invalid request/i);
    expect(messageFromCheckinFailure(500, {})).toMatch(/front desk/i);
  });

  it("flags soft-accept outcomes as staff review (not hard side failures)", () => {
    expect(isStaffReviewValidation({ valid: true, nameMatchQuality: "none", layers: ["name_mismatch"] })).toBe(true);
    expect(isStaffReviewValidation({ valid: true, needsDocReview: true, layers: ["doc_review"] })).toBe(true);
    expect(isStaffReviewValidation({ valid: true, layers: ["name_verified"] })).toBe(false);
    expect(isStaffReviewValidation({ valid: false, layers: ["unsupported_pan"] })).toBe(false);
    expect(isStaffReviewValidation({ valid: false, layers: ["address_missing"] })).toBe(false);
    expect(isStaffReviewValidation({ valid: false, layers: ["front_missing"] })).toBe(false);
  });
});

describe("self-checkin contrast and error surfacing contracts", () => {
  const form = readFileSync(path.join(ROOT, "src/components/forms/SelfCheckinForm.tsx"), "utf-8");

  it("uses gold Verify on dark-green and keeps red Complete Check-in", () => {
    expect(form).toContain('border-brand-gold bg-brand-green-dark');
    expect(form).toContain("text-brand-gold");
    expect(form).toContain("Verify document");
    expect(form).toContain('variant="cta"');
    expect(form).toContain("Complete Check-in");
    expect(form).not.toContain("bg-brand-green/[0.08] px-4 py-2 text-sm font-medium text-brand-green");
  });

  it("surfaces API errors for every failed submit status", () => {
    expect(form).toContain("messageFromCheckinFailure");
    expect(form).toContain("messageFromCheckinCatch");
    expect(form).toContain("if (!res.ok)");
    expect(form).not.toContain('if (!res.ok) throw new Error("Submission failed")');
    expect(form).not.toContain("useActionProgress");
    expect(form).not.toContain("runAction");
  });

  it("skips re-Vision on submit after client verify and supports dual ID slots", () => {
    expect(form).toContain('formData.append("clientIdValidation", "verified")');
    expect(form).toContain("requiresBothIdSides");
    expect(form).toContain("@/lib/idDocumentSides");
    expect(form).toContain("idFrontFiles");
    expect(form).toContain("idBackFiles");
    expect(form).toContain("isAcceptedIdFile");
    expect(form).toContain("isHeicFile");
    expect(form).toContain("bothSidesHelpText");
    expect(form).toContain("Clear previous ID and upload new");
    expect(form).toContain("Front (photo + DOB)");
    expect(form).toContain("front_missing");
    expect(form).toContain("address_missing");
    expect(form).toContain("Validation is offline");
    expect(form).toContain("bothSidesRequired && idFiles.length < 2");
  });

  it("keeps primary form headings on high-contrast zinc, not green-on-glass", () => {
    expect(form).toContain('font-display text-2xl font-bold text-zinc-900 md:text-3xl');
    expect(form).toContain("font-semibold text-zinc-900");
    expect(form).toContain("text-xs font-semibold uppercase tracking-wide text-zinc-500");
  });
});
