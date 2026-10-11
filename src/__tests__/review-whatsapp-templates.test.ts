import { describe, expect, it } from "vitest";
import {
  DEFAULT_GOOGLE_REVIEW_MESSAGE,
  DEFAULT_REVIEW_MESSAGE,
  defaultReviewWhatsAppTemplates,
  fillReviewWhatsAppTemplate,
  parseReviewWhatsAppTemplates,
  reviewGoogleUrl,
  validateReviewWhatsAppTemplates,
} from "@/lib/reviewWhatsApp";

describe("review WhatsApp templates", () => {
  it("falls back to the legacy message plus a direct Google template only when no list was saved", () => {
    expect(parseReviewWhatsAppTemplates(null)).toBeNull();
    expect(parseReviewWhatsAppTemplates("[]")).toEqual([]);
    expect(defaultReviewWhatsAppTemplates("Legacy {REVIEW_URL}")).toEqual([
      { id: "review-feedback", name: "Review feedback", message: "Legacy {REVIEW_URL}" },
      { id: "google-review", name: "Review us on Google", message: DEFAULT_GOOGLE_REVIEW_MESSAGE },
    ]);
    expect(defaultReviewWhatsAppTemplates()[0].message).toBe(DEFAULT_REVIEW_MESSAGE);
  });

  it("validates saved templates and fills both link types", () => {
    const templates = [{ id: "one", name: "Google", message: "Review {GOOGLE_REVIEW_URL}" }];
    expect(validateReviewWhatsAppTemplates(templates)).toEqual(templates);
    expect(validateReviewWhatsAppTemplates([{ ...templates[0] }, { ...templates[0] }])).toBeNull();
    expect(fillReviewWhatsAppTemplate("{REVIEW_URL} {REVIEW_URL} {GOOGLE_REVIEW_URL}", {
      reviewUrl: "https://goko.test/review/a", googleReviewUrl: "https://g.page/r/goko",
    })).toBe("https://goko.test/review/a https://goko.test/review/a https://g.page/r/goko");
  });

  it("accepts only absolute HTTP(S) Google Review URLs", () => {
    expect(reviewGoogleUrl("https://g.page/r/goko")).toBe("https://g.page/r/goko");
    expect(reviewGoogleUrl("javascript:alert(1)")).toBe("");
    expect(reviewGoogleUrl("not-a-url")).toBe("");
  });
});
